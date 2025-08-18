import React, { useState, useCallback } from 'react';
import {
  Container,
  Paper,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Progress,
  Card,
  Badge,
  Alert,
  Center,
  Loader,
  ActionIcon,
  ScrollArea
} from '@mantine/core';
import {
  Upload,
  FileText,
  CheckCircle,
  XCircle,
  Trash2,
  Mountain,
  MapPin,
  Clock
} from 'lucide-react';
import { Dropzone } from '@mantine/dropzone';
import toast from 'react-hot-toast';
import { parseGPX } from '../utils/gpx';
import { parseFIT } from '../utils/fit';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUnits } from '../utils/units';

const FileUpload = () => {
  const { user } = useAuth();
  const { formatDistance, formatElevation } = useUnits();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState({});

  // Handle file selection
  const handleFiles = useCallback((newFiles) => {
    const fileData = newFiles.map(file => ({
      file,
      id: Math.random().toString(36),
      status: 'selected',
      progress: 0
    }));
    setFiles(prev => [...prev, ...fileData]);
  }, []);

  // Calculate simple stats for preview (improved haversine)
  const calculateStats = (points) => {
    if (!points || points.length < 2) return { distance: 0, elevation: 0 };
    
    let distance = 0;
    let elevation = 0;
    
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      
      // Proper haversine distance calculation
      if (prev.latitude && curr.latitude && prev.longitude && curr.longitude) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
        const dLng = (curr.longitude - prev.longitude) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        distance += R * c;
      }
      
      // Elevation gain
      if (prev.elevation && curr.elevation && curr.elevation > prev.elevation) {
        elevation += curr.elevation - prev.elevation;
      }
    }
    
    return {
      distance: Math.round(distance * 100) / 100,
      elevation: Math.round(elevation)
    };
  };

  // Upload single file
  const uploadFile = async (fileData) => {
    const updateStatus = (updates) => {
      setStatus(prev => ({ ...prev, [fileData.id]: { ...prev[fileData.id], ...updates } }));
    };

    try {
      updateStatus({ status: 'parsing', progress: 20 });

      // Detect file type and parse accordingly
      const fileName = fileData.file.name.toLowerCase();
      const isFitFile = fileName.endsWith('.fit') || fileName.endsWith('.fit.gz');
      const isCompressed = fileName.endsWith('.fit.gz') || fileName.endsWith('.gz');
      
      let routeData;
      if (isFitFile) {
        // Parse FIT file (compressed or uncompressed)
        const fitBuffer = await fileData.file.arrayBuffer();
        routeData = await parseFIT(fitBuffer, isCompressed);
      } else {
        // Parse GPX file
        const gpxText = await fileData.file.text();
        routeData = parseGPX(gpxText);
      }
      
      console.log(`${isFitFile ? (isCompressed ? 'Compressed FIT' : 'FIT') : 'GPX'} parsed:`, {
        trackPoints: routeData?.trackPoints?.length,
        metadata: routeData?.metadata,
        firstPoint: routeData?.trackPoints?.[0],
        lastPoint: routeData?.trackPoints?.[routeData?.trackPoints?.length - 1]
      });
      
      if (!routeData?.trackPoints?.length) {
        throw new Error('No GPS track found in file');
      }

      const points = routeData.trackPoints;
      updateStatus({ status: 'uploading', progress: 50 });

      // Extract activity date from metadata or first track point
      const activityDate = routeData.metadata?.time || 
                          routeData.trackPoints?.[0]?.time || 
                          new Date().toISOString();

      console.log('Activity date extracted:', activityDate);

      // Create route record (fresh schema)
      const { data: route, error: routeError } = await supabase
        .from('routes')
        .insert({
          user_id: user.id,
          name: routeData.metadata?.name || fileData.file.name.replace(/\.(gpx|fit|fit\.gz)$/i, ''),
          filename: fileData.file.name,
          source: 'upload',
          created_at: activityDate
        })
        .select()
        .single();

      if (routeError) throw routeError;

      updateStatus({ progress: 70 });

      // Insert track points in chunks - try minimal columns first
      const trackPoints = points.map((point, index) => ({
        route_id: route.id,
        lat: point.latitude,
        lng: point.longitude,
        elevation: point.elevation ? Math.round(point.elevation) : null,
        sequence_num: index
      }));

      console.log('Inserting track points:', {
        totalPoints: trackPoints.length,
        firstPoint: trackPoints[0],
        lastPoint: trackPoints[trackPoints.length - 1],
        sampleDistanceBetweenFirst2: trackPoints.length > 1 ? 
          Math.sqrt(
            Math.pow(trackPoints[1].lat - trackPoints[0].lat, 2) + 
            Math.pow(trackPoints[1].lng - trackPoints[0].lng, 2)
          ) * 111.111 : 0
      });

      // Upload in chunks of 1000
      for (let i = 0; i < trackPoints.length; i += 1000) {
        const chunk = trackPoints.slice(i, i + 1000);
        const { error } = await supabase.from('track_points').insert(chunk);
        if (error) throw error;
        
        const progress = 70 + (i / trackPoints.length) * 20;
        updateStatus({ progress });
      }

      // Verify track points were inserted
      const { data: insertedPoints, error: countError } = await supabase
        .from('track_points')
        .select('id')
        .eq('route_id', route.id);
      
      console.log('Track points inserted:', insertedPoints?.length);

      updateStatus({ status: 'calculating', progress: 90 });

      // Calculate route statistics using fresh schema functions
      console.log('Calling calculate_route_stats for route:', route.id);
      const { data: statsData, error: statsError } = await supabase.rpc('calculate_route_stats', { 
        route_uuid: route.id 
      });
      
      if (statsError) {
        console.error('Stats calculation failed:', statsError);
        console.error('Full error details:', statsError);
      } else {
        console.log('Stats calculation completed successfully');
        console.log('Stats calculation result:', statsData);
      }

      const { error: profileError } = await supabase.rpc('generate_elevation_profile', { 
        route_uuid: route.id 
      });
      
      // If the function doesn't exist, create a simple profile manually
      if (profileError && profileError.message?.includes('function') && profileError.message?.includes('does not exist')) {
        console.warn('Elevation profile function not found, skipping elevation profile generation');
      }
      
      if (profileError) {
        console.warn('Elevation profile generation failed:', profileError);
      }

      // Check what the database calculated
      const { data: updatedRoute, error: fetchError } = await supabase
        .from('routes')
        .select('*')
        .eq('id', route.id)
        .single();

      console.log('Route after calculations:', {
        id: updatedRoute?.id,
        distance_km: updatedRoute?.distance_km,
        elevation_gain_m: updatedRoute?.elevation_gain_m,
        duration_seconds: updatedRoute?.duration_seconds,
        elevation_loss_m: updatedRoute?.elevation_loss_m,
        north: updatedRoute?.north,
        south: updatedRoute?.south,
        east: updatedRoute?.east,
        west: updatedRoute?.west,
        trackPointsCount: points.length,
        fullRoute: updatedRoute
      });

      const stats = calculateStats(points);
      console.log('Client-side calculated stats:', stats);
      
      // Let's also check a few sample track points to see if they look correct
      console.log('Sample track points:', {
        first: points[0],
        last: points[points.length - 1],
        middle: points[Math.floor(points.length / 2)]
      });
      updateStatus({ 
        status: 'completed', 
        progress: 100,
        stats,
        route
      });

      toast.success(`Uploaded ${fileData.file.name}`);

    } catch (error) {
      console.error('Upload failed:', error);
      updateStatus({ 
        status: 'error', 
        error: error.message 
      });
      toast.error(`Failed: ${error.message}`);
    }
  };

  // Upload all files
  const uploadAll = async () => {
    setUploading(true);
    try {
      await Promise.all(files.map(uploadFile));
      toast.success('All files uploaded!');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setStatus(prev => {
      const newStatus = { ...prev };
      delete newStatus[id];
      return newStatus;
    });
  };

  const completed = files.filter(f => status[f.id]?.status === 'completed').length;
  const failed = files.filter(f => status[f.id]?.status === 'error').length;

  return (
    <Container size="lg">
      <Stack gap="lg">
        <div>
          <Title order={2}>Upload Cycling Routes</Title>
          <Text c="dimmed">Upload GPX or FIT files for instant analysis with advanced Garmin device data</Text>
        </div>

        {/* Drop Zone */}
        <Paper withBorder p="lg">
          <Dropzone
            onDrop={handleFiles}
            accept={{
              'application/gpx+xml': ['.gpx'],
              'text/xml': ['.gpx'],
              'application/xml': ['.gpx'],
              'application/octet-stream': ['.fit', '.fit.gz'],
              'application/x-garmin-fit': ['.fit'],
              'application/gzip': ['.fit.gz', '.gz']
            }}
            disabled={uploading}
            multiple
          >
            <Center style={{ minHeight: 100 }}>
              <Stack align="center" gap="sm">
                <Upload size={48} color="gray" />
                <div>
                  <Text size="lg" fw={500}>Drop GPX or FIT files here</Text>
                  <Text size="sm" c="dimmed">Supports Garmin FIT and GPX files</Text>
                </div>
              </Stack>
            </Center>
          </Dropzone>
        </Paper>

        {/* File List */}
        {files.length > 0 && (
          <Paper withBorder p="md">
            <Group justify="space-between" mb="md">
              <Title order={4}>Files ({files.length})</Title>
              <Button
                onClick={uploadAll}
                disabled={uploading || files.length === 0}
                loading={uploading}
              >
                Upload All
              </Button>
            </Group>

            {/* Summary */}
            {(completed > 0 || failed > 0) && (
              <Alert mb="md" color={failed > 0 ? 'orange' : 'green'}>
                {completed} completed, {failed} failed, {files.length - completed - failed} pending
              </Alert>
            )}

            <ScrollArea style={{ height: 400 }}>
              <Stack gap="sm">
                {files.map((fileData) => {
                  const fileStatus = status[fileData.id] || { status: 'selected', progress: 0 };
                  
                  return (
                    <Card key={fileData.id} padding="sm" withBorder>
                      <Stack gap="xs">
                        <Group justify="space-between">
                          <Group gap="sm">
                            <Badge
                              color={
                                fileStatus.status === 'completed' ? 'green' :
                                fileStatus.status === 'error' ? 'red' : 'blue'
                              }
                              leftSection={
                                fileStatus.status === 'completed' ? <CheckCircle size={14} /> :
                                fileStatus.status === 'error' ? <XCircle size={14} /> :
                                ['parsing', 'uploading', 'calculating'].includes(fileStatus.status) ? 
                                <Loader size={14} /> : <FileText size={14} />
                              }
                            >
                              {fileStatus.status}
                            </Badge>
                            <Text fw={500} size="sm">{fileData.file.name}</Text>
                          </Group>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => removeFile(fileData.id)}
                            disabled={uploading}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Group>

                        {/* Progress */}
                        {['parsing', 'uploading', 'calculating'].includes(fileStatus.status) && (
                          <Progress value={fileStatus.progress} size="sm" animated />
                        )}

                        {/* Error */}
                        {fileStatus.status === 'error' && (
                          <Alert color="red" size="sm">
                            {fileStatus.error}
                          </Alert>
                        )}

                        {/* Success Stats */}
                        {fileStatus.status === 'completed' && fileStatus.stats && (
                          <Group gap="md">
                            <Group gap="xs">
                              <MapPin size={12} />
                              <Text size="xs">{formatDistance(fileStatus.stats.distance)}</Text>
                            </Group>
                            <Group gap="xs">
                              <Mountain size={12} />
                              <Text size="xs">↗ {formatElevation(fileStatus.stats.elevation)}</Text>
                            </Group>
                          </Group>
                        )}
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Paper>
        )}

        {/* Instructions */}
        <Paper withBorder p="md" bg="gray.0">
          <Title order={5} mb="sm">🚀 New Optimized Upload System</Title>
          <Stack gap="xs">
            <Text size="sm">• Uses clean separated table structure for better performance</Text>
            <Text size="sm">• Automatic route statistics calculation</Text>
            <Text size="sm">• Instant dashboard loading with pre-calculated data</Text>
            <Text size="sm">• Proper user data isolation with Row Level Security</Text>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
};

export default FileUpload;
import { useState, useCallback } from 'react';
import {
  Paper,
  Text,
  Button,
  Group,
  Stack,
  Alert,
  Progress,
  FileButton,
  Card,
  Grid,
  ScrollArea,
  ActionIcon,
  Tabs,
  Checkbox,
  Loader,
} from '@mantine/core';
import {
  Upload,
  AlertCircle,
  CheckCircle,
  Save,
  MapPin,
  Activity,
  Mountain,
  Trash2,
  Files,
  X,
  CheckSquare,
  Square,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { parseGPX } from '../utils/gpx';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUnits } from '../utils/units';
import './FileUpload.css';

const FileUpload = () => {
  const { user } = useAuth();
  const { formatDistance, formatElevation } = useUnits();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [processedFiles, setProcessedFiles] = useState(new Map());
  const [processingFiles, setProcessingFiles] = useState(new Set());
  const [selectedForSave, setSelectedForSave] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState({ current: 0, total: 0 });
  const [globalError, setGlobalError] = useState(null);

  const handleFileSelect = useCallback((files) => {
    if (!files || files.length === 0) return;
    
    const gpxFiles = Array.from(files).filter(file => 
      file.name.toLowerCase().endsWith('.gpx')
    );
    
    if (gpxFiles.length === 0) {
      setGlobalError('Please select valid GPX files');
      return;
    }

    if (gpxFiles.length !== files.length) {
      toast.warning(`${files.length - gpxFiles.length} non-GPX files were filtered out`);
    }

    const newFiles = gpxFiles.filter(file => 
      !selectedFiles.some(existing => existing.name === file.name && existing.size === file.size)
    );

    if (newFiles.length === 0) {
      toast.warning('All selected files are already added');
      return;
    }

    setSelectedFiles(prev => [...prev, ...newFiles]);
    setGlobalError(null);
    
    // Process new files
    newFiles.forEach(file => processFile(file));
  }, [selectedFiles]);

  const processFile = async (file) => {
    const fileId = `${file.name}_${file.size}_${file.lastModified}`;
    
    setProcessingFiles(prev => new Set([...prev, fileId]));

    try {
      const content = await readFileAsText(file);
      const gpxData = parseGPX(content);
      
      setProcessedFiles(prev => new Map([...prev, [fileId, {
        file,
        data: gpxData,
        error: null,
        processed: true
      }]]));
      
      // Auto-select successfully processed files for saving
      setSelectedForSave(prev => new Set([...prev, fileId]));
      
    } catch (err) {
      console.error('File processing error:', err);
      setProcessedFiles(prev => new Map([...prev, [fileId, {
        file,
        data: null,
        error: err.message || 'Failed to process GPX file',
        processed: true
      }]]));
    } finally {
      setProcessingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });
    }
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const removeFile = (fileId) => {
    setSelectedFiles(prev => prev.filter(file => {
      const id = `${file.name}_${file.size}_${file.lastModified}`;
      return id !== fileId;
    }));
    setProcessedFiles(prev => {
      const newMap = new Map(prev);
      newMap.delete(fileId);
      return newMap;
    });
    setSelectedForSave(prev => {
      const newSet = new Set(prev);
      newSet.delete(fileId);
      return newSet;
    });
  };

  const toggleFileSelection = (fileId) => {
    setSelectedForSave(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    const successfulFiles = Array.from(processedFiles.entries())
      .filter(([_, fileData]) => fileData.data && !fileData.error)
      .map(([fileId]) => fileId);
    setSelectedForSave(new Set(successfulFiles));
  };

  const deselectAll = () => {
    setSelectedForSave(new Set());
  };

  const saveSelectedToDatabase = async () => {
    if (selectedForSave.size === 0 || !user) return;

    setSaving(true);
    setSavingProgress({ current: 0, total: selectedForSave.size });
    let successCount = 0;
    let failCount = 0;
    const savedFileIds = [];

    try {
      // Process files one by one to avoid timeout
      let currentIndex = 0;
      for (const fileId of selectedForSave) {
        currentIndex++;
        setSavingProgress({ current: currentIndex, total: selectedForSave.size });
        try {
          const fileData = processedFiles.get(fileId);
          if (fileData && fileData.data && !fileData.error) {
            const routeData = {
              user_id: user.id,
              metadata: {
                name: fileData.data.metadata.name,
                source: 'gpx_upload',
                creator: fileData.data.metadata.creator,
                description: fileData.data.metadata.description,
                original_filename: fileData.file.name,
                imported_at: new Date().toISOString(),
              },
              track_points: fileData.data.trackPoints,
              summary: {
                distance: fileData.data.summary.distance,
                elevation_gain: fileData.data.summary.elevationGain,
                elevation_loss: fileData.data.summary.elevationLoss,
                elevation_min: fileData.data.summary.minElevation,
                elevation_max: fileData.data.summary.maxElevation,
                point_count: fileData.data.summary.pointCount,
              },
            };

            // Insert one route at a time
            const { error } = await supabase
              .from('routes')
              .insert([routeData]);

            if (error) {
              console.error(`Failed to save ${fileData.file.name}:`, error);
              failCount++;
            } else {
              successCount++;
              savedFileIds.push(fileId);
              toast.success(`"${fileData.data.metadata.name}" saved successfully!`);
            }
          }
        } catch (err) {
          console.error(`Error processing file ${fileId}:`, err);
          failCount++;
        }
      }

      // Remove successfully saved files from the list
      savedFileIds.forEach(fileId => removeFile(fileId));

      // Show summary message
      if (successCount > 0) {
        toast.success(`${successCount} route${successCount > 1 ? 's' : ''} saved successfully!`);
      }
      
      if (failCount > 0) {
        setGlobalError(`Failed to save ${failCount} route${failCount > 1 ? 's' : ''}. Check console for details.`);
        toast.error(`Failed to save ${failCount} route${failCount > 1 ? 's' : ''}`);
      }
        
    } catch (err) {
      console.error('Batch save error:', err);
      setGlobalError(err.message || 'Failed to save routes');
      toast.error('Failed to save routes');
    } finally {
      setSaving(false);
      setSavingProgress({ current: 0, total: 0 });
    }
  };

  const clearAll = () => {
    setSelectedFiles([]);
    setProcessedFiles(new Map());
    setProcessingFiles(new Set());
    setSelectedForSave(new Set());
    setGlobalError(null);
  };

  const getFileId = (file) => `${file.name}_${file.size}_${file.lastModified}`;
  const successfulFiles = Array.from(processedFiles.values()).filter(f => f.data && !f.error);
  const failedFiles = Array.from(processedFiles.values()).filter(f => f.error);
  const totalProcessing = processingFiles.size;

  return (
    <div className="file-upload-container">
      <Paper shadow="sm" p="xl" radius="md">
        <Stack gap="lg">
          <div style={{ textAlign: 'center' }}>
            <Files size={48} style={{ color: '#228be6', marginBottom: '1rem' }} />
            <Text size="xl" fw={600} mb="xs">
              Import Multiple GPX Files
            </Text>
            <Text size="sm" c="dimmed">
              Upload multiple GPX files at once to batch import cycling routes
            </Text>
          </div>

          <Card withBorder p="md" radius="md" style={{ 
            border: selectedFiles.length > 0 ? '2px solid #228be6' : '2px dashed #dee2e6',
            backgroundColor: selectedFiles.length > 0 ? '#f0f7ff' : '#f8f9fa'
          }}>
            <Stack gap="md" align="center">
              <FileButton onChange={handleFileSelect} accept=".gpx" multiple>
                {(props) => (
                  <Button
                    {...props}
                    size="lg"
                    leftSection={<Upload size={20} />}
                    variant="filled"
                  >
                    Select GPX Files
                  </Button>
                )}
              </FileButton>
              <Text size="xs" c="dimmed">
                Select multiple GPX files with tracks, routes, and waypoints
              </Text>
              
              {selectedFiles.length > 0 && (
                <Group gap="md" style={{ width: '100%' }}>
                  <Text size="sm" fw={500}>
                    {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
                  </Text>
                  <Button
                    variant="subtle"
                    color="red"
                    size="xs"
                    leftSection={<Trash2 size={14} />}
                    onClick={clearAll}
                  >
                    Clear All
                  </Button>
                </Group>
              )}
            </Stack>
          </Card>

          {totalProcessing > 0 && (
            <Card withBorder p="md" style={{ backgroundColor: '#fff3cd' }}>
              <Group gap="sm">
                <Loader size="sm" color="yellow" />
                <div style={{ flex: 1 }}>
                  <Text size="sm" fw={500} style={{ color: '#856404' }}>
                    Processing {totalProcessing} file{totalProcessing > 1 ? 's' : ''}...
                  </Text>
                  <Progress
                    size="sm"
                    color="yellow"
                    value={100}
                    animated
                    mt="xs"
                  />
                </div>
              </Group>
            </Card>
          )}

          {globalError && (
            <Alert
              icon={<AlertCircle size={16} />}
              color="red"
              title="Error"
            >
              {globalError}
            </Alert>
          )}

          {(successfulFiles.length > 0 || failedFiles.length > 0) && (
            <Tabs defaultValue="successful" variant="outline">
              <Tabs.List>
                <Tabs.Tab 
                  value="successful" 
                  leftSection={<CheckCircle size={16} />}
                  color="green"
                >
                  Successful ({successfulFiles.length})
                </Tabs.Tab>
                {failedFiles.length > 0 && (
                  <Tabs.Tab 
                    value="failed" 
                    leftSection={<AlertCircle size={16} />}
                    color="red"
                  >
                    Failed ({failedFiles.length})
                  </Tabs.Tab>
                )}
              </Tabs.List>

              <Tabs.Panel value="successful" pt="md">
                {successfulFiles.length > 0 && (
                  <Stack gap="md">
                    <Group justify="space-between">
                      <Text size="sm" fw={500}>
                        Select routes to save to database:
                      </Text>
                      <Group gap="xs">
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<CheckSquare size={14} />}
                          onClick={selectAll}
                        >
                          Select All
                        </Button>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<Square size={14} />}
                          onClick={deselectAll}
                        >
                          Deselect All
                        </Button>
                      </Group>
                    </Group>

                    <ScrollArea h={400}>
                      <Stack gap="sm">
                        {successfulFiles.map((fileData) => {
                          const fileId = getFileId(fileData.file);
                          const isSelected = selectedForSave.has(fileId);
                          
                          return (
                            <Card
                              key={fileId}
                              withBorder
                              p="md"
                              style={{
                                backgroundColor: isSelected ? '#f0f7ff' : '#ffffff',
                                border: isSelected ? '2px solid #228be6' : '1px solid #dee2e6'
                              }}
                            >
                              <Group justify="space-between" align="flex-start">
                                <Group gap="sm" style={{ flex: 1 }}>
                                  <Checkbox
                                    checked={isSelected}
                                    onChange={() => toggleFileSelection(fileId)}
                                    size="sm"
                                  />
                                  <div style={{ flex: 1 }}>
                                    <Group justify="space-between" align="flex-start">
                                      <div>
                                        <Text size="sm" fw={600}>
                                          {fileData.data?.metadata?.name || 'Unnamed Route'}
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                          {fileData.file.name} • {(fileData.file.size / 1024).toFixed(1)} KB
                                        </Text>
                                      </div>
                                      <ActionIcon
                                        variant="subtle"
                                        color="red"
                                        size="sm"
                                        onClick={() => removeFile(fileId)}
                                      >
                                        <X size={14} />
                                      </ActionIcon>
                                    </Group>
                                    
                                    <Grid mt="xs">
                                      <Grid.Col span={6}>
                                        <Group gap="xs">
                                          <MapPin size={12} style={{ color: '#228be6' }} />
                                          <Text size="xs">
                                            {formatDistance(fileData.data?.summary?.distance || 0)}
                                          </Text>
                                        </Group>
                                      </Grid.Col>
                                      <Grid.Col span={6}>
                                        <Group gap="xs">
                                          <Activity size={12} style={{ color: '#228be6' }} />
                                          <Text size="xs">
                                            {(fileData.data?.summary?.pointCount || 0).toLocaleString()} points
                                          </Text>
                                        </Group>
                                      </Grid.Col>
                                      {(fileData.data?.summary?.elevationGain || 0) > 0 && (
                                        <>
                                          <Grid.Col span={6}>
                                            <Group gap="xs">
                                              <Mountain size={12} style={{ color: '#40c057' }} />
                                              <Text size="xs">
                                                ↗ {formatElevation(fileData.data?.summary?.elevationGain || 0)}
                                              </Text>
                                            </Group>
                                          </Grid.Col>
                                          <Grid.Col span={6}>
                                            <Group gap="xs">
                                              <Mountain size={12} style={{ color: '#fd7e14' }} />
                                              <Text size="xs">
                                                ↘ {formatElevation(fileData.data?.summary?.elevationLoss || 0)}
                                              </Text>
                                            </Group>
                                          </Grid.Col>
                                        </>
                                      )}
                                    </Grid>
                                  </div>
                                </Group>
                              </Group>
                            </Card>
                          );
                        })}
                      </Stack>
                    </ScrollArea>

                    {selectedForSave.size > 0 && (
                      <Card withBorder p="md" style={{ backgroundColor: '#e7f5ff' }}>
                        <Group justify="space-between" align="center">
                          <div>
                            <Text size="sm" fw={500}>
                              {selectedForSave.size} route{selectedForSave.size > 1 ? 's' : ''} selected for saving
                            </Text>
                            <Text size="xs" c="dimmed">
                              These will be saved to your account
                            </Text>
                          </div>
                          <Button
                            leftSection={<Save size={16} />}
                            onClick={saveSelectedToDatabase}
                            loading={saving}
                            disabled={!user || selectedForSave.size === 0}
                          >
                            {saving && savingProgress.total > 0 
                              ? `Saving ${savingProgress.current}/${savingProgress.total}...`
                              : 'Save Selected Routes'
                            }
                          </Button>
                        </Group>
                        
                        {saving && savingProgress.total > 0 && (
                          <Progress
                            value={(savingProgress.current / savingProgress.total) * 100}
                            size="sm"
                            mt="sm"
                            color="blue"
                          />
                        )}
                      </Card>
                    )}

                    {!user && (
                      <Alert color="blue" variant="light">
                        Please log in to save routes to your account
                      </Alert>
                    )}
                  </Stack>
                )}
              </Tabs.Panel>

              {failedFiles.length > 0 && (
                <Tabs.Panel value="failed" pt="md">
                  <Stack gap="sm">
                    {failedFiles.map((fileData) => {
                      const fileId = getFileId(fileData.file);
                      
                      return (
                        <Card key={fileId} withBorder p="md" style={{ backgroundColor: '#fff5f5' }}>
                          <Group justify="space-between" align="flex-start">
                            <div style={{ flex: 1 }}>
                              <Group justify="space-between" align="flex-start">
                                <div>
                                  <Text size="sm" fw={600} c="red">
                                    {fileData.file.name}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {(fileData.file.size / 1024).toFixed(1)} KB
                                  </Text>
                                </div>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  size="sm"
                                  onClick={() => removeFile(fileId)}
                                >
                                  <X size={14} />
                                </ActionIcon>
                              </Group>
                              <Alert
                                icon={<AlertCircle size={14} />}
                                color="red"
                                variant="light"
                                mt="xs"
                              >
                                {fileData.error}
                              </Alert>
                            </div>
                          </Group>
                        </Card>
                      );
                    })}
                  </Stack>
                </Tabs.Panel>
              )}
            </Tabs>
          )}
        </Stack>
      </Paper>
    </div>
  );
};

export default FileUpload;
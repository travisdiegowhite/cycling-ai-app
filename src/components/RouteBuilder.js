import React, { useState, useCallback, useMemo } from 'react';
import { Source, Layer, Marker, Popup } from 'react-map-gl';
import {
  Paper,
  TextInput,
  Button,
  Group,
  Stack,
  Progress,
  Text,
  Checkbox,
  ActionIcon,
  Alert,
} from '@mantine/core';
import { 
  Undo2, 
  RotateCcw, 
  Trash2, 
  Save, 
  Download, 
  X, 
  AlertCircle,
  FileText
} from 'lucide-react';
import toast from 'react-hot-toast';
import { buildLineString, polylineDistance } from '../utils/geo';
import { mapMatchRoute, fetchElevationProfile, calculateElevationStats } from '../utils/directions';
import { pointsToGPX } from '../utils/gpx';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUnits } from '../utils/units';

const RouteBuilder = ({ active, onExit, onSaved, mapRef, inline = false, onMapElementsChange, onRouteDataChange }) => {
  const { user } = useAuth();
  const { formatDistance, formatElevation } = useUnits();
  const [points, setPoints] = useState([]); // array of [lon, lat]
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [showWaypointPopup, setShowWaypointPopup] = useState(null); // index
  const [snapping, setSnapping] = useState(false);
  const [snapProgress, setSnapProgress] = useState(0);
  const [snappedCoords, setSnappedCoords] = useState([]); // expanded snapped polyline
  const [useSnap, setUseSnap] = useState(true);
  const [routeMetadata, setRouteMetadata] = useState(null); // Store additional route data
  const [elevationProfile, setElevationProfile] = useState([]);
  const [elevationStats, setElevationStats] = useState(null);

  const addPoint = useCallback((lngLat) => {
    console.log(`🔧 Adding waypoint: ${lngLat.lng}, ${lngLat.lat}`);
    setPoints(prev => {
      const newPoints = [...prev, [lngLat.lng, lngLat.lat]];
      console.log(`🔧 Total waypoints now: ${newPoints.length}`);
      return newPoints;
    });
  }, []);

  const undo = () => setPoints(p => p.slice(0, -1));
  const clearAll = () => setPoints([]);
  const reverseRoute = () => setPoints(p => [...p].reverse());
  const removePoint = (idx) => setPoints(p => p.filter((_, i) => i !== idx));

  const workingCoords = useSnap && snappedCoords.length ? snappedCoords : points;
  const distanceKm = useMemo(() => polylineDistance(workingCoords), [workingCoords]);
  const geojson = useMemo(() => buildLineString(workingCoords), [workingCoords]);

  const canSave = points.length >= 2 && name.trim().length > 0 && !saving;

  const handleMapClick = useCallback((e) => {
    if (!active) return;
    addPoint(e.lngLat);
  }, [active, addPoint]);

  // Attach temporary event listener to map if active
  React.useEffect(() => {
    if (!active || !mapRef?.current) return;
    const map = mapRef.current.getMap();
    map.on('click', handleMapClick);
    return () => map.off('click', handleMapClick);
  }, [active, mapRef, handleMapClick]);

  const saveRoute = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    
    try {
      const metadata = { 
        name: name.trim(), 
        source: 'builder', 
        created_at: new Date().toISOString(),
        snapping_used: useSnap,
        confidence: routeMetadata?.confidence || null
      };
      
      const finalPoints = workingCoords;
      const track_points = finalPoints.map(([lon, lat], idx) => ({
        longitude: lon,
        latitude: lat,
        sequence: idx
      }));
      
      const summary = { 
        distance: distanceKm, 
        snapped: useSnap,
        confidence: routeMetadata?.confidence || null,
        duration: routeMetadata?.duration || null,
        elevation_gain: elevationStats?.gain || null,
        elevation_loss: elevationStats?.loss || null,
        elevation_min: elevationStats?.min || null,
        elevation_max: elevationStats?.max || null
      };
      
      // Create route data for database
      const routeData = {
        user_id: user.id,
        metadata,
        track_points,
        summary
      };
      
      // Note: elevation_profile column doesn't exist in database yet
      // TODO: Add elevation_profile column to routes table if needed
      
      const { data, error } = await supabase.from('routes').insert([routeData]).select();
      
      if (error) throw error;
      
      toast.success(`Route "${name}" saved successfully!`);
      onSaved && onSaved(data[0]);
      clearAll();
      setName('');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save route');
      toast.error('Failed to save route');
    } finally {
      setSaving(false);
    }
  };

  const exportGPX = () => {
    const gpx = pointsToGPX(points, { name: name || 'Route' });
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name || 'route').replace(/\s+/g,'_')}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('GPX file downloaded!');
  };

  // Rebuild snapped path when points change and snapping enabled
  React.useEffect(() => {
    let cancelled = false;
    let timeoutId;
    
    async function snapAndElevate() {
      console.log(`🔧 snapAndElevate called with ${points.length} points, useSnap: ${useSnap}`);
      
      if (!useSnap || points.length < 2) { 
        console.log(`🔧 Skipping snap: useSnap=${useSnap}, points.length=${points.length}`);
        setSnappedCoords([]);
        setRouteMetadata(null);
        setElevationProfile([]);
        setElevationStats(null);
        setSnapping(false); 
        return; 
      }
      
      const token = process.env.REACT_APP_MAPBOX_TOKEN;
      if (!token) {
        console.warn('Mapbox token missing; disabling snapping');
        setSnappedCoords([]);
        setRouteMetadata(null);
        setElevationProfile([]);
        setElevationStats(null);
        setSnapping(false);
        return;
      }
      
      setSnapping(true);
      setSnapProgress(0.1);
      
      try {
        console.log(`🔧 Starting map matching for ${points.length} points...`);
        // Use Map Matching API for better route snapping
        const matchResult = await mapMatchRoute(points, token);
        console.log(`🔧 Map matching result:`, matchResult);
        setSnapProgress(0.6);
        
        if (!cancelled && matchResult && matchResult.coordinates) {
          // Use snapped route - let users decide based on UI feedback
          setSnappedCoords(matchResult.coordinates);
          setRouteMetadata({
            distance: matchResult.distance,
            duration: matchResult.duration,
            confidence: matchResult.confidence,
            profile: matchResult.profile
          });
          
          // Fetch elevation profile for the matched route
          setSnapProgress(0.8);
          const elevation = await fetchElevationProfile(matchResult.coordinates, token);
          
          if (!cancelled) {
            setElevationProfile(elevation);
            setElevationStats(calculateElevationStats(elevation));
            setSnapProgress(1.0);
            
            // Show success toast with confidence info
            const confidencePercent = Math.round(matchResult.confidence * 100);
            const profileText = matchResult.profile !== 'cycling' ? ` (${matchResult.profile})` : '';
            toast.success(`Route snapped with ${confidencePercent}% confidence${profileText}`);
          }
        }
      } catch (error) {
        console.error('Route snapping/elevation failed:', error);
        toast.error('Route snapping failed - check your internet connection');
        if (!cancelled) {
          setSnappedCoords([]);
          setRouteMetadata(null);
          setElevationProfile([]);
          setElevationStats(null);
        }
      } finally {
        if (!cancelled) {
          setSnapping(false);
        }
      }
    }
    
    // Debounce the snapping to avoid race conditions when user clicks rapidly
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        snapAndElevate();
      }
    }, 500); // Wait 500ms after last point addition
    
    return () => { 
      cancelled = true; 
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [points, useSnap]);

  // Custom drag handling: we track pointer on map
  React.useEffect(() => {
    if (!active || !mapRef?.current) return;
    const map = mapRef.current.getMap();
    function onMove(e) {
      if (dragIndex == null) return;
      const { lng, lat } = e.lngLat;
      setPoints(p => p.map((pt, i) => i === dragIndex ? [lng, lat] : pt));
    }
    function onUp() { if (dragIndex != null) setDragIndex(null); }
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    map.on('touchmove', onMove);
    map.on('touchend', onUp);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      map.off('touchmove', onMove);
      map.off('touchend', onUp);
    };
  }, [active, dragIndex, mapRef]);

  // Update map elements when inline mode (must be before early return)
  React.useEffect(() => {
    if (!active) return;
    
    if (inline && onMapElementsChange) {
      const mapElements = (
        <>
          {workingCoords.length >= 2 && (
            <Source id="draft-route" type="geojson" data={geojson}>
              <Layer
                id="draft-route-line"
                type="line"
                paint={(function(){
                  const paint = { 'line-color': useSnap ? '#0066ff' : '#ff8800', 'line-width': 4 };
                  if (!useSnap) paint['line-dasharray'] = [2,2];
                  return paint;
                })()}
              />
            </Source>
          )}

          {points.map((pt, i) => (
            <Marker
              key={i}
              longitude={pt[0]}
              latitude={pt[1]}
              anchor="center"
              draggable={false}
              onMouseDown={e => { e.originalEvent.stopPropagation(); setDragIndex(i); }}
              onTouchStart={e => { e.originalEvent.stopPropagation(); setDragIndex(i); }}
              onClick={e => { e.originalEvent.stopPropagation(); setShowWaypointPopup(i); }}
            >
              <div className={`builder-marker ${i===0 ? 'start' : i===points.length-1 ? 'end' : ''}`}/>
            </Marker>
          ))}

          {dragIndex != null && (
            <div style={{ display:'none' }}>{dragIndex}</div>
          )}

          {showWaypointPopup != null && points[showWaypointPopup] && (
            <Popup
              longitude={points[showWaypointPopup][0]}
              latitude={points[showWaypointPopup][1]}
              closeOnClick={false}
              onClose={() => setShowWaypointPopup(null)}
              anchor="top"
            >
              <div style={{ minWidth: 120 }}>
                <strong>Waypoint {showWaypointPopup + 1}</strong>
                <div style={{ display:'flex', gap:4, marginTop:6 }}>
                  <button style={{ flex:1 }} onClick={() => { removePoint(showWaypointPopup); setShowWaypointPopup(null); }}>Remove</button>
                </div>
              </div>
            </Popup>
          )}
        </>
      );
      
      onMapElementsChange(mapElements);
    }

    // Also send route data for elevation profile
    if (inline && onRouteDataChange) {
      const routeData = {
        elevationProfile,
        elevationStats,
        routeStats: {
          distance: distanceKm,
          confidence: routeMetadata?.confidence || 0,
          duration: routeMetadata?.duration || null
        }
      };
      onRouteDataChange(routeData);
    }
    
    return () => {
      if (inline && onMapElementsChange) {
        onMapElementsChange(null);
      }
      if (inline && onRouteDataChange) {
        onRouteDataChange(null);
      }
    };
  }, [active, inline, onMapElementsChange, onRouteDataChange, workingCoords, points, useSnap, geojson, dragIndex, showWaypointPopup, elevationProfile, elevationStats, distanceKm, routeMetadata]);

  if (!active) return null;

  const containerStyle = inline ? {
    // Inline mode - no absolute positioning
    width: '100%',
    marginBottom: 16
  } : {
    // Overlay mode - absolute positioning
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    minWidth: 300,
    maxWidth: 400,
  };

  // Split the component: UI goes in sidebar, map elements go in map
  const uiComponent = (
    <Paper
      shadow={inline ? "xs" : "lg"}
      p="md"
      style={containerStyle}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text fw={600} size="lg">Build Route</Text>
          {!inline && (
            <ActionIcon variant="subtle" color="red" onClick={onExit}>
              <X size={18} />
            </ActionIcon>
          )}
        </Group>

        <TextInput
          placeholder="Enter route name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          leftSection={<FileText size={16} />}
        />

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {formatDistance(distanceKm)} • {points.length} waypoints
          </Text>
          {elevationStats && (
            <Text size="xs" c="dimmed">
              ↗ {formatElevation(elevationStats.gain)} ↘ {formatElevation(elevationStats.loss)}
            </Text>
          )}
        </Group>

        <Checkbox
          label={
            <Group gap="xs">
              <Text size="sm">Snap to cycling network</Text>
              {routeMetadata?.confidence && (
                <Text size="xs" c="dimmed">
                  ({Math.round(routeMetadata.confidence * 100)}% confidence
                  {routeMetadata.profile && routeMetadata.profile !== 'cycling' && 
                    `, ${routeMetadata.profile}`})
                </Text>
              )}
            </Group>
          }
          checked={useSnap}
          onChange={(e) => setUseSnap(e.currentTarget.checked)}
          size="sm"
        />

        {snapping && (
          <Progress value={snapProgress * 100} size="sm" animated />
        )}

        <Stack gap="xs">
          <Button
            variant="light"
            leftSection={<Undo2 size={16} />}
            onClick={undo}
            disabled={points.length === 0}
            size="sm"
            fullWidth
          >
            Undo Last Point
          </Button>
          <Button
            variant="light"
            leftSection={<RotateCcw size={16} />}
            onClick={reverseRoute}
            disabled={points.length < 2}
            size="sm"
            fullWidth
          >
            Reverse Route
          </Button>
          <Button
            variant="light"
            color="red"
            leftSection={<Trash2 size={16} />}
            onClick={clearAll}
            disabled={points.length === 0}
            size="sm"
            fullWidth
          >
            Clear All Points
          </Button>
        </Stack>

        <Stack gap="xs">
          <Button
            leftSection={<Save size={16} />}
            onClick={saveRoute}
            disabled={!canSave}
            loading={saving}
            size="sm"
            fullWidth
          >
            Save Route
          </Button>
          <Button
            variant="light"
            leftSection={<Download size={16} />}
            onClick={exportGPX}
            disabled={points.length < 2}
            size="sm"
            fullWidth
          >
            Export GPX
          </Button>
        </Stack>

        {error && (
          <Alert icon={<AlertCircle size={16} />} color="red">
            {error}
          </Alert>
        )}

        <Text size="xs" c="dimmed">
          Click on map to add waypoints. Drag markers to reposition. Click markers to remove.
        </Text>
      </Stack>
    </Paper>
  );

  // Return only UI component for inline mode since map elements are handled by useEffect
  return uiComponent;
};

export default RouteBuilder;

import React, { useMemo } from 'react';
import { Map, Source, Layer, Marker } from 'react-map-gl';
import { Text, Center, Loader, Stack } from '@mantine/core';
import 'mapbox-gl/dist/mapbox-gl.css';

const RouteMap = ({ trackPoints, mapHeight = 400 }) => {
  // Calculate bounds from track points
  const { bounds, routeGeoJSON } = useMemo(() => {
    if (!trackPoints?.length) return { bounds: null, routeGeoJSON: null };

    const lats = trackPoints.map(p => p.lat);
    const lngs = trackPoints.map(p => p.lng);
    
    const bounds = [
      [Math.min(...lngs), Math.min(...lats)], // Southwest
      [Math.max(...lngs), Math.max(...lats)]  // Northeast
    ];

    const routeGeoJSON = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: trackPoints.map(point => [point.lng, point.lat])
      }
    };

    return { bounds, routeGeoJSON };
  }, [trackPoints]);

  // Route line layer style
  const routeLayer = {
    id: 'route',
    type: 'line',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': '#3b82f6',
      'line-width': 4
    }
  };

  if (!trackPoints?.length) {
    return (
      <Center style={{ height: mapHeight }}>
        <Stack align="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading route...</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <div style={{ width: '100%', height: mapHeight, borderRadius: '8px', overflow: 'hidden' }}>
      <Map
        mapboxAccessToken={process.env.REACT_APP_MAPBOX_TOKEN}
        initialViewState={{
          bounds: bounds,
          fitBoundsOptions: { padding: 20 }
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/outdoors-v12"
      >
        {/* Route line */}
        <Source id="route" type="geojson" data={routeGeoJSON}>
          <Layer {...routeLayer} />
        </Source>

        {/* Start marker (green) */}
        {trackPoints.length > 0 && (
          <Marker
            longitude={trackPoints[0].lng}
            latitude={trackPoints[0].lat}
            color="#10b981"
          />
        )}

        {/* End marker (red) */}
        {trackPoints.length > 1 && (
          <Marker
            longitude={trackPoints[trackPoints.length - 1].lng}
            latitude={trackPoints[trackPoints.length - 1].lat}
            color="#ef4444"
          />
        )}
      </Map>
    </div>
  );
};

export default RouteMap;
import React, { useState, useRef } from 'react';
import { Map, Source, Layer, Marker, NavigationControl } from 'react-map-gl';
import { buildLineString } from '../utils/geo';
import AIRouteGenerator from './AIRouteGenerator';
import 'mapbox-gl/dist/mapbox-gl.css';

const AIRouteMap = () => {
  const [viewState, setViewState] = useState({
    longitude: -0.09,
    latitude: 51.505,
    zoom: 13,
    pitch: 0,
    bearing: 0,
  });
  
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [startLocation, setStartLocation] = useState(null);
  const mapRef = useRef(null);

  const handleRouteGenerated = (route) => {
    console.log('Route generated with coordinates:', route.coordinates?.length || 0, 'points');
    setSelectedRoute(route);
    
    // If route has coordinates, fit map to show the entire route
    if (route.coordinates && route.coordinates.length > 0 && mapRef.current) {
      console.log('Fitting map to route bounds');
      const bounds = calculateBounds(route.coordinates);
      mapRef.current.fitBounds(bounds, {
        padding: { top: 50, bottom: 50, left: 50, right: 350 }, // Leave space for the sidebar
        duration: 1000
      });
    } else {
      console.log('No coordinates to display for route');
    }
  };

  const handleStartLocationSet = (location) => {
    setStartLocation(location);
  };

  // Calculate bounds for a set of coordinates
  const calculateBounds = (coordinates) => {
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    coordinates.forEach(([lng, lat]) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });

    return [[minLng, minLat], [maxLng, maxLat]];
  };

  return (
    <div style={{ display: 'flex', height: '100vh', gap: '1rem' }}>
      {/* AI Route Generator Panel */}
      <div style={{ width: '400px', overflowY: 'auto' }}>
        <AIRouteGenerator 
          mapRef={mapRef}
          onRouteGenerated={handleRouteGenerated}
          onStartLocationSet={handleStartLocationSet}
        />
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Map
          ref={mapRef}
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapboxAccessToken={process.env.REACT_APP_MAPBOX_TOKEN}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/outdoors-v12"
          interactiveLayerIds={[]}
        >
          <NavigationControl position="top-right" />
          
          {/* Display generated route */}
          {selectedRoute && selectedRoute.coordinates && selectedRoute.coordinates.length > 0 && (
            <Source 
              id="ai-generated-route" 
              type="geojson" 
              data={buildLineString(selectedRoute.coordinates)}
            >
              <Layer
                id="ai-route-line"
                type="line"
                paint={{
                  'line-color': '#228be6',
                  'line-width': 4,
                  'line-opacity': 0.8
                }}
              />
            </Source>
          )}
          
          {/* Display start location marker */}
          {startLocation && (
            <Marker
              longitude={startLocation[0]}
              latitude={startLocation[1]}
              anchor="center"
            >
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                backgroundColor: '#228be6',
                border: '3px solid white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }} />
            </Marker>
          )}
          
          {/* Display route start/end markers if route exists */}
          {selectedRoute && selectedRoute.coordinates && selectedRoute.coordinates.length > 0 && (
            <>
              {/* Start marker */}
              <Marker
                longitude={selectedRoute.coordinates[0][0]}
                latitude={selectedRoute.coordinates[0][1]}
                anchor="center"
              >
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  backgroundColor: '#40c057',
                  border: '2px solid white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                }} />
              </Marker>
              
              {/* End marker (if different from start) */}
              {selectedRoute.coordinates.length > 1 && (
                <Marker
                  longitude={selectedRoute.coordinates[selectedRoute.coordinates.length - 1][0]}
                  latitude={selectedRoute.coordinates[selectedRoute.coordinates.length - 1][1]}
                  anchor="center"
                >
                  <div style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: '#fa5252',
                    border: '2px solid white',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                  }} />
                </Marker>
              )}
            </>
          )}
        </Map>
      </div>
    </div>
  );
};

export default AIRouteMap;
import React, { useState, useEffect, useRef } from 'react';
import { Map, Source, Layer, Marker, Popup, NavigationControl } from 'react-map-gl';
import {
  Paper,
  Title,
  Button,
  ScrollArea,
  Card,
  Text,
  Group,
  Badge,
  Stack,
  Loader,
  Center,
  ActionIcon,
} from '@mantine/core';
import { Route, Plus, MapPin, Square } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabase';
import 'mapbox-gl/dist/mapbox-gl.css';
import './Map.css';
import RouteBuilder from './RouteBuilder';
import RouteProfile from './RouteProfile';

const MapComponent = () => {
  const { user } = useAuth();
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [viewState, setViewState] = useState({
    longitude: -0.09,
    latitude: 51.505,
    zoom: 13,
    pitch: 0,
    bearing: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  const [popupInfo, setPopupInfo] = useState(null);
  const [builderActive, setBuilderActive] = useState(false);
  const mapRef = useRef(null);
  const [refreshFlag, setRefreshFlag] = useState(0); // used to refetch after save
  const [selectedRouteData, setSelectedRouteData] = useState(null); // Full route data for profile

  // Center map at user current location if available and no stored routes yet
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    if (routes.length > 0) return; // don't override if user already has routes
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { longitude, latitude } = pos.coords;
        setViewState(s => ({ ...s, longitude, latitude, zoom: 13 }));
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [longitude, latitude], zoom: 13, essential: true });
        }
      },
      err => console.warn('Geolocation denied or failed', err),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [routes]);

  // Fetch user's routes from Supabase
  useEffect(() => {
    const fetchRoutes = async () => {
      try {
        const { data, error } = await supabase
          .from('routes')
          .select('*')
          .eq('user_id', user.id);

        if (error) throw error;
        setRoutes(data);

        // If routes exist, center map on the first route
        if (data.length > 0 && data[0].track_points?.length > 0) {
          const firstPoint = data[0].track_points[0];
          setViewState(state => ({
            ...state,
            longitude: firstPoint.longitude,
            latitude: firstPoint.latitude,
            zoom: 13
          }));
        }
      } catch (error) {
        console.error('Error fetching routes:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (user) {
      fetchRoutes();
    }
  }, [user, refreshFlag]);

  // Get route color based on index
  const getRouteColor = (index) => {
    const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
    return colors[index % colors.length];
  };

  return (
    <div className="map-container">
      <Paper className="routes-sidebar" shadow="sm" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Title order={3} size="h4">
              <Group gap="xs">
                <Route size={20} />
                Your Routes
              </Group>
            </Title>
          </Group>

          <Button
            variant={builderActive ? 'filled' : 'light'}
            leftSection={builderActive ? <Square size={16} /> : <Plus size={16} />}
            onClick={() => setBuilderActive(a => !a)}
            fullWidth
          >
            {builderActive ? 'Finish Building' : 'Build New Route'}
          </Button>

          <ScrollArea style={{ height: 'calc(100vh - 300px)' }}>
            {isLoading ? (
              <Center py="xl">
                <Loader size="sm" />
              </Center>
            ) : routes.length === 0 ? (
              <Center py="xl">
                <Text c="dimmed" size="sm" ta="center">
                  No routes yet. Start by building your first route!
                </Text>
              </Center>
            ) : (
              <Stack gap="xs">
                {routes.map((route, index) => (
                  <Card
                    key={route.id}
                    padding="sm"
                    shadow="xs"
                    style={{
                      cursor: 'pointer',
                      borderLeft: `4px solid ${getRouteColor(index)}`,
                      backgroundColor: selectedRoute === route.id ? 'var(--mantine-color-blue-0)' : undefined,
                    }}
                    onClick={() => {
                      setSelectedRoute(route.id);
                      setSelectedRouteData(route);
                      if (route.track_points?.length > 0) {
                        setViewState({
                          ...viewState,
                          longitude: route.track_points[0].longitude,
                          latitude: route.track_points[0].latitude,
                          zoom: 13
                        });
                      }
                    }}
                  >
                    <Stack gap="xs">
                      <Group justify="space-between" align="flex-start">
                        <Text fw={500} size="sm">
                          {route.metadata?.name || `Route ${index + 1}`}
                        </Text>
                        <ActionIcon size="xs" variant="subtle">
                          <MapPin size={12} />
                        </ActionIcon>
                      </Group>
                      
                      <Group gap="xs">
                        <Badge size="xs" variant="light">
                          {route.summary?.distance?.toFixed(1)} km
                        </Badge>
                        {route.summary?.snapped && (
                          <Badge size="xs" color="blue" variant="light">
                            Snapped
                          </Badge>
                        )}
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </ScrollArea>
        </Stack>
      </Paper>

      <div className="map-view">
        <Map
          ref={mapRef}
          initialViewState={viewState}
          onMove={evt => setViewState(evt.viewState)}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/streets-v11"
          mapboxAccessToken={process.env.REACT_APP_MAPBOX_TOKEN}
          attributionControl={true}
          reuseMaps
          className="map-inner"
        >
        <NavigationControl position="top-right" />
        <RouteBuilder
          active={builderActive}
          mapRef={mapRef}
          onExit={() => setBuilderActive(false)}
          onSaved={(newRoute) => {
            setBuilderActive(false);
            setRefreshFlag(f => f + 1);
            setSelectedRoute(newRoute.id);
          }}
        />
          {routes.map((route, index) => {
            if (!route.track_points?.length) return null;
            
            const geojson = {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: route.track_points.map(point => [point.longitude, point.latitude])
              }
            };

            return (
              <Source key={route.id} type="geojson" data={geojson}>
                <Layer
                  type="line"
                  paint={{
                    'line-color': getRouteColor(index),
                    'line-width': selectedRoute === route.id ? 6 : 3,
                    'line-opacity': selectedRoute === route.id ? 1 : 0.7
                  }}
                />
              </Source>
            );
          })}

          {selectedRoute && routes.find(r => r.id === selectedRoute)?.track_points?.length > 0 && (
            <>
              {[
                { point: routes.find(r => r.id === selectedRoute).track_points[0], label: 'Start' },
                { point: routes.find(r => r.id === selectedRoute).track_points.slice(-1)[0], label: 'End' }
              ].map((marker, i) => (
                <Marker
                  key={i}
                  longitude={marker.point.longitude}
                  latitude={marker.point.latitude}
                  onClick={e => {
                    e.originalEvent.stopPropagation();
                    setPopupInfo(marker);
                  }}
                />
              ))}
            </>
          )}

          {popupInfo && (
            <Popup
              longitude={popupInfo.point.longitude}
              latitude={popupInfo.point.latitude}
              anchor="bottom"
              onClose={() => setPopupInfo(null)}
            >
              {popupInfo.label}
            </Popup>
          )}
        </Map>
      </div>
      
      {selectedRouteData && (
        <RouteProfile 
          route={selectedRouteData}
          elevationProfile={selectedRouteData.elevation_profile}
          elevationStats={{
            gain: selectedRouteData.summary?.elevation_gain,
            loss: selectedRouteData.summary?.elevation_loss,
            min: selectedRouteData.summary?.elevation_min,
            max: selectedRouteData.summary?.elevation_max
          }}
        />
      )}
    </div>
  );
};

export default MapComponent;

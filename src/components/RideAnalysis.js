import React, { useState, useEffect, useMemo } from 'react';
import {
  Paper,
  Title,
  Group,
  Stack,
  Card,
  Text,
  SimpleGrid,
  ThemeIcon,
  Center,
  Loader,
  Select,
  ScrollArea,
  Badge,
  Modal,
  Button
} from '@mantine/core';
import {
  BarChart3,
  Route,
  MapPin,
  Mountain,
  Clock,
  TrendingUp,
  Filter,
  Map as MapIcon,
  Eye
} from 'lucide-react';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { useUnits } from '../utils/units';
import { supabase } from '../supabase';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, BarChart, Bar, ComposedChart, Tooltip, Legend } from 'recharts';
import toast from 'react-hot-toast';
import RouteMap from './RouteMap';
import ActivityHeatmap from './ActivityHeatmap';

const RideAnalysis = () => {
  const { user } = useAuth();
  const { formatDistance, formatElevation } = useUnits();
  const [routes, setRoutes] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState('all');
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [routeTrackPoints, setRouteTrackPoints] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('Fetching routes for user:', user.id);
        
        // Get routes from fresh schema
        const { data: routesData, error: routesError } = await supabase
          .from('routes')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (routesError) {
          console.error('Routes fetch error:', routesError);
          throw routesError;
        }

        console.log('Routes fetched:', routesData?.length);
        console.log('Sample route data:', routesData?.[0]);
        console.log('All routes:', routesData);

        // Get monthly stats from fresh schema view
        const { data: monthlyStats, error: monthlyError } = await supabase
          .from('monthly_stats')
          .select('*')
          .eq('user_id', user.id)
          .order('month', { ascending: false })
          .limit(12);

        if (monthlyError) {
          console.warn('Monthly stats fetch error:', monthlyError);
          // Continue without monthly data
        }

        setRoutes(routesData || []);
        setMonthlyData(monthlyStats || []);
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load ride data');
      } finally {
        setLoading(false);
      }
    };

    if (user) fetchData();
  }, [user]);

  // Load track points for map display
  const loadRouteTrackPoints = async (routeId) => {
    try {
      console.log('Loading track points for route:', routeId);
      
      // First, get the total count
      const { count, error: countError } = await supabase
        .from('track_points')
        .select('*', { count: 'exact', head: true })
        .eq('route_id', routeId);
        
      if (countError) throw countError;
      console.log('Total track points for route:', count);

      // Try to load all track points in batches if needed
      let allTrackPoints = [];
      let hasMoreData = true;
      let offset = 0;
      const batchSize = 1000;

      while (hasMoreData && allTrackPoints.length < 50000) { // Safety limit
        const { data: batch, error } = await supabase
          .from('track_points')
          .select('lat, lng, elevation, sequence_num')
          .eq('route_id', routeId)
          .order('sequence_num')
          .range(offset, offset + batchSize - 1);

        if (error) throw error;

        if (batch && batch.length > 0) {
          allTrackPoints = allTrackPoints.concat(batch);
          offset += batchSize;
          hasMoreData = batch.length === batchSize; // Continue if we got a full batch
        } else {
          hasMoreData = false;
        }
      }

      const data = allTrackPoints;

      console.log('Track points loaded:', data?.length, 'out of', count);
      
      // Debug: check the sequence numbers to see if we're getting the full range
      if (data && data.length > 0) {
        const sequences = data.map(p => p.sequence_num);
        console.log('Sequence range:', {
          min: Math.min(...sequences),
          max: Math.max(...sequences),
          first3: data.slice(0, 3),
          last3: data.slice(-3)
        });
      }
      
      setRouteTrackPoints(data || []);
      return data || [];
    } catch (error) {
      console.error('Error loading track points:', error);
      toast.error('Failed to load route details');
      return [];
    }
  };

  // Open map modal for a route
  const viewRouteOnMap = async (route) => {
    setSelectedRoute(route);
    setMapModalOpen(true);
    await loadRouteTrackPoints(route.id);
  };

  // Filter routes by time
  const filteredRoutes = routes.filter(route => {
    if (timeFilter === 'all') return true;
    
    const routeDate = new Date(route.created_at);
    const now = new Date();
    
    switch (timeFilter) {
      case '30d':
        return routeDate >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return routeDate >= new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case 'year':
        return routeDate >= new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default:
        return true;
    }
  });


  // Enhanced monthly data for charts
  const enhancedMonthlyData = useMemo(() => {
    if (!monthlyData.length) return [];
    
    return monthlyData.map((month, index) => ({
      ...month,
      month_short: dayjs(month.month).format('MMM YY'),
      trend: index > 0 ? month.total_distance - monthlyData[index - 1].total_distance : 0
    }));
  }, [monthlyData]);

  // Calculate stats from fresh schema columns
  const stats = {
    totalRoutes: filteredRoutes.length,
    totalDistance: filteredRoutes.reduce((sum, r) => sum + (r.distance_km || 0), 0),
    totalElevation: filteredRoutes.reduce((sum, r) => sum + (r.elevation_gain_m || 0), 0),
    totalTime: filteredRoutes.reduce((sum, r) => sum + (r.duration_seconds || 0), 0),
    avgDistance: filteredRoutes.length > 0 ? 
      filteredRoutes.reduce((sum, r) => sum + (r.distance_km || 0), 0) / filteredRoutes.length : 0,
    longestRide: Math.max(...filteredRoutes.map(r => r.distance_km || 0), 0)
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (loading) {
    return (
      <Center style={{ height: '50vh' }}>
        <Stack align="center">
          <Loader size="lg" />
          <Text c="dimmed">Loading your rides...</Text>
        </Stack>
      </Center>
    );
  }

  if (routes.length === 0) {
    return (
      <Center style={{ height: '50vh' }}>
        <Stack align="center">
          <BarChart3 size={48} color="gray" />
          <Title order={3}>No rides yet</Title>
          <Text c="dimmed">Upload some GPX files to see your analysis</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between">
        <div>
          <Title order={2}>
            <Group gap="sm">
              <BarChart3 size={28} />
              Ride Analysis
            </Group>
          </Title>
          <Text c="dimmed">Lightning-fast analytics from optimized database</Text>
        </div>
        
        <Select
          value={timeFilter}
          onChange={setTimeFilter}
          data={[
            { value: 'all', label: 'All time' },
            { value: '30d', label: 'Last 30 days' },
            { value: '90d', label: 'Last 90 days' },
            { value: 'year', label: 'Last year' }
          ]}
          leftSection={<Filter size={16} />}
        />
      </Group>

      {/* Key Metrics */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <Card padding="md" withBorder>
          <Group justify="space-between">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Rides</Text>
              <Text fw={700} size="xl">{stats.totalRoutes}</Text>
            </div>
            <ThemeIcon size={38} variant="light" color="blue">
              <Route size={20} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card padding="md" withBorder>
          <Group justify="space-between">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Distance</Text>
              <Text fw={700} size="xl">{formatDistance(stats.totalDistance)}</Text>
            </div>
            <ThemeIcon size={38} variant="light" color="green">
              <MapPin size={20} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card padding="md" withBorder>
          <Group justify="space-between">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Elevation</Text>
              <Text fw={700} size="xl">{formatElevation(stats.totalElevation)}</Text>
            </div>
            <ThemeIcon size={38} variant="light" color="orange">
              <Mountain size={20} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card padding="md" withBorder>
          <Group justify="space-between">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Time</Text>
              <Text fw={700} size="xl">{formatDuration(stats.totalTime)}</Text>
            </div>
            <ThemeIcon size={38} variant="light" color="violet">
              <Clock size={20} />
            </ThemeIcon>
          </Group>
        </Card>
      </SimpleGrid>

      {/* Enhanced Monthly Activity Chart */}
      {enhancedMonthlyData.length > 0 && (
        <Paper p="md" withBorder>
          <Title order={4} mb="md">Monthly Activity Trends</Title>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={enhancedMonthlyData}>
              <XAxis 
                dataKey="month_short"
                fontSize={12}
              />
              <YAxis 
                yAxisId="distance"
                tickFormatter={(value) => formatDistance(value)}
                fontSize={12}
              />
              <YAxis 
                yAxisId="trend" 
                orientation="right"
                tickFormatter={(value) => `${value > 0 ? '+' : ''}${formatDistance(value)}`}
                fontSize={12}
              />
              <Tooltip 
                formatter={(value, name) => [
                  name === 'total_distance' ? formatDistance(value) : formatDistance(value),
                  name === 'total_distance' ? 'Monthly Distance' : 'Trend'
                ]}
                labelFormatter={(label) => `Month: ${label}`}
              />
              <Legend />
              <Bar 
                yAxisId="distance"
                dataKey="total_distance" 
                fill="#228be6" 
                name="Monthly Distance"
                radius={[2, 2, 0, 0]}
              />
              <Line 
                yAxisId="trend"
                type="monotone" 
                dataKey="trend" 
                stroke="#fa5252" 
                strokeWidth={2}
                name="Trend"
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {/* Activity Heatmap */}
      <ActivityHeatmap routes={routes} formatDistance={formatDistance} />

      {/* Recent Rides */}
      <Paper p="md" withBorder>
        <Group justify="space-between" mb="md">
          <Title order={4}>Recent Rides</Title>
          <Badge variant="light">{filteredRoutes.length} routes</Badge>
        </Group>
        
        <ScrollArea style={{ height: 300 }}>
          <Stack gap="xs">
            {filteredRoutes.slice(0, 20).map((route) => (
              <Card key={route.id} padding="sm" withBorder>
                <Group justify="space-between">
                  <div>
                    <Text fw={500} size="sm">{route.name || 'Unnamed Route'}</Text>
                    <Text size="xs" c="dimmed">
                      {dayjs(route.created_at).format('MMM D, YYYY')}
                    </Text>
                  </div>
                  <Group gap="md">
                    <Text size="xs">{formatDistance(route.distance_km || 0)}</Text>
                    <Text size="xs">↗ {formatElevation(route.elevation_gain_m || 0)}</Text>
                    {route.duration_seconds && (
                      <Text size="xs">{formatDuration(route.duration_seconds)}</Text>
                    )}
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<Eye size={12} />}
                      onClick={() => viewRouteOnMap(route)}
                    >
                      Map
                    </Button>
                  </Group>
                </Group>
              </Card>
            ))}
          </Stack>
        </ScrollArea>
      </Paper>

      {/* Performance Info */}
      <Paper withBorder p="md" bg="blue.0">
        <Title order={5} mb="sm">⚡ Performance Optimized</Title>
        <Stack gap="xs">
          <Text size="sm">• Pre-calculated statistics for instant loading</Text>
          <Text size="sm">• Separated track data prevents timeout issues</Text>
          <Text size="sm">• Row Level Security ensures data privacy</Text>
          <Text size="sm">• Optimized indexes for fast queries</Text>
        </Stack>
      </Paper>

      {/* Route Map Modal */}
      <Modal
        opened={mapModalOpen}
        onClose={() => setMapModalOpen(false)}
        title={
          <Group gap="sm">
            <MapIcon size={20} />
            <div>
              <Text fw={500}>{selectedRoute?.name || 'Route Map'}</Text>
              <Text size="xs" c="dimmed">
                {selectedRoute && new Date(selectedRoute.created_at).toLocaleDateString()}
              </Text>
            </div>
          </Group>
        }
        size="xl"
        centered
      >
        {selectedRoute && (
          <Stack gap="md">
            {/* Route Stats */}
            <Group gap="lg">
              <Group gap="xs">
                <MapPin size={16} />
                <Text size="sm">{formatDistance(selectedRoute.distance_km || 0)}</Text>
              </Group>
              <Group gap="xs">
                <Mountain size={16} />
                <Text size="sm">↗ {formatElevation(selectedRoute.elevation_gain_m || 0)}</Text>
              </Group>
              {selectedRoute.duration_seconds && (
                <Group gap="xs">
                  <Clock size={16} />
                  <Text size="sm">{formatDuration(selectedRoute.duration_seconds)}</Text>
                </Group>
              )}
            </Group>
            
            {/* Map */}
            <RouteMap trackPoints={routeTrackPoints} mapHeight={500} />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default RideAnalysis;
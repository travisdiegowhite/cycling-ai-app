import React from 'react';
import {
  Paper,
  Title,
  Text,
  Group,
  Stack,
  Badge,
  Grid,
} from '@mantine/core';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { TrendingUp, TrendingDown, Mountain, MapPin } from 'lucide-react';

const RouteProfile = ({ route, elevationProfile, elevationStats }) => {
  if (!route) return null;

  const hasElevation = elevationProfile && elevationProfile.length > 0;

  return (
    <Paper shadow="sm" p="md" style={{ marginTop: 16 }}>
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={4}>
            <Group gap="xs">
              <Mountain size={20} />
              Route Profile
            </Group>
          </Title>
          <Text size="sm" c="dimmed">
            {route.metadata?.name || 'Unnamed Route'}
          </Text>
        </Group>

        <Grid>
          <Grid.Col span={6}>
            <Stack gap="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Distance
              </Text>
              <Text size="lg" fw={700}>
                {route.summary?.distance?.toFixed(1) || '0.0'} km
              </Text>
            </Stack>
          </Grid.Col>
          
          {hasElevation && elevationStats && (
            <>
              <Grid.Col span={3}>
                <Stack gap="xs">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    <Group gap={4}>
                      <TrendingUp size={12} />
                      Gain
                    </Group>
                  </Text>
                  <Text size="lg" fw={700} c="green">
                    {elevationStats.gain}m
                  </Text>
                </Stack>
              </Grid.Col>
              
              <Grid.Col span={3}>
                <Stack gap="xs">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    <Group gap={4}>
                      <TrendingDown size={12} />
                      Loss
                    </Group>
                  </Text>
                  <Text size="lg" fw={700} c="red">
                    {elevationStats.loss}m
                  </Text>
                </Stack>
              </Grid.Col>
            </>
          )}
        </Grid>

        {hasElevation ? (
          <div style={{ height: 200, width: '100%' }}>
            <ResponsiveContainer>
              <AreaChart data={elevationProfile}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="distance" 
                  tickFormatter={(value) => `${(value / 1000).toFixed(1)}km`}
                />
                <YAxis 
                  dataKey="elevation"
                  tickFormatter={(value) => `${value}m`}
                />
                <Tooltip 
                  formatter={(value, name) => [
                    name === 'elevation' ? `${Math.round(value)}m` : value,
                    name === 'elevation' ? 'Elevation' : name
                  ]}
                  labelFormatter={(value) => `Distance: ${(value / 1000).toFixed(2)}km`}
                />
                <Area
                  type="monotone"
                  dataKey="elevation"
                  stroke="#2196f3"
                  fill="#2196f3"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Paper p="xl" bg="gray.1">
            <Stack align="center" gap="xs">
              <Mountain size={32} color="gray" />
              <Text c="dimmed" ta="center">
                Elevation profile will be generated for snapped routes
              </Text>
            </Stack>
          </Paper>
        )}

        {route.summary?.snapped && (
          <Group gap="xs">
            <Badge color="blue" variant="light">
              <Group gap={4}>
                <MapPin size={12} />
                Snapped to cycling network
              </Group>
            </Badge>
            {route.summary?.confidence && (
              <Badge color="green" variant="light">
                {Math.round(route.summary.confidence * 100)}% confidence
              </Badge>
            )}
          </Group>
        )}
      </Stack>
    </Paper>
  );
};

export default RouteProfile;

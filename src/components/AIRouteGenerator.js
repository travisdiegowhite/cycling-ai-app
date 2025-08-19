import { useState, useCallback, useEffect } from 'react';
import {
  Paper,
  Text,
  Button,
  Group,
  Stack,
  Slider,
  Radio,
  Card,
  Badge,
  Grid,
  ActionIcon,
  Alert,
  Loader,
  Center,
} from '@mantine/core';
import {
  Brain,
  Wind,
  Sun,
  Moon,
  Route,
  Play,
  RotateCcw,
  Navigation,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { useUnits } from '../utils/units';
import { getWeatherData, getMockWeatherData } from '../utils/weather';
import { generateAIRoutes } from '../utils/aiRouteGenerator';
import { testORSIntegration } from '../utils/testORS';

const AIRouteGenerator = ({ mapRef, onRouteGenerated, onStartLocationSet }) => {
  const { user } = useAuth();
  const { formatDistance, formatElevation, formatTemperature, formatSpeed } = useUnits();
  
  // User inputs
  const [timeAvailable, setTimeAvailable] = useState(60); // minutes
  const [trainingGoal, setTrainingGoal] = useState('endurance');
  const [routeType, setRouteType] = useState('loop');
  const [startLocation, setStartLocation] = useState(null);
  
  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generatedRoutes, setGeneratedRoutes] = useState([]);
  const [weatherData, setWeatherData] = useState(null);
  const [error, setError] = useState(null);

  // Training goal options
  const trainingGoals = [
    { value: 'endurance', label: 'Endurance', icon: '🚴', description: 'Steady, sustained effort' },
    { value: 'intervals', label: 'Intervals', icon: '⚡', description: 'High intensity training' },
    { value: 'recovery', label: 'Recovery', icon: '😌', description: 'Easy, restorative ride' },
    { value: 'hills', label: 'Hill Training', icon: '⛰️', description: 'Climbing focused workout' },
  ];

  // Route type options
  const routeTypes = [
    { value: 'loop', label: 'Loop', description: 'Return to start point' },
    { value: 'out_back', label: 'Out & Back', description: 'Go out, return same way' },
    { value: 'point_to_point', label: 'Point-to-Point', description: 'End at different location' },
  ];

  // Fetch weather data when location is set
  const fetchWeatherData = async (location) => {
    if (!location) return;
    
    try {
      const weather = await getWeatherData(location[1], location[0]);
      if (weather) {
        setWeatherData(weather);
        toast.success(`Weather updated: ${formatTemperature(weather.temperature)}, ${weather.description}`);
      } else {
        // Use mock data as fallback
        setWeatherData(getMockWeatherData());
      }
    } catch (error) {
      console.warn('Weather fetch failed, using mock data:', error);
      setWeatherData(getMockWeatherData());
    }
  };

  // Get current location
  const getCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location = [position.coords.longitude, position.coords.latitude];
        setStartLocation(location);
        onStartLocationSet && onStartLocationSet(location);
        toast.success('Current location set as start point');
        
        // Fetch weather for this location
        await fetchWeatherData(location);
        
        // Center map on current location
        if (mapRef?.current) {
          mapRef.current.flyTo({
            center: location,
            zoom: 13,
            duration: 1000
          });
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        toast.error('Could not get current location');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [mapRef]);

  // Handle map click for start location
  useEffect(() => {
    if (!mapRef?.current) return;

    const map = mapRef.current.getMap();
    
    const handleMapClick = async (e) => {
      const { lng, lat } = e.lngLat;
      const location = [lng, lat];
      setStartLocation(location);
      onStartLocationSet && onStartLocationSet(location);
      toast.success('Start location set');
      
      // Fetch weather for clicked location
      await fetchWeatherData(location);
    };

    map.on('click', handleMapClick);
    return () => map.off('click', handleMapClick);
  }, [mapRef]);

  // Generate intelligent routes
  const generateRoutes = async () => {
    if (!startLocation) {
      toast.error('Please set a start location first');
      return;
    }

    setGenerating(true);
    setError(null);
    setGeneratedRoutes([]);

    try {
      console.log('🚀 Starting route generation...');
      console.log('Parameters:', { startLocation, timeAvailable, trainingGoal, routeType });
      console.log('Weather data:', weatherData);
      
      // Test ORS integration first
      console.log('🧪 Testing OpenRouteService integration...');
      const orsWorking = await testORSIntegration();
      
      if (!orsWorking) {
        toast.error('OpenRouteService not available. Using fallback routing.');
      }
      
      const routes = await generateAIRoutes({
        startLocation,
        timeAvailable,
        trainingGoal,
        routeType,
        weatherData,
        userId: user?.id,
      });
      
      console.log('🎯 Generated routes:', routes);

      setGeneratedRoutes(routes);
      
      if (routes.length > 0) {
        toast.success(`Generated ${routes.length} optimized route options!`);
      } else {
        toast.warning('No suitable routes found. Try adjusting your parameters.');
      }
    } catch (err) {
      console.error('Route generation error:', err);
      setError(err.message || 'Failed to generate routes');
      toast.error('Failed to generate routes');
    } finally {
      setGenerating(false);
    }
  };

  // Format time display
  const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  // Get time of day
  const getTimeOfDay = () => {
    const hour = new Date().getHours();
    if (hour < 6) return { label: 'Early Morning', icon: Moon };
    if (hour < 12) return { label: 'Morning', icon: Sun };
    if (hour < 18) return { label: 'Afternoon', icon: Sun };
    return { label: 'Evening', icon: Moon };
  };

  const timeOfDay = getTimeOfDay();

  return (
    <Paper shadow="sm" p="xl" radius="md">
      <Stack gap="lg">
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <Brain size={48} style={{ color: '#228be6', marginBottom: '1rem' }} />
          <Text size="xl" fw={600} mb="xs">
            AI Training Route Generator
          </Text>
          <Text size="sm" c="dimmed">
            Smart routes optimized for your training goals and conditions
          </Text>
        </div>

        {/* Current Conditions */}
        <Card withBorder p="sm" style={{ backgroundColor: '#f8f9fa' }}>
          <Group justify="space-between">
            <Group gap="xs">
              <timeOfDay.icon size={16} />
              <Text size="sm" fw={500}>{timeOfDay.label}</Text>
            </Group>
            {weatherData ? (
              <Group gap="md">
                <Group gap="xs">
                  <Text size="sm" fw={500}>{formatTemperature(weatherData.temperature)}</Text>
                </Group>
                <Group gap="xs">
                  <Wind size={16} />
                  <Text size="sm">
                    {formatSpeed(weatherData.windSpeed)} {weatherData.windDirection}
                  </Text>
                </Group>
              </Group>
            ) : (
              <Text size="xs" c="dimmed">Loading weather...</Text>
            )}
          </Group>
          {weatherData && (
            <Text size="xs" c="dimmed" mt="xs">
              {weatherData.description} • Humidity: {weatherData.humidity}%
            </Text>
          )}
        </Card>

        {/* Start Location */}
        <div>
          <Text size="sm" fw={500} mb="xs">Start Location</Text>
          <Group gap="sm">
            <Button
              variant="light"
              leftSection={<Navigation size={16} />}
              onClick={getCurrentLocation}
              size="sm"
            >
              Use Current Location
            </Button>
            {startLocation && (
              <Badge color="green" variant="light">
                Location Set
              </Badge>
            )}
          </Group>
          {!startLocation && (
            <Text size="xs" c="dimmed" mt="xs">
              Click on the map or use current location to set start point
            </Text>
          )}
        </div>

        {/* Time Available */}
        <div>
          <Text size="sm" fw={500} mb="xs">
            Time Available: {formatTime(timeAvailable)}
          </Text>
          <Slider
            value={timeAvailable}
            onChange={setTimeAvailable}
            min={15}
            max={240}
            step={15}
            marks={[
              { value: 30, label: '30m' },
              { value: 60, label: '1h' },
              { value: 120, label: '2h' },
              { value: 180, label: '3h' },
            ]}
            color="blue"
          />
        </div>

        {/* Training Goal */}
        <div>
          <Text size="sm" fw={500} mb="sm">Training Goal</Text>
          <Radio.Group value={trainingGoal} onChange={setTrainingGoal}>
            <Stack gap="xs">
              {trainingGoals.map((goal) => (
                <Card
                  key={goal.value}
                  withBorder
                  p="sm"
                  style={{
                    backgroundColor: trainingGoal === goal.value ? '#e7f5ff' : 'white',
                    border: trainingGoal === goal.value ? '2px solid #228be6' : '1px solid #dee2e6',
                    cursor: 'pointer'
                  }}
                  onClick={() => setTrainingGoal(goal.value)}
                >
                  <Group gap="sm">
                    <Radio value={goal.value} />
                    <Text size="lg">{goal.icon}</Text>
                    <div>
                      <Text size="sm" fw={500}>{goal.label}</Text>
                      <Text size="xs" c="dimmed">{goal.description}</Text>
                    </div>
                  </Group>
                </Card>
              ))}
            </Stack>
          </Radio.Group>
        </div>

        {/* Route Type */}
        <div>
          <Text size="sm" fw={500} mb="sm">Route Type</Text>
          <Radio.Group value={routeType} onChange={setRouteType}>
            <Grid>
              {routeTypes.map((type) => (
                <Grid.Col span={4} key={type.value}>
                  <Card
                    withBorder
                    p="sm"
                    style={{
                      backgroundColor: routeType === type.value ? '#e7f5ff' : 'white',
                      border: routeType === type.value ? '2px solid #228be6' : '1px solid #dee2e6',
                      cursor: 'pointer',
                      textAlign: 'center'
                    }}
                    onClick={() => setRouteType(type.value)}
                  >
                    <Stack gap="xs" align="center">
                      <Radio value={type.value} />
                      <Route size={20} />
                      <div>
                        <Text size="sm" fw={500}>{type.label}</Text>
                        <Text size="xs" c="dimmed">{type.description}</Text>
                      </div>
                    </Stack>
                  </Card>
                </Grid.Col>
              ))}
            </Grid>
          </Radio.Group>
        </div>

        {/* Generate Button */}
        <Button
          size="lg"
          leftSection={generating ? <Loader size={20} /> : <Brain size={20} />}
          onClick={generateRoutes}
          loading={generating}
          disabled={!startLocation || generating}
          fullWidth
        >
          {generating ? 'Generating Smart Routes...' : 'Generate AI Routes'}
        </Button>

        {/* Error Display */}
        {error && (
          <Alert color="red" title="Generation Failed">
            {error}
          </Alert>
        )}

        {/* Generated Routes */}
        {generatedRoutes.length > 0 && (
          <div>
            <Group justify="space-between" mb="sm">
              <Text size="sm" fw={500}>Generated Routes</Text>
              <ActionIcon
                variant="subtle"
                onClick={generateRoutes}
                disabled={generating}
              >
                <RotateCcw size={16} />
              </ActionIcon>
            </Group>
            
            <Stack gap="sm">
              {generatedRoutes.map((route, index) => (
                <Card key={index} withBorder p="md" style={{ cursor: 'pointer' }}>
                  <Group justify="space-between" align="flex-start">
                    <div style={{ flex: 1 }}>
                      <Group gap="sm" mb="xs">
                        <Text size="sm" fw={600}>{route.name}</Text>
                        <Badge size="sm" color={route.difficulty === 'easy' ? 'green' : route.difficulty === 'hard' ? 'red' : 'yellow'}>
                          {route.difficulty}
                        </Badge>
                      </Group>
                      
                      <Grid gutter="xs">
                        <Grid.Col span={6}>
                          <Text size="xs" c="dimmed">Distance</Text>
                          <Text size="sm" fw={500}>{formatDistance(route.distance)}</Text>
                        </Grid.Col>
                        <Grid.Col span={6}>
                          <Text size="xs" c="dimmed">Elevation</Text>
                          <Text size="sm" fw={500}>+{formatElevation(route.elevationGain)}</Text>
                        </Grid.Col>
                      </Grid>
                      
                      <Text size="xs" c="dimmed" mt="xs">
                        {route.description}
                      </Text>
                    </div>
                    
                    <Button
                      size="sm"
                      leftSection={<Play size={14} />}
                      onClick={() => onRouteGenerated && onRouteGenerated(route)}
                    >
                      Use Route
                    </Button>
                  </Group>
                </Card>
              ))}
            </Stack>
          </div>
        )}

        {/* No Routes Message */}
        {!generating && generatedRoutes.length === 0 && startLocation && (
          <Center p="xl">
            <Text size="sm" c="dimmed">
              Click "Generate AI Routes" to create personalized training routes
            </Text>
          </Center>
        )}
      </Stack>
    </Paper>
  );
};


export default AIRouteGenerator;
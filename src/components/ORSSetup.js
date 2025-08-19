import { useState, useEffect } from 'react';
import {
  Modal,
  Text,
  Button,
  Group,
  Stack,
  Alert,
  TextInput,
  Code,
  Anchor,
  List,
  Badge
} from '@mantine/core';
import { AlertCircle, CheckCircle, ExternalLink, Key } from 'lucide-react';
import { validateORSService } from '../utils/openRouteService';

const ORSSetup = ({ opened, onClose, onConfigured }) => {
  const [apiKey, setApiKey] = useState('');
  const [validationStatus, setValidationStatus] = useState(null);
  const [isValidating, setIsValidating] = useState(false);

  // Check if ORS is already configured
  useEffect(() => {
    if (opened) {
      checkCurrentConfig();
    }
  }, [opened]);

  const checkCurrentConfig = async () => {
    setIsValidating(true);
    const status = await validateORSService();
    setValidationStatus(status);
    setIsValidating(false);
  };

  const handleValidateKey = async () => {
    if (!apiKey.trim()) return;
    
    setIsValidating(true);
    
    // Temporarily set the key in localStorage for testing
    const originalKey = localStorage.getItem('ors_api_key');
    localStorage.setItem('ors_api_key', apiKey);
    
    // Override the environment variable check for testing
    const originalEnv = process.env.REACT_APP_ORS_API_KEY;
    process.env.REACT_APP_ORS_API_KEY = apiKey;
    
    const status = await validateORSService();
    
    // Restore original values
    if (originalKey) {
      localStorage.setItem('ors_api_key', originalKey);
    } else {
      localStorage.removeItem('ors_api_key');
    }
    process.env.REACT_APP_ORS_API_KEY = originalEnv;
    
    setValidationStatus(status);
    setIsValidating(false);
    
    if (status.available) {
      onConfigured && onConfigured(apiKey);
    }
  };

  const getStatusColor = () => {
    if (!validationStatus) return 'gray';
    return validationStatus.available ? 'green' : 'red';
  };

  const getStatusIcon = () => {
    if (!validationStatus) return <Key size={16} />;
    return validationStatus.available ? <CheckCircle size={16} /> : <AlertCircle size={16} />;
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="OpenStreetMap Route Setup"
      size="lg"
      centered
    >
      <Stack gap="md">
        <Alert
          icon={<AlertCircle size={16} />}
          title="Better Cycling Routes Available"
          color="blue"
        >
          <Text size="sm">
            We can provide much better cycling routes using OpenStreetMap data through OpenRouteService. 
            This will eliminate random geometric shapes and provide real cycling paths.
          </Text>
        </Alert>

        <div>
          <Text size="sm" fw={500} mb="xs">Benefits of OpenStreetMap routing:</Text>
          <List size="sm" spacing="xs">
            <List.Item>🚴 Cycling-specific route profiles (road, mountain, e-bike)</List.Item>
            <List.Item>🛤️ Prioritizes bike paths, bike lanes, and quiet roads</List.Item>
            <List.Item>🗺️ Uses real cycling infrastructure data</List.Item>
            <List.Item>🚫 No more random "pacman" shaped routes</List.Item>
            <List.Item>⚡ Fast and accurate route generation</List.Item>
          </List>
        </div>

        <div>
          <Text size="sm" fw={500} mb="xs">Setup Steps:</Text>
          <List size="sm" spacing="xs" type="ordered">
            <List.Item>
              Visit{' '}
              <Anchor 
                href="https://openrouteservice.org/dev/" 
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenRouteService Developer Portal <ExternalLink size={12} />
              </Anchor>
            </List.Item>
            <List.Item>Sign up for a free account (no credit card required)</List.Item>
            <List.Item>Get your API key (2000 free requests per day)</List.Item>
            <List.Item>Paste your API key below</List.Item>
          </List>
        </div>

        <TextInput
          label="OpenRouteService API Key"
          placeholder="5b3ce3597851110001cf6248..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          description="Your API key will be stored securely in your environment"
        />

        {validationStatus && (
          <Alert
            icon={getStatusIcon()}
            title={validationStatus.available ? 'Service Available' : 'Configuration Issue'}
            color={getStatusColor()}
          >
            <Text size="sm">
              {validationStatus.available 
                ? `OpenRouteService is working! Available profiles: ${validationStatus.profiles?.join(', ')}`
                : `${validationStatus.error}. ${validationStatus.instructions}`
              }
            </Text>
          </Alert>
        )}

        <div>
          <Text size="xs" c="dimmed" mb="xs">
            Add this to your .env file:
          </Text>
          <Code block>
            REACT_APP_ORS_API_KEY=your_api_key_here
          </Code>
        </div>

        <Group justify="space-between">
          <Badge variant="light" color="blue">
            Free: 2000 requests/day
          </Badge>
          
          <Group>
            <Button 
              variant="light" 
              onClick={onClose}
            >
              Skip for Now
            </Button>
            <Button 
              onClick={handleValidateKey}
              loading={isValidating}
              disabled={!apiKey.trim()}
            >
              Validate & Configure
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};

export default ORSSetup;
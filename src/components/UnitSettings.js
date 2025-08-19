import { useState } from 'react';
import {
  Modal,
  Text,
  Button,
  Group,
  Stack,
  Switch,
  Card,
  Divider,
  ActionIcon,
  Tooltip
} from '@mantine/core';
import { Settings, Ruler, Thermometer } from 'lucide-react';
import { useUnits } from '../utils/units';

const UnitSettings = () => {
  const [opened, setOpened] = useState(false);
  const {
    useImperial,
    setUseImperial,
    useFahrenheit,
    setUseFahrenheit,
    distanceUnit,
    elevationUnit,
    temperatureUnit,
    speedUnit
  } = useUnits();

  return (
    <>
      <Tooltip label="Unit Settings">
        <ActionIcon
          variant="subtle"
          onClick={() => setOpened(true)}
          size="lg"
        >
          <Settings size={20} />
        </ActionIcon>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Unit Preferences"
        centered
        size="sm"
      >
        <Stack gap="lg">
          <Card withBorder p="md">
            <Group justify="space-between" align="flex-start" mb="sm">
              <Group gap="sm">
                <Ruler size={20} color="#228be6" />
                <div>
                  <Text size="sm" fw={500}>Distance & Elevation</Text>
                  <Text size="xs" c="dimmed">
                    Currently: {distanceUnit} • {elevationUnit} • {speedUnit}
                  </Text>
                </div>
              </Group>
              <Switch
                checked={useImperial}
                onChange={(event) => setUseImperial(event.currentTarget.checked)}
                onLabel="Imperial"
                offLabel="Metric"
                size="md"
              />
            </Group>
            
            <Text size="xs" c="dimmed">
              Imperial: miles, feet, mph • Metric: kilometers, meters, km/h
            </Text>
          </Card>

          <Card withBorder p="md">
            <Group justify="space-between" align="flex-start" mb="sm">
              <Group gap="sm">
                <Thermometer size={20} color="#fa5252" />
                <div>
                  <Text size="sm" fw={500}>Temperature</Text>
                  <Text size="xs" c="dimmed">
                    Currently: {temperatureUnit}
                  </Text>
                </div>
              </Group>
              <Switch
                checked={useFahrenheit}
                onChange={(event) => setUseFahrenheit(event.currentTarget.checked)}
                onLabel="°F"
                offLabel="°C"
                size="md"
              />
            </Group>
            
            <Text size="xs" c="dimmed">
              Fahrenheit (°F) or Celsius (°C) for weather and temperature displays
            </Text>
          </Card>

          <Divider />

          <Group justify="flex-end">
            <Button variant="light" onClick={() => setOpened(false)}>
              Done
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export default UnitSettings;
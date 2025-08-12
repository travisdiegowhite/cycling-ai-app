import React from 'react';
import {
  AppShell,
  Container,
  Group,
  Button,
  Text,
  Avatar,
  Menu,
  UnstyledButton,
  Burger,
  Flex,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Map, Upload, User, LogOut, Route } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const AppLayout = ({ children, activePage, setActivePage }) => {
  const { user, signOut } = useAuth();
  const [opened, { toggle }] = useDisclosure();

  if (!user) {
    return (
      <Container size="sm" py={80}>
        {children}
      </Container>
    );
  }

  return (
    <AppShell
      header={{ height: 70 }}
      navbar={{
        width: 280,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Group gap="xs">
              <Route size={24} color="#2196f3" />
              <Text size="xl" fw={700} c="blue">
                Cycling AI
              </Text>
            </Group>
          </Group>

          <Menu shadow="md" width={200}>
            <Menu.Target>
              <UnstyledButton>
                <Group gap="xs">
                  <Avatar size={36} color="blue">
                    <User size={20} />
                  </Avatar>
                  <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500}>
                      {user.email?.split('@')[0] || 'User'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {user.email}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item leftSection={<LogOut size={16} />} onClick={signOut}>
                Sign out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Flex direction="column" gap="xs">
          <Button
            variant={activePage === 'upload' ? 'filled' : 'subtle'}
            leftSection={<Upload size={18} />}
            onClick={() => setActivePage('upload')}
            justify="flex-start"
            fullWidth
          >
            Upload Routes
          </Button>
          
          <Button
            variant={activePage === 'map' ? 'filled' : 'subtle'}
            leftSection={<Map size={18} />}
            onClick={() => setActivePage('map')}
            justify="flex-start"
            fullWidth
          >
            Route Builder
          </Button>
        </Flex>

        <Container mt="auto" p={0}>
          <Text size="xs" c="dimmed" ta="center">
            Built with React and powered by AI for smarter cycling experiences.
          </Text>
        </Container>
      </AppShell.Navbar>

      <AppShell.Main>
        {children}
      </AppShell.Main>
    </AppShell>
  );
};

export default AppLayout;

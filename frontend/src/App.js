// src/App.js
import React, { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Toaster } from 'react-hot-toast';
import FileUpload from './components/FileUpload';
import Auth from './components/Auth';
import Map from './components/Map';
import AppLayout from './components/AppLayout';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { theme } from './theme';
import './App.css';

const AppContent = () => {
  const { user } = useAuth();
  const [activePage, setActivePage] = useState('upload');

  const renderContent = () => {
    if (!user) return <Auth />;
    
    switch (activePage) {
      case 'map':
        return <Map />;
      case 'upload':
      default:
        return <FileUpload />;
    }
  };

  return (
    <AppLayout activePage={activePage} setActivePage={setActivePage}>
      {renderContent()}
    </AppLayout>
  );
};

function App() {
  return (
    <MantineProvider theme={theme}>
      <Notifications />
      <Toaster position="top-right" />
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </MantineProvider>
  );
}

export default App;
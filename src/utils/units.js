// Unit conversion utilities and preferences
import { useState, useEffect, createContext, useContext } from 'react';

// Unit conversion functions
export const convertDistance = {
  kmToMiles: (km) => km * 0.621371,
  milesToKm: (miles) => miles * 1.60934,
  mToFt: (meters) => meters * 3.28084,
  ftToM: (feet) => feet * 0.3048
};

export const convertTemperature = {
  cToF: (celsius) => (celsius * 9/5) + 32,
  fToC: (fahrenheit) => (fahrenheit - 32) * 5/9
};

export const convertSpeed = {
  kmhToMph: (kmh) => kmh * 0.621371,
  mphToKmh: (mph) => mph * 1.60934
};

// Format distance based on unit preference
export function formatDistance(kilometers, useImperial = true, precision = 1) {
  if (useImperial) {
    const miles = convertDistance.kmToMiles(kilometers);
    return `${miles.toFixed(precision)} mi`;
  }
  return `${kilometers.toFixed(precision)} km`;
}

// Format elevation based on unit preference
export function formatElevation(meters, useImperial = true, precision = 0) {
  if (useImperial) {
    const feet = convertDistance.mToFt(meters);
    return `${feet.toFixed(precision)} ft`;
  }
  return `${meters.toFixed(precision)} m`;
}

// Format temperature based on unit preference
export function formatTemperature(celsius, useFahrenheit = true, precision = 0) {
  if (useFahrenheit) {
    const fahrenheit = convertTemperature.cToF(celsius);
    return `${fahrenheit.toFixed(precision)}°F`;
  }
  return `${celsius.toFixed(precision)}°C`;
}

// Format speed based on unit preference
export function formatSpeed(kmh, useImperial = true, precision = 0) {
  if (useImperial) {
    const mph = convertSpeed.kmhToMph(kmh);
    return `${mph.toFixed(precision)} mph`;
  }
  return `${kmh.toFixed(precision)} km/h`;
}

// Unit preferences context
const UnitPreferencesContext = createContext();

export function UnitPreferencesProvider({ children }) {
  const [useImperial, setUseImperial] = useState(() => {
    const saved = localStorage.getItem('useImperial');
    return saved !== null ? JSON.parse(saved) : true; // Default to imperial
  });

  const [useFahrenheit, setUseFahrenheit] = useState(() => {
    const saved = localStorage.getItem('useFahrenheit');
    return saved !== null ? JSON.parse(saved) : true; // Default to Fahrenheit
  });

  useEffect(() => {
    localStorage.setItem('useImperial', JSON.stringify(useImperial));
  }, [useImperial]);

  useEffect(() => {
    localStorage.setItem('useFahrenheit', JSON.stringify(useFahrenheit));
  }, [useFahrenheit]);

  const formatDistanceWithPrefs = (kilometers, precision = 1) => 
    formatDistance(kilometers, useImperial, precision);

  const formatElevationWithPrefs = (meters, precision = 0) => 
    formatElevation(meters, useImperial, precision);

  const formatTemperatureWithPrefs = (celsius, precision = 0) => 
    formatTemperature(celsius, useFahrenheit, precision);

  const formatSpeedWithPrefs = (kmh, precision = 0) => 
    formatSpeed(kmh, useImperial, precision);

  const value = {
    useImperial,
    setUseImperial,
    useFahrenheit,
    setUseFahrenheit,
    formatDistance: formatDistanceWithPrefs,
    formatElevation: formatElevationWithPrefs,
    formatTemperature: formatTemperatureWithPrefs,
    formatSpeed: formatSpeedWithPrefs,
    distanceUnit: useImperial ? 'mi' : 'km',
    elevationUnit: useImperial ? 'ft' : 'm',
    temperatureUnit: useFahrenheit ? '°F' : '°C',
    speedUnit: useImperial ? 'mph' : 'km/h'
  };

  return (
    <UnitPreferencesContext.Provider value={value}>
      {children}
    </UnitPreferencesContext.Provider>
  );
}

export function useUnits() {
  const context = useContext(UnitPreferencesContext);
  if (!context) {
    throw new Error('useUnits must be used within a UnitPreferencesProvider');
  }
  return context;
}

// Standalone functions for components that don't use the context
export const unitUtils = {
  formatDistance,
  formatElevation,
  formatTemperature,
  formatSpeed,
  convertDistance,
  convertTemperature,
  convertSpeed
};
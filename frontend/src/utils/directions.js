// Advanced route generation using Mapbox Map Matching API
// This provides more intelligent route snapping and better performance

// Map Matching API for better route snapping
export async function mapMatchRoute(waypoints, accessToken, options = {}) {
  if (waypoints.length < 2) {
    return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0, profile: 'none' };
  }
  
  const {
    profile = 'cycling',
    radiuses = waypoints.map(() => 50), // Maximum allowed radius is 50m
    annotations = 'distance,duration',
    overview = 'full',
    geometries = 'geojson'
  } = options;

  // Format coordinates for the API
  const coordinates = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const radiusStr = radiuses.join(';');
  
  const url = `https://api.mapbox.com/matching/v5/mapbox/${profile}/${coordinates}?` +
    `geometries=${geometries}&` +
    `radiuses=${radiusStr}&` +
    `steps=false&` +
    `annotations=${annotations}&` +
    `overview=${overview}&` +
    `access_token=${accessToken}`;

  console.log('Map Matching URL:', url); // Debug

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Map Matching API error: ${response.status} ${response.statusText}`);
      return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0, profile: 'failed' };
    }
    
    const data = await response.json();
    console.log('Map Matching response:', data); // Debug
    
    if (!data.matchings || !data.matchings.length) {
      console.warn('No matchings found in response');
      return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0, profile: 'no-match' };
    }

    const matching = data.matchings[0];
    console.log('Using matching with confidence:', matching.confidence);
    
    return {
      coordinates: matching.geometry.coordinates,
      distance: matching.distance || 0,
      duration: matching.duration || 0,
      confidence: matching.confidence || 0,
      profile: profile
    };
  } catch (error) {
    console.error('Map Matching request failed:', error);
    return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0, profile: 'error' };
  }
}

// Elevation fetching using Mapbox Terrain-RGB tiles
export async function fetchElevationProfile(coordinates, accessToken) {
  if (!coordinates || coordinates.length < 2) return [];
  
  try {
    // Sample points along the route (max 100 points for performance)
    const maxPoints = 100;
    const step = Math.max(1, Math.floor(coordinates.length / maxPoints));
    const sampledCoords = coordinates.filter((_, i) => i % step === 0);
    
    // Add the last point if it wasn't included
    if (sampledCoords[sampledCoords.length - 1] !== coordinates[coordinates.length - 1]) {
      sampledCoords.push(coordinates[coordinates.length - 1]);
    }

    const elevationPromises = sampledCoords.map(async ([lon, lat], index) => {
      // Use Mapbox Terrain-RGB API for elevation data
      // const zoom = 14; // Good balance of accuracy and performance
      // const scale = Math.pow(2, zoom);
      // const x = Math.floor((lon + 180) / 360 * scale);
      // const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale);
      
      // const tileUrl = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${x}/${y}@2x.pngraw?access_token=${accessToken}`;
      
      try {
        // This is a simplified approach - in a real app, you'd decode the RGB values to get elevation
        // For now, we'll simulate elevation data based on coordinates
        const elevation = await simulateElevation(lat, lon);
        
        return {
          coordinate: [lon, lat],
          elevation,
          distance: index * (coordinates.length / sampledCoords.length) * 10 // Approximate distance
        };
      } catch (err) {
        console.warn(`Failed to fetch elevation for point ${index}:`, err);
        return {
          coordinate: [lon, lat],
          elevation: 0,
          distance: index * (coordinates.length / sampledCoords.length) * 10
        };
      }
    });

    return await Promise.all(elevationPromises);
  } catch (error) {
    console.error('Elevation profile fetch failed:', error);
    return [];
  }
}

// Simulate elevation data (replace with actual terrain RGB decoding in production)
async function simulateElevation(lat, lon) {
  // Simple elevation simulation based on latitude and some randomness
  // In production, this would decode actual Terrain-RGB tile data
  const baseElevation = Math.abs(lat) * 10; // Higher latitudes = higher elevation (very rough)
  const variation = Math.sin(lon * 0.1) * Math.cos(lat * 0.1) * 50;
  const randomness = (Math.random() - 0.5) * 20;
  
  return Math.max(0, baseElevation + variation + randomness);
}

// Calculate elevation statistics
export function calculateElevationStats(elevationProfile) {
  if (!elevationProfile || elevationProfile.length < 2) {
    return { gain: 0, loss: 0, min: 0, max: 0 };
  }

  let gain = 0;
  let loss = 0;
  let min = elevationProfile[0].elevation;
  let max = elevationProfile[0].elevation;

  for (let i = 1; i < elevationProfile.length; i++) {
    const prev = elevationProfile[i - 1].elevation;
    const curr = elevationProfile[i].elevation;
    const diff = curr - prev;

    if (diff > 0) gain += diff;
    if (diff < 0) loss += Math.abs(diff);
    
    min = Math.min(min, curr);
    max = Math.max(max, curr);
  }

  return { gain: Math.round(gain), loss: Math.round(loss), min: Math.round(min), max: Math.round(max) };
}

// Legacy functions for backward compatibility
export async function fetchCyclingSegment(start, end, accessToken) {
  const result = await mapMatchRoute([start, end], accessToken);
  return result.coordinates || null;
}

export async function buildSnappedRoute(waypoints, accessToken, onProgress) {
  if (waypoints.length < 2) return [...waypoints];
  
  onProgress && onProgress(0.1);
  const result = await mapMatchRoute(waypoints, accessToken);
  onProgress && onProgress(1.0);
  
  return result.coordinates || waypoints;
}

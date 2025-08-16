// Advanced route generation using Mapbox Map Matching API
// This provides more intelligent route snapping and better performance

// Map Matching API with intelligent radius fallback for better route snapping
export async function mapMatchRoute(waypoints, accessToken, options = {}) {
  console.log(`🔧 mapMatchRoute called with ${waypoints.length} waypoints`);
  
  if (waypoints.length < 2) {
    return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0, profile: 'none' };
  }
  
  // Mapbox Map Matching API has a limit of 100 waypoints
  if (waypoints.length > 100) {
    console.warn(`Too many waypoints (${waypoints.length}), truncating to 100`);
    waypoints = waypoints.slice(0, 100);
  }
  
  const {
    profile = 'cycling',
    annotations = 'distance,duration',
    overview = 'full',
    geometries = 'geojson'
  } = options;

  // Try different radius sizes for better cycling route matching
  // Add larger radius for routes with many waypoints
  const radiusSizes = waypoints.length > 5 ? [15, 25, 50, 100] : [15, 25, 50];
  
  for (const radius of radiusSizes) {
    console.log(`Trying map matching with ${radius}m radius...`);
    
    const radiuses = waypoints.map(() => radius);
    const coordinates = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
    const radiusStr = radiuses.join(';');
    
    const url = `https://api.mapbox.com/matching/v5/mapbox/${profile}/${coordinates}?` +
      `geometries=${geometries}&` +
      `radiuses=${radiusStr}&` +
      `steps=false&` +
      `annotations=${annotations}&` +
      `overview=${overview}&` +
      `access_token=${accessToken}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Map Matching API error with ${radius}m radius: ${response.status} ${response.statusText}`);
        continue; // Try next radius
      }
      
      const data = await response.json();
      
      if (!data.matchings || !data.matchings.length) {
        console.warn(`No matchings found with ${radius}m radius`);
        continue; // Try next radius
      }

      const matching = data.matchings[0];
      console.log(`✅ Map matching successful with ${radius}m radius, confidence: ${matching.confidence}, coords: ${matching.geometry.coordinates.length}/${waypoints.length}`);
      
      // Accept the match if confidence is reasonable or if we have good coordinate expansion
      // Lower confidence threshold for routes with more waypoints since they're naturally harder to match
      const minConfidence = waypoints.length > 4 ? 0.15 : 0.25;
      if (matching.confidence > minConfidence || matching.geometry.coordinates.length > waypoints.length * 1.5) {
        return {
          coordinates: matching.geometry.coordinates,
          distance: matching.distance || 0,
          duration: matching.duration || 0,
          confidence: matching.confidence || 0,
          profile: profile,
          radius: radius
        };
      } else {
        console.warn(`Low confidence (${matching.confidence} < ${minConfidence}) with ${radius}m radius, trying larger radius...`);
      }
    } catch (error) {
      console.warn(`Map Matching request failed with ${radius}m radius:`, error);
      continue; // Try next radius
    }
  }
  
  // If all radius sizes failed, fall back to Directions API
  console.log('All map matching attempts failed, falling back to Directions API...');
  return await getCyclingDirections(waypoints, accessToken, { profile });
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

/**
 * Simulates elevation data for a given latitude and longitude.
 * 
 * This function is used as a placeholder for elevation data when actual Mapbox Terrain-RGB decoding
 * is not implemented or available (e.g., during development or testing). In production, replace this
 * function with one that fetches and decodes real elevation data from Mapbox Terrain-RGB tiles.
 * 
 * @param {number} lat - Latitude of the point.
 * @param {number} lon - Longitude of the point.
 * @returns {Promise<number>} Simulated elevation value in meters.
 */
async function simulateElevation(lat, lon) {
  // Simple elevation simulation based on latitude and some randomness
  // TODO: In production, implement decoding of actual Terrain-RGB tile data here
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

// Get cycling directions between points using Directions API
export async function getCyclingDirections(waypoints, accessToken, options = {}) {
  if (waypoints.length < 2) {
    return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0 };
  }

  const {
    profile = 'cycling', // Use cycling profile for bike-friendly routes
    alternatives = false,
    steps = false,
    geometries = 'geojson',
    overview = 'full'
  } = options;

  // Format coordinates for the API
  const coordinates = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}?` +
    `alternatives=${alternatives}&` +
    `geometries=${geometries}&` +
    `overview=${overview}&` +
    `steps=${steps}&` +
    `access_token=${accessToken}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Directions API error: ${response.status} ${response.statusText}`);
      return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0 };
    }
    
    const data = await response.json();
    
    if (!data.routes || !data.routes.length) {
      console.warn('No routes found in directions response');
      return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0 };
    }

    const route = data.routes[0];
    
    return {
      coordinates: route.geometry.coordinates,
      distance: route.distance || 0,
      duration: route.duration || 0,
      confidence: 0.9, // Directions API generally has high confidence
      profile: profile
    };
  } catch (error) {
    console.error('Directions request failed:', error);
    return { coordinates: waypoints, distance: 0, duration: 0, confidence: 0 };
  }
}

export async function buildSnappedRoute(waypoints, accessToken, onProgress) {
  if (waypoints.length < 2) return [...waypoints];
  
  onProgress && onProgress(0.1);
  
  // Try Directions API first for better cycling routes
  let result = await getCyclingDirections(waypoints, accessToken);
  
  // If directions fails or has low confidence, fall back to map matching
  if (!result.coordinates || result.coordinates.length < 2 || result.confidence < 0.5) {
    console.log('Falling back to map matching for route snapping');
    result = await mapMatchRoute(waypoints, accessToken);
  }
  
  onProgress && onProgress(1.0);
  
  return result.coordinates || waypoints;
}

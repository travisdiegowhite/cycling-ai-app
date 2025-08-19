// OpenRouteService integration for cycling routes
// Uses OpenStreetMap data with cycling-specific routing

// Use CORS proxy for development (remove in production)
const ORS_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'https://cors-anywhere.herokuapp.com/https://api.openrouteservice.org/v2'
  : 'https://api.openrouteservice.org/v2';

// Cycling profiles available in OpenRouteService
export const CYCLING_PROFILES = {
  REGULAR: 'cycling-regular',     // General cycling (bike paths, quiet roads)
  ROAD: 'cycling-road',          // Road cycling (optimized for road bikes)
  MOUNTAIN: 'cycling-mountain',   // Mountain biking (trails, off-road)
  ELECTRIC: 'cycling-electric'    // E-bike (can handle steeper hills)
};

// Get OpenRouteService API key from environment
const getORSApiKey = () => {
  const key = process.env.REACT_APP_ORS_API_KEY || process.env.REACT_APP_OPENROUTE_API_KEY;
  console.log('ORS API Key found:', key ? `${key.substring(0, 10)}...` : 'NO KEY');
  return key;
};

// Get cycling directions using OpenRouteService
export async function getORSCyclingDirections(coordinates, options = {}) {
  const apiKey = getORSApiKey();
  
  if (!apiKey) {
    console.warn('OpenRouteService API key not found. Get one free at https://openrouteservice.org/dev/');
    return null;
  }

  const {
    profile = CYCLING_PROFILES.REGULAR,
    alternatives = false,
    elevation = true,
    instructions = false,
    geometryFormat = 'geojson'
  } = options;

  // Format coordinates for ORS API [[lon,lat], [lon,lat], ...]
  const formattedCoords = coordinates.map(coord => {
    // Handle both [lon,lat] and [lat,lon] formats
    return Array.isArray(coord) ? coord : [coord.longitude, coord.latitude];
  });

  const requestBody = {
    coordinates: formattedCoords,
    format: 'json',
    profile: profile,
    geometry_format: geometryFormat,
    elevation: elevation,
    instructions: instructions,
    alternative_routes: alternatives ? { target_count: 2 } : undefined
  };

  try {
    console.log(`Requesting ORS cycling route with profile: ${profile}`);
    
    const response = await fetch(`${ORS_BASE_URL}/directions/${profile}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
        'Authorization': apiKey,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ORS API error: ${response.status} ${response.statusText}`, errorText);
      return null;
    }

    const data = await response.json();
    
    if (!data.routes || data.routes.length === 0) {
      console.warn('No routes found in ORS response');
      return null;
    }

    const route = data.routes[0];
    const summary = route.summary;
    
    return {
      coordinates: route.geometry.coordinates,
      distance: summary.distance, // meters
      duration: summary.duration, // seconds
      elevation: {
        ascent: route.segments?.[0]?.ascent || 0,
        descent: route.segments?.[0]?.descent || 0
      },
      confidence: 0.9, // ORS generally has high confidence for cycling
      profile: profile,
      source: 'openrouteservice',
      bbox: data.bbox,
      warnings: data.warnings || []
    };

  } catch (error) {
    console.error('ORS request failed:', error);
    return null;
  }
}

// Generate cycling routes using ORS isochrone for area coverage
export async function generateORSAreaRoutes(centerPoint, timeMinutes, profile = CYCLING_PROFILES.REGULAR) {
  const apiKey = getORSApiKey();
  
  if (!apiKey) {
    console.warn('OpenRouteService API key required for isochrone generation');
    return null;
  }

  const requestBody = {
    locations: [centerPoint], // [lon, lat]
    profile: profile,
    range: [timeMinutes * 60], // Convert minutes to seconds
    range_type: 'time',
    interval: Math.floor(timeMinutes * 60 / 3), // 3 intervals
    location_type: 'start'
  };

  try {
    const response = await fetch(`${ORS_BASE_URL}/isochrones/${profile}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.error(`ORS Isochrone API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error('ORS isochrone request failed:', error);
    return null;
  }
}

// Get points of interest along cycling routes
export async function getORSCyclingPOIs(boundingBox, categories = ['tourism', 'sustenance']) {
  const apiKey = getORSApiKey();
  
  if (!apiKey) return null;

  try {
    const response = await fetch(`${ORS_BASE_URL}/pois`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        request: 'pois',
        geometry: {
          bbox: boundingBox, // [minLon, minLat, maxLon, maxLat]
          geojson: {
            type: 'Polygon',
            coordinates: [[
              [boundingBox[0], boundingBox[1]],
              [boundingBox[2], boundingBox[1]],
              [boundingBox[2], boundingBox[3]],
              [boundingBox[0], boundingBox[3]],
              [boundingBox[0], boundingBox[1]]
            ]]
          }
        },
        filters: {
          category_ids: categories
        }
      })
    });

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.warn('Failed to fetch POIs:', error);
  }
  
  return null;
}

// Select appropriate cycling profile based on training goal and route type
export function selectCyclingProfile(trainingGoal, routeType = 'road') {
  switch (trainingGoal) {
    case 'hills':
    case 'intervals':
      return CYCLING_PROFILES.ROAD; // Road profile handles climbs well
    
    case 'recovery':
      return CYCLING_PROFILES.REGULAR; // Prioritizes bike paths and quiet roads
    
    case 'endurance':
      return routeType === 'gravel' ? CYCLING_PROFILES.MOUNTAIN : CYCLING_PROFILES.ROAD;
    
    default:
      return CYCLING_PROFILES.REGULAR;
  }
}

// Enhanced route generation using ORS cycling intelligence
export async function generateORSCyclingRoute(startCoord, endCoord, options = {}) {
  const {
    trainingGoal = 'endurance',
    routeType = 'road',
    avoidHighways = true,
    preferCyclePaths = true
  } = options;

  const profile = selectCyclingProfile(trainingGoal, routeType);
  
  const routeOptions = {
    profile,
    elevation: true,
    alternatives: true, // Get alternative routes for variety
    instructions: false
  };

  // Add cycling-specific preferences
  if (profile === CYCLING_PROFILES.REGULAR || profile === CYCLING_PROFILES.ROAD) {
    // These profiles already optimize for cycling infrastructure
    routeOptions.avoid_features = avoidHighways ? ['highways'] : [];
  }

  const route = await getORSCyclingDirections([startCoord, endCoord], routeOptions);
  
  if (route) {
    return {
      ...route,
      cyclingOptimized: true,
      avoidedHighways: avoidHighways,
      preferredCyclePaths: preferCyclePaths
    };
  }

  return null;
}

// Validate that ORS service is available
export async function validateORSService() {
  const apiKey = getORSApiKey();
  
  if (!apiKey) {
    return {
      available: false,
      error: 'API key not configured',
      instructions: 'Get a free API key at https://openrouteservice.org/dev/',
      details: 'No REACT_APP_ORS_API_KEY found in environment'
    };
  }

  console.log('Testing ORS with API key:', `${apiKey.substring(0, 15)}...`);

  try {
    // Test with a simple request using both possible authentication methods
    const testCoordinates = [[-0.09, 51.505], [-0.08, 51.515]]; // Simple London test route
    
    // Method 1: Authorization header
    console.log('Trying Authorization header method...');
    let response = await fetch(`${ORS_BASE_URL}/directions/${CYCLING_PROFILES.REGULAR}`, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        coordinates: testCoordinates,
        format: 'json'
      })
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (response.ok) {
      const data = await response.json();
      console.log('✅ ORS validation successful with Authorization header');
      return { 
        available: true, 
        profiles: Object.values(CYCLING_PROFILES),
        method: 'authorization_header',
        response: data
      };
    }

    // Method 2: Query parameter (alternative)
    console.log('Authorization header failed, trying query parameter...');
    const errorText = await response.text();
    console.log('Error response:', errorText);
    
    response = await fetch(`${ORS_BASE_URL}/directions/${CYCLING_PROFILES.REGULAR}?api_key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        coordinates: testCoordinates,
        format: 'json'
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ ORS validation successful with query parameter');
      return { 
        available: true, 
        profiles: Object.values(CYCLING_PROFILES),
        method: 'query_parameter',
        response: data
      };
    }

    // Both methods failed
    const finalErrorText = await response.text();
    console.error('❌ Both authentication methods failed');
    console.error('Final error:', finalErrorText);
    
    return { 
      available: false, 
      error: `API returned ${response.status}: ${finalErrorText}`,
      instructions: 'Check your API key and quota at https://openrouteservice.org/dev/',
      details: {
        status: response.status,
        response: finalErrorText,
        apiKeyPrefix: `${apiKey.substring(0, 15)}...`
      }
    };

  } catch (error) {
    console.error('❌ ORS validation network error:', error);
    return { 
      available: false, 
      error: `Network error: ${error.message}`,
      instructions: 'Check your internet connection and CORS settings',
      details: {
        errorType: error.name,
        stack: error.stack
      }
    };
  }
}
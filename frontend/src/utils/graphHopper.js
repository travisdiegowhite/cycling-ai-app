// GraphHopper integration for cycling routes
// Better CORS support than OpenRouteService for browser applications

const GRAPHHOPPER_BASE_URL = 'https://graphhopper.com/api/1';

// GraphHopper cycling profiles
export const GRAPHHOPPER_PROFILES = {
  BIKE: 'bike',                    // Standard cycling
  RACINGBIKE: 'racingbike',       // Road cycling optimized  
  MOUNTAINBIKE: 'mtb',            // Mountain biking
  FOOT: 'foot'                     // Walking/hiking
};

// Get GraphHopper API key
const getGraphHopperApiKey = () => {
  return process.env.REACT_APP_GRAPHHOPPER_API_KEY;
};

// Get cycling directions using GraphHopper
export async function getGraphHopperCyclingDirections(coordinates, options = {}) {
  const apiKey = getGraphHopperApiKey();
  
  if (!apiKey) {
    console.warn('GraphHopper API key not found. Get one free at https://www.graphhopper.com/');
    return null;
  }

  const {
    profile = GRAPHHOPPER_PROFILES.BIKE,
    alternatives = false,
    elevation = true,
    instructions = false,
    calcPoints = true
  } = options;

  // Format coordinates: lat,lon|lat,lon|...
  const points = coordinates.map(coord => `${coord[1]},${coord[0]}`).join('|');
  
  const params = new URLSearchParams({
    key: apiKey,
    vehicle: profile,
    points_encoded: 'false',
    calc_points: calcPoints,
    instructions: instructions,
    elevation: elevation,
    optimize: 'false'
  });

  const url = `${GRAPHHOPPER_BASE_URL}/route?${params}&point=${points.replace(/\|/g, '&point=')}`;

  try {
    console.log(`Requesting GraphHopper cycling route with profile: ${profile}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GraphHopper API error: ${response.status} ${response.statusText}`, errorText);
      return null;
    }

    const data = await response.json();
    
    if (!data.paths || data.paths.length === 0) {
      console.warn('No routes found in GraphHopper response');
      return null;
    }

    const route = data.paths[0];
    
    return {
      coordinates: route.points.coordinates, // GeoJSON format
      distance: route.distance, // meters
      duration: route.time, // milliseconds  
      elevation: {
        ascent: route.ascent || 0,
        descent: route.descent || 0
      },
      confidence: 0.9, // GraphHopper generally has high confidence
      profile: profile,
      source: 'graphhopper',
      bbox: data.bbox,
      instructions: route.instructions || []
    };

  } catch (error) {
    console.error('GraphHopper request failed:', error);
    return null;
  }
}

// Select appropriate cycling profile based on training goal
export function selectGraphHopperProfile(trainingGoal) {
  switch (trainingGoal) {
    case 'hills':
    case 'intervals':
      return GRAPHHOPPER_PROFILES.RACINGBIKE; // Road bike profile
    
    case 'recovery':
      return GRAPHHOPPER_PROFILES.BIKE; // Standard bike (quieter roads)
    
    case 'endurance':
      return GRAPHHOPPER_PROFILES.RACINGBIKE; // Road optimized
    
    default:
      return GRAPHHOPPER_PROFILES.BIKE;
  }
}

// Validate GraphHopper service
export async function validateGraphHopperService() {
  const apiKey = getGraphHopperApiKey();
  
  if (!apiKey) {
    return {
      available: false,
      error: 'API key not configured',
      instructions: 'Get a free API key at https://www.graphhopper.com/'
    };
  }

  try {
    // Test with a simple request (London)
    const testUrl = `${GRAPHHOPPER_BASE_URL}/route?key=${apiKey}&vehicle=bike&point=51.5074,-0.1276&point=51.5100,-0.1200&points_encoded=false&calc_points=false`;
    
    const response = await fetch(testUrl);
    
    if (response.ok) {
      const data = await response.json();
      return { 
        available: true, 
        profiles: Object.values(GRAPHHOPPER_PROFILES),
        testDistance: data.paths?.[0]?.distance
      };
    } else {
      const errorText = await response.text();
      return { 
        available: false, 
        error: `API returned ${response.status}: ${errorText}`,
        instructions: 'Check your API key and quota'
      };
    }
  } catch (error) {
    return { 
      available: false, 
      error: error.message,
      instructions: 'Check your internet connection'
    };
  }
}

// Enhanced route generation using GraphHopper
export async function generateGraphHopperCyclingRoute(startCoord, endCoord, options = {}) {
  const {
    trainingGoal = 'endurance',
    alternatives = false
  } = options;

  const profile = selectGraphHopperProfile(trainingGoal);
  
  const routeOptions = {
    profile,
    elevation: true,
    alternatives,
    instructions: false
  };

  const route = await getGraphHopperCyclingDirections([startCoord, endCoord], routeOptions);
  
  if (route) {
    return {
      ...route,
      cyclingOptimized: true,
      trainingGoal
    };
  }

  return null;
}
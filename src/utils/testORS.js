// Test routing service integration
import { getORSCyclingDirections, validateORSService, CYCLING_PROFILES } from './openRouteService';
import { getGraphHopperCyclingDirections, validateGraphHopperService } from './graphHopper';

// Test both routing services and return the working one
export async function testRoutingServices() {
  console.log('🧪 Testing routing services...');
  
  // Test OpenRouteService first
  console.log('1️⃣ Testing OpenRouteService...');
  const orsValidation = await validateORSService();
  console.log('ORS Validation:', orsValidation);
  
  // Test GraphHopper
  console.log('2️⃣ Testing GraphHopper...');
  const ghValidation = await validateGraphHopperService();
  console.log('GraphHopper Validation:', ghValidation);
  
  // Determine which service to use
  if (orsValidation.available) {
    console.log('✅ Using OpenRouteService for routing');
    return { service: 'ors', validation: orsValidation };
  } else if (ghValidation.available) {
    console.log('✅ Using GraphHopper for routing');
    return { service: 'graphhopper', validation: ghValidation };
  } else {
    console.error('❌ No routing services available');
    console.error('ORS Error:', orsValidation.error);
    console.error('GraphHopper Error:', ghValidation.error);
    return { service: null, validation: null };
  }
}

// Simple test to verify ORS is working
export async function testORSIntegration() {
  console.log('Testing OpenRouteService integration...');
  
  // First validate the service
  const validation = await validateORSService();
  console.log('ORS Validation:', validation);
  
  if (!validation.available) {
    console.error('ORS not available:', validation.error);
    
    // Try GraphHopper as fallback
    console.log('Trying GraphHopper as fallback...');
    const ghValidation = await validateGraphHopperService();
    console.log('GraphHopper Validation:', ghValidation);
    
    if (ghValidation.available) {
      console.log('✅ GraphHopper is available as fallback!');
      return true;
    }
    
    return false;
  }
  
  // Test a simple cycling route (London example)
  const testStart = [-0.1276, 51.5074]; // London
  const testEnd = [-0.1200, 51.5100];   // Nearby point
  
  try {
    const route = await getORSCyclingDirections([testStart, testEnd], {
      profile: CYCLING_PROFILES.REGULAR
    });
    
    console.log('Test route result:', route);
    
    if (route && route.coordinates && route.coordinates.length > 0) {
      console.log('✅ OpenRouteService is working correctly!');
      console.log(`Route distance: ${(route.distance / 1000).toFixed(2)}km`);
      console.log(`Route profile: ${route.profile}`);
      return true;
    } else {
      console.error('❌ ORS returned invalid route data');
      return false;
    }
  } catch (error) {
    console.error('❌ ORS test failed:', error);
    return false;
  }
}

// Test GraphHopper specifically
export async function testGraphHopperIntegration() {
  console.log('Testing GraphHopper integration...');
  
  const validation = await validateGraphHopperService();
  console.log('GraphHopper Validation:', validation);
  
  if (!validation.available) {
    console.error('GraphHopper not available:', validation.error);
    return false;
  }
  
  // Test a simple cycling route (London example)
  const testStart = [-0.1276, 51.5074]; // London
  const testEnd = [-0.1200, 51.5100];   // Nearby point
  
  try {
    const route = await getGraphHopperCyclingDirections([testStart, testEnd], {
      profile: 'bike'
    });
    
    console.log('Test route result:', route);
    
    if (route && route.coordinates && route.coordinates.length > 0) {
      console.log('✅ GraphHopper is working correctly!');
      console.log(`Route distance: ${(route.distance / 1000).toFixed(2)}km`);
      console.log(`Route profile: ${route.profile}`);
      console.log(`Source: ${route.source}`);
      return true;
    } else {
      console.error('❌ GraphHopper returned invalid route data');
      return false;
    }
  } catch (error) {
    console.error('❌ GraphHopper test failed:', error);
    return false;
  }
}

// Test Mapbox map matching functionality
export async function testMapboxMapMatching() {
  console.log('Testing Mapbox Map Matching...');
  
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) {
    console.error('❌ No Mapbox token found');
    return false;
  }
  
  console.log('✅ Mapbox token found:', `${mapboxToken.substring(0, 10)}...`);
  
  // Import the function dynamically
  const { mapMatchRoute } = await import('./directions');
  
  // Test with London coordinates (like route builder would use)
  const testWaypoints = [
    [-0.1276, 51.5074], // London start
    [-0.1200, 51.5100], // London end
  ];
  
  try {
    console.log('Testing map matching with waypoints:', testWaypoints);
    
    const result = await mapMatchRoute(testWaypoints, mapboxToken, {
      profile: 'cycling',
      radiuses: [100, 100]
    });
    
    console.log('Map matching result:', result);
    
    if (result.coordinates && result.coordinates.length > 2) {
      console.log('✅ Map matching working!');
      console.log(`Route has ${result.coordinates.length} points`);
      console.log(`Distance: ${(result.distance / 1000).toFixed(2)}km`);
      console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`Profile: ${result.profile}`);
      
      // Check if route is properly snapped (has more points than input)
      if (result.coordinates.length > testWaypoints.length) {
        console.log('✅ Route properly snapped to roads');
        return true;
      } else {
        console.log('⚠️ Route not properly snapped - same number of points as input');
        return false;
      }
    } else {
      console.log('❌ Map matching returned invalid data');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Map matching test failed:', error);
    return false;
  }
}

// Test in the browser console
if (typeof window !== 'undefined') {
  window.testORS = testORSIntegration;
  window.testGraphHopper = testGraphHopperIntegration;
  window.testRoutingServices = testRoutingServices;
  window.testMapboxMatching = testMapboxMapMatching;
}
// AI Route Generation Engine
// Smart route generation considering training goals, weather, and conditions

import { mapMatchRoute, fetchElevationProfile, calculateElevationStats, getCyclingDirections } from './directions';
import { getWeatherData, getWindFactor, getOptimalTrainingConditions } from './weather';
import { calculateBearing } from './routeUtils';
import { fetchPastRides, analyzeRidingPatterns, generateRouteFromPatterns, buildRouteFromSegments } from './rideAnalysis';
import { getORSCyclingDirections, generateORSAreaRoutes, selectCyclingProfile, CYCLING_PROFILES, validateORSService } from './openRouteService';
import { getGraphHopperCyclingDirections, selectGraphHopperProfile, validateGraphHopperService, GRAPHHOPPER_PROFILES } from './graphHopper';

// Main AI route generation function
export async function generateAIRoutes(params) {
  const {
    startLocation,
    timeAvailable,
    trainingGoal,
    routeType,
    weatherData: providedWeather,
    userId
  } = params;

  console.log('Generating AI routes with params:', params);

  // Get weather data if not provided
  let weatherData = providedWeather;
  if (!weatherData) {
    weatherData = await getWeatherData(startLocation[1], startLocation[0]);
  }

  // Analyze past rides for personalized recommendations
  let ridingPatterns = null;
  let patternBasedSuggestions = null;
  
  if (userId) {
    console.log('Analyzing past rides for user:', userId);
    try {
      const pastRides = await fetchPastRides(userId);
      ridingPatterns = analyzeRidingPatterns(pastRides);
      patternBasedSuggestions = generateRouteFromPatterns(ridingPatterns, {
        startLocation,
        targetDistance: calculateTargetDistance(timeAvailable, trainingGoal),
        trainingGoal
      });
      console.log('Found riding patterns:', ridingPatterns);
      console.log('Pattern-based suggestions:', patternBasedSuggestions);
    } catch (error) {
      console.warn('Failed to analyze past rides:', error);
    }
  }

  // Calculate target distance, potentially adjusted by patterns
  let targetDistance = calculateTargetDistance(timeAvailable, trainingGoal);
  if (patternBasedSuggestions?.adjustedDistance) {
    targetDistance = patternBasedSuggestions.adjustedDistance;
    console.log(`Adjusted target distance from ${calculateTargetDistance(timeAvailable, trainingGoal)}km to ${targetDistance}km based on riding patterns`);
  }
  
  // Try to build routes from actual segments first
  const routes = [];
  
  // Priority 1: Routes built from your actual ride segments
  if (ridingPatterns?.routeSegments?.length > 0) {
    console.log(`Attempting to build routes from ${ridingPatterns.routeSegments.length} known segments`);
    
    const segmentBasedRoute = buildRouteFromSegments(
      startLocation,
      targetDistance,
      trainingGoal,
      ridingPatterns
    );
    
    if (segmentBasedRoute) {
      routes.push(segmentBasedRoute);
      console.log('Successfully created route from your riding history');
    }
  }
  
  // Priority 2: Try to modify existing route templates
  if (ridingPatterns?.routeTemplates?.length > 0) {
    const templateRoutes = await generateRoutesFromTemplates({
      startLocation,
      targetDistance,
      trainingGoal,
      routeType,
      weatherData,
      templates: ridingPatterns.routeTemplates
    });
    routes.push(...templateRoutes);
  }
  
  // Priority 3: Use Mapbox-based routing (NO geometric patterns)
  if (routes.length < 3) {
    console.log(`Only found ${routes.length} routes from history, generating Mapbox-based routes`);
    const mapboxRoutes = await generateMapboxBasedRoutes({
      startLocation,
      targetDistance,
      trainingGoal,
      routeType,
      weatherData,
      ridingPatterns,
      patternBasedSuggestions
    });
    
    routes.push(...mapboxRoutes);
  }

  // Filter out null/invalid routes
  const validRoutes = routes.filter(route => route !== null && route !== undefined);
  
  if (validRoutes.length === 0) {
    console.warn('No valid routes generated, creating fallback route');
    // Create one simple fallback route as last resort
    const fallbackRoute = createMockRoute('Fallback Route', targetDistance, trainingGoal, startLocation);
    return [fallbackRoute];
  }

  // Score and rank routes
  const scoredRoutes = await scoreRoutes(validRoutes, {
    trainingGoal,
    weatherData,
    timeAvailable,
    ridingPatterns
  });

  console.log(`Generated ${scoredRoutes.length} valid routes from ${routes.length} attempts`);
  
  // Return top 3-5 routes
  return scoredRoutes.slice(0, 4);
}

// Calculate target distance based on time and training goal
function calculateTargetDistance(timeMinutes, trainingGoal) {
  // Average speeds by training type (km/h)
  const speedMap = {
    recovery: 20,
    endurance: 25,
    intervals: 22, // Lower due to rest periods
    hills: 18      // Slower due to climbing
  };

  const speed = speedMap[trainingGoal] || 23;
  const hours = timeMinutes / 60;
  
  return hours * speed;
}

// Generate routes using Mapbox Directions API (NO geometric patterns)
async function generateMapboxBasedRoutes(params) {
  const { startLocation, targetDistance, trainingGoal, routeType, weatherData, patternBasedSuggestions } = params;
  const routes = [];
  
  console.log('Generating routes using Mapbox cycling intelligence');
  
  // Check for Mapbox token
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) {
    console.warn('Mapbox token not available for route generation');
    return [createMockRoute('No Mapbox Token', targetDistance, trainingGoal, startLocation)];
  }
  
  try {
    // Generate different route types using Mapbox
    if (routeType === 'loop') {
      const loopRoutes = await generateMapboxLoops(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions);
      routes.push(...loopRoutes);
    } else if (routeType === 'out_back') {
      const outBackRoutes = await generateMapboxOutAndBack(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions);
      routes.push(...outBackRoutes);
    } else {
      // Generate both types
      const loopRoutes = await generateMapboxLoops(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions);
      const outBackRoutes = await generateMapboxOutAndBack(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions);
      routes.push(...loopRoutes.slice(0, 2), ...outBackRoutes.slice(0, 1));
    }
    
  } catch (error) {
    console.warn('Mapbox-based route generation failed:', error);
    // Only as absolute last resort, generate one carefully validated route
    const lastResort = await generateSingleValidatedRoute(startLocation, targetDistance, trainingGoal);
    if (lastResort) {
      routes.push(lastResort);
    }
  }
  
  return routes.filter(route => route !== null && route.coordinates && route.coordinates.length > 10);
}

// Generate smart cycling destinations using real cycling data
async function generateSmartDestinations(startLocation, targetDistance, isochrone) {
  const destinations = [];
  
  if (!isochrone.features || isochrone.features.length === 0) {
    return generateFallbackDestinations(startLocation, targetDistance);
  }
  
  // Use the isochrone boundaries to find realistic destinations
  const feature = isochrone.features[0]; // Use the largest time range
  const coordinates = feature.geometry.coordinates[0];
  
  // Select diverse points around the cycling-reachable area
  const numDestinations = Math.min(6, Math.floor(coordinates.length / 10));
  
  for (let i = 0; i < numDestinations; i++) {
    const index = Math.floor((coordinates.length * i) / numDestinations);
    const coord = coordinates[index];
    
    destinations.push({
      coordinates: coord,
      type: 'isochrone_boundary',
      distance: calculateDistance(startLocation, coord),
      bearing: calculateBearing(startLocation, coord)
    });
  }
  
  // Sort by how close they are to target distance
  return destinations.sort((a, b) => {
    const aDiff = Math.abs(a.distance - targetDistance / 2);
    const bDiff = Math.abs(b.distance - targetDistance / 2);
    return aDiff - bDiff;
  });
}

// Generate Mapbox-based loop routes
async function generateMapboxLoops(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions) {
  const routes = [];
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  
  // Generate different loop patterns using strategic waypoints
  const loopPatterns = [
    { name: 'Northern Loop', bearing: 0, radius: 0.7 },
    { name: 'Eastern Loop', bearing: 90, radius: 0.8 },
    { name: 'Southern Loop', bearing: 180, radius: 0.7 },
    { name: 'Western Loop', bearing: 270, radius: 0.8 }
  ];
  
  // Prioritize directions based on user patterns if available
  if (patternBasedSuggestions?.preferredDirection?.source === 'historical') {
    const preferredBearing = patternBasedSuggestions.preferredDirection.bearing;
    loopPatterns.sort((a, b) => {
      const aDiff = Math.abs(a.bearing - preferredBearing);
      const bDiff = Math.abs(b.bearing - preferredBearing);
      return aDiff - bDiff;
    });
  }
  
  for (let i = 0; i < Math.min(3, loopPatterns.length); i++) {
    const pattern = loopPatterns[i];
    
    try {
      const route = await generateMapboxLoop(startLocation, targetDistance, pattern, trainingGoal, mapboxToken);
      if (route && route.coordinates && route.coordinates.length > 20) {
        routes.push(route);
        console.log(`Successfully generated ${pattern.name} with ${route.coordinates.length} points`);
      }
    } catch (error) {
      console.warn(`Failed to generate ${pattern.name}:`, error);
    }
  }
  
  return routes;
}

// Generate Mapbox-based out-and-back routes
async function generateMapboxOutAndBack(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions) {
  const routes = [];
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  
  // Generate different directional out-and-back routes
  const directions = [
    { name: 'North Route', bearing: 0 },
    { name: 'Northeast Route', bearing: 45 },
    { name: 'East Route', bearing: 90 },
    { name: 'Southeast Route', bearing: 135 }
  ];
  
  // Prioritize preferred direction if available
  if (patternBasedSuggestions?.preferredDirection?.source === 'historical') {
    const preferredBearing = patternBasedSuggestions.preferredDirection.bearing;
    directions.sort((a, b) => {
      const aDiff = Math.abs(a.bearing - preferredBearing);
      const bDiff = Math.abs(b.bearing - preferredBearing);
      return aDiff - bDiff;
    });
  }
  
  for (let i = 0; i < Math.min(3, directions.length); i++) {
    const direction = directions[i];
    
    try {
      const route = await generateMapboxOutBack(startLocation, targetDistance, direction, trainingGoal, mapboxToken, patternBasedSuggestions);
      if (route && route.coordinates && route.coordinates.length > 10) {
        routes.push(route);
        console.log(`Successfully generated ${direction.name} with ${route.coordinates.length} points`);
      }
    } catch (error) {
      console.warn(`Failed to generate ${direction.name}:`, error);
    }
  }
  
  return routes;
}

// Generate single Mapbox loop with strategic waypoints
async function generateMapboxLoop(startLocation, targetDistance, pattern, trainingGoal, mapboxToken) {
  const [startLon, startLat] = startLocation;
  
  // Calculate strategic waypoints for a realistic loop
  const radius = (targetDistance / (2 * Math.PI)) * pattern.radius;
  const waypoints = [startLocation];
  
  // Create 3-4 strategic waypoints instead of many geometric points
  const numWaypoints = 3;
  for (let i = 1; i <= numWaypoints; i++) {
    const angle = (pattern.bearing + (i * (360 / (numWaypoints + 1)))) * (Math.PI / 180);
    
    // Add variation but keep it realistic
    const angleVariation = angle + (Math.random() - 0.5) * 0.3;
    const radiusVariation = radius * (0.7 + Math.random() * 0.6);
    
    const deltaLat = (radiusVariation / 111.32) * Math.cos(angleVariation);
    const deltaLon = (radiusVariation / (111.32 * Math.cos(startLat * Math.PI / 180))) * Math.sin(angleVariation);
    
    waypoints.push([startLon + deltaLon, startLat + deltaLat]);
  }
  
  // Close the loop
  waypoints.push(startLocation);
  
  try {
    console.log(`Generating ${pattern.name} with ${waypoints.length} waypoints`);
    
    // Use Mapbox Directions API for realistic cycling routes
    const route = await getCyclingDirections(waypoints, mapboxToken, {
      profile: getMapboxProfile(trainingGoal)
    });
    
    // Validate the route
    if (!route.coordinates || route.coordinates.length < 20 || route.confidence < 0.5) {
      console.warn(`${pattern.name} generated poor quality route, skipping`);
      return null;
    }
    
    // Check route complexity to avoid geometric patterns
    const complexity = calculateRouteComplexity(route.coordinates);
    if (complexity < 0.1) {
      console.warn(`${pattern.name} appears too geometric (complexity: ${complexity.toFixed(2)}), skipping`);
      return null;
    }
    
    // Get elevation profile
    const elevationProfile = await fetchElevationProfile(route.coordinates, mapboxToken);
    const elevationStats = calculateElevationStats(elevationProfile);
    
    return {
      name: `${pattern.name} - ${getRouteNameByGoal(trainingGoal)}`,
      distance: route.distance / 1000,
      elevationGain: elevationStats.gain,
      elevationLoss: elevationStats.loss,
      coordinates: route.coordinates,
      difficulty: calculateDifficulty(route.distance / 1000, elevationStats.gain),
      description: `Cycling loop using Mapbox routing intelligence (${getMapboxProfile(trainingGoal)} profile)`,
      trainingGoal,
      pattern: 'loop',
      confidence: route.confidence,
      source: 'mapbox',
      elevationProfile,
      windFactor: 0.8
    };
    
  } catch (error) {
    console.warn(`Failed to generate ${pattern.name}:`, error);
    return null;
  }
}

// Generate single Mapbox out-and-back route
async function generateMapboxOutBack(startLocation, targetDistance, direction, trainingGoal, mapboxToken, patternBasedSuggestions) {
  const [startLon, startLat] = startLocation;
  const halfDistance = targetDistance / 2;
  
  // Check for nearby frequent areas in the preferred direction
  const nearbyAreas = patternBasedSuggestions?.nearbyFrequentAreas || [];
  let targetPoint = null;
  
  // Try to use a frequent area as the turnaround point
  for (const area of nearbyAreas) {
    const areaBearing = calculateBearing(startLocation, area.center);
    const bearingDiff = Math.abs(areaBearing - direction.bearing);
    const normalizedDiff = bearingDiff > 180 ? 360 - bearingDiff : bearingDiff;
    
    const distanceToArea = calculateDistance(startLocation, area.center);
    
    // Use area if it's roughly in the right direction and distance
    if (normalizedDiff < 45 && 
        distanceToArea > halfDistance * 0.5 && 
        distanceToArea < halfDistance * 1.5) {
      targetPoint = area.center;
      console.log(`Using frequent area as turnaround point for ${direction.name}`);
      break;
    }
  }
  
  // If no suitable frequent area, calculate target point
  if (!targetPoint) {
    // Add some variation to avoid perfectly straight lines
    const angle = direction.bearing * (Math.PI / 180);
    const angleVariation = angle + (Math.random() - 0.5) * 0.2;
    const distanceVariation = halfDistance * (0.8 + Math.random() * 0.4);
    
    const deltaLat = (distanceVariation / 111.32) * Math.cos(angleVariation);
    const deltaLon = (distanceVariation / (111.32 * Math.cos(startLat * Math.PI / 180))) * Math.sin(angleVariation);
    
    targetPoint = [startLon + deltaLon, startLat + deltaLat];
  }
  
  try {
    // Use Mapbox cycling directions to get realistic route
    const outboundRoute = await getCyclingDirections([startLocation, targetPoint], mapboxToken, {
      profile: getMapboxProfile(trainingGoal)
    });
    
    if (!outboundRoute.coordinates || outboundRoute.coordinates.length < 5) {
      console.warn(`Failed to generate realistic outbound route for ${direction.name}`);
      return null;
    }
    
    // Create the return journey (reverse the coordinates)
    const returnCoordinates = [...outboundRoute.coordinates].reverse();
    
    // Combine outbound and return for full route
    const fullCoordinates = [...outboundRoute.coordinates, ...returnCoordinates.slice(1)];
    
    const elevationProfile = await fetchElevationProfile(fullCoordinates, mapboxToken);
    const elevationStats = calculateElevationStats(elevationProfile);
    
    return {
      name: `${direction.name} - ${getRouteNameByGoal(trainingGoal)}`,
      distance: (outboundRoute.distance * 2) / 1000,
      elevationGain: elevationStats.gain,
      elevationLoss: elevationStats.loss,
      coordinates: fullCoordinates,
      difficulty: calculateDifficulty((outboundRoute.distance * 2) / 1000, elevationStats.gain),
      description: `Out-and-back route using Mapbox cycling intelligence (${getMapboxProfile(trainingGoal)} profile)`,
      trainingGoal,
      pattern: 'out_back',
      confidence: outboundRoute.confidence,
      source: 'mapbox',
      elevationProfile,
      windFactor: 0.8
    };
    
  } catch (error) {
    console.warn(`Failed to generate out-and-back route for ${direction.name}:`, error);
    return null;
  }
}

// Calculate destination point given start, distance, and bearing
function calculateDestinationPoint(start, distanceKm, bearingDegrees) {
  const [lon, lat] = start;
  const R = 6371; // Earth's radius in km
  
  const bearing = bearingDegrees * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceKm / R) +
    Math.cos(lat1) * Math.sin(distanceKm / R) * Math.cos(bearing)
  );
  
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distanceKm / R) * Math.cos(lat1),
    Math.cos(distanceKm / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  
  return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

// Generate fallback destinations when isochrone fails
function generateFallbackDestinations(startLocation, targetDistance) {
  const destinations = [];
  const numDestinations = 4;
  
  for (let i = 0; i < numDestinations; i++) {
    const bearing = (360 / numDestinations) * i + Math.random() * 30 - 15; // Add some variation
    const distance = targetDistance * (0.3 + Math.random() * 0.4); // 30-70% of target
    
    const destination = calculateDestinationPoint(startLocation, distance, bearing);
    destinations.push({
      coordinates: destination,
      type: 'calculated',
      distance,
      bearing
    });
  }
  
  return destinations;
}

// Get display name for route type
function getRouteTypeDisplayName(profile) {
  // OpenRouteService profiles
  if (profile === CYCLING_PROFILES.ROAD) return 'Road Cycling';
  if (profile === CYCLING_PROFILES.MOUNTAIN) return 'Mountain Bike';
  if (profile === CYCLING_PROFILES.ELECTRIC) return 'E-Bike';
  if (profile === CYCLING_PROFILES.REGULAR) return 'Cycling';
  
  // GraphHopper profiles
  if (profile === GRAPHHOPPER_PROFILES.RACINGBIKE) return 'Road Cycling';
  if (profile === GRAPHHOPPER_PROFILES.MOUNTAINBIKE) return 'Mountain Bike';
  if (profile === GRAPHHOPPER_PROFILES.BIKE) return 'Cycling';
  if (profile === GRAPHHOPPER_PROFILES.FOOT) return 'Walking';
  
  return 'Cycling';
}

// Generate single validated route as absolute last resort
async function generateSingleValidatedRoute(startLocation, targetDistance, trainingGoal) {
  console.log('Generating single validated route as last resort using Mapbox');
  
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) {
    console.warn('No Mapbox token available for last resort route');
    return null;
  }
  
  // Try a simple out-and-back in the most promising direction
  const destination = calculateDestinationPoint(startLocation, targetDistance / 2, 45); // Northeast
  
  try {
    const route = await getCyclingDirections([startLocation, destination], mapboxToken, {
      profile: getMapboxProfile(trainingGoal)
    });
    
    if (route && route.coordinates && route.coordinates.length > 10) {
      const returnCoords = [...route.coordinates].reverse();
      const fullCoords = [...route.coordinates, ...returnCoords.slice(1)];
      
      const elevationProfile = await fetchElevationProfile(fullCoords, mapboxToken);
      const elevationStats = calculateElevationStats(elevationProfile);
      
      return {
        name: 'Validated Mapbox Route',
        distance: (route.distance * 2) / 1000,
        elevationGain: elevationStats.gain,
        elevationLoss: elevationStats.loss,
        coordinates: fullCoords,
        difficulty: calculateDifficulty((route.distance * 2) / 1000, elevationStats.gain),
        description: 'Carefully validated cycling route using Mapbox Directions API',
        trainingGoal,
        pattern: 'out_back',
        confidence: route.confidence * 0.8,
        source: 'mapbox_validated',
        elevationProfile
      };
    }
  } catch (error) {
    console.warn('Failed to generate last resort Mapbox route:', error);
  }
  
  return null;
}

// Generate multiple route variations using Mapbox (DEPRECATED - use generateMapboxBasedRoutes instead)
async function generateRouteVariations(params) {
  console.log('DEPRECATED: generateRouteVariations called - redirecting to Mapbox-based generation');
  return await generateMapboxBasedRoutes(params);
}

// Generate loop routes using real ride data
async function generateLoopRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions) {
  const routes = [];
  
  // Priority 1: Try to build loops from actual route segments
  const segmentBasedLoops = await buildLoopsFromSegments(
    startLocation, 
    targetDistance, 
    trainingGoal, 
    patternBasedSuggestions
  );
  routes.push(...segmentBasedLoops);
  
  // Priority 2: Try to use past loop templates
  if (patternBasedSuggestions?.nearbyFrequentAreas?.length > 0) {
    const frequentAreaLoops = await buildLoopsFromFrequentAreas(
      startLocation,
      targetDistance,
      trainingGoal,
      weatherData,
      patternBasedSuggestions.nearbyFrequentAreas
    );
    routes.push(...frequentAreaLoops);
  }
  
  // Priority 3: Use Mapbox cycling intelligence instead of geometric patterns
  if (routes.length === 0) {
    console.log('No routes found from ride data, using Mapbox cycling intelligence');
    const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
    if (mapboxToken) {
      const mapboxRoute = await generateMapboxLoop(startLocation, targetDistance, 
        { name: 'Fallback Loop', bearing: 45, radius: 0.8 }, trainingGoal, mapboxToken);
      
      if (mapboxRoute) {
        routes.push(mapboxRoute);
      }
    }
  }

  console.log(`Generated ${routes.length} loop routes (${routes.filter(r => r.source === 'segments').length} from segments, ${routes.filter(r => r.source === 'areas').length} from frequent areas)`);
  
  return routes;
}

// Build loops using actual route segments from past rides
async function buildLoopsFromSegments(startLocation, targetDistance, trainingGoal, patternBasedSuggestions) {
  const routes = [];
  
  if (!patternBasedSuggestions?.ridingPatterns?.routeSegments) {
    return routes;
  }
  
  const segments = patternBasedSuggestions.ridingPatterns.routeSegments;
  
  // Find segments near the start location
  const nearbySegments = segments.filter(segment => {
    const distanceToStart = calculateDistance(startLocation, segment.startPoint);
    const distanceToEnd = calculateDistance(startLocation, segment.endPoint);
    return Math.min(distanceToStart, distanceToEnd) < 3; // Within 3km
  });
  
  if (nearbySegments.length === 0) {
    return routes;
  }
  
  // Try to chain segments into a loop
  for (let i = 0; i < Math.min(2, nearbySegments.length); i++) {
    const primarySegment = nearbySegments[i];
    
    // Try to find other segments that could complete a loop
    const completingSegments = segments.filter(segment => {
      if (segment === primarySegment) return false;
      
      // Check if this segment could connect back to start
      const endToSegmentStart = calculateDistance(primarySegment.endPoint, segment.startPoint);
      const endToSegmentEnd = calculateDistance(primarySegment.endPoint, segment.endPoint);
      const segmentToStart = calculateDistance(
        endToSegmentStart < endToSegmentEnd ? segment.endPoint : segment.startPoint,
        startLocation
      );
      
      return Math.min(endToSegmentStart, endToSegmentEnd) < 2 && segmentToStart < 2;
    });
    
    if (completingSegments.length > 0) {
      const loop = await buildSegmentLoop(startLocation, primarySegment, completingSegments[0], targetDistance, trainingGoal);
      if (loop) {
        routes.push(loop);
      }
    }
  }
  
  return routes;
}

// Build loops using frequent riding areas
async function buildLoopsFromFrequentAreas(startLocation, targetDistance, trainingGoal, weatherData, frequentAreas) {
  const routes = [];
  
  // Find areas that would make good loop destinations
  const suitableAreas = frequentAreas.filter(area => {
    const distance = calculateDistance(startLocation, area.center);
    return distance > targetDistance * 0.2 && distance < targetDistance * 0.8; // Between 20-80% of target distance
  });
  
  if (suitableAreas.length === 0) {
    return routes;
  }
  
  // Try to create loops through the most frequently used areas
  for (let i = 0; i < Math.min(2, suitableAreas.length); i++) {
    const area = suitableAreas[i];
    
    const loop = await createLoopThroughArea(startLocation, area.center, targetDistance, trainingGoal);
    if (loop) {
      routes.push({
        ...loop,
        name: `Loop via Frequent Area ${i + 1}`,
        description: `Route through an area you ride frequently (visited ${area.frequency} times)`,
        source: 'areas',
        confidence: area.confidence * 0.8
      });
    }
  }
  
  return routes;
}

// REMOVED: No more geometric patterns! All routes now use OpenStreetMap cycling intelligence.

// Build a loop from two segments
async function buildSegmentLoop(startLocation, segment1, segment2, targetDistance, trainingGoal) {
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) return null;
  
  try {
    // Determine the best order to connect segments
    const waypoints = [startLocation];
    
    // Add segment 1
    const distToSeg1Start = calculateDistance(startLocation, segment1.startPoint);
    const distToSeg1End = calculateDistance(startLocation, segment1.endPoint);
    
    if (distToSeg1Start < distToSeg1End) {
      waypoints.push(...segment1.coordinates.slice(1)); // Skip duplicate start
    } else {
      waypoints.push(...[...segment1.coordinates].reverse().slice(1));
    }
    
    // Add segment 2 (connecting back to start)
    const lastPoint = waypoints[waypoints.length - 1];
    const distToSeg2Start = calculateDistance(lastPoint, segment2.startPoint);
    const distToSeg2End = calculateDistance(lastPoint, segment2.endPoint);
    
    if (distToSeg2Start < distToSeg2End) {
      waypoints.push(...segment2.coordinates.slice(1));
    } else {
      waypoints.push(...[...segment2.coordinates].reverse().slice(1));
    }
    
    // Close the loop
    waypoints.push(startLocation);
    
    // Validate and clean up the route
    const route = await getCyclingDirections(waypoints, mapboxToken);
    
    if (route.coordinates && route.coordinates.length > 10) {
      const elevationProfile = await fetchElevationProfile(route.coordinates, mapboxToken);
      const elevationStats = calculateElevationStats(elevationProfile);
      
      return {
        name: 'Loop from Your Routes',
        distance: route.distance / 1000,
        elevationGain: elevationStats.gain,
        elevationLoss: elevationStats.loss,
        coordinates: route.coordinates,
        difficulty: calculateDifficulty(route.distance / 1000, elevationStats.gain),
        description: 'Built from segments of your actual rides',
        trainingGoal,
        pattern: 'loop',
        confidence: 0.9, // High confidence since it uses real segments
        elevationProfile,
        source: 'segments'
      };
    }
  } catch (error) {
    console.warn('Failed to build segment loop:', error);
  }
  
  return null;
}

// Create loop through a frequent area
async function createLoopThroughArea(startLocation, areaCenter, targetDistance, trainingGoal) {
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) return null;
  
  try {
    // Create a simple route: start -> area -> back to start
    const waypoints = [startLocation, areaCenter, startLocation];
    
    const route = await getCyclingDirections(waypoints, mapboxToken);
    
    if (route.coordinates && route.coordinates.length > 10) {
      const elevationProfile = await fetchElevationProfile(route.coordinates, mapboxToken);
      const elevationStats = calculateElevationStats(elevationProfile);
      
      return {
        distance: route.distance / 1000,
        elevationGain: elevationStats.gain,
        elevationLoss: elevationStats.loss,
        coordinates: route.coordinates,
        difficulty: calculateDifficulty(route.distance / 1000, elevationStats.gain),
        trainingGoal,
        pattern: 'loop',
        elevationProfile
      };
    }
  } catch (error) {
    console.warn('Failed to create area loop:', error);
  }
  
  return null;
}

// Generate a specific loop pattern
async function generateLoopPattern(startLocation, targetDistance, pattern, trainingGoal, weatherData, patternBasedSuggestions) {
  const [startLon, startLat] = startLocation;
  
  // Calculate approximate radius for the loop
  const radius = (targetDistance / (2 * Math.PI)) * 0.9; // Slightly larger for realistic cycling routes
  
  // Check if we have nearby frequent areas to incorporate
  const nearbyAreas = patternBasedSuggestions?.nearbyFrequentAreas || [];
  
  // Generate fewer, more realistic waypoints
  const waypoints = [startLocation];
  
  // Try a simpler approach: create 2-3 intermediate points for a more natural route
  const numIntermediatePoints = Math.min(3, Math.max(2, Math.floor(targetDistance / 15))); // 1 point per 15km roughly
  
  for (let i = 1; i <= numIntermediatePoints; i++) {
    let targetPoint;
    
    // Try to use frequent areas first
    if (nearbyAreas.length > 0 && i <= nearbyAreas.length) {
      const area = nearbyAreas[i - 1];
      const distanceToArea = calculateDistance(startLocation, area.center);
      
      // Use frequent area if it's within reasonable distance
      if (distanceToArea < targetDistance * 0.8 && distanceToArea > targetDistance * 0.2) {
        targetPoint = area.center;
        console.log(`Using frequent area for waypoint ${i}:`, area.center);
      }
    }
    
    // Generate more realistic waypoint based on road network considerations
    if (!targetPoint) {
      // Use smaller radius and less random variation
      const segmentRadius = radius * (0.5 + i * 0.3); // Gradually increase distance
      const angle = (pattern.bearing + (i * (360 / (numIntermediatePoints + 1)))) * (Math.PI / 180);
      
      // Reduced randomness for more predictable routes
      const angleVariation = angle + (Math.random() - 0.5) * 0.2; // Reduced from 0.5
      const radiusVariation = segmentRadius * (0.9 + Math.random() * 0.2); // Reduced variation
      
      const deltaLat = (radiusVariation / 111.32) * Math.cos(angleVariation);
      const deltaLon = (radiusVariation / (111.32 * Math.cos(startLat * Math.PI / 180))) * Math.sin(angleVariation);
      
      targetPoint = [startLon + deltaLon, startLat + deltaLat];
    }
    
    waypoints.push(targetPoint);
  }
  
  // Close the loop
  waypoints.push(startLocation);

  // Get Mapbox token
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) {
    console.warn('Mapbox token not available for route generation');
    return createMockRoute(pattern.name, targetDistance, trainingGoal);
  }

  try {
    console.log(`Generating ${pattern.name} with waypoints:`, waypoints.length);
    
    // Use Directions API first for better cycling routes
    let snappedRoute = await getCyclingDirections(waypoints, mapboxToken, {
      profile: getMapboxProfile(trainingGoal)
    });

    // Validate the directions result
    const isDirectionsValid = snappedRoute.coordinates && 
                             snappedRoute.coordinates.length > 10 && // Ensure reasonable detail
                             snappedRoute.confidence > 0.7 && // High confidence
                             snappedRoute.distance > (targetDistance * 0.5 * 1000) && // At least 50% of target distance
                             snappedRoute.distance < (targetDistance * 2 * 1000); // Not more than 200% of target

    // If directions API fails or gives poor results, try map matching
    if (!isDirectionsValid) {
      console.log('Directions API result not suitable, trying map matching for:', pattern.name);
      snappedRoute = await mapMatchRoute(waypoints, mapboxToken, {
        profile: getMapboxProfile(trainingGoal)
      });
      
      // Validate map matching result
      const isMapMatchValid = snappedRoute.coordinates && 
                             snappedRoute.coordinates.length > 5 && 
                             snappedRoute.confidence > 0.3 &&
                             snappedRoute.distance > (targetDistance * 0.3 * 1000);
      
      if (!isMapMatchValid) {
        console.warn('Both directions and map matching produced poor results for:', pattern.name);
        return null; // Return null instead of mock route
      }
    }

    // Additional validation: check if route is too geometric (straight lines)
    if (snappedRoute.coordinates && snappedRoute.coordinates.length > 2) {
      const routeComplexity = calculateRouteComplexity(snappedRoute.coordinates);
      if (routeComplexity < 0.1) { // Too simple/geometric
        console.warn('Route appears too geometric, skipping:', pattern.name);
        return null;
      }
    }

    // Get elevation profile
    const elevationProfile = await fetchElevationProfile(snappedRoute.coordinates, mapboxToken);
    const elevationStats = calculateElevationStats(elevationProfile);

    return {
      name: `${pattern.name} - ${getRouteNameByGoal(trainingGoal)}`,
      distance: snappedRoute.distance / 1000, // Convert to km
      elevationGain: elevationStats.gain,
      elevationLoss: elevationStats.loss,
      coordinates: snappedRoute.coordinates,
      difficulty: calculateDifficulty(snappedRoute.distance / 1000, elevationStats.gain),
      description: generateRouteDescription(trainingGoal, pattern.variation, elevationStats),
      trainingGoal,
      pattern: pattern.variation,
      confidence: snappedRoute.confidence,
      elevationProfile,
      windFactor: calculateWindFactor(snappedRoute.coordinates, weatherData),
    };

  } catch (error) {
    console.warn('Route snapping failed, using mock route:', error);
    return createMockRoute(pattern.name, targetDistance, trainingGoal, startLocation);
  }
}

// Calculate distance between two points (simple approximation)
function calculateDistance([lon1, lat1], [lon2, lat2]) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Calculate route complexity to detect overly geometric routes
function calculateRouteComplexity(coordinates) {
  if (coordinates.length < 3) return 0;
  
  let totalBearingChange = 0;
  let segmentCount = 0;
  
  for (let i = 1; i < coordinates.length - 1; i++) {
    const bearing1 = calculateBearing(coordinates[i - 1], coordinates[i]);
    const bearing2 = calculateBearing(coordinates[i], coordinates[i + 1]);
    
    // Calculate bearing change (absolute difference)
    let bearingChange = Math.abs(bearing2 - bearing1);
    if (bearingChange > 180) bearingChange = 360 - bearingChange;
    
    totalBearingChange += bearingChange;
    segmentCount++;
  }
  
  // Return average bearing change normalized (higher = more complex/realistic)
  return segmentCount > 0 ? (totalBearingChange / segmentCount) / 180 : 0;
}

// Generate out-and-back routes
async function generateOutAndBackRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions) {
  const routes = [];
  const halfDistance = targetDistance / 2;
  
  // Generate different directions, prioritizing user preferences
  let directions = [
    { name: 'North Route', bearing: 0 },
    { name: 'Northeast Route', bearing: 45 },
    { name: 'East Route', bearing: 90 },
    { name: 'Southeast Route', bearing: 135 },
  ];

  // Prioritize preferred direction if available
  if (patternBasedSuggestions?.preferredDirection?.source === 'historical') {
    const preferredBearing = patternBasedSuggestions.preferredDirection.bearing;
    directions = directions.sort((a, b) => {
      const aDiff = Math.abs(a.bearing - preferredBearing);
      const bDiff = Math.abs(b.bearing - preferredBearing);
      return aDiff - bDiff;
    });
  }

  for (const direction of directions) {
    try {
      const route = await generateOutAndBackPattern(
        startLocation,
        halfDistance,
        direction,
        trainingGoal,
        weatherData,
        patternBasedSuggestions
      );
      if (route && route.coordinates && route.coordinates.length > 10) {
        routes.push(route);
        console.log(`Successfully generated ${direction.name} with ${route.coordinates.length} points`);
      } else {
        console.log(`Skipped ${direction.name} - insufficient quality`);
      }
    } catch (error) {
      console.warn(`Failed to generate ${direction.name}:`, error);
    }
  }

  return routes;
}

// Generate point-to-point routes
async function generatePointToPointRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions) {
  // For now, convert to out-and-back since we need a return journey
  // In future, could integrate with public transport APIs
  return generateOutAndBackRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions);
}

// Calculate wind factor for entire route
function calculateWindFactor(coordinates, weatherData) {
  if (!weatherData || !coordinates || coordinates.length < 2) return 0.8;

  let totalFactor = 0;
  let segments = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const bearing = calculateBearing(coordinates[i], coordinates[i + 1]);
    const factor = getWindFactor(bearing, weatherData.windDegrees, weatherData.windSpeed);
    totalFactor += factor;
    segments++;
  }

  return segments > 0 ? totalFactor / segments : 0.8;
}

// Get appropriate Mapbox routing profile
function getMapboxProfile(trainingGoal) {
  switch (trainingGoal) {
    case 'recovery':
      return 'cycling'; // Prefer bike-friendly routes
    case 'endurance':
      return 'cycling';
    case 'intervals':
      return 'cycling'; // Might prefer roads with less traffic
    case 'hills':
      return 'cycling';
    default:
      return 'cycling';
  }
}

// Calculate route difficulty
function calculateDifficulty(distance, elevationGain) {
  const elevationRatio = elevationGain / distance; // meters per km
  
  if (elevationRatio < 10) return 'easy';
  if (elevationRatio < 25) return 'moderate';
  return 'hard';
}

// Generate route name based on training goal
function getRouteNameByGoal(goal) {
  const names = {
    endurance: 'Endurance Ride',
    intervals: 'Interval Training',
    recovery: 'Recovery Spin',
    hills: 'Hill Climb'
  };
  return names[goal] || 'Training Ride';
}

// Generate route description
function generateRouteDescription(trainingGoal, pattern, elevationStats) {
  const descriptions = {
    endurance: 'Steady paced route perfect for building aerobic base',
    intervals: 'Route with good segments for high-intensity efforts',
    recovery: 'Easy spinning route for active recovery',
    hills: 'Challenging climbs to build strength and power'
  };
  
  let desc = descriptions[trainingGoal] || 'Great training route';
  
  if (elevationStats.gain > 300) {
    desc += ' with significant climbing';
  } else if (elevationStats.gain < 100) {
    desc += ' on mostly flat terrain';
  }
  
  return desc;
}

// Score and rank routes
async function scoreRoutes(routes, criteria) {
  const { trainingGoal, weatherData, timeAvailable, ridingPatterns } = criteria;
  
  const scoredRoutes = routes.map(route => {
    let score = 0.5; // Base score
    
    // Training goal alignment
    score += getTrainingGoalScore(route, trainingGoal);
    
    // Weather optimization
    if (weatherData) {
      score += getWeatherScore(route, weatherData);
    }
    
    // Time efficiency
    score += getTimeEfficiencyScore(route, timeAvailable);
    
    // Route quality
    score += getRouteQualityScore(route);
    
    // Historical pattern matching
    if (ridingPatterns) {
      score += getHistoricalPatternScore(route, ridingPatterns);
    }
    
    return {
      ...route,
      score: Math.max(0, Math.min(1, score))
    };
  });
  
  // Sort by score descending
  return scoredRoutes.sort((a, b) => b.score - a.score);
}

// Training goal scoring
function getTrainingGoalScore(route, goal) {
  switch (goal) {
    case 'hills':
      return (route.elevationGain / route.distance) > 20 ? 0.2 : -0.1;
    case 'recovery':
      return (route.elevationGain / route.distance) < 15 ? 0.2 : -0.1;
    case 'intervals':
      return route.windFactor > 0.8 ? 0.15 : 0; // Prefer low wind for intervals
    default:
      return 0.1;
  }
}

// Weather scoring
function getWeatherScore(route, weather) {
  const conditions = getOptimalTrainingConditions(weather, route.trainingGoal);
  return conditions ? conditions.score * 0.2 : 0;
}

// Time efficiency scoring
function getTimeEfficiencyScore(route, timeAvailable) {
  const estimatedTime = (route.distance / 23) * 60; // Assume 23 km/h average
  const timeDiff = Math.abs(estimatedTime - timeAvailable);
  
  if (timeDiff < 10) return 0.2; // Within 10 minutes
  if (timeDiff < 20) return 0.1; // Within 20 minutes
  return -0.1; // Too far off
}

// Route quality scoring
function getRouteQualityScore(route) {
  let score = 0;
  
  // Confidence from map matching
  if (route.confidence > 0.8) score += 0.1;
  
  // Wind factor
  score += (route.windFactor - 0.8) * 0.5;
  
  return score;
}

// Historical pattern scoring
function getHistoricalPatternScore(route, patterns) {
  let score = 0;
  
  // Distance preference matching
  if (patterns.preferredDistances?.mean) {
    const userMean = patterns.preferredDistances.mean;
    const distanceDiff = Math.abs(route.distance - userMean) / userMean;
    
    // Bonus for distances close to user's typical rides
    if (distanceDiff < 0.2) score += 0.15; // Within 20% of typical
    else if (distanceDiff < 0.4) score += 0.1; // Within 40% of typical
    else if (distanceDiff > 1.0) score -= 0.1; // Much longer than typical
  }
  
  // Elevation preference matching
  if (patterns.elevationTolerance?.preferred) {
    const preferredElevation = patterns.elevationTolerance.preferred;
    const elevationRatio = route.elevationGain / route.distance; // meters per km
    const preferredRatio = preferredElevation / patterns.preferredDistances?.mean || 15;
    
    const elevationDiff = Math.abs(elevationRatio - preferredRatio) / preferredRatio;
    
    if (elevationDiff < 0.3) score += 0.1; // Close to preferred climbing rate
    else if (elevationDiff > 1.5) score -= 0.05; // Much different from preferred
  }
  
  // Frequent area bonus
  if (patterns.frequentAreas?.length > 0 && route.coordinates?.length > 0) {
    const routeCenter = calculateRouteCenter(route.coordinates);
    const nearFrequentArea = patterns.frequentAreas.some(area => {
      const distance = calculateDistance(routeCenter, area.center);
      return distance < 5; // Within 5km of frequent area
    });
    
    if (nearFrequentArea) score += 0.1;
  }
  
  // Pattern confidence weighting
  const patternConfidence = calculatePatternConfidence(patterns);
  return score * patternConfidence;
}

// Calculate route center point
function calculateRouteCenter(coordinates) {
  if (!coordinates || coordinates.length === 0) return [0, 0];
  
  const totalLon = coordinates.reduce((sum, coord) => sum + coord[0], 0);
  const totalLat = coordinates.reduce((sum, coord) => sum + coord[1], 0);
  
  return [totalLon / coordinates.length, totalLat / coordinates.length];
}

// Calculate pattern confidence (imported from rideAnalysis but redefined for safety)
function calculatePatternConfidence(patterns) {
  let score = 0;
  let factors = 0;

  if (patterns.preferredDistances?.mean) {
    score += 0.3;
    factors++;
  }

  if (patterns.frequentAreas?.length > 0) {
    score += 0.3 * Math.min(patterns.frequentAreas.length / 3, 1);
    factors++;
  }

  if (patterns.preferredDirections?.length > 0) {
    score += 0.2 * patterns.preferredDirections[0].preference;
    factors++;
  }

  if (patterns.elevationTolerance?.mean !== undefined) {
    score += 0.2;
    factors++;
  }

  return factors > 0 ? score / factors : 0.5; // Default to 50% confidence
}

// Create mock route for fallback
function createMockRoute(name, targetDistance, trainingGoal, startLocation = null) {
  const elevationGain = trainingGoal === 'hills' ? targetDistance * 25 : 
                      trainingGoal === 'recovery' ? targetDistance * 5 : 
                      targetDistance * 15;

  // Generate mock coordinates if we have a start location
  let coordinates = [];
  if (startLocation) {
    coordinates = generateMockCoordinates(startLocation, targetDistance);
  }

  return {
    name: `${name} - ${getRouteNameByGoal(trainingGoal)}`,
    distance: targetDistance,
    elevationGain: Math.round(elevationGain),
    elevationLoss: Math.round(elevationGain * 0.9),
    coordinates,
    difficulty: calculateDifficulty(targetDistance, elevationGain),
    description: generateRouteDescription(trainingGoal, 'mock', { gain: elevationGain }),
    trainingGoal,
    pattern: 'mock',
    confidence: 0.5,
    elevationProfile: [],
    windFactor: 0.8,
    score: 0.6
  };
}

// Generate mock coordinates for a route
function generateMockCoordinates(startLocation, targetDistance) {
  const [startLon, startLat] = startLocation;
  const coordinates = [startLocation];
  
  // Approximate: 1 degree ≈ 111 km
  const radius = (targetDistance / (2 * Math.PI)) / 111; // Convert to degrees
  const numPoints = 8; // Create octagonal route
  
  for (let i = 1; i <= numPoints; i++) {
    const angle = (i * 45) * (Math.PI / 180); // 45 degrees apart
    const deltaLat = radius * Math.cos(angle);
    const deltaLon = radius * Math.sin(angle) / Math.cos(startLat * Math.PI / 180);
    
    coordinates.push([startLon + deltaLon, startLat + deltaLat]);
  }
  
  // Close the loop
  coordinates.push(startLocation);
  
  return coordinates;
}

// Generate out-and-back pattern
async function generateOutAndBackPattern(startLocation, halfDistance, direction, trainingGoal, weatherData, patternBasedSuggestions) {
  const [startLon, startLat] = startLocation;
  
  // Calculate target point for out-and-back
  const angle = direction.bearing * (Math.PI / 180);
  
  // Check for nearby frequent areas in the preferred direction
  const nearbyAreas = patternBasedSuggestions?.nearbyFrequentAreas || [];
  let targetPoint = null;
  
  // Try to use a frequent area as the turnaround point
  for (const area of nearbyAreas) {
    const areaBearing = calculateBearing(startLocation, area.center);
    const bearingDiff = Math.abs(areaBearing - direction.bearing);
    const normalizedDiff = bearingDiff > 180 ? 360 - bearingDiff : bearingDiff;
    
    const distanceToArea = calculateDistance(startLocation, area.center);
    
    // Use area if it's roughly in the right direction and distance
    if (normalizedDiff < 45 && 
        distanceToArea > halfDistance * 0.5 && 
        distanceToArea < halfDistance * 1.5) {
      targetPoint = area.center;
      console.log(`Using frequent area as turnaround point for ${direction.name}`);
      break;
    }
  }
  
  // If no suitable frequent area, calculate target point
  if (!targetPoint) {
    // Add some variation to avoid perfectly straight lines
    const angleVariation = angle + (Math.random() - 0.5) * 0.2;
    const distanceVariation = halfDistance * (0.8 + Math.random() * 0.4);
    
    const deltaLat = (distanceVariation / 111.32) * Math.cos(angleVariation);
    const deltaLon = (distanceVariation / (111.32 * Math.cos(startLat * Math.PI / 180))) * Math.sin(angleVariation);
    
    targetPoint = [startLon + deltaLon, startLat + deltaLat];
  }
  
  // Create simple out-and-back route
  const waypoints = [startLocation, targetPoint];
  
  // Get Mapbox token and try to generate route
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) {
    console.warn('Mapbox token not available');
    return null;
  }

  try {
    // Use cycling directions to get realistic route
    const outboundRoute = await getCyclingDirections(waypoints, mapboxToken, {
      profile: getMapboxProfile(trainingGoal)
    });
    
    if (!outboundRoute.coordinates || outboundRoute.coordinates.length < 5) {
      console.warn(`Failed to generate realistic outbound route for ${direction.name}`);
      return null;
    }
    
    // Create the return journey (reverse the coordinates)
    const returnCoordinates = [...outboundRoute.coordinates].reverse();
    
    // Combine outbound and return for full route
    const fullCoordinates = [...outboundRoute.coordinates, ...returnCoordinates.slice(1)]; // Skip duplicate start point
    
    const elevationProfile = await fetchElevationProfile(fullCoordinates, mapboxToken);
    const elevationStats = calculateElevationStats(elevationProfile);
    
    return {
      name: `${direction.name} - ${getRouteNameByGoal(trainingGoal)}`,
      distance: (outboundRoute.distance * 2) / 1000, // Convert to km and double for round trip
      elevationGain: elevationStats.gain,
      elevationLoss: elevationStats.loss,
      coordinates: fullCoordinates,
      difficulty: calculateDifficulty((outboundRoute.distance * 2) / 1000, elevationStats.gain),
      description: generateRouteDescription(trainingGoal, 'out_back', elevationStats),
      trainingGoal,
      pattern: 'out_back',
      confidence: outboundRoute.confidence,
      elevationProfile,
      windFactor: calculateWindFactor(fullCoordinates, weatherData),
    };
    
  } catch (error) {
    console.warn(`Failed to generate out-and-back route for ${direction.name}:`, error);
    return null;
  }
}

// Generate routes from past ride templates
async function generateRoutesFromTemplates(params) {
  const { startLocation, targetDistance, trainingGoal, routeType, templates } = params;
  const routes = [];
  
  // Find templates that match the desired route type and are near the start location
  const suitableTemplates = templates.filter(template => {
    // Check if template pattern matches desired route type
    if (routeType !== 'any' && template.pattern !== routeType) {
      return false;
    }
    
    // Check if template is near the start location
    const distanceToTemplate = calculateDistance(startLocation, template.startArea);
    if (distanceToTemplate > 10) { // Within 10km
      return false;
    }
    
    // Check if template distance is reasonable for target
    const distanceRatio = Math.abs(template.distance - targetDistance) / targetDistance;
    return distanceRatio < 0.5; // Within 50% of target distance
  });
  
  console.log(`Found ${suitableTemplates.length} suitable route templates`);
  
  // Use the best templates to create new routes
  for (let i = 0; i < Math.min(2, suitableTemplates.length); i++) {
    const template = suitableTemplates[i];
    
    try {
      // Adapt the template to the new start location
      const adaptedRoute = await adaptTemplateToLocation(template, startLocation, targetDistance, trainingGoal);
      
      if (adaptedRoute && adaptedRoute.coordinates && adaptedRoute.coordinates.length > 10) {
        routes.push(adaptedRoute);
        console.log(`Successfully adapted template route: ${template.distance}km -> ${adaptedRoute.distance}km`);
      }
    } catch (error) {
      console.warn('Failed to adapt template route:', error);
    }
  }
  
  return routes;
}

// Adapt a route template to a new location
async function adaptTemplateToLocation(template, newStartLocation, targetDistance, trainingGoal) {
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
  if (!mapboxToken) return null;
  
  // Scale and translate the template key points to the new start location
  const templateStart = template.keyPoints[0];
  const offset = [
    newStartLocation[0] - templateStart[0],
    newStartLocation[1] - templateStart[1]
  ];
  
  // Scale factor to adjust distance
  const scaleFactor = targetDistance / template.distance;
  
  const adaptedKeyPoints = template.keyPoints.map((point, index) => {
    if (index === 0) {
      return newStartLocation; // Always start at the new location
    }
    
    // Apply offset and scaling
    const relativePoint = [
      point[0] - templateStart[0],
      point[1] - templateStart[1]
    ];
    
    return [
      newStartLocation[0] + relativePoint[0] * scaleFactor,
      newStartLocation[1] + relativePoint[1] * scaleFactor
    ];
  });
  
  try {
    // Use Mapbox to create a realistic route through these adapted points
    const snappedRoute = await getCyclingDirections(adaptedKeyPoints, mapboxToken, {
      profile: getMapboxProfile(trainingGoal)
    });
    
    if (!snappedRoute.coordinates || snappedRoute.coordinates.length < 10) {
      return null;
    }
    
    const elevationProfile = await fetchElevationProfile(snappedRoute.coordinates, mapboxToken);
    const elevationStats = calculateElevationStats(elevationProfile);
    
    return {
      name: `Adapted Route - ${getRouteNameByGoal(trainingGoal)}`,
      distance: snappedRoute.distance / 1000,
      elevationGain: elevationStats.gain,
      elevationLoss: elevationStats.loss,
      coordinates: snappedRoute.coordinates,
      difficulty: calculateDifficulty(snappedRoute.distance / 1000, elevationStats.gain),
      description: 'Based on your past riding patterns',
      trainingGoal,
      pattern: template.pattern,
      confidence: template.confidence * 0.9, // Slightly lower confidence since it's adapted
      elevationProfile,
      source: 'template',
      originalTemplate: template.id
    };
    
  } catch (error) {
    console.warn('Failed to adapt template:', error);
    return null;
  }
}
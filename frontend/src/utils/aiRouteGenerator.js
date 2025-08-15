// AI Route Generation Engine
// Smart route generation considering training goals, weather, and conditions

import { mapMatchRoute, fetchElevationProfile, calculateElevationStats, getCyclingDirections } from './directions';
import { getWeatherData, getWindFactor, getOptimalTrainingConditions } from './weather';
import { calculateBearing } from './routeUtils';
import { fetchPastRides, analyzeRidingPatterns, generateRouteFromPatterns } from './rideAnalysis';

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
  
  // Generate route variations
  const routeVariations = await generateRouteVariations({
    startLocation,
    targetDistance,
    trainingGoal,
    routeType,
    weatherData,
    ridingPatterns,
    patternBasedSuggestions
  });

  // Score and rank routes
  const scoredRoutes = await scoreRoutes(routeVariations, {
    trainingGoal,
    weatherData,
    timeAvailable,
    ridingPatterns
  });

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

// Generate multiple route variations
async function generateRouteVariations(params) {
  const { startLocation, targetDistance, trainingGoal, routeType, weatherData, ridingPatterns, patternBasedSuggestions } = params;
  
  const routes = [];
  
  // Generate different route patterns based on type
  switch (routeType) {
    case 'loop':
      routes.push(...await generateLoopRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions));
      break;
    case 'out_back':
      routes.push(...await generateOutAndBackRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions));
      break;
    case 'point_to_point':
      routes.push(...await generatePointToPointRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions));
      break;
  }

  return routes;
}

// Generate loop routes
async function generateLoopRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions) {
  const routes = [];
  const [startLon, startLat] = startLocation;
  
  // Generate different loop patterns, prioritizing preferred directions
  let patterns = [
    { name: 'North Loop', bearing: 0, variation: 'north' },
    { name: 'East Loop', bearing: 90, variation: 'east' },
    { name: 'South Loop', bearing: 180, variation: 'south' },
    { name: 'West Loop', bearing: 270, variation: 'west' },
  ];

  // If we have pattern-based suggestions, prioritize preferred direction
  if (patternBasedSuggestions?.preferredDirection?.source === 'historical') {
    const preferredBearing = patternBasedSuggestions.preferredDirection.bearing;
    patterns = patterns.sort((a, b) => {
      const aDiff = Math.abs(a.bearing - preferredBearing);
      const bDiff = Math.abs(b.bearing - preferredBearing);
      return aDiff - bDiff;
    });
    console.log(`Prioritizing routes in direction: ${preferredBearing}° based on riding history`);
  }

  for (const pattern of patterns) {
    try {
      const route = await generateLoopPattern(
        startLocation,
        targetDistance,
        pattern,
        trainingGoal,
        weatherData,
        patternBasedSuggestions
      );
      if (route) routes.push(route);
    } catch (error) {
      console.warn(`Failed to generate ${pattern.name}:`, error);
    }
  }

  return routes;
}

// Generate a specific loop pattern
async function generateLoopPattern(startLocation, targetDistance, pattern, trainingGoal, weatherData, patternBasedSuggestions) {
  const [startLon, startLat] = startLocation;
  
  // Calculate approximate radius for the loop
  const radius = (targetDistance / (2 * Math.PI)) * 0.9; // Slightly larger for realistic cycling routes
  
  // Check if we have nearby frequent areas to incorporate
  const nearbyAreas = patternBasedSuggestions?.nearbyFrequentAreas || [];
  
  // Generate waypoints for the loop
  const waypoints = [startLocation];
  const numPoints = 4; // Fewer points for more natural cycling routes
  
  for (let i = 1; i <= numPoints; i++) {
    let targetPoint;
    
    // Try to use frequent areas if available and close enough
    if (nearbyAreas.length > 0 && i <= nearbyAreas.length) {
      const area = nearbyAreas[i - 1];
      const distanceToArea = calculateDistance(startLocation, area.center);
      
      // Use frequent area if it's within reasonable distance
      if (distanceToArea < radius * 2) {
        targetPoint = area.center;
        console.log(`Using frequent area for waypoint ${i}:`, area.center);
      }
    }
    
    // If no frequent area used, generate geometric point
    if (!targetPoint) {
      const angle = (pattern.bearing + (i * 90)) * (Math.PI / 180); // 90 degrees apart for square-ish loop
      
      // Add some variation for natural routes
      const radiusVariation = radius * (0.7 + Math.random() * 0.6);
      const angleVariation = angle + (Math.random() - 0.5) * 0.5;
      
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
    // Use Directions API first for better cycling routes
    let snappedRoute = await getCyclingDirections(waypoints, mapboxToken, {
      profile: getMapboxProfile(trainingGoal)
    });

    // If directions API fails, fall back to map matching
    if (!snappedRoute.coordinates || snappedRoute.coordinates.length < 2 || snappedRoute.confidence < 0.5) {
      console.log('Falling back to map matching for route:', pattern.name);
      snappedRoute = await mapMatchRoute(waypoints, mapboxToken, {
        profile: getMapboxProfile(trainingGoal)
      });
    }

    if (!snappedRoute.coordinates || snappedRoute.coordinates.length < 2) {
      console.warn('Both directions and map matching failed for:', pattern.name);
      return createMockRoute(pattern.name, targetDistance, trainingGoal, startLocation);
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

// Generate out-and-back routes
async function generateOutAndBackRoutes(startLocation, targetDistance, trainingGoal, weatherData, patternBasedSuggestions) {
  const routes = [];
  const halfDistance = targetDistance / 2;
  
  // Generate different directions
  const directions = [
    { name: 'North Route', bearing: 0 },
    { name: 'Northeast Route', bearing: 45 },
    { name: 'East Route', bearing: 90 },
    { name: 'Southeast Route', bearing: 135 },
  ];

  for (const direction of directions) {
    try {
      const route = await generateOutAndBackPattern(
        startLocation,
        halfDistance,
        direction,
        trainingGoal,
        weatherData
      );
      if (route) routes.push(route);
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
async function generateOutAndBackPattern(startLocation, halfDistance, direction, trainingGoal, weatherData) {
  // Similar implementation to generateLoopPattern but for straight line out and back
  return createMockRoute(direction.name, halfDistance * 2, trainingGoal, startLocation);
}
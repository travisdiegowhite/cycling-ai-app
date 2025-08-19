// Past ride analysis for intelligent route generation
import { supabase } from '../supabase';
import { calculateBearing } from './routeUtils';

// Fetch user's past rides from database
export async function fetchPastRides(userId, limit = 50) {
  try {
    const { data: rides, error } = await supabase
      .from('activities')
      .select(`
        id,
        filename,
        activity_type,
        uploaded_at,
        track_points,
        summary
      `)
      .eq('user_id', userId)
      .eq('activity_type', 'cycling')
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching past rides:', error);
      return [];
    }

    return rides || [];
  } catch (error) {
    console.error('Failed to fetch past rides:', error);
    return [];
  }
}

// Analyze riding patterns from past rides
export function analyzeRidingPatterns(pastRides) {
  if (!pastRides || pastRides.length === 0) {
    return getDefaultPatterns();
  }

  const patterns = {
    preferredDistances: [],
    preferredDirections: [],
    elevationPreference: 'moderate',
    averageSpeed: 23, // km/h
    frequentAreas: [],
    timePreferences: {},
    distanceDistribution: {},
    elevationTolerance: { min: 0, max: 1000, preferred: 300 },
    routeSegments: [], // New: actual route segments from past rides
    routeTemplates: [] // New: route templates based on past rides
  };

  // Analyze distance preferences
  const distances = pastRides
    .map(ride => ride.summary?.distance)
    .filter(d => d && d > 0);
  
  if (distances.length > 0) {
    patterns.preferredDistances = analyzeDistanceDistribution(distances);
    patterns.distanceDistribution = getDistanceDistribution(distances);
  }

  // Analyze elevation preferences
  const elevationGains = pastRides
    .map(ride => ride.summary?.elevation_gain)
    .filter(e => e !== null && e !== undefined);
  
  if (elevationGains.length > 0) {
    patterns.elevationTolerance = analyzeElevationPreference(elevationGains);
    patterns.elevationPreference = categorizeElevationPreference(elevationGains);
  }

  // Analyze frequent areas and directions
  const rideLocations = pastRides
    .map(ride => extractRideLocations(ride))
    .filter(locations => locations.length > 0);
  
  if (rideLocations.length > 0) {
    patterns.frequentAreas = findFrequentAreas(rideLocations);
    patterns.preferredDirections = analyzePreferredDirections(rideLocations);
  }

  // Extract route segments from all past rides
  const allSegments = pastRides
    .map(ride => extractRouteSegments(ride))
    .flat()
    .filter(segment => segment.coordinates.length > 0);
  
  patterns.routeSegments = buildSegmentDatabase(allSegments);
  
  // Create route templates from past rides
  patterns.routeTemplates = createRouteTemplates(pastRides);

  return patterns;
}

// Extract actual route segments from a ride
function extractRouteSegments(ride) {
  if (!ride.track_points || ride.track_points.length < 10) {
    return [];
  }

  const trackPoints = ride.track_points;
  const segments = [];
  
  // Extract meaningful segments (every ~2km or significant direction changes)
  const segmentDistance = 2; // km
  let currentSegment = [trackPoints[0]];
  let segmentDistance_m = 0;
  
  for (let i = 1; i < trackPoints.length; i++) {
    const prev = trackPoints[i - 1];
    const curr = trackPoints[i];
    
    // Calculate distance between points
    const distance = calculateDistance(
      [prev.longitude, prev.latitude],
      [curr.longitude, curr.latitude]
    ) * 1000; // Convert to meters
    
    segmentDistance_m += distance;
    currentSegment.push(curr);
    
    // End segment if we've traveled enough distance or reached end
    if (segmentDistance_m >= segmentDistance * 1000 || i === trackPoints.length - 1) {
      if (currentSegment.length >= 5) { // Ensure segment has enough points
        segments.push({
          coordinates: currentSegment.map(p => [p.longitude, p.latitude]),
          startPoint: [currentSegment[0].longitude, currentSegment[0].latitude],
          endPoint: [currentSegment[currentSegment.length - 1].longitude, currentSegment[currentSegment.length - 1].latitude],
          distance: segmentDistance_m / 1000, // km
          bearing: calculateBearing(
            [currentSegment[0].longitude, currentSegment[0].latitude],
            [currentSegment[currentSegment.length - 1].longitude, currentSegment[currentSegment.length - 1].latitude]
          ),
          rideId: ride.id,
          timestamp: ride.uploaded_at
        });
      }
      
      // Start new segment
      currentSegment = [curr];
      segmentDistance_m = 0;
    }
  }
  
  return segments;
}

// Extract key locations and route patterns from a ride
function extractRideLocations(ride) {
  if (!ride.track_points || ride.track_points.length === 0) {
    return [];
  }

  const trackPoints = ride.track_points;
  const locations = [];
  
  // Extract key junction points and decision points
  const keyPoints = findKeyPoints(trackPoints);
  
  keyPoints.forEach((point, index) => {
    locations.push({
      lat: point.latitude,
      lon: point.longitude,
      type: index === 0 ? 'start' : index === keyPoints.length - 1 ? 'end' : 'junction',
      confidence: point.confidence || 1.0
    });
  });

  return locations;
}

// Find key decision points in a route (turns, junctions, etc.)
function findKeyPoints(trackPoints) {
  if (trackPoints.length < 3) return trackPoints;
  
  const keyPoints = [trackPoints[0]]; // Always include start
  
  // Look for significant bearing changes (turns)
  for (let i = 1; i < trackPoints.length - 1; i++) {
    const prev = trackPoints[i - 1];
    const curr = trackPoints[i];
    const next = trackPoints[i + 1];
    
    const bearing1 = calculateBearing([prev.longitude, prev.latitude], [curr.longitude, curr.latitude]);
    const bearing2 = calculateBearing([curr.longitude, curr.latitude], [next.longitude, next.latitude]);
    
    let bearingChange = Math.abs(bearing2 - bearing1);
    if (bearingChange > 180) bearingChange = 360 - bearingChange;
    
    // If significant turn (>30 degrees), mark as key point
    if (bearingChange > 30) {
      keyPoints.push({
        ...curr,
        confidence: Math.min(bearingChange / 90, 1.0) // Higher confidence for sharper turns
      });
    }
  }
  
  keyPoints.push(trackPoints[trackPoints.length - 1]); // Always include end
  
  return keyPoints;
}

// Find areas where user frequently rides
function findFrequentAreas(rideLocations) {
  const areas = [];
  const tolerance = 0.01; // ~1km tolerance for grouping locations

  // Flatten all locations
  const allLocations = rideLocations.flat();

  // Group nearby locations
  const clusters = [];
  allLocations.forEach(location => {
    let addedToCluster = false;
    
    for (const cluster of clusters) {
      const centerLat = cluster.reduce((sum, p) => sum + p.lat, 0) / cluster.length;
      const centerLon = cluster.reduce((sum, p) => sum + p.lon, 0) / cluster.length;
      
      const distance = Math.sqrt(
        Math.pow(location.lat - centerLat, 2) + 
        Math.pow(location.lon - centerLon, 2)
      );
      
      if (distance < tolerance) {
        cluster.push(location);
        addedToCluster = true;
        break;
      }
    }
    
    if (!addedToCluster) {
      clusters.push([location]);
    }
  });

  // Convert clusters to frequent areas
  clusters
    .filter(cluster => cluster.length >= 3) // At least 3 visits
    .forEach(cluster => {
      const centerLat = cluster.reduce((sum, p) => sum + p.lat, 0) / cluster.length;
      const centerLon = cluster.reduce((sum, p) => sum + p.lon, 0) / cluster.length;
      
      areas.push({
        center: [centerLon, centerLat],
        frequency: cluster.length,
        confidence: Math.min(cluster.length / 10, 1) // Max confidence at 10+ visits
      });
    });

  return areas.sort((a, b) => b.frequency - a.frequency).slice(0, 5); // Top 5 areas
}

// Analyze preferred riding directions
function analyzePreferredDirections(rideLocations) {
  const directions = [];
  
  rideLocations.forEach(locations => {
    if (locations.length < 2) return;
    
    for (let i = 0; i < locations.length - 1; i++) {
      const start = [locations[i].lon, locations[i].lat];
      const end = [locations[i + 1].lon, locations[i + 1].lat];
      const bearing = calculateBearing(start, end);
      directions.push(bearing);
    }
  });

  if (directions.length === 0) return [];

  // Group directions into sectors (45-degree sectors)
  const sectors = Array(8).fill(0);
  directions.forEach(bearing => {
    const sector = Math.floor(((bearing + 22.5) % 360) / 45);
    sectors[sector]++;
  });

  // Find preferred directions
  const sectorNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const preferences = sectors
    .map((count, index) => ({
      direction: sectorNames[index],
      bearing: index * 45,
      frequency: count,
      preference: count / directions.length
    }))
    .filter(p => p.preference > 0.1) // At least 10% of rides
    .sort((a, b) => b.frequency - a.frequency);

  return preferences.slice(0, 3); // Top 3 preferred directions
}

// Analyze distance distribution patterns
function analyzeDistanceDistribution(distances) {
  const sorted = [...distances].sort((a, b) => a - b);
  const percentiles = {
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p50: sorted[Math.floor(sorted.length * 0.5)], // median
    p75: sorted[Math.floor(sorted.length * 0.75)],
    p90: sorted[Math.floor(sorted.length * 0.9)]
  };

  const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length;

  return {
    mean,
    median: percentiles.p50,
    percentiles,
    range: { min: sorted[0], max: sorted[sorted.length - 1] },
    mostCommon: findMostCommonDistanceRange(distances)
  };
}

// Find the most common distance range
function findMostCommonDistanceRange(distances) {
  const ranges = [
    { min: 0, max: 15, name: 'short' },
    { min: 15, max: 35, name: 'medium' },
    { min: 35, max: 65, name: 'long' },
    { min: 65, max: 150, name: 'very_long' }
  ];

  const rangeCounts = ranges.map(range => ({
    ...range,
    count: distances.filter(d => d >= range.min && d < range.max).length
  }));

  return rangeCounts.reduce((best, current) => 
    current.count > best.count ? current : best
  );
}

// Get distance distribution by categories
function getDistanceDistribution(distances) {
  const total = distances.length;
  return {
    short: distances.filter(d => d < 20).length / total,
    medium: distances.filter(d => d >= 20 && d < 50).length / total,
    long: distances.filter(d => d >= 50 && d < 100).length / total,
    veryLong: distances.filter(d => d >= 100).length / total
  };
}

// Analyze elevation gain preferences
function analyzeElevationPreference(elevationGains) {
  const sorted = [...elevationGains].sort((a, b) => a - b);
  const mean = elevationGains.reduce((sum, e) => sum + e, 0) / elevationGains.length;
  
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(mean),
    preferred: Math.round(sorted[Math.floor(sorted.length * 0.6)]), // 60th percentile
    tolerance: Math.round(sorted[Math.floor(sorted.length * 0.8)]) // 80th percentile
  };
}

// Categorize elevation preference
function categorizeElevationPreference(elevationGains) {
  const mean = elevationGains.reduce((sum, e) => sum + e, 0) / elevationGains.length;
  
  if (mean < 200) return 'flat';
  if (mean < 500) return 'rolling';
  if (mean < 1000) return 'hilly';
  return 'mountainous';
}

// Generate route suggestions based on patterns
export function generateRouteFromPatterns(patterns, params) {
  const { startLocation, targetDistance, trainingGoal } = params;
  
  // Find preferred areas near the start location
  const nearbyAreas = patterns.frequentAreas.filter(area => {
    const distance = calculateDistance(startLocation, area.center);
    return distance < 20; // Within 20km
  });

  // Select preferred direction
  const preferredDirection = selectPreferredDirection(patterns.preferredDirections, params);

  // Adjust target distance based on patterns
  const adjustedDistance = adjustDistanceBasedOnPatterns(targetDistance, patterns, trainingGoal);

  return {
    adjustedDistance,
    preferredDirection,
    nearbyFrequentAreas: nearbyAreas,
    elevationTarget: getElevationTarget(patterns, trainingGoal),
    confidence: calculatePatternConfidence(patterns),
    ridingPatterns: patterns // Pass the full patterns including segments and templates
  };
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

// Select preferred direction based on patterns and training goal
function selectPreferredDirection(directions, params) {
  if (!directions || directions.length === 0) {
    // Default directions based on training goal
    const defaultDirections = {
      hills: [0, 45], // North, Northeast (often hillier)
      endurance: [90, 270], // East, West (longer routes)
      intervals: [180, 0], // South, North
      recovery: [135, 225] // Southeast, Southwest (gentler)
    };
    
    const defaults = defaultDirections[params.trainingGoal] || [90, 270];
    return { bearing: defaults[0], preference: 0.5, source: 'default' };
  }

  // Use most preferred direction
  return { 
    ...directions[0], 
    source: 'historical' 
  };
}

// Adjust distance based on historical patterns
function adjustDistanceBasedOnPatterns(targetDistance, patterns, trainingGoal) {
  if (!patterns.preferredDistances.mean) return targetDistance;

  const userMean = patterns.preferredDistances.mean;
  const confidence = patterns.preferredDistances.range.max > patterns.preferredDistances.range.min ? 1 : 0.5;

  // For recovery rides, bias towards shorter distances
  if (trainingGoal === 'recovery') {
    return Math.min(targetDistance, userMean * 0.8);
  }

  // For endurance rides, can go longer
  if (trainingGoal === 'endurance') {
    return Math.max(targetDistance, userMean * 1.2);
  }

  // Otherwise, blend target with user's typical distance
  const weight = confidence * 0.3; // 30% influence maximum
  return targetDistance * (1 - weight) + userMean * weight;
}

// Get elevation target based on patterns and training goal
function getElevationTarget(patterns, trainingGoal) {
  const baseTarget = patterns.elevationTolerance.preferred || 300;
  
  const multipliers = {
    hills: 1.5,
    endurance: 1.0,
    intervals: 0.8,
    recovery: 0.5
  };
  
  return Math.round(baseTarget * (multipliers[trainingGoal] || 1.0));
}

// Calculate confidence in patterns (0-1)
function calculatePatternConfidence(patterns) {
  let score = 0;
  let factors = 0;

  // Distance pattern confidence
  if (patterns.preferredDistances.mean) {
    score += 0.3;
    factors++;
  }

  // Area familiarity confidence
  if (patterns.frequentAreas.length > 0) {
    score += 0.3 * Math.min(patterns.frequentAreas.length / 3, 1);
    factors++;
  }

  // Direction preference confidence
  if (patterns.preferredDirections.length > 0) {
    score += 0.2 * patterns.preferredDirections[0].preference;
    factors++;
  }

  // Elevation pattern confidence
  if (patterns.elevationTolerance.mean !== undefined) {
    score += 0.2;
    factors++;
  }

  return factors > 0 ? score / factors : 0;
}

// Build a database of route segments for reuse
function buildSegmentDatabase(allSegments) {
  const segmentDatabase = [];
  const tolerance = 0.005; // ~500m tolerance for grouping similar segments
  
  // Group similar segments together
  allSegments.forEach(segment => {
    let addedToGroup = false;
    
    for (const dbSegment of segmentDatabase) {
      // Check if segments are similar (same start/end area and bearing)
      const startDistance = calculateDistance(segment.startPoint, dbSegment.startPoint);
      const endDistance = calculateDistance(segment.endPoint, dbSegment.endPoint);
      const bearingDiff = Math.abs(segment.bearing - dbSegment.bearing);
      const normalizedBearingDiff = bearingDiff > 180 ? 360 - bearingDiff : bearingDiff;
      
      if (startDistance < tolerance && endDistance < tolerance && normalizedBearingDiff < 30) {
        // This is a similar segment, merge it
        dbSegment.usageCount = (dbSegment.usageCount || 1) + 1;
        dbSegment.lastUsed = Math.max(dbSegment.lastUsed || 0, new Date(segment.timestamp).getTime());
        
        // Keep the most detailed coordinates
        if (segment.coordinates.length > dbSegment.coordinates.length) {
          dbSegment.coordinates = segment.coordinates;
        }
        
        addedToGroup = true;
        break;
      }
    }
    
    if (!addedToGroup) {
      segmentDatabase.push({
        ...segment,
        usageCount: 1,
        lastUsed: new Date(segment.timestamp).getTime(),
        quality: 'proven' // This segment comes from actual rides
      });
    }
  });
  
  // Sort by usage frequency and recency
  return segmentDatabase.sort((a, b) => {
    const scoreA = (a.usageCount || 1) * 0.7 + (a.lastUsed || 0) / 1000000000 * 0.3;
    const scoreB = (b.usageCount || 1) * 0.7 + (b.lastUsed || 0) / 1000000000 * 0.3;
    return scoreB - scoreA;
  });
}

// Create route templates from past rides
function createRouteTemplates(pastRides) {
  const templates = [];
  
  pastRides.forEach(ride => {
    if (!ride.track_points || ride.track_points.length < 20) return;
    
    const distance = ride.summary?.distance || 0;
    const elevationGain = ride.summary?.elevation_gain || 0;
    
    // Extract route shape/pattern
    const keyPoints = findKeyPoints(ride.track_points);
    
    if (keyPoints.length >= 3) { // Need at least start, middle, end
      const template = {
        id: ride.id,
        distance,
        elevationGain,
        keyPoints: keyPoints.map(p => [p.longitude, p.latitude]),
        startArea: [keyPoints[0].longitude, keyPoints[0].latitude],
        pattern: analyzeRoutePattern(keyPoints),
        segments: extractRouteSegments(ride),
        confidence: Math.min(keyPoints.length / 10, 1.0), // More key points = higher confidence
        timestamp: ride.uploaded_at
      };
      
      templates.push(template);
    }
  });
  
  return templates.sort((a, b) => b.confidence - a.confidence);
}

// Analyze the pattern of a route (loop, out-back, etc.)
function analyzeRoutePattern(keyPoints) {
  if (keyPoints.length < 3) return 'unknown';
  
  const start = keyPoints[0];
  const end = keyPoints[keyPoints.length - 1];
  
  // Check if it's a loop (start and end are close)
  const startEndDistance = calculateDistance(
    [start.longitude, start.latitude],
    [end.longitude, end.latitude]
  );
  
  if (startEndDistance < 0.5) { // Within 500m
    return 'loop';
  }
  
  // Check if it's out-and-back (similar path in reverse)
  if (keyPoints.length >= 4) {
    const midPoint = Math.floor(keyPoints.length / 2);
    const outbound = keyPoints.slice(0, midPoint);
    const inbound = keyPoints.slice(midPoint).reverse();
    
    // Check if outbound and inbound are similar
    let similarPoints = 0;
    const checkCount = Math.min(outbound.length, inbound.length);
    
    for (let i = 0; i < checkCount; i++) {
      const distance = calculateDistance(
        [outbound[i].longitude, outbound[i].latitude],
        [inbound[i].longitude, inbound[i].latitude]
      );
      if (distance < 1) { // Within 1km
        similarPoints++;
      }
    }
    
    if (similarPoints / checkCount > 0.6) { // 60% similar
      return 'out_back';
    }
  }
  
  return 'point_to_point';
}

// Use real route segments to build new routes
export function buildRouteFromSegments(startLocation, targetDistance, trainingGoal, patterns) {
  if (!patterns.routeSegments || patterns.routeSegments.length === 0) {
    return null;
  }
  
  const nearbySegments = patterns.routeSegments.filter(segment => {
    const distanceToStart = calculateDistance(startLocation, segment.startPoint);
    const distanceToEnd = calculateDistance(startLocation, segment.endPoint);
    return Math.min(distanceToStart, distanceToEnd) < 5; // Within 5km
  });
  
  if (nearbySegments.length === 0) {
    return null;
  }
  
  // Try to chain segments together to build a route
  const route = chainSegments(nearbySegments, startLocation, targetDistance);
  
  if (route && route.coordinates.length > 10) {
    return {
      name: 'Route from Your Rides',
      coordinates: route.coordinates,
      distance: route.distance,
      elevationGain: route.elevationGain || 0,
      elevationLoss: route.elevationLoss || 0,
      difficulty: calculateDifficulty(route.distance, route.elevationGain || 0),
      description: 'Built from your actual riding patterns',
      trainingGoal,
      pattern: 'historical',
      confidence: 0.95, // High confidence since it's from real rides
      source: 'segments'
    };
  }
  
  return null;
}

// Chain route segments together to build a complete route
function chainSegments(segments, startLocation, targetDistance) {
  // Simple implementation: find the best segment near start and use it
  // In a more advanced version, this would intelligently chain multiple segments
  
  let bestSegment = null;
  let bestDistance = Infinity;
  
  for (const segment of segments) {
    const distanceToStart = calculateDistance(startLocation, segment.startPoint);
    const distanceToEnd = calculateDistance(startLocation, segment.endPoint);
    const minDistance = Math.min(distanceToStart, distanceToEnd);
    
    if (minDistance < bestDistance && segment.distance <= targetDistance * 1.5) {
      bestDistance = minDistance;
      bestSegment = segment;
    }
  }
  
  if (bestSegment) {
    // If we're closer to the end point, reverse the segment
    const distanceToStart = calculateDistance(startLocation, bestSegment.startPoint);
    const distanceToEnd = calculateDistance(startLocation, bestSegment.endPoint);
    
    const coordinates = distanceToEnd < distanceToStart ? 
      [...bestSegment.coordinates].reverse() : 
      bestSegment.coordinates;
    
    return {
      coordinates,
      distance: bestSegment.distance,
      elevationGain: bestSegment.elevationGain || 0,
      elevationLoss: bestSegment.elevationLoss || 0
    };
  }
  
  return null;
}

// Calculate difficulty
function calculateDifficulty(distance, elevationGain) {
  const elevationRatio = elevationGain / distance; // meters per km
  
  if (elevationRatio < 10) return 'easy';
  if (elevationRatio < 25) return 'moderate';
  return 'hard';
}

// Default patterns for new users
function getDefaultPatterns() {
  return {
    preferredDistances: {
      mean: 25,
      median: 20,
      percentiles: { p25: 15, p50: 20, p75: 30, p90: 40 },
      range: { min: 10, max: 50 },
      mostCommon: { min: 15, max: 35, name: 'medium', count: 1 }
    },
    preferredDirections: [],
    elevationPreference: 'moderate',
    averageSpeed: 23,
    frequentAreas: [],
    timePreferences: {},
    distanceDistribution: {
      short: 0.3,
      medium: 0.5,
      long: 0.2,
      veryLong: 0.0
    },
    elevationTolerance: { min: 0, max: 1000, preferred: 300, mean: 300 },
    routeSegments: [],
    routeTemplates: []
  };
}
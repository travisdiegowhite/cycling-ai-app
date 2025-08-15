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
    elevationTolerance: { min: 0, max: 1000, preferred: 300 }
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

  return patterns;
}

// Extract key locations from a ride
function extractRideLocations(ride) {
  if (!ride.track_points || ride.track_points.length === 0) {
    return [];
  }

  const trackPoints = ride.track_points;
  const locations = [];

  // Start point
  if (trackPoints[0]) {
    locations.push({
      lat: trackPoints[0].latitude,
      lon: trackPoints[0].longitude,
      type: 'start'
    });
  }

  // Sample points along the route (every 10% of the route)
  const sampleIndices = [];
  for (let i = 10; i <= 90; i += 20) {
    const index = Math.floor((trackPoints.length - 1) * (i / 100));
    sampleIndices.push(index);
  }

  sampleIndices.forEach(index => {
    if (trackPoints[index]) {
      locations.push({
        lat: trackPoints[index].latitude,
        lon: trackPoints[index].longitude,
        type: 'waypoint'
      });
    }
  });

  // End point
  if (trackPoints[trackPoints.length - 1]) {
    locations.push({
      lat: trackPoints[trackPoints.length - 1].latitude,
      lon: trackPoints[trackPoints.length - 1].longitude,
      type: 'end'
    });
  }

  return locations;
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
    confidence: calculatePatternConfidence(patterns)
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
    elevationTolerance: { min: 0, max: 1000, preferred: 300, mean: 300 }
  };
}
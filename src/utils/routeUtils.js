// Advanced geometry utilities for route manipulation
import { lineString, point, nearestPointOnLine, simplify } from '@turf/turf';

// Find the nearest point on a line to a given coordinate
export function findNearestPointOnLine(lineCoords, targetCoord) {
  try {
    const line = lineString(lineCoords);
    const pt = point(targetCoord);
    const nearest = nearestPointOnLine(line, pt);
    
    return {
      coordinate: nearest.geometry.coordinates,
      index: nearest.properties.index,
      distance: nearest.properties.dist
    };
  } catch (error) {
    console.error('Nearest point calculation failed:', error);
    return null;
  }
}

// Insert a point into a route at the optimal location
export function insertWaypointInRoute(existingWaypoints, newCoordinate, threshold = 0.1) {
  if (existingWaypoints.length < 2) {
    return [...existingWaypoints, newCoordinate];
  }

  let bestIndex = existingWaypoints.length;
  let minDistance = Infinity;

  // Check each segment to find the best insertion point
  for (let i = 0; i < existingWaypoints.length - 1; i++) {
    const segmentStart = existingWaypoints[i];
    const segmentEnd = existingWaypoints[i + 1];
    
    const nearest = findNearestPointOnLine([segmentStart, segmentEnd], newCoordinate);
    
    if (nearest && nearest.distance < minDistance && nearest.distance < threshold) {
      minDistance = nearest.distance;
      bestIndex = i + 1;
    }
  }

  // Insert the new waypoint at the best position
  const result = [...existingWaypoints];
  result.splice(bestIndex, 0, newCoordinate);
  return result;
}

// Calculate bearing between two points
export function calculateBearing(start, end) {
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

// Smooth a route by removing unnecessary waypoints
export function simplifyRoute(waypoints, tolerance = 0.001) {
  if (waypoints.length <= 2) return waypoints;
  
  try {
    const line = lineString(waypoints);
    const simplified = simplify(line, { tolerance, highQuality: true });
    return simplified.geometry.coordinates;
  } catch (error) {
    console.error('Route simplification failed:', error);
    return waypoints;
  }
}

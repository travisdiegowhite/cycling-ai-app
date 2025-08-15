// Utility to convert an array of [lon, lat] coordinates to a minimal GPX string
export function pointsToGPX(points, { name = 'Route', creator = 'Cycling AI App' } = {}) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`;
  const meta = `<metadata><name>${escapeXml(name)}</name><time>${new Date().toISOString()}</time></metadata>`;
  const trkOpen = `<trk><name>${escapeXml(name)}</name><trkseg>`;
  const seg = points.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"><time>${new Date().toISOString()}</time></trkpt>`).join('');
  const trkClose = `</trkseg></trk>`;
  const footer = `</gpx>`;
  return [header, meta, trkOpen, seg, trkClose, footer].join('\n');
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] || c));
}

// Parse GPX file and extract route data
export function parseGPX(gpxContent) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    
    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Invalid GPX file format');
    }

    const metadata = extractMetadata(doc);
    const tracks = extractTracks(doc);
    const routes = extractRoutes(doc);
    const waypoints = extractWaypoints(doc);

    // Combine all track points
    let allTrackPoints = [...tracks, ...routes].flat().filter(point => 
      point && typeof point.latitude === 'number' && typeof point.longitude === 'number'
    );

    // Simplify large datasets to prevent database timeouts
    // Keep maximum 5000 points, using distance-based sampling for larger files
    if (allTrackPoints.length > 5000) {
      allTrackPoints = simplifyTrackPoints(allTrackPoints, 5000);
    }
    
    if (allTrackPoints.length === 0) {
      throw new Error('No valid track or route data found in GPX file');
    }

    return {
      metadata: metadata || { name: 'Unnamed Route' },
      trackPoints: allTrackPoints,
      waypoints: waypoints || [],
      summary: calculateSummary(allTrackPoints)
    };
  } catch (error) {
    throw new Error(`Failed to parse GPX: ${error.message}`);
  }
}

function extractMetadata(doc) {
  const metadata = doc.querySelector('metadata');
  const name = doc.querySelector('metadata > name')?.textContent || 
                doc.querySelector('trk > name')?.textContent || 
                doc.querySelector('rte > name')?.textContent || 
                'Imported Route';
  const time = doc.querySelector('metadata > time')?.textContent;
  const creator = doc.documentElement.getAttribute('creator') || 'Unknown';
  
  return {
    name: name.trim(),
    time,
    creator,
    description: metadata?.querySelector('desc')?.textContent?.trim()
  };
}

function extractTracks(doc) {
  const tracks = doc.querySelectorAll('trk');
  return Array.from(tracks).map(track => {
    const segments = track.querySelectorAll('trkseg');
    return Array.from(segments).map(segment => {
      const points = segment.querySelectorAll('trkpt');
      return Array.from(points).map((point, index) => {
        const lat = parseFloat(point.getAttribute('lat'));
        const lon = parseFloat(point.getAttribute('lon'));
        
        if (isNaN(lat) || isNaN(lon)) {
          return null; // Skip invalid points
        }
        
        return {
          latitude: lat,
          longitude: lon,
          elevation: point.querySelector('ele') ? parseFloat(point.querySelector('ele').textContent) : null,
          time: point.querySelector('time')?.textContent,
          sequence: index
        };
      }).filter(point => point !== null); // Remove null points
    }).flat();
  });
}

function extractRoutes(doc) {
  const routes = doc.querySelectorAll('rte');
  return Array.from(routes).map(route => {
    const points = route.querySelectorAll('rtept');
    return Array.from(points).map((point, index) => {
      const lat = parseFloat(point.getAttribute('lat'));
      const lon = parseFloat(point.getAttribute('lon'));
      
      if (isNaN(lat) || isNaN(lon)) {
        return null; // Skip invalid points
      }
      
      return {
        latitude: lat,
        longitude: lon,
        elevation: point.querySelector('ele') ? parseFloat(point.querySelector('ele').textContent) : null,
        time: point.querySelector('time')?.textContent,
        sequence: index
      };
    }).filter(point => point !== null); // Remove null points
  });
}

function extractWaypoints(doc) {
  const waypoints = doc.querySelectorAll('wpt');
  return Array.from(waypoints).map(wpt => ({
    latitude: parseFloat(wpt.getAttribute('lat')),
    longitude: parseFloat(wpt.getAttribute('lon')),
    name: wpt.querySelector('name')?.textContent,
    description: wpt.querySelector('desc')?.textContent,
    elevation: wpt.querySelector('ele') ? parseFloat(wpt.querySelector('ele').textContent) : null
  }));
}

function calculateSummary(trackPoints) {
  if (!trackPoints || trackPoints.length < 2) {
    return { 
      distance: 0, 
      elevationGain: 0, 
      elevationLoss: 0, 
      minElevation: null, 
      maxElevation: null,
      pointCount: trackPoints ? trackPoints.length : 0
    };
  }

  let totalDistance = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let minElevation = null;
  let maxElevation = null;

  for (let i = 1; i < trackPoints.length; i++) {
    const prev = trackPoints[i - 1];
    const curr = trackPoints[i];

    // Calculate distance using Haversine formula
    const distance = haversineDistance(
      prev.latitude, prev.longitude,
      curr.latitude, curr.longitude
    );
    totalDistance += distance;

    // Calculate elevation changes
    if (prev.elevation !== null && curr.elevation !== null) {
      const elevDiff = curr.elevation - prev.elevation;
      if (elevDiff > 0) {
        elevationGain += elevDiff;
      } else {
        elevationLoss += Math.abs(elevDiff);
      }

      if (minElevation === null || curr.elevation < minElevation) {
        minElevation = curr.elevation;
      }
      if (maxElevation === null || curr.elevation > maxElevation) {
        maxElevation = curr.elevation;
      }
    }
  }

  return {
    distance: totalDistance / 1000, // Convert to kilometers
    elevationGain: Math.round(elevationGain),
    elevationLoss: Math.round(elevationLoss),
    minElevation: minElevation ? Math.round(minElevation) : null,
    maxElevation: maxElevation ? Math.round(maxElevation) : null,
    pointCount: trackPoints.length
  };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Simplify track points using distance-based sampling to reduce database payload
function simplifyTrackPoints(points, maxPoints) {
  if (points.length <= maxPoints) {
    return points;
  }

  // Always keep first and last points
  const simplified = [points[0]];
  const step = Math.floor(points.length / (maxPoints - 2));
  
  // Sample points at regular intervals
  for (let i = step; i < points.length - 1; i += step) {
    simplified.push({
      ...points[i],
      sequence: simplified.length
    });
  }
  
  // Always add the last point
  simplified.push({
    ...points[points.length - 1],
    sequence: simplified.length
  });

  return simplified;
}

import FitParser from 'fit-file-parser';
import pako from 'pako';

// Parse FIT file and convert to our standard format
export function parseFIT(fitBuffer, isCompressed = false) {
  return new Promise((resolve, reject) => {
    try {
      // Decompress if needed
      let processedBuffer = fitBuffer;
      if (isCompressed) {
        try {
          console.log('Decompressing FIT file...');
          processedBuffer = pako.inflate(new Uint8Array(fitBuffer)).buffer;
          console.log('FIT file decompressed successfully');
        } catch (decompressError) {
          reject(new Error(`Failed to decompress FIT file: ${decompressError.message}`));
          return;
        }
      }

      const fitParser = new FitParser({
        force: true,
        speedUnit: 'km/h',
        lengthUnit: 'm',
        temperatureUnit: 'celsius',
        elapsedRecordField: true,
        mode: 'list'
      });

      fitParser.parse(processedBuffer, (error, data) => {
        if (error) {
          reject(new Error(`Failed to parse FIT file: ${error.message}`));
          return;
        }

        try {
          console.log('FIT file parsed successfully:', {
            sessions: data.sessions?.length,
            records: data.records?.length,
            activity: data.activity?.length
          });

          // Extract metadata
          const metadata = extractFITMetadata(data);
          
          // Extract track points from records
          const trackPoints = extractFITTrackPoints(data.records || []);
          
          // Calculate summary
          const summary = calculateFITSummary(trackPoints, data.sessions);

          resolve({
            metadata,
            trackPoints,
            summary
          });
        } catch (parseError) {
          reject(new Error(`Failed to process FIT data: ${parseError.message}`));
        }
      });
    } catch (error) {
      reject(new Error(`FIT parser initialization failed: ${error.message}`));
    }
  });
}

function extractFITMetadata(data) {
  const activity = data.activity?.[0];
  const session = data.sessions?.[0];
  const fileId = data.file_id?.[0];

  // Try to get activity name/description
  let name = 'FIT Activity';
  if (activity?.event && activity.event !== 'activity') {
    name = activity.event;
  } else if (session?.sport) {
    name = `${session.sport} Activity`;
  }

  // Get timestamp
  let time = null;
  if (session?.start_time) {
    time = session.start_time.toISOString();
  } else if (activity?.timestamp) {
    time = activity.timestamp.toISOString();
  } else if (data.records?.[0]?.timestamp) {
    time = data.records[0].timestamp.toISOString();
  }

  return {
    name: name,
    time: time,
    creator: fileId?.manufacturer || 'Garmin',
    description: `${session?.sport || 'Cycling'} activity from FIT file`,
    sport: session?.sport || 'cycling'
  };
}

function extractFITTrackPoints(records) {
  const trackPoints = [];

  records.forEach((record, index) => {
    // Only include records with position data
    if (record.position_lat && record.position_long) {
      const point = {
        latitude: record.position_lat,
        longitude: record.position_long,
        elevation: record.enhanced_altitude || record.altitude || null,
        time: record.timestamp ? record.timestamp.toISOString() : null,
        sequence: index,
        heartRate: record.heart_rate || null,
        power: record.power || null,
        cadence: record.cadence || null,
        speed: record.enhanced_speed || record.speed || null,
        temperature: record.temperature || null
      };

      // Convert speed from m/s to km/h if present
      if (point.speed) {
        point.speed = point.speed * 3.6;
      }

      trackPoints.push(point);
    }
  });

  return trackPoints;
}

function calculateFITSummary(trackPoints, sessions) {
  if (!trackPoints || trackPoints.length < 2) {
    return {
      distance: 0,
      elevationGain: 0,
      elevationLoss: 0,
      minElevation: null,
      maxElevation: null,
      duration: 0,
      maxSpeed: 0,
      avgHeartRate: 0,
      maxHeartRate: 0,
      avgPower: 0,
      maxPower: 0,
      pointCount: trackPoints ? trackPoints.length : 0
    };
  }

  let totalDistance = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let minElevation = null;
  let maxElevation = null;
  let maxSpeed = 0;
  let heartRates = [];
  let powers = [];

  // Calculate from track points
  for (let i = 1; i < trackPoints.length; i++) {
    const prev = trackPoints[i - 1];
    const curr = trackPoints[i];

    // Calculate distance using Haversine formula
    if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
      const distance = haversineDistance(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude
      );
      totalDistance += distance;
    }

    // Track elevation changes
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

    // Track max speed
    if (curr.speed && curr.speed > maxSpeed) {
      maxSpeed = curr.speed;
    }

    // Collect heart rate and power data
    if (curr.heartRate) heartRates.push(curr.heartRate);
    if (curr.power) powers.push(curr.power);
  }

  // Calculate duration
  let duration = 0;
  const firstPoint = trackPoints[0];
  const lastPoint = trackPoints[trackPoints.length - 1];
  if (firstPoint.time && lastPoint.time) {
    duration = (new Date(lastPoint.time) - new Date(firstPoint.time)) / 1000;
  }

  // Calculate averages
  const avgHeartRate = heartRates.length > 0 ? 
    heartRates.reduce((sum, hr) => sum + hr, 0) / heartRates.length : 0;
  const maxHeartRate = heartRates.length > 0 ? Math.max(...heartRates) : 0;
  const avgPower = powers.length > 0 ? 
    powers.reduce((sum, p) => sum + p, 0) / powers.length : 0;
  const maxPower = powers.length > 0 ? Math.max(...powers) : 0;

  return {
    distance: totalDistance / 1000, // Convert to kilometers
    elevationGain: Math.round(elevationGain),
    elevationLoss: Math.round(elevationLoss),
    minElevation: minElevation ? Math.round(minElevation) : null,
    maxElevation: maxElevation ? Math.round(maxElevation) : null,
    duration: Math.round(duration),
    maxSpeed: Math.round(maxSpeed * 10) / 10,
    avgHeartRate: Math.round(avgHeartRate),
    maxHeartRate,
    avgPower: Math.round(avgPower),
    maxPower,
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
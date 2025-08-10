// src/components/FileUpload.js
import React, { useState } from 'react';
import Papa from 'papaparse';
import './FileUpload.css';

const FileUpload = () => {
  // State to manage uploaded files and parsed data
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  // Supported file types for cycling data
  const supportedTypes = ['.gpx', '.tcx', '.csv'];

  // Handle file selection
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    setError(null); // Clear any previous errors
    
    if (file) {
      // Validate file type
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      
      if (supportedTypes.includes(fileExtension)) {
        setSelectedFile(file);
        processFile(file);
      } else {
        setError(`Unsupported file type. Please select a ${supportedTypes.join(', ')} file.`);
      }
    }
  };

  // Main file processing function
  const processFile = async (file) => {
    setIsProcessing(true);
    setError(null);
    
    try {
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      const fileContent = await readFileContent(file);
      
      let result;
      switch (fileExtension) {
        case '.gpx':
          result = await parseGPX(fileContent, file.name);
          break;
        case '.tcx':
          result = await parseTCX(fileContent, file.name);
          break;
        case '.csv':
          result = await parseCSV(fileContent, file.name);
          break;
        default:
          throw new Error('Unsupported file type');
      }
      
      setParsedData(result);
    } catch (err) {
      setError(`Error processing file: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Helper function to read file content
  const readFileContent = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  // Parse GPX files (GPS Exchange Format) using native DOMParser
  const parseGPX = async (content, filename) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(content, 'text/xml');
    
    // Check for parsing errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid GPX file format');
    }
    
    // Extract track points
    const trackPoints = [];
    const trkpts = xmlDoc.querySelectorAll('trkpt');
    
    trkpts.forEach(point => {
      const lat = point.getAttribute('lat');
      const lon = point.getAttribute('lon');
      const eleElement = point.querySelector('ele');
      const timeElement = point.querySelector('time');
      
      if (lat && lon) {
        trackPoints.push({
          latitude: parseFloat(lat),
          longitude: parseFloat(lon),
          elevation: eleElement ? parseFloat(eleElement.textContent) : null,
          timestamp: timeElement ? timeElement.textContent : null,
          // GPX files typically don't include power/HR data
          heartRate: null,
          power: null,
          cadence: null
        });
      }
    });
    
    // Get track name
    const nameElement = xmlDoc.querySelector('trk > name');
    const trackName = nameElement ? nameElement.textContent : 'Unknown Route';
    
    return {
      metadata: {
        filename: filename,
        type: 'gpx',
        uploadedAt: new Date().toISOString(),
        name: trackName
      },
      trackPoints: trackPoints,
      summary: calculateSummary(trackPoints)
    };
  };

  // Parse TCX files (Training Center XML) using native DOMParser
  const parseTCX = async (content, filename) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(content, 'text/xml');
    
    // Check for parsing errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid TCX file format');
    }
    
    const trackPoints = [];
    const trackpoints = xmlDoc.querySelectorAll('Trackpoint');
    
    trackpoints.forEach(point => {
      const position = point.querySelector('Position');
      const lat = position ? position.querySelector('LatitudeDegrees') : null;
      const lon = position ? position.querySelector('LongitudeDegrees') : null;
      const altitude = point.querySelector('AltitudeMeters');
      const time = point.querySelector('Time');
      const heartRate = point.querySelector('HeartRateBpm Value');
      const cadence = point.querySelector('Cadence');
      
      // Look for power in extensions
      const extensions = point.querySelector('Extensions');
      let power = null;
      if (extensions) {
        const powerElement = extensions.querySelector('Watts') || 
                           extensions.querySelector('TPX Watts') ||
                           extensions.querySelector('[tagName*="Watts"]');
        power = powerElement ? parseInt(powerElement.textContent) : null;
      }
      
      if (lat && lon) {
        trackPoints.push({
          latitude: parseFloat(lat.textContent),
          longitude: parseFloat(lon.textContent),
          elevation: altitude ? parseFloat(altitude.textContent) : null,
          timestamp: time ? time.textContent : null,
          heartRate: heartRate ? parseInt(heartRate.textContent) : null,
          power: power,
          cadence: cadence ? parseInt(cadence.textContent) : null
        });
      }
    });
    
    return {
      metadata: {
        filename: filename,
        type: 'tcx',
        uploadedAt: new Date().toISOString(),
        name: 'TCX Activity'
      },
      trackPoints: trackPoints,
      summary: calculateSummary(trackPoints)
    };
  };

  // Parse CSV files (exported data)
  const parseCSV = async (content, filename) => {
    return new Promise((resolve, reject) => {
      Papa.parse(content, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            reject(new Error('CSV parsing errors: ' + results.errors.map(e => e.message).join(', ')));
            return;
          }
          
          const trackPoints = results.data.map(row => ({
            latitude: row.latitude || row.lat || null,
            longitude: row.longitude || row.lon || row.lng || null,
            elevation: row.elevation || row.alt || row.altitude || null,
            timestamp: row.timestamp || row.time || null,
            heartRate: row.heartRate || row.hr || row.heart_rate || null,
            power: row.power || row.watts || null,
            cadence: row.cadence || row.rpm || null
          }));
          
          resolve({
            metadata: {
              filename: filename,
              type: 'csv',
              uploadedAt: new Date().toISOString(),
              name: 'CSV Data'
            },
            trackPoints: trackPoints,
            summary: calculateSummary(trackPoints)
          });
        },
        error: (error) => {
          reject(new Error('Failed to parse CSV: ' + error.message));
        }
      });
    });
  };

  // Calculate ride summary statistics
  const calculateSummary = (trackPoints) => {
    if (!trackPoints || trackPoints.length === 0) {
      return {
        distance: 0,
        duration: 0,
        elevationGain: 0,
        averagePower: null,
        averageHeartRate: null,
        maxElevation: null,
        minElevation: null
      };
    }

    // Calculate total distance using Haversine formula
    let totalDistance = 0;
    let elevationGain = 0;
    let powerSum = 0;
    let powerCount = 0;
    let hrSum = 0;
    let hrCount = 0;
    let maxElevation = null;
    let minElevation = null;

    for (let i = 1; i < trackPoints.length; i++) {
      const prev = trackPoints[i - 1];
      const curr = trackPoints[i];

      // Calculate distance between consecutive points
      if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
        totalDistance += calculateDistance(
          prev.latitude, prev.longitude,
          curr.latitude, curr.longitude
        );
      }

      // Calculate elevation gain
      if (prev.elevation !== null && curr.elevation !== null && curr.elevation > prev.elevation) {
        elevationGain += curr.elevation - prev.elevation;
      }

      // Track elevation extremes
      if (curr.elevation !== null) {
        maxElevation = maxElevation === null ? curr.elevation : Math.max(maxElevation, curr.elevation);
        minElevation = minElevation === null ? curr.elevation : Math.min(minElevation, curr.elevation);
      }

      // Average power and heart rate
      if (curr.power !== null) {
        powerSum += curr.power;
        powerCount++;
      }
      if (curr.heartRate !== null) {
        hrSum += curr.heartRate;
        hrCount++;
      }
    }

    // Calculate duration
    const firstPoint = trackPoints[0];
    const lastPoint = trackPoints[trackPoints.length - 1];
    let duration = 0;
    if (firstPoint.timestamp && lastPoint.timestamp) {
      duration = (new Date(lastPoint.timestamp) - new Date(firstPoint.timestamp)) / 1000; // seconds
    }

    return {
      distance: Math.round(totalDistance * 100) / 100, // Round to 2 decimal places
      duration: duration,
      elevationGain: Math.round(elevationGain),
      averagePower: powerCount > 0 ? Math.round(powerSum / powerCount) : null,
      averageHeartRate: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
      maxElevation: maxElevation,
      minElevation: minElevation,
      pointCount: trackPoints.length
    };
  };

  // Haversine formula for calculating distance between two GPS points
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Format duration for display
  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else {
      return `${minutes}m ${remainingSeconds}s`;
    }
  };

  return (
    <div className="file-upload-container">
      <div className="upload-section">
        <h2>Upload Cycling Data</h2>
        <div className="file-input-container">
          <input
            type="file"
            id="file-input"
            accept=".gpx,.tcx,.csv"
            onChange={handleFileSelect}
            className="file-input"
          />
          <label htmlFor="file-input" className="file-input-label">
            Choose File (.gpx, .tcx, .csv)
          </label>
        </div>
        
        {selectedFile && (
          <p className="selected-file">Selected: {selectedFile.name}</p>
        )}
        
        {isProcessing && (
          <div className="processing">
            <p>Processing file...</p>
          </div>
        )}
        
        {error && (
          <div className="error">
            <p>Error: {error}</p>
          </div>
        )}
      </div>

      {parsedData && (
        <div className="results-section">
          <h3>Ride Data Summary</h3>
          <div className="metadata">
            <p><strong>File:</strong> {parsedData.metadata.filename}</p>
            <p><strong>Type:</strong> {parsedData.metadata.type.toUpperCase()}</p>
            <p><strong>Uploaded:</strong> {new Date(parsedData.metadata.uploadedAt).toLocaleString()}</p>
          </div>
          
          <div className="summary-stats">
            <div className="stat">
              <label>Distance:</label>
              <span>{parsedData.summary.distance} km</span>
            </div>
            <div className="stat">
              <label>Duration:</label>
              <span>{formatDuration(parsedData.summary.duration)}</span>
            </div>
            <div className="stat">
              <label>Elevation Gain:</label>
              <span>{parsedData.summary.elevationGain} m</span>
            </div>
            {parsedData.summary.averagePower && (
              <div className="stat">
                <label>Average Power:</label>
                <span>{parsedData.summary.averagePower} watts</span>
              </div>
            )}
            {parsedData.summary.averageHeartRate && (
              <div className="stat">
                <label>Average Heart Rate:</label>
                <span>{parsedData.summary.averageHeartRate} bpm</span>
              </div>
            )}
            <div className="stat">
              <label>Data Points:</label>
              <span>{parsedData.summary.pointCount}</span>
            </div>
          </div>
          
          <div className="track-points-preview">
            <h4>Track Points Preview (first 5 points)</h4>
            <div className="points-table">
              {parsedData.trackPoints.slice(0, 5).map((point, index) => (
                <div key={index} className="point-row">
                  <span>Lat: {point.latitude?.toFixed(6)}</span>
                  <span>Lon: {point.longitude?.toFixed(6)}</span>
                  {point.elevation && <span>Ele: {point.elevation}m</span>}
                  {point.power && <span>Power: {point.power}W</span>}
                  {point.heartRate && <span>HR: {point.heartRate}bpm</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
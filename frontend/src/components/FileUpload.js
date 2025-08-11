// src/components/FileUpload.js
import React, { useState } from 'react';
import Papa from 'papaparse';
import './FileUpload.css';
import { supabase } from '../supabase';

const FileUpload = () => {
  // State to manage uploaded files and parsed data
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [processedFiles, setProcessedFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFile, setCurrentFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [uploadProgress, setUploadProgress] = useState(0);

  // Supported file types for cycling data
  const supportedTypes = ['.gpx', '.tcx', '.csv'];

  // Handle file selection
  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files);
    setErrors({});
    
    // Filter valid files
    const validFiles = files.filter(file => {
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      if (!supportedTypes.includes(fileExtension)) {
        setErrors(prev => ({
          ...prev,
          [file.name]: `Unsupported file type. Please select a ${supportedTypes.join(', ')} file.`
        }));
        return false;
      }
      return true;
    });

    setSelectedFiles(validFiles);
    if (validFiles.length > 0) {
      processFiles(validFiles);
    }
  };

  // Save route data to Supabase
  const saveRouteToSupabase = async (routeData) => {
    try {
      const { data, error } = await supabase
        .from('routes')
        .insert({
          metadata: routeData.metadata,
          track_points: routeData.trackPoints,
          summary: routeData.summary
        });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error saving to Supabase:', error);
      throw error;
    }
  };

  // Process multiple files
  const processFiles = async (files) => {
    setIsProcessing(true);
    setProcessedFiles([]);
    setUploadProgress(0);
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentFile(file);
      
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
        
        await saveRouteToSupabase(result);
        setProcessedFiles(prev => [...prev, { file, result, success: true }]);
      } catch (err) {
        setErrors(prev => ({
          ...prev,
          [file.name]: `Error processing file: ${err.message}`
        }));
        setProcessedFiles(prev => [...prev, { file, success: false, error: err.message }]);
      }
      
      setUploadProgress(((i + 1) / files.length) * 100);
    }
    
    setIsProcessing(false);
    setCurrentFile(null);
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
        <label htmlFor="file-upload" className={`upload-area ${isProcessing ? 'processing' : ''}`}>
          <input
            type="file"
            id="file-upload"
            onChange={handleFileSelect}
            accept=".gpx,.tcx,.csv"
            disabled={isProcessing}
            multiple
          />
          {isProcessing ? (
            <div className="processing-indicator">
              <div className="progress-bar">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <span>Processing: {currentFile?.name || 'Preparing files...'}</span>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
          ) : (
            <div className="upload-prompt">
              <span>Drag & drop your ride files here or click to browse</span>
              <small>Supported formats: GPX, TCX, CSV</small>
              <small>You can select multiple files</small>
            </div>
          )}
        </label>

        {Object.keys(errors).length > 0 && (
          <div className="errors">
            {Object.entries(errors).map(([filename, error]) => (
              <div key={filename} className="error">
                <p>{filename}: {error}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {processedFiles.length > 0 && (
        <div className="results-section">
          <h3>Processed Files ({processedFiles.length})</h3>
          {processedFiles.map(({ file, result, success, error }) => (
            <div key={file.name} className={`file-result ${success ? 'success' : 'error'}`}>
              <h4>{file.name}</h4>
              {success ? (
                <>
                  <div className="metadata">
                    <p><strong>Type:</strong> {result.metadata.type.toUpperCase()}</p>
                    <p><strong>Uploaded:</strong> {new Date(result.metadata.uploadedAt).toLocaleString()}</p>
                  </div>
                  
                  <div className="summary-stats">
                    <div className="stat">
                      <label>Distance:</label>
                      <span>{result.summary.distance} km</span>
                    </div>
                    <div className="stat">
                      <label>Duration:</label>
                      <span>{formatDuration(result.summary.duration)}</span>
                    </div>
                    <div className="stat">
                      <label>Elevation Gain:</label>
                      <span>{result.summary.elevationGain} m</span>
                    </div>
                    {result.summary.averagePower && (
                      <div className="stat">
                        <label>Average Power:</label>
                        <span>{result.summary.averagePower} watts</span>
                      </div>
                    )}
                    {result.summary.averageHeartRate && (
                      <div className="stat">
                        <label>Average Heart Rate:</label>
                        <span>{result.summary.averageHeartRate} bpm</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="error-message">
                  <p>{error}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
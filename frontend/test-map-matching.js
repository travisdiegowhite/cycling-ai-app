#!/usr/bin/env node

// Simple test to verify map matching functionality
const https = require('https');

const token = process.env.MAPBOX_TOKEN;
if (!token) {
  console.error('Error: MAPBOX_TOKEN environment variable is not set.');
  process.exit(1);
}

// Test with cycling route in San Francisco - closer points
const testCoords = [
  [-122.4194, 37.7749], // SF Financial District
  [-122.4184, 37.7759]  // Just a few blocks away
];

const coordinates = testCoords.map(([lon, lat]) => `${lon},${lat}`).join(';');
const radiuses = testCoords.map(() => 50).join(';'); // Max 50m allowed

const url = `https://api.mapbox.com/matching/v5/mapbox/cycling/${coordinates}?` +
  `geometries=geojson&` +
  `radiuses=${radiuses}&` +
  `steps=false&` +
  `annotations=distance,duration&` +
  `overview=full&` +
  `access_token=${token}`;

console.log('Testing Map Matching API...');
console.log('Input coordinates:', testCoords);
console.log('URL:', url);
console.log('');

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    if (res.statusCode !== 200) {
      console.log('Response:', data);
      return;
    }
    
    try {
      const result = JSON.parse(data);
      console.log('API Response Summary:');
      console.log('- Code:', result.code);
      console.log('- Matchings found:', result.matchings?.length || 0);
      
      if (result.matchings && result.matchings.length > 0) {
        const match = result.matchings[0];
        console.log('- Confidence:', match.confidence);
        console.log('- Distance:', match.distance, 'meters');
        console.log('- Duration:', match.duration, 'seconds');
        console.log('- Coordinates count:', match.geometry.coordinates.length);
        console.log('- First coordinate:', match.geometry.coordinates[0]);
        console.log('- Last coordinate:', match.geometry.coordinates[match.geometry.coordinates.length - 1]);
      }
      
      if (result.tracepoints) {
        console.log('- Tracepoints:', result.tracepoints.length);
      }
    } catch (e) {
      console.error('Error parsing JSON:', e.message);
      console.log('Raw response:', data);
    }
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});

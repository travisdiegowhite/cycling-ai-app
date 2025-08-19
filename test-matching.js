// Test script to verify map matching functionality
const { mapMatchRoute } = require('./src/utils/directions');

// Test coordinates in San Francisco (cycling-friendly area)
const testWaypoints = [
  [-122.4194, 37.7749], // SF downtown
  [-122.4094, 37.7849], // Slightly north
  [-122.3994, 37.7949]  // Further north
];

const token = process.env.MAPBOX_TOKEN;
if (!token) {
  throw new Error('MAPBOX_TOKEN environment variable is not set.');
}

async function testMapMatching() {
  console.log('Testing map matching with waypoints:', testWaypoints);
  
  try {
    const result = await mapMatchRoute(testWaypoints, token);
    console.log('Result:', result);
    console.log('Confidence:', result.confidence);
    console.log('Profile used:', result.profile);
    console.log('Coordinates count:', result.coordinates?.length || 0);
    console.log('Distance:', result.distance, 'meters');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testMapMatching();

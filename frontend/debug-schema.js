// Simple script to check actual database schema
import { supabase } from './src/supabase.js';

async function checkSchema() {
  console.log('Checking database schema...');
  
  try {
    // Try to get a small sample from track_points to see what columns exist
    const { data, error } = await supabase
      .from('track_points')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('Error querying track_points:', error);
    } else {
      console.log('Sample track point data:', data);
      if (data && data.length > 0) {
        console.log('Available columns:', Object.keys(data[0]));
      } else {
        console.log('No data found, but table exists');
      }
    }
    
    // Also try routes table
    const { data: routeData, error: routeError } = await supabase
      .from('routes')
      .select('*')
      .limit(1);
    
    if (routeError) {
      console.error('Error querying routes:', routeError);
    } else {
      console.log('Sample route data:', routeData);
      if (routeData && routeData.length > 0) {
        console.log('Available route columns:', Object.keys(routeData[0]));
      }
    }
    
  } catch (error) {
    console.error('Connection error:', error);
  }
}

checkSchema().then(() => {
  console.log('Schema check complete');
  process.exit(0);
}).catch(console.error);
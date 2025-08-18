# Supabase Schema Migration Guide

## Overview

This migration will transform your current database structure to optimize for better performance, especially for ride analysis and large datasets.

## Key Improvements

### 1. **Separated Track Points**
- **Before**: All GPS points stored as JSON in `routes.track_points` 
- **After**: GPS points in separate `track_points` table with proper indexing
- **Benefit**: Faster queries, better memory usage, can query specific GPS ranges

### 2. **Pre-calculated Statistics**
- **Before**: Statistics calculated on-the-fly from JSON data
- **After**: Distance, elevation, bounds pre-calculated and stored
- **Benefit**: Dashboard loads instantly, no timeout issues

### 3. **Optimized Elevation Profiles**
- **Before**: Full elevation data with every GPS point
- **After**: Simplified elevation profile with ~100 points for charts
- **Benefit**: Charts load faster, less data transfer

### 4. **Better User Management**
- **Before**: Missing `user_id` on uploaded routes
- **After**: Proper user association with RLS policies
- **Benefit**: True user data isolation, proper security

## Migration Steps

### Step 1: Backup Current Data
```sql
-- Create backup of current routes
CREATE TABLE routes_backup AS SELECT * FROM routes;
```

### Step 2: Create New Schema
Run the `database-schema.sql` file in your Supabase SQL editor.

### Step 3: Migrate Data
```sql
-- Rename current table
ALTER TABLE routes RENAME TO routes_old;

-- Run the migration function (this will take time for 335 routes)
SELECT migrate_old_routes();

-- Verify migration
SELECT COUNT(*) as old_routes FROM routes_old;
SELECT COUNT(*) as new_routes FROM routes;
SELECT COUNT(*) as track_points FROM track_points;
```

### Step 4: Update Application Code
You'll need to update your upload and query logic to use the new schema.

## Database Performance Benefits

### Before Migration
```sql
-- This query times out with 335 routes:
SELECT * FROM routes WHERE user_id = 'xxx';
```

### After Migration
```sql
-- This will be instant:
SELECT 
    id, name, distance_km, elevation_gain_m, created_at 
FROM routes 
WHERE user_id = 'xxx' 
ORDER BY created_at DESC 
LIMIT 50;

-- Getting track points for a specific route is also fast:
SELECT latitude, longitude, elevation_m 
FROM track_points 
WHERE route_id = 'xxx' 
ORDER BY sequence_number;
```

## New Upload Process

### 1. **Create Route Record**
```javascript
const { data: route } = await supabase
  .from('routes')
  .insert({
    user_id: user.id,
    name: gpxData.name,
    source: 'upload',
    filename: file.name
  })
  .select()
  .single();
```

### 2. **Bulk Insert Track Points**
```javascript
const trackPoints = gpxData.points.map((point, index) => ({
  route_id: route.id,
  latitude: point.lat,
  longitude: point.lon,
  elevation_m: point.ele,
  timestamp_utc: point.time,
  sequence_number: index
}));

await supabase.from('track_points').insert(trackPoints);
```

### 3. **Calculate Statistics**
```javascript
await supabase.rpc('calculate_route_stats', { route_uuid: route.id });
await supabase.rpc('generate_elevation_profile', { route_uuid: route.id });
```

## New Analysis Queries

### Dashboard Statistics
```sql
SELECT 
    COUNT(*) as total_routes,
    SUM(distance_km) as total_distance,
    SUM(elevation_gain_m) as total_elevation,
    AVG(distance_km) as avg_distance
FROM routes 
WHERE user_id = 'xxx';
```

### Monthly Analysis
```sql
SELECT 
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as ride_count,
    SUM(distance_km) as total_distance,
    SUM(elevation_gain_m) as total_elevation
FROM routes 
WHERE user_id = 'xxx'
GROUP BY month
ORDER BY month;
```

### Route Details with Elevation
```sql
-- Get route summary
SELECT * FROM routes WHERE id = 'xxx';

-- Get elevation profile for chart
SELECT distance_km, elevation_m 
FROM elevation_profiles 
WHERE route_id = 'xxx' 
ORDER BY sequence_number;

-- Get full GPS track (only when needed)
SELECT latitude, longitude, elevation_m, timestamp_utc
FROM track_points 
WHERE route_id = 'xxx' 
ORDER BY sequence_number;
```

## File Upload Component Updates

I'll create an updated version of your FileUpload component that works with the new schema. The key changes:

1. **Separate track points insertion**
2. **Automatic statistics calculation**
3. **Better progress tracking**
4. **Proper user association**

## Benefits After Migration

1. **⚡ Performance**: Dashboard loads in <2 seconds instead of timing out
2. **📊 Better Analytics**: Pre-calculated stats enable complex analysis
3. **🔒 Security**: Proper RLS policies protect user data
4. **📈 Scalability**: Can handle thousands of routes efficiently
5. **🗺️ Map Features**: Bounds enable efficient map queries
6. **📱 Mobile**: Reduced data transfer for mobile apps

## Rollback Plan

If needed, you can rollback by:
```sql
-- Restore from backup
DROP TABLE routes;
ALTER TABLE routes_backup RENAME TO routes;
```

Would you like me to proceed with creating the updated upload component that works with this new schema?
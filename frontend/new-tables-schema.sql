-- NEW OPTIMIZED TABLES (alongside existing routes table)
-- This creates new tables without touching your existing data

-- ====================
-- NEW OPTIMIZED ROUTES TABLE
-- ====================

-- New routes table with optimized structure
CREATE TABLE IF NOT EXISTS routes_v2 (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Metadata
    name TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL CHECK (source IN ('upload', 'builder', 'ai_generated')),
    filename TEXT, -- Original filename for uploads
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Route Summary Statistics (pre-calculated for performance)
    distance_km DECIMAL(8,3), -- Distance in kilometers
    duration_seconds INTEGER, -- Total duration in seconds
    elevation_gain_m DECIMAL(7,2), -- Elevation gain in meters
    elevation_loss_m DECIMAL(7,2), -- Elevation loss in meters
    elevation_min_m DECIMAL(7,2), -- Minimum elevation
    elevation_max_m DECIMAL(7,2), -- Maximum elevation
    
    -- Route bounds for map optimization
    bounds_north DECIMAL(10,7),
    bounds_south DECIMAL(10,7),
    bounds_east DECIMAL(10,7),
    bounds_west DECIMAL(10,7),
    
    -- Additional metadata
    activity_type TEXT DEFAULT 'cycling',
    confidence_score DECIMAL(3,2), -- For map-matched routes (0.0 to 1.0)
    tags TEXT[], -- Array of tags like ['mountain', 'road', 'scenic']
    
    -- Performance indexes
    CONSTRAINT valid_confidence CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1))
);

-- Track Points table (GPS data separated for performance)
CREATE TABLE IF NOT EXISTS track_points_v2 (
    id BIGSERIAL PRIMARY KEY,
    route_id UUID REFERENCES routes_v2(id) ON DELETE CASCADE,
    
    -- GPS coordinates
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    elevation_m DECIMAL(7,2), -- Elevation in meters
    
    -- Timing
    timestamp_utc TIMESTAMPTZ,
    sequence_number INTEGER NOT NULL, -- Order within the route
    
    -- Optional sensor data
    heart_rate INTEGER,
    cadence INTEGER,
    power_watts INTEGER,
    speed_kmh DECIMAL(5,2),
    temperature_c DECIMAL(4,1),
    
    -- Constraints
    CONSTRAINT valid_latitude CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT valid_longitude CHECK (longitude >= -180 AND longitude <= 180),
    CONSTRAINT valid_heart_rate CHECK (heart_rate IS NULL OR (heart_rate > 0 AND heart_rate < 300)),
    CONSTRAINT valid_cadence CHECK (cadence IS NULL OR (cadence >= 0 AND cadence < 300)),
    CONSTRAINT valid_power CHECK (power_watts IS NULL OR power_watts >= 0)
);

-- Elevation Profile table (simplified elevation data for charts)
CREATE TABLE IF NOT EXISTS elevation_profiles_v2 (
    id BIGSERIAL PRIMARY KEY,
    route_id UUID REFERENCES routes_v2(id) ON DELETE CASCADE,
    
    distance_km DECIMAL(8,3) NOT NULL, -- Distance from start
    elevation_m DECIMAL(7,2) NOT NULL, -- Elevation at this point
    sequence_number INTEGER NOT NULL -- Order for charting
);

-- ====================
-- INDEXES FOR PERFORMANCE
-- ====================

-- Routes table indexes
CREATE INDEX IF NOT EXISTS idx_routes_v2_user_id ON routes_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_routes_v2_created_at ON routes_v2(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routes_v2_source ON routes_v2(source);
CREATE INDEX IF NOT EXISTS idx_routes_v2_distance ON routes_v2(distance_km);
CREATE INDEX IF NOT EXISTS idx_routes_v2_bounds ON routes_v2(bounds_north, bounds_south, bounds_east, bounds_west);

-- Track points indexes
CREATE INDEX IF NOT EXISTS idx_track_points_v2_route_id ON track_points_v2(route_id);
CREATE INDEX IF NOT EXISTS idx_track_points_v2_sequence ON track_points_v2(route_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_track_points_v2_location ON track_points_v2(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_track_points_v2_timestamp ON track_points_v2(timestamp_utc);

-- Elevation profile indexes
CREATE INDEX IF NOT EXISTS idx_elevation_profile_v2_route_id ON elevation_profiles_v2(route_id);
CREATE INDEX IF NOT EXISTS idx_elevation_profile_v2_sequence ON elevation_profiles_v2(route_id, sequence_number);

-- ====================
-- ROW LEVEL SECURITY (RLS)
-- ====================

-- Enable RLS on all new tables
ALTER TABLE routes_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_points_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE elevation_profiles_v2 ENABLE ROW LEVEL SECURITY;

-- Routes RLS policies
CREATE POLICY "Users can view their own routes v2" ON routes_v2
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own routes v2" ON routes_v2
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own routes v2" ON routes_v2
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own routes v2" ON routes_v2
    FOR DELETE USING (user_id = auth.uid());

-- Track points RLS policies
CREATE POLICY "Users can view track points for their routes v2" ON track_points_v2
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM routes_v2 WHERE routes_v2.id = track_points_v2.route_id AND routes_v2.user_id = auth.uid())
    );

CREATE POLICY "Users can insert track points for their routes v2" ON track_points_v2
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM routes_v2 WHERE routes_v2.id = track_points_v2.route_id AND routes_v2.user_id = auth.uid())
    );

-- Elevation profiles RLS policies
CREATE POLICY "Users can view elevation profiles for their routes v2" ON elevation_profiles_v2
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM routes_v2 WHERE routes_v2.id = elevation_profiles_v2.route_id AND routes_v2.user_id = auth.uid())
    );

CREATE POLICY "Users can insert elevation profiles for their routes v2" ON elevation_profiles_v2
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM routes_v2 WHERE routes_v2.id = elevation_profiles_v2.route_id AND routes_v2.user_id = auth.uid())
    );

-- ====================
-- FUNCTIONS FOR ROUTE CALCULATIONS
-- ====================

-- Function to calculate route statistics for v2 tables
CREATE OR REPLACE FUNCTION calculate_route_stats_v2(route_uuid UUID)
RETURNS VOID AS $$
DECLARE
    total_distance DECIMAL;
    total_elevation_gain DECIMAL;
    total_elevation_loss DECIMAL;
    min_elevation DECIMAL;
    max_elevation DECIMAL;
    route_bounds RECORD;
    duration_secs INTEGER;
BEGIN
    -- Calculate distance using haversine formula
    SELECT 
        COALESCE(SUM(
            6371 * acos(
                cos(radians(lag(latitude) OVER (ORDER BY sequence_number))) 
                * cos(radians(latitude)) 
                * cos(radians(longitude) - radians(lag(longitude) OVER (ORDER BY sequence_number))) 
                + sin(radians(lag(latitude) OVER (ORDER BY sequence_number))) 
                * sin(radians(latitude))
            )
        ), 0) INTO total_distance
    FROM track_points_v2 
    WHERE route_id = route_uuid
    AND lag(latitude) OVER (ORDER BY sequence_number) IS NOT NULL;

    -- Calculate elevation stats
    SELECT 
        COALESCE(SUM(CASE WHEN elevation_diff > 0 THEN elevation_diff ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN elevation_diff < 0 THEN ABS(elevation_diff) ELSE 0 END), 0),
        MIN(elevation_m),
        MAX(elevation_m)
    INTO total_elevation_gain, total_elevation_loss, min_elevation, max_elevation
    FROM (
        SELECT 
            elevation_m,
            elevation_m - lag(elevation_m) OVER (ORDER BY sequence_number) as elevation_diff
        FROM track_points_v2 
        WHERE route_id = route_uuid 
        AND elevation_m IS NOT NULL
    ) elevation_diffs;

    -- Calculate bounds
    SELECT 
        MAX(latitude) as north,
        MIN(latitude) as south,
        MAX(longitude) as east,
        MIN(longitude) as west
    INTO route_bounds
    FROM track_points_v2
    WHERE route_id = route_uuid;

    -- Calculate duration
    SELECT 
        EXTRACT(EPOCH FROM (MAX(timestamp_utc) - MIN(timestamp_utc)))::INTEGER
    INTO duration_secs
    FROM track_points_v2
    WHERE route_id = route_uuid
    AND timestamp_utc IS NOT NULL;

    -- Update route with calculated stats
    UPDATE routes_v2 SET
        distance_km = total_distance,
        duration_seconds = duration_secs,
        elevation_gain_m = total_elevation_gain,
        elevation_loss_m = total_elevation_loss,
        elevation_min_m = min_elevation,
        elevation_max_m = max_elevation,
        bounds_north = route_bounds.north,
        bounds_south = route_bounds.south,
        bounds_east = route_bounds.east,
        bounds_west = route_bounds.west,
        updated_at = NOW()
    WHERE id = route_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to generate elevation profile for v2 tables
CREATE OR REPLACE FUNCTION generate_elevation_profile_v2(route_uuid UUID, max_points INTEGER DEFAULT 100)
RETURNS VOID AS $$
DECLARE
    point_count INTEGER;
    step_size INTEGER;
BEGIN
    -- Clear existing elevation profile
    DELETE FROM elevation_profiles_v2 WHERE route_id = route_uuid;
    
    -- Get total points
    SELECT COUNT(*) INTO point_count FROM track_points_v2 WHERE route_id = route_uuid;
    
    -- Calculate step size to get approximately max_points
    step_size := GREATEST(1, point_count / max_points);
    
    -- Insert simplified elevation profile
    INSERT INTO elevation_profiles_v2 (route_id, distance_km, elevation_m, sequence_number)
    SELECT 
        route_uuid,
        -- Calculate cumulative distance
        SUM(
            COALESCE(
                6371 * acos(
                    cos(radians(lag(latitude) OVER (ORDER BY sequence_number))) 
                    * cos(radians(latitude)) 
                    * cos(radians(longitude) - radians(lag(longitude) OVER (ORDER BY sequence_number))) 
                    + sin(radians(lag(latitude) OVER (ORDER BY sequence_number))) 
                    * sin(radians(latitude))
                ), 0
            )
        ) OVER (ORDER BY sequence_number) as distance_km,
        elevation_m,
        ROW_NUMBER() OVER (ORDER BY sequence_number) as seq
    FROM track_points_v2 
    WHERE route_id = route_uuid 
    AND elevation_m IS NOT NULL
    AND sequence_number % step_size = 0
    ORDER BY sequence_number;
END;
$$ LANGUAGE plpgsql;

-- ====================
-- VIEWS FOR EASY QUERYING
-- ====================

-- View for route analysis (optimized for dashboard)
CREATE OR REPLACE VIEW route_analysis_v2 AS
SELECT 
    r.id,
    r.user_id,
    r.name,
    r.source,
    r.created_at,
    r.distance_km,
    r.duration_seconds,
    r.elevation_gain_m,
    r.elevation_loss_m,
    r.activity_type,
    r.filename,
    -- Calculated fields
    CASE 
        WHEN r.duration_seconds > 0 THEN r.distance_km * 3600 / r.duration_seconds
        ELSE NULL 
    END as avg_speed_kmh,
    DATE_TRUNC('month', r.created_at) as month_year,
    EXTRACT(YEAR FROM r.created_at) as year,
    EXTRACT(MONTH FROM r.created_at) as month
FROM routes_v2 r
WHERE r.distance_km IS NOT NULL;

-- ====================
-- MIGRATION HELPER FUNCTION
-- ====================

-- Function to migrate a single route from old to new schema
CREATE OR REPLACE FUNCTION migrate_single_route_to_v2(old_route_id UUID, target_user_id UUID)
RETURNS UUID AS $$
DECLARE
    old_route RECORD;
    new_route_id UUID;
    track_point RECORD;
    point_data JSONB;
BEGIN
    -- Get the old route data
    SELECT * INTO old_route FROM routes WHERE id = old_route_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Route not found: %', old_route_id;
    END IF;
    
    -- Insert new route record
    INSERT INTO routes_v2 (
        user_id,
        name,
        source,
        filename,
        created_at,
        activity_type
    ) VALUES (
        target_user_id,
        COALESCE(old_route.metadata->>'name', old_route.metadata->>'filename', 'Imported Route'),
        COALESCE(old_route.metadata->>'source', 'upload'),
        old_route.metadata->>'filename',
        old_route.created_at,
        'cycling'
    ) RETURNING id INTO new_route_id;
    
    -- Insert track points if they exist
    IF old_route.track_points IS NOT NULL THEN
        FOR point_data IN SELECT * FROM jsonb_array_elements(old_route.track_points)
        LOOP
            INSERT INTO track_points_v2 (
                route_id,
                latitude,
                longitude,
                elevation_m,
                timestamp_utc,
                sequence_number,
                heart_rate,
                cadence,
                power_watts
            ) VALUES (
                new_route_id,
                (point_data->>'latitude')::DECIMAL,
                (point_data->>'longitude')::DECIMAL,
                (point_data->>'elevation')::DECIMAL,
                (point_data->>'timestamp')::TIMESTAMPTZ,
                (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM track_points_v2 WHERE route_id = new_route_id),
                (point_data->>'heartRate')::INTEGER,
                (point_data->>'cadence')::INTEGER,
                (point_data->>'power')::INTEGER
            );
        END LOOP;
        
        -- Calculate stats for this route
        PERFORM calculate_route_stats_v2(new_route_id);
        PERFORM generate_elevation_profile_v2(new_route_id);
    END IF;
    
    RETURN new_route_id;
END;
$$ LANGUAGE plpgsql;

-- ====================
-- TEST QUERIES
-- ====================

-- After creating tables, you can test with:
-- SELECT COUNT(*) as v2_routes FROM routes_v2;
-- SELECT COUNT(*) as v2_track_points FROM track_points_v2;
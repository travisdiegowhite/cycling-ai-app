-- 🚴‍♂️ CYCLING APP - CLEAN OPTIMIZED SCHEMA
-- Built for performance and simplicity

-- ====================
-- ROUTES TABLE (Main metadata + stats)
-- ====================
CREATE TABLE routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Basic info
    name TEXT NOT NULL,
    filename TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Pre-calculated stats (for instant dashboard loading)
    distance_km DECIMAL(8,3) DEFAULT 0,
    elevation_gain_m INTEGER DEFAULT 0,
    elevation_loss_m INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    
    -- GPS bounds (for map queries)
    north DECIMAL(10,7),
    south DECIMAL(10,7),
    east DECIMAL(10,7),
    west DECIMAL(10,7),
    
    -- Source tracking
    source TEXT DEFAULT 'upload' CHECK (source IN ('upload', 'builder', 'ai'))
);

-- ====================
-- TRACK POINTS TABLE (GPS data)
-- ====================
CREATE TABLE track_points (
    id BIGSERIAL PRIMARY KEY,
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE NOT NULL,
    
    -- GPS coordinates
    lat DECIMAL(9,6) NOT NULL,
    lng DECIMAL(9,6) NOT NULL,
    elevation DECIMAL(7,2), -- meters with decimals
    
    -- Timing
    timestamp_utc TIMESTAMPTZ,
    sequence_num INTEGER NOT NULL,
    
    -- Optional sensor data
    heart_rate INTEGER,
    power_watts INTEGER,
    cadence INTEGER,
    
    -- Constraints
    CHECK (lat >= -90 AND lat <= 90),
    CHECK (lng >= -180 AND lng <= 180)
);

-- ====================
-- ELEVATION PROFILES (For charts - max 100 points per route)
-- ====================
CREATE TABLE elevation_profiles (
    id BIGSERIAL PRIMARY KEY,
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE NOT NULL,
    
    distance_km DECIMAL(6,3) NOT NULL,
    elevation_m DECIMAL(7,2) NOT NULL,
    sequence_num INTEGER NOT NULL
);

-- ====================
-- PERFORMANCE INDEXES
-- ====================

-- Routes indexes
CREATE INDEX idx_routes_user_created ON routes(user_id, created_at DESC);
CREATE INDEX idx_routes_distance ON routes(distance_km);
CREATE INDEX idx_routes_bounds ON routes(north, south, east, west);

-- Track points indexes  
CREATE INDEX idx_track_points_route ON track_points(route_id, sequence_num);
CREATE INDEX idx_track_points_location ON track_points(lat, lng);

-- Elevation profiles index
CREATE INDEX idx_elevation_profiles_route ON elevation_profiles(route_id, sequence_num);

-- ====================
-- ROW LEVEL SECURITY
-- ====================

ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE elevation_profiles ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users see own routes" ON routes FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users see own track points" ON track_points FOR ALL USING (
    EXISTS (SELECT 1 FROM routes WHERE routes.id = track_points.route_id AND routes.user_id = auth.uid())
);
CREATE POLICY "Users see own elevation profiles" ON elevation_profiles FOR ALL USING (
    EXISTS (SELECT 1 FROM routes WHERE routes.id = elevation_profiles.route_id AND routes.user_id = auth.uid())
);

-- ====================
-- CALCULATION FUNCTIONS
-- ====================

-- Calculate stats for a route
CREATE OR REPLACE FUNCTION calculate_route_stats(route_uuid UUID)
RETURNS VOID AS $$
DECLARE
    total_distance DECIMAL := 0;
    total_gain INTEGER := 0;
    total_loss INTEGER := 0;
    total_duration INTEGER := 0;
    route_bounds RECORD;
BEGIN
    -- Calculate distance using simplified haversine
    SELECT 
        COALESCE(SUM(
            111.111 * sqrt(
                pow(lat - lag(lat) OVER (ORDER BY sequence_num), 2) + 
                pow((lng - lag(lng) OVER (ORDER BY sequence_num)) * cos(radians(lat)), 2)
            )
        ), 0)
    INTO total_distance
    FROM track_points 
    WHERE route_id = route_uuid;

    -- Calculate elevation gain/loss
    SELECT 
        COALESCE(SUM(CASE WHEN elev_diff > 0 THEN elev_diff ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN elev_diff < 0 THEN ABS(elev_diff) ELSE 0 END), 0)
    INTO total_gain, total_loss
    FROM (
        SELECT elevation - lag(elevation) OVER (ORDER BY sequence_num) as elev_diff
        FROM track_points 
        WHERE route_id = route_uuid AND elevation IS NOT NULL
    ) diffs;

    -- Calculate bounds
    SELECT 
        MAX(lat) as north, MIN(lat) as south,
        MAX(lng) as east, MIN(lng) as west
    INTO route_bounds
    FROM track_points WHERE route_id = route_uuid;

    -- Calculate duration
    SELECT EXTRACT(EPOCH FROM (MAX(timestamp_utc) - MIN(timestamp_utc)))::INTEGER
    INTO total_duration
    FROM track_points 
    WHERE route_id = route_uuid AND timestamp_utc IS NOT NULL;

    -- Update route
    UPDATE routes SET
        distance_km = total_distance,
        elevation_gain_m = total_gain,
        elevation_loss_m = total_loss,
        duration_seconds = total_duration,
        north = route_bounds.north,
        south = route_bounds.south,
        east = route_bounds.east,
        west = route_bounds.west
    WHERE id = route_uuid;
END;
$$ LANGUAGE plpgsql;

-- Generate simplified elevation profile
CREATE OR REPLACE FUNCTION generate_elevation_profile(route_uuid UUID)
RETURNS VOID AS $$
BEGIN
    -- Clear existing profile
    DELETE FROM elevation_profiles WHERE route_id = route_uuid;
    
    -- Create simplified profile (max 100 points)
    INSERT INTO elevation_profiles (route_id, distance_km, elevation_m, sequence_num)
    WITH numbered_points AS (
        SELECT 
            lat, lng, elevation,
            ROW_NUMBER() OVER (ORDER BY sequence_num) as rn,
            COUNT(*) OVER () as total_points
        FROM track_points 
        WHERE route_id = route_uuid AND elevation IS NOT NULL
    ),
    sampled_points AS (
        SELECT * FROM numbered_points 
        WHERE rn % GREATEST(1, total_points / 100) = 1
    ),
    with_distance AS (
        SELECT 
            elevation,
            SUM(111.111 * sqrt(
                pow(lat - lag(lat) OVER (ORDER BY rn), 2) + 
                pow((lng - lag(lng) OVER (ORDER BY rn)) * cos(radians(lat)), 2)
            )) OVER (ORDER BY rn) as cumulative_distance,
            ROW_NUMBER() OVER (ORDER BY rn) as seq
        FROM sampled_points
    )
    SELECT 
        route_uuid,
        COALESCE(cumulative_distance, 0),
        elevation,
        seq
    FROM with_distance;
END;
$$ LANGUAGE plpgsql;

-- ====================
-- VIEWS FOR EASY QUERYING
-- ====================

-- Dashboard view
CREATE VIEW dashboard_stats AS
SELECT 
    user_id,
    COUNT(*) as total_routes,
    SUM(distance_km) as total_distance_km,
    SUM(elevation_gain_m) as total_elevation_m,
    AVG(distance_km) as avg_distance_km,
    MAX(distance_km) as longest_route_km,
    MAX(elevation_gain_m) as steepest_route_m
FROM routes
GROUP BY user_id;

-- Monthly stats view
CREATE VIEW monthly_stats AS
SELECT 
    user_id,
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as ride_count,
    SUM(distance_km) as total_distance,
    SUM(elevation_gain_m) as total_elevation,
    AVG(distance_km) as avg_distance
FROM routes
GROUP BY user_id, DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- ====================
-- TEST QUERIES (After setup)
-- ====================

-- Test performance (should be instant):
-- SELECT * FROM dashboard_stats WHERE user_id = auth.uid();
-- SELECT * FROM monthly_stats WHERE user_id = auth.uid() LIMIT 12;
-- Optimized Supabase Schema for Cycling App
-- This schema separates track points from route metadata for better performance

-- ====================
-- MAIN TABLES
-- ====================

-- Routes table (metadata and summary stats only)
CREATE TABLE IF NOT EXISTS routes (
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
CREATE TABLE IF NOT EXISTS track_points (
    id BIGSERIAL PRIMARY KEY,
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    
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
CREATE TABLE IF NOT EXISTS elevation_profiles (
    id BIGSERIAL PRIMARY KEY,
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    
    distance_km DECIMAL(8,3) NOT NULL, -- Distance from start
    elevation_m DECIMAL(7,2) NOT NULL, -- Elevation at this point
    sequence_number INTEGER NOT NULL -- Order for charting
);

-- User preferences and stats
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    
    -- Unit preferences
    distance_unit TEXT DEFAULT 'metric' CHECK (distance_unit IN ('metric', 'imperial')),
    elevation_unit TEXT DEFAULT 'metric' CHECK (elevation_unit IN ('metric', 'imperial')),
    temperature_unit TEXT DEFAULT 'celsius' CHECK (temperature_unit IN ('celsius', 'fahrenheit')),
    
    -- Default settings
    default_activity_type TEXT DEFAULT 'cycling',
    map_center_lat DECIMAL(10,7) DEFAULT 39.7392, -- Denver
    map_center_lng DECIMAL(10,7) DEFAULT -104.9903,
    map_zoom_level INTEGER DEFAULT 13,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Route sharing and privacy
CREATE TABLE IF NOT EXISTS route_shares (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    shared_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    is_public BOOLEAN DEFAULT FALSE,
    share_token TEXT UNIQUE, -- For public links
    shared_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Optional expiration
    
    -- Privacy settings
    include_personal_data BOOLEAN DEFAULT FALSE -- Whether to include HR, power, etc.
);

-- ====================
-- INDEXES FOR PERFORMANCE
-- ====================

-- Routes table indexes
CREATE INDEX IF NOT EXISTS idx_routes_user_id ON routes(user_id);
CREATE INDEX IF NOT EXISTS idx_routes_created_at ON routes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routes_source ON routes(source);
CREATE INDEX IF NOT EXISTS idx_routes_distance ON routes(distance_km);
CREATE INDEX IF NOT EXISTS idx_routes_bounds ON routes(bounds_north, bounds_south, bounds_east, bounds_west);

-- Track points indexes
CREATE INDEX IF NOT EXISTS idx_track_points_route_id ON track_points(route_id);
CREATE INDEX IF NOT EXISTS idx_track_points_sequence ON track_points(route_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_track_points_location ON track_points(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_track_points_timestamp ON track_points(timestamp_utc);

-- Elevation profile indexes
CREATE INDEX IF NOT EXISTS idx_elevation_profile_route_id ON elevation_profiles(route_id);
CREATE INDEX IF NOT EXISTS idx_elevation_profile_sequence ON elevation_profiles(route_id, sequence_number);

-- ====================
-- ROW LEVEL SECURITY (RLS)
-- ====================

-- Enable RLS on all tables
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE elevation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_shares ENABLE ROW LEVEL SECURITY;

-- Routes RLS policies
CREATE POLICY "Users can view their own routes" ON routes
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can view public routes" ON routes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM route_shares 
            WHERE route_shares.route_id = routes.id 
            AND route_shares.is_public = true
            AND (route_shares.expires_at IS NULL OR route_shares.expires_at > NOW())
        )
    );

CREATE POLICY "Users can insert their own routes" ON routes
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own routes" ON routes
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own routes" ON routes
    FOR DELETE USING (user_id = auth.uid());

-- Track points RLS policies
CREATE POLICY "Users can view track points for their routes" ON track_points
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM routes WHERE routes.id = track_points.route_id AND routes.user_id = auth.uid())
    );

CREATE POLICY "Users can view track points for public routes" ON track_points
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM routes 
            JOIN route_shares ON route_shares.route_id = routes.id
            WHERE routes.id = track_points.route_id 
            AND route_shares.is_public = true
            AND (route_shares.expires_at IS NULL OR route_shares.expires_at > NOW())
        )
    );

CREATE POLICY "Users can insert track points for their routes" ON track_points
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM routes WHERE routes.id = track_points.route_id AND routes.user_id = auth.uid())
    );

-- Elevation profiles RLS policies
CREATE POLICY "Users can view elevation profiles for their routes" ON elevation_profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM routes WHERE routes.id = elevation_profiles.route_id AND routes.user_id = auth.uid())
    );

CREATE POLICY "Users can insert elevation profiles for their routes" ON elevation_profiles
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM routes WHERE routes.id = elevation_profiles.route_id AND routes.user_id = auth.uid())
    );

-- User preferences RLS policies
CREATE POLICY "Users can manage their own preferences" ON user_preferences
    FOR ALL USING (user_id = auth.uid());

-- Route shares RLS policies
CREATE POLICY "Users can manage shares for their routes" ON route_shares
    FOR ALL USING (shared_by = auth.uid());

CREATE POLICY "Anyone can view public route shares" ON route_shares
    FOR SELECT USING (is_public = true);

-- ====================
-- FUNCTIONS FOR COMMON OPERATIONS
-- ====================

-- Function to calculate route statistics
CREATE OR REPLACE FUNCTION calculate_route_stats(route_uuid UUID)
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
    FROM track_points 
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
        FROM track_points 
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
    FROM track_points
    WHERE route_id = route_uuid;

    -- Calculate duration
    SELECT 
        EXTRACT(EPOCH FROM (MAX(timestamp_utc) - MIN(timestamp_utc)))::INTEGER
    INTO duration_secs
    FROM track_points
    WHERE route_id = route_uuid
    AND timestamp_utc IS NOT NULL;

    -- Update route with calculated stats
    UPDATE routes SET
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

-- Function to generate elevation profile (simplified for charts)
CREATE OR REPLACE FUNCTION generate_elevation_profile(route_uuid UUID, max_points INTEGER DEFAULT 100)
RETURNS VOID AS $$
DECLARE
    point_count INTEGER;
    step_size INTEGER;
BEGIN
    -- Clear existing elevation profile
    DELETE FROM elevation_profiles WHERE route_id = route_uuid;
    
    -- Get total points
    SELECT COUNT(*) INTO point_count FROM track_points WHERE route_id = route_uuid;
    
    -- Calculate step size to get approximately max_points
    step_size := GREATEST(1, point_count / max_points);
    
    -- Insert simplified elevation profile
    INSERT INTO elevation_profiles (route_id, distance_km, elevation_m, sequence_number)
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
    FROM track_points 
    WHERE route_id = route_uuid 
    AND elevation_m IS NOT NULL
    AND sequence_number % step_size = 0
    ORDER BY sequence_number;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically calculate stats when track points are inserted
CREATE OR REPLACE FUNCTION trigger_calculate_route_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Only recalculate if this is the last point being inserted
    -- (to avoid recalculating for every single point during bulk upload)
    IF TG_OP = 'INSERT' THEN
        -- Use a job queue or delayed execution in production
        PERFORM calculate_route_stats(NEW.route_id);
        PERFORM generate_elevation_profile(NEW.route_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Don't create the trigger automatically to avoid performance issues during bulk inserts
-- Instead, call calculate_route_stats() manually after uploading all points

-- ====================
-- VIEWS FOR COMMON QUERIES
-- ====================

-- View for route analysis (optimized for dashboard)
CREATE OR REPLACE VIEW route_analysis AS
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
    -- Calculated fields
    CASE 
        WHEN r.duration_seconds > 0 THEN r.distance_km * 3600 / r.duration_seconds
        ELSE NULL 
    END as avg_speed_kmh,
    DATE_TRUNC('month', r.created_at) as month_year,
    EXTRACT(YEAR FROM r.created_at) as year,
    EXTRACT(MONTH FROM r.created_at) as month
FROM routes r
WHERE r.distance_km IS NOT NULL;

-- View for public routes (for sharing/discovery)
CREATE OR REPLACE VIEW public_routes AS
SELECT 
    r.id,
    r.name,
    r.description,
    r.distance_km,
    r.elevation_gain_m,
    r.activity_type,
    r.bounds_north,
    r.bounds_south,
    r.bounds_east,
    r.bounds_west,
    rs.shared_at,
    rs.share_token
FROM routes r
JOIN route_shares rs ON rs.route_id = r.id
WHERE rs.is_public = true
AND (rs.expires_at IS NULL OR rs.expires_at > NOW());

-- ====================
-- SAMPLE DATA MIGRATION
-- ====================

-- Function to migrate existing data from old schema
CREATE OR REPLACE FUNCTION migrate_old_routes()
RETURNS INTEGER AS $$
DECLARE
    route_record RECORD;
    new_route_id UUID;
    migrated_count INTEGER := 0;
BEGIN
    -- This assumes your old table structure - adjust as needed
    FOR route_record IN 
        SELECT * FROM routes_old -- Your current routes table
    LOOP
        -- Insert route metadata
        INSERT INTO routes (
            user_id,
            name,
            source,
            filename,
            created_at
        ) VALUES (
            route_record.user_id,
            COALESCE(route_record.metadata->>'name', route_record.metadata->>'filename', 'Imported Route'),
            COALESCE(route_record.metadata->>'source', 'upload'),
            route_record.metadata->>'filename',
            route_record.created_at
        ) RETURNING id INTO new_route_id;
        
        -- Insert track points (adjust field names as needed)
        INSERT INTO track_points (
            route_id,
            latitude,
            longitude,
            elevation_m,
            timestamp_utc,
            sequence_number,
            heart_rate,
            cadence,
            power_watts
        )
        SELECT 
            new_route_id,
            (point->>'latitude')::DECIMAL,
            (point->>'longitude')::DECIMAL,
            (point->>'elevation')::DECIMAL,
            (point->>'timestamp')::TIMESTAMPTZ,
            ROW_NUMBER() OVER (ORDER BY ordinality),
            (point->>'heartRate')::INTEGER,
            (point->>'cadence')::INTEGER,
            (point->>'power')::INTEGER
        FROM jsonb_array_elements(route_record.track_points) WITH ORDINALITY AS t(point, ordinality);
        
        -- Calculate stats for this route
        PERFORM calculate_route_stats(new_route_id);
        PERFORM generate_elevation_profile(new_route_id);
        
        migrated_count := migrated_count + 1;
    END LOOP;
    
    RETURN migrated_count;
END;
$$ LANGUAGE plpgsql;
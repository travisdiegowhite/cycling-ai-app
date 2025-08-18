-- Simple and reliable route statistics calculation
CREATE OR REPLACE FUNCTION calculate_route_stats_simple(route_uuid UUID)
RETURNS VOID AS $$
DECLARE
    total_distance DECIMAL := 0;
    total_elevation_gain DECIMAL := 0;
    total_duration INTEGER := 0;
    min_lat DECIMAL;
    max_lat DECIMAL;
    min_lng DECIMAL;
    max_lng DECIMAL;
    first_time TIMESTAMPTZ;
    last_time TIMESTAMPTZ;
    point_count INTEGER;
BEGIN
    -- Get basic stats
    SELECT 
        COUNT(*),
        MIN(lat), MAX(lat),
        MIN(lng), MAX(lng),
        MIN(timestamp_utc), MAX(timestamp_utc)
    INTO 
        point_count,
        min_lat, max_lat,
        min_lng, max_lng,
        first_time, last_time
    FROM track_points 
    WHERE route_id = route_uuid;

    -- Calculate simple distance (Euclidean approximation)
    IF point_count > 1 THEN
        WITH point_distances AS (
            SELECT 
                111.111 * SQRT(
                    POWER(lat - LAG(lat) OVER (ORDER BY sequence_num), 2) + 
                    POWER((lng - LAG(lng) OVER (ORDER BY sequence_num)) * COS(RADIANS(lat)), 2)
                ) as segment_distance
            FROM track_points 
            WHERE route_id = route_uuid
            ORDER BY sequence_num
        )
        SELECT COALESCE(SUM(segment_distance), 0)
        INTO total_distance
        FROM point_distances
        WHERE segment_distance IS NOT NULL;
    END IF;

    -- Calculate elevation gain
    IF point_count > 1 THEN
        WITH elevation_diffs AS (
            SELECT 
                elevation - LAG(elevation) OVER (ORDER BY sequence_num) as elev_diff
            FROM track_points 
            WHERE route_id = route_uuid 
            AND elevation IS NOT NULL
            ORDER BY sequence_num
        )
        SELECT COALESCE(SUM(CASE WHEN elev_diff > 0 THEN elev_diff ELSE 0 END), 0)
        INTO total_elevation_gain
        FROM elevation_diffs
        WHERE elev_diff IS NOT NULL;
    END IF;

    -- Calculate duration
    IF first_time IS NOT NULL AND last_time IS NOT NULL THEN
        total_duration := EXTRACT(EPOCH FROM (last_time - first_time))::INTEGER;
    END IF;

    -- Update route with calculated stats
    UPDATE routes SET
        distance_km = total_distance,
        elevation_gain_m = total_elevation_gain::INTEGER,
        duration_seconds = total_duration,
        north = max_lat,
        south = min_lat,
        east = max_lng,
        west = min_lng
    WHERE id = route_uuid;

    -- Log for debugging
    RAISE NOTICE 'Route % stats: distance=%, elevation=%, duration=%, points=%', 
        route_uuid, total_distance, total_elevation_gain, total_duration, point_count;
END;
$$ LANGUAGE plpgsql;
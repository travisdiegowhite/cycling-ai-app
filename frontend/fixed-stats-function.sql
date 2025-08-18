-- Fixed calculate_route_stats function
-- This fixes the "aggregate function calls cannot contain window function calls" error

CREATE OR REPLACE FUNCTION calculate_route_stats(route_uuid UUID)
RETURNS VOID AS $$
DECLARE
    total_distance DECIMAL := 0;
    total_gain INTEGER := 0;
    total_loss INTEGER := 0;
    total_duration INTEGER := 0;
    route_bounds RECORD;
BEGIN
    -- Calculate distance using simplified haversine (fixed: separate window function from aggregate)
    WITH distance_calculations AS (
        SELECT 
            111.111 * sqrt(
                pow(lat - lag(lat) OVER (ORDER BY sequence_num), 2) + 
                pow((lng - lag(lng) OVER (ORDER BY sequence_num)) * cos(radians(lat)), 2)
            ) as segment_distance
        FROM track_points 
        WHERE route_id = route_uuid
        ORDER BY sequence_num
    )
    SELECT COALESCE(SUM(segment_distance), 0)
    INTO total_distance
    FROM distance_calculations;

    -- Calculate elevation gain/loss (this was already correct)
    SELECT 
        COALESCE(SUM(CASE WHEN elev_diff > 0 THEN elev_diff ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN elev_diff < 0 THEN ABS(elev_diff) ELSE 0 END), 0)
    INTO total_gain, total_loss
    FROM (
        SELECT elevation - lag(elevation) OVER (ORDER BY sequence_num) as elev_diff
        FROM track_points 
        WHERE route_id = route_uuid AND elevation IS NOT NULL
        ORDER BY sequence_num
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

    -- Log the results for debugging
    RAISE NOTICE 'Route % stats: distance=%, elevation_gain=%, duration=%', 
        route_uuid, total_distance, total_gain, total_duration;
END;
$$ LANGUAGE plpgsql;
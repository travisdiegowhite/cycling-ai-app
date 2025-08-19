-- Simple elevation profile function (optional)
CREATE OR REPLACE FUNCTION generate_elevation_profile(route_uuid UUID)
RETURNS VOID AS $$
BEGIN
    -- For now, just create a simple elevation profile
    -- Delete existing profile data for this route
    DELETE FROM elevation_profiles WHERE route_id = route_uuid;
    
    -- Create a simplified elevation profile with max 100 points
    WITH numbered_points AS (
        SELECT 
            lat, lng, elevation, sequence_num,
            ROW_NUMBER() OVER (ORDER BY sequence_num) as rn,
            COUNT(*) OVER () as total_points
        FROM track_points 
        WHERE route_id = route_uuid 
        AND elevation IS NOT NULL
        ORDER BY sequence_num
    ),
    sampled_points AS (
        SELECT * FROM numbered_points 
        WHERE rn % GREATEST(1, total_points / 100) = 1
    ),
    with_distance AS (
        SELECT 
            elevation,
            LAG(lat) OVER (ORDER BY rn) as prev_lat,
            LAG(lng) OVER (ORDER BY rn) as prev_lng,
            lat, lng,
            ROW_NUMBER() OVER (ORDER BY rn) as seq
        FROM sampled_points
    ),
    cumulative_distance AS (
        SELECT 
            elevation,
            seq,
            COALESCE(
                SUM(
                    CASE 
                        WHEN prev_lat IS NOT NULL THEN
                            111.111 * SQRT(
                                POWER(lat - prev_lat, 2) + 
                                POWER((lng - prev_lng) * COS(RADIANS(lat)), 2)
                            )
                        ELSE 0
                    END
                ) OVER (ORDER BY seq),
                0
            ) as cumulative_distance_km
        FROM with_distance
    )
    INSERT INTO elevation_profiles (route_id, distance_km, elevation_m, sequence_num)
    SELECT 
        route_uuid,
        cumulative_distance_km,
        elevation,
        seq
    FROM cumulative_distance
    WHERE elevation IS NOT NULL;

    RAISE NOTICE 'Generated elevation profile for route %', route_uuid;
END;
$$ LANGUAGE plpgsql;
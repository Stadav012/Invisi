-- =========================================================================
-- Invisi: Edge-First Schema Migration
-- Run this in Supabase SQL Editor
-- =========================================================================

-- 1. Rename columns in sensor_readings
ALTER TABLE sensor_readings RENAME COLUMN temp_center TO t_core;
ALTER TABLE sensor_readings RENAME COLUMN temp_left TO t_left;
ALTER TABLE sensor_readings RENAME COLUMN temp_right TO t_right;

-- 2. Add fermentation_state column
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS fermentation_state text;

-- 3. Create fermentation_events table
CREATE TABLE IF NOT EXISTS fermentation_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    batch_id uuid REFERENCES batches(id) ON DELETE CASCADE,
    event_type text NOT NULL,       -- MIX_ALERT, STATE_TRANSITION
    state_from text,
    state_to text,
    gradient float,
    derivative float,
    created_at timestamptz DEFAULT now()
);

-- 4. Drop and recreate the hourly rollup view with new column names
DROP VIEW IF EXISTS sensor_readings_hourly;

CREATE VIEW sensor_readings_hourly AS
SELECT
    batch_id,
    date_trunc('hour', recorded_at) AS hour,
    avg(t_core) AS avg_t_core,
    avg(t_left) AS avg_t_left,
    avg(t_right) AS avg_t_right,
    avg(gas_left) AS avg_gas_left,
    avg(gas_right) AS avg_gas_right,
    max(
        CASE
            WHEN t_core IS NOT NULL AND (t_left IS NOT NULL OR t_right IS NOT NULL)
            THEN t_core - COALESCE(
                (COALESCE(t_left, 0) + COALESCE(t_right, 0)) /
                NULLIF((CASE WHEN t_left IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN t_right IS NOT NULL THEN 1 ELSE 0 END), 0),
                0
            )
            ELSE NULL
        END
    ) AS max_gradient,
    count(*) AS reading_count
FROM sensor_readings
GROUP BY batch_id, date_trunc('hour', recorded_at)
ORDER BY hour;

-- 5. Enable RLS on fermentation_events
ALTER TABLE fermentation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on fermentation_events"
    ON fermentation_events FOR SELECT
    USING (true);

CREATE POLICY "Allow public insert on fermentation_events"
    ON fermentation_events FOR INSERT
    WITH CHECK (true);

-- 002_alert_legacy_mongo_id.sql
-- Preserve the original MongoDB alert identifier for migrated records.

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_legacy_mongo_id
  ON alerts(legacy_mongo_id)
  WHERE legacy_mongo_id IS NOT NULL;

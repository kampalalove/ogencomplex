-- schema_upgrade_v3.sql
-- Veritas Worker v3 upgrade: discipline metadata and tiered advisory audit fields.
-- Some ALTER statements may fail if already applied; deploy scripts should treat that as non-fatal.

ALTER TABLE decision_rules ADD COLUMN severity TEXT DEFAULT 'WARNING';
ALTER TABLE decision_rules ADD COLUMN domain TEXT;
ALTER TABLE decision_rules ADD COLUMN confidence_factors TEXT;

CREATE TABLE IF NOT EXISTS advice_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    event TEXT,
    identity TEXT,
    regime TEXT,
    tier INTEGER,
    payload_fields TEXT,
    match_count INTEGER,
    risk_peak REAL,
    risk_total REAL
);

CREATE INDEX IF NOT EXISTS idx_log_ts ON advice_log(ts);

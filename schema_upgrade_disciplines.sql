-- schema_upgrade_disciplines.sql
-- One-time upgrade for existing Veritas D1 databases created before domain metadata.
-- Safe to skip if these columns already exist.

ALTER TABLE decision_rules ADD COLUMN severity TEXT DEFAULT 'WARNING';
ALTER TABLE decision_rules ADD COLUMN domain TEXT;
ALTER TABLE decision_rules ADD COLUMN confidence_factors TEXT;

ALTER TABLE advice_log ADD COLUMN ts INTEGER;
ALTER TABLE advice_log ADD COLUMN payload TEXT;
ALTER TABLE advice_log ADD COLUMN matches TEXT;
ALTER TABLE advice_log ADD COLUMN entropy REAL;
ALTER TABLE advice_log ADD COLUMN risk_index REAL;
ALTER TABLE advice_log ADD COLUMN inferred_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_log_ts ON advice_log(ts);

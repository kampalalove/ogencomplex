-- schema.sql
-- Veritas decision rules and audit log with discipline/domain metadata

CREATE TABLE IF NOT EXISTS decision_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT UNIQUE NOT NULL,
  condition_json TEXT NOT NULL,
  action_text TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  category TEXT,
  evidence_source TEXT,
  active INTEGER DEFAULT 1,
  severity TEXT DEFAULT 'WARNING',
  domain TEXT,
  confidence_factors TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rule_name ON decision_rules(rule_name);
CREATE INDEX IF NOT EXISTS idx_active_priority ON decision_rules(active, priority);
CREATE INDEX IF NOT EXISTS idx_rule_domain ON decision_rules(domain);
CREATE INDEX IF NOT EXISTS idx_rule_severity ON decision_rules(severity);

CREATE TABLE IF NOT EXISTS advice_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  payload TEXT NOT NULL,
  matches TEXT NOT NULL,
  entropy REAL,
  risk_index REAL,
  inferred_domain TEXT,
  event_type TEXT DEFAULT 'advise'
);

CREATE INDEX IF NOT EXISTS idx_log_ts ON advice_log(ts);
CREATE INDEX IF NOT EXISTS idx_log_event_type ON advice_log(event_type);

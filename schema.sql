-- schema.sql
-- Veritas decision rules and audit log

CREATE TABLE IF NOT EXISTS decision_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT UNIQUE NOT NULL,
  condition_json TEXT NOT NULL,
  action_text TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  category TEXT,
  evidence_source TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rule_name ON decision_rules(rule_name);
CREATE INDEX IF NOT EXISTS idx_active_priority ON decision_rules(active, priority);

CREATE TABLE IF NOT EXISTS advice_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL DEFAULT 'advise',
  payload_json TEXT,
  matches_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_advice_log_created_at ON advice_log(created_at);
CREATE INDEX IF NOT EXISTS idx_advice_log_event_type ON advice_log(event_type);

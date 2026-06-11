-- schema.sql
-- Creates the decision_rules table

CREATE TABLE IF NOT EXISTS decision_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT UNIQUE NOT NULL,
  condition_json TEXT NOT NULL,      -- JSON object with fields/operators
  action_text TEXT NOT NULL,         -- human-readable advice
  priority INTEGER DEFAULT 0,
  category TEXT,
  evidence_source TEXT,              -- R2 object key (e.g., "manuals/section4_2.pdf")
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rule_name ON decision_rules(rule_name);
CREATE INDEX IF NOT EXISTS idx_active_priority ON decision_rules(active, priority);

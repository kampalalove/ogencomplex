-- more_rules.sql
-- Seeding rich advisory rules (INSERT OR IGNORE to avoid duplicates)

INSERT OR IGNORE INTO decision_rules (rule_name, condition_json, action_text, priority, category, severity, domain, confidence_factors, evidence_source) VALUES
  ('high_temperature', '{"temperature":{"gt":85}}', 'High temperature detected. Check cooling system.', 70, 'thermal', 'WARNING', 'mechanical', NULL, NULL),
  ('critical_temperature', '{"temperature":{"gte":105}}', 'CRITICAL: Shutdown recommended. Immediate inspection required.', 100, 'thermal', 'CRITICAL', 'fire', NULL, 'manuals/thermal_emergency.pdf'),
  ('low_temperature', '{"temperature":{"lt":0}}', 'Freezing conditions. Apply de-icing procedures.', 35, 'thermal', 'WARNING', 'environmental', NULL, NULL),
  ('nominal_pressure_band', '{"pressure":{"between":[95,125]}}', 'Pressure is within nominal operating band.', 5, 'mechanical', 'INFO', 'chemical', NULL, NULL),
  ('high_pressure', '{"pressure":{"gt":130}}', 'Pressure exceeds normal range. Inspect seals and relief valves.', 65, 'mechanical', 'WARNING', 'chemical', NULL, NULL),
  ('critical_pressure', '{"pressure":{"gte":160}}', 'CRITICAL PRESSURE. Immediate venting required.', 100, 'mechanical', 'CRITICAL', 'chemical', NULL, 'manuals/pressure_relief.pdf'),
  ('low_fuel', '{"fuel_level":{"lte":10}}', 'Low fuel. Plan refueling soon.', 45, 'logistics', 'WARNING', 'aerospace', NULL, NULL),
  ('critical_fuel', '{"fuel_level":{"lt":3}}', 'CRITICAL FUEL LEVEL. Immediate refuel required.', 95, 'logistics', 'CRITICAL', 'aerospace', NULL, NULL),
  ('mission_mode_restricted', '{"mode":{"in":["restricted","manual_override_required"]}}', 'Restricted mission mode. Operator approval required.', 80, 'operations', 'WARNING', 'aerospace', NULL, 'manuals/operator_policy_v1.pdf'),
  ('engine_fire_detected', '{"fire_detected":{"eq":true}}', 'ENGINE FIRE. Execute suppression procedure immediately.', 100, 'emergency', 'CRITICAL', 'fire', NULL, 'manuals/engine_fire.pdf'),
  ('sensor_status_not_ok', '{"sensor_status":{"ne":"ok"}}', 'Sensor status is degraded. Switch to redundant sensing and preserve evidence.', 60, 'perception', 'WARNING', 'aerospace', NULL, 'manuals/perception_policy_v1.pdf'),
  ('stable_descent_window', '{"descent_rate":{"between":[1,5]}}', 'Descent rate is within stable approach window.', 5, 'operational', 'INFO', 'aerospace', NULL, NULL);

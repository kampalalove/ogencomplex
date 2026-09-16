INSERT OR IGNORE INTO decision_rules (rule_name, condition_json, action_text, priority, category, evidence_source) VALUES
  ('high_current', '{"current":{"gt":50}}', 'High current draw. Check for shorts or overload.', 15, 'electrical', NULL),
  ('critical_current', '{"current":{"gt":75}}', 'CRITICAL CURRENT. Immediate power down.', 100, 'electrical', 'manuals/electrical_fault.pdf'),
  ('low_fuel', '{"fuel_level":{"lt":10}}', 'Low fuel. Plan refueling soon.', 10, 'logistics', NULL),
  ('critical_fuel', '{"fuel_level":{"lt":3}}', 'CRITICAL FUEL. Immediate refuel required.', 100, 'logistics', NULL),
  ('vibration_high', '{"vibration":{"gt":0.5}}', 'Excessive vibration. Inspect rotor/motor balance.', 18, 'mechanical', 'manuals/vibration_analysis.pdf'),
  ('critical_vibration', '{"vibration":{"gt":1.2}}', 'CRITICAL VIBRATION. Halt operation.', 100, 'mechanical', 'manuals/vibration_critical.pdf'),
  ('high_altitude', '{"altitude":{"gt":3000}}', 'High altitude. Monitor O2 levels.', 8, 'operational', NULL),
  ('high_wind', '{"wind_speed":{"gt":25}}', 'Strong winds. Reduce airspeed.', 12, 'environmental', NULL),
  ('engine_fire', '{"fire_detected":true}', 'ENGINE FIRE. Execute suppression procedure.', 100, 'emergency', 'manuals/engine_fire.pdf');

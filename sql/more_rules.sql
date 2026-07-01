INSERT OR IGNORE INTO decision_rules (rule, condition, action, priority) VALUES
  ('Low humidity', 'humidity < 30', 'Increase humidity in storage area and recheck sensors.', 'low'),
  ('Power fluctuation', 'voltage_drop > 10', 'Switch to backup power and test regulator.', 'high'),
  ('Expired calibration', 'calibration_days > 365', 'Redo calibration immediately; flag as non-compliant.', 'high');

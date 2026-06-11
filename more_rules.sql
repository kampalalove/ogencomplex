-- more_rules.sql
-- Seeding base advisory rules (INSERT OR IGNORE to avoid duplicates)

INSERT OR IGNORE INTO decision_rules (rule_name, condition_json, action_text, priority, category, evidence_source) VALUES
  ('high_temperature', '{"temperature":{"gt":85}}', 'High temperature detected. Check cooling system.', 10, 'thermal', NULL),
  ('critical_temperature', '{"temperature":{"gt":105}}', 'CRITICAL: Shutdown recommended. Immediate inspection required.', 100, 'thermal', 'manuals/thermal_emergency.pdf'),
  ('low_temperature', '{"temperature":{"lt":0}}', 'Freezing conditions. Apply de-icing procedures.', 15, 'thermal', NULL),
  ('high_pressure', '{"pressure":{"gt":130}}', 'Pressure exceeds normal range. Inspect seals and relief valves.', 10, 'mechanical', NULL),
  ('critical_pressure', '{"pressure":{"gt":160}}', 'CRITICAL PRESSURE. Immediate venting required.', 100, 'mechanical', 'manuals/pressure_relief.pdf'),
  ('low_pressure', '{"pressure":{"lt":80}}', 'Low pressure. Check supply line and pump.', 8, 'mechanical', NULL),
  ('high_humidity', '{"humidity":{"gt":85}}', 'High humidity. Risk of condensation on electronics.', 12, 'environmental', NULL),
  ('low_humidity', '{"humidity":{"lt":20}}', 'Low humidity. Electrostatic discharge risk.', 5, 'environmental', NULL),
  ('high_current', '{"current":{"gt":50}}', 'Current draw exceeds normal. Check for shorts or overload.', 15, 'electrical', NULL),
  ('critical_current', '{"current":{"gt":75}}', 'CRITICAL CURRENT. Immediate power down recommended.', 100, 'electrical', 'manuals/electrical_fault.pdf'),
  ('high_voltage_spike', '{"voltage":{"gt":270}}', 'Voltage spike detected. Check regulator and surge protection.', 20, 'electrical', NULL),
  ('low_fuel', '{"fuel_level":{"lt":10}}', 'Low fuel. Plan refueling soon.', 10, 'logistics', NULL),
  ('critical_fuel', '{"fuel_level":{"lt":3}}', 'CRITICAL FUEL LEVEL. Immediate refuel required.', 100, 'logistics', NULL),
  ('vibration_high', '{"vibration":{"gt":0.5}}', 'Excessive vibration. Inspect rotor/motor balance.', 18, 'mechanical', 'manuals/vibration_analysis.pdf'),
  ('critical_vibration', '{"vibration":{"gt":1.2}}', 'CRITICAL VIBRATION. Halt operation and inspect immediately.', 100, 'mechanical', 'manuals/vibration_critical.pdf'),
  ('high_altitude', '{"altitude":{"gt":3000}}', 'High altitude. Reduced engine performance, monitor O2 levels.', 8, 'operational', NULL),
  ('extreme_altitude', '{"altitude":{"gt":5000}}', 'Extreme altitude. Crew oxygen mandatory.', 30, 'operational', NULL),
  ('high_wind', '{"wind_speed":{"gt":25}}', 'Strong winds. Reduce airspeed and be alert for turbulence.', 12, 'environmental', NULL),
  ('critical_wind', '{"wind_speed":{"gt":40}}', 'DANGEROUS WINDS. Land immediately if possible.', 90, 'environmental', NULL),
  ('high_aoa', '{"angle_of_attack":{"gt":12}}', 'High angle of attack. Stall possible. Reduce pitch.', 20, 'aerodynamic', NULL),
  ('critical_aoa', '{"angle_of_attack":{"gt":18}}', 'CRITICAL AOA. Imminent stall. Push nose down.', 100, 'aerodynamic', 'manuals/stall_recovery.pdf'),
  ('low_oxygen', '{"oxygen_saturation":{"lt":90}}', 'Low oxygen saturation. Use supplemental oxygen.', 25, 'medical', NULL),
  ('high_heart_rate', '{"heart_rate":{"gt":140}}', 'Elevated heart rate. Rest and hydrate.', 10, 'medical', NULL),
  ('quick_descent', '{"descent_rate":{"gt":10}}', 'Rapid descent. Check cabin pressure and landing gear.', 20, 'operational', NULL),
  ('engine_fire_detected', '{"fire_detected":true}', 'ENGINE FIRE. Execute fire suppression procedure immediately.', 100, 'emergency', 'manuals/engine_fire.pdf');

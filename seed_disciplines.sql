-- seed_disciplines.sql
-- 24 cross-disciplinary Veritas rules spanning 8 safety domains.

INSERT OR IGNORE INTO decision_rules (rule_name, condition_json, action_text, priority, category, severity, domain, confidence_factors, evidence_source) VALUES
  ('aerospace_high_aoa', '{"angle_of_attack":{"gt":12}}', 'High angle of attack, stall risk.', 80, 'aerodynamics', 'WARNING', 'aerospace', NULL, 'manuals/stall_recovery.pdf'),
  ('aerospace_mach_limit', '{"mach":{"gte":0.82}}', 'Mach limit approaching; reduce speed envelope.', 70, 'flight_envelope', 'WARNING', 'aerospace', NULL, NULL),
  ('aerospace_wing_load', '{"wing_load":{"gt":75}}', 'Wing loading exceeds planned envelope.', 65, 'structures', 'WARNING', 'aerospace', NULL, NULL),

  ('biomedical_low_oxygen', '{"oxygen_saturation":{"lt":90}}', 'Low oxygen saturation. Use supplemental oxygen.', 80, 'physiology', 'WARNING', 'biomedical', NULL, NULL),
  ('biomedical_high_heart_rate', '{"heart_rate":{"gt":140}}', 'Elevated heart rate. Rest and hydrate.', 45, 'physiology', 'WARNING', 'biomedical', NULL, NULL),
  ('biomedical_bp_crisis', '{"blood_pressure":{"gte":180}}', 'Critical blood pressure indicator. Seek immediate medical review.', 95, 'clinical', 'CRITICAL', 'biomedical', NULL, NULL),

  ('mechanical_vibration_high', '{"vibration":{"gt":0.5}}', 'Excessive vibration. Inspect rotor/motor balance.', 70, 'mechanical', 'WARNING', 'mechanical', NULL, 'manuals/vibration_analysis.pdf'),
  ('mechanical_torque_high', '{"torque":{"gt":120}}', 'Torque exceeds rated mechanical envelope.', 75, 'mechanical', 'WARNING', 'mechanical', NULL, NULL),
  ('mechanical_rpm_overspeed', '{"rpm":{"gte":9500}}', 'Rotor overspeed. Reduce throttle and inspect governor.', 90, 'mechanical', 'CRITICAL', 'mechanical', NULL, NULL),

  ('electrical_current_high', '{"current":{"gt":50}}', 'High current draw. Check for shorts or overload.', 70, 'electrical', 'WARNING', 'electrical', NULL, NULL),
  ('electrical_voltage_spike', '{"voltage":{"gt":270}}', 'Voltage spike detected. Check regulator and surge protection.', 75, 'electrical', 'WARNING', 'electrical', NULL, NULL),
  ('electrical_resistance_high', '{"resistance":{"gt":10}}', 'Resistance is above expected range; inspect connectors.', 35, 'electrical', 'INFO', 'electrical', NULL, NULL),

  ('chemical_pressure_high', '{"pressure":{"gt":130}}', 'Pressure exceeds normal range. Inspect seals and relief valves.', 75, 'chemical', 'WARNING', 'chemical', NULL, NULL),
  ('chemical_ph_out_of_range', '{"any":[{"ph":{"lt":6.5}},{"ph":{"gt":8.5}}]}', 'pH is outside safe operating range.', 65, 'chemical', 'WARNING', 'chemical', NULL, NULL),
  ('chemical_flow_low', '{"flow_rate":{"lt":2}}', 'Flow rate below required throughput.', 55, 'chemical', 'WARNING', 'chemical', NULL, NULL),

  ('environmental_humidity_high', '{"humidity":{"gt":85}}', 'High humidity. Risk of condensation on electronics.', 55, 'environmental', 'WARNING', 'environmental', NULL, NULL),
  ('environmental_air_quality_low', '{"air_quality":{"lt":50}}', 'Air quality degraded; reduce exposure and increase filtration.', 50, 'environmental', 'WARNING', 'environmental', NULL, NULL),
  ('environmental_wind_critical', '{"wind_speed":{"gt":40}}', 'Dangerous winds. Land immediately if possible.', 90, 'environmental', 'CRITICAL', 'environmental', NULL, NULL),

  ('fire_smoke_detected', '{"smoke":{"eq":true}}', 'Smoke detected. Start fire verification and suppression workflow.', 90, 'fire', 'CRITICAL', 'fire', NULL, 'manuals/engine_fire.pdf'),
  ('fire_flame_detected', '{"flame_detected":{"eq":true}}', 'Flame detected. Execute suppression procedure immediately.', 100, 'fire', 'CRITICAL', 'fire', NULL, 'manuals/engine_fire.pdf'),
  ('fire_heat_smoke_combo', '{"all":[{"temperature":{"gt":80}},{"smoke":{"eq":true}}]}', 'Heat and smoke detected together. Treat as confirmed fire.', 100, 'fire', 'CRITICAL', 'fire', NULL, 'manuals/thermal_emergency.pdf'),

  ('nuclear_radiation_high', '{"radiation":{"gt":0.05}}', 'Radiation level elevated. Increase shielding and evacuate nonessential personnel.', 100, 'radiological', 'CRITICAL', 'nuclear', NULL, NULL),
  ('nuclear_coolant_hot', '{"coolant_temp":{"gte":95}}', 'Coolant temperature high. Increase flow and inspect heat exchanger.', 85, 'thermal', 'WARNING', 'nuclear', NULL, NULL),
  ('nuclear_neutron_flux_high', '{"neutron_flux":{"gt":1000000}}', 'Neutron flux exceeds operating envelope. Initiate reactor safety review.', 100, 'reactor', 'CRITICAL', 'nuclear', NULL, NULL);

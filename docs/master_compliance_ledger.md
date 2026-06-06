# OGEN MASTER COMPLIANCE LEDGER

> **System Doctrine:** Bounded, local-first, air-gapped validation. Compliance is evaluated via deterministic evidence generated natively on-disk with zero cloud dependencies.

## PILLAR 1: PERCEPTION & MAPPING (Spatial Integrity & Sensing)
- **Domain Focus:** SLAM, TSDF voxel resolution, sensor fusion accuracy, coordinate spatial mapping.
- **Regulatory Alignment:** FAA ground risk mitigation and obstacle avoidance verification.

### Compliance Boundaries
- Sensor drop isolation must detect primary sensing dropout and route fallback state estimation.
- Voxelization latency controls must remain bounded for local 3D map updates.

### Deterministic Evidence Logs
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p1_spatial_drift.bin`
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p1_sensor_heartbeat.json`

## PILLAR 2: PLANNING & MOTION (Kinodynamic Predictability)
- **Domain Focus:** Minimum-snap trajectory planning, collision avoidance, multi-agent mesh coordination.
- **Regulatory Alignment:** Operational safety containment and trajectory predictability standards.

### Compliance Boundaries
- Kinodynamic hard-clamps enforce planner velocity and acceleration constraints.
- Multi-agent collision horizon preserves predictive safety lead time.

### Deterministic Evidence Logs
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p2_trajectory_bounds.json`
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p2_mesh_convergence.bin`

## PILLAR 3: CONTROL, SAFETY & BOUNDARIES (The Reflex Layer)
- **Domain Focus:** Command validation, geo-fencing, boundary enforcement, HIL failsafes.
- **Regulatory Alignment:** FAA-aligned safety case and autonomous termination compliance.

### Compliance Boundaries
- Input sanitization gate enforces strict frame signature validation.
- Hard geo-fence clamps trigger deterministic safe-state transitions.

### Deterministic Evidence Logs
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p3_command_sanitization.log`
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p3_failsafe_triggers.json`

## PILLAR 4: TOOLS, AUTOMATION & KNOWLEDGE (Workspace Sovereignty)
- **Domain Focus:** Manifest schemas, registry integrity, localized dependency verification.
- **Regulatory Alignment:** Configuration control, auditability, and traceability.

### Compliance Boundaries
- Manifest and registry integrity must remain cryptographically verifiable.
- Circular dependency references must fail workspace validation.

### Deterministic Evidence Logs
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p4_registry_sign.hash`
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p4_validation_report.json`

## PILLAR 5: LEARNING, SIMULATION & IMPROVEMENT (Iterative Validation)
- **Domain Focus:** High-fidelity simulation replay, telemetry delta analysis, AI boundary checks.
- **Regulatory Alignment:** Continued operational safety and post-incident analysis capability.

### Compliance Boundaries
- Deterministic simulation replay must remain bounded against live telemetry profiles.
- AI inference remains advisory; deterministic sensor logic stays actuator-authoritative.

### Deterministic Evidence Logs
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p5_simulation_delta.json`
- `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p5_inference_audit.bin`

## Operational Execution
```bash
# Validate manifest and five-pillar compliance package
node tools/validate_manifest.js --target compliance

# Verify or repair five-pillar evidence paths, then emit hashes/report
node tools/parallel_check.js
```

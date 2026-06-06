# OGEN MASTER COMPLIANCE MATRIX (5-PILLAR)

| Pillar | Domain Focus | Core Safety Boundaries | Deterministic Evidence Logs | Validation Hooks |
|---|---|---|---|---|
| Pillar 1: Perception & Mapping | SLAM, TSDF, sensor fusion | Sensor dropout isolation; bounded voxelization latency | `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p1_spatial_drift.bin`, `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p1_sensor_heartbeat.json` | `npm test`, `npm run evidence` |
| Pillar 2: Planning & Motion | Trajectory planning, swarm mesh | Kinodynamic clamps; collision horizon prediction | `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p2_trajectory_bounds.json`, `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p2_mesh_convergence.bin` | `tests/run_deterministic_evidence.js` |
| Pillar 3: Control, Safety & Boundaries | Command gatekeeping, failsafe transitions | Strict frame sanitization; deterministic safe-state triggers | `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p3_command_sanitization.log`, `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p3_failsafe_triggers.json` | `tests/run_deterministic_evidence.js`, `tests/run_ops_deterministic.js` |
| Pillar 4: Tools, Automation & Knowledge | Manifest, registry, dependency integrity | Cryptographic drift detection; circular dependency rejection | `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p4_registry_sign.hash`, `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p4_validation_report.json` | `node tools/validate_manifest.js --target compliance`, `node tools/parallel_check.js --strict` |
| Pillar 5: Learning, Simulation & Improvement | Simulation replay, inference audit | Replay delta containment; AI advisory-only boundary | `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p5_simulation_delta.json`, `/tmp/workspace/kampalalove/ogencomplex/logs/compliance/p5_inference_audit.bin` | `node tools/parallel_check.js` |

See `/tmp/workspace/kampalalove/ogencomplex/docs/master_compliance_ledger.md` for the full sovereign compliance ledger doctrine.

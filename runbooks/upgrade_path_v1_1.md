# OGEN-ASCS Upgrade Path: v1.0.1 -> v1.1

## Rollout Profiles
- `OGEN_PROTOCOL_PROFILE=v1.0.1`: stable baseline (single-drone, no patrol loop control, no anomaly-severity rendering)
- `OGEN_PROTOCOL_PROFILE=v1.1`: enables multi-drone routing, patrol loop commands, mission status, semantic anomaly extensions

## Staged Deployment
1. Deploy bridge with profile `v1.0.1` and verify legacy telemetry/command paths.
2. Enable `v1.1` in non-production validation environment and execute `npm test` + `npm run evidence`.
3. Promote `v1.1` only when deterministic evidence bundle reports zero failures.

## Regression Gates
- No failed cases in deterministic evidence output.
- No unsupported protocol minor packets accepted by bridge.
- Mission timeout failsafe status emitted for timeout injection case.

## Rollback Criteria
Immediate rollback to `v1.0.1` profile if any of the following occur:
- Unexpected mission state transitions.
- Telemetry routing mismatch by vehicle ID.
- UI voxel rendering receives invalid semantic classes without rejection.

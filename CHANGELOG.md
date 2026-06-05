# Changelog

## [1.0.0-GA] - 2026-06-05

### Added

- `/tmp/workspace/kampalalove/ogencomplex/README.md`: Central repository index, doctrine overview, and directory mapping.
- `/tmp/workspace/kampalalove/ogencomplex/edge/main.go`: Deterministic hash-chain primitive using SHA-256 for state-vector verification.
- `/tmp/workspace/kampalalove/ogencomplex/tests/stress_suite.py`: Multi-variant failure injection harness covering 7 failure modes.
- `/tmp/workspace/kampalalove/ogencomplex/runbooks/DLR_VA01_deployment.md`: Deployment guide for localized data center nodes.
- `/tmp/workspace/kampalalove/ogencomplex/runbooks/SCADA_deployment.md`: Runbook with safety overrides for water infrastructure.
- `/tmp/workspace/kampalalove/ogencomplex/docs/soc2_readiness.md`: SOC 2 readiness checklist.
- `/tmp/workspace/kampalalove/ogencomplex/docs/BAA_template.md`: HIPAA Business Associate Agreement template.

### Changed

- Refined float formatting in `/tmp/workspace/kampalalove/ogencomplex/edge/main.go` to enforce 6-decimal precision.
- Migrated subprocess invocation in `/tmp/workspace/kampalalove/ogencomplex/tests/stress_suite.py` to non-shell execution with bounded timeouts.

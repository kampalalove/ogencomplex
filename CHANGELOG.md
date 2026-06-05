# Changelog

## [1.0.0-GA] - 2026-06-05

### Added

- `README.md`: Central repository index, doctrine overview, and directory mapping.
- `edge/main.go`: Deterministic hash-chain primitive using SHA-256 for state-vector verification.
- `tests/stress_suite.py`: Multi-variant failure injection harness covering 7 failure modes.
- `runbooks/DLR_VA01_deployment.md`: Deployment guide for localized data center nodes.
- `runbooks/SCADA_deployment.md`: Runbook with safety overrides for water infrastructure.
- `docs/soc2_readiness.md`: SOC 2 readiness checklist.
- `docs/BAA_template.md`: HIPAA Business Associate Agreement template.

### Changed

- Refined float formatting in `edge/main.go` to enforce 6-decimal precision.
- Migrated subprocess invocation in `tests/stress_suite.py` to non-shell execution with bounded timeouts.

# FAA Filing-Ready Submission Set

## Scope
This package supports OGEN-ASCS-1.1 baseline hardening and OGEN-OPS-1.0 operational controls with proof-first sequencing: invariants, safety gates, deterministic tests, and compliance evidence before UI expansion.

## Traceability Chain
1. **Requirement**: Multi-drone coordination, patrol loops, semantic voxel labeling, staged protocol rollout, local mission templates, and signed audit records.
2. **Invariant**: Safety bounds, protocol compatibility, mission timeout failsafe, payload schema validation, local-only execution manifest, and tamper-evident mission ledger integrity.
3. **Proof**: Deterministic fixture-driven tests and generated logs/results bundles for baseline bridge plus OPS controls.

## Deterministic Evidence Bundle
- Core inputs: `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/inputs/test_cases.json`
- Core expected outcomes: `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/expected_outcomes.json`
- OPS inputs: `/tmp/workspace/kampalalove/ogencomplex/tests/ops_evidence/inputs/test_cases.json`
- OPS expected outcomes: `/tmp/workspace/kampalalove/ogencomplex/tests/ops_evidence/expected_outcomes.json`
- Execution command: `npm run evidence`
- Outputs:
  - `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/results.json`
  - `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/logs/deterministic.log`
  - `/tmp/workspace/kampalalove/ogencomplex/tests/ops_evidence/results.json`
  - `/tmp/workspace/kampalalove/ogencomplex/tests/ops_evidence/logs/deterministic.log`

## Compliance Matrix
See `/tmp/workspace/kampalalove/ogencomplex/docs/compliance_matrix.md`.

## Regression Gates
- Bridge must reject out-of-bounds trajectory payloads.
- Mission controller must emit `FAILSAFE_TIMEOUT` under timeout injection.
- Voxel validator must reject or normalize invalid semantic/anomaly fields.
- OPS manifest validation must enforce simultaneous expansion keys (ASCS/OPS/SIM/AI).
- OPS audit signatures must fail validation when mission payloads are tampered.
- All initialization routines must remain local-first and air-gapped.

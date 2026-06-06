# FAA Filing-Ready Submission Set

## Scope
This package supports OGEN-ASCS-1.1 expansion with proof-first sequencing: invariants, safety gates, deterministic tests, and compliance evidence before UI expansion.

## Traceability Chain
1. **Requirement**: Multi-drone coordination, patrol loops, semantic voxel labeling, staged protocol rollout.
2. **Invariant**: Safety bounds, protocol compatibility, mission timeout failsafe, payload schema validation.
3. **Proof**: Deterministic fixture-driven tests and generated logs/results bundle.

## Deterministic Evidence Bundle
- Inputs: `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/inputs/test_cases.json`
- Expected outcomes: `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/expected_outcomes.json`
- Execution command: `npm run evidence`
- Outputs:
  - `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/results.json`
  - `/tmp/workspace/kampalalove/ogencomplex/tests/evidence/logs/deterministic.log`

## Compliance Matrix
See `/tmp/workspace/kampalalove/ogencomplex/docs/compliance_matrix.md`.

## Regression Gates
- Bridge must reject out-of-bounds trajectory payloads.
- Mission controller must emit `FAILSAFE_TIMEOUT` under timeout injection.
- Voxel validator must reject or normalize invalid semantic/anomaly fields.
- UI must preserve per-session selected/follow vehicle state during reconnect cycles.

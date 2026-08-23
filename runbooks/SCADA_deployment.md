# Water SCADA Deployment Runbook

## Adapter Configuration
- Modbus TCP (or OPC‑UA) to SCADA network
- Edge placed in control room, no direct internet

## Verification
- Ingest flow, pressure, valve position at 1 Hz
- Run `verify_state_vector` locally
- Forward only anonymized, hashed telemetry

## Safety Interlocks
- Playbook triggers valve override on pressure drop
- Manual release required after automatic action

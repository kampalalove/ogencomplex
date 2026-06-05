# Business Associate Agreement (BAA) – Veritas Edge

## Covered Entity Obligations
- Maintain physical security of edge device
- Control access to facility network
- Provide de‑identified telemetry feeds only

## Business Associate Obligations (Veritas)
- Deploy only signed, immutable binary (Wedge‑1 kernel)
- No remote access to raw data – only signed queries
- Automated breach detection via ledger hash mismatch
- Notify covered entity within 1 hour of any P0 ledger integrity failure

## Permitted Uses
- Real‑time infrastructure verification
- SLA penalty calculation
- Regulatory reporting (if de‑identified)

## Prohibited Uses
- Storage of patient identifiers
- Selling or sharing data

## Breach Notification
- Triggered automatically by ledger mismatch
- Forensic export of hash chain provided to covered entity
- Veritas bears cost of investigation only if breach originated from binary failure

## Termination
- 30 days’ notice
- Edge device wipes all raw data, leaves anonymous aggregated logs

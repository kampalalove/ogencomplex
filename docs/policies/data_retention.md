# Data Retention Policy

- **Raw telemetry**: 30 days (edge buffer + core)
- **Verified state vectors**: 7 years (immutable ledger)
- **Hash‑chain integrity**: Verified daily; any mismatch triggers incident
- **Deletion**: Automated retention job, logged and hashed

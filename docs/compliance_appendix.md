# Compliance Appendix

## Framework Mapping Matrix

| Control Identifier | Document / Policy Asset | Veritas Implementation Objective |
|---|---|---|
| **SOC 2 CC6.1** (Access Control) | `docs/policies/access_control.md` | Restricts access to edge-node ledger and local secrets storage to authenticated infrastructure engineers and authorized automation accounts. |
| **SOC 2 CC6.5** (Boundary Defense) | `runbooks/SCADA_deployment.md` | Establishes air-gapping and hardware-level network boundary constraints for industrial automation setups. |
| **SOC 2 CC7.3** (Incident Detection) | `docs/policies/incident_response.md` | Defines telemetry alerts and notification chains when hash-chain validation fails. |
| **HIPAA §164.312(c)(1)** (Data Integrity) | `edge/main.go` | Uses cryptographic hash chains (`computeHash`) to detect retroactive alteration of infrastructure state vectors. |
| **Regulatory Coverage** | `docs/BAA_template.md` | Outlines liabilities and data-handling requirements for protected operational telemetry. |

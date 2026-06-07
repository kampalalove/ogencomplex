# Skylars Global Institute: Core Attestation Rail (v1.0.0)

> **Sovereign AI Capability Attestation Substrate**
> *No universities. No accreditation. Only cryptographic proof that capability X ran on date Y with evidence Z.*

This repository contains the production-ready execution layer for **Service 1: Audit-First AI Compliance**. It implements **Major 4 (Cryptographic Attestation)** as the root of trust, driven by **Major 2 (Rule-Bound Reasoning)** and actively guarded by **Major 5 (Runtime Auditing)**.

## ── ARCHITECTURAL OVERVIEW ──

```
   [Raw Input / State Trace] 
               │
               ▼
   ┌───────────────────────┐
   │  Major 5: Audit Loop  │ ─── (Context Drift / Threshold Breach) ───► [HARD HALT]
   └───────────────────────┘
               │
               ▼ (Passes Safety Guard)
   ┌───────────────────────┐
   │  Major 2: Rule Engine │ ─── (Evaluates Statutory Invariants) ───► [VERDICT]
   └───────────────────────┘
               │
               ▼ (VALID / INVALID / REVIEW)
   ┌───────────────────────┐
   │ Major 4: Crypto Cert  │ ─── (RFC 8785 Canonical Serialization) ──► [attestation_registry.jsonl]
   └───────────────────────┘
```

## ── DIRECTORY STRUCTURE ──

```text
├── LICENSE                   # Proprietary / All Rights Reserved (2026 SGI)
├── NOTICE                    # Third-party compliance and primitive tracking
├── attestation_registry.jsonl# The immutable local ledger of issued verdicts
├── rules/
│   └── rule_bound_reasoning_v1.0.0.json  # Canonical EU AI Act/SEC rule graphs
├── attestation.py            # Major 4: Root cryptographic signing engine
├── rule_engine.py             # Major 2: Deterministic evaluation matrix
└── runtime_audit.py          # Major 5: Active process monitor & fallback guard
```

## ── QUICKSTART & VERIFICATION ──

### 1. Environment Verification

The Core Rail is engineered to run locally with zero third-party platform dependencies. Ensure your local environment has the required cryptographic primitives:

```bash
pip install cryptography
```

### 2. Execute the Compliance Loop

Run the integrated pipeline to ingest evidence, evaluate statutory rules, assert runtime safety limits, and sign the final immutable token:

```bash
python rule_engine.py
```

### 3. Verify the Ledger Output

Inspect the append-only ledger to view the signed, cryptographically bound attestation record:

```bash
tail -n 1 attestation_registry.jsonl
```

## ── CORE API SPECIFICATION (OFFLINE-FIRST) ──

### Primitive: CapabilityAttestation.attest()

The ultimate target primitive that all current and downstream Majors implement to generate verifiable evidence.

#### Input Schema

```json
{
  "evidence_hash": "sha256:...",      // Hash of the empirical input files/PDFs
  "rule_graph_hash": "sha256:...",    // Hash of the immutable statutory rule file
  "execution_log_hash": "sha256:...", // Hash of the active agent step-trace
  "verdict": "VALID_ENFORCEABLE"      // [VALID_ENFORCEABLE | REVIEW_REQUIRED_FACT | INVALID]
}
```

#### Output Attestation Token

```json
{
  "major": 4,
  "domain": "Deterministic Systems & Rule-Bound Reasoning",
  "agent_id": "biglaw_compliance_agent_v1",
  "verdict": "VALID_ENFORCEABLE",
  "evidence_hash": "sha256:a1b2c3...",
  "rule_graph_hash": "sha256:d4e5f6...",
  "execution_log_hash": "sha256:g7h8i9...",
  "attested_at": "2026-06-06T21:37:34Z",
  "payload_hash": "9a8b7c6d...",
  "signature_b64": "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw...",
  "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----\n"
}
```

## ── EXTRACTING THE PROOF FOR REGULATORS ──

To extract and mathematically prove the validity of any execution artifact to an external compliance auditor or regulator, execute the standard open-source verification command:

```bash
# 1. Extract the public key from the attestation token to disk
echo "YOUR_PUBLIC_KEY_PEM_STRING" > pubkey.pem

# 2. Verify the cryptographic payload match offline
openssl dgst -sha256 -verify pubkey.pem -signature signature.bin payload.json
```

### The rail is completely locked and fully compiled. Use this core architecture to run your internal pilot and secure your anchor signers.

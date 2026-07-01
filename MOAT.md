# Gate 3 — The Moat Document

## What This Is

The Ogen Complex moat is not a feature list. It is a structural position that cannot be replicated by following the same steps, because the steps themselves produce the moat.

## The Three Gates

### Gate 1: The Engine (Shipped ✅)

The audio production pipeline is deterministic and verifiable:

- **Normalize → Hash → Sign → Territory Matrix** — every input produces a unique, cryptographically signed master.
- **IP Fingerprint** — derived from audio content + metadata. Same input = same fingerprint. Always.
- **Receipts** — every operation writes a signed audit log. Tamper-evident by construction.

The engine doesn't depend on external services. It runs on a single Node process. No API keys to revoke, no rate limits to hit, no vendor to negotiate with.

### Gate 2: The Money Path (Shipped ✅)

The distribution + withdrawal pipeline proves end-to-end fund flow:

- **Contract** — signed agreement between artist, distributor, and platform with explicit split terms.
- **Withdraw** — moves funds to `ogen_complex_bank` with receipt verification.
- **money_001.json** — the proof artifact. Exists on disk. Verifies cryptographically.

Gate 2 is testable by any frontend. No shell access required. The API accepts JSON, returns JSON, writes receipts.

### Gate 3: The Moat (This Document)

The moat is the combination of:

1. **Deterministic provenance** — Every master has a verifiable chain from raw audio to signed output. No other platform offers this without a blockchain dependency.

2. **Sovereign infrastructure** — The vault secret lives in `process.env.VAULT_SECRET`. The server runs on your metal (or Fly.io). No third-party custody of keys.

3. **Audit-ready from day one** — Receipts directory contains signed JSON for every operation. An auditor can verify any transaction without running the application.

4. **Zero external dependencies for core logic** — The produce/edit/commercial pipeline uses only Node.js crypto. No SDK lock-in. No vendor migration risk.

5. **Single-call commercial pipeline** — `POST /commercial` collapses what competitors require 3-5 API calls for into one atomic operation with full receipt chain.

## Competitive Position

| Capability | Ogen Complex | DistroKid | TuneCore | CD Baby |
|-----------|:---:|:---:|:---:|:---:|
| Deterministic audio fingerprint | ✅ | ❌ | ❌ | ❌ |
| Cryptographic receipt chain | ✅ | ❌ | ❌ | ❌ |
| Self-hosted sovereign keys | ✅ | ❌ | ❌ | ❌ |
| Single-call full pipeline | ✅ | ❌ | ❌ | ❌ |
| No vendor lock-in | ✅ | ❌ | ❌ | ❌ |
| Territory matrix on produce | ✅ | Partial | Partial | Partial |

## What Mario Gets

When Mario receives access, he gets:

1. A running API at a public URL
2. This moat document proving structural advantage
3. The `receipts/` directory with cryptographic proof of every operation
4. A stress test proving 100x deterministic runs

He does **not** get:
- Shell access
- The vault secret
- Ability to modify the signing pipeline

## The Unforkable Part

Even if someone forks this repo, they cannot:
- Reproduce existing receipts (different vault secret)
- Claim provenance over masters signed by this instance
- Replicate the territory clearance without the same pipeline hash

The moat is not the code. The moat is the signed history that the code produces.

---

*Generated for Site_001 PHX-01. Gate 3 locked.*

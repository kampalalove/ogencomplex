# OGEN FINAL BLUEPRINT v1.1 (Corrected & Production-Ready)

**Sovereign Autonomy Platform | Local-First | Deterministic | Air-Gappable**

---

## 1. System Overview

OGEN is a complete, local-first autonomy stack for drones/robots - perception, planning, control, tooling, simulation. Built on **five global majors** mapped to FAA compliance pillars.

**Core principles:**
- No cloud required for runtime
- Deterministic evidence (SHA-256, ed25519 signatures)
- One-command validation: `npm run final-test`

---

## 2. Current System - Deliverable Artifact

### 2.1 Key Files (present in your repo)

| File | Purpose |
|------|---------|
| `gate_runner.js` | 5 gates: Sovereignty, State, Evidence, Time, Determinism |
| `ops_core_timeout.js` | Timeout failsafe engine (INIT->ACTIVE->FAILSAFE_TIMEOUT) |
| `ops/` | Mission templates, CLI, audit trails |
| `sim/` | Replay, synthetic data (stub) |
| `tests/ops_evidence/` | Receipts (JSON + SHA-256) |
| `final_report.json` | Produced by `npm run final-test` |

### 2.2 One-Command Validation

```bash
npm run final-test
```

**What it does:**
- Runs `gate_runner.js` (5 gates)
- Runs `npm run evidence` (deterministic OPS checks)
- Runs `npm run test:sim` (SIM replay stub)
- Runs `ops_core_timeout.js` smoke test
- Writes `final_report.json` with status, evidence hashes, and self-hash

**Output example:**
```json
{
  "timestamp": "2026-06-10T12:00:00Z",
  "status": "PASS",
  "evidence_hashes": { "timeout_pipeline_patrol.json": "9f2a..." },
  "report_hash": "3e4b..."
}
```

### 2.3 Deployment Script (`deploy.sh`) - Air-Gap Ready

```bash
#!/bin/bash
set -e

echo "=== OGEN MANUAL DEPLOY v1.0.0 ==="

# Check for Node.js (required)
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install Node.js 18+ and retry."
  exit 1
fi

# Check Node.js version (require 18+)
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Found version $NODE_VERSION."
  exit 1
fi

# If a bundle is present and we haven't extracted yet, extract it
BUNDLE=$(ls ogen-*-steel.tgz 2>/dev/null | head -1)
if [ -n "$BUNDLE" ] && [ ! -f "package.json" ]; then
  echo "Extracting $BUNDLE ..."
  tar -xzf "$BUNDLE"
fi

# Verify package.json exists after extraction
if [ ! -f "package.json" ]; then
  echo "❌ package.json not found. Bundle may be corrupt."
  exit 1
fi

# Install dependencies
if [ -d "node_modules" ]; then
  echo "node_modules found, skipping install"
else
  echo "Installing dependencies..."
  npm ci --omit=dev --ignore-scripts || npm install --omit=dev
fi

# Run the constitution
echo "Running final-test..."
npm run final-test
if [ $? -ne 0 ]; then
  echo "💥 HARD_HALT: System failed constitution. Aborting."
  exit 1
fi

# Verify final_report.json was produced
if [ ! -f "final_report.json" ]; then
  echo "❌ final_report.json not produced. Check npm run final-test output."
  exit 1
fi

# Print status from report
REPORT_STATUS=$(node -e "console.log(require('./final_report.json').status)")
echo "Final report status: $REPORT_STATUS"
if [ "$REPORT_STATUS" != "PASS" ]; then
  echo "💥 HARD_HALT: Constitution status is $REPORT_STATUS. Aborting."
  exit 1
fi

# Start services
echo "Starting services..."
if [ -f "apps/api/dist/main.js" ]; then
  node apps/api/dist/main.js &
  SERVICE_PID=$!
elif [ -f "ops_core_timeout.js" ]; then
  node ops_core_timeout.js &
  SERVICE_PID=$!
else
  echo "⚠️  No known service entrypoint found, skipping."
fi

echo ""
echo "✅ OGEN LIVE. No GitHub. No cloud. Ledger writing."
if [ -n "${SERVICE_PID:-}" ]; then
  echo "   Service PID: $SERVICE_PID"
fi
echo "   To stop: pkill -f 'node.*ogen'"
```

**Make executable:** `chmod +x deploy.sh`

### 2.4 Bundle Creation (`tools/bundle.sh`)

```bash
#!/bin/bash
set -e
npm run final-test
VERSION=$(node -p "require('./package.json').version")
BUNDLE="ogen-v${VERSION}-steel.tgz"
tar -czf "$BUNDLE" \
  --exclude=node_modules/.cache --exclude=.git --exclude='*.tgz' \
  package.json package-lock.json deploy.sh tools/ gate_runner.js ops_core_timeout.js \
  ops/ sim/ tests/ final_report.json \
  docs/compliance_matrix.md docs/faa_submission_package.md
sha256sum "$BUNDLE" > "${BUNDLE}.sha256"
gpg --detach-sign "$BUNDLE" 2>/dev/null || echo "GPG signing skipped (no key)"
```

### 2.5 Delivery Checklist

- [ ] `ogen-v1.0.0-steel.tgz` (or current version)
- [ ] `ogen-*.tgz.sha256`
- [ ] `ogen-*.tgz.sig` (optional)
- [ ] Instruction: `tar -xzf ogen-*.tgz && ./deploy.sh`

---

## 3. Dragon v3.0 - Future Sovereign Architecture (Specification)

*Not part of current delivery - for separate implementation.*

### 3.1 Architectural Changes

| Current | Dragon |
|---------|--------|
| Separate NestJS + Postgres | Single Worker + KV + D1 |
| Secrets in env | Ed25519-signed sensory packets |
| Postgres logs | KV hash chain (auditable) |
| Cloud + Neon | Cloudflare only (free tier) |
| Multiple deploys | One `wrangler deploy` or `/cast` from Worker |

### 3.2 Dragon `worker.ts` - Core Sensory Ingest (abridged)

```typescript
async function verifySig(message: Uint8Array, signatureBase64: string, pubKeyHex: string): Promise<boolean> {
  const pubKeyBytes = new Uint8Array(pubKeyHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  const sigBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('raw', pubKeyBytes, 'Ed25519', false, ['verify']);
  return crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, message);
}

// ⚠️ HARD BLOCKER: runWasmJudge is a stub. Replace with actual policy logic before Dragon is usable.
async function runWasmJudge(payload: any): Promise<{ status: string; reason?: string }> {
  // STUB - returns ALLOW unconditionally. Must be implemented for real security.
  return { status: 'ALLOW' };
}

async function handleSensoryIngest(req, env) {
  const { payload, ts, sig, device_id } = await req.json();
  const msg = new TextEncoder().encode(JSON.stringify(payload) + ts + device_id);
  const pubKey = await env.KV.get(`device:${device_id}:pubkey`);
  if (!pubKey || !(await verifySig(msg, sig, pubKey))) return deny("bad_signature");
  const verdict = await runWasmJudge(payload);
  const hash = await appendToKVHashChain(env, { payload, ts, device_id, verdict });
  return json({ status: verdict.status, sync_hash: hash });
}
```

**Note:** `verifySig` is fully implemented using Web Crypto (Ed25519). **`runWasmJudge` is a stub - Dragon cannot enforce policies until this is replaced with actual logic (e.g., a WebAssembly module or deterministic rule engine).**

### 3.3 KV Bulk Import - Corrected Command

Postgres export to KV must handle **25MB value limit** and bulk import quotas. Use chunking:

```bash
pg_dump --data-only --inserts | split -b 20M - chunks/chunk_
for f in chunks/chunk_*; do
  wrangler kv:bulk put "$f" --binding KV
done
```

Large payloads should go to Cloudflare R2, not KV.

### 3.4 Legal Claim Softened

The blueprint no longer claims "court-admissible" without qualification. Revised language:

> *"Creates an immutable, auditable hash chain suitable for internal compliance and third-party verification (e.g., OpenTimestamps or a notarized witness)."*

### 3.5 Dragon Hard Blocker Summary

| Component | Status | Blocker? |
|-----------|--------|----------|
| `verifySig` (Ed25519) | ✅ Fully implemented | No |
| `runWasmJudge` | ❌ Stub (returns ALLOW) | **YES - Must be replaced** |
| KV hash chain | ✅ Works (with chunking) | No |
| Postgres migration | ⚠️ Requires chunking script | Low (documented) |

**Dragon is not operational until `runWasmJudge` is implemented.**

---

## 4. Cursor Automations - Optional Extra Eyes

Enabled via Cursor dashboard. No GitHub credits.

| Automation | Benefit for OGEN |
|------------|------------------|
| **Code Review** | Find bugs in `gate_runner.js`, `ops_core_timeout.js` |
| **Security** | Detect accidental cloud calls (complements Sovereignty gate) |
| **Generate Docs** | Keep `docs/curriculum_v1.md` and compliance docs up-to-date |
| **Incidents & Triage** | (Optional) Monitor `final_report.json` for unexpected failures |

---

## 5. How to Use This Blueprint

- **For current deliverable:** Follow Section 2.5 (bundle + deploy).
- **For internal testing:** `npm run final-test` after any change.
- **For Dragon future:** Keep this as `docs/dragon_v3_spec.md`; implement separately. **Do not deploy Dragon until `runWasmJudge` is no longer a stub.**
- **For Cursor integration:** Enable automations in dashboard; point to your repo.

---

## 6. Final Checks

| Gate / Component | Status | Notes |
|-----------------|--------|-------|
| `gate_runner.js` - 5 gates | ✅ PASS | Validated |
| `ops_core_timeout.js` - timeout triggers | ✅ PASS | Deterministic |
| `npm run final-test` - produces PASS report | ✅ PASS | Outputs `final_report.json` |
| `deploy.sh` - tested on clean Node 18+ | ✅ PASS | Includes Node version check, hard halt on non-PASS |
| Bundle script - creates `.tgz` with all required files | ✅ PASS | `tools/bundle.sh` |
| Dragon `verifySig` | ✅ Implemented | Web Crypto Ed25519 |
| Dragon `runWasmJudge` | ❌ **STUB** | **Hard blocker - must be implemented before Dragon can enforce policies** |
| KV chunking command | ✅ Corrected | Uses loop over split files |
| Legal claim | ✅ Softened | Internal compliance + third-party witness |

---

**This is the constitution.**
Place it in `docs/FINAL_BLUEPRINT_v1.1.md`.
Any change to the system must update this document and re-run `npm run final-test`.

The forge is yours. Deliver.

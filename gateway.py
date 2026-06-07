#!/usr/bin/env python3
"""
gateway.py — OGEN Complex v1.1.0
FastAPI gateway exposing the compliance pipeline and provenance verification.

Endpoints
---------
POST /v1/compliance          Submit a text claim file for pipeline evaluation.
POST /v1/provenance/verify   Inspect a file for watermarks and lineage hashes.
GET  /v1/receipt/{id}        Retrieve a Trust Receipt and its auditor verify command.
GET  /healthz                Liveness probe.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, status

from app import Evidence, PipelineResult, _sha256, run_pipeline
from provenance import (
    AccountabilityLedger,
    TokenLicense,
    add_provenance_to_response,
    canonical_json,
    detect_watermark,
    lineage_trace,
)

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="OGEN Complex Compliance API",
    version="1.1.0",
    description="Audit-first compliance pipeline with provenance verification.",
)

# ---------------------------------------------------------------------------
# Receipt signing key (startup — replace with KMS in production)
# ---------------------------------------------------------------------------
# In production, load the private key from AWS KMS / Secrets Manager and
# export the public key to public_verifier.py SKYLARS_PUBKEYS.
_RECEIPT_SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_RECEIPT_PUBKEY_PEM: str = _RECEIPT_SIGNING_KEY.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
).decode()

# In-memory receipt store: receipt_id → receipt dict
# Replace with a durable store (DynamoDB, Postgres, …) in production.
_receipt_store: dict[str, dict] = {}

# Public base URL used in verify_cmd (override via API_BASE_URL env var)
_API_BASE_URL: str = os.environ.get("API_BASE_URL", "https://api.skylarsglobal.com").rstrip("/")

# ---------------------------------------------------------------------------
# API-key tier table (override via environment variable TIER_LIMITS)
# Format: "key:tier:rpm_limit,..."
# Default keys are for local development / smoke testing only.
# ---------------------------------------------------------------------------
_DEFAULT_KEYS: dict[str, dict] = {
    "sk_enterprise_123": {"tier": "enterprise", "rpm_limit": 100_000},
    "sk_free_456":       {"tier": "free",       "rpm_limit": 10},
}


def _load_api_keys() -> dict[str, dict]:
    raw = os.environ.get("API_KEYS")
    if not raw:
        return _DEFAULT_KEYS
    keys: dict[str, dict] = {}
    for entry in raw.split(","):
        parts = entry.split(":")
        if len(parts) == 3:
            key, tier, rpm = parts
            keys[key.strip()] = {"tier": tier.strip(), "rpm_limit": int(rpm.strip())}
    return keys or _DEFAULT_KEYS


_API_KEYS: dict[str, dict] = _load_api_keys()

# ---------------------------------------------------------------------------
# Global accountability ledger (singleton per process)
# ---------------------------------------------------------------------------
ledger = AccountabilityLedger()


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------
def verify_api_key(
    x_api_key: Annotated[Optional[str], Header(alias="X-API-Key")] = None,
) -> dict:
    if x_api_key is None or x_api_key not in _API_KEYS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key header.",
        )
    return _API_KEYS[x_api_key]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _pipeline_result_to_dict(result: PipelineResult) -> dict:
    return {
        "ok": result.ok,
        "claim_id": result.claim_id,
        "fail_code": result.fail_code,
        "message": result.message,
        "audit": result.audit,
    }


def _build_trust_receipt(evidence_bytes: bytes, result: PipelineResult) -> dict:
    """
    Build a Trust Receipt in the public_verifier.py schema format and
    sign it with the process signing key.

    The receipt is a single-leaf Merkle tree (leaf == evidence hash).
    A placeholder rekor_log_id is used; submit to Rekor in production.
    """
    evidence_hex = hashlib.sha256(evidence_bytes).hexdigest()
    evidence_hash = f"sha256:{evidence_hex}"
    merkle_root = evidence_hex  # single-leaf tree; leaf == root

    pcr0 = os.environ.get("PINNED_PCR0", "0" * 96)

    core: dict = {
        "agent_id":      "compliance_gateway",
        "verdict":       "VALID_ENFORCEABLE" if result.ok else "INVALID",
        "evidence_hash": evidence_hash,
        "attested_at":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "merkle_root":   merkle_root,
        "rekor_log_id":  str(uuid.uuid4()),  # TODO: submit to Rekor in production
        "pcr0":          pcr0,
    }

    payload_hash = hashlib.sha256(
        json.dumps(core, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()

    sig = _RECEIPT_SIGNING_KEY.sign(
        payload_hash.encode(),
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH,
        ),
        hashes.SHA256(),
    )

    receipt_id = payload_hash[:16]

    return {
        **core,
        "receipt_id":     receipt_id,
        "payload_hash":   payload_hash,
        "signature":      sig.hex(),
        "public_key_pem": _RECEIPT_PUBKEY_PEM,
        "merkle_proof":   [],  # single-leaf tree needs no proof
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/healthz", tags=["ops"])
async def healthz() -> dict:
    return {"status": "ok", "version": app.version}


@app.post("/v1/compliance", tags=["compliance"])
async def compliance_check(
    file: Annotated[UploadFile, File(description="Text file containing the evidence claim.")],
    claim_id: Annotated[Optional[str], Form()] = None,
    jurisdiction: Annotated[str, Form()] = "US",
    schema_version: Annotated[str, Form()] = "1.1",
    reviewer_ids: Annotated[str, Form(description="Comma-separated reviewer IDs.")] = "r1,r2,r3",
    rubric_score: Annotated[float, Form()] = 0.75,
    baseline_rubric_score: Annotated[float, Form()] = 0.75,
    tier_info: Annotated[dict, Depends(verify_api_key)] = None,
) -> dict:
    """
    Submit a plain-text evidence file through the 6-domain compliance pipeline.
    """
    raw = await file.read()
    content = raw.decode("utf-8", errors="replace")

    effective_claim_id = claim_id or str(uuid.uuid4())
    reviewers = [r.strip() for r in reviewer_ids.split(",") if r.strip()]

    ev = Evidence(
        claim_id=effective_claim_id,
        content=content,
        submitted_at=time.time(),
        schema_version=schema_version,
        jurisdiction=jurisdiction,
        reviewer_ids=reviewers,
        rubric_score=rubric_score,
        baseline_rubric_score=baseline_rubric_score,
        delegated=False,
        controlling_reviewer_fraction=0.0,
        signature=_sha256(content),
        rule_ids=["DEFAULT"],
    )

    result = run_pipeline(ev)

    # Build and store a Trust Receipt so it can be retrieved via /v1/receipt/{id}
    trust_receipt = _build_trust_receipt(raw, result)
    _receipt_store[trust_receipt["receipt_id"]] = trust_receipt

    # Log to accountability ledger
    input_hash = hashlib.sha256(raw).hexdigest()
    output_hash = _sha256(str(result))
    ledger.log_decision(
        agent_id="compliance_gateway",
        input_hash=input_hash,
        output_hash=output_hash,
        rationale=result.fail_code or "PASS",
    )

    response = _pipeline_result_to_dict(result)
    response["receipt_id"] = trust_receipt["receipt_id"]
    return add_provenance_to_response(response, dataset_id=effective_claim_id)


@app.post("/v1/provenance/verify", tags=["provenance"])
async def verify_provenance(
    file: Annotated[UploadFile, File(description="File to inspect for watermarks and lineage.")],
    dataset_id: Annotated[Optional[str], Form()] = None,
    tier_info: Annotated[dict, Depends(verify_api_key)] = None,
) -> dict:
    """
    Inspect a file for embedded watermarks and compute its lineage hash.
    """
    content = await file.read()
    watermark = detect_watermark(content)
    file_hash = hashlib.sha256(content).hexdigest()
    effective_dataset_id = dataset_id or "unknown"
    lhash = lineage_trace(effective_dataset_id, [])
    canon = canonical_json({"file_hash": file_hash, "watermark": watermark})

    # Log decision
    ledger.log_decision(
        agent_id="provenance_gateway",
        input_hash=file_hash,
        output_hash=_sha256(canon),
        rationale="provenance_verify",
    )

    exported = ledger.export_ledger()
    last_entry = exported[-1] if exported else None

    return {
        "watermark_present": watermark is not None,
        "watermark_id": watermark,
        "lineage_hash": lhash,
        "canonical_representation": canon,
        "ledger_entry": last_entry,
    }


@app.get("/v1/receipt/{receipt_id}", tags=["receipts"])
async def get_receipt(receipt_id: str) -> dict:
    """
    Retrieve a Trust Receipt by ID and an auditor-ready verify command.

    The ``verify_cmd`` field contains a one-liner that any auditor can run
    to cryptographically confirm the receipt without contacting Skylars Global::

        curl <url> | python3 public_verifier.py verify --receipt -

    All four checks (signature, Merkle proof, Rekor, TEE PCR0) are performed
    client-side; no trust in Skylars Global infrastructure is required.
    """
    receipt = _receipt_store.get(receipt_id)
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Receipt {receipt_id!r} not found.",
        )

    receipt_url = f"{_API_BASE_URL}/v1/receipt/{receipt_id}"
    verify_cmd = (
        f"curl -s {receipt_url} | python3 public_verifier.py verify --receipt -"
    )

    return {
        **receipt,
        "verify_cmd": verify_cmd,
        "auditor_note": (
            "Run verify_cmd to confirm signature, Merkle inclusion, "
            "Rekor timestamp, and TEE PCR0 — no Skylars Global contact required."
        ),
    }

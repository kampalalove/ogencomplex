#!/usr/bin/env python3
"""
gateway.py — OGEN Complex v1.1.0
FastAPI gateway exposing the compliance pipeline and provenance verification.

Endpoints
---------
POST /v1/compliance          Submit a text claim file for pipeline evaluation.
POST /v1/provenance/verify   Inspect a file for watermarks and lineage hashes.
GET  /healthz                Liveness probe.
"""

from __future__ import annotations

import hashlib
import os
import time
import uuid
from typing import Annotated, Optional

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

    last_entry = ledger.export_ledger()[-1] if ledger.entries else None

    return {
        "watermark_present": watermark is not None,
        "watermark_id": watermark,
        "lineage_hash": lhash,
        "canonical_representation": canon,
        "ledger_entry": last_entry,
    }

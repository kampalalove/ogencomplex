"""
app.py — OGEN Complex v1.1.0
6-domain pipeline: Evidence → Fact → Rule → Execution → Governance → Verification
20 security invariants embedded directly in this file. No new modules.
"""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Deterministic FAIL codes (M31–M50)
# ---------------------------------------------------------------------------
FAIL_M31_STALE_EVIDENCE        = "FAIL_M31_STALE_EVIDENCE"
FAIL_M32_PII_LEAK              = "FAIL_M32_PII_LEAK"
FAIL_M33_REPLAY                = "FAIL_M33_REPLAY"
FAIL_M34_JURISDICTION          = "FAIL_M34_JURISDICTION_MISMATCH"
FAIL_M35_QUORUM_DIVERSITY      = "FAIL_M35_QUORUM_DIVERSITY"
FAIL_M36_CLOCK_DRIFT           = "FAIL_M36_CLOCK_DRIFT"
FAIL_M37_CANON                 = "FAIL_M37_CANON_EVIDENCE"
FAIL_M38_RUBRIC_DRIFT          = "FAIL_M38_RUBRIC_DRIFT"
FAIL_M39_DOUBLE_SPEND          = "FAIL_M39_DOUBLE_SPEND"
FAIL_M40_DELEGATION_BAN        = "FAIL_M40_DELEGATION_BAN"
FAIL_M41_SCHEMA                = "FAIL_M41_SCHEMA_INVALID"
FAIL_M42_AMBIGUITY             = "FAIL_M42_AMBIGUITY"
FAIL_M43_ARBITRAGE             = "FAIL_M43_ARBITRAGE"
FAIL_M44_SYBIL                 = "FAIL_M44_SYBIL_REVIEWER"
FAIL_M45_SIGNATURE             = "FAIL_M45_SIGNATURE_INTEGRITY"
FAIL_M46_TIMESTAMP_ATTACK      = "FAIL_M46_TIMESTAMP_ATTACK"
FAIL_M47_VERSIONING            = "FAIL_M47_VERSIONING"
FAIL_M48_RULE_CONFLICT         = "FAIL_M48_RULE_CONFLICT"
FAIL_M49_CREDENTIAL_REDACTION  = "FAIL_M49_CREDENTIAL_REDACTION"
FAIL_M50_CAPTURE               = "FAIL_M50_CAPTURE_PREVENTION"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
EVIDENCE_MAX_AGE_SECONDS   = 300          # 5 min freshness window (M31)
MAX_CLOCK_DRIFT_SECONDS    = 60           # 1 min tolerance (M36, M46)
SUPPORTED_SCHEMA_VERSIONS  = {"1.0", "1.1"}  # (M47)
ALLOWED_JURISDICTIONS      = {"US", "EU", "UK", "CA", "AU"}  # (M34)
MIN_REVIEWER_QUORUM        = 3            # (M35)
MAX_RUBRIC_DELTA           = 0.10         # 10 % drift ceiling (M38)
_PII_PATTERN = re.compile(
    r"(?:\b\d{3}-\d{2}-\d{4}\b"          # SSN
    r"|\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"  # email
    r"|\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b)"        # credit-card
)
_CREDENTIAL_PATTERN = re.compile(
    r"(?i)(?:password|secret|token|api[_\-]?key)\s*[:=]\s*\S+"
)

# ---------------------------------------------------------------------------
# In-memory replay / spend registries (reset per process; swap for Redis/DB)
# ---------------------------------------------------------------------------
_seen_claim_ids: set[str] = set()
_spent_claim_ids: set[str] = set()


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------
@dataclass
class Evidence:
    claim_id: str
    content: str
    submitted_at: float          # Unix timestamp
    schema_version: str
    jurisdiction: str
    reviewer_ids: list[str]
    rubric_score: float          # 0.0–1.0
    baseline_rubric_score: float
    delegated: bool
    controlling_reviewer_fraction: float  # fraction held by single reviewer
    signature: str               # hex digest of content
    rule_ids: list[str]          # active rule identifiers
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineResult:
    ok: bool
    claim_id: str
    fail_code: str | None = None
    message: str = ""
    audit: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _redact_credentials(text: str) -> str:
    return _CREDENTIAL_PATTERN.sub("[REDACTED]", text)


# ---------------------------------------------------------------------------
# Domain 1 — Evidence
# Invariants: M31 (freshness), M32 (PII), M37 (canon), M41 (schema),
#             M45 (signature), M47 (versioning)
# ---------------------------------------------------------------------------
def _domain_evidence(ev: Evidence, now: float) -> PipelineResult | None:
    audit: list[str] = []

    # M41 — schema must be a recognised dict-level structure
    if not ev.claim_id or not ev.content or ev.submitted_at is None:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M41_SCHEMA,
                              message="Required evidence fields missing.",
                              audit=audit)
    audit.append("M41:PASS")

    # M47 — schema version must be supported
    if ev.schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M47_VERSIONING,
                              message=f"Unsupported schema version: {ev.schema_version!r}.",
                              audit=audit)
    audit.append("M47:PASS")

    # M46 — timestamp attack (checked before freshness to prevent M31 masking)
    if ev.submitted_at < 1_000_000_000:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M46_TIMESTAMP_ATTACK,
                              message="Timestamp attack detected: submitted_at predates valid epoch.",
                              audit=audit)
    audit.append("M46:PASS")

    # M31 — evidence freshness (future timestamps are caught later by M36)
    age = now - ev.submitted_at
    if age > EVIDENCE_MAX_AGE_SECONDS:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M31_STALE_EVIDENCE,
                              message=f"Evidence age {age:.1f}s exceeds {EVIDENCE_MAX_AGE_SECONDS}s.",
                              audit=audit)
    audit.append("M31:PASS")

    # M32 — PII must not appear in evidence content
    if _PII_PATTERN.search(ev.content):
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M32_PII_LEAK,
                              message="PII detected in evidence content.",
                              audit=audit)
    audit.append("M32:PASS")

    # M37 — canonical content: reject empty or pure-whitespace submissions
    if not ev.content.strip():
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M37_CANON,
                              message="Evidence content is empty or non-canonical.",
                              audit=audit)
    audit.append("M37:PASS")

    # M45 — signature integrity: sig must match SHA-256 of content
    expected_sig = _sha256(ev.content)
    if ev.signature != expected_sig:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M45_SIGNATURE,
                              message="Evidence signature does not match content hash.",
                              audit=audit)
    audit.append("M45:PASS")

    return None  # all evidence checks passed


# ---------------------------------------------------------------------------
# Domain 2 — Fact
# Invariants: M34 (jurisdiction), M35 (quorum diversity), M44 (anti-sybil)
# ---------------------------------------------------------------------------
def _domain_fact(ev: Evidence) -> PipelineResult | None:
    audit: list[str] = []

    # M34 — jurisdiction must be in allowed set
    if ev.jurisdiction.upper() not in ALLOWED_JURISDICTIONS:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M34_JURISDICTION,
                              message=f"Jurisdiction {ev.jurisdiction!r} not permitted.",
                              audit=audit)
    audit.append("M34:PASS")

    # M35 — reviewer quorum: need at least MIN_REVIEWER_QUORUM distinct reviewers
    if len(set(ev.reviewer_ids)) < MIN_REVIEWER_QUORUM:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M35_QUORUM_DIVERSITY,
                              message=f"Quorum requires {MIN_REVIEWER_QUORUM} distinct reviewers; "
                                      f"got {len(set(ev.reviewer_ids))}.",
                              audit=audit)
    audit.append("M35:PASS")

    # M44 — anti-sybil: no single reviewer may control > 50 % of quorum
    if ev.controlling_reviewer_fraction > 0.5:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M44_SYBIL,
                              message=f"Sybil risk: single reviewer controls "
                                      f"{ev.controlling_reviewer_fraction:.0%} of quorum.",
                              audit=audit)
    audit.append("M44:PASS")

    return None


# ---------------------------------------------------------------------------
# Domain 3 — Rule
# Invariants: M33 (replay), M38 (rubric drift), M42 (ambiguity), M48 (rule conflict)
# ---------------------------------------------------------------------------
def _domain_rule(ev: Evidence) -> PipelineResult | None:
    audit: list[str] = []

    # M33 — replay protection: each claim_id may traverse the pipeline once
    if ev.claim_id in _seen_claim_ids:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M33_REPLAY,
                              message="Replay detected: claim_id already processed.",
                              audit=audit)
    audit.append("M33:PASS")

    # M38 — rubric drift: delta between submitted and baseline must be within ceiling
    delta = abs(ev.rubric_score - ev.baseline_rubric_score)
    if delta > MAX_RUBRIC_DELTA:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M38_RUBRIC_DRIFT,
                              message=f"Rubric drift {delta:.3f} exceeds ceiling {MAX_RUBRIC_DELTA}.",
                              audit=audit)
    audit.append("M38:PASS")

    # M42 — ambiguity: rule_ids list must be non-empty and contain no duplicates
    if not ev.rule_ids or len(ev.rule_ids) != len(set(ev.rule_ids)):
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M42_AMBIGUITY,
                              message="Rule list is empty or contains duplicate rule identifiers.",
                              audit=audit)
    audit.append("M42:PASS")

    # M48 — rule conflict: rule_ids must not contain mutually exclusive pairs
    _exclusive_pairs = [("ALLOW_ALL", "DENY_ALL"), ("OVERRIDE", "LOCK")]
    for a, b in _exclusive_pairs:
        if a in ev.rule_ids and b in ev.rule_ids:
            return PipelineResult(ok=False, claim_id=ev.claim_id,
                                  fail_code=FAIL_M48_RULE_CONFLICT,
                                  message=f"Conflicting rules present: {a!r} and {b!r}.",
                                  audit=audit)
    audit.append("M48:PASS")

    return None


# ---------------------------------------------------------------------------
# Domain 4 — Execution
# Invariants: M39 (double-spend), M43 (ambiguity arbitrage)
# ---------------------------------------------------------------------------
def _domain_execution(ev: Evidence) -> PipelineResult | None:
    audit: list[str] = []

    # M39 — double-spend: claim must not have been committed already
    if ev.claim_id in _spent_claim_ids:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M39_DOUBLE_SPEND,
                              message="Double-spend: claim_id already committed.",
                              audit=audit)
    audit.append("M39:PASS")

    # M43 — arbitrage: rubric score must not sit in the indeterminate band (0.45–0.55)
    #         where scoring systems disagree and exploitation is possible
    if 0.45 < ev.rubric_score < 0.55:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M43_ARBITRAGE,
                              message=f"Ambiguity arbitrage window: rubric score "
                                      f"{ev.rubric_score:.3f} falls in indeterminate band.",
                              audit=audit)
    audit.append("M43:PASS")

    return None


# ---------------------------------------------------------------------------
# Domain 5 — Governance
# Invariants: M40 (delegation ban), M50 (capture prevention)
# ---------------------------------------------------------------------------
def _domain_governance(ev: Evidence) -> PipelineResult | None:
    audit: list[str] = []

    # M40 — delegation ban: review authority may not be delegated
    if ev.delegated:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M40_DELEGATION_BAN,
                              message="Delegated review authority is prohibited.",
                              audit=audit)
    audit.append("M40:PASS")

    # M50 — capture prevention: no single reviewer controls more than 33 % of quorum
    if ev.controlling_reviewer_fraction > 0.33:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M50_CAPTURE,
                              message=f"Capture risk: single reviewer controls "
                                      f"{ev.controlling_reviewer_fraction:.0%} of quorum "
                                      f"(governance ceiling is 33%).",
                              audit=audit)
    audit.append("M50:PASS")

    return None


# ---------------------------------------------------------------------------
# Domain 6 — Verification
# Invariants: M36 (clock drift veto), M46 (timestamp attack), M49 (credential redaction)
# ---------------------------------------------------------------------------
def _domain_verification(ev: Evidence, now: float) -> PipelineResult | None:
    audit: list[str] = []

    # M36 — clock drift veto: submitted_at must not be in the future
    drift = ev.submitted_at - now
    if drift > MAX_CLOCK_DRIFT_SECONDS:
        return PipelineResult(ok=False, claim_id=ev.claim_id,
                              fail_code=FAIL_M36_CLOCK_DRIFT,
                              message=f"Clock drift {drift:.1f}s exceeds veto threshold.",
                              audit=audit)
    audit.append("M36:PASS")

    # M49 — credential redaction: extra fields must not contain plaintext credentials
    for key, val in ev.extra.items():
        if _CREDENTIAL_PATTERN.search(f"{key}={val}"):
            return PipelineResult(ok=False, claim_id=ev.claim_id,
                                  fail_code=FAIL_M49_CREDENTIAL_REDACTION,
                                  message=f"Unredacted credential detected in extra field {key!r}.",
                                  audit=audit)
    audit.append("M49:PASS")

    return None


# ---------------------------------------------------------------------------
# Public API — run_pipeline
# ---------------------------------------------------------------------------
def run_pipeline(ev: Evidence, *, now: float | None = None) -> PipelineResult:
    """
    Run the 6-domain pipeline for a single Evidence object.

    Returns a PipelineResult with ok=True on success, or ok=False with the
    first FAIL_* code encountered. Successful traversal registers the
    claim_id to prevent replay and double-spend in subsequent calls.
    """
    if now is None:
        now = time.time()

    for check in (
        _domain_evidence(ev, now),
        _domain_fact(ev),
        _domain_rule(ev),
        _domain_execution(ev),
        _domain_governance(ev),
        _domain_verification(ev, now),
    ):
        if check is not None:
            return check

    # All domains passed — commit the claim
    _seen_claim_ids.add(ev.claim_id)
    _spent_claim_ids.add(ev.claim_id)

    return PipelineResult(
        ok=True,
        claim_id=ev.claim_id,
        message="Pipeline traversal complete.",
        audit=[
            "M31:PASS", "M32:PASS", "M33:PASS", "M34:PASS", "M35:PASS",
            "M36:PASS", "M37:PASS", "M38:PASS", "M39:PASS", "M40:PASS",
            "M41:PASS", "M42:PASS", "M43:PASS", "M44:PASS", "M45:PASS",
            "M46:PASS", "M47:PASS", "M48:PASS", "M49:PASS", "M50:PASS",
        ],
    )

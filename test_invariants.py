#!/usr/bin/env python3
"""
test_invariants.py — OGEN Complex v1.1.0
pytest suite for all 20 pipeline security invariants (M31–M50)
and the 5 Provenance majors (16–20).

Run:
    pytest test_invariants.py -v
"""

from __future__ import annotations

import time
import uuid

import pytest

# ---------------------------------------------------------------------------
# Imports under test
# ---------------------------------------------------------------------------
from app import (
    EVIDENCE_MAX_AGE_SECONDS,
    Evidence,
    PipelineResult,
    _sha256,
    _seen_claim_ids,
    _spent_claim_ids,
    run_pipeline,
)
from attestation import CapabilityAttestation
from deterministic_engine import DeterministicStateMachine
from provenance import (
    AccountabilityLedger,
    TokenLicense,
    canonical_json,
    detect_watermark,
    lineage_trace,
    watermark_content,
)
from rule_engine import RuleBoundEngine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RULES_PATH = "rules/rule_bound_reasoning_v1.0.0.json"

_NEXT_ID = 0


def _uid() -> str:
    """Return a fresh unique claim_id for each test."""
    global _NEXT_ID
    _NEXT_ID += 1
    return f"claim-{_NEXT_ID}-{uuid.uuid4().hex[:6]}"


def _good(**overrides) -> Evidence:
    """Return a fully valid Evidence object, with optional overrides."""
    cid = overrides.pop("claim_id", _uid())
    content = overrides.pop("content", "Candidate demonstrated proficiency.")
    return Evidence(
        claim_id=cid,
        content=content,
        submitted_at=overrides.pop("submitted_at", time.time()),
        schema_version=overrides.pop("schema_version", "1.1"),
        jurisdiction=overrides.pop("jurisdiction", "US"),
        reviewer_ids=overrides.pop("reviewer_ids", ["alice", "bob", "carol"]),
        rubric_score=overrides.pop("rubric_score", 0.75),
        baseline_rubric_score=overrides.pop("baseline_rubric_score", 0.75),
        delegated=overrides.pop("delegated", False),
        controlling_reviewer_fraction=overrides.pop("controlling_reviewer_fraction", 0.10),
        signature=overrides.pop("signature", _sha256(content)),
        rule_ids=overrides.pop("rule_ids", ["DEFAULT"]),
        extra=overrides.pop("extra", {}),
        **overrides,
    )


def _run(ev: Evidence) -> PipelineResult:
    return run_pipeline(ev, now=time.time())


def _assert_fail(ev: Evidence, expected_code: str) -> None:
    r = _run(ev)
    assert not r.ok, f"Expected FAIL {expected_code!r} but got PASS"
    assert r.fail_code == expected_code, f"Expected {expected_code!r}, got {r.fail_code!r}"


# ===========================================================================
# Pipeline invariants — M31–M50
# ===========================================================================

def test_m31_stale_evidence():
    """M31 — evidence older than 5 min is rejected."""
    ev = _good(submitted_at=time.time() - EVIDENCE_MAX_AGE_SECONDS - 1)
    _assert_fail(ev, "FAIL_M31_STALE_EVIDENCE")


def test_m32_pii_ssn():
    """M32 — SSN in content triggers PII rejection."""
    content = "SSN is 123-45-6789"
    ev = _good(content=content, signature=_sha256(content))
    _assert_fail(ev, "FAIL_M32_PII_LEAK")


def test_m32_pii_email():
    """M32 — email in content triggers PII rejection."""
    content = "Contact user@example.com for details"
    ev = _good(content=content, signature=_sha256(content))
    _assert_fail(ev, "FAIL_M32_PII_LEAK")


def test_m33_replay():
    """M33 — second submission of the same claim_id is rejected."""
    ev = _good()
    r1 = _run(ev)
    assert r1.ok
    r2 = _run(_good(claim_id=ev.claim_id, content=ev.content, signature=ev.signature))
    assert not r2.ok
    assert r2.fail_code in ("FAIL_M33_REPLAY", "FAIL_M39_DOUBLE_SPEND")


def test_m34_jurisdiction_mismatch():
    """M34 — unrecognised jurisdiction is rejected."""
    ev = _good(jurisdiction="XX")
    _assert_fail(ev, "FAIL_M34_JURISDICTION_MISMATCH")


def test_m35_quorum_diversity():
    """M35 — fewer than 3 distinct reviewers is rejected."""
    ev = _good(reviewer_ids=["alice", "alice", "alice"])
    _assert_fail(ev, "FAIL_M35_QUORUM_DIVERSITY")


def test_m36_clock_drift():
    """M36 — future timestamp beyond drift ceiling is rejected."""
    ev = _good(submitted_at=time.time() + 120)
    _assert_fail(ev, "FAIL_M36_CLOCK_DRIFT")


def test_m37_canon_empty_content():
    """M37 — whitespace-only content is rejected."""
    content = "   \n\t  "
    ev = _good(content=content, signature=_sha256(content))
    _assert_fail(ev, "FAIL_M37_CANON_EVIDENCE")


def test_m38_rubric_drift():
    """M38 — rubric score delta > 10 % is rejected."""
    ev = _good(rubric_score=0.90, baseline_rubric_score=0.70)
    _assert_fail(ev, "FAIL_M38_RUBRIC_DRIFT")


def test_m39_double_spend():
    """M39 — committing the same claim twice is rejected."""
    ev = _good()
    r1 = _run(ev)
    assert r1.ok
    r2 = run_pipeline(ev, now=time.time())
    assert not r2.ok
    assert r2.fail_code in ("FAIL_M33_REPLAY", "FAIL_M39_DOUBLE_SPEND")


def test_m40_delegation_ban():
    """M40 — delegated submissions are rejected."""
    ev = _good(delegated=True)
    _assert_fail(ev, "FAIL_M40_DELEGATION_BAN")


def test_m41_schema_empty_claim_id():
    """M41 — empty claim_id is rejected."""
    content = "Valid content."
    ev = Evidence(
        claim_id="",
        content=content,
        submitted_at=time.time(),
        schema_version="1.1",
        jurisdiction="US",
        reviewer_ids=["a", "b", "c"],
        rubric_score=0.75,
        baseline_rubric_score=0.75,
        delegated=False,
        controlling_reviewer_fraction=0.1,
        signature=_sha256(content),
        rule_ids=["DEFAULT"],
    )
    _assert_fail(ev, "FAIL_M41_SCHEMA_INVALID")


def test_m42_ambiguity_empty_rule_ids():
    """M42 — empty rule_ids list is rejected."""
    ev = _good(rule_ids=[])
    _assert_fail(ev, "FAIL_M42_AMBIGUITY")


def test_m43_arbitrage_indeterminate_band():
    """M43 — rubric score in (0.45, 0.55) is rejected."""
    ev = _good(rubric_score=0.50, baseline_rubric_score=0.50)
    _assert_fail(ev, "FAIL_M43_ARBITRAGE")


def test_m44_sybil():
    """M44 — single reviewer controlling > 50 % is rejected."""
    ev = _good(controlling_reviewer_fraction=0.60)
    _assert_fail(ev, "FAIL_M44_SYBIL_REVIEWER")


def test_m45_signature_integrity():
    """M45 — signature mismatch is rejected."""
    ev = _good(signature="deadbeef")
    _assert_fail(ev, "FAIL_M45_SIGNATURE_INTEGRITY")


def test_m46_timestamp_attack():
    """M46 — submitted_at below valid epoch is rejected."""
    ev = _good(submitted_at=999_999_999)
    _assert_fail(ev, "FAIL_M46_TIMESTAMP_ATTACK")


def test_m47_versioning():
    """M47 — unsupported schema version is rejected."""
    ev = _good(schema_version="9.9")
    _assert_fail(ev, "FAIL_M47_VERSIONING")


def test_m48_rule_conflict():
    """M48 — mutually exclusive rules are rejected."""
    ev = _good(rule_ids=["ALLOW_ALL", "DENY_ALL"])
    _assert_fail(ev, "FAIL_M48_RULE_CONFLICT")


def test_m49_credential_redaction():
    """M49 — plaintext credential in extra is rejected."""
    content = "Normal content."
    ev = _good(
        content=content,
        signature=_sha256(content),
        extra={"api_key": "supersecret123"},
    )
    _assert_fail(ev, "FAIL_M49_CREDENTIAL_REDACTION")


def test_m50_capture_prevention():
    """M50 — single reviewer controlling > 33 % is rejected at governance stage."""
    ev = _good(controlling_reviewer_fraction=0.40)
    _assert_fail(ev, "FAIL_M50_CAPTURE_PREVENTION")


def test_pipeline_pass():
    """Happy path — all domains pass, claim is committed."""
    ev = _good()
    r = _run(ev)
    assert r.ok
    assert r.fail_code is None
    assert len(r.audit) == 20


# ===========================================================================
# Major 1 — DeterministicStateMachine (deterministic_engine.py)
# ===========================================================================

def test_major1_dag_rejects_cycle():
    """Major 1 — cyclic DAG raises ValueError."""
    with pytest.raises(ValueError, match="[Cc]ycle"):
        DeterministicStateMachine({"INIT": ["VALIDATE"], "VALIDATE": ["INIT"]})


def test_major1_dag_rejects_missing_init():
    """Major 1 — DAG without INIT raises ValueError."""
    with pytest.raises(ValueError, match="INIT"):
        DeterministicStateMachine({"A": ["B"], "B": []})


def test_major1_happy_path():
    """Major 1 — legal DAG traversal returns PASS verdicts."""
    dag = {
        "INIT":     ["VALIDATE"],
        "VALIDATE": ["EXECUTE"],
        "EXECUTE":  ["HALT"],
        "HALT":     [],
    }
    facts = {
        "parsed_clauses": {"has_liability_cap": False},
    }
    m = DeterministicStateMachine(dag)
    assert m.transition("VALIDATE", facts) == "PASS"
    assert m.transition("EXECUTE",  facts) == "PASS"
    assert m.transition("HALT",     facts) == "PASS"
    assert not m.is_halted()


def test_major1_illegal_transition_hard_halts():
    """Major 1 — illegal transition triggers HARD_HALT and locks the machine."""
    dag = {"INIT": ["VALIDATE"], "VALIDATE": [], "HALT": []}
    m = DeterministicStateMachine(dag)
    verdict = m.transition("HALT", {})   # not allowed from INIT
    assert verdict == "HARD_HALT"
    assert m.is_halted()
    assert m.get_current_state() == "HALT"


def test_major1_proof_chain():
    """Major 1 — proof chain captures all transitions."""
    dag = {"INIT": ["A"], "A": ["HALT"], "HALT": []}
    m = DeterministicStateMachine(dag)
    m.transition("A", {})
    m.transition("HALT", {})
    chain = m.get_proof_chain()
    assert len(chain) == 2
    assert chain[0]["from"] == "INIT" and chain[0]["to"] == "A"
    assert chain[1]["from"] == "A"    and chain[1]["to"] == "HALT"
    for step in chain:
        assert len(step["hash"]) == 64  # SHA-256 hex


# ===========================================================================
# Major 2 — RuleBoundEngine (rule_engine.py)
# ===========================================================================

def test_major2_rule_pass():
    """Major 2 — facts satisfying all rules return PASS."""
    engine = RuleBoundEngine(RULES_PATH)
    facts = {
        "input_metadata": {"origin_country": "EU_MEMBER", "cross_border": True},
        "parsed_clauses":  {"statutory_hash_present": True, "has_liability_cap": True,
                            "liability_limit_usd": 2_000_000},
    }
    assert engine.evaluate(facts) == "PASS"


def test_major2_r001_statutory_hash_missing():
    """Major 2 — EU cross-border without statutory hash → FAIL_R001."""
    engine = RuleBoundEngine(RULES_PATH)
    facts = {
        "input_metadata": {"origin_country": "EU_MEMBER", "cross_border": True},
        "parsed_clauses":  {"statutory_hash_present": False, "has_liability_cap": False},
    }
    assert engine.evaluate(facts) == "FAIL_R001_STATUTORY_HASH_MISSING"


def test_major2_r002_liability_cap_too_low():
    """Major 2 — liability cap below floor → FAIL_R002."""
    engine = RuleBoundEngine(RULES_PATH)
    facts = {
        "input_metadata": {"origin_country": "US", "cross_border": False},
        "parsed_clauses":  {"has_liability_cap": True, "liability_limit_usd": 500_000},
    }
    assert engine.evaluate(facts) == "FAIL_R002_LIABILITY_CAP_TOO_LOW"


# ===========================================================================
# Major 4 — CapabilityAttestation (attestation.py)
# ===========================================================================

def test_major4_sign_and_verify():
    """Major 4 — attest_chain + verify_bundle round-trip passes."""
    sk = CapabilityAttestation.generate_key()
    attester = CapabilityAttestation("test_agent", sk)
    chain = [{"from": "INIT", "to": "HALT", "hash": "abc123"}]
    bundle = attester.attest_chain(chain)
    assert attester.verify_bundle(bundle)


def test_major4_tampered_chain_fails():
    """Major 4 — tampered proof chain fails verification."""
    sk = CapabilityAttestation.generate_key()
    attester = CapabilityAttestation("test_agent", sk)
    chain = [{"from": "INIT", "to": "HALT", "hash": "abc123"}]
    bundle = attester.attest_chain(chain)
    bundle["steps"][0]["hash"] = "tampered"
    assert not attester.verify_bundle(bundle)


# ===========================================================================
# Major 16 — lineage_trace (provenance.py)
# ===========================================================================

def test_major16_lineage_format():
    """Major 16 — lineage_trace returns a sha256:-prefixed 64-hex-char digest."""
    h = lineage_trace("dataset_01", [{"step": "ingest"}])
    assert h.startswith("sha256:")
    assert len(h) == len("sha256:") + 64


def test_major16_lineage_different_inputs_differ():
    """Major 16 — different dataset_ids produce different hashes."""
    h1 = lineage_trace("ds_alpha", [])
    h2 = lineage_trace("ds_beta",  [])
    assert h1 != h2


# ===========================================================================
# Major 17 — TokenLicense (provenance.py)
# ===========================================================================

def test_major17_mint_and_verify():
    """Major 17 — minted token verifies correctly."""
    lic = TokenLicense("creator1", 0.05)
    tok = lic.mint_license_token("output_hash_xyz")
    assert lic.verify_license_token("output_hash_xyz", tok)


def test_major17_wrong_output_hash_fails():
    """Major 17 — token for one output_hash does not verify another."""
    lic = TokenLicense("creator1", 0.05)
    tok = lic.mint_license_token("hash_A")
    assert not lic.verify_license_token("hash_B", tok)


def test_major17_invalid_royalty_rate():
    """Major 17 — royalty_rate outside [0,1] raises ValueError."""
    with pytest.raises(ValueError):
        TokenLicense("creator1", 1.5)


def test_major17_token_prefix():
    """Major 17 — minted token starts with 'license_v1:'."""
    lic = TokenLicense("c", 0.0)
    assert lic.mint_license_token("h").startswith("license_v1:")


# ===========================================================================
# Major 18 — watermark_content / detect_watermark (provenance.py)
# ===========================================================================

def test_major18_watermark_round_trip():
    """Major 18 — embedded watermark is detected and ID is exact."""
    content = b"Hello, world."
    watermarked = watermark_content(content, "WM-42")
    assert detect_watermark(watermarked) == "WM-42"


def test_major18_detect_returns_none_when_absent():
    """Major 18 — content without watermark returns None."""
    assert detect_watermark(b"No watermark here.") is None


def test_major18_original_content_preserved():
    """Major 18 — original bytes are present at the start of watermarked content."""
    original = b"Original data."
    watermarked = watermark_content(original, "ID-1")
    assert watermarked.startswith(original)


# ===========================================================================
# Major 19 — AccountabilityLedger (provenance.py)
# ===========================================================================

def test_major19_log_and_export():
    """Major 19 — log_decision appends; export_ledger returns all entries."""
    ledger = AccountabilityLedger()
    ledger.log_decision("agent1", "in1", "out1", "reason1")
    ledger.log_decision("agent2", "in2", "out2", "reason2")
    entries = ledger.export_ledger()
    assert len(entries) == 2
    assert entries[0]["agent_id"] == "agent1"
    assert entries[1]["agent_id"] == "agent2"


def test_major19_export_is_copy():
    """Major 19 — mutating the exported list does not corrupt the ledger."""
    ledger = AccountabilityLedger()
    ledger.log_decision("a", "i", "o", "r")
    exported = ledger.export_ledger()
    exported.clear()
    assert len(ledger.export_ledger()) == 1


def test_major19_entry_has_timestamp():
    """Major 19 — each logged entry carries an ISO-format timestamp."""
    ledger = AccountabilityLedger()
    entry = ledger.log_decision("a", "i", "o", "r")
    assert "timestamp" in entry
    assert "T" in entry["timestamp"]


# ===========================================================================
# Major 20 — canonical_json (provenance.py)
# ===========================================================================

def test_major20_sorted_keys():
    """Major 20 — output keys are always sorted regardless of insertion order."""
    result = canonical_json({"z": 3, "a": 1, "m": 2})
    assert result == '{"a":1,"m":2,"z":3}'


def test_major20_no_whitespace():
    """Major 20 — canonical output contains no extra whitespace."""
    result = canonical_json({"key": "value"})
    assert " " not in result


def test_major20_idempotent():
    """Major 20 — repeated calls with the same input produce identical output."""
    obj = {"b": [1, 2], "a": {"x": True}}
    assert canonical_json(obj) == canonical_json(obj)

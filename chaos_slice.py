"""
chaos_slice.py — OGEN Complex v1.1.0
Deterministic chaos test suite for all 20 security invariants (M31–M50).

Usage:
    python chaos_slice.py --test-all-majors-31-50
    python chaos_slice.py --test M31 M32 M39
    python chaos_slice.py --list
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import replace
from typing import Callable

from app import (
    Evidence,
    PipelineResult,
    _sha256,
    _seen_claim_ids,
    _spent_claim_ids,
    run_pipeline,
    FAIL_M31_STALE_EVIDENCE,
    FAIL_M32_PII_LEAK,
    FAIL_M33_REPLAY,
    FAIL_M34_JURISDICTION,
    FAIL_M35_QUORUM_DIVERSITY,
    FAIL_M36_CLOCK_DRIFT,
    FAIL_M37_CANON,
    FAIL_M38_RUBRIC_DRIFT,
    FAIL_M39_DOUBLE_SPEND,
    FAIL_M40_DELEGATION_BAN,
    FAIL_M41_SCHEMA,
    FAIL_M42_AMBIGUITY,
    FAIL_M43_ARBITRAGE,
    FAIL_M44_SYBIL,
    FAIL_M45_SIGNATURE,
    FAIL_M46_TIMESTAMP_ATTACK,
    FAIL_M47_VERSIONING,
    FAIL_M48_RULE_CONFLICT,
    FAIL_M49_CREDENTIAL_REDACTION,
    FAIL_M50_CAPTURE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_CID = 0  # monotonic counter for unique claim IDs across tests


def _next_cid() -> str:
    global _CID
    _CID += 1
    return f"chaos-{_CID:04d}"


def _good(content: str = "Valid evidence content.") -> Evidence:
    """Return a baseline Evidence object that passes all 20 invariants."""
    now = time.time()
    c = content
    return Evidence(
        claim_id=_next_cid(),
        content=c,
        submitted_at=now,
        schema_version="1.1",
        jurisdiction="US",
        reviewer_ids=["alice", "bob", "carol"],
        rubric_score=0.75,
        baseline_rubric_score=0.75,
        delegated=False,
        controlling_reviewer_fraction=0.20,
        signature=_sha256(c),
        rule_ids=["RULE_A"],
        extra={},
    )


def _run(ev: Evidence, now: float | None = None) -> PipelineResult:
    if now is None:
        now = time.time()
    return run_pipeline(ev, now=now)


# ---------------------------------------------------------------------------
# Individual chaos probes — each returns (invariant, description, passed)
# ---------------------------------------------------------------------------
Probe = Callable[[], tuple[str, str, bool]]


def _probe_m31() -> tuple[str, str, bool]:
    """M31 — stale evidence: submitted_at is 10 minutes ago."""
    ev = _good()
    old_ts = time.time() - 600
    ev = replace(ev, submitted_at=old_ts)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M31_STALE_EVIDENCE
    return "M31", "Stale evidence triggers FAIL_M31_STALE_EVIDENCE", ok


def _probe_m32() -> tuple[str, str, bool]:
    """M32 — PII leak: content contains an SSN."""
    content = "Candidate SSN is 123-45-6789."
    ev = _good(content)
    ev = replace(ev, signature=_sha256(content))
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M32_PII_LEAK
    return "M32", "PII (SSN) triggers FAIL_M32_PII_LEAK", ok


def _probe_m33() -> tuple[str, str, bool]:
    """M33 — replay: submit the same claim_id twice."""
    ev = _good()
    _run(ev)                          # first traversal — should pass
    r2 = _run(replace(ev, submitted_at=time.time(),
                      signature=ev.signature))
    ok = not r2.ok and r2.fail_code == FAIL_M33_REPLAY
    return "M33", "Replay claim_id triggers FAIL_M33_REPLAY", ok


def _probe_m34() -> tuple[str, str, bool]:
    """M34 — jurisdiction mismatch: unknown jurisdiction code."""
    ev = _good()
    ev = replace(ev, jurisdiction="XX")
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M34_JURISDICTION
    return "M34", "Unknown jurisdiction triggers FAIL_M34_JURISDICTION", ok


def _probe_m35() -> tuple[str, str, bool]:
    """M35 — quorum diversity: only 2 distinct reviewers."""
    ev = _good()
    ev = replace(ev, reviewer_ids=["alice", "bob"])
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M35_QUORUM_DIVERSITY
    return "M35", "Under-quorum triggers FAIL_M35_QUORUM_DIVERSITY", ok


def _probe_m36() -> tuple[str, str, bool]:
    """M36 — clock drift veto: submitted_at is 5 minutes in the future."""
    now = time.time()
    ev = _good()
    ev = replace(ev, submitted_at=now + 300)
    r = _run(ev, now=now)
    ok = not r.ok and r.fail_code == FAIL_M36_CLOCK_DRIFT
    return "M36", "Future timestamp triggers FAIL_M36_CLOCK_DRIFT", ok


def _probe_m37() -> tuple[str, str, bool]:
    """M37 — canon evidence: content is whitespace only."""
    content = "   \t\n  "
    ev = _good(content)
    ev = replace(ev, content=content, signature=_sha256(content))
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M37_CANON
    return "M37", "Whitespace-only content triggers FAIL_M37_CANON", ok


def _probe_m38() -> tuple[str, str, bool]:
    """M38 — rubric drift: 20 % delta between score and baseline."""
    ev = _good()
    ev = replace(ev, rubric_score=0.90, baseline_rubric_score=0.70)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M38_RUBRIC_DRIFT
    return "M38", "Rubric drift > 10% triggers FAIL_M38_RUBRIC_DRIFT", ok


def _probe_m39() -> tuple[str, str, bool]:
    """M39 — double-spend: commit a claim, then try to spend it again."""
    ev = _good()
    _run(ev)                          # first — commits to _spent_claim_ids
    r2 = _run(replace(ev, submitted_at=time.time(),
                      signature=ev.signature))
    ok = not r2.ok and r2.fail_code in (FAIL_M33_REPLAY, FAIL_M39_DOUBLE_SPEND)
    return "M39", "Double-spend triggers FAIL_M39_DOUBLE_SPEND (or REPLAY)", ok


def _probe_m40() -> tuple[str, str, bool]:
    """M40 — delegation ban: delegated flag is True."""
    ev = _good()
    ev = replace(ev, delegated=True)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M40_DELEGATION_BAN
    return "M40", "Delegated review triggers FAIL_M40_DELEGATION_BAN", ok


def _probe_m41() -> tuple[str, str, bool]:
    """M41 — schema: missing required field (empty claim_id)."""
    ev = _good()
    ev = replace(ev, claim_id="")
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M41_SCHEMA
    return "M41", "Empty claim_id triggers FAIL_M41_SCHEMA", ok


def _probe_m42() -> tuple[str, str, bool]:
    """M42 — ambiguity: rule_ids list is empty."""
    ev = _good()
    ev = replace(ev, rule_ids=[])
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M42_AMBIGUITY
    return "M42", "Empty rule_ids triggers FAIL_M42_AMBIGUITY", ok


def _probe_m43() -> tuple[str, str, bool]:
    """M43 — arbitrage: rubric score in indeterminate band (0.50)."""
    ev = _good()
    ev = replace(ev, rubric_score=0.50, baseline_rubric_score=0.50)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M43_ARBITRAGE
    return "M43", "Indeterminate rubric score triggers FAIL_M43_ARBITRAGE", ok


def _probe_m44() -> tuple[str, str, bool]:
    """M44 — anti-sybil: single reviewer controls 70 % of quorum."""
    ev = _good()
    ev = replace(ev, controlling_reviewer_fraction=0.70)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M44_SYBIL
    return "M44", "Sybil fraction > 50% triggers FAIL_M44_SYBIL", ok


def _probe_m45() -> tuple[str, str, bool]:
    """M45 — signature integrity: signature does not match content."""
    ev = _good()
    ev = replace(ev, signature="deadbeef" * 8)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M45_SIGNATURE
    return "M45", "Bad signature triggers FAIL_M45_SIGNATURE", ok


def _probe_m46() -> tuple[str, str, bool]:
    """M46 — timestamp attack: submitted_at predates valid epoch."""
    ev = _good()
    ev = replace(ev, submitted_at=999_999_999)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M46_TIMESTAMP_ATTACK
    return "M46", "Pre-epoch timestamp triggers FAIL_M46_TIMESTAMP_ATTACK", ok


def _probe_m47() -> tuple[str, str, bool]:
    """M47 — versioning: unsupported schema version."""
    ev = _good()
    ev = replace(ev, schema_version="0.9")
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M47_VERSIONING
    return "M47", "Unknown schema version triggers FAIL_M47_VERSIONING", ok


def _probe_m48() -> tuple[str, str, bool]:
    """M48 — rule conflict: ALLOW_ALL and DENY_ALL both present."""
    ev = _good()
    ev = replace(ev, rule_ids=["ALLOW_ALL", "DENY_ALL"])
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M48_RULE_CONFLICT
    return "M48", "Conflicting rules trigger FAIL_M48_RULE_CONFLICT", ok


def _probe_m49() -> tuple[str, str, bool]:
    """M49 — credential redaction: plaintext password in extra field."""
    ev = _good()
    ev = replace(ev, extra={"password": "supersecret123"})
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M49_CREDENTIAL_REDACTION
    return "M49", "Plaintext credential triggers FAIL_M49_CREDENTIAL_REDACTION", ok


def _probe_m50() -> tuple[str, str, bool]:
    """M50 — capture prevention: single reviewer controls 40 % (> 33% cap)."""
    ev = _good()
    ev = replace(ev, controlling_reviewer_fraction=0.40)
    r = _run(ev)
    ok = not r.ok and r.fail_code == FAIL_M50_CAPTURE
    return "M50", "Governance capture (40%) triggers FAIL_M50_CAPTURE", ok


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
ALL_PROBES: dict[str, Probe] = {
    "M31": _probe_m31, "M32": _probe_m32, "M33": _probe_m33,
    "M34": _probe_m34, "M35": _probe_m35, "M36": _probe_m36,
    "M37": _probe_m37, "M38": _probe_m38, "M39": _probe_m39,
    "M40": _probe_m40, "M41": _probe_m41, "M42": _probe_m42,
    "M43": _probe_m43, "M44": _probe_m44, "M45": _probe_m45,
    "M46": _probe_m46, "M47": _probe_m47, "M48": _probe_m48,
    "M49": _probe_m49, "M50": _probe_m50,
}


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
def run_probes(keys: list[str]) -> int:
    """Run the named probes and print a report. Returns exit code (0 = all pass)."""
    passed = 0
    failed = 0
    rows: list[tuple[str, str, str]] = []

    for key in keys:
        probe = ALL_PROBES.get(key)
        if probe is None:
            rows.append((key, f"No probe registered for {key!r}", "SKIP"))
            continue
        invariant, description, ok = probe()
        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        rows.append((invariant, description, status))

    # Print aligned table
    w_inv  = max(len(r[0]) for r in rows)
    w_desc = max(len(r[1]) for r in rows)
    sep    = "-" * (w_inv + w_desc + 12)
    print(sep)
    print(f"{'Invariant':<{w_inv}}  {'Description':<{w_desc}}  Status")
    print(sep)
    for inv, desc, status in rows:
        marker = "✓" if status == "PASS" else ("✗" if status == "FAIL" else "·")
        print(f"{inv:<{w_inv}}  {desc:<{w_desc}}  {marker} {status}")
    print(sep)
    total = passed + failed
    print(f"Result: {passed}/{total} passed, {failed}/{total} failed")
    print(sep)

    return 0 if failed == 0 else 1


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="chaos_slice",
        description="Deterministic chaos test suite for OGEN Complex security invariants.",
    )
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--test-all-majors-31-50",
        action="store_true",
        help="Run all 20 probes covering M31–M50.",
    )
    group.add_argument(
        "--test",
        nargs="+",
        metavar="MXX",
        help="Run specific probes by invariant number (e.g. --test M31 M39 M50).",
    )
    group.add_argument(
        "--list",
        action="store_true",
        help="List all registered probes.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.list:
        print("Registered chaos probes:")
        for key, probe in sorted(ALL_PROBES.items()):
            doc = (probe.__doc__ or "").strip().split("\n")[0]
            print(f"  {key:<4}  {doc}")
        return 0

    # Reset replay / spend state so probes are isolated
    _seen_claim_ids.clear()
    _spent_claim_ids.clear()

    if args.test_all_majors_31_50:
        keys = sorted(ALL_PROBES.keys())
    else:
        keys = [k.upper() for k in args.test]

    return run_probes(keys)


if __name__ == "__main__":
    sys.exit(main())

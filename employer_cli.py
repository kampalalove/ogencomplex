"""
employer_cli.py — OGEN Complex v1.1.0
Employer-facing command-line interface for submitting claims through the
6-domain security pipeline.

Usage:
    python employer_cli.py --claim-id <id> --content <text> [options]
    python employer_cli.py --help
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time

from app import Evidence, PipelineResult, run_pipeline, _sha256


# ---------------------------------------------------------------------------
# CLI argument parser
# ---------------------------------------------------------------------------
def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="employer_cli",
        description="Submit a claim through the OGEN Complex security pipeline.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Minimal valid submission
  python employer_cli.py \\
      --claim-id abc123 \\
      --content "Candidate demonstrated proficiency in Python." \\
      --jurisdiction US \\
      --reviewers alice bob carol

  # Full submission with extra metadata
  python employer_cli.py \\
      --claim-id xyz789 \\
      --content "Assessment complete." \\
      --jurisdiction EU \\
      --reviewers alice bob carol dave \\
      --rubric-score 0.82 \\
      --baseline-rubric-score 0.80 \\
      --rule-ids RULE_A RULE_B \\
      --schema-version 1.1 \\
      --json
""",
    )

    p.add_argument("--claim-id",            required=True,  help="Unique claim identifier.")
    p.add_argument("--content",             required=True,  help="Evidence content text.")
    p.add_argument("--jurisdiction",        required=True,  help="ISO jurisdiction code (US, EU, UK, CA, AU).")
    p.add_argument("--reviewers",           required=True,  nargs="+", metavar="REVIEWER_ID",
                   help="Space-separated list of reviewer identifiers (minimum 3).")

    p.add_argument("--schema-version",      default="1.1",  help="Schema version (default: 1.1).")
    p.add_argument("--rubric-score",        type=float,     default=0.75,
                   help="Rubric score 0.0–1.0 (default: 0.75).")
    p.add_argument("--baseline-rubric-score", type=float,   default=0.75,
                   help="Baseline rubric score for drift comparison (default: 0.75).")
    p.add_argument("--rule-ids",            nargs="*",      default=["DEFAULT"],
                   metavar="RULE_ID",       help="Active rule identifiers (default: DEFAULT).")
    p.add_argument("--delegated",           action="store_true",
                   help="Flag submission as delegated (will trigger M40 FAIL).")
    p.add_argument("--controlling-fraction", type=float,    default=0.0,
                   help="Fraction of quorum controlled by a single reviewer (default: 0.0).")
    p.add_argument("--submitted-at",        type=float,     default=None,
                   help="Override submission timestamp (Unix seconds). Defaults to now.")
    p.add_argument("--extra",               type=json.loads, default=None,
                   metavar="JSON",          help="Extra metadata as a JSON object string.")
    p.add_argument("--json",                action="store_true", dest="output_json",
                   help="Output result as JSON.")

    return p


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------
def _format_result(result: PipelineResult, output_json: bool) -> str:
    if output_json:
        return json.dumps(
            {
                "ok": result.ok,
                "claim_id": result.claim_id,
                "fail_code": result.fail_code,
                "message": result.message,
                "audit": result.audit,
            },
            indent=2,
        )

    lines: list[str] = []
    status = "✓ PASS" if result.ok else f"✗ FAIL  [{result.fail_code}]"
    lines.append(f"claim_id : {result.claim_id}")
    lines.append(f"status   : {status}")
    lines.append(f"message  : {result.message}")
    if result.audit:
        lines.append(f"audit    : {', '.join(result.audit)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    now = time.time()
    submitted_at = args.submitted_at if args.submitted_at is not None else now

    content = args.content
    ev = Evidence(
        claim_id=args.claim_id,
        content=content,
        submitted_at=submitted_at,
        schema_version=args.schema_version,
        jurisdiction=args.jurisdiction,
        reviewer_ids=args.reviewers,
        rubric_score=args.rubric_score,
        baseline_rubric_score=args.baseline_rubric_score,
        delegated=args.delegated,
        controlling_reviewer_fraction=args.controlling_fraction,
        signature=_sha256(content),
        rule_ids=args.rule_ids or ["DEFAULT"],
        extra=args.extra or {},
    )

    result = run_pipeline(ev, now=now)
    print(_format_result(result, args.output_json))
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())

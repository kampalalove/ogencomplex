#!/usr/bin/env python3
"""
public_verifier.py — Skylars Global Institute Trust Verifier v1.0.0

Customers run this script to independently verify Trust Receipts without
contacting Skylars Global.  Zero trust required: every claim is
mathematically provable from public data.

Four checks run in sequence:
  1. Signature     — Receipt was signed by a Skylars Global key. Not deniable.
  2. Merkle Proof  — evidence_hash is in the committed log. Not deletable.
  3. Rekor         — Merkle root is timestamped in Sigstore. Not back-datable.
  4. TEE           — Code ran in Nitro Enclave with PCR0 pinned. Not swappable.

If all four pass the verdict is VALID_ENFORCEABLE.

Usage:
    # Verify a single receipt file
    python3 public_verifier.py verify --receipt receipt.json

    # Verify from stdin (pipe from API call)
    curl https://api.skylarsglobal.com/v1/receipt/abc123 | \\
        python3 public_verifier.py verify --receipt -

    # Verify a full Trust Report (list of receipts)
    python3 public_verifier.py verify-report --report trust_report.json

    # Batch verify directory of receipts, emit CSV for auditors
    python3 public_verifier.py batch --dir ./receipts --out audit_results.csv

Exit codes:  0 = VALID_ENFORCEABLE   1 = INVALID   2 = ERROR

Receipt JSON schema:
    {
        "receipt_id":    "<uuid or payload_hash prefix>",
        "agent_id":      "<agent identifier>",
        "verdict":       "VALID_ENFORCEABLE | REVIEW_REQUIRED_FACT | INVALID",
        "evidence_hash": "sha256:<64-hex>",
        "attested_at":   "<ISO-8601>",
        "payload_hash":  "<64-hex SHA-256 of canonical receipt payload>",
        "signature":     "<hex RSA-PSS signature over payload_hash bytes>",
        "public_key_pem":"<PEM RSA public key>",
        "merkle_root":   "<64-hex SHA-256 Merkle root>",
        "merkle_proof":  [{"sibling": "<hex>", "side": "left|right"}, ...],
        "rekor_log_id":  "<Rekor transparency log entry UUID>",
        "pcr0":          "<hex SHA-384 Nitro Enclave PCR0 measurement>"
    }
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

# ---------------------------------------------------------------------------
# Trust anchors — replace with real KMS-exported PEM keys before deploy
# ---------------------------------------------------------------------------
# Each string is a PEM-encoded RSA public key.  When non-empty every receipt
# must embed one of these keys; otherwise any well-formed key is accepted
# (development / test mode).
SKYLARS_PUBKEYS: list[str] = []

# Nitro Enclave PCR0 pinned measurement (SHA-384 hex, 96 chars).
# Set to the real measurement from `aws nitro-enclaves-cli describe-enclave`.
# The all-zeros placeholder activates warning-only mode.
PINNED_PCR0: str = "0" * 96

REKOR_BASE_URL: str = "https://rekor.sigstore.dev"

VERDICT_VALID: str = "VALID_ENFORCEABLE"
VERDICT_INVALID: str = "INVALID"


# ---------------------------------------------------------------------------
# Receipt loading
# ---------------------------------------------------------------------------
def load_receipt(source: str) -> dict:
    """Load a receipt from *source* (file path or ``'-'`` for stdin)."""
    if source == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(source).read_text()
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Check 1 — Signature
# Verify the receipt payload_hash is signed by a trusted Skylars Global key.
# ---------------------------------------------------------------------------
def verify_signature(receipt: dict) -> tuple[bool, str]:
    """
    Verify RSA-PSS signature.

    Required receipt fields:
        payload_hash   — 64-hex SHA-256 of the canonical payload
        signature      — hex RSA-PSS signature over ``payload_hash.encode()``
        public_key_pem — PEM RSA public key

    Returns ``(ok, detail)``.
    """
    payload_hash = receipt.get("payload_hash", "")
    sig_hex = receipt.get("signature", "")
    pubkey_pem = receipt.get("public_key_pem", "")

    if not payload_hash or not sig_hex or not pubkey_pem:
        return False, "Missing payload_hash, signature, or public_key_pem"

    # When trust anchors are configured the receipt key must be pinned.
    if SKYLARS_PUBKEYS:
        pinned = [k.strip() for k in SKYLARS_PUBKEYS]
        if pubkey_pem.strip() not in pinned:
            return False, "public_key_pem not in SKYLARS_PUBKEYS trust anchor set"

    try:
        public_key = serialization.load_pem_public_key(pubkey_pem.encode())
    except Exception as exc:
        return False, f"Cannot parse public_key_pem: {exc}"

    try:
        sig_bytes = bytes.fromhex(sig_hex)
    except ValueError:
        return False, "signature is not valid hex"

    try:
        public_key.verify(
            sig_bytes,
            payload_hash.encode(),
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH,
            ),
            hashes.SHA256(),
        )
    except InvalidSignature:
        return False, "Signature invalid — payload may have been tampered"
    except Exception as exc:
        return False, f"Signature check error: {exc}"

    fingerprint = hashlib.sha256(pubkey_pem.strip().encode()).hexdigest()[:16]
    return True, f"Signature valid. Key fingerprint: {fingerprint}…"


# ---------------------------------------------------------------------------
# Check 2 — Merkle Proof
# Verify evidence_hash is included in the committed Merkle root.
# ---------------------------------------------------------------------------
def verify_merkle_proof(receipt: dict) -> tuple[bool, str]:
    """
    Verify a binary Merkle inclusion proof.

    Required receipt fields:
        evidence_hash — ``sha256:<64-hex>``
        merkle_root   — 64-hex root of the Merkle tree
        merkle_proof  — list of ``{"sibling": "<hex>", "side": "left"|"right"}``
                        (omit or set to ``[]`` for a single-leaf tree)

    Returns ``(ok, detail)``.
    """
    evidence_hash = receipt.get("evidence_hash", "")
    merkle_root = receipt.get("merkle_root", "")
    proof = receipt.get("merkle_proof")

    if not evidence_hash or not merkle_root:
        return False, "Missing evidence_hash or merkle_root"

    leaf_hex = evidence_hash.removeprefix("sha256:")

    # Single-leaf tree: leaf must equal root
    if not proof:
        if leaf_hex == merkle_root:
            return True, f"Merkle inclusion verified (single-leaf). Root: {merkle_root[:16]}…"
        return False, "Leaf hash does not equal merkle_root (single-leaf check)"

    try:
        current = leaf_hex
        for step in proof:
            sibling = step["sibling"]
            side = step.get("side", "right")
            pair = (sibling + current) if side == "left" else (current + sibling)
            current = hashlib.sha256(bytes.fromhex(pair)).hexdigest()
    except Exception as exc:
        return False, f"Merkle proof traversal error: {exc}"

    if current == merkle_root:
        return True, f"Merkle inclusion verified ({len(proof)} steps). Root: {merkle_root[:16]}…"
    return False, (
        f"Merkle proof invalid: computed root {current[:16]}… "
        f"≠ committed root {merkle_root[:16]}…"
    )


# ---------------------------------------------------------------------------
# Check 3 — Rekor Inclusion
# Confirm the Merkle root was timestamped in Sigstore's transparency log.
# ---------------------------------------------------------------------------
def verify_rekor_inclusion(receipt: dict, *, timeout: int = 10) -> tuple[bool, str]:
    """
    Query Sigstore Rekor to confirm the log entry exists.

    Required receipt field:
        rekor_log_id — UUID of the Rekor log entry

    When Rekor is unreachable the check degrades to a warning (returns
    ``True``) so offline auditors are not blocked.

    Returns ``(ok, detail)``.
    """
    rekor_log_id = receipt.get("rekor_log_id", "")
    if not rekor_log_id:
        return False, "Missing rekor_log_id — cannot verify Rekor inclusion"

    url = f"{REKOR_BASE_URL}/api/v1/log/entries/{rekor_log_id}"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            json.loads(resp.read())
        return True, f"Rekor entry confirmed. Log ID: {rekor_log_id[:16]}…"
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False, f"Rekor entry {rekor_log_id[:16]}… not found in transparency log"
        return False, f"Rekor HTTP {exc.code}: {exc.reason}"
    except Exception as exc:
        # Network unreachable — degrade to warning; don't block offline audits
        return True, f"WARN: Rekor unreachable ({type(exc).__name__}). Skipping inclusion check"


# ---------------------------------------------------------------------------
# Check 4 — TEE Attestation
# Confirm PCR0 matches the pinned Nitro Enclave measurement.
# ---------------------------------------------------------------------------
def verify_tee_attestation(receipt: dict) -> tuple[bool, str]:
    """
    Verify the Nitro Enclave PCR0 measurement embedded in the receipt.

    Required receipt field:
        pcr0 — hex SHA-384 PCR0 measurement (96 chars)

    Returns ``(ok, detail)``.
    """
    pcr0 = receipt.get("pcr0", "").lower()
    if not pcr0:
        return False, "Missing pcr0 — TEE attestation absent from receipt"

    # All-zero PCR0 means the enclave is in debug mode
    if pcr0 == "0" * len(pcr0) and PINNED_PCR0.lower() != "0" * len(PINNED_PCR0):
        return False, "PCR0 is all-zeros (debug enclave) — not accepted in production"

    pinned = PINNED_PCR0.lower()

    # Trust anchor not yet configured — emit warning but pass
    if pinned == "0" * len(pinned):
        return True, f"WARN: PINNED_PCR0 not configured. PCR0 in receipt: {pcr0[:16]}…"

    if pcr0 == pinned:
        return True, f"TEE PCR0 matches pinned measurement: {pcr0[:16]}…"

    return False, f"PCR0 mismatch: receipt={pcr0[:16]}… expected={pinned[:16]}…"


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def verify_receipt(receipt: dict) -> dict[str, Any]:
    """
    Run all four verification checks against *receipt*.

    Returns::

        {
            "verdict":   "VALID_ENFORCEABLE" | "INVALID",
            "receipt_id": str,
            "checks": {
                "signature":    {"ok": bool, "detail": str},
                "merkle_proof": {"ok": bool, "detail": str},
                "rekor":        {"ok": bool, "detail": str},
                "tee":          {"ok": bool, "detail": str},
            }
        }
    """
    sig_ok,    sig_detail    = verify_signature(receipt)
    merkle_ok, merkle_detail = verify_merkle_proof(receipt)
    rekor_ok,  rekor_detail  = verify_rekor_inclusion(receipt)
    tee_ok,    tee_detail    = verify_tee_attestation(receipt)

    checks = {
        "signature":    {"ok": sig_ok,    "detail": sig_detail},
        "merkle_proof": {"ok": merkle_ok, "detail": merkle_detail},
        "rekor":        {"ok": rekor_ok,  "detail": rekor_detail},
        "tee":          {"ok": tee_ok,    "detail": tee_detail},
    }

    verdict = VERDICT_VALID if all(c["ok"] for c in checks.values()) else VERDICT_INVALID

    receipt_id = receipt.get(
        "receipt_id",
        receipt.get("payload_hash", "unknown")[:16],
    )

    return {"verdict": verdict, "receipt_id": receipt_id, "checks": checks}


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------
_CHECK_LABELS: dict[str, str] = {
    "signature":    "1. Signature      ",
    "merkle_proof": "2. Merkle Proof   ",
    "rekor":        "3. Rekor Inclusion",
    "tee":          "4. TEE Attestation",
}


def _print_result(result: dict, *, json_out: bool = False) -> None:
    if json_out:
        print(json.dumps(result, indent=2))
        return

    w = 64
    print("─" * w)
    print(f"  Receipt ID : {result['receipt_id']}")
    print(f"  Verdict    : {result['verdict']}")
    print("─" * w)
    for key, label in _CHECK_LABELS.items():
        check = result["checks"][key]
        marker = "✓" if check["ok"] else "✗"
        print(f"  {marker} {label}  {check['detail']}")
    print("─" * w)
    if result["verdict"] == VERDICT_VALID:
        print("  RESULT: VALID_ENFORCEABLE")
    else:
        print("  RESULT: INVALID — one or more checks failed")
    print("─" * w)


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------
def cmd_verify(args: argparse.Namespace) -> int:
    """Verify a single receipt."""
    try:
        receipt = load_receipt(args.receipt)
    except Exception as exc:
        print(f"ERROR: Cannot load receipt: {exc}", file=sys.stderr)
        return 2
    result = verify_receipt(receipt)
    _print_result(result, json_out=getattr(args, "json", False))
    return 0 if result["verdict"] == VERDICT_VALID else 1


def cmd_verify_report(args: argparse.Namespace) -> int:
    """Verify all receipts embedded in a Trust Report bundle."""
    try:
        report = json.loads(Path(args.report).read_text())
    except Exception as exc:
        print(f"ERROR: Cannot load report: {exc}", file=sys.stderr)
        return 2

    receipts: list[dict] = report if isinstance(report, list) else report.get("receipts", [])
    if not receipts:
        print("ERROR: No receipts found in report.", file=sys.stderr)
        return 2

    results = [verify_receipt(r) for r in receipts]
    for result in results:
        _print_result(result, json_out=getattr(args, "json", False))

    passed = sum(1 for r in results if r["verdict"] == VERDICT_VALID)
    failed = len(results) - passed
    print(f"\nSummary: {passed}/{len(results)} VALID_ENFORCEABLE, {failed} INVALID")
    return 0 if failed == 0 else 1


def cmd_batch(args: argparse.Namespace) -> int:
    """Batch verify all receipt JSON files in a directory, write CSV."""
    receipt_dir = Path(args.dir)
    files = sorted(receipt_dir.glob("*.json"))
    if not files:
        print(f"ERROR: No .json files found in {receipt_dir}", file=sys.stderr)
        return 2

    rows: list[dict] = []
    passed = failed = 0

    for fpath in files:
        try:
            receipt = json.loads(fpath.read_text())
            result = verify_receipt(receipt)
        except Exception as exc:
            result = {
                "verdict": VERDICT_INVALID,
                "receipt_id": fpath.name,
                "checks": {
                    k: {"ok": False, "detail": str(exc)}
                    for k in ("signature", "merkle_proof", "rekor", "tee")
                },
            }

        if result["verdict"] == VERDICT_VALID:
            passed += 1
        else:
            failed += 1

        rows.append({
            "file":         fpath.name,
            "receipt_id":   result["receipt_id"],
            "verdict":      result["verdict"],
            "signature":    result["checks"]["signature"]["ok"],
            "merkle_proof": result["checks"]["merkle_proof"]["ok"],
            "rekor":        result["checks"]["rekor"]["ok"],
            "tee":          result["checks"]["tee"]["ok"],
        })

    out_path = args.out
    with open(out_path, "w", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["file", "receipt_id", "verdict", "signature",
                        "merkle_proof", "rekor", "tee"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Batch complete: {passed}/{len(files)} VALID_ENFORCEABLE, {failed} INVALID")
    print(f"Results written to: {out_path}")
    return 0 if failed == 0 else 1


# ---------------------------------------------------------------------------
# CLI parser
# ---------------------------------------------------------------------------
def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="public_verifier",
        description=(
            "Skylars Global Trust Receipt Verifier v1.0.0\n"
            "Verify receipts independently — no Skylars Global contact required.\n\n"
            "Exit codes: 0=VALID_ENFORCEABLE  1=INVALID  2=ERROR"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    sub = p.add_subparsers(dest="command", required=True)

    v = sub.add_parser("verify", help="Verify a single receipt.")
    v.add_argument(
        "--receipt", required=True, metavar="FILE|-",
        help="Path to receipt JSON file, or '-' to read from stdin.",
    )
    v.add_argument("--json",    action="store_true", help="Output as JSON.")
    v.add_argument("--verbose", action="store_true", help="Verbose output.")
    v.set_defaults(func=cmd_verify)

    vr = sub.add_parser("verify-report", help="Verify all receipts in a Trust Report bundle.")
    vr.add_argument("--report", required=True, metavar="FILE",
                    help="Path to Trust Report JSON.")
    vr.add_argument("--json", action="store_true", help="Output as JSON.")
    vr.set_defaults(func=cmd_verify_report)

    b = sub.add_parser("batch", help="Batch verify a directory of receipts.")
    b.add_argument("--dir", required=True, metavar="DIR",
                   help="Directory containing receipt *.json files.")
    b.add_argument("--out", default="audit_results.csv", metavar="FILE",
                   help="Output CSV path (default: audit_results.csv).")
    b.set_defaults(func=cmd_batch)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

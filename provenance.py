#!/usr/bin/env python3
"""
provenance.py — OGEN Complex v1.1.0
Domain 4: Provenance, Lineage & Asset Rights

Majors 16–20 — immutable lineage, creator licensing, synthetic watermarking,
algorithmic accountability, and canonical serialisation.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Major 16: Immutable Dataset Lineage Tracing
# ---------------------------------------------------------------------------
def lineage_trace(dataset_id: str, pipeline_steps: list[dict]) -> str:
    """
    Cryptographic audit of a data pipeline → returns a deterministic SHA-256
    commitment over the dataset_id, ordered steps, and a UTC timestamp.
    """
    lineage_obj: dict[str, Any] = {
        "dataset_id": dataset_id,
        "steps": pipeline_steps,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
    }
    lineage_bytes = json.dumps(lineage_obj, sort_keys=True, separators=(",", ":")).encode()
    lineage_hash = hashlib.sha256(lineage_bytes).hexdigest()
    return f"sha256:{lineage_hash}"


# ---------------------------------------------------------------------------
# Major 17: Creator Rights & Output Token Licensing
# ---------------------------------------------------------------------------
class TokenLicense:
    """Issues HMAC-signed license tokens binding a creator to an output hash."""

    _SECRET = b"license_secret_v1"  # rotate via env in production

    def __init__(self, creator_id: str, royalty_rate: float):
        if not 0.0 <= royalty_rate <= 1.0:
            raise ValueError(f"royalty_rate must be in [0, 1]; got {royalty_rate!r}")
        self.creator_id = creator_id
        self.royalty_rate = royalty_rate

    def mint_license_token(self, output_hash: str) -> str:
        """Return a versioned, HMAC-SHA-256 license token."""
        msg = f"{self.creator_id}:{output_hash}".encode()
        token = hmac.new(self._SECRET, msg, hashlib.sha256).hexdigest()
        return f"license_v1:{token}"

    def verify_license_token(self, output_hash: str, token: str) -> bool:
        """Constant-time verification of a previously minted token."""
        expected = self.mint_license_token(output_hash)
        return hmac.compare_digest(token, expected)


# ---------------------------------------------------------------------------
# Major 18: Synthetic Content Watermarking
# ---------------------------------------------------------------------------
_WATERMARK_PREFIX = b"<!-- WATERMARK:"
_WATERMARK_SUFFIX = b" -->"


def watermark_content(content: bytes, watermark_id: str) -> bytes:
    """Append an HTML-comment watermark to *content*."""
    marker = _WATERMARK_PREFIX + watermark_id.encode() + _WATERMARK_SUFFIX + b"\n"
    return content + b"\n" + marker


def detect_watermark(content: bytes) -> Optional[str]:
    """
    Return the watermark_id embedded by :func:`watermark_content`, or ``None``
    if no watermark is present.
    """
    idx = content.find(_WATERMARK_PREFIX)
    if idx == -1:
        return None
    start = idx + len(_WATERMARK_PREFIX)          # first byte after the ":"
    end = content.find(_WATERMARK_SUFFIX, start)
    if end == -1:
        return None
    return content[start:end].decode()


# ---------------------------------------------------------------------------
# Major 19: Algorithmic Accountability Substrates
# ---------------------------------------------------------------------------
class AccountabilityLedger:
    """
    Append-only in-memory ledger of agent decisions.
    Swap ``self.entries`` for a persistent store (Postgres, S3, etc.) in prod.
    """

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []

    def log_decision(
        self,
        agent_id: str,
        input_hash: str,
        output_hash: str,
        rationale: str,
    ) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "agent_id": agent_id,
            "input_hash": input_hash,
            "output_hash": output_hash,
            "rationale": rationale,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        }
        self.entries.append(entry)
        return entry

    def export_ledger(self) -> list[dict[str, Any]]:
        return list(self.entries)


# ---------------------------------------------------------------------------
# Major 20: Canonical Data Serialization (RFC 8785-inspired)
# ---------------------------------------------------------------------------
def canonical_json(obj: dict) -> str:
    """
    Strict deterministic JSON serialisation: sorted keys, no extra whitespace.
    Suitable for evidentiary truth and cryptographic commitments.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Gateway integration helper
# ---------------------------------------------------------------------------
def add_provenance_to_response(
    original_response: dict,
    dataset_id: Optional[str] = None,
) -> dict:
    """
    Attach a ``provenance`` block to *original_response* in-place.

    The block contains:
    - ``lineage_hash``     — SHA-256 commitment over (dataset_id, empty steps)
    - ``canonical_proof``  — RFC 8785-canonical serialisation of the response
    - ``watermark_detected`` — always ``None`` (caller should check upstream input)
    """
    provenance: dict[str, Any] = {
        "lineage_hash": lineage_trace(dataset_id or "unknown", []),
        "canonical_proof": canonical_json(original_response),
        "watermark_detected": None,
    }
    original_response["provenance"] = provenance
    # Note: canonical_proof captures the response *before* the provenance block
    # is attached — this is intentional; it commits the payload, not the wrapper.
    return original_response

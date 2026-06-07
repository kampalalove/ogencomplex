#!/usr/bin/env python3
"""
test_public_verifier.py — Public Verifier test suite.

Generates synthetic receipts via RSA key fixtures and runs them through all
four verification checks.  Rekor network calls are always mocked so the suite
is fully offline.

Run:
    python -m pytest test_public_verifier.py -v
"""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from public_verifier import (
    VERDICT_INVALID,
    VERDICT_VALID,
    cmd_batch,
    cmd_verify,
    cmd_verify_report,
    load_receipt,
    verify_merkle_proof,
    verify_receipt,
    verify_signature,
    verify_tee_attestation,
)


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def rsa_key():
    """Generate a single RSA-2048 key for the whole test session."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def pubkey_pem(rsa_key) -> str:
    return rsa_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


def _sign(private_key, payload_hash: str) -> str:
    """Return hex RSA-PSS signature over *payload_hash* bytes."""
    sig = private_key.sign(
        payload_hash.encode(),
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH,
        ),
        hashes.SHA256(),
    )
    return sig.hex()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _build_merkle_proof(leaves: list[str], target_index: int) -> tuple[str, list[dict]]:
    """
    Build a simple binary Merkle tree from *leaves* (hex strings).
    Returns (merkle_root, proof_steps) for the leaf at *target_index*.
    """
    if not leaves:
        raise ValueError("leaves must be non-empty")

    # Pad to power-of-two
    size = 1
    while size < len(leaves):
        size <<= 1
    layer = list(leaves) + [leaves[-1]] * (size - len(leaves))

    path: list[dict] = []
    idx = target_index

    while len(layer) > 1:
        next_layer: list[str] = []
        for i in range(0, len(layer), 2):
            left, right = layer[i], layer[i + 1] if i + 1 < len(layer) else layer[i]
            parent = hashlib.sha256(bytes.fromhex(left + right)).hexdigest()
            next_layer.append(parent)

        sibling_idx = idx ^ 1  # XOR with 1 to get sibling
        if sibling_idx < len(layer):
            side = "left" if idx % 2 == 1 else "right"
            path.append({"sibling": layer[sibling_idx], "side": side})

        idx //= 2
        layer = next_layer

    return layer[0], path


def _make_receipt(
    private_key,
    pubkey_pem: str,
    *,
    evidence_content: str = "valid evidence",
    rekor_log_id: str = "fake-rekor-uuid-1234",
    pcr0: str = "0" * 96,
    merkle_leaves: list[str] | None = None,
    target_index: int = 0,
    extra: dict | None = None,
) -> dict:
    """
    Build a fully signed synthetic receipt suitable for verification.
    All four check fields are populated.
    """
    evidence_hash = "sha256:" + _sha256(evidence_content)

    # Merkle
    leaf_hex = _sha256(evidence_content)
    leaves = merkle_leaves or [leaf_hex]
    if leaf_hex not in leaves:
        leaves = [leaf_hex] + leaves
        target_index = 0
    merkle_root, proof = _build_merkle_proof(leaves, target_index)

    # Payload hash over core fields
    core: dict[str, Any] = {
        "agent_id":      "test_agent",
        "verdict":       "VALID_ENFORCEABLE",
        "evidence_hash": evidence_hash,
        "attested_at":   "2026-06-07T00:00:00Z",
        "merkle_root":   merkle_root,
        "rekor_log_id":  rekor_log_id,
        "pcr0":          pcr0,
    }
    if extra:
        core.update(extra)

    payload_hash = _sha256(json.dumps(core, sort_keys=True, separators=(",", ":")))
    signature = _sign(private_key, payload_hash)

    return {
        **core,
        "receipt_id":    payload_hash[:16],
        "payload_hash":  payload_hash,
        "signature":     signature,
        "public_key_pem": pubkey_pem,
        "merkle_proof":  proof,
    }


# Rekor is always mocked to succeed in this suite (no network calls)
REKOR_OK = (True, "Rekor entry confirmed. Log ID: fake-rekor-uuid…")


# ---------------------------------------------------------------------------
# verify_signature
# ---------------------------------------------------------------------------
class TestVerifySignature:
    def test_valid_signature(self, rsa_key, pubkey_pem):
        payload_hash = _sha256("test")
        sig = _sign(rsa_key, payload_hash)
        receipt = {"payload_hash": payload_hash, "signature": sig, "public_key_pem": pubkey_pem}
        ok, detail = verify_signature(receipt)
        assert ok
        assert "Signature valid" in detail

    def test_tampered_payload_hash(self, rsa_key, pubkey_pem):
        sig = _sign(rsa_key, _sha256("original"))
        receipt = {
            "payload_hash": _sha256("tampered"),
            "signature": sig,
            "public_key_pem": pubkey_pem,
        }
        ok, detail = verify_signature(receipt)
        assert not ok
        assert "invalid" in detail.lower() or "tamper" in detail.lower()

    def test_missing_payload_hash(self, pubkey_pem):
        ok, detail = verify_signature({"signature": "aa", "public_key_pem": pubkey_pem})
        assert not ok
        assert "Missing" in detail

    def test_missing_signature(self, pubkey_pem):
        ok, detail = verify_signature({"payload_hash": "aa", "public_key_pem": pubkey_pem})
        assert not ok

    def test_missing_pubkey(self):
        ok, detail = verify_signature({"payload_hash": "aa", "signature": "bb"})
        assert not ok

    def test_invalid_hex_signature(self, pubkey_pem):
        ok, detail = verify_signature({
            "payload_hash": "aa",
            "signature": "not-hex!!",
            "public_key_pem": pubkey_pem,
        })
        assert not ok
        assert "hex" in detail.lower()

    def test_malformed_pem(self, rsa_key):
        payload_hash = _sha256("x")
        ok, _ = verify_signature({
            "payload_hash": payload_hash,
            "signature": _sign(rsa_key, payload_hash),
            "public_key_pem": "NOTAPEM",
        })
        assert not ok

    def test_trust_anchor_rejects_unknown_key(self, rsa_key, pubkey_pem):
        payload_hash = _sha256("y")
        receipt = {
            "payload_hash": payload_hash,
            "signature": _sign(rsa_key, payload_hash),
            "public_key_pem": pubkey_pem,
        }
        with patch("public_verifier.SKYLARS_PUBKEYS", ["-----BEGIN PUBLIC KEY-----\nDIFFERENT\n-----END PUBLIC KEY-----\n"]):
            ok, detail = verify_signature(receipt)
        assert not ok
        assert "trust anchor" in detail.lower()

    def test_trust_anchor_accepts_matching_key(self, rsa_key, pubkey_pem):
        payload_hash = _sha256("z")
        receipt = {
            "payload_hash": payload_hash,
            "signature": _sign(rsa_key, payload_hash),
            "public_key_pem": pubkey_pem,
        }
        with patch("public_verifier.SKYLARS_PUBKEYS", [pubkey_pem]):
            ok, _ = verify_signature(receipt)
        assert ok


# ---------------------------------------------------------------------------
# verify_merkle_proof
# ---------------------------------------------------------------------------
class TestVerifyMerkleProof:
    def test_single_leaf_matches_root(self):
        leaf = _sha256("evidence A")
        receipt = {
            "evidence_hash": f"sha256:{leaf}",
            "merkle_root": leaf,
            "merkle_proof": [],
        }
        ok, detail = verify_merkle_proof(receipt)
        assert ok
        assert "single-leaf" in detail

    def test_single_leaf_root_mismatch(self):
        leaf = _sha256("evidence A")
        receipt = {
            "evidence_hash": f"sha256:{leaf}",
            "merkle_root": _sha256("wrong"),
            "merkle_proof": [],
        }
        ok, _ = verify_merkle_proof(receipt)
        assert not ok

    def test_two_leaf_proof(self):
        leaf0 = _sha256("leaf 0")
        leaf1 = _sha256("leaf 1")
        root, proof = _build_merkle_proof([leaf0, leaf1], target_index=0)
        receipt = {
            "evidence_hash": f"sha256:{leaf0}",
            "merkle_root": root,
            "merkle_proof": proof,
        }
        ok, detail = verify_merkle_proof(receipt)
        assert ok
        assert "1 steps" in detail

    def test_four_leaf_proof_each_position(self):
        leaves = [_sha256(f"leaf {i}") for i in range(4)]
        for idx in range(4):
            root, proof = _build_merkle_proof(leaves, target_index=idx)
            receipt = {
                "evidence_hash": f"sha256:{leaves[idx]}",
                "merkle_root": root,
                "merkle_proof": proof,
            }
            ok, _ = verify_merkle_proof(receipt)
            assert ok, f"Failed at index {idx}"

    def test_tampered_sibling_fails(self):
        leaves = [_sha256(f"L{i}") for i in range(2)]
        root, proof = _build_merkle_proof(leaves, 0)
        proof[0]["sibling"] = _sha256("tampered")
        receipt = {
            "evidence_hash": f"sha256:{leaves[0]}",
            "merkle_root": root,
            "merkle_proof": proof,
        }
        ok, _ = verify_merkle_proof(receipt)
        assert not ok

    def test_missing_evidence_hash(self):
        ok, _ = verify_merkle_proof({"merkle_root": "aa"})
        assert not ok

    def test_missing_merkle_root(self):
        ok, _ = verify_merkle_proof({"evidence_hash": "sha256:aa"})
        assert not ok

    def test_sha256_prefix_stripped(self):
        leaf = _sha256("data")
        receipt = {
            "evidence_hash": f"sha256:{leaf}",
            "merkle_root": leaf,
        }
        ok, _ = verify_merkle_proof(receipt)
        assert ok


# ---------------------------------------------------------------------------
# verify_tee_attestation
# ---------------------------------------------------------------------------
class TestVerifyTeeAttestation:
    def test_missing_pcr0(self):
        ok, detail = verify_tee_attestation({})
        assert not ok
        assert "Missing" in detail

    def test_pinned_not_configured_warns(self):
        """All-zero PINNED_PCR0 (placeholder) → pass with WARN."""
        with patch("public_verifier.PINNED_PCR0", "0" * 96):
            ok, detail = verify_tee_attestation({"pcr0": "a" * 96})
        assert ok
        assert "WARN" in detail

    def test_pcr0_matches_pinned(self):
        real_pcr0 = "a" * 96
        with patch("public_verifier.PINNED_PCR0", real_pcr0):
            ok, detail = verify_tee_attestation({"pcr0": real_pcr0})
        assert ok
        assert "matches" in detail

    def test_pcr0_mismatch(self):
        with patch("public_verifier.PINNED_PCR0", "b" * 96):
            ok, detail = verify_tee_attestation({"pcr0": "a" * 96})
        assert not ok
        assert "mismatch" in detail

    def test_all_zero_pcr0_with_real_pin_fails(self):
        """Debug-mode (all-zero PCR0) is rejected when pin is real."""
        with patch("public_verifier.PINNED_PCR0", "c" * 96):
            ok, detail = verify_tee_attestation({"pcr0": "0" * 96})
        assert not ok
        assert "debug" in detail.lower()


# ---------------------------------------------------------------------------
# verify_receipt — full integration (Rekor mocked)
# ---------------------------------------------------------------------------
@pytest.fixture
def good_receipt(rsa_key, pubkey_pem):
    return _make_receipt(rsa_key, pubkey_pem)


class TestVerifyReceipt:
    def test_all_checks_pass(self, good_receipt):
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            result = verify_receipt(good_receipt)
        assert result["verdict"] == VERDICT_VALID
        assert all(c["ok"] for c in result["checks"].values())

    def test_bad_signature_fails(self, rsa_key, pubkey_pem):
        receipt = _make_receipt(rsa_key, pubkey_pem)
        receipt["signature"] = "deadbeef" * 16
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            result = verify_receipt(receipt)
        assert result["verdict"] == VERDICT_INVALID
        assert not result["checks"]["signature"]["ok"]

    def test_merkle_tamper_fails(self, rsa_key, pubkey_pem):
        receipt = _make_receipt(rsa_key, pubkey_pem, merkle_leaves=[_sha256(f"x{i}") for i in range(4)])
        if receipt.get("merkle_proof"):
            receipt["merkle_proof"][0]["sibling"] = _sha256("tampered")
        else:
            receipt["merkle_root"] = _sha256("wrong_root")
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            result = verify_receipt(receipt)
        assert result["verdict"] == VERDICT_INVALID
        assert not result["checks"]["merkle_proof"]["ok"]

    def test_missing_rekor_fails(self, rsa_key, pubkey_pem):
        receipt = _make_receipt(rsa_key, pubkey_pem)
        del receipt["rekor_log_id"]
        with patch("public_verifier.verify_rekor_inclusion",
                   return_value=(False, "Missing rekor_log_id")):
            result = verify_receipt(receipt)
        assert result["verdict"] == VERDICT_INVALID
        assert not result["checks"]["rekor"]["ok"]

    def test_tee_mismatch_fails(self, rsa_key, pubkey_pem):
        receipt = _make_receipt(rsa_key, pubkey_pem, pcr0="b" * 96)
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            with patch("public_verifier.PINNED_PCR0", "c" * 96):
                result = verify_receipt(receipt)
        assert result["verdict"] == VERDICT_INVALID
        assert not result["checks"]["tee"]["ok"]

    def test_receipt_id_falls_back_to_payload_hash(self, rsa_key, pubkey_pem):
        receipt = _make_receipt(rsa_key, pubkey_pem)
        del receipt["receipt_id"]
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            result = verify_receipt(receipt)
        assert result["receipt_id"] == receipt["payload_hash"][:16]


# ---------------------------------------------------------------------------
# Parametrised: 20 synthetic receipts all pass
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("idx", list(range(20)))
def test_synthetic_receipts_pass(idx, rsa_key, pubkey_pem):
    """
    20 independently generated receipts must all return VALID_ENFORCEABLE.
    """
    content = f"Synthetic evidence payload number {idx} for attestation."
    receipt = _make_receipt(rsa_key, pubkey_pem, evidence_content=content)
    with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
        result = verify_receipt(receipt)
    assert result["verdict"] == VERDICT_VALID, (
        f"Receipt {idx} failed: {result['checks']}"
    )


# ---------------------------------------------------------------------------
# CLI — cmd_verify
# ---------------------------------------------------------------------------
class TestCmdVerify:
    def _args(self, receipt_path: str, json_out: bool = False):
        ns = type("NS", (), {"receipt": receipt_path, "json": json_out, "verbose": False})()
        return ns

    def test_valid_receipt_exits_0(self, tmp_path, rsa_key, pubkey_pem):
        receipt = _make_receipt(rsa_key, pubkey_pem)
        f = tmp_path / "r.json"
        f.write_text(json.dumps(receipt))
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            code = cmd_verify(self._args(str(f)))
        assert code == 0

    def test_invalid_receipt_exits_1(self, tmp_path, rsa_key, pubkey_pem):
        receipt = _make_receipt(rsa_key, pubkey_pem)
        receipt["signature"] = "badbad"
        f = tmp_path / "bad.json"
        f.write_text(json.dumps(receipt))
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            code = cmd_verify(self._args(str(f)))
        assert code == 1

    def test_missing_file_exits_2(self):
        code = cmd_verify(self._args("/nonexistent/path/receipt.json"))
        assert code == 2

    def test_json_output(self, tmp_path, rsa_key, pubkey_pem, capsys):
        receipt = _make_receipt(rsa_key, pubkey_pem)
        f = tmp_path / "r.json"
        f.write_text(json.dumps(receipt))
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            cmd_verify(self._args(str(f), json_out=True))
        out = capsys.readouterr().out
        parsed = json.loads(out)
        assert parsed["verdict"] == VERDICT_VALID


# ---------------------------------------------------------------------------
# CLI — cmd_verify_report
# ---------------------------------------------------------------------------
class TestCmdVerifyReport:
    def _args(self, report_path: str, json_out: bool = False):
        return type("NS", (), {"report": report_path, "json": json_out})()

    def test_all_valid_report_exits_0(self, tmp_path, rsa_key, pubkey_pem):
        receipts = [
            _make_receipt(rsa_key, pubkey_pem, evidence_content=f"rpt {i}")
            for i in range(5)
        ]
        f = tmp_path / "report.json"
        f.write_text(json.dumps({"receipts": receipts}))
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            code = cmd_verify_report(self._args(str(f)))
        assert code == 0

    def test_partial_invalid_report_exits_1(self, tmp_path, rsa_key, pubkey_pem):
        r1 = _make_receipt(rsa_key, pubkey_pem, evidence_content="ok")
        r2 = _make_receipt(rsa_key, pubkey_pem, evidence_content="bad")
        r2["signature"] = "00" * 256
        f = tmp_path / "report.json"
        f.write_text(json.dumps([r1, r2]))
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            code = cmd_verify_report(self._args(str(f)))
        assert code == 1

    def test_empty_report_exits_2(self, tmp_path):
        f = tmp_path / "empty.json"
        f.write_text(json.dumps({"receipts": []}))
        code = cmd_verify_report(self._args(str(f)))
        assert code == 2


# ---------------------------------------------------------------------------
# CLI — cmd_batch
# ---------------------------------------------------------------------------
class TestCmdBatch:
    def _args(self, directory: str, out: str = "audit_results.csv"):
        return type("NS", (), {"dir": directory, "out": out})()

    def test_all_pass_exits_0(self, tmp_path, rsa_key, pubkey_pem):
        for i in range(5):
            r = _make_receipt(rsa_key, pubkey_pem, evidence_content=f"batch {i}")
            (tmp_path / f"r{i:02d}.json").write_text(json.dumps(r))
        out_csv = str(tmp_path / "out.csv")
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            code = cmd_batch(self._args(str(tmp_path), out=out_csv))
        assert code == 0
        rows = Path(out_csv).read_text().splitlines()
        assert len(rows) == 6  # header + 5 data rows

    def test_empty_dir_exits_2(self, tmp_path):
        code = cmd_batch(self._args(str(tmp_path)))
        assert code == 2

    def test_csv_columns(self, tmp_path, rsa_key, pubkey_pem):
        r = _make_receipt(rsa_key, pubkey_pem)
        (tmp_path / "r.json").write_text(json.dumps(r))
        out_csv = str(tmp_path / "out.csv")
        with patch("public_verifier.verify_rekor_inclusion", return_value=REKOR_OK):
            cmd_batch(self._args(str(tmp_path), out=out_csv))
        header = Path(out_csv).read_text().splitlines()[0]
        for col in ("file", "receipt_id", "verdict", "signature", "merkle_proof", "rekor", "tee"):
            assert col in header


# ---------------------------------------------------------------------------
# load_receipt
# ---------------------------------------------------------------------------
class TestLoadReceipt:
    def test_load_from_file(self, tmp_path):
        data = {"receipt_id": "abc"}
        f = tmp_path / "r.json"
        f.write_text(json.dumps(data))
        assert load_receipt(str(f)) == data

    def test_missing_file_raises(self):
        with pytest.raises(Exception):
            load_receipt("/no/such/file.json")

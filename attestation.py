"""
attestation.py — OGEN Complex Major 4
Capability Attestation

Signs and verifies proof chains produced by deterministic_engine.py.
Uses RSA-PSS (SHA-256) via the `cryptography` package.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import (
    RSAPrivateKey,
    RSAPublicKey,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _canonical_json(obj: Any) -> bytes:
    """Deterministic JSON serialisation (sorted keys, no whitespace)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
class CapabilityAttestation:
    """
    Signs a proof chain with an RSA private key and verifies it with the
    corresponding public key.

    Parameters
    ----------
    agent_name : str
        Human-readable identifier for the attesting agent.
    private_key : RSAPrivateKey
        The key used to sign. Pass the object directly (not bytes).
    """

    _PADDING = padding.PSS(
        mgf=padding.MGF1(hashes.SHA256()),
        salt_length=padding.PSS.MAX_LENGTH,
    )
    _HASH = hashes.SHA256()

    def __init__(self, agent_name: str, private_key: RSAPrivateKey):
        self._agent_name = agent_name
        self._private_key: RSAPrivateKey = private_key
        self._public_key: RSAPublicKey = private_key.public_key()

    # ------------------------------------------------------------------
    def attest_chain(self, proof_chain: list[dict]) -> dict:
        """
        Sign the entire proof chain.

        Returns a bundle::

            {
                "agent": "<agent_name>",
                "chain_hash": "<hex>",     # SHA-256 of canonical JSON
                "signature": "<hex>",      # RSA-PSS signature over chain_hash
                "steps": <proof_chain>
            }
        """
        payload = _canonical_json(proof_chain)
        chain_hash = hashlib.sha256(payload).hexdigest()
        sig = self._private_key.sign(
            chain_hash.encode(),
            self._PADDING,
            self._HASH,
        )
        return {
            "agent": self._agent_name,
            "chain_hash": chain_hash,
            "signature": sig.hex(),
            "steps": proof_chain,
        }

    # ------------------------------------------------------------------
    def verify_bundle(self, bundle: dict) -> bool:
        """
        Verify a bundle produced by :meth:`attest_chain`.

        Returns True if the signature and chain_hash are both valid.
        """
        try:
            steps = bundle["steps"]
            payload = _canonical_json(steps)
            expected_hash = hashlib.sha256(payload).hexdigest()
            if expected_hash != bundle["chain_hash"]:
                return False
            sig_bytes = bytes.fromhex(bundle["signature"])
            self._public_key.verify(
                sig_bytes,
                bundle["chain_hash"].encode(),
                self._PADDING,
                self._HASH,
            )
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    @property
    def agent_name(self) -> str:
        return self._agent_name

    @property
    def public_key_pem(self) -> str:
        return self._public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

    # ------------------------------------------------------------------
    @staticmethod
    def generate_key(key_size: int = 2048) -> RSAPrivateKey:
        """Convenience factory for a fresh RSA key."""
        return rsa.generate_private_key(
            public_exponent=65537,
            key_size=key_size,
        )

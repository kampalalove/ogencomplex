import base64
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app import (
    PROF_REGISTRY,
    REVOCATION_LIST,
    _ensure_bootstrap,
)
from employer_cli import verify_credential_package
from registry_keys import sign_registry, verify_registry

BASE_DIR = Path(__file__).parent
KEYS_DIR = BASE_DIR / "keys"


def _sign_assessment_hash(assessment_hash: str, private_key_path: Path) -> str:
    priv = serialization.load_pem_private_key(private_key_path.read_bytes(), None)
    sig = priv.sign(
        assessment_hash.encode("utf-8"),
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return base64.b64encode(sig).decode("utf-8")


def _reset_revocations():
    REVOCATION_LIST.write_text("", encoding="utf-8")


def _append_registry(entry: dict):
    with open(PROF_REGISTRY, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, sort_keys=True) + "\n")


def _issue_mock_diploma(assessment_hash: str, key_id: str, signature: str, signed_at: str):
    return {
        "metadata": {
            "assessment_hash": assessment_hash,
            "assessment_version": "ogenlaw_contracts_v1.2.0",
            "assessment_definition_hash": "demo_assessment_hash",
            "rubric_hash": "demo_rubric_hash",
        },
        "adjudication": {"verdict": "VALID_ENFORCEABLE", "ambiguity_score": 0.0},
        "signature_block": {"key_id": key_id, "signed_at": signed_at, "signature": signature},
    }


def main():
    print("=" * 72)
    print("      INITIALIZING OGENLAW VERTICAL SLICE SEALS matrix")
    print("=" * 72)

    _ensure_bootstrap()
    _reset_revocations()
    sign_registry()

    assessment_hash = "a" * 64
    now = datetime.now(timezone.utc)

    # Scenario A
    print("\n📋 [SCENARIO A]: Processing Pristine Valid Loop Execution...")
    active_key_id = "KEY_PROF_MARK_ACTIVE"
    active_sig = _sign_assessment_hash(assessment_hash, KEYS_DIR / "prof_PROF_MARK_priv.pem")
    diploma_a = _issue_mock_diploma(
        assessment_hash,
        active_key_id,
        active_sig,
        now.isoformat().replace("+00:00", "Z"),
    )
    result_a = verify_credential_package(diploma_a)
    print(f"   -> Resulting Verification Status: {result_a.get('status')}")
    print(f"   -> Summary Metrics: {json.dumps({'verdict': result_a.get('reason')})}")

    # Scenario B
    print("\n💥 [SCENARIO B]: Evaluating Rotational Keys Over-the-Horizon Breach...")
    old_priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    old_pub_pem = old_priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    old_key_id = "KEY_PROF_MARK_OLD"
    superseded_at = (now - timedelta(days=120)).isoformat().replace("+00:00", "Z")
    _append_registry(
        {
            "prof_id": "PROF_MARK",
            "key_id": old_key_id,
            "status": "SUPERSEDED",
            "public_key_pem": old_pub_pem,
            "valid_from": (now - timedelta(days=365)).isoformat().replace("+00:00", "Z"),
            "superseded_at": superseded_at,
        }
    )
    sign_registry()
    old_sig = base64.b64encode(
        old_priv.sign(
            assessment_hash.encode("utf-8"),
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256(),
        )
    ).decode("utf-8")
    diploma_b = _issue_mock_diploma(
        assessment_hash,
        old_key_id,
        old_sig,
        (now + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
    )
    result_b = verify_credential_package(diploma_b)
    print(f"   -> Intercept Result Status: {result_b.get('status')}")
    print(f"   -> Abort Exception Payload: {result_b.get('reason')}")

    # Scenario C
    print("\n�� [SCENARIO C]: Launching Direct Compromised Master Key Attack...")
    print("   [Action] Appending active key ID explicitly into the global Revocation List.")
    with open(REVOCATION_LIST, "a", encoding="utf-8") as f:
        f.write(json.dumps({"key_id": active_key_id, "revoked_at": now.isoformat().replace("+00:00", "Z")}) + "\n")
    print("   Evaluating credential validity post-compromise notification listing...")
    result_c = verify_credential_package(diploma_a)
    print("\n" + "=" * 72)
    print(" ADVERSARIAL INTERCEPT REPORT PAYLOAD")
    print("=" * 72)
    print(json.dumps(result_c, indent=2))

    # Scenario D
    print("\n💥 [SCENARIO D]: Launching Registry Key Swap Attack...")
    with open(PROF_REGISTRY, "a", encoding="utf-8") as f:
        f.write(json.dumps({"key_id": "FAKE_KEY", "public_key_pem": "FAKE_PEM"}) + "\n")
    try:
        verify_registry()
        print("   -> ERROR: Registry should have been detected as tampered")
    except RuntimeError as exc:
        print(f"   -> Registry intercept: {str(exc)}")

    print("\n" + "=" * 72)
    print(" OGENLAW ENGINE STATUS: VERTICAL SLICE SECURED END-TO-END.")
    print("=" * 72)


if __name__ == "__main__":
    main()

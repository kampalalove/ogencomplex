import base64
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from registry_keys import verify_registry

BASE_DIR = Path(__file__).parent
PROF_REGISTRY = BASE_DIR / "registry" / "professor_registry.jsonl"
REVOCATION_LIST = BASE_DIR / "registry" / "revocation_list.jsonl"


def _load_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _find_registry_key(key_id: str) -> Optional[Dict[str, Any]]:
    entries = _load_jsonl(PROF_REGISTRY)
    for entry in reversed(entries):
        if entry.get("key_id") == key_id:
            return entry
    return None


def _is_revoked(key_id: str) -> bool:
    for entry in _load_jsonl(REVOCATION_LIST):
        if entry.get("key_id") == key_id:
            return True
    return False


def verify_credential_package(credential: Dict[str, Any]) -> Dict[str, str]:
    try:
        verify_registry()
    except RuntimeError as exc:
        return {"status": "FAIL", "reason": f"REGISTRY_INVALID: {str(exc)}"}

    metadata = credential.get("metadata", {})
    sig_block = credential.get("signature_block", {})
    assessment_hash = metadata.get("assessment_hash")
    key_id = sig_block.get("key_id")
    signature_b64 = sig_block.get("signature")
    signed_at = _parse_iso(sig_block.get("signed_at"))

    if not assessment_hash or not key_id or not signature_b64:
        return {"status": "FAIL", "reason": "FAIL_MALFORMED_CREDENTIAL"}

    if _is_revoked(key_id):
        return {"status": "FAIL", "reason": "FAIL_KEY_REVOKED"}

    key_entry = _find_registry_key(key_id)
    if not key_entry:
        return {"status": "FAIL", "reason": "FAIL_SIGNATURE_INVALID"}

    if key_entry.get("status") == "SUPERSEDED":
        superseded_at = _parse_iso(key_entry.get("superseded_at"))
        if superseded_at and signed_at and signed_at > superseded_at:
            return {"status": "FAIL", "reason": "FAIL_KEY_INVALID_POST_SUPERSEDED"}

    try:
        public_key = serialization.load_pem_public_key(key_entry["public_key_pem"].encode("utf-8"))
        signature = base64.b64decode(signature_b64)
        public_key.verify(
            signature,
            assessment_hash.encode("utf-8"),
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256(),
        )
    except Exception:
        return {"status": "FAIL", "reason": "FAIL_SIGNATURE_INVALID"}

    return {"status": "VALID", "reason": "VALID_ENFORCEABLE"}


def main(argv: List[str]) -> int:
    if len(argv) != 2:
        print("Usage: python employer_cli.py <diploma.json>")
        return 1

    diploma_path = Path(argv[1])
    if not diploma_path.exists():
        print(json.dumps({"status": "FAIL", "reason": "FILE_NOT_FOUND"}, indent=2))
        return 1

    credential = json.loads(diploma_path.read_text(encoding="utf-8"))
    result = verify_credential_package(credential)
    print(json.dumps(result, indent=2))
    return 0 if result.get("status") == "VALID" else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

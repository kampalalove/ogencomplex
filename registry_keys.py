import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

BASE_DIR = Path(__file__).parent
REGISTRY_DIR = BASE_DIR / "registry"
KEYS_DIR = BASE_DIR / "keys"
REGISTRY_FILE = REGISTRY_DIR / "professor_registry.jsonl"
SIG_FILE = REGISTRY_DIR / "registry.sig"


def _ensure_dirs() -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    KEYS_DIR.mkdir(parents=True, exist_ok=True)


def generate_root_keys() -> None:
    """Generate three root key pairs when absent."""
    _ensure_dirs()
    for i in range(1, 4):
        priv_path = KEYS_DIR / f"root_{i}_priv.pem"
        pub_path = KEYS_DIR / f"root_{i}_pub.pem"
        if priv_path.exists() and pub_path.exists():
            continue
        priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        priv_pem = priv.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        pub_pem = priv.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        priv_path.write_bytes(priv_pem)
        pub_path.write_bytes(pub_pem)


def load_root_public_keys():
    _ensure_dirs()
    generate_root_keys()
    pubs = []
    for i in range(1, 4):
        pub_pem = (KEYS_DIR / f"root_{i}_pub.pem").read_bytes()
        pubs.append(serialization.load_pem_public_key(pub_pem))
    return pubs


def _sign_hash_hex(private_key, hash_hex: str) -> str:
    sig = private_key.sign(
        hash_hex.encode("utf-8"),
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return sig.hex()


def sign_registry() -> None:
    """2-of-3 policy: root_1 and root_2 sign the registry hash."""
    _ensure_dirs()
    generate_root_keys()
    if not REGISTRY_FILE.exists():
        return

    registry_bytes = REGISTRY_FILE.read_bytes()
    registry_hash = hashlib.sha256(registry_bytes).hexdigest()

    priv1 = serialization.load_pem_private_key((KEYS_DIR / "root_1_priv.pem").read_bytes(), None)
    priv2 = serialization.load_pem_private_key((KEYS_DIR / "root_2_priv.pem").read_bytes(), None)

    payload = {
        "hash": registry_hash,
        "signers": ["root_1", "root_2"],
        "sigs": [
            _sign_hash_hex(priv1, registry_hash),
            _sign_hash_hex(priv2, registry_hash),
        ],
    }
    SIG_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def verify_registry() -> None:
    """Raises RuntimeError on tamper or insufficient valid signatures."""
    _ensure_dirs()
    if not REGISTRY_FILE.exists() or not SIG_FILE.exists():
        return

    current_hash = hashlib.sha256(REGISTRY_FILE.read_bytes()).hexdigest()
    sig_data = json.loads(SIG_FILE.read_text(encoding="utf-8"))
    if sig_data.get("hash") != current_hash:
        raise RuntimeError("REGISTRY_TAMPERED")

    sigs = sig_data.get("sigs", [])
    if len(sigs) < 2:
        raise RuntimeError("INSUFFICIENT_ROOT_SIGS")

    root_pubs = load_root_public_keys()
    valid = 0
    for idx, sig_hex in enumerate(sigs[:3]):
        if idx >= len(root_pubs):
            break
        try:
            root_pubs[idx].verify(
                bytes.fromhex(sig_hex),
                current_hash.encode("utf-8"),
                padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
                hashes.SHA256(),
            )
            valid += 1
        except Exception:
            continue

    if valid < 2:
        raise RuntimeError("INSUFFICIENT_ROOT_SIGS")

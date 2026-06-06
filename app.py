import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from registry_keys import sign_registry, verify_registry

BASE_DIR = Path(__file__).parent
REGISTRY_DIR = BASE_DIR / "registry"
ASSESSMENT_DIR = BASE_DIR / "assessment_definitions"
KEYS_DIR = BASE_DIR / "keys"

EVIDENCE_VAULT = REGISTRY_DIR / "evidence_vault.jsonl"
AUDIT_LOG = REGISTRY_DIR / "audit_chain.jsonl"
PROF_REGISTRY = REGISTRY_DIR / "professor_registry.jsonl"
REVOCATION_LIST = REGISTRY_DIR / "revocation_list.jsonl"
ASSESSMENT_FILE = ASSESSMENT_DIR / "contracts_v1_2_0.json"

app = FastAPI(title="Ogenlaw Trust Runtime", version="1.0.0")


class ClaimedFact(BaseModel):
    key: str
    value: Any
    span: Optional[List[int]] = None


class EvidenceRequest(BaseModel):
    doc_type: str
    content_b64: str
    claimed_facts: List[ClaimedFact]


class ExecuteFact(BaseModel):
    key: str
    evidence_hash: str


class ExecuteRequest(BaseModel):
    agent_type: str
    assessment_version: str
    facts: List[ExecuteFact]


class IssueRequest(BaseModel):
    assessment_hash: str
    prof_id: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, sort_keys=True) + "\n")


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


def _ensure_professor_key(prof_id: str = "PROF_MARK") -> str:
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    priv_path = KEYS_DIR / f"prof_{prof_id}_priv.pem"
    pub_path = KEYS_DIR / f"prof_{prof_id}_pub.pem"

    if not priv_path.exists() or not pub_path.exists():
        priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        priv_path.write_bytes(
            priv.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        pub_path.write_bytes(
            priv.public_key().public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
        )

    key_id = f"KEY_{prof_id}_ACTIVE"
    existing = _load_jsonl(PROF_REGISTRY)
    if not any(r.get("key_id") == key_id and r.get("status") == "ACTIVE" for r in existing):
        _append_jsonl(
            PROF_REGISTRY,
            {
                "prof_id": prof_id,
                "key_id": key_id,
                "status": "ACTIVE",
                "public_key_pem": pub_path.read_text(encoding="utf-8"),
                "valid_from": _utc_now(),
            },
        )
    return key_id


def _ensure_bootstrap() -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    ASSESSMENT_DIR.mkdir(parents=True, exist_ok=True)
    KEYS_DIR.mkdir(parents=True, exist_ok=True)

    for file_path in [EVIDENCE_VAULT, AUDIT_LOG, PROF_REGISTRY, REVOCATION_LIST]:
        file_path.touch(exist_ok=True)

    if not ASSESSMENT_FILE.exists():
        ASSESSMENT_FILE.write_text(
            json.dumps(
                {
                    "version": "ogenlaw_contracts_v1.2.0",
                    "agent_type": "contract_formation",
                    "required_facts": ["offer", "acceptance", "consideration", "defenses"],
                    "rubric": {
                        "valid": "offer and acceptance and consideration > 0 and len(defenses)==0",
                        "review": "missing required facts",
                    },
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    _ensure_professor_key("PROF_MARK")
    sign_registry()


@app.on_event("startup")
def startup_event() -> None:
    _ensure_bootstrap()


def _hash_json(payload: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _extract_fact_values(facts: List[ExecuteFact]) -> Dict[str, Any]:
    evidence_rows = _load_jsonl(EVIDENCE_VAULT)
    by_hash = {r.get("evidence_hash"): r for r in evidence_rows}
    out: Dict[str, Any] = {}
    for fact in facts:
        row = by_hash.get(fact.evidence_hash)
        if row:
            for claimed in row.get("claimed_facts", []):
                if claimed.get("key") == fact.key:
                    out[fact.key] = claimed.get("value")
    return out


def _evaluate_contract(values: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    missing = [k for k in required if k not in values]
    if missing:
        return {"verdict": "REVIEW_REQUIRED", "ambiguity_score": 1.0, "missing": missing}

    offer = bool(values.get("offer"))
    acceptance = bool(values.get("acceptance"))
    consideration = float(values.get("consideration", 0) or 0)
    defenses = values.get("defenses") or []
    valid = offer and acceptance and consideration > 0 and len(defenses) == 0
    return {
        "verdict": "VALID_ENFORCEABLE" if valid else "UNENFORCEABLE",
        "ambiguity_score": 0.0 if valid else 0.4,
    }


def audit_hash_exists(audit_hash: str) -> bool:
    return any(entry.get("hash") == audit_hash for entry in _load_jsonl(AUDIT_LOG))


def build_credential_from_audit(audit_hash: str) -> Dict[str, Any]:
    for entry in _load_jsonl(AUDIT_LOG):
        if entry.get("hash") != audit_hash:
            continue
        result = entry.get("payload", {}).get("result", {})
        return {
            "metadata": {
                "assessment_version": result.get("assessment_version"),
                "assessment_definition_hash": result.get("assessment_definition_hash"),
                "rubric_hash": result.get("rubric_hash"),
                "assessment_hash": audit_hash,
            },
            "adjudication": {
                "verdict": result.get("verdict"),
                "ambiguity_score": result.get("ambiguity_score"),
            },
        }
    raise ValueError("Audit hash not found")


def sign_with_professor_private_key(message: bytes, prof_id: str) -> str:
    key_path = KEYS_DIR / f"prof_{prof_id}_priv.pem"
    if not key_path.exists():
        raise FileNotFoundError(f"Private key for {prof_id} not found")
    priv_key = serialization.load_pem_private_key(key_path.read_bytes(), None)
    signature = priv_key.sign(
        message,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


@app.post("/v1/evidence", status_code=201)
async def ingest_evidence(req: EvidenceRequest):
    try:
        content_raw = base64.b64decode(req.content_b64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 content") from exc

    if not req.claimed_facts:
        raise HTTPException(status_code=400, detail="QUARANTINE_EVIDENCE")

    evidence_hash = hashlib.sha256(content_raw).hexdigest()
    payload = {
        "doc_type": req.doc_type,
        "claimed_facts": [f.model_dump() for f in req.claimed_facts],
        "content_sha256": evidence_hash,
        "evidence_hash": evidence_hash,
        "ingested_at": _utc_now(),
    }
    _append_jsonl(EVIDENCE_VAULT, payload)
    return {"status": "OK", "evidence_hash": evidence_hash}


@app.post("/v1/execute", status_code=201)
async def execute_assessment(req: ExecuteRequest):
    if req.agent_type != "contract_formation":
        raise HTTPException(status_code=400, detail="QUARANTINE_CHAIN")

    definition = json.loads(ASSESSMENT_FILE.read_text(encoding="utf-8"))
    if req.assessment_version != definition["version"]:
        raise HTTPException(status_code=400, detail="Assessment version mismatch")

    extracted_values = _extract_fact_values(req.facts)
    assessment = _evaluate_contract(extracted_values, definition["required_facts"])

    result = {
        "assessment_version": definition["version"],
        "assessment_definition_hash": hashlib.sha256(
            ASSESSMENT_FILE.read_text(encoding="utf-8").encode("utf-8")
        ).hexdigest(),
        "rubric_hash": hashlib.sha256(json.dumps(definition["rubric"], sort_keys=True).encode("utf-8")).hexdigest(),
        **assessment,
    }
    audit_entry = {"timestamp": _utc_now(), "payload": {"request": req.model_dump(), "result": result}}
    audit_entry["hash"] = _hash_json(audit_entry["payload"])
    _append_jsonl(AUDIT_LOG, audit_entry)

    return {"status": "OK", **result, "assessment_hash": audit_entry["hash"]}


@app.post("/v1/issue", status_code=201)
async def issue_diploma(req: IssueRequest):
    try:
        verify_registry()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=f"Registry invalid: {str(exc)}") from exc

    if not audit_hash_exists(req.assessment_hash):
        raise HTTPException(status_code=400, detail="assessment_hash not found in audit chain")

    try:
        cred = build_credential_from_audit(req.assessment_hash)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Failed to rebuild credential") from exc

    try:
        signature = sign_with_professor_private_key(req.assessment_hash.encode("utf-8"), req.prof_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=403, detail=f"Professor key not available for {req.prof_id}") from exc

    diploma = {
        "metadata": cred["metadata"],
        "adjudication": cred["adjudication"],
        "signature_block": {
            "key_id": f"KEY_{req.prof_id}_ACTIVE",
            "signed_at": _utc_now(),
            "signature": signature,
        },
    }
    diploma_hash = hashlib.sha256(json.dumps(diploma, sort_keys=True).encode("utf-8")).hexdigest()
    return JSONResponse(content=diploma, headers={"X-Diploma-Hash": diploma_hash})

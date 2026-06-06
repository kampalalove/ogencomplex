const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OPS_REGISTRY_RELATIVE_PATH = 'ops/registry.json';
const OPS_MANIFEST_RELATIVE_PATH = 'ops/manifests/ops_manifest.json';
const OPS_AUDIT_LOG_RELATIVE_PATH = 'ops/audit/mission_audit.log';

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashCanonical(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadOpsRegistry(repoRoot) {
  return loadJson(path.join(repoRoot, OPS_REGISTRY_RELATIVE_PATH));
}

function listMissionTemplates(repoRoot) {
  const registry = loadOpsRegistry(repoRoot);
  const templates = Array.isArray(registry.templates) ? registry.templates : [];

  return templates.map((entry) => {
    const templatePath = path.join(repoRoot, entry.path);
    const body = loadJson(templatePath);
    return {
      id: entry.id,
      version: entry.version,
      path: entry.path,
      body,
    };
  });
}

function getMissionTemplate(repoRoot, templateId) {
  const template = listMissionTemplates(repoRoot).find((entry) => entry.id === templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }
  return template;
}

function buildOpsManifest(repoRoot, generatedAt = new Date().toISOString()) {
  const registry = loadOpsRegistry(repoRoot);
  const templates = listMissionTemplates(repoRoot);

  const entries = templates
    .map((template) => ({
      id: template.id,
      version: template.version,
      path: template.path,
      sha256: hashCanonical(template.body),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const manifest = {
    schemaVersion: 'ogen.ops.manifest.v1',
    generatedAt,
    airGapped: true,
    executionMode: 'local-only',
    registryHash: hashCanonical(registry),
    templates: entries,
  };

  manifest.manifestHash = hashCanonical({
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    airGapped: manifest.airGapped,
    executionMode: manifest.executionMode,
    registryHash: manifest.registryHash,
    templates: manifest.templates,
  });

  return manifest;
}

function writeOpsManifest(repoRoot, manifest) {
  const outputPath = path.join(repoRoot, OPS_MANIFEST_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return outputPath;
}

function createMissionRecord({
  template,
  vehicleId,
  operatorId,
  missionId,
  now = () => Date.now(),
}) {
  const parsedVehicleId = Math.max(0, Math.floor(Number(vehicleId) || 0));
  const missionRecord = {
    missionId: missionId || `ops-${Math.floor(now())}`,
    templateId: template.id,
    templateVersion: template.version,
    vehicleId: parsedVehicleId,
    operatorId,
    executionMode: 'local-only',
    airGapped: true,
    startedAtUs: Math.floor(now() * 1000),
    timeoutSeconds: Math.max(1, Number(template.body.timeoutSeconds || 1)),
    dwellMs: Math.max(0, Number(template.body.dwellMs || 0)),
    waypoints: Array.isArray(template.body.waypoints) ? template.body.waypoints : [],
    objective: String(template.body.objective || ''),
  };

  if (missionRecord.waypoints.length < 2) {
    throw new Error('Mission template must contain at least two waypoints.');
  }

  if (!operatorId) {
    throw new Error('operatorId is required');
  }

  return missionRecord;
}

function signAuditEntry(missionRecord, signingKey) {
  const key = String(signingKey || 'OGEN-OPS-LOCAL-KEY');
  const payload = {
    missionRecord,
    signer: 'ops.local',
    algorithm: 'hmac-sha256',
  };
  const signature = crypto
    .createHmac('sha256', key)
    .update(stableStringify(payload))
    .digest('hex');

  return {
    ...payload,
    signature,
  };
}

function verifyAuditEntry(entry, signingKey) {
  const key = String(signingKey || 'OGEN-OPS-LOCAL-KEY');
  const payload = {
    missionRecord: entry.missionRecord,
    signer: entry.signer,
    algorithm: entry.algorithm,
  };

  const expected = crypto
    .createHmac('sha256', key)
    .update(stableStringify(payload))
    .digest('hex');

  return expected === entry.signature;
}

function appendAuditEntry(repoRoot, entry) {
  const logPath = path.join(repoRoot, OPS_AUDIT_LOG_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  return logPath;
}

function readAuditEntries(repoRoot, overridePath = null) {
  const logPath = overridePath || path.join(repoRoot, OPS_AUDIT_LOG_RELATIVE_PATH);
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

module.exports = {
  OPS_AUDIT_LOG_RELATIVE_PATH,
  OPS_MANIFEST_RELATIVE_PATH,
  OPS_REGISTRY_RELATIVE_PATH,
  appendAuditEntry,
  buildOpsManifest,
  createMissionRecord,
  getMissionTemplate,
  hashCanonical,
  listMissionTemplates,
  loadOpsRegistry,
  readAuditEntries,
  signAuditEntry,
  stableStringify,
  verifyAuditEntry,
  writeOpsManifest,
};

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  buildOpsManifest,
  createMissionRecord,
  getMissionTemplate,
  signAuditEntry,
  verifyAuditEntry,
  listMissionTemplates,
} = require('../ops_core');

const FIXTURE_DIR = path.join(__dirname, 'ops_evidence');
const INPUT_PATH = path.join(FIXTURE_DIR, 'inputs', 'test_cases.json');
const EXPECTED_PATH = path.join(FIXTURE_DIR, 'expected_outcomes.json');
const RESULTS_PATH = path.join(FIXTURE_DIR, 'results.json');
const LOG_PATH = path.join(FIXTURE_DIR, 'logs', 'deterministic.log');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runDeterministicOpsEvidence() {
  const inputs = loadJson(INPUT_PATH);
  const expected = loadJson(EXPECTED_PATH);
  const repoRoot = path.join(__dirname, '..');

  const logLines = [];
  const results = [];

  function runCase(name, fn) {
    try {
      const details = fn();
      results.push({ name, pass: true, details });
      logLines.push(`[PASS] ${name} :: ${JSON.stringify(details)}`);
    } catch (error) {
      results.push({ name, pass: false, details: { message: error.message } });
      logLines.push(`[FAIL] ${name} :: ${error.message}`);
      throw error;
    }
  }

  runCase('ops_template_registry', () => {
    const templates = listMissionTemplates(repoRoot);
    assert.strictEqual(templates.length, expected.template_count);
    assert.strictEqual(templates[0].id, expected.template_id);
    return {
      templateCount: templates.length,
      templateId: templates[0].id,
    };
  });

  runCase('ops_manifest_hash', () => {
    const manifest = buildOpsManifest(repoRoot, '2026-01-01T00:00:00.000Z');
    assert.strictEqual(manifest.manifestHash, expected.manifest_hash);
    return {
      manifestHash: manifest.manifestHash,
      templateCount: manifest.templates.length,
    };
  });

  runCase('ops_audit_signature', () => {
    const template = getMissionTemplate(repoRoot, inputs.template_id);
    const missionRecord = createMissionRecord({
      template,
      vehicleId: inputs.vehicle_id,
      operatorId: inputs.operator_id,
      missionId: inputs.mission_id,
      now: () => inputs.clock_ms,
    });
    const entry = signAuditEntry(missionRecord, inputs.signing_key);
    assert.strictEqual(entry.signature, expected.audit_signature);
    assert.strictEqual(verifyAuditEntry(entry, inputs.signing_key), true);
    return {
      signature: entry.signature,
      missionId: missionRecord.missionId,
    };
  });

  runCase('ops_audit_tamper_detect', () => {
    const template = getMissionTemplate(repoRoot, inputs.template_id);
    const missionRecord = createMissionRecord({
      template,
      vehicleId: inputs.vehicle_id,
      operatorId: inputs.operator_id,
      missionId: inputs.mission_id,
      now: () => inputs.clock_ms,
    });
    const entry = signAuditEntry(missionRecord, inputs.signing_key);
    const tampered = {
      ...entry,
      missionRecord: {
        ...entry.missionRecord,
        vehicleId: entry.missionRecord.vehicleId + 1,
      },
    };

    const valid = verifyAuditEntry(tampered, inputs.signing_key);
    assert.strictEqual(valid, expected.tampered_valid);
    return { valid };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    deterministicSeed: 'OGEN-OPS-1.0',
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
    results,
  };

  return { summary, logLines };
}

function writeBundle(summary, logLines) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(LOG_PATH, `${logLines.join('\n')}\n`);
}

function main() {
  try {
    const { summary, logLines } = runDeterministicOpsEvidence();
    if (process.argv.includes('--write-bundle')) {
      writeBundle(summary, logLines);
    }

    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error('[OPS DETERMINISTIC EVIDENCE] Execution failed:', error.message);
    process.exitCode = 1;
  }
}

main();

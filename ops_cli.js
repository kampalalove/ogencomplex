#!/usr/bin/env node

const path = require('path');
const {
  appendAuditEntry,
  buildOpsManifest,
  createMissionRecord,
  getMissionTemplate,
  listMissionTemplates,
  readAuditEntries,
  signAuditEntry,
  verifyAuditEntry,
  writeOpsManifest,
} = require('./ops_core');

function readFlag(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function usage() {
  console.log([
    'OGEN OPS CLI',
    'Commands:',
    '  template:list',
    '  template:show --template <id>',
    '  manifest:build',
    '  mission:start --template <id> --vehicle <id> --operator <operator> [--key <hmacKey>] [--mission <id>]',
    '  audit:verify [--key <hmacKey>] [--log <absolutePath>]',
  ].join('\n'));
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const repoRoot = path.resolve(__dirname);

  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'template:list') {
    const templates = listMissionTemplates(repoRoot).map(({ id, version, path: relPath }) => ({
      id,
      version,
      path: relPath,
    }));
    console.log(JSON.stringify({ templates }, null, 2));
    return;
  }

  if (command === 'template:show') {
    const templateId = readFlag(args, '--template');
    if (!templateId) throw new Error('--template is required');
    const template = getMissionTemplate(repoRoot, templateId);
    console.log(JSON.stringify(template, null, 2));
    return;
  }

  if (command === 'manifest:build') {
    const manifest = buildOpsManifest(repoRoot);
    const writtenPath = writeOpsManifest(repoRoot, manifest);
    console.log(JSON.stringify({ path: writtenPath, manifestHash: manifest.manifestHash }, null, 2));
    return;
  }

  if (command === 'mission:start') {
    const templateId = readFlag(args, '--template');
    const vehicleId = readFlag(args, '--vehicle', '0');
    const operatorId = readFlag(args, '--operator');
    const missionId = readFlag(args, '--mission');
    const key = readFlag(args, '--key', 'OGEN-OPS-LOCAL-KEY');

    if (!templateId) throw new Error('--template is required');

    const template = getMissionTemplate(repoRoot, templateId);
    const missionRecord = createMissionRecord({
      template,
      vehicleId,
      operatorId,
      missionId,
    });
    const entry = signAuditEntry(missionRecord, key);
    const logPath = appendAuditEntry(repoRoot, entry);

    console.log(JSON.stringify({
      missionId: missionRecord.missionId,
      templateId: missionRecord.templateId,
      vehicleId: missionRecord.vehicleId,
      executionMode: missionRecord.executionMode,
      auditLog: logPath,
      signature: entry.signature,
    }, null, 2));
    return;
  }

  if (command === 'audit:verify') {
    const key = readFlag(args, '--key', 'OGEN-OPS-LOCAL-KEY');
    const logPath = readFlag(args, '--log');
    const entries = readAuditEntries(repoRoot, logPath || null);
    const verification = entries.map((entry) => ({
      missionId: entry?.missionRecord?.missionId,
      valid: verifyAuditEntry(entry, key),
    }));

    const invalid = verification.filter((item) => !item.valid).length;
    console.log(JSON.stringify({
      total: verification.length,
      valid: verification.length - invalid,
      invalid,
      verification,
    }, null, 2));
    if (invalid > 0) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(`[OPS CLI] ${error.message}`);
  process.exitCode = 1;
}

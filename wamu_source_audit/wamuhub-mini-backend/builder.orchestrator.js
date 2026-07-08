#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const [,, blueprintPath, flag] = process.argv;
const dryRun = flag === '--dry-run';

if (!blueprintPath || !fs.existsSync(blueprintPath)) {
  console.error('Usage: node builder.orchestrator.js <blueprint.json> [--dry-run]');
  process.exit(1);
}

const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
const seqPath = 'builder.sequence.json';
const sequence = fs.existsSync(seqPath) ? JSON.parse(fs.readFileSync(seqPath, 'utf8')) : { steps: [] };

console.log(`Loaded blueprint: ${blueprint.feature || 'unnamed'}`);
console.log(`Dry run: ${dryRun}`);

for (const step of sequence.steps || []) {
  console.log(`\n→ ${step.name || step.cmd}`);
  if (dryRun) {
    console.log(`  would run: ${step.cmd}`);
    continue;
  }
  const [cmd, ...args] = step.cmd.split(' ');
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    console.error(`Step failed: ${step.cmd}`);
    process.exit(res.status || 1);
  }
}

console.log('\nDone.');
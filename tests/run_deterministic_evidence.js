const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  MISSION_STATE,
  getFeatureFlags,
  validateTrajectoryCommand,
  validateVoxelDeltaChunk,
  createMissionController,
} = require('../bridge_core');

const FIXTURE_DIR = path.join(__dirname, 'evidence');
const INPUT_PATH = path.join(FIXTURE_DIR, 'inputs', 'test_cases.json');
const EXPECTED_PATH = path.join(FIXTURE_DIR, 'expected_outcomes.json');
const RESULTS_PATH = path.join(FIXTURE_DIR, 'results.json');
const LOG_PATH = path.join(FIXTURE_DIR, 'logs', 'deterministic.log');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runDeterministicEvidence() {
  const inputs = loadJson(INPUT_PATH);
  const expected = loadJson(EXPECTED_PATH);
  const flags = getFeatureFlags('v1.1');

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

  runCase('trajectory_clamp', () => {
    const verdict = validateTrajectoryCommand(inputs.trajectory, flags, 0);
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.normalized.maxVelocity, expected.clamped_max_velocity);
    assert.strictEqual(verdict.normalized.maxAcceleration, expected.clamped_max_acceleration);
    return {
      maxVelocity: verdict.normalized.maxVelocity,
      maxAcceleration: verdict.normalized.maxAcceleration,
      vehicleId: verdict.normalized.vehicleId,
    };
  });

  runCase('trajectory_bounds_reject', () => {
    const verdict = validateTrajectoryCommand(inputs.trajectory_out_of_bounds, flags, 0);
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.reason, expected.trajectory_reject_reason);
    return { reason: verdict.reason };
  });

  runCase('semantic_voxel_validation', () => {
    const verdict = validateVoxelDeltaChunk(inputs.voxel_chunk, flags, 0);
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.normalized.voxels.length, expected.voxel_filtered_count);
    const last = verdict.normalized.voxels[1];
    assert.strictEqual(last.anomalyClass, expected.voxel_normalized_last_anomaly_class);
    assert.strictEqual(last.anomalySeverity, expected.voxel_normalized_last_anomaly_severity);
    return {
      voxelCount: verdict.normalized.voxels.length,
      lastVoxel: last,
    };
  });

  runCase('mission_timeout_failsafe', () => {
    let clock = 1700000000000;
    const controller = createMissionController({ now: () => clock, timeoutGraceMs: 0 });

    const start = controller.applyMissionCommand(inputs.patrol_start);
    assert.strictEqual(start.missionState, expected.mission_start_state);

    clock += 3000;
    const updates = controller.tick();
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].missionState, expected.mission_timeout_state);
    assert.strictEqual(updates[0].missionReason, expected.mission_timeout_reason);
    assert.strictEqual(updates[0].missionState, MISSION_STATE.FAILSAFE_TIMEOUT);

    return updates[0];
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    deterministicSeed: 'OGEN-ASCS-1.1',
    profile: flags.protocolProfile,
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
    const { summary, logLines } = runDeterministicEvidence();
    if (process.argv.includes('--write-bundle')) {
      writeBundle(summary, logLines);
    }

    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error('[DETERMINISTIC EVIDENCE] Execution failed:', error.message);
    process.exitCode = 1;
  }
}

main();

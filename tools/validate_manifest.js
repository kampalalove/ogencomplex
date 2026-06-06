const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  assert(manifest.id === 'ogen-core-runtime', 'manifest.id must be ogen-core-runtime');
  assert(manifest.version, 'manifest.version is required');
  assert(manifest.dependencies?.mesh_compatible === true, 'mesh compatibility must be enabled');

  const expansions = manifest.expansions || {};
  ['ascs_2_0', 'ops_1_0', 'sim_1_0', 'ai_1_0'].forEach((key) => {
    assert(Boolean(expansions[key]), `missing expansions.${key}`);
  });

  assert(expansions.ascs_2_0.broadcast_port === 10001, 'ASCS broadcast_port mismatch');
  assert(expansions.sim_1_0.synthetic_imu_port === 11001, 'SIM IMU port mismatch');
  assert(expansions.sim_1_0.synthetic_lidar_port === 11002, 'SIM LiDAR port mismatch');
  assert(expansions.ops_1_0.audit_log_path === 'logs/audit/ops_telemetry.log', 'OPS audit path mismatch');
  assert(expansions.ai_1_0.compute_provider === 'cuda_tensorrt', 'AI provider mismatch');

  assert(manifest.execution?.env?.OGEN_SOVEREIGN_MODE === '1', 'OGEN_SOVEREIGN_MODE must be 1');

  console.log(JSON.stringify({
    status: 'ok',
    manifestId: manifest.id,
    version: manifest.version,
    expansions: Object.keys(expansions),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`[MANIFEST VALIDATION] ${error.message}`);
  process.exitCode = 1;
}

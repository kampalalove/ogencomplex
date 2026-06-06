const BOUNDS = {
  MAX_X: 500.0,
  MIN_X: -500.0,
  MAX_Y: 500.0,
  MIN_Y: -500.0,
  MAX_Z: 120.0,
  MIN_Z: 0.0,
  ABS_MAX_VEL: 12.0,
  ABS_MAX_ACC: 5.0,
};

const PROTOCOL_PROFILE_STABLE = 'v1.0.1';
const PROTOCOL_PROFILE_V11 = 'v1.1';

const PATROL_ACTION = {
  START_LOOP: 1,
  DWELL: 2,
  RESUME: 3,
  ABORT: 4,
  RETURN_TO_HOME: 5,
};

const MISSION_STATE = {
  IDLE: 0,
  LOOPING: 1,
  DWELLING: 2,
  PAUSED: 3,
  ABORTED: 4,
  RETURNING_HOME: 5,
  COMPLETE: 6,
  FAILSAFE_TIMEOUT: 7,
};

const ANOMALY_CLASS = {
  NONE: 0,
  PIPE: 1,
  VALVE: 2,
  TANK: 3,
  CRACK: 4,
  LEAK: 5,
  THERMAL: 6,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function extractNumber(decodedCommand, camelKey, snakeKey) {
  const value = decodedCommand?.[camelKey] ?? decodedCommand?.[snakeKey] ?? 0;
  return Number(value);
}

function extractString(decodedCommand, camelKey, snakeKey, fallback = '') {
  const value = decodedCommand?.[camelKey] ?? decodedCommand?.[snakeKey] ?? fallback;
  return typeof value === 'string' ? value : fallback;
}

function normalizeProtocolProfile(profileRaw) {
  return profileRaw === PROTOCOL_PROFILE_V11 ? PROTOCOL_PROFILE_V11 : PROTOCOL_PROFILE_STABLE;
}

function getFeatureFlags(profileRaw) {
  const profile = normalizeProtocolProfile(profileRaw);
  if (profile === PROTOCOL_PROFILE_V11) {
    return {
      protocolProfile: profile,
      protocolMinor: 1,
      multiDrone: true,
      patrolLoops: true,
      semanticVoxelV11: true,
    };
  }

  return {
    protocolProfile: profile,
    protocolMinor: 0,
    multiDrone: false,
    patrolLoops: false,
    semanticVoxelV11: false,
  };
}

function getProtocolMinor(message) {
  return Math.floor(extractNumber(message, 'protocolMinor', 'protocol_minor'));
}

function getVehicleId(message, fallbackVehicleId = 0) {
  const value = Math.floor(extractNumber(message, 'vehicleId', 'vehicle_id'));
  if (!Number.isFinite(value) || value < 0) return fallbackVehicleId;
  return value;
}

function validateTrajectoryCommand(decodedCommand, featureFlags, fallbackVehicleId = 0) {
  const targetX = extractNumber(decodedCommand, 'targetX', 'target_x');
  const targetY = extractNumber(decodedCommand, 'targetY', 'target_y');
  const targetZ = extractNumber(decodedCommand, 'targetZ', 'target_z');

  if (
    targetX > BOUNDS.MAX_X || targetX < BOUNDS.MIN_X
    || targetY > BOUNDS.MAX_Y || targetY < BOUNDS.MIN_Y
    || targetZ > BOUNDS.MAX_Z || targetZ < BOUNDS.MIN_Z
  ) {
    return { ok: false, reason: 'safety_bounds', normalized: null };
  }

  const protocolMinor = getProtocolMinor(decodedCommand);
  if (protocolMinor > featureFlags.protocolMinor) {
    return { ok: false, reason: 'unsupported_protocol_minor', normalized: null };
  }

  const maxVelocityRequested = extractNumber(decodedCommand, 'maxVelocity', 'max_velocity');
  const maxAccelerationRequested = extractNumber(decodedCommand, 'maxAcceleration', 'max_acceleration');

  const normalized = {
    timestampUs: extractNumber(decodedCommand, 'timestampUs', 'timestamp_us'),
    commandId: extractNumber(decodedCommand, 'commandId', 'command_id'),
    targetX,
    targetY,
    targetZ,
    targetYaw: extractNumber(decodedCommand, 'targetYaw', 'target_yaw'),
    maxVelocity: clamp(maxVelocityRequested, 0, BOUNDS.ABS_MAX_VEL),
    maxAcceleration: clamp(maxAccelerationRequested, 0, BOUNDS.ABS_MAX_ACC),
    protocolMinor: Math.min(protocolMinor, featureFlags.protocolMinor),
    vehicleId: featureFlags.multiDrone ? getVehicleId(decodedCommand, fallbackVehicleId) : 0,
    routeChannel: extractString(decodedCommand, 'routeChannel', 'route_channel', 'primary'),
  };

  return {
    ok: true,
    reason: null,
    clamped: maxVelocityRequested !== normalized.maxVelocity
      || maxAccelerationRequested !== normalized.maxAcceleration,
    normalized,
  };
}

function validateSemanticClass(semanticClass) {
  return Number.isFinite(semanticClass) && semanticClass >= 0 && semanticClass <= 6;
}

function validateSeverity(severity) {
  return Number.isFinite(severity) && severity >= 0 && severity <= 5;
}

function validateVoxelDeltaChunk(decodedChunk, featureFlags, fallbackVehicleId = 0) {
  const protocolMinor = getProtocolMinor(decodedChunk);
  if (protocolMinor > featureFlags.protocolMinor) {
    return { ok: false, reason: 'unsupported_protocol_minor', normalized: null };
  }

  const filteredVoxels = [];
  const voxels = decodedChunk?.voxels ?? [];

  for (const voxel of voxels) {
    const idxX = extractNumber(voxel, 'idxX', 'idx_x');
    const idxY = extractNumber(voxel, 'idxY', 'idx_y');
    const idxZ = extractNumber(voxel, 'idxZ', 'idx_z');
    const tsdfDistance = extractNumber(voxel, 'tsdfDistance', 'tsdf_distance');
    const semanticClass = Math.floor(extractNumber(voxel, 'semanticClass', 'semantic_class'));
    const anomalyClass = Math.floor(extractNumber(voxel, 'anomalyClass', 'anomaly_class'));
    const anomalySeverity = Math.floor(extractNumber(voxel, 'anomalySeverity', 'anomaly_severity'));

    if (![idxX, idxY, idxZ, tsdfDistance].every(Number.isFinite)) continue;
    if (!validateSemanticClass(semanticClass)) continue;

    const normalizedVoxel = {
      idxX,
      idxY,
      idxZ,
      tsdfDistance,
      semanticClass,
      anomalyClass: validateSemanticClass(anomalyClass) ? anomalyClass : ANOMALY_CLASS.NONE,
      anomalySeverity: validateSeverity(anomalySeverity) ? anomalySeverity : 0,
    };

    if (!featureFlags.semanticVoxelV11) {
      normalizedVoxel.anomalyClass = ANOMALY_CLASS.NONE;
      normalizedVoxel.anomalySeverity = 0;
    }

    filteredVoxels.push(normalizedVoxel);
  }

  return {
    ok: true,
    reason: null,
    normalized: {
      timestampUs: extractNumber(decodedChunk, 'timestampUs', 'timestamp_us'),
      chunkId: extractNumber(decodedChunk, 'chunkId', 'chunk_id'),
      protocolMinor: Math.min(protocolMinor, featureFlags.protocolMinor),
      vehicleId: featureFlags.multiDrone ? getVehicleId(decodedChunk, fallbackVehicleId) : 0,
      voxels: filteredVoxels,
    },
  };
}

function createMissionController({ now = () => Date.now(), timeoutGraceMs = 2000 } = {}) {
  const missionsByVehicle = new Map();

  function currentMission(vehicleId) {
    if (!missionsByVehicle.has(vehicleId)) {
      missionsByVehicle.set(vehicleId, {
        vehicleId,
        missionId: 0,
        state: MISSION_STATE.IDLE,
        waypoints: [],
        dwellMs: 0,
        timeoutAt: 0,
        lastUpdatedAt: now(),
      });
    }
    return missionsByVehicle.get(vehicleId);
  }

  function transition(vehicleId, missionId, state, reason) {
    const mission = currentMission(vehicleId);
    mission.missionId = missionId;
    mission.state = state;
    mission.lastUpdatedAt = now();
    return {
      vehicleId,
      missionId,
      missionState: state,
      missionReason: reason,
      timestampUs: Math.floor(now() * 1000),
    };
  }

  function applyMissionCommand(command) {
    const vehicleId = getVehicleId(command, 0);
    const missionId = Math.floor(extractNumber(command, 'missionId', 'mission_id'));
    const action = Math.floor(extractNumber(command, 'action', 'action'));
    const timeoutSeconds = Math.max(1, Math.floor(extractNumber(command, 'timeoutSeconds', 'timeout_seconds') || 1));
    const dwellMs = Math.max(0, Math.floor(extractNumber(command, 'dwellMs', 'dwell_ms') || 0));
    const waypoints = Array.isArray(command?.waypoints) ? command.waypoints : [];
    const mission = currentMission(vehicleId);

    mission.waypoints = waypoints;
    mission.dwellMs = dwellMs;
    mission.timeoutAt = now() + (timeoutSeconds * 1000) + timeoutGraceMs;

    if (action === PATROL_ACTION.START_LOOP) {
      if (waypoints.length < 2) {
        return transition(vehicleId, missionId, MISSION_STATE.FAILSAFE_TIMEOUT, 'invalid_waypoint_loop');
      }
      return transition(vehicleId, missionId, MISSION_STATE.LOOPING, 'start_loop');
    }

    if (action === PATROL_ACTION.DWELL) {
      return transition(vehicleId, missionId, MISSION_STATE.DWELLING, 'dwell');
    }

    if (action === PATROL_ACTION.RESUME) {
      return transition(vehicleId, missionId, MISSION_STATE.LOOPING, 'resume');
    }

    if (action === PATROL_ACTION.ABORT) {
      return transition(vehicleId, missionId, MISSION_STATE.ABORTED, 'abort');
    }

    if (action === PATROL_ACTION.RETURN_TO_HOME) {
      return transition(vehicleId, missionId, MISSION_STATE.RETURNING_HOME, 'return_home');
    }

    return transition(vehicleId, missionId, mission.state, 'no_op');
  }

  function tick() {
    const updates = [];
    const nowMs = now();

    for (const mission of missionsByVehicle.values()) {
      if (
        (mission.state === MISSION_STATE.LOOPING || mission.state === MISSION_STATE.DWELLING)
        && mission.timeoutAt > 0
        && nowMs >= mission.timeoutAt
      ) {
        mission.state = MISSION_STATE.FAILSAFE_TIMEOUT;
        mission.lastUpdatedAt = nowMs;
        updates.push({
          vehicleId: mission.vehicleId,
          missionId: mission.missionId,
          missionState: mission.state,
          missionReason: 'mission_timeout_failsafe',
          timestampUs: Math.floor(nowMs * 1000),
        });
      }
    }

    return updates;
  }

  function snapshot() {
    return Array.from(missionsByVehicle.values()).map((mission) => ({ ...mission }));
  }

  return {
    applyMissionCommand,
    tick,
    snapshot,
  };
}

module.exports = {
  ANOMALY_CLASS,
  BOUNDS,
  MISSION_STATE,
  PATROL_ACTION,
  PROTOCOL_PROFILE_STABLE,
  PROTOCOL_PROFILE_V11,
  clamp,
  createMissionController,
  extractNumber,
  getFeatureFlags,
  getProtocolMinor,
  getVehicleId,
  normalizeProtocolProfile,
  validateTrajectoryCommand,
  validateVoxelDeltaChunk,
};

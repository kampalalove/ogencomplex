const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const protobuf = require('protobufjs');
const path = require('path');

const {
  createMissionController,
  extractNumber,
  getFeatureFlags,
  getProtocolMinor,
  getVehicleId,
  validateTrajectoryCommand,
  validateVoxelDeltaChunk,
} = require('./bridge_core');

const UDP_INBOUND_PORT = 4242;
const UDP_OUTBOUND_PORT = 4243;
const DRONE_IP_ADDRESS = '127.0.0.1';
const WS_PORT = 8080;

const MAGIC_BYTE = 0x5f;
const HEADER_LENGTH = 4;
const MSG_TYPE_COMMAND = 0x01;
const MSG_TYPE_TELEMETRY = 0x02;
const MSG_TYPE_VOXEL_DELTA = 0x03;
const MSG_TYPE_PATROL_MISSION_COMMAND = 0x04;
const MSG_TYPE_MISSION_STATUS = 0x05;
const MSG_TYPE_FLEET_SNAPSHOT = 0x06;

const protocolProfile = process.env.OGEN_PROTOCOL_PROFILE;
const featureFlags = getFeatureFlags(protocolProfile);

const udpSocket = dgram.createSocket('udp4');
const wss = new WebSocketServer({ port: WS_PORT });

const activeUiClients = new Set();
const clientSessionState = new Map();
const telemetryByVehicle = new Map();

const missionController = createMissionController();

let protobufRoot = null;
let TrajectoryCommandType = null;
let TelemetryStreamType = null;
let VoxelDeltaChunkType = null;
let PatrolMissionCommandType = null;
let MissionStatusType = null;
let FleetSnapshotType = null;

try {
  protobufRoot = protobuf.loadSync(path.join(__dirname, 'ogen_protocol.proto'));
  TrajectoryCommandType = protobufRoot.lookupType('ogen.protocol.TrajectoryCommand');
  TelemetryStreamType = protobufRoot.lookupType('ogen.protocol.TelemetryStream');
  VoxelDeltaChunkType = protobufRoot.lookupType('ogen.protocol.VoxelDeltaChunk');
  PatrolMissionCommandType = protobufRoot.lookupType('ogen.protocol.PatrolMissionCommand');
  MissionStatusType = protobufRoot.lookupType('ogen.protocol.MissionStatus');
  FleetSnapshotType = protobufRoot.lookupType('ogen.protocol.FleetSnapshot');
  console.log(`[HARDENED BRIDGE] Protocol schema ready. Profile=${featureFlags.protocolProfile}`);
} catch (err) {
  console.error('[CRITICAL] Protocol schema validation failed to load.', err);
  process.exit(1);
}

function encodeFrame(typeId, payloadBuffer) {
  const frame = Buffer.alloc(HEADER_LENGTH + payloadBuffer.length);
  frame.writeUInt8(MAGIC_BYTE, 0);
  frame.writeUInt8(typeId, 1);
  frame.writeUInt16BE(payloadBuffer.length, 2);
  Buffer.from(payloadBuffer).copy(frame, HEADER_LENGTH);
  return frame;
}

function decodeFrame(bufferLike) {
  const buffer = Buffer.isBuffer(bufferLike)
    ? bufferLike
    : Buffer.from(bufferLike);

  if (buffer.length < HEADER_LENGTH) return null;
  if (buffer.readUInt8(0) !== MAGIC_BYTE) return null;

  const typeId = buffer.readUInt8(1);
  const payloadLength = buffer.readUInt16BE(2);
  if (buffer.length !== HEADER_LENGTH + payloadLength) return null;

  return {
    typeId,
    payload: buffer.subarray(HEADER_LENGTH),
    buffer,
  };
}

function getClientState(ws) {
  if (!clientSessionState.has(ws)) {
    clientSessionState.set(ws, {
      selectedVehicleId: 0,
      followVehicleId: null,
      fleetOverviewEnabled: true,
    });
  }

  return clientSessionState.get(ws);
}

function shouldDeliverVehicle(clientState, vehicleId) {
  return clientState.fleetOverviewEnabled || clientState.selectedVehicleId === vehicleId;
}

function sendFrameToClient(ws, frameBuffer) {
  if (ws.readyState === ws.OPEN) {
    ws.send(frameBuffer, { binary: true });
  }
}

function broadcastFrame(frameBuffer, shouldSend) {
  activeUiClients.forEach((client) => {
    const state = getClientState(client);
    if (!shouldSend || shouldSend(state)) {
      sendFrameToClient(client, frameBuffer);
    }
  });
}

function sendSessionAck(ws) {
  const state = getClientState(ws);
  const payload = JSON.stringify({
    type: 'session.state',
    selectedVehicleId: state.selectedVehicleId,
    followVehicleId: state.followVehicleId,
    fleetOverviewEnabled: state.fleetOverviewEnabled,
    protocolProfile: featureFlags.protocolProfile,
    featureFlags,
  });
  if (ws.readyState === ws.OPEN) {
    ws.send(payload);
  }
}

function routeCommandFrameToDrone(frame) {
  udpSocket.send(
    frame,
    0,
    frame.length,
    UDP_OUTBOUND_PORT,
    DRONE_IP_ADDRESS,
    (err) => {
      if (err) console.error('[RADIO EXCEPTION] Frame transmission drop out:', err);
    },
  );
}

function processSessionControlMessage(ws, textMessage) {
  let payload;
  try {
    payload = JSON.parse(textMessage);
  } catch {
    return;
  }

  const state = getClientState(ws);

  if (payload?.type === 'session.selectVehicle') {
    state.selectedVehicleId = Math.max(0, Math.floor(Number(payload.vehicleId) || 0));
  } else if (payload?.type === 'session.followVehicle') {
    state.followVehicleId = payload.vehicleId == null ? null : Math.max(0, Math.floor(Number(payload.vehicleId) || 0));
  } else if (payload?.type === 'session.fleetOverview') {
    state.fleetOverviewEnabled = Boolean(payload.enabled);
  }

  sendSessionAck(ws);
}

function processTrajectoryCommand(decodedCommand, ws) {
  const clientState = getClientState(ws);
  const result = validateTrajectoryCommand(decodedCommand, featureFlags, clientState.selectedVehicleId);

  if (!result.ok) {
    console.warn(`[COMMAND REJECTED] reason=${result.reason}`);
    return;
  }

  if (result.clamped) {
    console.warn('[CONSTRAINT INVERSION] Requested speeds exceed threshold limits. Down-damping limits to safe metrics.');
  }

  const verifiedPayload = TrajectoryCommandType.encode(result.normalized).finish();
  const verifiedFrame = encodeFrame(MSG_TYPE_COMMAND, Buffer.from(verifiedPayload));
  routeCommandFrameToDrone(verifiedFrame);
}

function buildMissionStatusFrame(status) {
  const payload = MissionStatusType.encode({
    timestampUs: status.timestampUs,
    missionId: status.missionId,
    vehicleId: status.vehicleId,
    missionState: status.missionState,
    missionReason: status.missionReason,
    protocolMinor: featureFlags.protocolMinor,
  }).finish();
  return encodeFrame(MSG_TYPE_MISSION_STATUS, Buffer.from(payload));
}

function processMissionCommand(decodedCommand) {
  if (!featureFlags.patrolLoops) {
    console.warn('[MISSION BLOCKED] Patrol loop features disabled in protocol profile.');
    return;
  }

  const protocolMinor = getProtocolMinor(decodedCommand);
  if (protocolMinor > featureFlags.protocolMinor) {
    console.warn('[MISSION BLOCKED] Unsupported protocol minor for mission command.');
    return;
  }

  const status = missionController.applyMissionCommand(decodedCommand);
  const statusFrame = buildMissionStatusFrame(status);
  broadcastFrame(statusFrame, (clientState) => shouldDeliverVehicle(clientState, status.vehicleId));

  const missionPayload = PatrolMissionCommandType.encode({
    ...decodedCommand,
    protocolMinor: featureFlags.protocolMinor,
    vehicleId: getVehicleId(decodedCommand, 0),
  }).finish();
  routeCommandFrameToDrone(encodeFrame(MSG_TYPE_PATROL_MISSION_COMMAND, Buffer.from(missionPayload)));
}

function processIncomingBinaryCommand(ws, binaryFrame) {
  const frame = decodeFrame(binaryFrame);
  if (!frame) {
    console.warn('[MALFORMED PACKET BLOCKED] Rejecting structural anomaly frame from user viewport.');
    return;
  }

  try {
    if (frame.typeId === MSG_TYPE_COMMAND) {
      const decodedCommand = TrajectoryCommandType.decode(frame.payload);
      processTrajectoryCommand(decodedCommand, ws);
      return;
    }

    if (frame.typeId === MSG_TYPE_PATROL_MISSION_COMMAND) {
      const decodedCommand = PatrolMissionCommandType.decode(frame.payload);
      processMissionCommand(decodedCommand);
      return;
    }

    console.warn(`[UNSUPPORTED UI FRAME] type=${frame.typeId}`);
  } catch (err) {
    console.error('[MALFORMED COMMAND DROP] Protobuf binary extraction failed.', err);
  }
}

function processTelemetryFrame(payload) {
  const telemetry = TelemetryStreamType.decode(payload);
  const protocolMinor = getProtocolMinor(telemetry);

  if (protocolMinor > featureFlags.protocolMinor) {
    console.warn('[TELEMETRY DROP] Unsupported protocol minor.');
    return;
  }

  const vehicleId = featureFlags.multiDrone ? getVehicleId(telemetry, 0) : 0;
  const normalizedTelemetry = {
    timestampUs: extractNumber(telemetry, 'timestampUs', 'timestamp_us'),
    flightStatus: extractNumber(telemetry, 'flightStatus', 'flight_status'),
    poseX: extractNumber(telemetry, 'poseX', 'pose_x'),
    poseY: extractNumber(telemetry, 'poseY', 'pose_y'),
    poseZ: extractNumber(telemetry, 'poseZ', 'pose_z'),
    qW: extractNumber(telemetry, 'qW', 'q_w'),
    qX: extractNumber(telemetry, 'qX', 'q_x'),
    qY: extractNumber(telemetry, 'qY', 'q_y'),
    qZ: extractNumber(telemetry, 'qZ', 'q_z'),
    batteryPercentage: extractNumber(telemetry, 'batteryPercentage', 'battery_percentage'),
    vehicleId,
    protocolMinor: featureFlags.protocolMinor,
  };

  telemetryByVehicle.set(vehicleId, normalizedTelemetry);

  const frame = encodeFrame(
    MSG_TYPE_TELEMETRY,
    Buffer.from(TelemetryStreamType.encode(normalizedTelemetry).finish()),
  );

  broadcastFrame(frame, (clientState) => shouldDeliverVehicle(clientState, vehicleId));
}

function processVoxelFrame(payload) {
  const decodedChunk = VoxelDeltaChunkType.decode(payload);
  const validated = validateVoxelDeltaChunk(decodedChunk, featureFlags, 0);

  if (!validated.ok) {
    console.warn(`[VOXEL DROP] reason=${validated.reason}`);
    return;
  }

  const vehicleId = validated.normalized.vehicleId;
  const frame = encodeFrame(
    MSG_TYPE_VOXEL_DELTA,
    Buffer.from(VoxelDeltaChunkType.encode(validated.normalized).finish()),
  );

  broadcastFrame(frame, (clientState) => shouldDeliverVehicle(clientState, vehicleId));
}

function processMissionStatusFrame(payload) {
  const status = MissionStatusType.decode(payload);
  const vehicleId = getVehicleId(status, 0);
  const protocolMinor = getProtocolMinor(status);
  if (protocolMinor > featureFlags.protocolMinor) return;

  const normalized = {
    timestampUs: extractNumber(status, 'timestampUs', 'timestamp_us'),
    missionId: extractNumber(status, 'missionId', 'mission_id'),
    vehicleId,
    missionState: extractNumber(status, 'missionState', 'mission_state'),
    missionReason: status.missionReason || status.mission_reason || '',
    protocolMinor: featureFlags.protocolMinor,
  };

  const frame = encodeFrame(MSG_TYPE_MISSION_STATUS, Buffer.from(MissionStatusType.encode(normalized).finish()));
  broadcastFrame(frame, (clientState) => shouldDeliverVehicle(clientState, vehicleId));
}

wss.on('connection', (ws) => {
  activeUiClients.add(ws);
  getClientState(ws);
  sendSessionAck(ws);
  console.log(`[BRIDGE] Connection established. Displays Active: ${activeUiClients.size}`);

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      processIncomingBinaryCommand(ws, message);
      return;
    }
    processSessionControlMessage(ws, message.toString('utf8'));
  });

  ws.on('close', () => {
    activeUiClients.delete(ws);
    clientSessionState.delete(ws);
    console.log(`[BRIDGE] Connection closed. Displays Remaining: ${activeUiClients.size}`);
  });

  ws.on('error', () => {
    activeUiClients.delete(ws);
    clientSessionState.delete(ws);
  });
});

udpSocket.on('message', (msgBuffer) => {
  if (activeUiClients.size === 0) return;

  const frame = decodeFrame(msgBuffer);
  if (!frame) return;

  try {
    if (frame.typeId === MSG_TYPE_TELEMETRY) {
      processTelemetryFrame(frame.payload);
    } else if (frame.typeId === MSG_TYPE_VOXEL_DELTA) {
      processVoxelFrame(frame.payload);
    } else if (frame.typeId === MSG_TYPE_MISSION_STATUS) {
      processMissionStatusFrame(frame.payload);
    }
  } catch (err) {
    console.error(`[UDP PAYLOAD DROP] type=${frame.typeId}`, err);
  }
});

setInterval(() => {
  const updates = missionController.tick();
  updates.forEach((status) => {
    const frame = buildMissionStatusFrame(status);
    broadcastFrame(frame, (clientState) => shouldDeliverVehicle(clientState, status.vehicleId));
  });
}, 250);

setInterval(() => {
  const vehicles = Array.from(telemetryByVehicle.entries()).map(([vehicleId, telemetry]) => ({
    vehicleId,
    poseX: telemetry.poseX,
    poseY: telemetry.poseY,
    poseZ: telemetry.poseZ,
    batteryPercentage: telemetry.batteryPercentage,
    flightStatus: telemetry.flightStatus,
  }));

  const payload = FleetSnapshotType.encode({
    timestampUs: Date.now() * 1000,
    vehicles,
    protocolMinor: featureFlags.protocolMinor,
  }).finish();

  const frame = encodeFrame(MSG_TYPE_FLEET_SNAPSHOT, Buffer.from(payload));
  broadcastFrame(frame, (clientState) => clientState.fleetOverviewEnabled);
}, 1000);

udpSocket.bind(UDP_INBOUND_PORT, () => {
  console.log(`[HARDENED GATEWAY ACTIVE] Running local telemetry pipe on port: ${UDP_INBOUND_PORT}`);
});

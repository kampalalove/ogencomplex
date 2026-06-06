const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const protobuf = require('protobufjs');
const path = require('path');

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

const UDP_INBOUND_PORT = 4242;
const UDP_OUTBOUND_PORT = 4243;
const DRONE_IP_ADDRESS = '127.0.0.1';
const WS_PORT = 8080;

const MAGIC_BYTE = 0x5f;
const MSG_TYPE_COMMAND = 0x01;
const HEADER_LENGTH = 4;

const udpSocket = dgram.createSocket('udp4');
const wss = new WebSocketServer({ port: WS_PORT });

const activeUiClients = new Set();

let protobufRoot = null;
let TrajectoryCommandType = null;

try {
  protobufRoot = protobuf.loadSync(path.join(__dirname, 'ogen_protocol.proto'));
  TrajectoryCommandType = protobufRoot.lookupType('ogen.protocol.TrajectoryCommand');
  console.log('[HARDENED BRIDGE] Protocol schema validation matrix compiled.');
} catch (err) {
  console.error('[CRITICAL] Protocol schema validation failed to load.', err);
  process.exit(1);
}

wss.on('connection', (ws) => {
  activeUiClients.add(ws);
  console.log(`[BRIDGE] Connection established. Displays Active: ${activeUiClients.size}`);

  ws.on('message', (binaryFrame) => {
    handleIncomingClientCommand(binaryFrame);
  });

  ws.on('close', () => {
    activeUiClients.delete(ws);
    console.log(`[BRIDGE] Connection closed. Displays Remaining: ${activeUiClients.size}`);
  });

  ws.on('error', () => {
    activeUiClients.delete(ws);
  });
});

udpSocket.on('message', (msgBuffer) => {
  if (activeUiClients.size === 0 || msgBuffer.length < HEADER_LENGTH) return;

  if (msgBuffer.readUInt8(0) !== MAGIC_BYTE) return;

  const payloadLength = msgBuffer.readUInt16BE(2);
  if (msgBuffer.length !== HEADER_LENGTH + payloadLength) return;

  activeUiClients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msgBuffer, { binary: true });
    }
  });
});

function extractNumber(decodedCommand, camelKey, snakeKey) {
  const value = decodedCommand?.[camelKey] ?? decodedCommand?.[snakeKey] ?? 0;
  return Number(value);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function handleIncomingClientCommand(bufferLike) {
  const buffer = Buffer.isBuffer(bufferLike)
    ? bufferLike
    : Buffer.from(bufferLike);

  if (buffer.length < HEADER_LENGTH) return;

  const magicByte = buffer.readUInt8(0);
  const typeId = buffer.readUInt8(1);
  const payloadLength = buffer.readUInt16BE(2);

  if (
    magicByte !== MAGIC_BYTE
    || typeId !== MSG_TYPE_COMMAND
    || buffer.length !== HEADER_LENGTH + payloadLength
  ) {
    console.warn('[MALFORMED PACKET BLOCKED] Rejecting structural anomaly frame from user viewport.');
    return;
  }

  const rawPayload = buffer.subarray(HEADER_LENGTH);

  try {
    const decodedCommand = TrajectoryCommandType.decode(rawPayload);

    const targetX = extractNumber(decodedCommand, 'targetX', 'target_x');
    const targetY = extractNumber(decodedCommand, 'targetY', 'target_y');
    const targetZ = extractNumber(decodedCommand, 'targetZ', 'target_z');

    if (
      targetX > BOUNDS.MAX_X || targetX < BOUNDS.MIN_X
      || targetY > BOUNDS.MAX_Y || targetY < BOUNDS.MIN_Y
      || targetZ > BOUNDS.MAX_Z || targetZ < BOUNDS.MIN_Z
    ) {
      console.error(
        `[SAFETY BOUNDS BREACH] Rejected spatial input! Coordinates exceed range limits: [${targetX}, ${targetY}, ${targetZ}]`,
      );
      return;
    }

    const timestampUs = extractNumber(decodedCommand, 'timestampUs', 'timestamp_us');
    const commandId = extractNumber(decodedCommand, 'commandId', 'command_id');
    const targetYaw = extractNumber(decodedCommand, 'targetYaw', 'target_yaw');

    const maxVelocityRequested = extractNumber(decodedCommand, 'maxVelocity', 'max_velocity');
    const maxAccelerationRequested = extractNumber(decodedCommand, 'maxAcceleration', 'max_acceleration');

    const maxVelocity = clamp(maxVelocityRequested, 0, BOUNDS.ABS_MAX_VEL);
    const maxAcceleration = clamp(maxAccelerationRequested, 0, BOUNDS.ABS_MAX_ACC);

    if (maxVelocity !== maxVelocityRequested || maxAcceleration !== maxAccelerationRequested) {
      console.warn('[CONSTRAINT INVERSION] Requested speeds exceed threshold limits. Down-damping limits to safe metrics.');
    }

    const verifiedPayload = TrajectoryCommandType.encode({
      timestampUs,
      commandId,
      targetX,
      targetY,
      targetZ,
      targetYaw,
      maxVelocity,
      maxAcceleration,
    }).finish();

    const verifiedFrame = Buffer.alloc(HEADER_LENGTH + verifiedPayload.length);
    verifiedFrame.writeUInt8(MAGIC_BYTE, 0);
    verifiedFrame.writeUInt8(MSG_TYPE_COMMAND, 1);
    verifiedFrame.writeUInt16BE(verifiedPayload.length, 2);
    Buffer.from(verifiedPayload).copy(verifiedFrame, HEADER_LENGTH);

    udpSocket.send(
      verifiedFrame,
      0,
      verifiedFrame.length,
      UDP_OUTBOUND_PORT,
      DRONE_IP_ADDRESS,
      (err) => {
        if (err) console.error('[RADIO EXCEPTION] Frame transmission drop out:', err);
      },
    );
  } catch (err) {
    console.error('[MALFORMED COMMAND DROP] Protobuf binary extraction failed.', err);
  }
}

udpSocket.bind(UDP_INBOUND_PORT, () => {
  console.log(`[HARDENED GATEWAY ACTIVE] Running local telemetry pipe on port: ${UDP_INBOUND_PORT}`);
});

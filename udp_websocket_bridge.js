const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const protobuf = require('protobufjs');
const path = require('path');

// 1. Hardware Integration Network Configurations
const UDP_INBOUND_PORT = 4242; // Port capturing telemetry/voxels from drone
const UDP_OUTBOUND_PORT = 4243; // Port forwarding commands down to ROS2 internal socket
const DRONE_IP_ADDRESS = '127.0.0.1'; // Target interface routing loopback or explicit radio IP
const WS_PORT = 8080; // Local operator browser port

const MSG_TYPE_COMMAND = 0x01;
const MAGIC_BYTE = 0x5F;
const HEADER_LENGTH = 4;

const udpSocket = dgram.createSocket('udp4');
const wss = new WebSocketServer({ port: WS_PORT });

const activeUiClients = new Set();

let protobufRoot;
let TrajectoryCommandType;

// 2. Synchronously Compile Protobuf Definitions to enforce strict data contracts
try {
  protobufRoot = protobuf.loadSync(path.join(__dirname, 'ogen_protocol.proto'));
  TrajectoryCommandType = protobufRoot.lookupType('ogen.protocol.TrajectoryCommand');
  console.log('[PROTOCOL] OGEN Protobuf Schema contracts parsed successfully.');
} catch (err) {
  console.error(
    '[CRITICAL] Protocol schema compilation failed. Halting system initialization.',
    err,
  );
  process.exit(1);
}

// 3. WebSocket Connection Architecture (Operator Display Interface)
wss.on('connection', (ws) => {
  activeUiClients.add(ws);
  console.log(
    `[BRIDGE] Connected: Operator cockpit surface localized. Total Displays: ${activeUiClients.size}`,
  );

  // Capture explicit TrajectoryCommands exiting the WebGL canvas
  ws.on('message', (binaryFrame) => {
    handleIncomingClientCommand(binaryFrame);
  });

  ws.on('close', () => {
    activeUiClients.delete(ws);
    console.log(
      `[BRIDGE] Disconnected: Operator viewport removed. Displays Remaining: ${activeUiClients.size}`,
    );
  });
});

// 4. Inbound Airframe UDP Parser (Drone -> Bridge -> WebGL UI)
udpSocket.on('message', (msgBuffer) => {
  if (activeUiClients.size === 0) return; // Prevent network blasting if browser context is dead

  // Enforce 4-Byte Wire-Header Constraints validation
  if (msgBuffer.length < HEADER_LENGTH) return;

  const magicByte = msgBuffer.readUInt8(0);
  if (magicByte !== MAGIC_BYTE) {
    console.warn(
      `[CORRUPTION WARNING] Dropping anomalous packet. Invalid Magic Byte: 0x${magicByte.toString(16)}`,
    );
    return;
  }

  const payloadLength = msgBuffer.readUInt16BE(2);
  if (msgBuffer.length !== HEADER_LENGTH + payloadLength) {
    console.warn(
      `[CORRUPTION WARNING] Frame size mismatch detected. Stated payload: ${payloadLength}B, Actual buffer payload: ${msgBuffer.length - HEADER_LENGTH}B`,
    );
    return;
  }

  // Zero-copy downstream broadcast execution: forward the raw unmarshaled frame to all UI viewports
  activeUiClients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msgBuffer, { binary: true });
    }
  });
});

// 5. Outbound Network Controller Architecture (WebGL UI -> Bridge -> ROS2/PX4 Drone)
function handleIncomingClientCommand(bufferLike) {
  const buffer = Buffer.isBuffer(bufferLike)
    ? bufferLike
    : Buffer.from(bufferLike);

  if (buffer.length < HEADER_LENGTH) return;

  const magicByte = buffer.readUInt8(0);
  const typeId = buffer.readUInt8(1);
  const payloadLength = buffer.readUInt16BE(2);
  const rawPayload = buffer.subarray(HEADER_LENGTH);

  if (magicByte !== MAGIC_BYTE || typeId !== MSG_TYPE_COMMAND) {
    console.error(
      '[SECURITY ALARM] Rejected non-conforming message footprint emitted from interface.',
    );
    return;
  }

  if (rawPayload.length !== payloadLength) {
    console.error(
      `[SECURITY ALARM] Rejected malformed command frame length. Header=${payloadLength} Payload=${rawPayload.length}`,
    );
    return;
  }

  // Perform internal deserialization test to guarantee packet validity before physical execution
  try {
    const decodedCommand = TrajectoryCommandType.decode(rawPayload);

    // Assert schema compliance log footprints
    console.log(
      `[COMMAND INTERCEPT] Valid Target Route Verified. Exec ID: ${decodedCommand.command_id} -> [X: ${decodedCommand.target_x.toFixed(2)}, Y: ${decodedCommand.target_y.toFixed(2)}, Z: ${decodedCommand.target_z.toFixed(2)}] MaxVel: ${decodedCommand.max_velocity}m/s`,
    );

    // Forward raw binary buffer down to the Airframe's local listener node via UDP
    udpSocket.send(
      buffer,
      0,
      buffer.length,
      UDP_OUTBOUND_PORT,
      DRONE_IP_ADDRESS,
      (err) => {
        if (err) {
          console.error(
            '[NETWORK EXCEPTION] Failed to forward TrajectoryCommand down to radio trunk:',
            err,
          );
        }
      },
    );
  } catch (protobufVerificationError) {
    console.error(
      '[CRITICAL SEVERITY] Intercepted corrupted binary payload from viewport context. Suppressing execution.',
      protobufVerificationError,
    );
  }
}

// 6. Bind Socket Execution Lifecycle
udpSocket.bind(UDP_INBOUND_PORT, () => {
  console.log(
    `[CORE INITIALIZED] Ground Station Gateway fully bound to UDP Network Channel: ${UDP_INBOUND_PORT}`,
  );
  console.log(
    `[CORE INITIALIZED] Upstream WebSocket Broadcast Terminal active on Local Port: ${WS_PORT}`,
  );
});

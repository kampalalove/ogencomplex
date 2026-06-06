# TECHNICAL WHITEPAPER
## System Architecture of the OGEN Autonomous Spatial Control Engine
**Document Version:** 1.0.0-PROD  
**Classification:** Operational Infrastructure Specification  
**Execution Paradigm:** Sovereign, Local-First, Zero-Cloud Continuous Autonomy

## 1. Executive System Overview & Philosophy
Modern commercial uncrewed aerial vehicle (UAV) workflows operate on an unacceptably latent **Batch-Processed Cloud Topology**. In traditional systems, sensor payloads ingest data to disk, post-flight archives are uploaded to distributed cloud servers, and photogrammetry engines process raw spatial files into structural meshes over multi-hour intervals. This architecture introduces severe operational latency, absolute dependency on continuous internet connectivity, and vulnerability to data interception—rendering it structurally unviable for critical real-time industrial inspection.

The **OGEN Spatial Control Engine** completely eliminates this loop. It replaces distributed batch-processing with a synchronized **Real-Time Edge-Compute Pipeline**. The system constructs a deterministic digital twin on-board the airframe during flight, exposing an instantaneous **Click-to-Task (Map-then-Task)** spatial planning interface.

### Core Design Doctrines
- **Sovereign Engineering (Data Localism):** All compute, optimization, state estimation, and raw spatial map structures exist completely on physical, on-site hardware assets. The network stack contains no cloud endpoints, third-party authentication APIs, or external storage pipes.
- **Dumb and Durable Execution:** System layers use statically compiled, memory-safe binaries that run at native instruction speeds. Run-time execution is entirely deterministic, avoiding garbage collection, virtualization layers, and loose string parsing.
- **The 20-Minute Friction Limit:** Tooling architecture must compile and run using unified, automated shell routines, removing environmental configuration drift and third-party dependencies from deployment pipelines.

## 2. Integrated Physical Hardware Stack
The hardware layer provides an unmanaged, highly parallelized edge-compute platform capable of handling real-time volumetric mapping while concurrently evaluating complex avoidance and navigation loops.

| Subsystem Component | Hardware Selection | Structural Selection Rationale |
|---|---|---|
| **Airframe Rig** | DJI Matrice 350 RTK | Dual-battery operational redundancy, 2.7kg payload capacity, native real-time kinematic (RTK) GPS tracking matrix. |
| **Edge Compute Brain** | NVIDIA Jetson Orin NX (16GB) | 100 TOPS AI and tensor processing capability. Runs parallel visual-inertial odometry (VIO), TSDF voxel updates, and trajectory solvers via shared memory. |
| **Flight Controller** | Cube Orange+ (PX4 RTOS) | Stably handles real-time low-level motor actuation, attitude state tracking, and 20Hz MAVLink offboard setpoint monitoring. |
| **Primary Spatial Sensor** | Ouster OS0-32 LiDAR | 32-channel high-frequency ultra-wide field of view depth mapping; drives real-time obstacle avoidance. |
| **Optical Mapping Engine** | Sony Global Shutter (USB3) | High-speed global shutter prevents rolling-shutter artifacts during fast scanning maneuvers; feeds spatial colorization pipelines. |
| **Domain Analytics Sensor** | FLIR Boson (Radiometric) | Long-wave infrared (LWIR) thermal engine that captures raw radiometric frame buffers for industrial anomaly tagging. |
| **Local Telemetry Link** | Ubiquiti Wi-Fi 6E / Private LTE | Low-overhead point-to-point data link that streams optimized binary protocol buffers to the ground station. |

## 3. Distributed Software Architecture & Low-Latency Data Flow
The runtime architecture is divided into three processing zones to isolate flight control mechanics from heavy viewport rendering.

```text
+----------------------------------------------------------------------------------------------------------------+
|                                    AIRFRAME COMPUTATIONAL ENVIRONMENT                                          |
|                                                                                                                |
|   +-----------------------+      +--------------------------+      +---------------------------------------+   |
|   |   Ouster OS0-32       |      |     Sony Global Shutter  |      |         Cube Orange+ (PX4)            |   |
|   +-----------+-----------+      +------------+-------------+      +-------------------+-------------------+   |
|               |                               |                                        |                       |
|               v PointCloud2                   v Global Shutter Image                   v /fmu/out/vehicle_stat |
|  +-------------------------------------------------------------------------------------+--------------------+  |
|  |                                      SOVEREIGN AUTONOMY CORE ENGINE                                      |  |
|  |                                                                                                          |  |
|  |   +----------------------------+                     +-----------------------------------------------+   |  |
|  |   |   SharedVoxelMap Memory    |                     |          TrajectoryPlannerNode (C++)          |   |  |
|  |   |   - Resolution: 0.05m      |<===================>|          - Global Pathfinding: 3D A* |   |  |
|  |   |   - TSDF Voxel Array Grid  |  Direct Memory      |          - Local Optimization: Minimum-Snap   |   |  |
|  |   +-------------+--------------+  Pointer Access     +-----------------------+-----------------------+   |  |
|  |                 |                                                            |                           |  |
|  +-----------------+------------------------------------------------------------+---------------------------+  |
|                    |                                                            |                              |
|                    | VoxelDeltaChunk (Protobuf over UDP)                        | Path Output Matrix           |
|                    v                                                            v                              |
|  +-----------------+------------------------------------------------------------+---------------------------+  |
|  |                 |                                                            |                           |  |
|  |                 |                                                            v                           |  |
|  |                 |                                           +----------------+-----------------------+   |  |
|  |                 |                                           |       px4_offboard_bridge (C++)        |   |  |
|  |                 |                                           |       - Enforces 20Hz Heartbeat        |   |  |
|  |                 |                                           |       - ENU -> NED Transformations     |   |  |
|  |                 |                                           +----------------+-----------------------+   |  |
|  |                 |                                                            |                           |  |
|  +-----------------+------------------------------------------------------------+---------------------------+  |
|                    |                                                            |                              |
+--------------------|------------------------------------------------------------|------------------------------+
                     |                                                            | MAVLink /fmu/in/trajectory...
                     |                                                            v
+--------------------|------------------------------------------------------------+------------------------------+
|                    |                                                                                           |
|                    v Binary Packet Stream (UDP Port 4242)                                                      |
|   +----------------+------------------------+                                                                  |
|   |       GROUND STATION NODE.JS BRIDGE     |                                                                  |
|   |       - Intercepts UDP Voxel Chunks     |                                                                  |
|   |       - Exposes Low-Latency WebSockets  |                                                                  |
|   +----------------+------------------------+                                                                  |
|                    |                                                                                           |
|                    v Binary Frame WebSockets (Port 8080)                                                       |
|   +----------------+------------------------+                                                                  |
|   |       OPERATOR UI COCKPIT (HTML/WebGL)  |                                                                  |
|   |       - Renders Local Sparse Point Cloud|                                                                  |
|   |       - Raycasts Mouse Click to Vector  |-------------------------------------------------------+          |
|   +-----------------------------------------+                                                       |          |
|                                                                                                     |          |
|                               TrajectoryCommand (Protobuf over WebSocket Frame: 0x5F 0x01)          |          |
|                                                                                                     v          |
+----------------------------------------------------------------------------------------------------------------+
```

### 3.1 On-Board Execution Environment (Jetson Orin NX)
To eliminate execution deadlocks and thread-stalling overhead, the on-board software uses a **Single-Process Component Container Model**. The mapping stack and the trajectory planning engine run concurrently in the same process memory space, sharing a lock-free pointer to an in-memory voxel structure.

1. **Volumetric Ingestion Node (TSDFMapperNode):** Subscribes to the raw point-cloud sensor array (/sensing/lidar/pointcloud) and high-frequency visual-inertial odometry states (/localization/vio/pose). It updates an on-board **Truncated Signed Distance Function (TSDF)** volumetric map grid at 30Hz.
2. **Shared Memory Layer (SharedVoxelMap):** An in-memory, thread-safe hash map that maintains voxel data down to 0.05m resolution. It exposes a direct C++ memory-pointer lookup API, allowing planning algorithms to check spatial occupancy in sub-microsecond cycles without ROS2 middleware serialization or network stack overhead.
3. **Trajectory Planning Engine (TrajectoryPlannerNode):** Monitors the /sovereign/plan_trajectory network boundary. When an operator clicks a target coordinate, the node directly queries the SharedVoxelMap using a 3D raymarch loop to evaluate line-of-sight path safety. If it detects a structural obstacle, it runs a 3D A* search on a downsampled grid to build a safe path corridor, then passes the resulting waypoints into a multi-segment **Minimum-Snap Solver**.

### 3.2 Actuation and Safety Shield Layer (px4_offboard_bridge)
The px4_offboard_bridge isolates the planning nodes from the real-time flight controller. It runs on a dedicated high-priority CPU thread pool, converting the planner's smooth polynomial coordinates into raw, hardware-interpretable flight commands.

- **20Hz Watchdog Pulse:** The bridge uses an explicit timer loop to publish attitude and position control signals (/fmu/in/offboard_control_mode) to the flight controller at exactly 20Hz (every 50ms). This fulfills PX4’s hard runtime timeout constraints, preventing the airframe from entering automatic failsafe states if upstream planning tasks experience latency spikes.
- **Coordinate Space Matching:** The bridge maps incoming trajectories from the standard robotics East-North-Up (ENU) coordinate frame into PX4's native hardware North-East-Down (NED) coordinate frame, applying spatial transformations inline.

## 4. The Sovereign Binary Protocol & Data Serialization Contracts
To maximize network throughput over local point-to-point wireless data links, all network frames use a compact, unmarshaled binary format. The protocol begins with a 4-byte header, followed immediately by compressed Protocol Buffers payloads.

### 4.1 Frame Wire-Format Layout
```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Magic (0x5F)  | Type ID (1B)  |     Payload Length (2B)       |
-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|             Serialized Protobuf Payload Data (Variable)       |
|                                                               |
-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### 4.2 Formal Message Type Registries
#### Type ID: 0x01 — TrajectoryCommand (Ground Station Display → Drone Planner)
Dispatched when an operator selects a target coordinate on the WebGL viewport.

```protobuf
syntax = "proto3";
package ogen.protocol;

message TrajectoryCommand {
  uint64 timestamp_us = 1; // Real-time Unix timestamp footprint
  uint32 command_id   = 2; // Incremental sequence index
  double target_x     = 3; // Target coordinate (ENU Easting)
  double target_y     = 4; // Target coordinate (ENU Northing)
  double target_z     = 5; // Target coordinate (ENU Altitude)
  float  target_yaw   = 6; // Commanded orientation angle in Radians
}
```

#### Type ID: 0x02 — TelemetryStream (Airframe → Ground Station Display)
Broadcasts at 20Hz to drive dashboard indicator instrumentation.

```protobuf
message TelemetryStream {
  uint64 timestamp_us       = 1;
  uint32 flight_status      = 2; // Bitmask: [Armed:Bit0 | Offboard:Bit1 | Landed:Bit2]
  double pose_x             = 3; // Centimeter-accurate local tracking position
  double pose_y             = 4;
  double pose_z             = 5;
  float  q_w                = 6; // Attitude Quaternion matrix elements
  float  q_x                = 7;
  float  q_y                = 8;
  float  q_z                = 9;
  float  battery_percentage = 10;
}
```

#### Type ID: 0x03 — VoxelDeltaChunk (Airframe Mapping Engine → Ground Station Display)
Delta-compressed array packets containing structural updates to the local volumetric map.

```protobuf
message VoxelDeltaChunk {
  uint64 timestamp_us = 1;
  uint32 chunk_id     = 2;
  
  message VoxelData {
    int64  idx_x          = 1; // Discrete voxel grid coordinates
    int64  idx_y          = 2;
    int64  idx_z          = 3;
    float  tsdf_distance  = 4; // Signed metric value [-1.0 to 1.0]
    uint32 semantic_class = 5; // 0=Unknown, 1=Pipe, 2=Valve, 3=Tank
  }
  
  repeated VoxelData voxels = 3; // Vector of mutated voxel coordinates
}
```

## 5. Mathematical Trajectory Optimization
When a target coordinate passes safety validation, the **Minimum-Snap Solver** optimizes a piecewise polynomial trajectory across M consecutive path segments. Each segment is defined by a 6th-degree polynomial.

The algorithm minimizes the integral of the squared fourth derivative (snap) across the total flight duration to ensure optimal motor efficiency and stability near complex industrial assets.

Unlike standard path systems that treat intermediate waypoints as simple stop-and-start locations, the OGEN solver formulates interior waypoints as shared continuity boundaries within a global linear constraint matrix (A · c = b). This guarantees smooth, uninterrupted transitions through obstacles by enforcing continuity up to the fourth derivative.

The solver resolves this constraint layout using partial pivoting LU decomposition on each execution loop, generating smooth polynomial paths without corner-cutting or mid-air pauses.

## 6. Deterministic Safety Gates & Failsafe Execution Matrix
The platform implements an automated safety matrix directly within the compiled C++ bridge binary. This creates a hard containment boundary that protects critical facility infrastructure from upstream software errors, software hangs, or link dropouts.

```text
                  +---------------------------------------+
                  |   Continuous 20Hz Bridge Pulse Active |
                  +-------------------+-------------------+
                                      |
                                      v
                  +---------------------------------------+
                  |   Verify Status: ARMED & OFFBOARD?    |
                  +-------------------+-------------------+
                                      |
                     +----------------+----------------+
                     | Yes                             | No
                     v                                 v
  +---------------------------------------+   +----------------------------------+
  |  Evaluate Trajectory Watchdog Status  |   | Suppress Setpoints / Disarm Gate |
  +-------------------+-------------------+   +----------------------------------+
                      |
         +------------+------------+
         | <= 2.0s                 | > 2.0s (Watchdog Timeout)
         v                         v
  +----------------------+   +---------------------------------------------------+
  | Track Next Planned   |   | Trigger Safe Hover Failsafe                       |
  | Trajectory Point     |   | - Latches current coordinates via VIO             |
  +----------------------+   | - Transmits rock-solid 0-velocity hold command    |
                             +-----------------------+---------------------------+
                                                     |
                                                     v
                             +---------------------------------------------------+
                             | VIO Tracking Data Dropped Completely?             |
                             +-----------------------+---------------------------+
                                                     |
                                    +----------------+----------------+
                                    | No                              | Yes
                                    v                                 v
                             +----------------------+   +------------------------+
                             | Maintain Centimeter  |   | Assert Emergency       |
                             | Position Lock        |   | NanF Zero-Velocity Land|
                             +----------------------+   +------------------------+
```

### 6.1 Mode Activation Guardrail
The bridge constantly checks the current state of the flight controller (/fmu/out/vehicle_status). If the airframe drops out of **OFFBOARD** flight mode or is manually overridden by a pilot, the node instantly cuts off trajectory tracking commands. This prevents accidental command injection while the aircraft is flying under manual or automated return-to-home control.

### 6.2 Trajectory Watchdog Timeout
If the upstream planning node or shared memory pipeline hangs, the bridge detects the lapse using an internal timer.

When this threshold is breached, the bridge sets `hover_setpoint_latched_ = true`. It locks onto the aircraft's current coordinates using visual-inertial odometry feedback and issues a zero-velocity position hold command, bringing the airframe to an immediate stop.

### 6.3 State Estimation Loss Failsafe
If the primary VIO tracking signal drops completely while the aircraft is in a watchdog timeout state, the bridge applies an emergency stabilization fallback. It populates the position vectors with NaN float tags while explicitly setting the velocity targets to zero:

```cpp
sp_msg.position[0] = std::nanf("");
sp_msg.velocity[0] = 0.0f; // Force absolute zero velocity vectors across NED axes
```

This commands the flight controller to ignore position drift entirely and use raw inertial measurements to stabilize its attitude, executing a controlled vertical descent to the ground.

## 7. Next Step Verification & Testing Strategy
To validate this whitepaper architecture on physical hardware, follow this prioritized testing sequence:

1. **HIL Execution Verification:** Flash the px4_offboard_bridge onto the companion hardware target. Run the airframe inside a Hardware-in-the-Loop (HIL) simulation loop, and confirm that the bridge maintains a steady 20Hz update cycle over a continuous 4-hour test flight.
2. **Watchdog Injection Testing:** Simulate an intentional software crash by sending a SIGSTOP signal to the trajectory planning thread during an active automated flight path. Verify that the bridge detects the failure within the configured 2.0-second window and establishes a stable coordinate hover lock.
3. **Local WebGL Network Verification:** Launch the Node.js ground station bridge. Verify that incoming binary voxel stream packets load into the operator dashboard without dropping frames or stalling the user interface.

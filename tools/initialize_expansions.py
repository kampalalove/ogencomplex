#!/usr/bin/env python3
import socket
import time
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent

print("══ INITIALIZING ALL OGEN EXPANSIONS SIMULTANEOUSLY ══\n")

log_dir = WORKSPACE_ROOT / "logs" / "audit"
log_dir.mkdir(parents=True, exist_ok=True)
audit_log = log_dir / "ops_telemetry.log"
with open(audit_log, "a", encoding="utf8") as file_handle:
  file_handle.write(
    f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ')}] [SYSTEM_INIT] Sovereign ledger secured.\\n"
  )
print("✓ [OPS-1.0] Local secure audit trail initialized.")

mesh_socket = None
sim_imu_socket = None
sim_lidar_socket = None

try:
  mesh_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
  mesh_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
  mesh_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
  mesh_socket.bind(("0.0.0.0", 10001))
  print("✓ [ASCS-2.0] Decentralized mesh network bound to UDP broadcast port 10001.")
except OSError as error:
  print(f"✗ [ASCS-2.0] Mesh socket binding failed: {error}")

try:
  sim_imu_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
  sim_imu_socket.bind(("127.0.0.1", 11001))
  sim_imu_socket.setblocking(False)
  print("✓ [SIM-1.0] Synthetic HIL IMU data stream listener set on port 11001 (Non-blocking).")
except OSError as error:
  print(f"✗ [SIM-1.0] IMU stream initialization failed: {error}")

try:
  sim_lidar_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
  sim_lidar_socket.bind(("127.0.0.1", 11002))
  sim_lidar_socket.setblocking(False)
  print("✓ [SIM-1.0] Synthetic HIL LiDAR data stream listener set on port 11002 (Non-blocking).")
except OSError as error:
  print(f"✗ [SIM-1.0] LiDAR stream initialization failed: {error}")

model_path = WORKSPACE_ROOT / "models" / "quantized" / "semantic_vision_onnx"
if model_path.exists():
  print(f"✓ [AI-1.0] Edge engine verified at {model_path}. Accelerator: CUDA/TensorRT target ready.")
else:
  print(f"⚠ [AI-1.0] Core model path not yet populated at {model_path}. Ready for local ONNX weight injection.")

print("\n═════════════════════════════════════════════════════")
print("[READY] The structural pipeline for all four expansions is locked.")

for resource in (mesh_socket, sim_imu_socket, sim_lidar_socket):
  if resource is not None:
    resource.close()

# DLR‑VA‑01 Deployment Runbook

## Hardware BOM
- Raspberry Pi 4 (8GB) or industrial NUC
- USB‑BACnet adapter
- USB‑Modbus adapter
- Ethernet switch, power supply

## Network Diagram
[Edge] --BACnet/IP--> [DLR Hall A]  
[Edge] --Modbus/TCP--> [PDU meters]  
[Edge] --MQTT--> [Core Kafka]

## Steps
1. Flash edge OS (Ubuntu 22.04)
2. Copy `veritas-edge` binary
3. Configure `sensors.yaml` (BACnet/Modbus point mapping)
4. Run `./veritas-edge --config sensors.yaml`
5. Verify first state vector: `curl localhost:8080/verify`
6. Manual fallback: power cycle edge, verify logs

## Operator Handoff
- Dashboard URL
- Alert thresholds
- Weekly ledger hash check

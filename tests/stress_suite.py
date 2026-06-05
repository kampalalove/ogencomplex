#!/usr/bin/env python3
"""FMM Stress Test Suite – Injects 7 failure modes, reports recovery."""

import subprocess
import time


def run_test(name, cmd):
    print(f"\n--- {name} ---")
    start = time.time()
    result = subprocess.run(cmd, shell=True, capture_output=True)
    elapsed = time.time() - start
    print(f"Exit: {result.returncode}, Time: {elapsed:.2f}s")
    return result.returncode == 0


tests = {
    "Telemetry drop": "python3 inject_telemetry_drop.py",
    "Stale data": "python3 inject_stale.py --seconds 6",
    "Clock skew": "python3 inject_skew.py --seconds 5",
    "Rule conflict": "python3 inject_rule_conflict.py",
    "Financial starvation": "python3 inject_financial_starvation.py",
    "Actuator timeout": "python3 inject_actuator_timeout.py",
    "Ledger mismatch": "python3 inject_ledger_mismatch.py",
}

passed = 0
for name, cmd in tests.items():
    if run_test(name, cmd):
        passed += 1
    time.sleep(2)

print(f"\nPassed {passed}/{len(tests)} failure modes")

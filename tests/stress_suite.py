#!/usr/bin/env python3
"""FMM Stress Test Suite – Injects 7 failure modes, reports recovery."""

import subprocess
import time

TEST_TIMEOUT_SECONDS = 60
TEST_COOLDOWN_SECONDS = 2


def run_test(name, cmd):
    print(f"\n--- {name} ---")
    start = time.time()
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=TEST_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        print(f"Exit: timeout, Time: {elapsed:.2f}s")
        return False
    elapsed = time.time() - start
    print(f"Exit: {result.returncode}, Time: {elapsed:.2f}s")
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.decode(errors="replace"))
        if result.stdout:
            print(result.stdout.decode(errors="replace"))
    return result.returncode == 0


tests = {
    "Telemetry drop": ["python3", "inject_telemetry_drop.py"],
    "Stale data": ["python3", "inject_stale.py", "--seconds", "6"],
    "Clock skew": ["python3", "inject_skew.py", "--seconds", "5"],
    "Rule conflict": ["python3", "inject_rule_conflict.py"],
    "Financial starvation": ["python3", "inject_financial_starvation.py"],
    "Actuator timeout": ["python3", "inject_actuator_timeout.py"],
    "Ledger mismatch": ["python3", "inject_ledger_mismatch.py"],
}

passed = 0
for name, cmd in tests.items():
    if run_test(name, cmd):
        passed += 1
    time.sleep(TEST_COOLDOWN_SECONDS)

print(f"\nPassed {passed}/{len(tests)} failure modes")

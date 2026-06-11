#!/usr/bin/env python3
"""Local Veritas rule evaluator and batch validation suite."""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


def load_rules(path: str) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return list(data.get("rules", []))
    if isinstance(data, list):
        return data
    raise ValueError("Rules JSON must be a list or an object with a 'rules' array")


def normalize_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return float(value) if "." in value else int(value)
        except ValueError:
            return value
    return value


def evaluate_rules(payload: dict[str, Any], rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for rule in rules:
        condition_raw = rule.get("condition_json", "{}")
        try:
            condition = json.loads(condition_raw) if isinstance(condition_raw, str) else condition_raw
        except json.JSONDecodeError:
            continue

        field = condition.get("field")
        op = condition.get("op")
        expected = condition.get("value")
        if not field or not op or expected is None or field not in payload:
            continue

        actual = normalize_value(payload[field])
        hit = False
        if op == ">" and isinstance(actual, (int, float)):
            hit = actual > expected
        elif op == "<" and isinstance(actual, (int, float)):
            hit = actual < expected
        elif op == "==":
            hit = actual == expected
        elif op == "contains" and isinstance(actual, str):
            hit = str(expected) in actual

        if hit:
            matches.append(
                {
                    "rule": rule.get("rule_name"),
                    "action": rule.get("action_text"),
                    "priority": rule.get("priority"),
                    "category": rule.get("category"),
                    "evidence": rule.get("evidence_source"),
                }
            )
    return matches


def run_test_suite(rules: list[dict[str, Any]], test_cases_json_path: str) -> list[dict[str, Any]]:
    tests = json.loads(Path(test_cases_json_path).read_text(encoding="utf-8"))
    results = []
    for test in tests:
        matches = evaluate_rules(test["input"], rules)
        actual_actions = [match["action"] for match in matches]
        passed = set(actual_actions) == set(test["expected_actions"])
        results.append(
            {
                "name": test["name"],
                "passed": passed,
                "input": test["input"],
                "expected": test["expected_actions"],
                "actual": actual_actions,
            }
        )
    return results


def render_junit(results: list[dict[str, Any]]) -> str:
    suite = ET.Element(
        "testsuite",
        {
            "name": "veritas_rule_engine",
            "tests": str(len(results)),
            "failures": str(sum(1 for result in results if not result["passed"])),
        },
    )
    for result in results:
        case = ET.SubElement(suite, "testcase", {"name": result["name"]})
        if not result["passed"]:
            failure = ET.SubElement(case, "failure", {"message": "Rule action mismatch"})
            failure.text = json.dumps(
                {
                    "input": result["input"],
                    "expected": result["expected"],
                    "actual": result["actual"],
                },
                indent=2,
            )
    return ET.tostring(suite, encoding="unicode")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate Veritas rules locally.")
    parser.add_argument("--rules", required=True, help="Path to rules JSON export")
    parser.add_argument("--payload", help="Single payload JSON string or file path")
    parser.add_argument("--test-suite", help="Path to test cases JSON")
    parser.add_argument("--junit", action="store_true", help="Emit JUnit XML for --test-suite")
    args = parser.parse_args()

    rules = load_rules(args.rules)

    if args.test_suite:
        results = run_test_suite(rules, args.test_suite)
        if args.junit:
            print(render_junit(results))
        else:
            print(json.dumps({"results": results}, indent=2))
        return 0 if all(result["passed"] for result in results) else 1

    if not args.payload:
        parser.error("Either --payload or --test-suite is required")

    payload_source = Path(args.payload)
    if payload_source.exists():
        payload = json.loads(payload_source.read_text(encoding="utf-8"))
    else:
        payload = json.loads(args.payload)
    print(json.dumps({"matches": evaluate_rules(payload, rules)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

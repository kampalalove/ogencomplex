"""
rule_engine.py — OGEN Complex Major 2
Rule-Bound Reasoning Engine

Loads a JSON rule definition and evaluates a flat evidence-facts dict against
every rule. Returns a single verdict string:
  - "PASS"           — all applicable rules satisfied
  - "FAIL_<rule_id>" — first violated rule's fail_verdict
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Operator registry
# ---------------------------------------------------------------------------
def _get_nested(facts: dict, dotted_key: str) -> tuple[bool, Any]:
    """Resolve 'a.b.c' into facts['a']['b']['c']. Returns (found, value)."""
    parts = dotted_key.split(".")
    node: Any = facts
    for part in parts:
        if not isinstance(node, dict) or part not in node:
            return False, None
        node = node[part]
    return True, node


def _op(actual: Any, op: str, expected: Any) -> bool:
    if op == "eq":
        return actual == expected
    if op == "neq":
        return actual != expected
    if op == "exists":
        return actual is not None
    # Ordered comparisons — guard against incompatible types
    try:
        if op == "gte":
            return actual is not None and actual >= expected
        if op == "gt":
            return actual is not None and actual > expected
        if op == "lte":
            return actual is not None and actual <= expected
        if op == "lt":
            return actual is not None and actual < expected
    except TypeError:
        return False
    raise ValueError(f"Unknown operator: {op!r}")


def _eval_fact(facts: dict, clause: dict) -> bool:
    found, val = _get_nested(facts, clause["fact"])
    if not found:
        val = None
    return _op(val, clause["op"], clause.get("value"))


def _eval_condition(facts: dict, condition: dict) -> bool:
    if "all" in condition:
        return all(_eval_fact(facts, c) for c in condition["all"])
    if "any" in condition:
        return any(_eval_fact(facts, c) for c in condition["any"])
    return True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
class RuleBoundEngine:
    """
    Evaluates evidence facts against a JSON rule definition.
    Thread-safe for read-only evaluation (rules are loaded once).
    """

    def __init__(self, rules_path: Path | str):
        rules_path = Path(rules_path)
        with rules_path.open() as fh:
            spec = json.load(fh)
        self._version: str = spec.get("version", "unknown")
        self._name: str = spec.get("name", "unnamed")
        self._rules: list[dict] = spec.get("rules", [])

    # ------------------------------------------------------------------
    def evaluate(self, facts: dict) -> str:
        """
        Evaluate all rules against `facts`.

        Returns "PASS" if every applicable rule is satisfied, or the
        fail_verdict string of the first violated rule.
        """
        for rule in self._rules:
            condition = rule.get("condition", {})
            if not _eval_condition(facts, condition):
                # Rule does not apply to these facts — skip
                continue
            require = rule.get("require", {})
            found, val = _get_nested(facts, require["fact"])
            if not found:
                val = None
            if not _op(val, require["op"], require.get("value")):
                return rule["fail_verdict"]
        return "PASS"

    @property
    def version(self) -> str:
        return self._version

    @property
    def name(self) -> str:
        return self._name

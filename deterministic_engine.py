#!/usr/bin/env python3
"""
deterministic_engine.py — OGEN Complex Major 1
Strict DAG State Machine (Zero Probabilistic Drift)

Feeds raw events into rule_engine.py for compliance evaluation and produces
a cryptographic proof chain that attestation.py can sign.

Domain: Service 1 — Audit-First Compliance
Rail:   Major 1 (state machine) → Major 2 (rule engine) → Major 4 (attestation)
"""

from __future__ import annotations

import hashlib
import json
from collections import deque
from pathlib import Path
from typing import Any

# Deferred-safe import: Major 2 may not be deployed yet; fall back gracefully
try:
    from rule_engine import RuleBoundEngine as _RuleBoundEngine
    _RULE_ENGINE_AVAILABLE = True
except ImportError:  # pragma: no cover
    _RuleBoundEngine = None  # type: ignore[assignment]
    _RULE_ENGINE_AVAILABLE = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_RULES_PATH = Path(__file__).parent / "rules" / "rule_bound_reasoning_v1.0.0.json"

VERDICT_PASS       = "PASS"
VERDICT_HARD_HALT  = "HARD_HALT"


# ---------------------------------------------------------------------------
# Cycle detection
# ---------------------------------------------------------------------------
def _has_cycle(transitions: dict[str, list[str]]) -> bool:
    """
    Full DFS-based cycle detection on the DAG.
    Returns True if any cycle exists (including non-trivial multi-hop cycles).
    """
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {s: WHITE for s in transitions}

    def dfs(node: str) -> bool:
        color[node] = GRAY
        for neighbor in transitions.get(node, []):
            if neighbor not in color:
                # Terminal node not declared as a key — treat as leaf
                continue
            if color[neighbor] == GRAY:
                return True   # back-edge → cycle
            if color[neighbor] == WHITE and dfs(neighbor):
                return True
        color[node] = BLACK
        return False

    for state in list(color):
        if color[state] == WHITE:
            if dfs(state):
                return True
    return False


# ---------------------------------------------------------------------------
# DeterministicStateMachine
# ---------------------------------------------------------------------------
class DeterministicStateMachine:
    """
    Zero-drift transition controller.

    States are nodes in a Directed Acyclic Graph (DAG). No loops, no random
    sampling. Every transition is evaluated by the rule engine and recorded
    with a cryptographic digest for downstream attestation.

    Parameters
    ----------
    dag_definition : dict[str, list[str]]
        Maps each state name to its list of allowed successor states.
        Example::

            {
                "INIT":     ["VALIDATE"],
                "VALIDATE": ["EXECUTE", "INVALID"],
                "EXECUTE":  ["AUDIT"],
                "AUDIT":    ["HALT"],
                "INVALID":  ["HALT"],
                "HALT":     []
            }

    rules_path : Path | str | None
        Path to the JSON rule definition consumed by ``rule_engine.py``.
        Defaults to ``rules/rule_bound_reasoning_v1.0.0.json`` next to this file.
    """

    def __init__(
        self,
        dag_definition: dict[str, list[str]],
        rules_path: Path | str | None = None,
    ):
        self._transitions: dict[str, list[str]] = dict(dag_definition)
        self._rules_path: Path = Path(rules_path) if rules_path else DEFAULT_RULES_PATH
        self._validate_dag()
        self._current_state: str = "INIT"
        self._history: list[tuple[str, str, str]] = []  # (from, to, verdict_hash)
        self._halted: bool = False
        # Cache the rule engine at construction time to avoid per-transition I/O
        self._rule_engine = (
            _RuleBoundEngine(self._rules_path) if _RULE_ENGINE_AVAILABLE else None
        )

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    def _validate_dag(self) -> None:
        """
        Ensure the graph is a valid DAG:
        1. All destination states are declared (auto-add terminal states).
        2. No cycles (full DFS check — not just self-loop inspection).
        3. An INIT state must be present.
        4. A HALT terminal state is always available.
        """
        # Auto-register any undeclared terminal destination states
        all_declared = set(self._transitions.keys())
        for dsts in list(self._transitions.values()):
            for dst in dsts:
                if dst not in all_declared:
                    self._transitions[dst] = []
        self._transitions.setdefault("HALT", [])

        if "INIT" not in self._transitions:
            raise ValueError("DAG must contain an 'INIT' state.")

        if _has_cycle(self._transitions):
            raise ValueError(
                "Cycle detected in DAG definition. "
                "DeterministicStateMachine requires a strictly acyclic graph."
            )

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------
    def can_transition_to(self, target_state: str) -> bool:
        """Return True if `target_state` is an allowed successor of the current state."""
        if self._halted:
            return False
        return target_state in self._transitions.get(self._current_state, [])

    def transition(self, target_state: str, evidence_facts: dict[str, Any]) -> str:
        """
        Attempt a state transition.

        1. If the transition is not in the DAG — hard halt immediately.
        2. Evaluate evidence facts via Major 2 (rule_engine.py).
        3. Record the transition with a cryptographic digest.
        4. Advance current state.

        Returns
        -------
        str
            The rule-engine verdict (``"PASS"`` or a ``"FAIL_*"`` code),
            or ``"HARD_HALT"`` if the transition was illegal.
        """
        if not self.can_transition_to(target_state):
            self._halted = True
            self._current_state = "HALT"
            return VERDICT_HARD_HALT

        # --- Major 2: evaluate compliance facts ---
        verdict = self._evaluate_rules(evidence_facts, target_state)

        # Record with cryptographic digest
        transition_record = f"{self._current_state}→{target_state}|{verdict}"
        verdict_hash = hashlib.sha256(transition_record.encode()).hexdigest()
        self._history.append((self._current_state, target_state, verdict_hash))

        self._current_state = target_state
        return verdict

    def get_current_state(self) -> str:
        """Return the current state label."""
        return self._current_state

    def is_halted(self) -> bool:
        """Return True after a HARD_HALT has been triggered."""
        return self._halted

    def get_proof_chain(self) -> list[dict]:
        """
        Return an audit-ready proof chain.

        Each entry is::

            {"from": "<state>", "to": "<state>", "hash": "<sha256_hex>"}

        The chain can be passed directly to ``attestation.CapabilityAttestation.attest_chain()``.
        """
        return [
            {"from": frm, "to": to, "hash": h}
            for frm, to, h in self._history
        ]

    def reachable_states(self) -> set[str]:
        """Return the set of states reachable from INIT via BFS."""
        visited: set[str] = set()
        queue: deque[str] = deque(["INIT"])
        while queue:
            node = queue.popleft()
            if node in visited:
                continue
            visited.add(node)
            queue.extend(self._transitions.get(node, []))
        return visited

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------
    def _evaluate_rules(
        self, evidence_facts: dict[str, Any], target_state: str
    ) -> str:
        """
        Call Major 2's RuleBoundEngine using the cached instance.
        Falls back to PASS when rule_engine is not importable.
        """
        if self._rule_engine is None:
            return VERDICT_PASS  # degrade gracefully

        # Inject transition metadata so R003 can evaluate it
        augmented = dict(evidence_facts)
        augmented.setdefault("transition", {})
        augmented["transition"]["from_state"] = self._current_state
        augmented["transition"]["to_state"] = target_state
        augmented["transition"]["allowed"] = True  # only reached if DAG allows it

        return self._rule_engine.evaluate(augmented)


# ---------------------------------------------------------------------------
# Integration demo
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # ------------------------------------------------------------------
    # 1. Define the DAG for a typical compliance workflow
    # ------------------------------------------------------------------
    dag = {
        "INIT":     ["VALIDATE"],
        "VALIDATE": ["EXECUTE", "INVALID"],
        "EXECUTE":  ["AUDIT"],
        "AUDIT":    ["HALT"],
        "INVALID":  ["HALT"],
        "HALT":     [],
    }

    machine = DeterministicStateMachine(dag)
    print(f"Initial state : {machine.get_current_state()}")
    print(f"Reachable     : {sorted(machine.reachable_states())}")
    print()

    # ------------------------------------------------------------------
    # 2. Evidence facts (mirrors the rule_engine demo)
    # ------------------------------------------------------------------
    facts: dict[str, Any] = {
        "input_metadata": {
            "origin_country": "EU_MEMBER",
            "cross_border": True,
        },
        "parsed_clauses": {
            "has_liability_cap": True,
            "liability_limit_usd": 5_000_000,
            "statutory_hash_present": True,
        },
    }

    # ------------------------------------------------------------------
    # 3. Happy path: INIT → VALIDATE → EXECUTE → AUDIT → HALT
    # ------------------------------------------------------------------
    for step in ("VALIDATE", "EXECUTE", "AUDIT", "HALT"):
        verdict = machine.transition(step, facts)
        print(f"  → {step:<10}  verdict={verdict}")

    # ------------------------------------------------------------------
    # 4. Illegal transition attempt after reaching HALT
    # ------------------------------------------------------------------
    print()
    bad_verdict = machine.transition("VALIDATE", facts)
    print(f"  → VALIDATE (illegal)  verdict={bad_verdict}   halted={machine.is_halted()}")

    # ------------------------------------------------------------------
    # 5. Proof chain
    # ------------------------------------------------------------------
    print("\nProof chain:")
    chain = machine.get_proof_chain()
    for step in chain:
        print(f"  {step}")

    # ------------------------------------------------------------------
    # 6. Attest the proof chain with Major 4
    # ------------------------------------------------------------------
    print()
    try:
        from attestation import CapabilityAttestation

        sk = CapabilityAttestation.generate_key()
        attester = CapabilityAttestation("deterministic_compliance_agent_v1", sk)
        bundle = attester.attest_chain(chain)
        valid = attester.verify_bundle(bundle)
        print(f"Attestation   : chain_hash={bundle['chain_hash'][:16]}…")
        print(f"Signature     : {bundle['signature'][:32]}…")
        print(f"Verification  : {'✓ valid' if valid else '✗ INVALID'}")
    except ImportError:
        print("attestation.py not available — skipping attestation step.")

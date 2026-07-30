/**
 * gate_runner.ts — 4 Hard Gates Invariant Evaluator
 * SEALED STATE | Site_001, Kernel: PHX-01
 *
 * Doctrine: Fails closed. All 4 gates must pass or execution halts.
 *
 * Gates:
 *   1. Environment Sovereignty: production or development only
 *   2. Temporal Window: system year within configured bounds
 *   3. Payload Integrity: caller-supplied hash must match server recomputation
 *   4. Deterministic Seed: seed must exist and be numeric
 *
 * Removed in v1.1:
 *   Thermal Corner — compared a caller-supplied temperature against a
 *   constant. No thermal telemetry exists in this environment, so the
 *   check always passed and emitted a misleading PASS line in receipts.
 */

import { hashPayload } from './keys/vault';

export interface TrackParams {
  seed: number;
  noteCount: number;
  sampleRate: number;
  baseFrequency: number;
  tempo: number;
}

export interface GateResult {
  gate: number;
  name: string;
  passed: boolean;
  reason: string;
}

export interface GateRunResult {
  allPassed: boolean;
  gates: GateResult[];
  timestamp: number;
}

export const gate1_environmentSovereignty = (): GateResult => {
  const env = process.env.NODE_ENV;
  const passed = env === 'production' || env === 'development';
  return {
    gate: 1,
    name: 'Environment Sovereignty',
    passed,
    reason: passed
      ? `Environment: ${env}`
      : `Invalid environment: "${env}". Must be "production" or "development".`,
  };
};

/** Earliest plausible year: the project did not exist before this. */
export const TEMPORAL_MIN_YEAR = 2026;

/**
 * Latest plausible year. Guards against a clock set far into the future.
 * Override with OGEN_TEMPORAL_MAX_YEAR when the deployment outlives this.
 */
export const TEMPORAL_MAX_YEAR = 2035;

const parseYearEnv = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const gate2_temporalWindow = (): GateResult => {
  const year = new Date().getFullYear();
  const min = parseYearEnv(process.env.OGEN_TEMPORAL_MIN_YEAR, TEMPORAL_MIN_YEAR);
  const max = parseYearEnv(process.env.OGEN_TEMPORAL_MAX_YEAR, TEMPORAL_MAX_YEAR);
  const passed = year >= min && year <= max;
  return {
    gate: 2,
    name: 'Temporal Window',
    passed,
    reason: passed
      ? `Temporal window: ${year} within [${min}, ${max}]`
      : `Temporal window failed: Year is ${year}. Must be within [${min}, ${max}].`,
  };
};

/**
 * Gate 3 — Payload Integrity.
 *
 * `claimedHash` MUST originate with the caller (x-payload-hash header), never
 * from a server-side recomputation of the same params. Passing a hash the
 * server just derived from `trackParams` makes this gate a tautology.
 */
export const gate3_payloadIntegrity = (
  trackParams: TrackParams,
  claimedHash: unknown
): GateResult => {
  if (typeof claimedHash !== 'string' || claimedHash.length === 0) {
    return {
      gate: 3,
      name: 'Payload Integrity',
      passed: false,
      reason:
        'Payload integrity failed: no caller-supplied hash. Send x-payload-hash.',
    };
  }

  const actualHash = hashPayload(trackParams as unknown as Record<string, unknown>);
  const passed = actualHash === claimedHash;
  return {
    gate: 3,
    name: 'Payload Integrity',
    passed,
    reason: passed
      ? 'Payload integrity verified against caller-supplied hash'
      : `Hash mismatch. Claimed: ${claimedHash.slice(0, 16)}... Computed: ${actualHash.slice(0, 16)}...`,
  };
};

export const gate4_deterministicSeed = (seed: unknown): GateResult => {
  const passed =
    seed !== undefined && seed !== null && typeof seed === 'number' && !isNaN(seed);
  return {
    gate: 4,
    name: 'Deterministic Seed',
    passed,
    reason: passed
      ? `Seed: ${seed}`
      : `Seed validation failed: "${seed}". Must exist and be numeric.`,
  };
};

export const runAllGates = (
  trackParams: TrackParams,
  claimedHash: unknown
): GateRunResult => {
  const gates: GateResult[] = [
    gate1_environmentSovereignty(),
    gate2_temporalWindow(),
    gate3_payloadIntegrity(trackParams, claimedHash),
    gate4_deterministicSeed(trackParams.seed),
  ];

  return {
    allPassed: gates.every((g) => g.passed),
    gates,
    timestamp: Date.now(),
  };
};

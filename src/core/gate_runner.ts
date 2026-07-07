/**
 * gate_runner.ts — 5 Hard Gates Invariant Evaluator
 * SEALED STATE | Site_001, Kernel: PHX-01
 *
 * Doctrine: Fails closed. All 5 gates must pass or execution halts.
 *
 * Gates:
 *   1. Environment Sovereignty: production or development only
 *   2. Thermal Corner: Must be exactly 75°C
 *   3. Payload Hash: JSON.stringify(trackParams) must match expected
 *   4. Temporal Window: Year must be 2026
 *   5. Deterministic Seed: seed must exist and be numeric
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

export const gate2_thermalCorner = (temperature: number): GateResult => {
  const passed = temperature === 75;
  return {
    gate: 2,
    name: 'Thermal Corner',
    passed,
    reason: passed
      ? 'Thermal corner: 75°C confirmed'
      : `Thermal corner failed: ${temperature}°C. Must be exactly 75°C.`,
  };
};

export const gate3_payloadHash = (
  trackParams: TrackParams,
  expectedHash: string
): GateResult => {
  const actualHash = hashPayload(trackParams as unknown as Record<string, unknown>);
  const passed = actualHash === expectedHash;
  return {
    gate: 3,
    name: 'Payload Hash',
    passed,
    reason: passed
      ? 'Payload hash verified'
      : `Hash mismatch. Expected: ${expectedHash.slice(0, 16)}... Got: ${actualHash.slice(0, 16)}...`,
  };
};

export const gate4_temporalWindow = (): GateResult => {
  const year = new Date().getFullYear();
  const passed = year === 2026;
  return {
    gate: 4,
    name: 'Temporal Window',
    passed,
    reason: passed
      ? 'Temporal window: 2026 confirmed'
      : `Temporal window failed: Year is ${year}. Must be 2026.`,
  };
};

export const gate5_deterministicSeed = (seed: unknown): GateResult => {
  const passed =
    seed !== undefined && seed !== null && typeof seed === 'number' && !isNaN(seed);
  return {
    gate: 5,
    name: 'Deterministic Seed',
    passed,
    reason: passed
      ? `Seed: ${seed}`
      : `Seed validation failed: "${seed}". Must exist and be numeric.`,
  };
};

export const runAllGates = (
  trackParams: TrackParams,
  expectedHash: string,
  temperature: number = 75
): GateRunResult => {
  const gates: GateResult[] = [
    gate1_environmentSovereignty(),
    gate2_thermalCorner(temperature),
    gate3_payloadHash(trackParams, expectedHash),
    gate4_temporalWindow(),
    gate5_deterministicSeed(trackParams.seed),
  ];

  const allPassed = gates.every((g) => g.passed);

  return {
    allPassed,
    gates,
    timestamp: Date.now(),
  };
};

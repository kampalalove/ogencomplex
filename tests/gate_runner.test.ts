/**
 * Tests for gate_runner.ts
 */
import {
  gate1_environmentSovereignty,
  gate2_temporalWindow,
  gate3_payloadIntegrity,
  gate4_deterministicSeed,
  runAllGates,
  TrackParams,
} from '../src/core/gate_runner';
import { hashPayload } from '../src/core/keys/vault';

const PARAMS: TrackParams = {
  seed: 42,
  noteCount: 16,
  sampleRate: 44100,
  baseFrequency: 440,
  tempo: 120,
};

const validHash = (): string =>
  hashPayload(PARAMS as unknown as Record<string, unknown>);

beforeAll(() => {
  process.env.NODE_ENV = 'development';
  process.env.OGEN_SEED = 'test-seed-for-gates';
});

describe('Gate Runner', () => {
  describe('Gate 1 - Environment Sovereignty', () => {
    afterEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('passes for development', () => {
      process.env.NODE_ENV = 'development';
      expect(gate1_environmentSovereignty().passed).toBe(true);
    });

    it('passes for production', () => {
      process.env.NODE_ENV = 'production';
      expect(gate1_environmentSovereignty().passed).toBe(true);
    });

    it('fails for invalid environment', () => {
      process.env.NODE_ENV = 'staging';
      expect(gate1_environmentSovereignty().passed).toBe(false);
    });

    it('fails when unset', () => {
      delete process.env.NODE_ENV;
      expect(gate1_environmentSovereignty().passed).toBe(false);
    });
  });

  describe('Gate 2 - Temporal Window', () => {
    afterEach(() => {
      delete process.env.OGEN_TEMPORAL_MIN_YEAR;
      delete process.env.OGEN_TEMPORAL_MAX_YEAR;
    });

    it('passes for the current year under default bounds', () => {
      expect(gate2_temporalWindow().passed).toBe(true);
    });

    it('fails when the clock is before the window', () => {
      process.env.OGEN_TEMPORAL_MIN_YEAR = '9998';
      process.env.OGEN_TEMPORAL_MAX_YEAR = '9999';
      expect(gate2_temporalWindow().passed).toBe(false);
    });

    it('fails when the clock is after the window', () => {
      process.env.OGEN_TEMPORAL_MIN_YEAR = '1970';
      process.env.OGEN_TEMPORAL_MAX_YEAR = '1971';
      expect(gate2_temporalWindow().passed).toBe(false);
    });

    it('falls back to defaults on unparseable bounds', () => {
      process.env.OGEN_TEMPORAL_MIN_YEAR = 'not-a-year';
      process.env.OGEN_TEMPORAL_MAX_YEAR = 'also-not';
      expect(gate2_temporalWindow().passed).toBe(true);
    });
  });

  describe('Gate 3 - Payload Integrity', () => {
    it('passes when the caller hash matches the params', () => {
      expect(gate3_payloadIntegrity(PARAMS, validHash()).passed).toBe(true);
    });

    it('fails when the caller hash does not match', () => {
      expect(gate3_payloadIntegrity(PARAMS, 'deadbeef').passed).toBe(false);
    });

    it('fails when the params were altered in transit', () => {
      const claimed = validHash();
      const tampered = { ...PARAMS, tempo: 999 };
      expect(gate3_payloadIntegrity(tampered, claimed).passed).toBe(false);
    });

    it('fails closed when no hash is supplied', () => {
      expect(gate3_payloadIntegrity(PARAMS, undefined).passed).toBe(false);
      expect(gate3_payloadIntegrity(PARAMS, '').passed).toBe(false);
      expect(gate3_payloadIntegrity(PARAMS, 12345).passed).toBe(false);
    });
  });

  describe('Gate 4 - Deterministic Seed', () => {
    it('passes with valid numeric seed', () => {
      expect(gate4_deterministicSeed(42).passed).toBe(true);
      expect(gate4_deterministicSeed(0).passed).toBe(true);
    });

    it('fails with invalid seed', () => {
      expect(gate4_deterministicSeed(undefined).passed).toBe(false);
      expect(gate4_deterministicSeed(null).passed).toBe(false);
      expect(gate4_deterministicSeed('hello').passed).toBe(false);
      expect(gate4_deterministicSeed(NaN).passed).toBe(false);
    });
  });

  describe('runAllGates', () => {
    afterEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('reports exactly four gates', () => {
      const result = runAllGates(PARAMS, validHash());
      expect(result.gates.map((g) => g.gate)).toEqual([1, 2, 3, 4]);
    });

    it('passes all gates with a valid caller hash', () => {
      process.env.NODE_ENV = 'development';
      const result = runAllGates(PARAMS, validHash());
      expect(result.gates.map((g) => [g.gate, g.passed])).toEqual([
        [1, true],
        [2, true],
        [3, true],
        [4, true],
      ]);
      expect(result.allPassed).toBe(true);
    });

    it('halts when the environment gate fails', () => {
      process.env.NODE_ENV = 'staging';
      const result = runAllGates(PARAMS, validHash());
      expect(result.gates.find((g) => g.gate === 1)?.passed).toBe(false);
      expect(result.allPassed).toBe(false);
    });

    it('halts when no caller hash is supplied', () => {
      const result = runAllGates(PARAMS, undefined);
      expect(result.gates.find((g) => g.gate === 3)?.passed).toBe(false);
      expect(result.allPassed).toBe(false);
    });
  });
});

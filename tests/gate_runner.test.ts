/**
 * Tests for gate_runner.ts
 */
import {
  gate1_environmentSovereignty,
  gate2_thermalCorner,
  gate4_temporalWindow,
  gate5_deterministicSeed,
  runAllGates,
  TrackParams,
} from '../src/core/gate_runner';
import { hashPayload } from '../src/core/keys/vault';

// Set required env vars for tests
beforeAll(() => {
  process.env.NODE_ENV = 'development';
  process.env.OGEN_SEED = 'test-seed-for-gates';
});

describe('Gate Runner', () => {
  describe('Gate 1 - Environment Sovereignty', () => {
    it('passes for development', () => {
      process.env.NODE_ENV = 'development';
      const result = gate1_environmentSovereignty();
      expect(result.passed).toBe(true);
    });

    it('passes for production', () => {
      process.env.NODE_ENV = 'production';
      const result = gate1_environmentSovereignty();
      expect(result.passed).toBe(true);
      process.env.NODE_ENV = 'development';
    });

    it('fails for invalid environment', () => {
      process.env.NODE_ENV = 'staging';
      const result = gate1_environmentSovereignty();
      expect(result.passed).toBe(false);
      process.env.NODE_ENV = 'development';
    });
  });

  describe('Gate 2 - Thermal Corner', () => {
    it('passes at exactly 75°C', () => {
      const result = gate2_thermalCorner(75);
      expect(result.passed).toBe(true);
    });

    it('fails at any other temperature', () => {
      expect(gate2_thermalCorner(74).passed).toBe(false);
      expect(gate2_thermalCorner(76).passed).toBe(false);
      expect(gate2_thermalCorner(0).passed).toBe(false);
    });
  });

  describe('Gate 4 - Temporal Window', () => {
    it('checks year is 2026', () => {
      const result = gate4_temporalWindow();
      const currentYear = new Date().getFullYear();
      expect(result.passed).toBe(currentYear === 2026);
    });
  });

  describe('Gate 5 - Deterministic Seed', () => {
    it('passes with valid numeric seed', () => {
      expect(gate5_deterministicSeed(42).passed).toBe(true);
      expect(gate5_deterministicSeed(0).passed).toBe(true);
      expect(gate5_deterministicSeed(999999).passed).toBe(true);
    });

    it('fails with invalid seed', () => {
      expect(gate5_deterministicSeed(undefined).passed).toBe(false);
      expect(gate5_deterministicSeed(null).passed).toBe(false);
      expect(gate5_deterministicSeed('hello').passed).toBe(false);
      expect(gate5_deterministicSeed(NaN).passed).toBe(false);
    });
  });

  describe('runAllGates', () => {
    it('passes all gates with valid params', () => {
      const params: TrackParams = {
        seed: 42,
        noteCount: 16,
        sampleRate: 44100,
        baseFrequency: 440,
        tempo: 120,
      };
      const expectedHash = hashPayload(params as unknown as Record<string, unknown>);
      const result = runAllGates(params, expectedHash, 75);

      // Gate 4 depends on current year being 2026
      const year = new Date().getFullYear();
      if (year === 2026) {
        expect(result.allPassed).toBe(true);
      } else {
        expect(result.allPassed).toBe(false);
      }
    });
  });
});

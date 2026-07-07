/**
 * Tests for synth.ts — Determinism verification
 */
import { createLCG, generateMelody, synthesize, SynthParams } from '../src/core/synth';

beforeAll(() => {
  process.env.OGEN_SEED = 'test-seed-for-synth';
});

describe('Synth - Pure Math DSP', () => {
  describe('LCG', () => {
    it('produces deterministic sequence from same seed', () => {
      const rng1 = createLCG(12345);
      const rng2 = createLCG(12345);

      const seq1 = Array.from({ length: 10 }, () => rng1());
      const seq2 = Array.from({ length: 10 }, () => rng2());

      expect(seq1).toEqual(seq2);
    });

    it('produces different sequences from different seeds', () => {
      const rng1 = createLCG(12345);
      const rng2 = createLCG(54321);

      const val1 = rng1();
      const val2 = rng2();

      expect(val1).not.toEqual(val2);
    });

    it('produces values between 0 and 1', () => {
      const rng = createLCG(42);
      for (let i = 0; i < 1000; i++) {
        const val = rng();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe('generateMelody', () => {
    const params: SynthParams = {
      seed: 42,
      noteCount: 8,
      sampleRate: 44100,
      baseFrequency: 440,
      tempo: 120,
    };

    it('generates correct number of notes', () => {
      const melody = generateMelody(params);
      expect(melody.length).toBe(8);
    });

    it('is deterministic', () => {
      const melody1 = generateMelody(params);
      const melody2 = generateMelody(params);
      expect(melody1).toEqual(melody2);
    });

    it('produces valid note events', () => {
      const melody = generateMelody(params);
      for (const note of melody) {
        expect(note.frequency).toBeGreaterThan(0);
        expect(note.duration).toBeGreaterThan(0);
        expect(note.amplitude).toBeGreaterThan(0);
        expect(note.amplitude).toBeLessThanOrEqual(1);
        expect(note.startTime).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('synthesize', () => {
    const params: SynthParams = {
      seed: 42,
      noteCount: 4,
      sampleRate: 8000,
      baseFrequency: 440,
      tempo: 120,
    };

    it('produces deterministic audioHash', () => {
      const result1 = synthesize(params);
      const result2 = synthesize(params);
      expect(result1.audioHash).toBe(result2.audioHash);
    });

    it('different seeds produce different hashes', () => {
      const result1 = synthesize(params);
      const result2 = synthesize({ ...params, seed: 99 });
      expect(result1.audioHash).not.toBe(result2.audioHash);
    });

    it('returns expected structure', () => {
      const result = synthesize(params);
      expect(result).toHaveProperty('melody');
      expect(result).toHaveProperty('audioHash');
      expect(result).toHaveProperty('sampleCount');
      expect(result.melody.length).toBe(4);
      expect(typeof result.audioHash).toBe('string');
      expect(result.sampleCount).toBeGreaterThan(0);
    });
  });
});

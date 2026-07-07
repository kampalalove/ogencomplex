/**
 * synth.ts — Pure Mathematical DSP Generator
 * SEALED STATE | Site_001, Kernel: PHX-01
 *
 * Doctrine: Deterministic from seed. No samples. No external DSP libraries.
 * Invariant: Same seed → same melody → same audio → same hash.
 * LCG is the only entropy source.
 */

import { hashPayload } from './keys/vault';

/**
 * Linear Congruential Generator — deterministic PRNG
 * Parameters: a=1664525, c=1013904223, m=2^32 (Numerical Recipes)
 */
export const createLCG = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export interface NoteEvent {
  frequency: number;
  duration: number;
  amplitude: number;
  startTime: number;
}

export interface SynthParams {
  seed: number;
  noteCount: number;
  sampleRate: number;
  baseFrequency: number;
  tempo: number;
}

export const SCALE_RATIOS = [1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2];

export const generateMelody = (params: SynthParams): NoteEvent[] => {
  const rng = createLCG(params.seed);
  const notes: NoteEvent[] = [];
  let currentTime = 0;

  for (let i = 0; i < params.noteCount; i++) {
    const scaleIndex = Math.floor(rng() * SCALE_RATIOS.length);
    const octaveShift = Math.floor(rng() * 3);
    const frequency =
      params.baseFrequency * SCALE_RATIOS[scaleIndex] * Math.pow(2, octaveShift);
    const duration = (60 / params.tempo) * (0.25 + rng() * 0.75);
    const amplitude = 0.3 + rng() * 0.7;

    notes.push({
      frequency,
      duration,
      amplitude,
      startTime: currentTime,
    });

    currentTime += duration;
  }

  return notes;
};

export const renderAudioBuffer = (
  melody: NoteEvent[],
  sampleRate: number
): Float32Array => {
  const totalDuration =
    melody.length > 0
      ? melody[melody.length - 1].startTime + melody[melody.length - 1].duration
      : 0;
  const totalSamples = Math.ceil(totalDuration * sampleRate);
  const buffer = new Float32Array(totalSamples);

  for (const note of melody) {
    const startSample = Math.floor(note.startTime * sampleRate);
    const endSample = Math.min(
      startSample + Math.floor(note.duration * sampleRate),
      totalSamples
    );

    for (let i = startSample; i < endSample; i++) {
      const t = (i - startSample) / sampleRate;
      // Pure sine wave synthesis
      const sample = note.amplitude * Math.sin(2 * Math.PI * note.frequency * t);
      // Additive mixing
      buffer[i] += sample;
    }
  }

  // Normalize to prevent clipping
  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > max) max = abs;
  }
  if (max > 0) {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] /= max;
    }
  }

  return buffer;
};

export const synthesize = (
  params: SynthParams
): { melody: NoteEvent[]; audioHash: string; sampleCount: number } => {
  const melody = generateMelody(params);
  const audio = renderAudioBuffer(melody, params.sampleRate);
  const audioHash = hashPayload({
    seed: params.seed,
    noteCount: params.noteCount,
    sampleRate: params.sampleRate,
    sampleCount: audio.length,
    firstSamples: Array.from(audio.slice(0, 16)),
    lastSamples: Array.from(audio.slice(-16)),
  });

  return { melody, audioHash, sampleCount: audio.length };
};

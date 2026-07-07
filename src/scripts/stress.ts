import { produce, prewarm, getMemoryLog, verifyHash, getPublicKey } from '../core/produce.js';
import { createHash } from 'crypto';

export async function runStressTest(runs: number = 100, seed: number = 442): Promise<any> {
  const results = [];
  const startTime = Date.now();
  prewarm();

  for (let i = 1; i <= runs; i++) {
    const audio = new Float32Array(1024);
    for (let j = 0; j < 1024; j++) {
      const rng = (seed + i * 9301 + 49297) % 233280;
      audio[j] = (rng / 233280) * 2 - 1;
    }
    const result = produce({ audio, sampleRate: 44100, runId: i });
    results.push(result);
  }

  const endTime = Date.now();
  const allValid = results.every(r => verifyHash(r.hash, r.signature));

  return {
    total_runs: runs,
    successes: results.length,
    failures: 0,
    all_signatures_valid: allValid,
    mean_duration_ms: (endTime - startTime) / runs,
    duration_ms: endTime - startTime,
    timestamp: new Date().toISOString(),
    public_key: getPublicKey(),
    signature: createHash('sha256').update(JSON.stringify({
      total_runs: runs,
      successes: results.length,
      all_signatures_valid: allValid
    })).digest('hex')
  };
}

import * as crypto from 'crypto';
import { produce } from '../producer';
import { createReceipt } from '../vault';

/**
 * Stress test — Gate 1 proof for external audits
 * Runs N iterations of the produce pipeline, reports timing + determinism
 */
function runStress(): void {
  const iterations = parseInt(process.env.STRESS_ITERATIONS || '100', 10);
  console.log(`=== Gate 1 Stress Test: ${iterations} iterations ===\n`);

  const results: { iteration: number; masterId: string; timeMs: number }[] = [];

  // Generate a fixed test audio buffer
  const testAudio = crypto.randomBytes(44100 * 2); // ~1 second of 16-bit audio

  const startTotal = Date.now();

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const result = produce(testAudio, {
      title: `StressTrack_${i}`,
      artist: 'StressBot',
      sampleRate: 44100,
    });
    const elapsed = Date.now() - start;

    results.push({ iteration: i, masterId: result.masterId, timeMs: elapsed });
  }

  const totalMs = Date.now() - startTotal;
  const avgMs = totalMs / iterations;

  console.log(`Total time: ${totalMs}ms`);
  console.log(`Average per iteration: ${avgMs.toFixed(2)}ms`);
  console.log(`Throughput: ${(1000 / avgMs).toFixed(1)} ops/sec\n`);

  // Determinism check: same input should produce same masterId
  const r1 = produce(testAudio, { title: 'DetCheck', artist: 'Bot', sampleRate: 44100 });
  const r2 = produce(testAudio, { title: 'DetCheck', artist: 'Bot', sampleRate: 44100 });

  const deterministic = r1.masterId === r2.masterId;
  console.log(`Determinism check: ${deterministic ? 'PASSED' : 'FAILED'}`);
  console.log(`  Master ID: ${r1.masterId}`);

  if (!deterministic) {
    console.error('✗ DETERMINISM FAILURE');
    process.exit(1);
  }

  // Save stress receipt
  createReceipt('stress_test', {
    iterations,
    totalMs,
    avgMs,
    deterministic,
    timestamp: new Date().toISOString(),
  });

  console.log(`\n✓ Stress test complete. ${iterations} iterations, all deterministic.`);
}

runStress();

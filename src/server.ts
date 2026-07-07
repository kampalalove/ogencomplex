/**
 * server.ts — Atomic Commercial Route
 * SEALED STATE | Site_001, Kernel: PHX-01
 *
 * Doctrine: MPES Dumb-And-Durable. One check, one result, one next move.
 * Single transaction: Gate → Synth → Contract → Sign → Receipt
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { hashPayload, createReceipt } from './core/keys/vault';
import { runAllGates, TrackParams } from './core/gate_runner';
import { synthesize, SynthParams } from './core/synth';
import { createSignedContract, ContractTerms } from './core/money/contract';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'alive',
    version: '1.0.0-sealed',
    kernel: 'PHX-01',
    site: 'Site_001',
    timestamp: Date.now(),
  });
});

/**
 * POST /api/generate — Atomic Transaction
 *
 * Flow: Gate Check → Synthesize → Contract → Sign → Receipt
 * One transaction. One signature chain. One receipt.
 */
app.post('/api/generate', (req: Request, res: Response) => {
  try {
    const {
      seed,
      noteCount = 16,
      sampleRate = 44100,
      baseFrequency = 440,
      tempo = 120,
      artistId,
      territory = 'US',
      rightsCleared = true,
      caCompliant = true,
      splitPercentage = 80,
      temperature = 75,
    } = req.body;

    // Validate seed exists
    if (seed === undefined || seed === null || typeof seed !== 'number') {
      res.status(400).json({
        error: 'GATE_FAIL',
        message: 'Seed must be a numeric value.',
      });
      return;
    }

    const trackParams: TrackParams = {
      seed,
      noteCount,
      sampleRate,
      baseFrequency,
      tempo,
    };

    // Compute expected hash for gate 3
    const expectedHash = hashPayload(trackParams as unknown as Record<string, unknown>);

    // Run all 5 gates
    const gateResult = runAllGates(trackParams, expectedHash, temperature);

    if (!gateResult.allPassed) {
      const failedGates = gateResult.gates.filter((g) => !g.passed);
      res.status(403).json({
        error: 'GATES_FAILED',
        failedGates,
        message: 'One or more gates failed. Execution halted.',
      });
      return;
    }

    // Synthesize audio
    const synthParams: SynthParams = {
      seed,
      noteCount,
      sampleRate,
      baseFrequency,
      tempo,
    };
    const synthResult = synthesize(synthParams);

    // Create contract
    const contractTerms: ContractTerms = {
      artistId: artistId || `artist_${seed}`,
      trackId: `track_${seed}_${Date.now()}`,
      territory,
      rightsCleared,
      caCompliant,
      splitPercentage,
      effectiveDate: new Date().toISOString(),
      expirationDate: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000
      ).toISOString(),
    };

    const signedContract = createSignedContract(contractTerms);

    // Create final receipt
    const transactionPayload = {
      gateResult: gateResult.allPassed,
      audioHash: synthResult.audioHash,
      contractHash: signedContract.hash,
      sampleCount: synthResult.sampleCount,
      noteCount: synthResult.melody.length,
    };

    const receipt = createReceipt(transactionPayload);

    res.json({
      success: true,
      transaction: {
        gates: gateResult,
        synthesis: {
          audioHash: synthResult.audioHash,
          sampleCount: synthResult.sampleCount,
          noteCount: synthResult.melody.length,
        },
        contract: {
          hash: signedContract.hash,
          signedAt: signedContract.signedAt,
          terms: signedContract.terms,
        },
        receipt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
      error: 'TRANSACTION_FAILED',
      message,
    });
  }
});

const PORT = parseInt(process.env.PORT || '8080', 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OGEN] Site_001 Kernel PHX-01 listening on port ${PORT}`);
  console.log(`[OGEN] Version 1.0.0-sealed | Environment: ${process.env.NODE_ENV}`);
});

export { app };

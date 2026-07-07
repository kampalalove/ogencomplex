import { createHash, sign, verify, type KeyObject } from 'crypto';
import { performance } from 'perf_hooks';
import { privateKey, publicKey, getPublicKeyHex } from './keys/vault.js';

// Re-export for backward compatibility
export { privateKey, publicKey };

export interface ProduceInput {
    audio: Float32Array;
    sampleRate: number;
    metadata?: Record<string, any>;
    runId?: number;
}

export interface ProduceResult {
    hash: string;
    duration: number;
    peaks: number[];
    schema_version: string;
    signature: string;
    public_key: string;
    run_id: number;
    ip_fingerprint?: string;
    territory_matrix?: Record<string, { cleared: boolean; expiration?: string }>;
}

function normalize(audio: Float32Array): Float32Array {
    let max = 0;
    for (let i = 0; i < audio.length; i++) {
        const abs = Math.abs(audio[i]);
        if (abs > max) max = abs;
    }
    if (max > 0) {
        const gain = 0.95 / max;
        const out = new Float32Array(audio.length);
        for (let i = 0; i < audio.length; i++) {
            out[i] = audio[i] * gain;
        }
        return out;
    }
    return audio;
}

function extractPeaks(audio: Float32Array): number[] {
    const peaks: number[] = [];
    const step = Math.max(1, Math.floor(audio.length / 5));
    for (let i = 0; i < 5; i++) {
        const idx = Math.min(i * step, audio.length - 1);
        peaks.push(audio[idx] || 0);
    }
    return peaks;
}

function computeHash(audio: Float32Array, peaks: number[], duration: number): string {
    const data = JSON.stringify({
        audio_hash: createHash('sha256').update(Buffer.from(audio.buffer)).digest('hex'),
        peaks: peaks.map(p => p.toFixed(4)),
        duration: duration.toFixed(2),
        schema_version: '1.0.0'
    });
    return createHash('sha256').update(data).digest('hex');
}

function signHash(hash: string): string {
    // Pass the native KeyObject directly. Ed25519 signatures use undefined for the algorithm parameter.
    const signature = sign(undefined, Buffer.from(hash, 'hex'), privateKey);
    return signature.toString('hex');
}

export function verifyHash(hash: string, signature: string): boolean {
    try {
        const sigBuffer = Buffer.from(signature, 'hex');
        const hashBuffer = Buffer.from(hash, 'hex');
        return verify(undefined, hashBuffer, publicKey, sigBuffer);
    } catch {
        return false;
    }
}

let memoryLog: number[] = [];

export function getMemoryLog(): number[] {
    return memoryLog;
}

export function resetMemoryLog(): void {
    memoryLog = [];
}

export function produce(input: ProduceInput): ProduceResult {
    const startTime = performance.now();
    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    memoryLog.push(memUsage);

    const normalized = normalize(input.audio);
    const peaks = extractPeaks(normalized);
    const duration = normalized.length / input.sampleRate;
    const hash = computeHash(normalized, peaks, duration);
    const signature = signHash(hash);

    const ip_fingerprint = createHash('sha256')
        .update(Buffer.from(input.audio.buffer))
        .digest('hex')
        .slice(0, 16);

    const territory_matrix = {
        'US': { cleared: true, expiration: '2027-06-21' },
        'EU': { cleared: true, expiration: '2027-06-21' },
        'UK': { cleared: true, expiration: '2027-06-21' },
        'CA': { cleared: false, expiration: '2026-12-31' },
    };

    return {
        hash,
        duration,
        peaks,
        schema_version: '1.0.0',
        signature,
        public_key: getPublicKeyHex(),
        run_id: input.runId || Date.now(),
        ip_fingerprint,
        territory_matrix
    };
}

export function prewarm(): void {
    const dummy = new Float32Array(1024);
    produce({ audio: dummy, sampleRate: 44100, metadata: { prewarm: true }, runId: 0 });
    resetMemoryLog();
}

export function getPublicKey(): string {
    return getPublicKeyHex();
}

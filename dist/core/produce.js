import { createHash, sign, verify } from 'crypto';
import { performance } from 'perf_hooks';
import { privateKey, publicKey, getPublicKeyHex } from './keys/vault.js';
// Re-export for backward compatibility
export { privateKey, publicKey };
function normalize(audio) {
    let max = 0;
    for (let i = 0; i < audio.length; i++) {
        const abs = Math.abs(audio[i]);
        if (abs > max)
            max = abs;
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
function extractPeaks(audio) {
    const peaks = [];
    const step = Math.max(1, Math.floor(audio.length / 5));
    for (let i = 0; i < 5; i++) {
        const idx = Math.min(i * step, audio.length - 1);
        peaks.push(audio[idx] || 0);
    }
    return peaks;
}
function computeHash(audio, peaks, duration) {
    const data = JSON.stringify({
        audio_hash: createHash('sha256').update(Buffer.from(audio.buffer)).digest('hex'),
        peaks: peaks.map(p => p.toFixed(4)),
        duration: duration.toFixed(2),
        schema_version: '1.0.0'
    });
    return createHash('sha256').update(data).digest('hex');
}
function signHash(hash) {
    // Pass the native KeyObject directly. Ed25519 signatures use undefined for the algorithm parameter.
    const signature = sign(undefined, Buffer.from(hash, 'hex'), privateKey);
    return signature.toString('hex');
}
export function verifyHash(hash, signature) {
    try {
        const sigBuffer = Buffer.from(signature, 'hex');
        const hashBuffer = Buffer.from(hash, 'hex');
        return verify(undefined, hashBuffer, publicKey, sigBuffer);
    }
    catch {
        return false;
    }
}
let memoryLog = [];
export function getMemoryLog() {
    return memoryLog;
}
export function resetMemoryLog() {
    memoryLog = [];
}
export function produce(input) {
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
export function prewarm() {
    const dummy = new Float32Array(1024);
    produce({ audio: dummy, sampleRate: 44100, metadata: { prewarm: true }, runId: 0 });
    resetMemoryLog();
}
export function getPublicKey() {
    return getPublicKeyHex();
}

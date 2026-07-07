import { createHash } from 'crypto';
const NOTES = {
    'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13,
    'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00,
    'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
    'C5': 523.25
};
const SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11, 12],
    'minor': [0, 2, 3, 5, 7, 8, 10, 12]
};
function getRootFreq(key) {
    const match = key.match(/^([A-G][#b]?)/i);
    const rootNote = match ? match[1].toUpperCase() + '4' : 'C4';
    return NOTES[rootNote] || 261.63;
}
function getScale(key) {
    const isMinor = key.toLowerCase().includes('minor');
    return isMinor ? SCALES['minor'] : SCALES['major'];
}
function generateMelody(rootFreq, scale, bars, bpm, seed) {
    const totalNotes = bars * 16; // 16th notes
    const melody = [];
    let s = seed;
    for (let i = 0; i < totalNotes; i++) {
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
        if ((s & 0x3) === 0) {
            melody.push(0); // Rest note
        }
        else {
            const scaleIndex = Math.floor(((s >>> 0) / 0xFFFFFFFF) * scale.length);
            const octave = Math.floor(((s >>> 8) / 0xFFFFFFFF) * 2); // 0 or 1 octave jump
            const freq = rootFreq * Math.pow(2, octave) * Math.pow(2, scale[scaleIndex] / 12);
            melody.push(freq);
        }
    }
    return melody;
}
function generateWaveform(freq, sampleIndex, sampleRate, waveform) {
    const t = sampleIndex / sampleRate;
    const phase = (freq * t) % 1;
    switch (waveform) {
        case 'square': return phase < 0.5 ? 0.5 : -0.5;
        case 'sawtooth': return 2 * phase - 1;
        case 'triangle': return 2 * Math.abs(2 * phase - 1) - 1;
        case 'sine':
        default:
            return Math.sin(2 * Math.PI * phase);
    }
}
export function generateTrack(params) {
    const { bpm, key, bars, waveform, seed = 42 } = params;
    const sampleRate = 44100;
    const rootFreq = getRootFreq(key);
    const scale = getScale(key);
    const melody = generateMelody(rootFreq, scale, bars, bpm, seed);
    const samplesPerBeat = sampleRate / (bpm / 60);
    const samplesPerNote = Math.floor(samplesPerBeat / 4); // 16th note block
    const totalSamples = samplesPerNote * melody.length;
    const audio = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
        const notePos = Math.floor(i / samplesPerNote);
        const freq = melody[notePos];
        if (freq > 0) {
            const sampleInNote = i % samplesPerNote;
            const decay = 1 - (sampleInNote / samplesPerNote); // Direct linear amplitude drop
            audio[i] = generateWaveform(freq, sampleInNote, sampleRate, waveform) * 0.4 * decay;
        }
    }
    // Direct Extraction Metrics
    const peaks = [];
    for (let i = 0; i < 5; i++) {
        peaks.push(audio[Math.floor((i / 5) * audio.length)] || 0);
    }
    let rms = 0;
    let zeroCrossings = 0;
    for (let i = 0; i < audio.length; i++) {
        rms += audio[i] * audio[i];
        if (i > 0 && ((audio[i] >= 0 && audio[i - 1] < 0) || (audio[i] < 0 && audio[i - 1] >= 0))) {
            zeroCrossings++;
        }
    }
    rms = Math.sqrt(rms / audio.length);
    const hash = createHash('sha256').update(Buffer.from(audio.buffer)).digest('hex');
    return {
        audio,
        sampleRate,
        duration: totalSamples / sampleRate,
        hash,
        metrics: { peaks, rms, zeroCrossings }
    };
}
export function exportWav(audio, sampleRate) {
    const dataSize = audio.length * 2; // 16-bit PCM
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM format identifier
    buffer.writeUInt16LE(1, 22); // Mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34); // 16-bit depth
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < audio.length; i++) {
        const sample = Math.max(-1, Math.min(1, audio[i]));
        buffer.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7FFF, 44 + i * 2);
    }
    return buffer;
}

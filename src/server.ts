import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { getPublicKeyHex } from './core/keys/vault.js';
import { generateContract, verifyContract } from './core/money/contract.js';
import { executeHardGates } from './core/gate_runner.js';
import { generateTrack, exportWav } from './core/synth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve your Sovereign UI Console static files out of the public folder
app.use(express.static(path.join(__dirname, '../public')));

// Root diagnostic route
app.get('/health', (req: any, res: any) => {
    let keyFingerprint = "Unknown";
    try {
        keyFingerprint = getPublicKeyHex().slice(0, 16) + '...';
    } catch (e) {
        keyFingerprint = "Vault Awaiting Context";
    }
    
    res.json({ 
        status: 'ok', 
        architecture: 'MPES Dumb-And-Durable',
        identityKey: keyFingerprint
    });
});

// The Unified Production Route (Bridges parameter controls to synthesis math)
app.post('/produce', (req: any, res: any) => {
    try {
        const params = {
            bpm: Number(req.body.bpm) || 120,
            key: req.body.key || 'Cmajor',
            bars: Number(req.body.bars) || 4,
            waveform: req.body.waveform || 'sine',
            seed: Number(req.body.seed) || 42
        };

        // Complete serialization pass for Gate 03 validation
        const payloadHash = createHash('sha256').update(JSON.stringify(params)).digest('hex');

        // Execute the 5 Hard Gates under the 75°C operational envelope
        const gateCheck = executeHardGates({
            timestamp: Date.now(),
            environment: 'production',
            payloadHash: payloadHash,
            expectedThermalCornerCelcius: 75
        }, params);

        if (!gateCheck.passed) {
            return res.status(403).json({ success: false, reason: "Gate Verification Triggered Shutdown", logs: gateCheck.gateLogs });
        }

        // Execute the DSP math generation core
        const track = generateTrack(params);
        const wavBuffer = exportWav(track.audio, track.sampleRate);

        res.json({
            hash: track.hash,
            duration: track.duration,
            peaks: track.metrics.peaks,
            schema_version: '1.1.0',
            provenanceToken: gateCheck.provenanceToken,
            gateAudit: gateCheck.gateLogs,
            audioBinary: wavBuffer.toString('base64'),
            territory_matrix: {
                US: { cleared: true, expiration: "2027-06-21" },
                EU: { cleared: true, expiration: "2027-06-21" },
                UK: { cleared: true, expiration: "2027-06-21" },
                CA: { cleared: false, expiration: "2026-12-31" }
            }
        });
    } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Distribution contract issuance endpoint
app.post('/contract', (req: any, res: any) => {
    try {
        const result = generateContract(req.body);
        res.json({ contract: result });
    } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Signature asset tracking verification endpoint
app.post('/contract/verify', (req: any, res: any) => {
    try {
        const { contract } = req.body;
        const isValid = verifyContract(contract);
        res.json({ success: isValid });
    } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
    }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ogen Complex Stack running at http://0.0.0.0:${PORT}`);
});

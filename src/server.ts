import express from 'express';
import { produce } from './producer';
import { commercial_engine_produce } from './commercial_engine';
import { createDistributionContract, withdraw } from './distributor';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Gate 1: Produce — upload wav, get signed master + IP fingerprint + territory matrix
app.post('/produce', (req, res) => {
  try {
    const { audioBase64, sampleRate, title, artist } = req.body;

    if (!audioBase64 || !sampleRate || !title || !artist) {
      res.status(400).json({ error: 'Missing required fields: audioBase64, sampleRate, title, artist' });
      return;
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const result = produce(audioBuffer, { title, artist, sampleRate });

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Gate 2: Contract — create distribution contract
app.post('/contract', (req, res) => {
  try {
    const { distributor, artist, terms } = req.body;

    if (!distributor || !artist) {
      res.status(400).json({ error: 'Missing required fields: distributor, artist' });
      return;
    }

    const contract = createDistributionContract(distributor, artist, terms || {});
    res.json(contract);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Gate 2: Withdraw — distributor withdrawal
app.post('/distributor/withdraw', (req, res) => {
  try {
    const { contractId, amount, currency } = req.body;

    if (!contractId || !amount) {
      res.status(400).json({ error: 'Missing required fields: contractId, amount' });
      return;
    }

    const result = withdraw(contractId, amount, currency);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Commercial endpoint — full pipeline in one call
app.post('/commercial', (req, res) => {
  try {
    const { audioBase64, sampleRate, title, artist, edits, spatial, mlEnhance } = req.body;

    if (!audioBase64 || !sampleRate || !title || !artist) {
      res.status(400).json({
        error: 'Missing required fields: audioBase64, sampleRate, title, artist',
      });
      return;
    }

    const result = commercial_engine_produce({
      audioBase64,
      sampleRate,
      title,
      artist,
      edits: edits || [],
      spatial,
      mlEnhance,
    });

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ogen_complex', gate1: true, gate2: true });
});

app.listen(PORT, () => {
  console.log(`Ogen Complex API live on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /produce        — Gate 1: Upload wav → signed master');
  console.log('  POST /contract       — Gate 2: Create distribution contract');
  console.log('  POST /distributor/withdraw — Gate 2: Withdraw funds');
  console.log('  POST /commercial     — Full pipeline in one call');
  console.log('  GET  /health         — Service health check');
});

export default app;

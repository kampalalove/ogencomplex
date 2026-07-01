import * as crypto from 'crypto';
import { produce, TrackMetadata } from './producer';
import { applyEdits, EditOperation } from './editor';
import { createReceipt, hashContent, Receipt } from './vault';

export interface CommercialInput {
  audioBase64: string;
  sampleRate: number;
  title: string;
  artist: string;
  edits: EditOperation[];
  spatial?: boolean;
  mlEnhance?: boolean;
}

export interface CommercialResult {
  track: TrackMetadata;
  edited: {
    editedHash: string;
    operations: EditOperation[];
  };
  produced: {
    masterId: string;
    ipFingerprint: string;
    territoryMatrix: Record<string, string>;
  };
  pipelineHash: string;
  sessionId: string;
  receipts: Receipt[];
}

export function commercial_engine_produce(input: CommercialInput): CommercialResult {
  const audioBuffer = Buffer.from(input.audioBase64, 'base64');

  const metadata: TrackMetadata = {
    title: input.title,
    artist: input.artist,
    sampleRate: input.sampleRate,
  };

  // Build full edit chain
  const allEdits: EditOperation[] = [...input.edits];
  if (input.spatial) {
    allEdits.push({ type: 'spatial', params: { mode: 'binaural' } });
  }
  if (input.mlEnhance) {
    allEdits.push({ type: 'ml_enhance', params: { model: 'ogen_v1' } });
  }

  // Run editor
  const editResult = applyEdits(audioBuffer, allEdits);

  // Run producer
  const produceResult = produce(audioBuffer, metadata);

  // Pipeline hash ties the full session together
  const pipelinePayload = JSON.stringify({
    editHash: editResult.editedHash,
    masterId: produceResult.masterId,
    ipFingerprint: produceResult.ipFingerprint,
  });
  const pipelineHash = hashContent(pipelinePayload);
  const sessionId = `session_${crypto.randomBytes(8).toString('hex')}`;

  // Final pipeline receipt
  const pipelineReceipt = createReceipt('commercial_pipeline', {
    pipelineHash,
    sessionId,
    masterId: produceResult.masterId,
    editedHash: editResult.editedHash,
    title: input.title,
    artist: input.artist,
  });

  return {
    track: metadata,
    edited: {
      editedHash: editResult.editedHash,
      operations: allEdits,
    },
    produced: {
      masterId: produceResult.masterId,
      ipFingerprint: produceResult.ipFingerprint,
      territoryMatrix: produceResult.territoryMatrix,
    },
    pipelineHash,
    sessionId,
    receipts: [editResult.receipt, produceResult.receipt, pipelineReceipt],
  };
}

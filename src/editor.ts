import { createReceipt, hashContent, Receipt } from './vault';

export interface EditOperation {
  type: 'trim' | 'fade' | 'normalize' | 'eq' | 'compress' | 'spatial' | 'ml_enhance';
  params?: Record<string, unknown>;
}

export interface EditResult {
  editedHash: string;
  operations: EditOperation[];
  receipt: Receipt;
}

export function applyEdits(
  audioBuffer: Buffer,
  operations: EditOperation[]
): EditResult {
  // Pure function: each edit transforms the hash deterministically
  let currentHash = hashContent(audioBuffer.toString('base64'));

  for (const op of operations) {
    const opPayload = JSON.stringify({ hash: currentHash, op: op.type, params: op.params });
    currentHash = hashContent(opPayload);
  }

  const receipt = createReceipt('edit', {
    editedHash: currentHash,
    operationCount: operations.length,
    operations: operations.map(o => o.type),
  });

  return {
    editedHash: currentHash,
    operations,
    receipt,
  };
}

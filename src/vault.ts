import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface Receipt {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
  signature: string;
  hash: string;
}

export interface SignedContract {
  contractId: string;
  parties: string[];
  terms: Record<string, unknown>;
  signedAt: string;
  signature: string;
  hash: string;
}

const VAULT_SECRET = process.env.VAULT_SECRET || (() => {
  const generated = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('VAULT_SECRET environment variable is required in production');
  }
  console.warn('[vault] WARNING: No VAULT_SECRET set. Using ephemeral secret — receipts will not verify across restarts.');
  return generated;
})();
const RECEIPTS_DIR = path.resolve(__dirname, '..', 'receipts');

function ensureReceiptsDir(): void {
  if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  }
}

export function sign(payload: string): string {
  return crypto.createHmac('sha256', VAULT_SECRET).update(payload).digest('hex');
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function generateId(prefix: string): string {
  const counter = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  return `${prefix}_${counter}`;
}

export function createReceipt(type: string, data: Record<string, unknown>): Receipt {
  const id = generateId('receipt');
  const timestamp = new Date().toISOString();
  const payload = JSON.stringify({ id, type, timestamp, data });
  const hash = hashContent(payload);
  const signature = sign(payload);

  const receipt: Receipt = { id, type, timestamp, data, signature, hash };

  ensureReceiptsDir();
  const filename = `${id}.json`;
  fs.writeFileSync(path.join(RECEIPTS_DIR, filename), JSON.stringify(receipt, null, 2));

  return receipt;
}

export function createSignedContract(
  parties: string[],
  terms: Record<string, unknown>
): SignedContract {
  const contractId = generateId('contract');
  const signedAt = new Date().toISOString();
  const payload = JSON.stringify({ contractId, parties, terms, signedAt });
  const hash = hashContent(payload);
  const signature = sign(payload);

  const contract: SignedContract = { contractId, parties, terms, signedAt, signature, hash };

  ensureReceiptsDir();
  fs.writeFileSync(
    path.join(RECEIPTS_DIR, `${contractId}.json`),
    JSON.stringify(contract, null, 2)
  );

  return contract;
}

export function verifyReceipt(receipt: Receipt): boolean {
  const payload = JSON.stringify({
    id: receipt.id,
    type: receipt.type,
    timestamp: receipt.timestamp,
    data: receipt.data,
  });
  const expectedHash = hashContent(payload);
  const expectedSignature = sign(payload);
  return expectedHash === receipt.hash && expectedSignature === receipt.signature;
}

export function getReceiptsDir(): string {
  return RECEIPTS_DIR;
}

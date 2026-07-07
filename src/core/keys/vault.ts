/**
 * vault.ts — RS256 Environmental Seed Engine
 * SEALED STATE | Site_001, Kernel: PHX-01
 *
 * Doctrine: Single source of truth for all cryptography.
 * Rules:
 *   - Never commit seed
 *   - Never pass seed around except as hex for receipts
 *   - All signing flows through signPayload()
 */

import * as crypto from 'crypto';

export const getEnvironmentSeed = (): string => {
  const seed = process.env.OGEN_SEED;
  if (!seed) {
    throw new Error('OGEN_SEED environment variable is not set. Vault sealed.');
  }
  return seed;
};

// Cache key pair per seed to ensure deterministic signing/verification within a session
let cachedSeed: string | null = null;
let cachedKeyPair: { publicKey: string; privateKey: string } | null = null;

export const generateKeyPair = (): { publicKey: string; privateKey: string } => {
  const seed = getEnvironmentSeed();

  // Return cached pair if seed hasn't changed
  if (cachedSeed === seed && cachedKeyPair) {
    return cachedKeyPair;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  cachedSeed = seed;
  cachedKeyPair = { publicKey, privateKey };
  return { publicKey, privateKey };
};

export const signPayload = (payload: Record<string, unknown>): string => {
  const { privateKey } = generateKeyPair();
  const data = JSON.stringify(payload);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, 'hex');
};

export const verifySignature = (
  payload: Record<string, unknown>,
  signature: string
): boolean => {
  const { publicKey } = generateKeyPair();
  const data = JSON.stringify(payload);
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(data);
  verify.end();
  return verify.verify(publicKey, signature, 'hex');
};

export const hashPayload = (payload: Record<string, unknown>): string => {
  const data = JSON.stringify(payload);
  return crypto.createHash('sha256').update(data).digest('hex');
};

export const createReceipt = (
  payload: Record<string, unknown>
): { hash: string; signature: string; timestamp: number } => {
  const hash = hashPayload(payload);
  const signature = signPayload(payload);
  const timestamp = Date.now();
  return { hash, signature, timestamp };
};

/**
 * Tests for vault.ts — Cryptographic operations
 */
import {
  getEnvironmentSeed,
  hashPayload,
  signPayload,
  verifySignature,
  createReceipt,
} from '../src/core/keys/vault';

beforeAll(() => {
  process.env.OGEN_SEED = 'test-seed-for-vault';
});

describe('Vault - RS256 Crypto Engine', () => {
  describe('getEnvironmentSeed', () => {
    it('returns seed when set', () => {
      const seed = getEnvironmentSeed();
      expect(seed).toBe('test-seed-for-vault');
    });

    it('throws when seed not set', () => {
      const original = process.env.OGEN_SEED;
      delete process.env.OGEN_SEED;
      expect(() => getEnvironmentSeed()).toThrow('OGEN_SEED');
      process.env.OGEN_SEED = original;
    });
  });

  describe('hashPayload', () => {
    it('produces deterministic hash', () => {
      const payload = { foo: 'bar', num: 42 };
      const hash1 = hashPayload(payload);
      const hash2 = hashPayload(payload);
      expect(hash1).toBe(hash2);
    });

    it('different payloads produce different hashes', () => {
      const hash1 = hashPayload({ a: 1 });
      const hash2 = hashPayload({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it('returns hex string', () => {
      const hash = hashPayload({ test: true });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('signPayload / verifySignature', () => {
    it('signs and verifies correctly', () => {
      const payload = { track: 'test', seed: 42 };
      const signature = signPayload(payload);
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      const valid = verifySignature(payload, signature);
      expect(valid).toBe(true);
    });

    it('fails verification with tampered payload', () => {
      const payload = { track: 'test', seed: 42 };
      const signature = signPayload(payload);
      const tampered = { track: 'test', seed: 43 };
      const valid = verifySignature(tampered, signature);
      expect(valid).toBe(false);
    });
  });

  describe('createReceipt', () => {
    it('returns hash, signature, and timestamp', () => {
      const payload = { event: 'test_receipt' };
      const receipt = createReceipt(payload);
      expect(receipt).toHaveProperty('hash');
      expect(receipt).toHaveProperty('signature');
      expect(receipt).toHaveProperty('timestamp');
      expect(typeof receipt.hash).toBe('string');
      expect(typeof receipt.signature).toBe('string');
      expect(typeof receipt.timestamp).toBe('number');
    });
  });
});

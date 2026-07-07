/**
 * Tests for contract.ts — Compliance verification
 */
import {
  validateContractTerms,
  createSignedContract,
  verifyContractIntegrity,
  distributeRoyalties,
  ContractTerms,
} from '../src/core/money/contract';

beforeAll(() => {
  process.env.OGEN_SEED = 'test-seed-for-contracts';
});

const validTerms: ContractTerms = {
  artistId: 'artist_001',
  trackId: 'track_001',
  territory: 'US',
  rightsCleared: true,
  splitPercentage: 80,
  effectiveDate: '2026-01-01T00:00:00Z',
  expirationDate: '2027-01-01T00:00:00Z',
};

describe('Contract - Compliance & Rights', () => {
  describe('validateContractTerms', () => {
    it('passes with valid terms', () => {
      expect(() => validateContractTerms(validTerms)).not.toThrow();
    });

    it('throws if rights not cleared', () => {
      expect(() =>
        validateContractTerms({ ...validTerms, rightsCleared: false })
      ).toThrow('Rights not cleared');
    });

    it('throws for CA territory without caCompliant', () => {
      expect(() =>
        validateContractTerms({
          ...validTerms,
          territory: 'CA',
          caCompliant: false,
        })
      ).toThrow('California territory requires CA compliance');
    });

    it('passes for CA territory with caCompliant', () => {
      expect(() =>
        validateContractTerms({
          ...validTerms,
          territory: 'CA',
          caCompliant: true,
        })
      ).not.toThrow();
    });

    it('throws for invalid split percentage', () => {
      expect(() =>
        validateContractTerms({ ...validTerms, splitPercentage: -1 })
      ).toThrow('Split percentage must be 0-100');
      expect(() =>
        validateContractTerms({ ...validTerms, splitPercentage: 101 })
      ).toThrow('Split percentage must be 0-100');
    });

    it('throws for missing artistId or trackId', () => {
      expect(() =>
        validateContractTerms({ ...validTerms, artistId: '' })
      ).toThrow('artistId and trackId are required');
    });

    it('throws if expiration before effective', () => {
      expect(() =>
        validateContractTerms({
          ...validTerms,
          effectiveDate: '2027-01-01T00:00:00Z',
          expirationDate: '2026-01-01T00:00:00Z',
        })
      ).toThrow('Expiration must be after effective date');
    });
  });

  describe('createSignedContract', () => {
    it('creates a signed contract with valid terms', () => {
      const contract = createSignedContract(validTerms);
      expect(contract.terms).toEqual(validTerms);
      expect(typeof contract.hash).toBe('string');
      expect(typeof contract.signature).toBe('string');
      expect(typeof contract.signedAt).toBe('number');
    });

    it('throws with invalid terms', () => {
      expect(() =>
        createSignedContract({ ...validTerms, rightsCleared: false })
      ).toThrow();
    });
  });

  describe('verifyContractIntegrity', () => {
    it('verifies unmodified contract', () => {
      const contract = createSignedContract(validTerms);
      expect(verifyContractIntegrity(contract)).toBe(true);
    });

    it('fails for tampered contract', () => {
      const contract = createSignedContract({ ...validTerms });
      contract.terms.splitPercentage = 99;
      expect(verifyContractIntegrity(contract)).toBe(false);
    });
  });

  describe('distributeRoyalties', () => {
    it('calculates correct payouts', () => {
      const contract = createSignedContract(validTerms);
      const result = distributeRoyalties(contract, 1000);
      expect(result.artistPayout).toBe(800);
      expect(result.platformFee).toBe(200);
      expect(typeof result.receipt).toBe('string');
    });
  });
});

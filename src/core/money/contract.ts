/**
 * contract.ts — Compliance & Rights Ledger Anchor
 * SEALED STATE | Site_001, Kernel: PHX-01
 *
 * Doctrine: NYU + Harvard + UCLA + Liverpool institutional compliance.
 * Hard rule:
 *   - If rightsCleared === false, throw
 *   - If territory === 'CA' && !caCompliant, throw
 *   - No contract leaves unsigned
 */

import { signPayload, hashPayload } from '../keys/vault';

export interface ContractTerms {
  artistId: string;
  trackId: string;
  territory: string;
  rightsCleared: boolean;
  caCompliant?: boolean;
  splitPercentage: number;
  effectiveDate: string;
  expirationDate: string;
}

export interface SignedContract {
  terms: ContractTerms;
  hash: string;
  signature: string;
  signedAt: number;
}

export const validateContractTerms = (terms: ContractTerms): void => {
  if (!terms.rightsCleared) {
    throw new Error('CONTRACT_VIOLATION: Rights not cleared. Cannot proceed.');
  }

  if (terms.territory === 'CA' && !terms.caCompliant) {
    throw new Error(
      'CONTRACT_VIOLATION: California territory requires CA compliance flag.'
    );
  }

  if (terms.splitPercentage < 0 || terms.splitPercentage > 100) {
    throw new Error('CONTRACT_VIOLATION: Split percentage must be 0-100.');
  }

  if (!terms.artistId || !terms.trackId) {
    throw new Error('CONTRACT_VIOLATION: artistId and trackId are required.');
  }

  const effective = new Date(terms.effectiveDate);
  const expiration = new Date(terms.expirationDate);
  if (expiration <= effective) {
    throw new Error(
      'CONTRACT_VIOLATION: Expiration must be after effective date.'
    );
  }
};

export const createSignedContract = (terms: ContractTerms): SignedContract => {
  validateContractTerms(terms);

  const payload = { ...terms, type: 'contract', version: '1.0.0-sealed' };
  const hash = hashPayload(payload);
  const signature = signPayload(payload);

  return {
    terms,
    hash,
    signature,
    signedAt: Date.now(),
  };
};

export const verifyContractIntegrity = (contract: SignedContract): boolean => {
  const payload = {
    ...contract.terms,
    type: 'contract',
    version: '1.0.0-sealed',
  };
  const currentHash = hashPayload(payload);
  return currentHash === contract.hash;
};

/**
 * distributor.ts equivalent — Mock distribution
 * Phase 1: No real bank integration. Mock only.
 */
export const distributeRoyalties = (
  contract: SignedContract,
  grossRevenue: number
): { artistPayout: number; platformFee: number; receipt: string } => {
  const artistPayout = grossRevenue * (contract.terms.splitPercentage / 100);
  const platformFee = grossRevenue - artistPayout;
  const receipt = hashPayload({
    contractHash: contract.hash,
    grossRevenue,
    artistPayout,
    platformFee,
    distributedAt: Date.now(),
  });

  return { artistPayout, platformFee, receipt };
};

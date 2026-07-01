import { createReceipt, createSignedContract, Receipt, SignedContract } from './vault';

export interface WithdrawResult {
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  receipt: Receipt;
}

export function createDistributionContract(
  distributor: string,
  artist: string,
  terms: Record<string, unknown>
): SignedContract {
  return createSignedContract(
    [distributor, artist, 'ogen_complex_bank'],
    {
      type: 'distribution',
      split: terms.split || { artist: 70, distributor: 20, platform: 10 },
      territory: terms.territory || 'GLOBAL',
      duration: terms.duration || 'perpetual',
      ...terms,
    }
  );
}

export function withdraw(
  contractId: string,
  amount: number,
  currency: string = 'USD'
): WithdrawResult {
  const transactionId = `txn_${Date.now().toString(36)}`;

  const receipt = createReceipt('withdraw', {
    transactionId,
    contractId,
    amount,
    currency,
    status: 'cleared_to_ogen_complex_bank',
    clearedAt: new Date().toISOString(),
  });

  return {
    transactionId,
    amount,
    currency,
    status: 'cleared_to_ogen_complex_bank',
    receipt,
  };
}

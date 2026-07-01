import * as fs from 'fs';
import * as path from 'path';
import { createDistributionContract, withdraw } from '../distributor';
import { verifyReceipt, getReceiptsDir } from '../vault';

/**
 * Gate 2 Money Path — Run locally to confirm money flow
 * Creates contract → withdraws → writes money_001.json → verifies
 */
function runMoneyPath(): void {
  console.log('=== Gate 2: Money Path ===\n');

  // Step 1: Create distribution contract
  console.log('1. Creating distribution contract...');
  const contract = createDistributionContract(
    'OgenDistributors',
    'ArtistOne',
    { split: { artist: 70, distributor: 20, platform: 10 }, territory: 'GLOBAL' }
  );
  console.log(`   Contract ID: ${contract.contractId}`);
  console.log(`   Signed at: ${contract.signedAt}`);
  console.log(`   Hash: ${contract.hash}\n`);

  // Step 2: Withdraw
  console.log('2. Processing withdrawal...');
  const withdrawResult = withdraw(contract.contractId, 1000, 'USD');
  console.log(`   Transaction: ${withdrawResult.transactionId}`);
  console.log(`   Amount: ${withdrawResult.amount} ${withdrawResult.currency}`);
  console.log(`   Status: ${withdrawResult.status}\n`);

  // Step 3: Write money_001.json
  console.log('3. Writing money_001.json...');
  const moneyReceipt = {
    id: 'money_001',
    contract: {
      contractId: contract.contractId,
      parties: contract.parties,
      terms: contract.terms,
    },
    withdrawal: {
      transactionId: withdrawResult.transactionId,
      amount: withdrawResult.amount,
      currency: withdrawResult.currency,
      status: withdrawResult.status,
    },
    receipts: {
      contract: contract.hash,
      withdrawal: withdrawResult.receipt.hash,
    },
    timestamp: new Date().toISOString(),
  };

  const receiptsDir = getReceiptsDir();
  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }

  const moneyPath = path.join(receiptsDir, 'money_001.json');
  fs.writeFileSync(moneyPath, JSON.stringify(moneyReceipt, null, 2));
  console.log(`   Written to: ${moneyPath}\n`);

  // Step 4: Verify
  console.log('4. Verifying withdrawal receipt...');
  const verified = verifyReceipt(withdrawResult.receipt);
  console.log(`   Receipt verified: ${verified}\n`);

  if (verified) {
    console.log('✓ Gate 2 PASSED — money_001.json exists and verifies.');
  } else {
    console.error('✗ Gate 2 FAILED — receipt verification failed.');
    process.exit(1);
  }
}

runMoneyPath();

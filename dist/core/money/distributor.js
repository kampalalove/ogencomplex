import { createHash, randomBytes } from 'crypto';
import { verifyContract } from './contract.js';
const submissions = new Map();
export function submitContract(signedContract) {
    if (!verifyContract(signedContract)) {
        throw new Error('Distributor: Contract signature invalid.');
    }
    const distributorId = randomBytes(16).toString('hex');
    const payoutUrl = `https://sandbox.distributor.ogen/${distributorId}/payout`;
    submissions.set(distributorId, {
        distributorId,
        payoutUrl,
        status: 'pending',
        signedContract,
        submittedAt: new Date().toISOString(),
    });
    return { distributorId, payoutUrl, status: 'pending' };
}
export function withdraw(distributorId, amount) {
    const sub = submissions.get(distributorId);
    if (!sub) {
        throw new Error(`Distributor: No submission found for ID ${distributorId}`);
    }
    sub.status = 'cleared';
    const txId = createHash('sha256')
        .update(`${distributorId}:${amount}:${Date.now()}`)
        .digest('hex');
    return { txId, status: 'cleared_to_ogen_complex_bank' };
}

// src/core/verify.ts
import { verifyHash } from './produce.js';
import { verifyContract } from './money/contract.js';

export function verifyReceipt(receipt: string): boolean {
    try {
        const parsed = JSON.parse(receipt);
        if (parsed.hash && parsed.signature) {
            return verifyHash(parsed.hash, parsed.signature);
        }
        return false;
    } catch {
        return false;
    }
}

export { verifyHash, verifyContract };
import { privateKey, publicKey, getPublicKeyHex } from '../keys/vault.js';
import { createHash, sign, verify } from 'crypto';

export interface ContractInput {
    artist: string;
    title: string;
    iswc: string;
    split: number;
    territory: string;
    termDays: number;
    rightsCleared: boolean;
    caCompliant: boolean;
    globalRights: string[];
}

export function generateContract(input: ContractInput) {
    const date = new Date().toISOString();
    
    const payload = {
        type: "Ogen_Release_Contract_v2.0",
        artist: input.artist,
        title: input.title,
        iswc: input.iswc,
        split: input.split,
        territory: input.territory,
        termDays: input.termDays,
        rightsCleared: input.rightsCleared,
        caCompliant: input.caCompliant,
        globalRights: input.globalRights,
        date
    };

    const serialized = JSON.stringify(payload);
    const hash = createHash('sha256').update(serialized).digest('hex');
    const signature = sign(undefined, Buffer.from(hash, 'hex'), privateKey).toString('hex');

    return {
        success: true,
        hash,
        signature,
        payload
    };
}

export function verifyContract(payloadOrRawText: any, providedHash?: string, providedSignature?: string): boolean {
    try {
        if (!payloadOrRawText) return false;

        let finalPayload: any;
        let hash: string;
        let signature: string;

        // Smart Polymorphic Detection: Handle legacy flat text block strings (e.g., from distributor.ts)
        if (typeof payloadOrRawText === 'string') {
            const normalized = payloadOrRawText.replace(/\r\n/g, '\n').trim();
            const hashMatch = normalized.match(/\nHash:\s+([a-fA-F0-9]{64})/);
            const sigMatch = normalized.match(/\nSignature:\s+([a-fA-F0-9]+)/);
            
            if (!hashMatch || !sigMatch) return false;
            
            hash = hashMatch[1];
            signature = sigMatch[1];
            
            const bodyText = normalized.split('\nHash:')[0].trim();
            const computedHash = createHash('sha256').update(bodyText).digest('hex');
            
            if (computedHash !== hash) return false;
            return verify(undefined, Buffer.from(hash, 'hex'), publicKey, Buffer.from(signature, 'hex'));
        }

        // Structured execution tracking (e.g., from server.ts)
        finalPayload = payloadOrRawText;
        hash = providedHash || '';
        signature = providedSignature || '';

        if (!hash || !signature) return false;

        const serialized = JSON.stringify(finalPayload);
        const computedHash = createHash('sha256').update(serialized).digest('hex');
        
        if (computedHash !== hash) {
            console.warn(`⚠️ Integrity failure. Expected: ${hash}, Computed: ${computedHash}`);
            return false;
        }

        return verify(undefined, Buffer.from(hash, 'hex'), publicKey, Buffer.from(signature, 'hex'));
    } catch (err) {
        console.error('❌ Cryptographic verification failure:', err);
        return false;
    }
}

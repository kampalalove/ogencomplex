import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash } from 'crypto';
let privateKey;
let publicKey;
const secret = process.env.VAULT_SECRET;
if (!secret) {
    console.warn('⚠️ VAULT_SECRET not set. Using ephemeral key for development.');
    const keys = generateKeyPairSync('ed25519');
    privateKey = keys.privateKey;
    publicKey = keys.publicKey;
}
else {
    let seed;
    if (secret.length === 64 && /^[0-9a-f]{64}$/i.test(secret)) {
        seed = Buffer.from(secret, 'hex');
    }
    else {
        seed = createHash('sha256').update(secret).digest();
    }
    const keys = generateKeyPairSync('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    privateKey = createPrivateKey(keys.privateKey);
    publicKey = createPublicKey(keys.publicKey);
}
// These are the raw exports your modules are trying to bind to
export { privateKey, publicKey };
export function getPublicKeyHex() {
    return publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
}

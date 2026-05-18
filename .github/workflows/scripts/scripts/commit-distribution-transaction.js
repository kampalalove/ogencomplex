const https = require('https');
const crypto = require('crypto');

const issuerId = process.env.APP_STORE_ISSUER_ID;
const keyId = process.env.APP_STORE_KEY_ID;
const privateKey = process.env.APP_STORE_PRIVATE_KEY.replace(/\\n/g, '\n');

const generateJWT = () => {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: issuerId,
    exp: Math.floor(Date.now() / 1000) + 1200,
    aud: 'appstoreconnect-v1'
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(privateKey, 'base64url');
  return `${signingInput}.${signature}`;
};

const token = generateJWT();

// TODO: Replace with actual payload
const data = JSON.stringify({});

const options = {
  hostname: 'api.appstoreconnect.apple.com',
  path: '/v1/distributionTransactions/commit',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.on('error', e => {
  console.error('Error:', e.message);
  process.exit(1);
});

req.write(data);
req.end();

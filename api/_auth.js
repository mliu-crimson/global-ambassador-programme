// Signs and verifies short-lived tokens proving a client just logged in
// as a specific ambassador code. Stateless (HMAC-based) so it works across
// serverless invocations with no shared storage.
const crypto = require('crypto');

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payloadObj) {
  const secret = process.env.AMBASSADOR_TOKEN_SECRET;
  if (!secret) throw new Error('AMBASSADOR_TOKEN_SECRET is not set');
  const payload = base64url(JSON.stringify(payloadObj));
  const sig = base64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verify(token) {
  const secret = process.env.AMBASSADOR_TOKEN_SECRET;
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) return null;

  const [payload, sig] = token.split('.');
  const expectedSig = base64url(crypto.createHmac('sha256', secret).update(payload).digest());

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(base64urlDecode(payload).toString('utf8'));
  } catch (e) {
    return null;
  }

  if (!data || typeof data.exp !== 'number' || Date.now() > data.exp) return null;
  return data;
}

module.exports = { sign, verify };

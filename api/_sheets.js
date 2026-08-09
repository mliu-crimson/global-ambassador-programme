// Reads Google Sheets via the official Sheets API v4, authenticated as a
// service account (JWT Bearer flow — no external auth library needed,
// just Node's built-in crypto). Replaces the old public CSV-export trick
// (which relied on sheets staying link-shared, and had wildly
// inconsistent latency — one request took 258s where it normally took
// ~2s). This lets sheets go fully private and gives documented,
// predictable rate limits instead.
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cachedToken = null; // { accessToken, expiresAt } — reused across warm invocations
let sheetTitleCache = new Map(); // `${spreadsheetId}:${gid}` -> title
let sheetRowsCache = new Map(); // `${spreadsheetId}:${gid}` -> { rows, savedAt }

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes — cuts down repeat API calls under load

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.accessToken;
  }

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: creds.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(creds.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function getSheetTitle(spreadsheetId, gid, token) {
  const cacheKey = `${spreadsheetId}:${gid}`;
  if (sheetTitleCache.has(cacheKey)) return sheetTitleCache.get(cacheKey);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`sheet metadata fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const sheet = (data.sheets || []).find(s => String(s.properties.sheetId) === String(gid));
  if (!sheet) throw new Error(`no sheet found with gid ${gid} in ${spreadsheetId}`);

  sheetTitleCache.set(cacheKey, sheet.properties.title);
  return sheet.properties.title;
}

// Returns rows as arrays of strings (like the old CSV parser), so callers
// don't need to change their column-index logic. Rows/cells may be
// shorter than expected if trailing cells are empty — callers already
// guard with `(row[i] || '')`. Falls back to a stale cached copy if a
// fresh fetch fails or times out, rather than erroring outright.
async function getSheetRows(spreadsheetId, gid) {
  const cacheKey = `${spreadsheetId}:${gid}`;
  const cached = sheetRowsCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return cached.rows;
  }

  try {
    const token = await getAccessToken();
    const title = await getSheetTitle(spreadsheetId, gid, token);
    const range = `'${title.replace(/'/g, "\\'")}'`;

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`sheet values fetch failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const rows = data.values || [];
    sheetRowsCache.set(cacheKey, { rows, savedAt: Date.now() });
    return rows;
  } catch (e) {
    if (cached) {
      console.error(`getSheetRows: fresh fetch failed, serving stale cache for ${cacheKey}:`, e.message);
      return cached.rows;
    }
    throw e;
  }
}

module.exports = { getSheetRows };

// Shared CSV helper for the Google Sheets-backed serverless functions.
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur.trim().replace(/^"|"$/g, ''));
    rows.push(cols);
  }
  return rows;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/csv,text/plain,*/*',
};

// Google's CSV-export endpoint is unofficial and occasionally extremely slow
// (observed 250s+ for a request that normally takes ~2s) — not something we
// can fix, only route around. Two mitigations:
//   1. A per-request timeout so a slow Google response can't hang the whole
//      function; we fall back to cached data instead of waiting it out.
//   2. A short-lived in-memory cache (persists only for the life of a warm
//      serverless instance) so concurrent/rapid requests don't all hit
//      Google at once.
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const cache = new Map(); // url -> { text, savedAt }

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: 'follow', headers: BROWSER_HEADERS, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns { text, attempts }. `text` is null only if every URL failed AND
// no cached copy (even a stale one) was available; `attempts` records
// per-URL diagnostics so failures are debuggable from the API response
// instead of requiring log access.
async function fetchCSV(urls) {
  const attempts = [];

  for (const url of urls) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
      attempts.push({ url, cacheHit: true });
      return { text: cached.text, attempts };
    }
  }

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url);
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      const trimmedLower = text.trim().toLowerCase();
      const looksLikeHTML = trimmedLower.startsWith('<!doctype') || trimmedLower.startsWith('<html');
      const looksLikeCSV = !looksLikeHTML && (contentType.includes('csv') || text.includes(','));

      attempts.push({
        url,
        status: res.status,
        contentType,
        looksLikeCSV,
        length: text.length,
        snippet: text.slice(0, 150),
      });

      if (res.ok && looksLikeCSV) {
        cache.set(url, { text, savedAt: Date.now() });
        return { text, attempts };
      }
    } catch (e) {
      attempts.push({ url, error: String((e && e.message) || e), timedOut: e && e.name === 'AbortError' });
    }
  }

  // Every fresh attempt failed or timed out — serve stale cached data
  // rather than nothing, if we have any.
  for (const url of urls) {
    const cached = cache.get(url);
    if (cached) {
      attempts.push({ url, staleCacheFallback: true, ageMs: Date.now() - cached.savedAt });
      return { text: cached.text, attempts };
    }
  }

  return { text: null, attempts };
}

module.exports = { parseCSV, fetchCSV };

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

// Returns { text, attempts }. `text` is null if every URL failed;
// `attempts` records per-URL diagnostics so failures are debuggable
// from the API response instead of requiring log access.
async function fetchCSV(urls) {
  const attempts = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: BROWSER_HEADERS });
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
        return { text, attempts };
      }
    } catch (e) {
      attempts.push({ url, error: String((e && e.message) || e) });
    }
  }
  return { text: null, attempts };
}

module.exports = { parseCSV, fetchCSV };

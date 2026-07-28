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

async function fetchCSV(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) {
        const text = await res.text();
        if (text.includes(',') || text.includes('\n')) return text;
      }
    } catch (e) {
      // try next URL
    }
  }
  return null;
}

module.exports = { parseCSV, fetchCSV };

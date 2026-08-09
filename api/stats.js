const { parseCSV, fetchCSV } = require('./_csv');
const { verify } = require('./_auth');

// Final LGIC 2026 results sheet (registrations closed) — one row per
// ambassador with columns: CODE, FULL NAME, LGIC TOTAL, LGIC Credits,
// Rank, Top 10 (bonus $), Total credits. Rank/Top10 are 0 for anyone
// outside the top 10 (ties share a rank), not a full leaderboard position.
const SHEET_ID = '1o8k2Ea5FxDfTzEuM3QPili9SgHPeiWk6m3PqMf4enOI';
const RESULTS_GID = '1081451407';
const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${RESULTS_GID}`,
];
const CODE_COL = 0;
const SIGNUPS_COL = 2;
const CREDITS_COL = 3;
const RANK_COL = 4;
const BONUS_COL = 5;
const TOTAL_CREDITS_COL = 6;

function toNumber(cell) {
  const n = parseFloat(cell);
  return isNaN(n) ? 0 : n;
}

module.exports = async (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'missing_code' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const claims = verify(token);

  if (!claims || claims.code !== code) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { text: csvText, attempts } = await fetchCSV(URLS);
  if (!csvText) {
    console.error('stats: sheet fetch failed', JSON.stringify(attempts));
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'sheet_unavailable' });
    return;
  }

  const rows = parseCSV(csvText);
  const match = rows.slice(1).find(row => (row[CODE_COL] || '').trim().toUpperCase() === code);

  const signups = match ? toNumber(match[SIGNUPS_COL]) : 0;
  const credits = match ? toNumber(match[CREDITS_COL]) : 0;
  const rank = match ? toNumber(match[RANK_COL]) : 0;
  const bonus = match ? toNumber(match[BONUS_COL]) : 0;
  const totalCredits = match ? toNumber(match[TOTAL_CREDITS_COL]) : 0;

  // Cache briefly at the edge: repeat stat checks for the same code+token within
  // this window are served without re-fetching the whole sheet from Google.
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.status(200).json({ signups, credits, rank, bonus, totalCredits });
};

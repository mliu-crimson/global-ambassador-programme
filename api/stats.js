const { parseCSV, fetchCSV } = require('./_csv');
const { verify } = require('./_auth');

const SHEET_ID = '1PKgznu8-wTU8VcCY7yZDgV0bsehzqiIVhBZWOz0Z9b8';
const SIGNUPS_GID = '1217596572';
const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SIGNUPS_GID}`,
];

// Master ambassador sheet: one row per ambassador. Column F is already a
// pre-computed all-time total; K/P/U are pre-computed per-year subtotals
// (2026/2025/2024); V is the only 2023 column and has no subtotal of its
// own yet. Confirmed against the live sheet on 2026-07-29 — do not re-sum
// the raw per-competition columns, they're already folded into these.
const ALLTIME_SHEET_ID = '1x7R7-aQtvXSNE7q_0eBLHaQxUCLgUuPBpbTi1Ojaxds';
const ALLTIME_GID = '1580466567';
const ALLTIME_URLS = [
  `https://docs.google.com/spreadsheets/d/${ALLTIME_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${ALLTIME_GID}`,
];
const ALLTIME_CODE_COL = 3;
const ALLTIME_TOTAL_COL = 5; // F
const YEAR_TOTAL_COLS = [
  { year: 2026, col: 10 }, // K
  { year: 2025, col: 15 }, // P
  { year: 2024, col: 20 }, // U
  { year: 2023, col: 21 }, // V — partial (HCGCC only), no subtotal column exists
];

function toNumber(cell) {
  const n = parseFloat(cell);
  return isNaN(n) ? 0 : n;
}

function getAllTime(rows, code) {
  const match = rows.slice(1).find(row => (row[ALLTIME_CODE_COL] || '').trim().toUpperCase() === code);
  if (!match) return null;

  const byYear = YEAR_TOTAL_COLS
    .map(({ year, col }) => ({ year, total: toNumber(match[col]) }))
    .filter(({ total }) => total > 0);

  return {
    total: toNumber(match[ALLTIME_TOTAL_COL]),
    byYear,
  };
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

  const [current, allTime] = await Promise.all([
    fetchCSV(URLS),
    fetchCSV(ALLTIME_URLS),
  ]);

  if (!current.text) {
    console.error('stats: current sheet fetch failed', JSON.stringify(current.attempts));
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'sheet_unavailable' });
    return;
  }

  const rows = parseCSV(current.text);
  const signups = rows.slice(1).filter(row =>
    row.some(cell => cell.trim().toUpperCase() === code)
  ).length;

  let allTimeSignups = null;
  let allTimeByYear = null;
  if (allTime.text) {
    const result = getAllTime(parseCSV(allTime.text), code);
    if (result) {
      allTimeSignups = result.total;
      allTimeByYear = result.byYear;
    }
  } else {
    console.error('stats: all-time sheet fetch failed', JSON.stringify(allTime.attempts));
  }

  // Cache briefly at the edge: repeat stat checks for the same code+token within
  // this window are served without re-fetching the whole sheet from Google.
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.status(200).json({ signups, allTimeSignups, allTimeByYear });
};

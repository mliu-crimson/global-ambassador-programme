const { parseCSV, fetchCSV } = require('./_csv');
const { verify } = require('./_auth');

const SHEET_ID = '1PKgznu8-wTU8VcCY7yZDgV0bsehzqiIVhBZWOz0Z9b8';
const SIGNUPS_GID = '1217596572';
const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SIGNUPS_GID}`,
];

// Master ambassador sheet: one row per ambassador, all-time sign-up counts
// broken out across many competition/round columns. We just sum them all.
const ALLTIME_SHEET_ID = '1x7R7-aQtvXSNE7q_0eBLHaQxUCLgUuPBpbTi1Ojaxds';
const ALLTIME_GID = '1580466567';
const ALLTIME_URLS = [
  `https://docs.google.com/spreadsheets/d/${ALLTIME_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${ALLTIME_GID}`,
];
const ALLTIME_CODE_COL = 3;
const ALLTIME_FIRST_NUMERIC_COL = 5;

function getAllTimeSignups(rows, code) {
  const match = rows.slice(1).find(row => (row[ALLTIME_CODE_COL] || '').trim().toUpperCase() === code);
  if (!match) return null;
  return match.slice(ALLTIME_FIRST_NUMERIC_COL).reduce((sum, cell) => {
    const n = parseFloat(cell);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
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
  if (allTime.text) {
    allTimeSignups = getAllTimeSignups(parseCSV(allTime.text), code);
  } else {
    console.error('stats: all-time sheet fetch failed', JSON.stringify(allTime.attempts));
  }

  // Cache briefly at the edge: repeat stat checks for the same code+token within
  // this window are served without re-fetching the whole sheet from Google.
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.status(200).json({ signups, allTimeSignups });
};

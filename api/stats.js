const { parseCSV, fetchCSV } = require('./_csv');
const { verify } = require('./_auth');

const SHEET_ID = '1PKgznu8-wTU8VcCY7yZDgV0bsehzqiIVhBZWOz0Z9b8';
const SIGNUPS_GID = '1217596572';
const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SIGNUPS_GID}`,
];

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
  const signups = rows.slice(1).filter(row =>
    row.some(cell => cell.trim().toUpperCase() === code)
  ).length;

  // Cache briefly at the edge: repeat stat checks for the same code+token within
  // this window are served without re-fetching the whole sheet from Google.
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.status(200).json({ signups });
};

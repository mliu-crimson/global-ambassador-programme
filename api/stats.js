const { parseCSV, fetchCSV } = require('./_csv');

const SHEET_ID = '1PKgznu8-wTU8VcCY7yZDgV0bsehzqiIVhBZWOz0Z9b8';
const SIGNUPS_GID = '1217596572';
const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SIGNUPS_GID}`,
];

module.exports = async (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'missing_code' });
    return;
  }

  const { text: csvText, attempts } = await fetchCSV(URLS);
  if (!csvText) {
    res.status(502).json({ error: 'sheet_unavailable', attempts });
    return;
  }

  const rows = parseCSV(csvText);
  const signups = rows.slice(1).filter(row =>
    row.some(cell => cell.trim().toUpperCase() === code)
  ).length;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ signups });
};

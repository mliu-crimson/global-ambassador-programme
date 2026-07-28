const { parseCSV, fetchCSV } = require('./_csv');

const SHEET_ID = '1UFk5kFXwUearV5-MR5rbcei3chBieT2GNd7wUjw5LfA';
const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
];

// Column order: Ambassador Code, Full Name, First Name, Last Name, Email
const CODE_COL = 0;
const NAME_COL = 2;
const EMAIL_COL = 4;

module.exports = async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'missing_email' });
    return;
  }

  const csvText = await fetchCSV(URLS);
  if (!csvText) {
    res.status(502).json({ error: 'sheet_unavailable' });
    return;
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    res.status(502).json({ error: 'sheet_empty' });
    return;
  }

  const match = rows.slice(1).find(row => (row[EMAIL_COL] || '').trim().toLowerCase() === email);
  if (!match) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    name: (match[NAME_COL] || '').trim() || 'Ambassador',
    code: (match[CODE_COL] || '').trim(),
  });
};

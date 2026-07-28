const { parseCSV, fetchCSV } = require('./_csv');
const { sign } = require('./_auth');

const SHEET_ID = '1UFk5kFXwUearV5-MR5rbcei3chBieT2GNd7wUjw5LfA';
const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
];

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Column order: Ambassador Code, Full Name, First Name, Last Name, Email
const CODE_COL = 0;
const FULL_NAME_COL = 1;
const FIRST_NAME_COL = 2;
const EMAIL_COL = 4;

function normalizeName(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  const name = normalizeName(req.query.name);

  if (!email || !name) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const { text: csvText, attempts } = await fetchCSV(URLS);
  if (!csvText) {
    console.error('login: sheet fetch failed', JSON.stringify(attempts));
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'sheet_unavailable' });
    return;
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    console.error('login: sheet parsed empty', JSON.stringify(attempts));
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'sheet_empty' });
    return;
  }

  const match = rows.slice(1).find(row =>
    (row[EMAIL_COL] || '').trim().toLowerCase() === email &&
    normalizeName(row[FULL_NAME_COL]) === name
  );

  if (!match) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const code = (match[CODE_COL] || '').trim();
  const token = sign({ code: code.toUpperCase(), exp: Date.now() + TOKEN_TTL_MS });

  // Cache briefly at the edge: repeat logins for the same email+name within
  // this window are served without re-fetching the whole sheet from Google.
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=59');
  res.status(200).json({
    name: (match[FIRST_NAME_COL] || '').trim() || 'Ambassador',
    code,
    token,
  });
};

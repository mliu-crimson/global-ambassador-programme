const { parseCSV, fetchCSV } = require('./_csv');
const { verify } = require('./_auth');

// Final LGIC 2026 results sheet (registrations closed) — one row per
// ambassador with columns: CODE, FULL NAME, LGIC TOTAL, LGIC Credits,
// Rank, Top 10, Weekly Top, Weekly Most Improved, Total Credits.
// Rank/Top10 are 0 for anyone outside the top 10 (ties share a rank),
// not a full leaderboard position. Total Credits = LGIC Credits +
// Top 10 + Weekly Top + Weekly Most Improved (confirmed against the
// live sheet on 2026-08-09).
const LGIC_SHEET_ID = '1o8k2Ea5FxDfTzEuM3QPili9SgHPeiWk6m3PqMf4enOI';
const LGIC_GID = '1081451407';
const LGIC_URLS = [
  `https://docs.google.com/spreadsheets/d/${LGIC_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${LGIC_GID}`,
];
const LGIC_CODE_COL = 0;
const LGIC_SIGNUPS_COL = 2;
const LGIC_CREDITS_COL = 3;
const LGIC_RANK_COL = 4;
const LGIC_TOP10_BONUS_COL = 5;
const LGIC_WEEKLY_TOP_COL = 6;
const LGIC_WEEKLY_IMPROVED_COL = 7;
const LGIC_TOTAL_CREDITS_COL = 8;

// Master ambassador sheet: one row per ambassador. Column F is a
// pre-computed "all time total" but it silently excludes 2023 (verified
// 2026-08-09: for every ambassador with 2023 activity, F exactly equals
// 2026+2025+2024, dropping 2023 entirely). So we sum the four yearly
// subtotal columns ourselves instead of trusting F, to include 2023.
const ALLTIME_SHEET_ID = '1x7R7-aQtvXSNE7q_0eBLHaQxUCLgUuPBpbTi1Ojaxds';
const ALLTIME_GID = '1580466567';
const ALLTIME_URLS = [
  `https://docs.google.com/spreadsheets/d/${ALLTIME_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${ALLTIME_GID}`,
];
const ALLTIME_CODE_COL = 3;
const YEAR_TOTAL_COLS = [
  { year: 2026, col: 10 }, // K
  { year: 2025, col: 15 }, // P
  { year: 2024, col: 20 }, // U
  { year: 2023, col: 21 }, // V — only column for 2023, no subtotal exists
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

  const total = byYear.reduce((sum, { total: t }) => sum + t, 0);
  return { total, byYear };
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

  const [lgic, allTime] = await Promise.all([
    fetchCSV(LGIC_URLS),
    fetchCSV(ALLTIME_URLS),
  ]);

  if (!lgic.text) {
    console.error('stats: LGIC sheet fetch failed', JSON.stringify(lgic.attempts));
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'sheet_unavailable' });
    return;
  }

  const lgicRows = parseCSV(lgic.text);
  const lgicMatch = lgicRows.slice(1).find(row => (row[LGIC_CODE_COL] || '').trim().toUpperCase() === code);

  const signups = lgicMatch ? toNumber(lgicMatch[LGIC_SIGNUPS_COL]) : 0;
  const credits = lgicMatch ? toNumber(lgicMatch[LGIC_CREDITS_COL]) : 0;
  const rank = lgicMatch ? toNumber(lgicMatch[LGIC_RANK_COL]) : 0;
  const topTenBonus = lgicMatch ? toNumber(lgicMatch[LGIC_TOP10_BONUS_COL]) : 0;
  const weeklyTopBonus = lgicMatch ? toNumber(lgicMatch[LGIC_WEEKLY_TOP_COL]) : 0;
  const weeklyImprovedBonus = lgicMatch ? toNumber(lgicMatch[LGIC_WEEKLY_IMPROVED_COL]) : 0;
  const totalCredits = lgicMatch ? toNumber(lgicMatch[LGIC_TOTAL_CREDITS_COL]) : 0;

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
  res.status(200).json({
    signups,
    credits,
    rank,
    topTenBonus,
    weeklyTopBonus,
    weeklyImprovedBonus,
    totalCredits,
    allTimeSignups,
    allTimeByYear,
  });
};

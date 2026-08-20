const { getSheetRows } = require('./_sheets');
const { verify } = require('./_auth');

// Final LGIC 2026 results sheet (registrations closed) — one row per
// ambassador with columns: CODE, FULL NAME, LGIC TOTAL, LGIC Credits,
// Rank, Top 10, Weekly Top, Weekly Most Improved, LGIC Total Credits,
// Rolled from SARC, Final Total.
// Rank/Top10 are 0 for anyone outside the top 10 (ties share a rank),
// not a full leaderboard position. LGIC Total Credits = LGIC Credits +
// Top 10 + Weekly Top + Weekly Most Improved. Final Total additionally
// rolls in leftover credits carried over from SARC (added 2026-08-09).
const LGIC_SHEET_ID = '1o8k2Ea5FxDfTzEuM3QPili9SgHPeiWk6m3PqMf4enOI';
const LGIC_GID = '1081451407';
const LGIC_CODE_COL = 0;
const LGIC_SIGNUPS_COL = 2;
const LGIC_CREDITS_COL = 3;
const LGIC_RANK_COL = 4;
const LGIC_TOP10_BONUS_COL = 5;
const LGIC_WEEKLY_TOP_COL = 6;
const LGIC_WEEKLY_IMPROVED_COL = 7;
const LGIC_TOTAL_CREDITS_COL = 8;
const LGIC_SARC_ROLLED_COL = 9;
const LGIC_FINAL_TOTAL_COL = 10;

// Master ambassador sheet: one row per ambassador. Column F is a
// pre-computed "all time total" but it silently excludes 2023 (verified
// 2026-08-09: for every ambassador with 2023 activity, F exactly equals
// 2026+2025+2024, dropping 2023 entirely). So we sum the four yearly
// subtotal columns ourselves instead of trusting F, to include 2023.
const ALLTIME_SHEET_ID = '1x7R7-aQtvXSNE7q_0eBLHaQxUCLgUuPBpbTi1Ojaxds';
const ALLTIME_GID = '1580466567';
const ALLTIME_CODE_COL = 3;
const YEAR_TOTAL_COLS = [
  { year: 2026, col: 10 }, // K
  { year: 2025, col: 15 }, // P
  { year: 2024, col: 20 }, // U
  { year: 2023, col: 21 }, // V — only column for 2023, no subtotal exists
];

// HCGCC 2026 tracker (registrations open) — Sheet2 is the raw list of
// discount codes entered at checkout, one per registration, no header
// beyond row 1. An ambassador's live sign-up count is just how many rows
// match their code; credits are that count times the $3/sign-up rate
// (mirrors the sheet's own `=COUNTIF(...)` / `=count*3` tracker formulas).
const HCGCC_SHEET_ID = '1zmFp2FpZ05RkFus5f70nMf2v6Hf4z48RDPLNoVao5DQ';
const HCGCC_GID = '2123041535';
const HCGCC_CODE_COL = 0;
const HCGCC_CREDIT_PER_SIGNUP = 3;

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

  const [lgicResult, allTimeResult, hcgccResult] = await Promise.allSettled([
    getSheetRows(LGIC_SHEET_ID, LGIC_GID),
    getSheetRows(ALLTIME_SHEET_ID, ALLTIME_GID),
    getSheetRows(HCGCC_SHEET_ID, HCGCC_GID),
  ]);

  if (lgicResult.status === 'rejected') {
    console.error('stats: LGIC sheet fetch failed', lgicResult.reason.message);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'sheet_unavailable' });
    return;
  }

  const lgicRows = lgicResult.value;
  const lgicMatch = lgicRows.slice(1).find(row => (row[LGIC_CODE_COL] || '').trim().toUpperCase() === code);

  const signups = lgicMatch ? toNumber(lgicMatch[LGIC_SIGNUPS_COL]) : 0;
  const credits = lgicMatch ? toNumber(lgicMatch[LGIC_CREDITS_COL]) : 0;
  const rank = lgicMatch ? toNumber(lgicMatch[LGIC_RANK_COL]) : 0;
  const topTenBonus = lgicMatch ? toNumber(lgicMatch[LGIC_TOP10_BONUS_COL]) : 0;
  const weeklyTopBonus = lgicMatch ? toNumber(lgicMatch[LGIC_WEEKLY_TOP_COL]) : 0;
  const weeklyImprovedBonus = lgicMatch ? toNumber(lgicMatch[LGIC_WEEKLY_IMPROVED_COL]) : 0;
  const totalCredits = lgicMatch ? toNumber(lgicMatch[LGIC_TOTAL_CREDITS_COL]) : 0;
  const sarcRolled = lgicMatch ? toNumber(lgicMatch[LGIC_SARC_ROLLED_COL]) : 0;
  const finalTotal = lgicMatch ? toNumber(lgicMatch[LGIC_FINAL_TOTAL_COL]) : 0;

  let allTimeSignups = null;
  let allTimeByYear = null;
  if (allTimeResult.status === 'fulfilled') {
    const result = getAllTime(allTimeResult.value, code);
    if (result) {
      allTimeSignups = result.total;
      allTimeByYear = result.byYear;
    }
  } else {
    console.error('stats: all-time sheet fetch failed', allTimeResult.reason.message);
  }

  let hcgccSignups = null;
  let hcgccCredits = null;
  if (hcgccResult.status === 'fulfilled') {
    hcgccSignups = hcgccResult.value.slice(1).filter(row => (row[HCGCC_CODE_COL] || '').trim().toUpperCase() === code).length;
    hcgccCredits = hcgccSignups * HCGCC_CREDIT_PER_SIGNUP;
  } else {
    console.error('stats: HCGCC sheet fetch failed', hcgccResult.reason.message);
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
    sarcRolled,
    finalTotal,
    allTimeSignups,
    allTimeByYear,
    hcgccSignups,
    hcgccCredits,
  });
};

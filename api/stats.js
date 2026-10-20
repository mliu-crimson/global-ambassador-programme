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

// Master ambassador ("Dashboard") sheet: one row per ambassador. The "All time
// total" column is pre-computed by the sheet itself and trusted directly. Columns
// are located by their HEADING, not a fixed position, because this sheet keeps
// gaining columns (SARC26/PFF25 and later "2027 Total" were each inserted
// mid-sheet and silently shifted every later column, which twice broke the
// by-year numbers when positions were hard-coded). If a heading below is ever
// renamed or removed, all-time is hidden rather than showing wrong numbers.
// Per-season "YYYY Total" columns are picked up automatically. Note the sheet
// files the current HCGCC (run Jul–Oct 2026) under "2027 Total".
const ALLTIME_SHEET_ID = '1x7R7-aQtvXSNE7q_0eBLHaQxUCLgUuPBpbTi1Ojaxds';
const ALLTIME_GID = '1580466567';
const ALLTIME_HEADINGS = { code: 'Ambassador Code', total: 'All time total', hcgcc: 'HCGCC26' };

// HCGCC 2026 final results (competition wrapped up 2026-10-20) — one row per
// ambassador. Columns: A code, B name, C country, D HCGCC26 sign-ups, E credit
// from sign-ups, F weekly "most sign-ups" credit ($50 per win), G weekly "most
// improved" credit ($25 per win), H Top 10 prize, I HCGCC total, J rollover from
// previous competitions, K new total credit. Money cells are text like "$576.00".
// (Replaces the live raw-registrations tracker and its $3/$5 date-tiered maths.)
const HCGCC_FINAL_SHEET_ID = '1fuKIUyJ2x6--5HoUOeXwgerSNu1e56cWn7d0HR5UBTE';
const HCGCC_FINAL_GID = '458172507';
const HCGCC_FINAL = {
  code: 0, signups: 3, signupCredit: 4, weeklyTop: 5, improved: 6, top10: 7, hcgccTotal: 8, rollover: 9, total: 10,
};
const HCGCC_WEEKLY_TOP_PER_WIN = 50;
const HCGCC_IMPROVED_PER_WIN = 25;

// Exact Top 10 place for a prize winner. Ambassadors tied on sign-ups share a place
// and the next place follows on (1st, 2nd, 3rd, 4th, 4th, 5th, ...). Prize tiers:
// 1st $150, 2nd-3rd $100, 4th-5th $50, 6th-10th $25. Checked against all 12 winners
// in the HCGCC results; returns null (front end falls back to the prize tier) if the
// sheet's prize doesn't fit this rule.
function hcgccTop10Place(rows, signups, prize) {
  if (!(prize > 0)) return null;
  const counts = rows
    .filter(r => (r[HCGCC_FINAL.code] || '').trim())
    .map(r => toNumber(r[HCGCC_FINAL.signups]));
  const distinct = [...new Set(counts)].sort((a, b) => b - a);
  const place = distinct.indexOf(signups) + 1;
  const tied = counts.filter(c => c === signups).length > 1;
  const expectedPrize = place === 1 ? 150 : place <= 3 ? 100 : place <= 5 ? 50 : place <= 10 ? 25 : 0;
  return expectedPrize === prize ? { place, tied } : null;
}

// "$1,101.00" -> 1101; blank/garbage -> 0
function toMoney(cell) {
  const n = parseFloat(String(cell || '').replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function toNumber(cell) {
  const n = parseFloat(cell);
  return isNaN(n) ? 0 : n;
}

function headingIndex(header, label) {
  return header.findIndex(h => (h || '').trim().toLowerCase() === label.toLowerCase());
}

// HCGCC handling: the Dashboard files HCGCC26 under the next season's "2027 Total"
// column, but ambassadors should see it as 2026 (the year it ran). So the HCGCC26
// sign-ups are pulled out of that season column and added to the year in the
// HCGCC26 heading (2026); whatever else sits in the season column (e.g. a future
// HCGEC 2027) stays under its own year.
// hcgccFinalSignups: the ambassador's sign-ups from the HCGCC final-results sheet,
// when available. The Dashboard's HCGCC26 column is fed by a weekly tab that only
// counts from the week of 10 Aug and doesn't include later manual corrections, so
// the final sheet's number replaces it. If the Dashboard is later brought up to the
// final numbers the difference is zero and this changes nothing.
function getAllTime(rows, code, hcgccFinalSignups) {
  const header = rows[0] || [];
  const codeCol = headingIndex(header, ALLTIME_HEADINGS.code);
  const totalCol = headingIndex(header, ALLTIME_HEADINGS.total);
  const hcgccCol = headingIndex(header, ALLTIME_HEADINGS.hcgcc);
  if (codeCol < 0 || totalCol < 0) {
    console.error('stats: all-time sheet headings not found — layout changed?');
    return null;
  }

  const match = rows.slice(1).find(row => (row[codeCol] || '').trim().toUpperCase() === code);
  if (!match) return null;

  const years = header
    .map((h, col) => {
      const m = /^(\d{4}) Total$/.exec((h || '').trim());
      return m ? { year: parseInt(m[1], 10), col } : null;
    })
    .filter(Boolean);

  const byYear = years.map(({ year, col }) => ({ year, col, total: toNumber(match[col]) }));
  let total = toNumber(match[totalCol]);

  if (hcgccCol >= 0) {
    const dashboardHcgcc = toNumber(match[hcgccCol]);
    const hcgcc = typeof hcgccFinalSignups === 'number' ? hcgccFinalSignups : dashboardHcgcc;
    total += hcgcc - dashboardHcgcc;

    const yy = /(\d{2})$/.exec((header[hcgccCol] || '').trim());
    const hcgccYear = yy ? 2000 + parseInt(yy[1], 10) : null;
    const season = years.filter(y => y.col > hcgccCol).sort((x, y) => x.col - y.col)[0];
    const seasonEntry = season && byYear.find(y => y.col === season.col);
    if (hcgccYear && seasonEntry) {
      seasonEntry.total = Math.max(0, seasonEntry.total - dashboardHcgcc);
      let yearEntry = byYear.find(y => y.year === hcgccYear);
      if (!yearEntry) {
        yearEntry = { year: hcgccYear, col: -1, total: 0 };
        byYear.push(yearEntry);
      }
      yearEntry.total += hcgcc;
    } else if (seasonEntry) {
      seasonEntry.total += hcgcc - dashboardHcgcc;
    }
  }

  return {
    total,
    byYear: byYear
      .filter(({ total: t }) => t > 0)
      .sort((x, y) => y.year - x.year)
      .map(({ year, total: t }) => ({ year, total: t })),
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

  const [lgicResult, allTimeResult, hcgccResult] = await Promise.allSettled([
    getSheetRows(LGIC_SHEET_ID, LGIC_GID),
    getSheetRows(ALLTIME_SHEET_ID, ALLTIME_GID),
    getSheetRows(HCGCC_FINAL_SHEET_ID, HCGCC_FINAL_GID),
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

  // undefined => the sheet couldn't be read (front end shows an error);
  // null => read fine but this ambassador isn't listed.
  let hcgccFinal;
  if (hcgccResult.status === 'fulfilled') {
    const row = hcgccResult.value.slice(1).find(r => (r[HCGCC_FINAL.code] || '').trim().toUpperCase() === code);
    if (row) {
      const weeklyTopCredit = toMoney(row[HCGCC_FINAL.weeklyTop]);
      const improvedCredit = toMoney(row[HCGCC_FINAL.improved]);
      hcgccFinal = {
        signups: toNumber(row[HCGCC_FINAL.signups]),
        signupCredit: toMoney(row[HCGCC_FINAL.signupCredit]),
        weeklyTopCredit,
        weeklyTopWins: Math.round(weeklyTopCredit / HCGCC_WEEKLY_TOP_PER_WIN),
        improvedCredit,
        improvedWins: Math.round(improvedCredit / HCGCC_IMPROVED_PER_WIN),
        top10Prize: toMoney(row[HCGCC_FINAL.top10]),
        top10Place: hcgccTop10Place(hcgccResult.value.slice(1), toNumber(row[HCGCC_FINAL.signups]), toMoney(row[HCGCC_FINAL.top10])),
        hcgccTotal: toMoney(row[HCGCC_FINAL.hcgccTotal]),
        rollover: toMoney(row[HCGCC_FINAL.rollover]),
        total: toMoney(row[HCGCC_FINAL.total]),
      };
    } else {
      hcgccFinal = null;
    }
  } else {
    console.error('stats: HCGCC final-results sheet fetch failed', hcgccResult.reason.message);
  }

  let allTimeSignups = null;
  let allTimeByYear = null;
  if (allTimeResult.status === 'fulfilled') {
    const result = getAllTime(allTimeResult.value, code, hcgccFinal ? hcgccFinal.signups : undefined);
    if (result) {
      allTimeSignups = result.total;
      allTimeByYear = result.byYear;
    }
  } else {
    console.error('stats: all-time sheet fetch failed', allTimeResult.reason.message);
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
    hcgccFinal,
  });
};

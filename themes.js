// @ts-check
// Seasonal themes: which one is active on a given (local) date.

// Tết Nguyên Đán (mùng 1) for upcoming years, Vietnamese calendar.
const TET = {
  2026: '02-17',
  2027: '02-06',
  2028: '01-26',
  2029: '02-13',
  2030: '02-03',
  2031: '01-23',
  2032: '02-11',
  2033: '01-31',
  2034: '02-19',
  2035: '02-08',
};

const DAY = 86400000;

/** Built-in windows. `year` limits a window to one year; `before`/`after` are days around the date. */
const BUILT_IN = [
  // Messi's farewell match with Argentina, Monumental, 6 Oct 2026.
  { theme: 'messi', year: 2026, date: '10-06', before: 4, after: 1 },
  { theme: 'messi', date: '06-24', before: 1, after: 0 }, // birthday
  { theme: 'messi', date: '12-18', before: 0, after: 0 }, // 2022 World Cup final
  { theme: 'women', date: '10-20', before: 3, after: 1 }, // Ngày Phụ nữ Việt Nam
  { theme: 'women', date: '03-08', before: 2, after: 1 }, // International Women's Day
  { theme: 'christmas', date: '12-25', before: 10, after: 1 },
  ...Object.entries(TET).map(([year, date]) => ({ theme: 'tet', year: Number(year), date, before: 7, after: 7 })),
];

const THEMES = ['messi', 'women', 'christmas', 'tet'];

function at(year, mmdd) {
  const [m, d] = mmdd.split('-').map(Number);
  return new Date(year, m - 1, d).getTime();
}

/** Start of the local day, so windows compare whole days. */
function dayOf(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Parses a user entry: { theme, from, to? } where dates are 'YYYY-MM-DD' or yearly 'MM-DD'.
 * @returns {{theme: string, from: number, to: number} | null}
 */
function userWindow(e, year) {
  if (!e || !THEMES.includes(e.theme) || typeof e.from !== 'string') return null;
  const to = typeof e.to === 'string' ? e.to : e.from;
  const parse = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? at(Number(s.slice(0, 4)), s.slice(5)) : /^\d{2}-\d{2}$/.test(s) ? at(year, s) : NaN);
  const from = parse(e.from);
  const end = parse(to);
  if (Number.isNaN(from) || Number.isNaN(end)) return null;
  return { theme: e.theme, from, to: end };
}

/**
 * @param {Date} now
 * @param {string} setting 'auto' | 'none' | a theme id
 * @param {any[]} extra user-defined windows (they win over built-in ones)
 * @returns {string | null}
 */
function activeTheme(now, setting = 'auto', extra = []) {
  if (setting === 'none') return null;
  if (THEMES.includes(setting)) return setting;
  const today = dayOf(now);
  const year = now.getFullYear();
  for (const e of extra || []) {
    const w = userWindow(e, year);
    if (w && today >= w.from && today <= w.to) return w.theme;
  }
  // Shortest matching window wins, so a one-day event beats a long season.
  let best = null;
  for (const w of BUILT_IN) {
    for (const y of w.year ? [w.year] : [year - 1, year, year + 1]) {
      const center = at(y, w.date);
      const from = center - w.before * DAY;
      const to = center + w.after * DAY;
      if (today >= from && today <= to && (!best || to - from < best.len)) best = { theme: w.theme, len: to - from };
    }
  }
  return best && best.theme;
}

module.exports = { activeTheme, THEMES };

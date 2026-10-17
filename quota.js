// @ts-check
// Claude usage quota (the session and weekly limits), read from what Claude Code already keeps on
// disk. Nothing is fetched: Claude Code caches the last numbers it got in ~/.claude.json, and the
// transcript records when a limit was hit. That file also holds account data, so only the usage
// branch is kept and nothing else from it ever leaves this module.
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const CONFIG = path.join(os.homedir(), '.claude.json');
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const SESSION_MS = 5 * 3600 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** `fresh`: the window rolled over after Claude Code last checked, so its new usage is not known. */
/** @typedef {{pct: number, resetsAt: number | null, fresh?: boolean}} Limit */
/** @typedef {{session: Limit | null, weekly: Limit | null, fetchedAt: number | null}} Cached */

/** @type {{mtimeMs: number, size: number, value: Cached} | null} */
let cache = null;

/** @param {any} b @param {number} now @returns {Limit | null} */
function limitOf(b, now) {
  if (!b || typeof b !== 'object' || typeof b.utilization !== 'number' || !isFinite(b.utilization)) return null;
  const resetsAt = typeof b.resets_at === 'string' ? Date.parse(b.resets_at) || null : null;
  // The window has rolled over since Claude Code last asked: it starts again from zero.
  if (resetsAt && resetsAt <= now) return { pct: 0, resetsAt: null, fresh: true };
  return { pct: Math.max(0, Math.min(100, b.utilization)) / 100, resetsAt };
}

/**
 * The cached quota numbers, re-read only when ~/.claude.json changed.
 * @returns {Promise<Cached>}
 */
async function readCachedQuota(now = Date.now()) {
  const empty = { session: null, weekly: null, fetchedAt: null };
  let st;
  try {
    st = await fsp.stat(CONFIG);
  } catch {
    return empty;
  }
  if (!st.isFile() || st.size > MAX_CONFIG_BYTES) return empty;
  if (!cache || cache.mtimeMs !== st.mtimeMs || cache.size !== st.size) {
    let raw = null;
    try {
      const fh = await fsp.open(CONFIG, 'r');
      let text;
      try {
        const buf = Buffer.alloc(Math.min(st.size, MAX_CONFIG_BYTES));
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        text = buf.subarray(0, bytesRead).toString('utf8');
      } finally {
        await fh.close();
      }
      const d = JSON.parse(text);
      raw = d && typeof d === 'object' ? d.cachedUsageUtilization : null;
    } catch {
      raw = null; // being rewritten by Claude Code right now; try again next time
    }
    const u = raw && typeof raw === 'object' ? raw.utilization : null;
    cache = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      // Keep the raw usage numbers only; they are turned into limits against the current time below.
      value: /** @type {any} */ ({
        rawSession: u && u.five_hour,
        rawWeekly: u && u.seven_day,
        fetchedAt: raw && typeof raw.fetchedAtMs === 'number' ? raw.fetchedAtMs : null,
      }),
    };
  }
  const v = /** @type {any} */ (cache.value);
  return { session: limitOf(v.rawSession, now), weekly: limitOf(v.rawWeekly, now), fetchedAt: v.fetchedAt };
}

/**
 * When a "You've hit your … limit · resets 4:30am (Asia/Saigon)" message says the limit lifts.
 * Times are read in the local time zone; the reset is the first such time after the message.
 * @param {string} text @param {number} at
 */
function parseResetTime(text, at) {
  const m = /resets\s+(?:([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  if (!m) return null;
  let hour = Number(m[3]) % 12;
  if (m[5].toLowerCase() === 'pm') hour += 12;
  const d = new Date(at);
  d.setHours(hour, Number(m[4] || 0), 0, 0);
  if (m[1]) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase());
    if (month >= 0) d.setMonth(month, Number(m[2]));
    if (d.getTime() <= at) d.setFullYear(d.getFullYear() + 1);
  } else if (d.getTime() <= at) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

/**
 * Puts the cached numbers and the transcript's last limit event together.
 * @param {Cached} cached
 * @param {{at: number, weekly: boolean, text: string} | null} hit the newest rate-limit message, if
 *   nothing was answered after it
 * @returns {{session: Limit | null, weekly: Limit | null, pct: number | null, limited: boolean,
 *   limitedUntil: number | null, which: 'session' | 'weekly' | null, fetchedAt: number | null}}
 */
function combineQuota(cached, hit, now = Date.now()) {
  let { session, weekly } = cached;
  let limitedUntil = null;
  /** @type {'session' | 'weekly' | null} */
  let which = null;
  if (hit) {
    const known = hit.weekly ? weekly : session;
    const until =
      (known && known.resetsAt && known.resetsAt > hit.at ? known.resetsAt : null) ||
      parseResetTime(hit.text, hit.at) ||
      hit.at + (hit.weekly ? WEEK_MS : SESSION_MS);
    if (!until || until > now) {
      limitedUntil = until;
      which = hit.weekly ? 'weekly' : 'session';
      const full = { pct: 1, resetsAt: until };
      if (hit.weekly) weekly = full;
      else session = full;
    }
  }
  for (const [name, l] of /** @type {const} */ ([['session', session], ['weekly', weekly]])) {
    if (!which && l && l.pct >= 1) {
      which = name;
      limitedUntil = l.resetsAt;
    }
  }
  const pcts = [session, weekly].filter(Boolean).map((l) => /** @type {Limit} */ (l).pct);
  return {
    session,
    weekly,
    pct: pcts.length ? Math.max(...pcts) : null,
    limited: !!which,
    limitedUntil,
    which,
    fetchedAt: cached.fetchedAt,
  };
}

module.exports = { readCachedQuota, combineQuota, parseResetTime };

// @ts-check
// Reads Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl)
// and works out how much of the context window the session currently uses.
// Kept free of the `vscode` module so it can be tested with plain Node.
//
// Privacy: transcripts hold whole conversations. Only token counts, timestamps and short,
// redacted labels ever leave this module; message and tool-result content never does.
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const RESCAN_MS = 10000; // how often the list of projects/sessions is rescanned
const CWD_PROBE_BYTES = 64 * 1024;

function projectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// Claude Code names each project folder after its cwd with every non-alphanumeric char replaced by '-'.
function encodeProjectDir(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** @returns {Promise<{file: string, mtimeMs: number, size: number}[]>} */
async function transcriptsIn(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    // Regular files only: symlinks are never followed.
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const file = path.join(dir, e.name);
    try {
      const st = await fsp.stat(file);
      out.push({ file, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // file vanished between readdir and stat
    }
  }
  return out;
}

const RANK_CANDIDATES = 5;
const ACTIVITY_TAIL = 256 * 1024;
const ACTIVITY_BUDGET = 32 * 1024 * 1024; // how far back to look for the last API call

/**
 * Time of the last main-thread API call in a transcript. Claude Code keeps appending bookkeeping
 * lines (titles, modes…) to idle sessions, so the file's mtime alone picks the wrong session.
 */
async function lastActivity(t) {
  try {
    let scanned = 0;
    for await (const buf of linesFromEnd(t.file, t.size)) {
      scanned += buf.length;
      if (scanned > ACTIVITY_BUDGET) break;
      if (!buf.includes(USAGE_MARK)) continue;
      const line = buf.toString('utf8');
      if (!line.includes('"type":"assistant"') || line.includes('"isSidechain":true')) continue;
      const m = line.match(/"timestamp":"([^"]+)"/);
      const at = m && Date.parse(m[1]);
      if (at) return at;
    }
  } catch {
    // unreadable: fall back to mtime
  }
  return t.mtimeMs;
}

/** Of the most recently written transcripts, the one whose session last talked to the API. */
async function mostActive(list) {
  const recent = list.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RANK_CANDIDATES);
  let best = null;
  let bestAt = -1;
  for (const t of recent) {
    const at = await lastActivity(t);
    if (at > bestAt) {
      best = t;
      bestAt = at;
    }
  }
  return best;
}

/** @type {Map<string, string | null>} */
const cwdCache = new Map();

/** The working directory a session was started in, read from the first entries of its transcript. */
async function cwdOf(file) {
  if (cwdCache.has(file)) return cwdCache.get(file);
  let cwd = null;
  try {
    const fh = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(CWD_PROBE_BYTES);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
        if (!line.includes('"cwd"')) continue;
        try {
          const d = JSON.parse(line);
          if (typeof d.cwd === 'string') {
            cwd = d.cwd;
            break;
          }
        } catch {
          // partial last line
        }
      }
    } finally {
      await fh.close();
    }
  } catch {
    // unreadable: treated as unknown
  }
  cwdCache.set(file, cwd);
  return cwd;
}

const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/**
 * Newest session of the workspace. Folder names are lossy ('/app-old' and '/app/old' both become
 * '-app-old'), so anything but an exact match is confirmed against the session's recorded cwd.
 */
async function workspaceTranscripts(root, projectDirs, workspacePaths) {
  const out = [];
  for (const ws of workspacePaths) {
    const enc = encodeProjectDir(ws);
    for (const d of projectDirs) {
      if (d !== enc && !d.startsWith(enc + '-')) continue;
      for (const t of await transcriptsIn(path.join(root, d))) {
        if (d !== enc) {
          const cwd = await cwdOf(t.file);
          if (!cwd || !inside(cwd, ws)) continue;
        }
        out.push(t);
      }
    }
  }
  return out;
}

let scan = { key: '', at: 0, /** @type {string | null} */ file: null };

/**
 * Finds the transcript of the most recently active session. The directory scan runs at most every
 * RESCAN_MS; in between only the chosen file is re-stat'ed.
 * @param {string[]} workspacePaths absolute paths of the open workspace folders
 * @param {'workspace' | 'latest'} source
 * @returns {Promise<{file: string, mtimeMs: number, size: number} | null>}
 */
async function findTranscript(workspacePaths, source, pinned = null) {
  if (pinned) {
    try {
      const st = await fsp.lstat(pinned);
      if (st.isFile()) return { file: pinned, mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      // the pinned session is gone: pick automatically
    }
  }
  const key = source + '|' + workspacePaths.join('|');
  if (scan.key === key && Date.now() - scan.at < RESCAN_MS && scan.file) {
    try {
      const st = await fsp.stat(scan.file);
      return { file: scan.file, mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      // gone: fall through to a full rescan
    }
  }
  const root = projectsRoot();
  let projectDirs;
  try {
    projectDirs = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  let hit = null;
  if (source !== 'latest' && workspacePaths.length) hit = await mostActive(await workspaceTranscripts(root, projectDirs, workspacePaths));
  if (!hit) {
    const all = [];
    for (const d of projectDirs) all.push(...(await transcriptsIn(path.join(root, d))));
    hit = await mostActive(all);
  }
  scan = { key, at: Date.now(), file: hit && hit.file };
  return hit;
}

async function readRange(file, start, end) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, end - start));
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function readTail(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  let text = (await readRange(file, start, size)).toString('utf8');
  if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  return text;
}

/** Minutes the prompt cache lives for, read from which ephemeral bucket the write went to. */
function cacheTtlOf(u) {
  const c = u.cache_creation;
  if (!c) return null;
  if (c.ephemeral_1h_input_tokens > 0) return 60;
  if (c.ephemeral_5m_input_tokens > 0) return 5;
  return null;
}

const TTL_LOOKBACK = 200; // usage lines to search for a cache write when the latest turn only read from cache

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * One step of walking a transcript backwards (newest line first) to the latest main-thread API
 * usage, or a compact boundary. Returns the answer once it is settled, otherwise undefined.
 * `at` is when that API call happened: the prompt cache expires `ttl` minutes after it.
 * A usage-limit message newer than that call is kept in `st.hit`.
 * @param {{found: any, seen: number, hit?: any}} st
 * @param {string} line
 */
function contextStep(st, line) {
  if (!line || (!line.includes('"usage"') && !line.includes('compact_boundary') && !line.includes('rate_limit'))) return undefined;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!d || typeof d !== 'object') return undefined;
  const at = Date.parse(d.timestamp) || null;
  if (d.type === 'system' && d.subtype === 'compact_boundary') {
    if (st.found) return st.found; // the cache from before the compact no longer matters
    const post = d.compactMetadata && num(d.compactMetadata.postTokens);
    return { used: post || 0, model: null, compacted: true, at, ttl: null };
  }
  if (d.type !== 'assistant' || d.isSidechain) return undefined;
  const m = d.message;
  if (d.error === 'rate_limit' && !st.found && !st.hit) {
    const content = m && Array.isArray(m.content) ? m.content : [];
    const text = content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join(' ').slice(0, 300);
    st.hit = { at: at || Date.now(), weekly: /weekly|7-day/i.test(text), text };
    return undefined;
  }
  const u = m && m.usage;
  if (!u || typeof u !== 'object' || m.model === '<synthetic>') return undefined;
  if (!st.found) {
    const used = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens) + num(u.output_tokens);
    const model = typeof m.model === 'string' ? m.model.slice(0, 64) : null;
    st.found = { used, model, compacted: false, at, ttl: cacheTtlOf(u) };
    if (st.found.ttl) return st.found;
  } else {
    const ttl = cacheTtlOf(u);
    if (ttl) return { ...st.found, ttl };
  }
  if (++st.seen > TTL_LOOKBACK) return st.found;
  return undefined;
}

const BACKWARD_CHUNK = 4 * 1024 * 1024;
const USAGE_MARK = Buffer.from('"usage"');
const COMPACT_MARK = Buffer.from('compact_boundary');
const LIMIT_MARK = Buffer.from('"rate_limit"');

/**
 * Yields the lines of a file from the last one to the first, reading it backwards in chunks.
 * Lines come out as Buffers so huge ones (screenshots, request blobs) can be skipped unread.
 */
async function* linesFromEnd(file, size) {
  const fh = await fsp.open(file, 'r');
  try {
    let pos = size;
    let carry = Buffer.alloc(0);
    while (pos > 0) {
      const start = Math.max(0, pos - BACKWARD_CHUNK);
      const buf = Buffer.alloc(pos - start);
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      const data = Buffer.concat([buf.subarray(0, bytesRead), carry]);
      pos = start;
      let end = data.length;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i] !== 0x0a) continue;
        if (end > i + 1) yield data.subarray(i + 1, end);
        end = i;
      }
      carry = data.subarray(0, end); // a line that started before this chunk
    }
    if (carry.length) yield carry;
  } finally {
    await fh.close();
  }
}

/** The last answer per transcript, so an unchanged file is never walked twice. */
const contextCache = new Map();

/**
 * Walks the transcript backwards only as far as needed. Screenshots and request blobs can put the
 * last usage line megabytes before the end, so there is no fixed tail size.
 * @param {{file: string, size: number}} t
 */
async function readContext(t) {
  const cached = contextCache.get(t.file);
  if (cached && cached.size === t.size) return cached.ctx;
  /** @type {{found: any, seen: number, hit?: any}} */
  const st = { found: null, seen: 0 };
  let ctx;
  for await (const buf of linesFromEnd(t.file, t.size)) {
    if (!buf.includes(USAGE_MARK) && !buf.includes(COMPACT_MARK) && !buf.includes(LIMIT_MARK)) continue;
    const r = contextStep(st, buf.toString('utf8'));
    if (r !== undefined) {
      ctx = r;
      break;
    }
  }
  if (ctx === undefined) ctx = st.found;
  // A usage-limit message after the last answer: Claude Code is locked out until the reset.
  if (st.hit) ctx = { ...(ctx || { used: 0, model: null, compacted: false, at: null, ttl: null }), hit: st.hit };
  contextCache.set(t.file, { size: t.size, ctx });
  return ctx;
}

const MSG_MARKS = [Buffer.from('"type":"assistant"'), Buffer.from('"type":"user"')];
const TURN_LOOKBACK_LINES = 400;
const TURN_LOOKBACK_BYTES = 16 * 1024 * 1024;

/**
 * Whether Claude is in the middle of a turn: the newest main-thread message is a prompt, a tool
 * result or a tool call (not a finished answer). Claude often waits on a tool for minutes without
 * writing anything, so the time of the last write alone cannot tell.
 * @param {{file: string, size: number}} t
 */
async function turnInProgress(t) {
  let lines = 0;
  let bytes = 0;
  for await (const buf of linesFromEnd(t.file, t.size)) {
    if (++lines > TURN_LOOKBACK_LINES || (bytes += buf.length) > TURN_LOOKBACK_BYTES) break;
    if (!MSG_MARKS.some((m) => buf.includes(m))) continue;
    let d;
    try {
      d = JSON.parse(buf.toString('utf8'));
    } catch {
      continue;
    }
    if (!d || typeof d !== 'object' || d.isSidechain || d.isMeta) continue;
    const m = d.message;
    if (d.type === 'assistant') {
      if (d.error || d.isApiErrorMessage) return false;
      const stop = m && m.stop_reason;
      return !(stop === 'end_turn' || stop === 'stop_sequence' || stop === 'max_tokens' || stop === 'refusal');
    }
    if (d.type === 'user') {
      const c = m && m.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join(' ') : '';
      // Local slash commands and interruptions do not start a turn.
      if (/^\s*<(local-command|command-name|command-message)/.test(text) || text.includes('[Request interrupted by user')) return false;
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ what a session tells us about its model

const usageNum = (line, key) => {
  const m = line.match(new RegExp('"' + key + '":(\\d+)'));
  return m ? Number(m[1]) : 0;
};

/**
 * Reads usage figures out of one transcript line without parsing the whole (often huge) message:
 * only the top-level `usage` object right after the key is looked at.
 */
function usageOfLine(line) {
  if (!line.includes('"type":"assistant"') || line.includes('"isSidechain":true')) return null;
  const at = line.indexOf('"usage":{');
  if (at < 0) return null;
  const u = line.slice(at, at + 800);
  const model = (line.match(/"model":"([^"]{1,64})"/) || [])[1];
  if (!model || model === '<synthetic>') return null;
  const used =
    usageNum(u, 'input_tokens') + usageNum(u, 'cache_creation_input_tokens') + usageNum(u, 'cache_read_input_tokens') + usageNum(u, 'output_tokens');
  return { model, used };
}

/**
 * Learns from a whole session what the API only shows implicitly: the largest context each model
 * has held (more than 200k means a 1M window) and where Claude Code compacted automatically.
 * Streams the file and only looks at usage and compact lines, so even 100 MB+ transcripts are fine;
 * giant lines (screenshots, file contents) are skipped without ever being turned into strings.
 * @returns {Promise<{models: Record<string, {max: number, autoAt: number[]}>, title: string | null, entrypoint: string | null, lastModel?: string | null}>}
 */
const MAX_SCAN_LINE = 2 * 1024 * 1024;
const FORWARD_CHUNK = 1024 * 1024;

/** Yields the lines of a file from first to last as Buffers, leaving out lines over MAX_SCAN_LINE. */
async function* linesFromStart(file) {
  const fh = await fsp.open(file, 'r');
  try {
    let carry = Buffer.alloc(0);
    let skipping = false; // inside a line already longer than MAX_SCAN_LINE
    const buf = Buffer.alloc(FORWARD_CHUNK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      let start = 0;
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] !== 0x0a) continue;
        if (skipping) skipping = false;
        else yield Buffer.concat([carry, buf.subarray(start, i)]);
        carry = Buffer.alloc(0);
        start = i + 1;
      }
      if (!skipping) {
        carry = Buffer.concat([carry, buf.subarray(start, bytesRead)]);
        if (carry.length > MAX_SCAN_LINE) {
          // Too long to be a usage line worth reading: drop it and everything up to its newline.
          carry = Buffer.alloc(0);
          skipping = true;
        }
      }
    }
    if (carry.length && !skipping) yield carry;
  } finally {
    await fh.close();
  }
}

async function scanSession(file) {
  const out = { models: Object.create(null), title: null, entrypoint: null };
  const model = (m) => (out.models[m] = out.models[m] || { max: 0, autoAt: [] });
  let lastModel = null;
  for await (const buf of linesFromStart(file)) {
    const line = buf.toString('utf8');
    if (line.startsWith('{"type":"ai-title"')) {
      try {
        out.title = String(JSON.parse(line).aiTitle || '').slice(0, 80) || out.title;
      } catch {
        // ignore
      }
      continue;
    }
    if (line.includes('"subtype":"compact_boundary"')) {
      try {
        const d = JSON.parse(line);
        const m = d.compactMetadata || {};
        if (m.trigger === 'auto' && lastModel && num(m.preTokens)) model(lastModel).autoAt.push(num(m.preTokens));
        if (typeof d.entrypoint === 'string' && /^[a-z0-9-]{1,32}$/.test(d.entrypoint)) out.entrypoint = d.entrypoint;
      } catch {
        // ignore
      }
      continue;
    }
    const u = usageOfLine(line);
    if (!u) continue;
    lastModel = u.model;
    model(u.model).max = Math.max(model(u.model).max, u.used);
    const ep = line.match(/"entrypoint":"([a-z0-9-]{1,32})"/);
    if (ep) out.entrypoint = ep[1];
  }
  out.lastModel = lastModel;
  return out;
}

/** Title and last API call of a session, from the end of its transcript (for the session picker). */
async function sessionSummary(t) {
  let title = null;
  try {
    const lines = (await readTail(t.file, t.size, ACTIVITY_TAIL)).split('\n');
    for (let i = lines.length - 1; i >= 0 && !title; i--) {
      if (!lines[i].startsWith('{"type":"ai-title"')) continue;
      try {
        title = String(JSON.parse(lines[i]).aiTitle || '').slice(0, 80) || null;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return { ...t, at: await lastActivity(t), title };
}

/** Recent sessions of the workspace (or anywhere), most recently active first. */
async function listSessions(workspacePaths, source, limit = 15) {
  const root = projectsRoot();
  let projectDirs;
  try {
    projectDirs = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  let list = source !== 'latest' && workspacePaths.length ? await workspaceTranscripts(root, projectDirs, workspacePaths) : [];
  if (!list.length) for (const d of projectDirs) list.push(...(await transcriptsIn(path.join(root, d))));
  list = list.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
  const out = [];
  for (const t of list) out.push(await sessionSummary(t));
  return out.sort((a, b) => b.at - a.at);
}

/** The most recently written transcripts across every project (for learning about models). */
async function recentTranscripts(limit = 8, maxBytes = 400 * 1024 * 1024) {
  const root = projectsRoot();
  let projectDirs;
  try {
    projectDirs = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const all = [];
  for (const d of projectDirs) all.push(...(await transcriptsIn(path.join(root, d))));
  return all
    .filter((t) => t.size <= maxBytes)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

/** Only files inside ~/.claude/projects may be pinned. */
function isTranscriptPath(file) {
  const root = projectsRoot() + path.sep;
  return typeof file === 'string' && file.endsWith('.jsonl') && path.resolve(file).startsWith(root);
}

// ------------------------------------------------------------------ "knowledge" the session just took in

const MAX_FEED_READ = 1024 * 1024;

// Anything that looks like a credential is masked before a label is built.
const SECRETS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, // Anthropic, OpenAI, Stripe…
  /\bgh[pousr]_[A-Za-z0-9]{10,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
  /\b(?:bearer|token|password|passwd|pwd|secret|api[_-]?key)\b\s*[:=]?\s*\S+/gi,
  /[A-Za-z0-9+/_=-]{24,}/g, // any other long opaque string
];

function redact(s) {
  for (const re of SECRETS) s = s.replace(re, '•••');
  return s;
}

/** Redacts first, then trims to a short label, so a secret can never be half-shown. */
function short(s, n = 18) {
  s = redact(String(s || '').replace(/\s+/g, ' ').trim());
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function toolItem(name, input) {
  input = input && typeof input === 'object' ? input : {};
  const base = (p) => short(path.basename(String(p || '')));
  switch (name) {
    case 'Read':
      return { k: 'file', t: base(input.file_path) };
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return { k: 'edit', t: base(input.file_path || input.notebook_path) };
    case 'Bash':
      // Never the raw command line: it can carry tokens and passwords.
      return { k: 'cmd', t: input.description ? short(input.description) : 'command' };
    case 'Grep':
    case 'Glob':
      return { k: 'search', t: short(input.pattern) };
    case 'WebFetch':
      try {
        return { k: 'web', t: short(new URL(input.url).hostname) };
      } catch {
        return { k: 'web', t: 'web page' };
      }
    case 'WebSearch':
      return { k: 'web', t: short(input.query) };
    case 'Task':
    case 'Agent':
      return { k: 'agent', t: short(input.description || input.subagent_type || 'agent') };
    case 'TodoWrite':
      return { k: 'todo', t: 'todos' };
    default:
      return { k: 'tool', t: short(String(name || 'tool').startsWith('mcp__') ? String(name).split('__').pop() : name) };
  }
}

/** Turns one transcript entry into the things it fed into the context. */
function itemsOf(d) {
  if (!d || typeof d !== 'object' || d.isSidechain || !d.message) return [];
  const content = d.message.content;
  if (d.type === 'assistant' && Array.isArray(content)) {
    const out = [];
    for (const c of content) {
      if (!c) continue;
      if (c.type === 'tool_use') out.push(toolItem(c.name, c.input));
      else if (c.type === 'thinking') out.push({ k: 'think', t: 'idea' });
    }
    return out;
  }
  if (d.type === 'user' && !d.isMeta && !d.toolUseResult) {
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter((c) => c && c.type === 'text').map((c) => c.text).join(' ')
          : '';
    if (Array.isArray(content) && content.some((c) => c && c.type === 'image')) return [{ k: 'image', t: 'image' }];
    // Skip slash-command echoes and system reminders, which start with a tag.
    if (text && !String(text).trim().startsWith('<')) return [{ k: 'prompt', t: short(text) }];
  }
  return [];
}

/**
 * Reads the complete lines appended between `from` and `to`.
 * @returns {Promise<{items: {k: string, t: string}[], next: number, usage: {model: string, used: number}[], autoAt: number[]}>}
 *   `next` is where the next read should start.
 */
async function readNewItems(file, from, to) {
  if (to - from > MAX_FEED_READ) from = to - MAX_FEED_READ;
  const buf = await readRange(file, from, to);
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return { items: [], next: from };
  const items = [];
  /** @type {{model: string, used: number}[]} */
  const usage = [];
  /** @type {number[]} */
  const autoAt = [];
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line) continue;
    const u = usageOfLine(line);
    if (u) usage.push(u);
    try {
      const d = JSON.parse(line);
      if (d && d.type === 'system' && d.subtype === 'compact_boundary' && d.compactMetadata && d.compactMetadata.trigger === 'auto') {
        const pre = num(d.compactMetadata.preTokens);
        if (pre) autoAt.push(pre);
      }
      items.push(...itemsOf(d));
    } catch {
      // a line cut in half by the MAX_FEED_READ window
    }
  }
  return { items, next: from + end + 1, usage, autoAt };
}

module.exports = {
  findTranscript,
  readContext,
  turnInProgress,
  readNewItems,
  scanSession,
  listSessions,
  isTranscriptPath,
  recentTranscripts,
};

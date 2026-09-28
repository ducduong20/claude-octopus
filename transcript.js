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

const TAIL_BYTES = 2 * 1024 * 1024;
const MAX_FULL_READ = 8 * 1024 * 1024;
const RESCAN_MS = 10000; // how often the list of projects/sessions is rescanned
const CWD_PROBE_BYTES = 64 * 1024;

function projectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// Claude Code names each project folder after its cwd with every non-alphanumeric char replaced by '-'.
function encodeProjectDir(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** @returns {Promise<{file: string, mtimeMs: number, size: number} | null>} */
async function newestTranscriptIn(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best = null;
  for (const e of entries) {
    // Regular files only: symlinks are never followed.
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const file = path.join(dir, e.name);
    try {
      const st = await fsp.stat(file);
      if (!best || st.mtimeMs > best.mtimeMs) best = { file, mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      // file vanished between readdir and stat
    }
  }
  return best;
}

async function newestOf(dirs) {
  let best = null;
  for (const d of dirs) {
    const t = await newestTranscriptIn(d);
    if (t && (!best || t.mtimeMs > best.mtimeMs)) best = t;
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
async function newestForWorkspace(root, projectDirs, workspacePaths) {
  let best = null;
  for (const ws of workspacePaths) {
    const enc = encodeProjectDir(ws);
    for (const d of projectDirs) {
      if (d !== enc && !d.startsWith(enc + '-')) continue;
      const t = await newestTranscriptIn(path.join(root, d));
      if (!t) continue;
      if (d !== enc) {
        const cwd = await cwdOf(t.file);
        if (!cwd || !inside(cwd, ws)) continue;
      }
      if (!best || t.mtimeMs > best.mtimeMs) best = t;
    }
  }
  return best;
}

let scan = { key: '', at: 0, /** @type {string | null} */ file: null };

/**
 * Finds the transcript of the most recently active session. The directory scan runs at most every
 * RESCAN_MS; in between only the chosen file is re-stat'ed.
 * @param {string[]} workspacePaths absolute paths of the open workspace folders
 * @param {'workspace' | 'latest'} source
 * @returns {Promise<{file: string, mtimeMs: number, size: number} | null>}
 */
async function findTranscript(workspacePaths, source) {
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
  if (source !== 'latest' && workspacePaths.length) hit = await newestForWorkspace(root, projectDirs, workspacePaths);
  if (!hit) hit = await newestOf(projectDirs.map((d) => path.join(root, d)));
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
 * Walks the transcript backwards to the latest main-thread API usage, or a compact boundary.
 * `at` is when that API call happened: the prompt cache expires `ttl` minutes after it.
 * @returns {{used: number, model: string | null, compacted: boolean, at: number | null, ttl: number | null} | null}
 */
function parseContext(text) {
  const lines = text.split('\n');
  let found = null;
  let seen = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || (!line.includes('"usage"') && !line.includes('compact_boundary'))) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d || typeof d !== 'object') continue;
    const at = Date.parse(d.timestamp) || null;
    if (d.type === 'system' && d.subtype === 'compact_boundary') {
      if (found) break; // the cache from before the compact no longer matters
      return { used: 0, model: null, compacted: true, at, ttl: null };
    }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    const m = d.message;
    const u = m && m.usage;
    if (!u || typeof u !== 'object' || m.model === '<synthetic>') continue;
    if (!found) {
      const used = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens) + num(u.output_tokens);
      const model = typeof m.model === 'string' ? m.model.slice(0, 64) : null;
      found = { used, model, compacted: false, at, ttl: cacheTtlOf(u) };
      if (found.ttl) return found;
    } else {
      const ttl = cacheTtlOf(u);
      if (ttl) return { ...found, ttl };
    }
    if (++seen > TTL_LOOKBACK) break;
  }
  return found;
}

/** Last full-file result per transcript: when the tail has no usage, nothing newer can exist. */
const fullReadCache = new Map();

/** @param {{file: string, size: number}} t */
async function readContext(t) {
  const ctx = parseContext(await readTail(t.file, t.size, TAIL_BYTES));
  if (ctx || t.size <= TAIL_BYTES) return ctx;
  if (fullReadCache.has(t.file)) return fullReadCache.get(t.file);
  const full = t.size <= MAX_FULL_READ ? parseContext(await readTail(t.file, t.size, t.size)) : null;
  fullReadCache.set(t.file, full);
  return full;
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
 * @returns {Promise<{items: {k: string, t: string}[], next: number}>} `next` is where the next read should start.
 */
async function readNewItems(file, from, to) {
  if (to - from > MAX_FEED_READ) from = to - MAX_FEED_READ;
  const buf = await readRange(file, from, to);
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return { items: [], next: from };
  const items = [];
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line) continue;
    try {
      items.push(...itemsOf(JSON.parse(line)));
    } catch {
      // a line cut in half by the MAX_FEED_READ window
    }
  }
  return { items, next: from + end + 1 };
}

module.exports = { findTranscript, readContext, parseContext, encodeProjectDir, readNewItems, redact };

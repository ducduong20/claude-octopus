// @ts-check
// Reads Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl)
// and works out how much of the context window the session currently uses.
// Kept free of the `vscode` module so it can be tested with plain Node.
const fs = require('fs');
const path = require('path');
const os = require('os');

const TAIL_BYTES = 2 * 1024 * 1024;
const MAX_FULL_READ = 64 * 1024 * 1024;

function projectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// Claude Code names each project folder after its cwd with every non-alphanumeric char replaced by '-'.
function encodeProjectDir(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** @returns {{file: string, mtimeMs: number, size: number} | null} */
function newestTranscriptIn(dir) {
  let best = null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const file = path.join(dir, e.name);
    try {
      const st = fs.statSync(file);
      if (!best || st.mtimeMs > best.mtimeMs) best = { file, mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      // file vanished between readdir and stat
    }
  }
  return best;
}

function newestOf(dirs) {
  let best = null;
  for (const d of dirs) {
    const t = newestTranscriptIn(d);
    if (t && (!best || t.mtimeMs > best.mtimeMs)) best = t;
  }
  return best;
}

/**
 * Finds the transcript of the most recently active session.
 * @param {string[]} workspacePaths absolute paths of the open workspace folders
 * @param {'workspace' | 'latest'} source
 */
function findTranscript(workspacePaths, source) {
  const root = projectsRoot();
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  if (source !== 'latest' && workspacePaths.length) {
    // Include sessions started in sub-folders of the workspace too.
    const prefixes = workspacePaths.map(encodeProjectDir);
    const mine = projectDirs.filter((d) => prefixes.some((p) => d === p || d.startsWith(p + '-')));
    const hit = newestOf(mine.map((d) => path.join(root, d)));
    if (hit) return hit;
  }
  return newestOf(projectDirs.map((d) => path.join(root, d)));
}

function readTail(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    fs.closeSync(fd);
  }
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
    const at = Date.parse(d.timestamp) || null;
    if (d.type === 'system' && d.subtype === 'compact_boundary') {
      if (found) break; // the cache from before the compact no longer matters
      return { used: 0, model: null, compacted: true, at, ttl: null };
    }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    const m = d.message;
    const u = m && m.usage;
    if (!u || m.model === '<synthetic>') continue;
    if (!found) {
      const used =
        (u.input_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.output_tokens || 0);
      found = { used, model: m.model || null, compacted: false, at, ttl: cacheTtlOf(u) };
      if (found.ttl) return found;
    } else {
      const ttl = cacheTtlOf(u);
      if (ttl) return { ...found, ttl };
    }
    if (++seen > TTL_LOOKBACK) break;
  }
  return found;
}

/** @param {{file: string, size: number}} t */
function readContext(t) {
  let ctx = parseContext(readTail(t.file, t.size, TAIL_BYTES));
  if (!ctx && t.size > TAIL_BYTES && t.size <= MAX_FULL_READ) ctx = parseContext(readTail(t.file, t.size, t.size));
  return ctx;
}

// ------------------------------------------------------------------ "knowledge" the session just took in

const MAX_FEED_READ = 1024 * 1024;

function short(s, n = 18) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function toolItem(name, input) {
  input = input || {};
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
      return { k: 'cmd', t: short(input.description || input.command) };
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
      return { k: 'tool', t: short(name.startsWith('mcp__') ? name.split('__').pop() : name) };
  }
}

/** Turns one transcript entry into the things it fed into the context. */
function itemsOf(d) {
  if (d.isSidechain || !d.message) return [];
  const content = d.message.content;
  if (d.type === 'assistant' && Array.isArray(content)) {
    const out = [];
    for (const c of content) {
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
          ? content.filter((c) => c.type === 'text').map((c) => c.text).join(' ')
          : '';
    if (Array.isArray(content) && content.some((c) => c.type === 'image')) return [{ k: 'image', t: 'image' }];
    // Skip slash-command echoes and system reminders, which start with a tag.
    if (text && !text.trim().startsWith('<')) return [{ k: 'prompt', t: short(text) }];
  }
  return [];
}

/**
 * Reads the complete lines appended between `from` and `to`.
 * @returns {{items: {k: string, t: string}[], next: number}} `next` is where the next read should start.
 */
function readNewItems(file, from, to) {
  if (to - from > MAX_FEED_READ) from = to - MAX_FEED_READ;
  const fd = fs.openSync(file, 'r');
  let buf;
  try {
    buf = Buffer.alloc(to - from);
    fs.readSync(fd, buf, 0, buf.length, from);
  } finally {
    fs.closeSync(fd);
  }
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

module.exports = { findTranscript, readContext, parseContext, encodeProjectDir, readNewItems };

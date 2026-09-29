// @ts-check
const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const { findTranscript, readContext, readNewItems } = require('./transcript');
const { activeTheme } = require('./themes');

const POLL_MS = 1500;
const PANIC_AT = 0.9;

const HUSH_MS = 6000;
const VIEW_IDS = {
  activitybar: 'claudeOctopus.view',
  explorer: 'claudeOctopus.explorerView',
  panel: 'claudeOctopus.panelView',
};

const cfg = () => vscode.workspace.getConfiguration('claudeOctopus');

// settings.json values are not type-checked by VS Code, and workspace settings come from whatever
// repository is open, so every value is validated and clamped before use.
function num(c, key, def, min, max) {
  const v = c.get(key, def);
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}
function oneOf(c, key, def, allowed) {
  const v = c.get(key, def);
  return allowed.includes(v) ? v : def;
}
function bool(c, key, def) {
  const v = c.get(key, def);
  return typeof v === 'boolean' ? v : def;
}

function settings() {
  const c = cfg();
  const themeDates = c.get('themeDates', []);
  return {
    contextWindow: num(c, 'contextWindow', 200000, 1000, 10000000),
    compactThreshold: num(c, 'compactThreshold', 0.75, 0.1, 1),
    sessionSource: oneOf(c, 'sessionSource', 'workspace', ['workspace', 'latest']),
    terminalNamePattern: String(c.get('terminalNamePattern', 'claude') || 'claude').slice(0, 100),
    confirmBelowThreshold: bool(c, 'confirmBelowThreshold', true),
    sleepAfterMinutes: num(c, 'sleepAfterMinutes', 5, 1, 1440),
    vibeAfterSeconds: num(c, 'vibeAfterSeconds', 60, 5, 3600),
    boredAfterSeconds: num(c, 'boredAfterSeconds', 90, 10, 3600),
    cacheTtl: oneOf(c, 'cacheTtl', 'auto', ['auto', '5m', '1h']),
    motion: oneOf(c, 'motion', 'calm', ['lively', 'calm', 'minimal']),
    size: num(c, 'size', 1, 0.3, 2),
    location: oneOf(c, 'location', 'activitybar', ['activitybar', 'explorer', 'panel', 'hidden']),
    quietWhileTyping: bool(c, 'quietWhileTyping', true),
    showSpeech: bool(c, 'showSpeech', true),
    showStatusBar: bool(c, 'showStatusBar', true),
    knowledgeLabels: bool(c, 'knowledgeLabels', true),
    percentDisplay: oneOf(c, 'percentDisplay', 'used', ['used', 'left']),
    theme: oneOf(c, 'theme', 'auto', ['auto', 'none', 'messi', 'women', 'christmas', 'tet']),
    themeDates: Array.isArray(themeDates) ? themeDates.slice(0, 50) : [],
  };
}

/** How long Claude's prompt cache stays warm after the last API call. */
function cacheTtlMs(st, ctx) {
  if (st.cacheTtl === '5m') return 5 * 60000;
  if (st.cacheTtl === '1h') return 60 * 60000;
  return ((ctx && ctx.ttl) || 60) * 60000;
}

function prefs(st = settings()) {
  return {
    motion: st.motion,
    size: st.size,
    speech: st.showSpeech,
    percent: st.percentDisplay,
    theme: activeTheme(new Date(), st.theme, st.themeDates),
  };
}

/** Polls the active transcript and publishes a context snapshot whenever it changes. */
class ContextMonitor {
  /** @param {(s: any) => void} onChange @param {(items: any[]) => void} onFeed */
  constructor(onChange, onFeed) {
    this.onChange = onChange;
    this.onFeed = onFeed;
    this.feedFile = '';
    this.feedPos = 0;
    this.state = { found: false, prefs: prefs() };
    this.lastKey = '';
    this.running = false;
    this.timer = setInterval(() => this.tick(), POLL_MS);
    this.tick();
  }

  /** Never overlaps itself: a slow disk simply skips a beat. */
  async tick(force = false) {
    if (this.running) return;
    this.running = true;
    try {
      await this.poll(force);
    } catch (e) {
      console.error('[claude-octopus]', e instanceof Error ? e.message : e);
    } finally {
      this.running = false;
    }
  }

  async poll(force) {
    const st = settings();
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    const t = await findTranscript(folders, st.sessionSource);
    if (!t) {
      if (this.state.found || force) this.publish({ found: false, prefs: prefs(st) });
      return;
    }
    const key = `${t.file}|${t.mtimeMs}|${t.size}|${new Date().toDateString()}`;
    if (key === this.lastKey && !force) return;
    this.lastKey = key;
    await this.feed(t, st);

    const ctx = await readContext(t);
    const used = ctx ? ctx.used : 0;
    let windowSize = st.contextWindow;
    if (used > windowSize || (ctx && ctx.model && /\[1m\]/i.test(ctx.model))) windowSize = Math.max(windowSize, 1000000);
    const threshold = st.compactThreshold;

    this.publish({
      found: true,
      sessionId: path.basename(t.file, '.jsonl'),
      project: path.basename(path.dirname(t.file)),
      model: ctx && ctx.model,
      used,
      window: windowSize,
      pct: Math.min(used / windowSize, 1),
      compacted: !!(ctx && ctx.compacted),
      lastWrite: t.mtimeMs,
      threshold,
      full: Math.max(PANIC_AT, threshold),
      sleepAfterMs: st.sleepAfterMinutes * 60000,
      vibeAfterMs: st.vibeAfterSeconds * 1000,
      boredAfterMs: st.boredAfterSeconds * 1000,
      lastApiAt: (ctx && ctx.at) || t.mtimeMs,
      cacheTtlMs: cacheTtlMs(st, ctx),
      prefs: prefs(st),
    });
  }

  /** Reports what was appended to the transcript since the last poll (never replays history). */
  async feed(t, st) {
    if (t.file !== this.feedFile || t.size < this.feedPos) {
      this.feedFile = t.file;
      this.feedPos = t.size;
      return;
    }
    if (t.size === this.feedPos) return;
    const { items, next } = await readNewItems(t.file, this.feedPos, t.size);
    this.feedPos = next;
    if (!items.length) return;
    // With labels off, only the kind of thing eaten (an icon) reaches the view.
    this.onFeed(st.knowledgeLabels ? items : items.map((it) => ({ k: it.k, t: '' })));
  }

  publish(s) {
    this.state = s;
    this.onChange(s);
  }

  dispose() {
    clearInterval(this.timer);
  }
}

class OctopusViewProvider {
  /** @param {vscode.ExtensionContext} ctx */
  constructor(ctx, getState, onMessage) {
    this.ctx = ctx;
    this.getState = getState;
    this.onMessage = onMessage;
    /** @type {Set<vscode.WebviewView>} */
    this.views = new Set();
  }

  /** @param {vscode.WebviewView} view */
  resolveWebviewView(view) {
    this.views.add(view);
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    view.webview.options = { enableScripts: true, enableCommandUris: false, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((m) => {
      // The view may only ask for state or a compact; anything else is ignored.
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') this.post({ type: 'state', state: this.getState() });
      else if (m.type === 'compact') this.onMessage({ type: 'compact', force: m.force === true });
    });
    view.onDidDispose(() => this.views.delete(view));
  }

  post(msg) {
    for (const v of this.views) v.webview.postMessage(msg);
  }

  /** @param {vscode.Webview} webview @param {vscode.Uri} media */
  html(webview, media) {
    const nonce = crypto.randomBytes(18).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'octopus.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'octopus.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Claude Octopus</title>
</head>
<body>
${BODY}
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

const BODY = `<div id="stage" class="mood-sleep">
  <div id="hud">
    <div class="row"><span id="pct">–</span><span id="tokens"></span></div>
    <div id="bar"><div id="fill"></div><div id="mark"></div></div>
    <div class="row sub"><span id="session"></span><span id="model"></span></div>
    <div id="banner"></div>
  </div>
  <div id="world">
    <div id="tank" aria-hidden="true">
      <div class="rays"><i></i><i></i><i></i></div>
      <div class="water-surface"></div>
    <svg class="weed w1" viewBox="0 0 5 20" shape-rendering="crispEdges">
      <rect class="wd" x="2" y="0" width="1" height="3"/><rect class="wd" x="1" y="3" width="1" height="3"/><rect class="wd" x="2" y="6" width="1" height="3"/>
      <rect class="wd" x="3" y="9" width="1" height="3"/><rect class="wd" x="2" y="12" width="1" height="3"/><rect class="wd" x="1" y="15" width="1" height="3"/>
      <rect class="wd" x="2" y="18" width="1" height="2"/>
      <rect class="wk" x="0" y="4" width="1" height="1"/><rect class="wk" x="3" y="7" width="1" height="1"/><rect class="wk" x="4" y="10" width="1" height="1"/><rect class="wk" x="0" y="14" width="1" height="1"/>
    </svg>
    <svg class="weed w2" viewBox="0 0 5 20" shape-rendering="crispEdges">
      <rect class="wd" x="2" y="0" width="1" height="3"/><rect class="wd" x="1" y="3" width="1" height="3"/><rect class="wd" x="2" y="6" width="1" height="3"/>
      <rect class="wd" x="3" y="9" width="1" height="3"/><rect class="wd" x="2" y="12" width="1" height="3"/><rect class="wd" x="1" y="15" width="1" height="3"/>
      <rect class="wd" x="2" y="18" width="1" height="2"/>
      <rect class="wk" x="0" y="4" width="1" height="1"/><rect class="wk" x="3" y="7" width="1" height="1"/><rect class="wk" x="4" y="10" width="1" height="1"/><rect class="wk" x="0" y="14" width="1" height="1"/>
    </svg>
    <svg class="weed w3" viewBox="0 0 5 20" shape-rendering="crispEdges">
      <rect class="wd" x="2" y="0" width="1" height="3"/><rect class="wd" x="1" y="3" width="1" height="3"/><rect class="wd" x="2" y="6" width="1" height="3"/>
      <rect class="wd" x="3" y="9" width="1" height="3"/><rect class="wd" x="2" y="12" width="1" height="3"/><rect class="wd" x="1" y="15" width="1" height="3"/>
      <rect class="wd" x="2" y="18" width="1" height="2"/>
      <rect class="wk" x="0" y="4" width="1" height="1"/><rect class="wk" x="3" y="7" width="1" height="1"/><rect class="wk" x="4" y="10" width="1" height="1"/><rect class="wk" x="0" y="14" width="1" height="1"/>
    </svg>
      <div class="sand"></div>
    </div>
    <div id="sky">
      <span class="moon">☾</span>
      <span class="star" style="left:12%;top:14%">✦</span>
      <span class="star" style="left:30%;top:30%;animation-delay:-1.2s">·</span>
      <span class="star" style="left:52%;top:10%;animation-delay:-2.1s">✧</span>
      <span class="star" style="left:68%;top:36%;animation-delay:-0.6s">·</span>
      <span class="star" style="left:20%;top:48%;animation-delay:-2.8s">✧</span>
      <span class="star" style="left:84%;top:52%;animation-delay:-1.7s">·</span>
    </div>
    <div id="ground"></div>
    <svg class="deco deco-christmas tree" viewBox="0 0 9 12" shape-rendering="crispEdges">
      <rect x="4" y="0" width="1" height="1" fill="#ffd166"/>
      <rect x="3" y="1" width="3" height="2" fill="#2f8f46"/><rect x="2" y="3" width="5" height="2" fill="#2f8f46"/>
      <rect x="1" y="5" width="7" height="2" fill="#2f8f46"/><rect x="0" y="7" width="9" height="2" fill="#2f8f46"/>
      <rect x="4" y="9" width="1" height="3" fill="#7a4a24"/>
      <rect x="3" y="2" width="1" height="1" fill="#ff5a5a"/><rect x="5" y="4" width="1" height="1" fill="#5ab0ff"/>
      <rect x="2" y="6" width="1" height="1" fill="#ffd166"/><rect x="6" y="8" width="1" height="1" fill="#ff5a5a"/>
    </svg>
    <svg class="deco deco-christmas gift" viewBox="0 0 6 5" shape-rendering="crispEdges">
      <rect x="0" y="1" width="6" height="4" fill="#5ab0ff"/><rect x="2.5" y="1" width="1" height="4" fill="#ffd166"/>
      <rect x="0" y="0.5" width="6" height="1" fill="#3d8ee0"/><rect x="1.5" y="0" width="1" height=".6" fill="#ffd166"/><rect x="3.5" y="0" width="1" height=".6" fill="#ffd166"/>
    </svg>
    <svg class="deco deco-tet lantern l" viewBox="0 0 6 12" shape-rendering="crispEdges">
      <rect x="2.8" y="0" width=".4" height="3" fill="#c9a227"/><rect x="1.5" y="3" width="3" height="1" fill="#f5c542"/>
      <rect x="0" y="4" width="6" height="4" fill="#e02828"/><rect x="1" y="4" width="1" height="4" fill="#b81c1c"/><rect x="4" y="4" width="1" height="4" fill="#b81c1c"/>
      <rect x="1.5" y="8" width="3" height="1" fill="#f5c542"/><rect x="2.6" y="9" width=".8" height="3" fill="#f5c542"/>
    </svg>
    <svg class="deco deco-tet lantern r" viewBox="0 0 6 12" shape-rendering="crispEdges">
      <rect x="2.8" y="0" width=".4" height="3" fill="#c9a227"/><rect x="1.5" y="3" width="3" height="1" fill="#f5c542"/>
      <rect x="0" y="4" width="6" height="4" fill="#e02828"/><rect x="1" y="4" width="1" height="4" fill="#b81c1c"/><rect x="4" y="4" width="1" height="4" fill="#b81c1c"/>
      <rect x="1.5" y="8" width="3" height="1" fill="#f5c542"/><rect x="2.6" y="9" width=".8" height="3" fill="#f5c542"/>
    </svg>
    <svg class="deco deco-messi goal" viewBox="0 0 12 8" shape-rendering="crispEdges">
      <g fill="rgba(255,255,255,.35)"><rect x="1" y="3" width="11" height=".2"/><rect x="1" y="5" width="11" height=".2"/><rect x="4" y="1" width=".2" height="7"/><rect x="7" y="1" width=".2" height="7"/><rect x="10" y="1" width=".2" height="7"/></g>
      <rect x="0" y="0" width="12" height="1" fill="#f2f2f2"/><rect x="0" y="0" width="1" height="8" fill="#f2f2f2"/>
    </svg>
    <div id="walker">
      <div id="bubble"></div>
      <div id="scaler">
        <div id="critter" title="">
          <div id="bobber">
            <svg viewBox="-1 -3 18 14" aria-label="Claude mascot">
              <g id="armL"><rect class="px" x="0" y="4" width="2.2" height="2"/>
                <rect class="th th-messi" x="0.7" y="4" width="0.6" height="2" fill="#f2c14e"/>
                <g id="coffee" class="acc">
                  <rect x=".35" y=".3" width=".25" height="1.6" fill="#222"/>
                  <rect x="-.6" y="1.7" width="1.8" height="2.5" fill="rgba(220,235,245,.55)"/>
                  <rect x="-.45" y="2.1" width="1.5" height="1.3" fill="#5a341c"/>
                  <rect x="-.45" y="3.4" width="1.5" height=".7" fill="#c8a27a"/>
                  <rect x="-.2" y="2.2" width=".45" height=".45" fill="rgba(255,255,255,.7)"/><rect x=".5" y="2.6" width=".45" height=".45" fill="rgba(255,255,255,.6)"/>
                </g>
                <g id="beer" class="acc">
                  <rect x="-.7" y="1.3" width="2.1" height="2.9" fill="#bfe3c4"/>
                  <rect x="-.55" y="1.5" width="1.8" height="2.55" fill="#f2b632"/>
                  <rect x="-.2" y="1.6" width=".22" height="2.3" fill="#ffd978"/><rect x=".5" y="1.6" width=".22" height="2.3" fill="#ffd978"/>
                  <rect x="-.8" y=".8" width="2.3" height=".75" fill="#fffaf0"/>
                  <rect x="0" y="2.6" width=".2" height=".2" fill="#fff"/><rect x=".8" y="3.2" width=".2" height=".2" fill="#fff"/>
                </g>
              </g>
              <g id="armR"><rect class="px" x="13.8" y="4" width="2.2" height="2"/>
                <g class="th th-women"><rect x="15" y="1.2" width=".5" height="3" fill="#3a9d4a"/><rect x="15.5" y="2.3" width=".7" height=".5" fill="#3a9d4a"/><rect x="14.6" y=".1" width="1.3" height="1.2" fill="#e0245e"/><rect x="14.9" y=".4" width=".6" height=".5" fill="#ff6b8b"/></g>
                <g class="th th-tet"><rect x="14.4" y="1.4" width="1.8" height="2.7" fill="#d8232a"/><rect x="14.4" y="1.4" width="1.8" height=".6" fill="#a8161c"/><rect x="14.9" y="2.4" width=".8" height=".8" fill="#f5c542"/></g>
              </g>
              <rect class="px leg l1" x="3" y="7.8" width="1" height="2.2"/>
              <rect class="px leg l2" x="5" y="7.8" width="1" height="2.2"/>
              <rect class="px leg l3" x="10" y="7.8" width="1" height="2.2"/>
              <rect class="px leg l4" x="12" y="7.8" width="1" height="2.2"/>
              <rect class="px" id="body" x="2" y="0" width="12" height="8"/>
              <g class="crack c1"><rect x="6" y="0" width=".5" height=".6"/><rect x="6.4" y=".5" width=".5" height=".6"/><rect x="6.1" y="1" width=".5" height=".6"/><rect x="6.6" y="1.5" width=".5" height=".6"/></g>
              <g class="crack c2"><rect x="13.5" y="4.8" width=".5" height=".5"/><rect x="13" y="5.2" width=".6" height=".5"/><rect x="13.2" y="5.7" width=".5" height=".5"/><rect x="12.7" y="6.1" width=".6" height=".5"/><rect x="12.9" y="6.6" width=".5" height=".6"/></g>
              <g class="crack c3"><rect x="2" y="6" width=".6" height=".5"/><rect x="2.5" y="6.4" width=".5" height=".5"/><rect x="2.9" y="6.3" width=".6" height=".5"/><rect x="3.3" y="6.8" width=".5" height=".6"/><rect x="9.8" y="0" width=".5" height=".6"/><rect x="9.4" y=".5" width=".5" height=".5"/><rect x="9.7" y=".9" width=".5" height=".6"/><rect x="9.2" y="1.4" width=".6" height=".5"/></g>
              <g class="th th-messi">
                <rect x="2" y="6" width="12" height="2" fill="#ffffff"/>
                <rect x="2.6" y="6" width="1" height="2" fill="#75aadb"/><rect x="4.8" y="6" width="1" height="2" fill="#75aadb"/>
                <rect x="7" y="6" width="1" height="2" fill="#75aadb"/><rect x="9.2" y="6" width="1" height="2" fill="#75aadb"/>
                <rect x="11.4" y="6" width="1" height="2" fill="#75aadb"/><rect x="13.3" y="6" width=".7" height="2" fill="#75aadb"/>
                <rect x="5" y="5.3" width="1" height="1.2" fill="#5b3a1e"/><rect x="10" y="5.3" width="1" height="1.2" fill="#5b3a1e"/>
                <rect x="6" y="6.1" width="4" height=".9" fill="#5b3a1e"/>
              </g>
              <g id="stars" class="th th-messi">
                <rect x="5.8" y="-2.5" width=".4" height="1.2" fill="#f5c542"/><rect x="5.4" y="-2.1" width="1.2" height=".4" fill="#f5c542"/>
                <rect x="7.8" y="-3" width=".4" height="1.2" fill="#f5c542"/><rect x="7.4" y="-2.6" width="1.2" height=".4" fill="#f5c542"/>
                <rect x="9.8" y="-2.5" width=".4" height="1.2" fill="#f5c542"/><rect x="9.4" y="-2.1" width="1.2" height=".4" fill="#f5c542"/>
              </g>
              <g id="ball" class="th th-messi"><rect x="15.4" y="8.7" width="1.4" height="1.4" fill="#ffffff"/><rect x="15.85" y="9.15" width=".5" height=".5" fill="#222"/></g>
              <g class="th th-women hat">
                <rect x="3" y="-.3" width="10" height=".5" fill="#3a9d4a"/>
                <rect x="3" y="-1" width=".9" height=".9" fill="#ff7eb6"/><rect x="5.3" y="-1.1" width=".9" height=".9" fill="#ffd166"/>
                <rect x="7.6" y="-1.2" width=".9" height=".9" fill="#ffffff"/><rect x="9.9" y="-1.1" width=".9" height=".9" fill="#c39bff"/>
                <rect x="12.1" y="-1" width=".9" height=".9" fill="#ff7eb6"/>
              </g>
              <g class="th th-christmas hat">
                <rect x="4" y="-1.8" width="8" height="1.1" fill="#d62d2d"/>
                <rect x="5.5" y="-2.8" width="6" height="1.1" fill="#d62d2d"/>
                <rect x="7.5" y="-3.6" width="4.5" height=".9" fill="#d62d2d"/>
                <rect x="10.8" y="-3.3" width="2" height=".9" fill="#d62d2d"/>
                <rect x="3" y="-.8" width="10" height="1.1" fill="#f7f7f7"/>
                <rect x="12.6" y="-3.1" width="1.3" height="1.3" fill="#ffffff"/>
              </g>
              <g id="shades" class="acc">
                <rect x="3" y="1.7" width="3.3" height="1.7" fill="#111"/><rect x="9.7" y="1.7" width="3.3" height="1.7" fill="#111"/>
                <rect x="6.3" y="2" width="3.4" height=".5" fill="#111"/>
                <rect x="3.5" y="2" width=".9" height=".4" fill="#ffffff" opacity=".75"/><rect x="10.2" y="2" width=".9" height=".4" fill="#ffffff" opacity=".75"/>
              </g>
              <g id="phones" class="acc">
                <rect x="2.3" y="-1.1" width="11.4" height=".6" fill="#2b2b2b"/>
                <rect x="1.8" y="-.7" width=".6" height="2.5" fill="#2b2b2b"/><rect x="13.6" y="-.7" width=".6" height="2.5" fill="#2b2b2b"/>
                <rect x="1.2" y="1.5" width="1.4" height="2.5" fill="#e05a8a"/><rect x="13.4" y="1.5" width="1.4" height="2.5" fill="#e05a8a"/>
              </g>
              <g id="game" class="acc">
                <rect x="5.6" y="5" width="4.8" height="2.8" fill="#9aa0a6"/>
                <rect x="6.1" y="5.3" width="3.8" height="1.5" fill="#8bc34a"/>
                <rect x="6.6" y="5.7" width=".6" height=".6" fill="#33691e"/><rect x="8.4" y="5.9" width="1" height=".4" fill="#33691e"/>
                <rect x="6.2" y="7.1" width=".6" height=".4" fill="#333"/><rect x="9" y="7.1" width=".5" height=".5" fill="#d32f2f"/>
              </g>
              <circle id="gum" class="acc" cx="8" cy="5.9" r=".45" fill="#ff8fc7"/>
              <g id="nightcap">
                <rect x="4" y="-1.8" width="8" height="1.1" fill="#5a7bd8"/>
                <rect x="5.5" y="-2.8" width="6" height="1.1" fill="#5a7bd8"/>
                <rect x="6.3" y="-2.8" width="1" height="1.1" fill="#8fa8ec"/>
                <rect x="7.5" y="-3.6" width="4.5" height="0.9" fill="#5a7bd8"/>
                <rect x="10.8" y="-3.3" width="2" height="0.9" fill="#5a7bd8"/>
                <rect x="3" y="-0.8" width="10" height="1.1" fill="#f1f1f1"/>
                <g id="pom"><rect x="12.6" y="-3.1" width="1.3" height="1.3" fill="#ffffff"/></g>
              </g>
              <rect class="blush" x="2.8" y="4.3" width="1.4" height=".7"/>
              <rect class="blush" x="11.8" y="4.3" width="1.4" height=".7"/>
              <g id="eyes"><rect class="eye" x="4" y="2" width="1" height="2"/><rect class="eye" x="11" y="2" width="1" height="2"/></g>
              <g id="faceHappy" class="face">
                <rect x="3.4" y="3" width=".7" height=".7"/><rect x="4.1" y="2.3" width=".8" height=".7"/><rect x="4.9" y="3" width=".7" height=".7"/>
                <rect x="10.4" y="3" width=".7" height=".7"/><rect x="11.1" y="2.3" width=".8" height=".7"/><rect x="11.9" y="3" width=".7" height=".7"/>
              </g>
              <g id="faceSqueeze" class="face">
                <rect x="3.7" y="2" width=".7" height=".7"/><rect x="4.4" y="2.65" width=".7" height=".7"/><rect x="3.7" y="3.3" width=".7" height=".7"/>
                <rect x="11.6" y="2" width=".7" height=".7"/><rect x="10.9" y="2.65" width=".7" height=".7"/><rect x="11.6" y="3.3" width=".7" height=".7"/>
              </g>
              <g id="faceLove" class="face">
                <rect x="3.6" y="2.1" width=".8" height=".6"/><rect x="4.6" y="2.1" width=".8" height=".6"/><rect x="3.6" y="2.7" width="1.8" height=".6"/><rect x="4.1" y="3.3" width=".8" height=".5"/>
                <rect x="10.6" y="2.1" width=".8" height=".6"/><rect x="11.6" y="2.1" width=".8" height=".6"/><rect x="10.6" y="2.7" width="1.8" height=".6"/><rect x="11.1" y="3.3" width=".8" height=".5"/>
              </g>
              <g id="smile"><rect x="6.8" y="5" width=".6" height=".6"/><rect x="7.4" y="5.6" width="1.2" height=".6"/><rect x="8.6" y="5" width=".6" height=".6"/></g>
              <rect id="mouth" x="7" y="5" width="2" height="1"/>
              <circle class="snot" cx="9.6" cy="5.5" r=".45"/>
            </svg>
          </div>
        </div>
      </div>
    </div>
    <div id="fx"></div>
  </div>
  <div id="hint"></div>
</div>`;

/** @type {vscode.Terminal | undefined} */
let chosenTerminal;

/**
 * The terminal to type /compact into: the one picked earlier, else one whose name matches the pattern.
 * Anything else is always confirmed by the user, since typing into the wrong terminal (ssh, a database
 * shell, an editor) would run '/compact' there.
 */
async function pickTerminal(forceAsk = false) {
  const terms = vscode.window.terminals;
  if (!forceAsk) {
    if (chosenTerminal && terms.includes(chosenTerminal)) return chosenTerminal;
    let re;
    try {
      re = new RegExp(settings().terminalNamePattern, 'i');
    } catch {
      re = /claude/i;
    }
    const matches = terms.filter((t) => re.test(t.name.slice(0, 200)));
    if (matches.length === 1) return matches[0];
  }
  if (!terms.length) return undefined;
  const pick = await vscode.window.showQuickPick(
    terms.map((t) => ({ label: t.name, t })),
    { placeHolder: 'Which terminal is running Claude Code?' }
  );
  if (pick) chosenTerminal = pick.t;
  return pick && pick.t;
}

/** @param {ContextMonitor} monitor @param {OctopusViewProvider} provider */
async function runCompact(monitor, provider, force) {
  const s = monitor.state;
  if (force && s.found && s.pct < s.threshold && settings().confirmBelowThreshold) {
    const ok = await vscode.window.showInformationMessage(
      `Context is only ${Math.round(s.pct * 100)}% full. Run /compact anyway?`,
      { modal: true },
      'Compact'
    );
    if (ok !== 'Compact') return;
  }
  const term = await pickTerminal();
  if (!term) {
    provider.post({ type: 'compactFailed', reason: 'no-terminal' });
    // The clipboard is only touched when the user asks for it.
    const copy = await vscode.window.showWarningMessage(
      'No terminal running Claude Code was chosen. Type /compact into Claude yourself, or copy it.',
      'Copy /compact'
    );
    if (copy) await vscode.env.clipboard.writeText('/compact');
    return;
  }
  term.show(false);
  // Send the Enter separately so Claude's TUI does not treat it as part of a paste.
  term.sendText('/compact', false);
  setTimeout(() => term.sendText('\r', false), 150);
  provider.post({ type: 'compacting' });
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'claudeOctopus.statusClick';
  let lastHush = 0;

  /** @type {OctopusViewProvider} */
  let provider;
  const monitor = new ContextMonitor(
    (s) => {
      renderStatus(status, s);
      if (provider) provider.post({ type: 'state', state: s });
    },
    (items) => provider && provider.post({ type: 'feed', items })
  );
  provider = new OctopusViewProvider(context, () => monitor.state, (m) => {
    if (m.type === 'compact') runCompact(monitor, provider, !!m.force);
  });
  renderStatus(status, monitor.state);



  context.subscriptions.push(
    status,
    monitor,
    ...Object.values(VIEW_IDS).map((id) =>
      vscode.window.registerWebviewViewProvider(id, provider, { webviewOptions: { retainContextWhenHidden: true } })
    ),
    vscode.commands.registerCommand('claudeOctopus.compact', () => runCompact(monitor, provider, true)),
    vscode.commands.registerCommand('claudeOctopus.refresh', () => monitor.tick(true)),
    vscode.commands.registerCommand('claudeOctopus.pickTerminal', () => pickTerminal(true)),
    vscode.commands.registerCommand('claudeOctopus.statusClick', () => {
      const s = monitor.state;
      if (s.found && s.pct >= s.threshold) runCompact(monitor, provider, false);
      else {
        const id = VIEW_IDS[settings().location];
        if (id) vscode.commands.executeCommand(id + '.focus');
      }
    }),
    vscode.commands.registerCommand('claudeOctopus.cycleMotion', async () => {
      const order = ['lively', 'calm', 'minimal'];
      const next = order[(order.indexOf(settings().motion) + 1) % order.length];
      await cfg().update('motion', next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Claude Octopus: motion → ${next}`, 2500);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('claudeOctopus')) return;
      renderStatus(status, monitor.state);
      monitor.tick(true);
    }),
    // Hold still while the developer is typing.
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length || !settings().quietWhileTyping) return;
      // Only the developer's own typing: the focused window's active editor (Claude's edits usually land elsewhere).
      const active = vscode.window.activeTextEditor;
      if (!vscode.window.state.focused || !active || active.document !== e.document) return;
      const now = Date.now();
      if (now - lastHush < 1000) return;
      lastHush = now;
      provider.post({ type: 'hush', ms: HUSH_MS });
    }),
    vscode.window.onDidCloseTerminal((t) => {
      if (t === chosenTerminal) chosenTerminal = undefined;
    })
  );
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
}

/** @param {vscode.StatusBarItem} item */
function renderStatus(item, s) {
  if (!settings().showStatusBar) {
    item.hide();
    return;
  }
  item.show();
  if (!s.found) {
    item.text = '$(circle-slash) Claude';
    item.tooltip = 'No Claude Code session found';
    item.backgroundColor = undefined;
    return;
  }
  const pct = Math.round(s.pct * 100);
  const left = settings().percentDisplay === 'left';
  item.text = left ? `$(hubot) ${100 - pct}% left` : `$(hubot) ${pct}%`;
  item.tooltip = `Claude context: ${pct}% used, ${fmt(s.used)} of ${fmt(s.window)} tokens (${100 - pct}% of the window left)\n${
    s.pct >= s.threshold ? 'Click to run /compact' : 'Click to show the octopus'
  }`;
  item.backgroundColor =
    s.pct >= s.full
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : s.pct >= s.threshold
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
}

function deactivate() {}

module.exports = { activate, deactivate };

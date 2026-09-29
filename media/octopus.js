// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  const stage = $('stage');
  const world = $('world');
  const walker = $('walker');
  const critter = $('critter');
  const eyes = $('eyes');
  const mouth = $('mouth');
  const bubble = $('bubble');
  const fx = $('fx');

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 1.3;
  const ORANGE = [217, 119, 87];
  const RED = [214, 52, 40];

  const LINES = {
    poke: ['hehe', 'that tickles!', 'boop!', 'hi there 👋', 'still hungry', 'plenty of room!', '*wiggles*'],
    idle: ['la la la', 'what are we building?', 'I like tokens', '*hums*', 'ready when you are'],
    stressed: ['getting full…', 'so many tokens…', 'I could use a /compact', 'ugh, heavy'],
    panic: ["I'm FULL! Click me", 'click me → /compact', 'too… many… tokens'],
    fed: ['nom nom', 'yum!', 'tasty context', '*munch*'],
    compacted: ['ahh, much lighter!', 'fresh start ✨', 'so light!', 'memory tidied up!'],
    wake: ['huh? oh hi!', "I'm awake!", '*yawn*'],
    swell: ['gonna pop!!', 'MMMPH!!', "can't hold it!!", '!!!', 'it’s coming out!!'],
    phew: ['phew…', '…still holding', 'h-help 🥺', 'that was close…', '/compact… pls…'],
    popped: ["…I'm okay!", 'whoa. much better.', 'did I explode?', 'ahh, finally!'],
    vibe: ['vibing ~ 🎧', 'Claude codes, I chill', 'lo-fi beats to vibe code to', 'auto-accept mode 😎', 'no typing, just vibes'],
    coffee: ['iced milk coffee ☕', 'slurp ☕', '*sip*', 'one more espresso shot 😎'],
    beer: ['Cheers! 🍺', '1, 2, 3… cheers!', 'fresh draft beer 🍺', '*gulp gulp*', 'bottoms up!'],
    bored: ['so bored…', '*sigh*', 'what now?', 'type something 🥱', '…', 'counting sheep: 1, 2, 3…', 'anybody there?', 'next prompt, please'],
    hibernate: ['*yaaawn*… cache went cold', 'nap time… 🌙', 'g’night, cache…'],
    sleepTalk: ['5 more minutes…', 'mmh… cache… cold…', 'zzz… tokens…', '*snore*', '…compact… zzz'],
    wakeCold: ['!! good morning ☀️', 'brr… cold cache, re-reading…', 'huh? I’m up, I’m up!'],
    stuffed: ["I'm stuffed! 🥺 click me", "can't… eat… more", 'tummy full 🥺 /compact pls'],
    pat: ['pat pat ♪', 'hehe~', 'mmm, nice', '♡', 'more pats pls'],
    patSad: ['thanks… still full 🥺', 'pats help a little'],
    fly: ['!', 'a friend!', 'hello little one ✿', 'so pretty…'],
  };

  const THEMES = {
    messi: {
      banner: '🐐 Thank you, Leo · 10',
      hello: ['Thank you, Leo! 💙🤍', 'GOAT mode on 🐐', "Let's go, Argentina! 🇦🇷"],
      lines: ['🐐 GOAT', 'the boys are singing… 🎶', 'number 10 💙🤍', 'one more for Leo', "let's go! ⚽"],
      cheer: 'Champion! 🏆',
    },
    women: {
      banner: '💐 Happy Women’s Day',
      hello: ['Happy Women’s Day! 💐', 'flowers for you 🌸', 'a rose for you 🌹'],
      lines: ['🌸 stay wonderful', 'a flower for you 🌹', 'gentle coding today 💗', '💐'],
      cheer: 'light as a petal 🌸',
    },
    christmas: {
      banner: '🎄 Merry Christmas',
      hello: ['Merry Christmas! 🎄', 'Ho ho ho! 🎅', 'peace and joy ✨'],
      lines: ['Ho ho ho!', 'jingle bells 🔔', 'have you been a good dev? 🎁', 'let it snow ❄️'],
      cheer: 'a lighter Christmas 🎁',
    },
    tet: {
      banner: '🧧 Happy Lunar New Year',
      hello: ['Happy Lunar New Year! 🧧', 'health and prosperity ✨', 'may all your wishes come true 🌼'],
      lines: ['a red envelope for you! 🧧', 'a bug-free year 🌼', 'may money flow in ✨', 'smooth deploys all year 🎆'],
      cheer: 'a light new year! 🎆',
    },
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (/** @type {any[]} */ arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Viewer preferences (from settings). `quiet()` is true when looping extras should stay still.
  let prefs = { motion: 'calm', size: 1, speech: true };
  let hushUntil = 0;
  const lively = () => prefs.motion === 'lively';
  const minimal = () => prefs.motion === 'minimal';
  const hushed = () => Date.now() < hushUntil;
  const quiet = () => minimal() || hushed();

  /** @type {any} */
  let state = null;
  let pct = 0;
  let mood = 'sleep';
  let busy = false;
  let compacting = false;
  let compactTimeout = 0;
  let x = 0;
  let lookUntil = 0;
  let baseW = 140;
  let size = MIN_SCALE;
  let sticky = null; // {html, cls} shown when no transient speech is active
  let sayTimer = 0;
  let pokeCount = 0;
  let pokeReset = 0;

  // ---------------------------------------------------------------- layout

  function layout() {
    const w = world.clientWidth;
    const h = world.clientHeight;
    // Leave room for the fully grown critter plus its speech bubble.
    const fit = Math.min((w * 0.8) / MAX_SCALE, ((h - 50) / MAX_SCALE) * (18 / 14));
    baseW = clamp(Math.min(fit, 150 * prefs.size), 24, 260);
    critter.style.width = baseW + 'px';
    stage.style.setProperty('--h', (baseW * 14) / 18 + 'px');
    stage.style.setProperty('--u', baseW / 18 + 'px'); // one pixel-art unit
    x = clamp(x, -maxX(), maxX());
    walker.style.setProperty('--walk-ms', '0ms');
    walker.style.setProperty('--x', x + 'px');
  }
  const maxX = () => Math.max(0, world.clientWidth / 2 - (baseW * size) / 2 - 10);
  new ResizeObserver(layout).observe(world);

  function setSize(s) {
    size = s;
    stage.style.setProperty('--size', String(s));
    x = clamp(x, -maxX(), maxX());
    walker.style.setProperty('--x', x + 'px');
  }

  function setColor(p) {
    const t = clamp((p - 0.45) / 0.5, 0, 1);
    const c = ORANGE.map((v, i) => Math.round(v + (RED[i] - v) * t));
    stage.style.setProperty('--body', `rgb(${c.join(',')})`);
  }

  // ---------------------------------------------------------------- helpers

  /** Plays a one-shot `act-<name>` class on the stage. */
  function play(name, ms) {
    stage.classList.remove('act-' + name);
    void stage.offsetWidth; // restart the animation if it is already running
    stage.classList.add('act-' + name);
    return sleep(ms).then(() => stage.classList.remove('act-' + name));
  }

  function flag(cls, ms) {
    stage.classList.add(cls);
    setTimeout(() => stage.classList.remove(cls), ms);
  }

  /** Swaps in an alternate face (happy / love / wink / squeeze) for a while. */
  let faceTimer = 0;
  function face(name, ms) {
    stage.classList.remove('face-happy', 'face-love', 'face-wink', 'face-squeeze');
    clearTimeout(faceTimer);
    if (!name) return;
    stage.classList.add('face-' + name);
    faceTimer = setTimeout(() => stage.classList.remove('face-' + name), ms);
  }

  function look(dx, dy = 0, ms = 1200) {
    eyes.style.transform = `translate(${dx}px, ${dy}px)`;
    lookUntil = Date.now() + ms;
  }

  function makeDots() {
    const dots = document.createElement('span');
    dots.className = 'dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.textContent = '•';
      dots.appendChild(dot);
    }
    return dots;
  }

  // Built from DOM nodes and textContent only, so no string can ever be parsed as HTML.
  function showBubble(text, cls, dots = false) {
    bubble.replaceChildren();
    if (text) {
      const span = document.createElement('span');
      span.textContent = text;
      bubble.appendChild(span);
    }
    if (dots) bubble.appendChild(makeDots());
    bubble.className = 'show ' + (cls || '');
  }

  function say(text, ms = 2200, cls = '') {
    if (!prefs.speech && cls !== 'alert') return;
    if (hushed() && cls !== 'alert') return;
    clearTimeout(sayTimer);
    showBubble(text, cls);
    sayTimer = setTimeout(restoreSticky, ms);
  }

  /** A bubble that stays up while a mood lasts (null clears it). */
  function setSticky(text, cls = '', dots = false) {
    sticky = text || dots ? { text, cls, dots } : null;
    clearTimeout(sayTimer);
    restoreSticky();
  }

  function restoreSticky() {
    if (sticky) showBubble(sticky.text, sticky.cls, sticky.dots);
    else bubble.className = '';
  }

  // ---------------------------------------------------------------- particles

  function rel(el) {
    const r = el.getBoundingClientRect();
    const w = world.getBoundingClientRect();
    return { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height, cx: r.left - w.left + r.width / 2, cy: r.top - w.top + r.height / 2 };
  }

  function spawn(cls, text, x0, y0, frames, opts) {
    const el = document.createElement('div');
    el.className = 'p ' + cls;
    if (text) el.textContent = text;
    el.style.left = x0 + 'px';
    el.style.top = y0 + 'px';
    fx.appendChild(el);
    const a = el.animate(frames, opts);
    a.onfinish = () => el.remove();
    return el;
  }

  const KINDS = {
    file: { icon: '📄', hue: 210 },
    edit: { icon: '✏️', hue: 130 },
    cmd: { icon: '›_', hue: 0, sat: 0 },
    search: { icon: '🔍', hue: 48 },
    web: { icon: '🌐', hue: 265 },
    agent: { icon: '🤖', hue: 180 },
    prompt: { icon: '💬', hue: 22 },
    think: { icon: '💡', hue: 55 },
    image: { icon: '🖼️', hue: 300 },
    todo: { icon: '☑️', hue: 150 },
    tool: { icon: '🔧', hue: 200, sat: 15 },
  };
  // Shown when the context grew but we don't know exactly what was added.
  const GENERIC = [
    { k: 'think', t: '' }, { k: 'file', t: '' }, { k: 'prompt', t: '' },
    { k: 'tool', t: '{ }' }, { k: 'tool', t: '</>' }, { k: 'search', t: '' },
  ];
  const MAX_CHIPS = 8;

  /** Builds a knowledge chip (icon + short label) hidden inside the tank, ready to animate. */
  function makeChip(it) {
    const kind = KINDS[it.k] || KINDS.tool;
    const el = document.createElement('div');
    el.className = 'p chip';
    el.style.setProperty('--hue', String(kind.hue));
    el.style.setProperty('--sat', (kind.sat ?? 65) + '%');
    const icon = document.createElement('b');
    icon.textContent = kind.icon;
    el.appendChild(icon);
    if (it.t) el.appendChild(document.createTextNode(it.t));
    el.style.visibility = 'hidden';
    fx.appendChild(el);
    return el;
  }

  /**
   * Knowledge (files read, commands run, prompts…) drops into the tank, sinks like fish food and
   * drifts into the octopus' mouth.
   * Returns the chips shown and roughly how long the whole meal takes.
   */
  function knowledge(items) {
    // Collapse repeats (e.g. many thinking blocks) and cap the batch.
    const list = [];
    for (const it of items) {
      const prev = list[list.length - 1];
      if (prev && prev.k === it.k && prev.t === it.t) continue;
      list.push(it);
    }
    const extra = list.length - MAX_CHIPS;
    const shown = list.slice(-MAX_CHIPS);
    if (extra > 0) shown.push({ k: 'tool', t: `+${extra} more` });

    const w = world.clientWidth;
    const body = rel(critter);
    const SWALLOW = 520;
    let end = 0;
    shown.forEach((it, i) => {
      const el = makeChip(it);
      const half = el.offsetWidth / 2 + 6;
      // Drops in at the surface on alternating sides and sinks to beside the octopus
      // (anywhere on that half when the tank is narrow).
      const side = i % 2 === 0 ? -1 : 1;
      const lo = side < 0 ? half : Math.min(w - half, body.x + body.w + 8);
      const hi = side < 0 ? Math.max(half, body.x - 8) : w - half;
      const x0 = hi - lo > 10 ? rand(lo, hi) : side < 0 ? rand(half, w / 2) : rand(w / 2, w - half);
      const y0 = 6;
      const tx = clamp(x0 + rand(-12, 12), half, w - half);
      const ty = clamp(rand(body.y - 60, body.y - 10), 30, Math.max(40, body.y - 6));
      const sink = rand(1100, 1500);
      const delay = i * 280;
      el.style.left = x0 + 'px';
      el.style.top = y0 + 'px';
      el.style.visibility = '';
      const sway = rand(8, 16) * (Math.random() < 0.5 ? -1 : 1);
      const fall = el.animate(
        [
          { transform: 'translate(-50%,-50%) scale(.7)', opacity: 0 },
          { transform: `translate(-50%,-50%) translate(${sway * 0.4}px, ${(ty - y0) * 0.3}px) scale(1)`, opacity: 1, offset: 0.25 },
          { transform: `translate(-50%,-50%) translate(${-sway * 0.5}px, ${(ty - y0) * 0.7}px) rotate(${sway / 3}deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate(-50%,-50%) translate(${tx - x0}px, ${ty - y0}px)`, opacity: 1 },
        ],
        { duration: sink, delay, easing: 'ease-out', fill: 'both' }
      );
      end = Math.max(end, delay + sink + SWALLOW);
      fall.finished.then(() => {
        const m = rel(mouth);
        const mx = m.cx - x0;
        const my = m.cy - y0;
        const sx = tx - x0;
        const sy = ty - y0;
        const eat = el.animate(
          [
            { transform: `translate(-50%,-50%) translate(${sx}px, ${sy}px)` },
            { transform: `translate(-50%,-50%) translate(${(sx + mx) / 2}px, ${(sy + my) / 2 - 10}px) scale(.7)`, offset: 0.55 },
            { transform: `translate(-50%,-50%) translate(${mx}px, ${my}px) scale(.12)`, opacity: 0.2 },
          ],
          { duration: SWALLOW, easing: 'ease-in', fill: 'forwards' }
        );
        eat.onfinish = () => el.remove();
      });
    });
    return { shown, ms: end };
  }

  function sweat(both = false) {
    const c = rel(critter);
    const sides = both ? [-1, 1] : [Math.random() < 0.5 ? -1 : 1];
    for (const s of sides) {
      const x0 = c.cx + s * c.w * rand(0.28, 0.42);
      const y0 = c.y + c.h * 0.1;
      spawn('drop', '', x0, y0, [
        { transform: 'translate(0,0) scale(0.4)', opacity: 0 },
        { transform: `translate(${s * 4}px, 4px) scale(1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${s * 12}px, 28px) scale(0.8)`, opacity: 0 },
      ], { duration: 900, easing: 'ease-in' });
    }
  }

  function zzz() {
    const c = rel(critter);
    spawn('zzz', pick(['z', 'Z', 'z']), c.x + c.w * 0.8, c.y, [
      { transform: 'translate(0,0) scale(0.6)', opacity: 0 },
      { transform: 'translate(8px,-12px) scale(1)', opacity: 0.8, offset: 0.3 },
      { transform: `translate(${rand(18, 30)}px,-46px) scale(1.5)`, opacity: 0 },
    ], { duration: 2600, easing: 'ease-out' });
  }

  function hearts(n = 3) {
    const c = rel(critter);
    for (let i = 0; i < n; i++) {
      spawn('heart', '♥', c.cx + rand(-c.w / 3, c.w / 3), c.y + c.h * 0.2, [
        { transform: 'translate(0,0) scale(0.4)', opacity: 0 },
        { transform: 'translate(0,-10px) scale(1)', opacity: 1, offset: 0.2 },
        { transform: `translate(${rand(-15, 15)}px, -50px) scale(0.8)`, opacity: 0 },
      ], { duration: 1300, delay: i * 120, easing: 'ease-out', fill: 'backwards' });
    }
  }

  function sparkles(n = 14) {
    const c = rel(critter);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
      const d = rand(40, 80) * Math.max(size, 0.7);
      spawn('spark', pick(['✦', '✧', '·', '✦']), c.cx - 6, c.cy - 8, [
        { transform: 'translate(0,0) scale(0.3)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(1.2) rotate(90deg)`, opacity: 0 },
      ], { duration: rand(700, 1100), easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
  }

  function notes(n = 4) {
    const c = rel(critter);
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1;
      spawn('note', pick(['♪', '♫', '♩']), c.cx + s * c.w * 0.35, c.y + c.h * 0.2, [
        { transform: 'translate(0,0) rotate(0)', opacity: 0 },
        { transform: `translate(${s * 6}px,-14px) rotate(${s * 10}deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${s * rand(14, 26)}px,-48px) rotate(${s * -10}deg)`, opacity: 0 },
      ], { duration: 1600, delay: i * 450, easing: 'ease-out', fill: 'backwards' });
    }
  }

  function burps(n = 3) {
    const m = rel(mouth);
    for (let i = 0; i < n; i++) {
      spawn('burp', '', m.cx - 4, m.cy - 4, [
        { transform: 'translate(0,0) scale(0.3)', opacity: 0.9 },
        { transform: `translate(${rand(-14, 14)}px, ${rand(-40, -60)}px) scale(${rand(0.9, 1.6)})`, opacity: 0 },
      ], { duration: rand(1100, 1600), delay: i * 180, easing: 'ease-out', fill: 'backwards' });
    }
  }

  /** Pixel chunks flung out with a little gravity. */
  function debris(n, power = 1) {
    const c = rel(critter);
    const color = getComputedStyle(stage).getPropertyValue('--body');
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05) + (Math.random() < 0.2 ? Math.PI * 0.6 : 0);
      const v = rand(50, 150) * power;
      const spin = rand(-720, 720);
      const g = 220 * power;
      const frames = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => ({
        transform: `translate(${Math.cos(a) * v * t * 1.3}px, ${Math.sin(a) * v * t + g * t * t}px) rotate(${spin * t}deg)`,
        opacity: t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3,
      }));
      const el = spawn('debris', '', c.cx + rand(-c.w / 3, c.w / 3), c.cy + rand(-c.h / 3, c.h / 4), frames, {
        duration: rand(700, 1200) * Math.max(power, 0.8),
        easing: 'linear',
      });
      const sz = rand(4, 10) * Math.max(size, 0.7);
      el.style.width = el.style.height = sz + 'px';
      el.style.background = Math.random() < 0.2 ? '#ffe38a' : color;
    }
  }

  function flashScreen() {
    spawn('flash', '', 0, 0, [{ opacity: 0.6 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' });
  }

  function shockwave() {
    const c = rel(critter);
    [0, 140].forEach((delay) =>
      spawn('ring', '', c.cx, c.cy, [
        { transform: 'scale(0.3)', opacity: 1 },
        { transform: `scale(${Math.max(world.clientWidth, world.clientHeight) / 12})`, opacity: 0 },
      ], { duration: 700, delay, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'backwards' })
    );
  }

  /** Something drifting down across the whole view (petals, snow, apricot blossoms). */
  function fall(cls, text = '') {
    const w = world.clientWidth;
    const h = world.clientHeight;
    const x0 = rand(0, w);
    const sway = rand(-40, 40);
    spawn('fall ' + cls, text, x0, -12, [
      { transform: 'translate(0,0) rotate(0)', opacity: 0 },
      { transform: `translate(${sway * 0.5}px, ${h * 0.3}px) rotate(120deg)`, opacity: 0.9, offset: 0.25 },
      { transform: `translate(${-sway * 0.3}px, ${h * 0.65}px) rotate(220deg)`, opacity: 0.9, offset: 0.65 },
      { transform: `translate(${sway}px, ${h + 10}px) rotate(360deg)`, opacity: 0 },
    ], { duration: rand(6000, 9500), easing: 'linear' });
  }

  /** An emoji item tossed from the octopus in an arc (flower, gift, red envelope, trophy…). */
  function toss(text, up = false) {
    const c = rel(critter);
    const s = Math.random() < 0.5 ? -1 : 1;
    spawn('item', text, c.cx - 9, c.y + c.h * 0.2, up
      ? [
          { transform: 'translate(0,0) scale(0.4)', opacity: 0 },
          { transform: 'translate(0,-34px) scale(1.2)', opacity: 1, offset: 0.35 },
          { transform: 'translate(0,-40px) scale(1.2)', opacity: 1, offset: 0.8 },
          { transform: 'translate(0,-50px) scale(1)', opacity: 0 },
        ]
      : [
          { transform: 'translate(0,0) scale(0.5) rotate(0)', opacity: 0 },
          { transform: `translate(${s * 40}px,-50px) scale(1) rotate(${s * 20}deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${s * 80}px,-10px) scale(0.9) rotate(${s * 40}deg)`, opacity: 0 },
        ], { duration: up ? 2200 : 1500, easing: 'ease-out' });
  }

  function fireworks(n = 2) {
    const w = world.clientWidth;
    const colors = ['#ffd166', '#ff5a5a', '#ff9ee5', '#7bdcff', '#b5ff7b'];
    for (let k = 0; k < n; k++) {
      const cx = rand(w * 0.2, w * 0.8);
      const cy = rand(30, world.clientHeight * 0.35);
      const color = pick(colors);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const d = rand(26, 40);
        const el = spawn('firework', '', cx, cy, [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 12}px) scale(0.4)`, opacity: 0 },
        ], { duration: 1100, delay: k * 500, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
        el.style.background = color;
      }
    }
  }

  /** Bubbles rising to the surface, from the octopus or a clump of seaweed. */
  function bubbleUp(fromOctopus) {
    let x;
    let y;
    if (fromOctopus) {
      const m = rel(mouth);
      x = m.cx + rand(-4, 4);
      y = m.y;
    } else {
      const weeds = document.querySelectorAll('.weed');
      const wd = rel(weeds[Math.floor(Math.random() * weeds.length)]);
      x = wd.cx;
      y = wd.y + wd.h * 0.3;
    }
    const n = fromOctopus ? 2 : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const drift = rand(-12, 12);
      const el = spawn('bubble-up', '', x, y, [
        { transform: 'translate(0,0) scale(.5)', opacity: 0 },
        { transform: `translate(${drift * 0.4}px, ${-y * 0.3}px) scale(1)`, opacity: 0.9, offset: 0.2 },
        { transform: `translate(${-drift * 0.3}px, ${-y * 0.7}px) scale(1.1)`, opacity: 0.8, offset: 0.65 },
        { transform: `translate(${drift}px, ${-y + 4}px) scale(1.2)`, opacity: 0 },
      ], { duration: rand(2600, 4200), delay: i * 350, easing: 'ease-in', fill: 'backwards' });
      const sz = rand(3, 7);
      el.style.width = el.style.height = sz + 'px';
    }
  }

  function steam() {
    const c = rel(critter);
    for (const s of [-1, 1]) {
      spawn('steam', '', c.cx + s * c.w * 0.3, c.y + 4, [
        { transform: 'translate(0,0) scale(0.5)', opacity: 0.8 },
        { transform: `translate(${s * 10}px,-30px) scale(2.2)`, opacity: 0 },
      ], { duration: 1000, easing: 'ease-out' });
    }
  }

  // ---------------------------------------------------------------- behaviours

  async function walkTo(nx) {
    nx = clamp(nx, -maxX(), maxX());
    const dist = Math.abs(nx - x);
    if (dist < 6) return;
    const ms = (dist / 45) * 1000;
    look(Math.sign(nx - x), 0, ms + 300);
    walker.style.setProperty('--walk-ms', ms + 'ms');
    walker.style.setProperty('--x', nx + 'px');
    stage.classList.add('walking');
    x = nx;
    await sleep(ms);
    stage.classList.remove('walking');
  }

  async function lookAround() {
    look(-1, 0, 900);
    await sleep(700);
    look(1, 0, 900);
    await sleep(700);
    look(0, -0.5, 600);
    await sleep(500);
    look(0, 0, 0);
  }

  let lastFeedAt = 0;

  /** The transcript reported concrete things Claude just took in. */
  async function feed(items = []) {
    lastFeedAt = Date.now();
    if (quiet()) return; // still grows via applyState, just without the flying chips
    const { shown, ms } = knowledge(items);
    await sleep(ms);
    await play('eat', 880);
    const named = shown.filter((it) => it.t && it.k !== 'think' && !it.t.startsWith('+'));
    if (named.length && Math.random() < 0.4) say(`mm, ${pick(named).t}`, 1600);
    else if (Math.random() < 0.3) say(pick(LINES.fed), 1400);
  }

  /** The context grew; show generic knowledge unless feed() already showed what it was. */
  async function eat(delta) {
    if (Date.now() - lastFeedAt < 5000 || quiet()) return;
    const n = clamp(Math.round(delta * 60), 2, 5);
    const { ms } = knowledge(Array.from({ length: n }, () => pick(GENERIC)));
    await sleep(ms);
    await play('eat', 880);
    if (Math.random() < 0.35) say(pick(LINES.fed), 1400);
  }

  let wasStuffed = false;

  async function bigBang() {
    stage.classList.remove('swell', 'quake');
    if (lively()) {
      stage.classList.add('quake');
      await sleep(250);
      flashScreen();
    }
    shockwave();
    debris(minimal() ? 12 : 26, 1.4);
    sparkles(18);
    stage.classList.add('popped');
    say('💥 POP!', 1000);
    await sleep(350);
    stage.classList.remove('quake');
    await sleep(750);
    stage.classList.remove('popped'); // springs back in, already small
    face('squeeze', 700);
    await sleep(700);
    face('happy', 2600);
    sparkles(10);
    say(pick(LINES.popped), 2200);
    await play('hop', 600);
  }

  async function themeCheer() {
    const t = THEMES[prefs.theme];
    if (!t) return;
    await sleep(400);
    if (prefs.theme === 'messi') toss('🏆', true);
    else if (prefs.theme === 'tet') fireworks(lively() ? 3 : 2);
    else if (prefs.theme === 'christmas') { toss('🎁'); toss('🎁'); }
    else if (prefs.theme === 'women') { hearts(4); toss('💐', true); }
    say(t.cheer, 2200);
    await play('celebrate', 1800);
  }

  async function celebrate() {
    setSticky(null);
    celebrateInner().then(themeCheer);
  }

  async function celebrateInner() {
    if (wasStuffed) {
      wasStuffed = false;
      await bigBang();
      await play('backflip', 1000);
      hearts(3);
      return;
    }
    say('*burp*', 900);
    burps(4);
    await play('squish', 500);
    face('happy', 3200);
    sparkles();
    await play('poof', 900);
    say(pick(LINES.compacted), 2600);
    await play('backflip', 1000);
    hearts(2);
    await play('hop', 600);
  }

  // ---------------------------------------------------------------- cute stuff

  /** A pixel butterfly flutters in, rests on the octopus' head, then leaves. */
  async function butterfly() {
    const c = rel(critter);
    const w = world.clientWidth;
    const fromLeft = Math.random() < 0.5;
    const x0 = fromLeft ? -16 : w + 16;
    const y0 = rand(10, c.y * 0.6);
    const hx = c.cx - 6 + rand(-c.w * 0.2, c.w * 0.2);
    const hy = c.y - 8;
    const el = document.createElement('div');
    el.className = 'p fly';
    el.style.setProperty('--wing', `hsl(${pick([270, 320, 190, 45, 140])} 75% 72%)`);
    el.style.left = x0 + 'px';
    el.style.top = y0 + 'px';
    fx.appendChild(el);
    const dx = hx - x0;
    const dy = hy - y0;
    const flightIn = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      transform: `translate(${dx * t}px, ${dy * t + Math.sin(t * Math.PI * 3) * 18}px)`,
    }));
    const eyeTrack = setInterval(() => {
      const f = el.getBoundingClientRect();
      const k = critter.getBoundingClientRect();
      const ex = clamp((f.left - (k.left + k.width / 2)) / 50, -1, 1);
      const ey = clamp((f.top - (k.top + k.height / 3)) / 60, -1, 0.6);
      eyes.style.transform = `translate(${ex.toFixed(2)}px, ${ey.toFixed(2)}px)`;
      lookUntil = Date.now() + 300;
    }, 80);

    await el.animate(flightIn, { duration: 2600, easing: 'ease-in-out', fill: 'forwards' }).finished;
    clearInterval(eyeTrack);
    el.classList.add('rest');
    stage.classList.add('act-lookup');
    flag('blushing', 2600);
    say(pick(LINES.fly), 2200);
    await sleep(900);
    face('happy', 1800);
    await sleep(1800);
    stage.classList.remove('act-lookup');
    el.classList.remove('rest');
    const ex = fromLeft ? w + 20 - x0 : -20 - x0;
    const away = [0, 0.5, 1].map((t) => ({
      transform: `translate(${dx + (ex - dx) * t}px, ${dy - 70 * t + Math.sin(t * Math.PI * 2) * 12}px)`,
    }));
    const a = el.animate(away, { duration: 2000, easing: 'ease-in', fill: 'forwards' });
    look(fromLeft ? 1 : -1, -0.5, 1500);
    play(fromLeft ? 'wave' : 'waveL', 1300);
    say('bye bye ~', 1400);
    await a.finished;
    el.remove();
  }

  /** At 100%: swells up, flashes and almost bursts, then barely holds it in. */
  let swelling = false;
  async function swellUp() {
    if (swelling) return;
    swelling = true;
    try {
      say(pick(LINES.swell), 1500, 'alert');
      stage.classList.add('swell');
      steam();
      await sleep(700);
      if (lively()) stage.classList.add('quake');
      steam();
      await sleep(800);
      if (mood !== 'stuffed') return;
      debris(tension >= 3 ? 7 : 4, 0.7);
      steam();
      burps(3);
      stage.classList.remove('swell', 'quake');
      await play('squish', 500);
      say(pick(LINES.phew), 1600);
    } finally {
      stage.classList.remove('swell', 'quake');
      swelling = false;
    }
  }

  // ---- vibe & bored actions
  function sigh() {
    const m = rel(mouth);
    spawn('sigh', pick(['*sigh*', '~', 'hmm…']), m.cx + 6, m.cy - 6, [
      { transform: 'translate(0,0)', opacity: 0 },
      { transform: 'translate(6px,-4px)', opacity: 0.8, offset: 0.3 },
      { transform: 'translate(22px,6px)', opacity: 0 },
    ], { duration: 1800, easing: 'ease-out' });
  }

  // Daytime: iced Vietnamese coffee. From 17:00: a glass of Hanoi draft beer.
  const drink = () =>
    /** @type {any} */ (window).__drink || (new Date().getHours() >= 17 || new Date().getHours() < 4 ? 'beer' : 'coffee');

  async function sip() {
    await play('sip', 1800);
    say(pick(LINES[drink()]), 1400);
  }

  async function cheers() {
    say(pick(['Cheers! 🍺', '1, 2, 3… cheers!', 'bottoms up!']), 1600);
    face('happy', 1600);
    await play('cheers', 1600);
  }

  async function rollEyes() {
    look(-1, -1, 500);
    await sleep(250);
    look(0, -1.3, 500);
    await sleep(250);
    look(1, -1, 500);
    await sleep(300);
    look(0, 0, 0);
    sigh();
  }

  async function playGame() {
    const p = play('game', 3600);
    say('🎮 …', 1200);
    await sleep(3000);
    say(pick(['game over 😩', 'new high score! 🎮', 'lost again…']), 1600);
    await p;
  }

  async function bubblegum() {
    const p = play('gum', 2400);
    await sleep(2150);
    face('squeeze', 600);
    say('pop!', 900);
    await p;
  }

  async function melt() {
    say(pick(['lying flat…', '*melting*', 'bored stiff']), 2000);
    await play('melt', 4000);
  }

  // ---- themed actions
  async function juggle() {
    say(pick(['toque, toque…', 'keepy-uppy ⚽', '1, 2, 3…']), 1800);
    await play('juggle', 2000);
  }

  async function shoot() {
    const goal = /** @type {HTMLElement} */ (document.querySelector('.deco.goal'));
    const b = rel(document.getElementById('ball') || critter);
    const g = rel(goal);
    play('shoot', 1400);
    const dx = g.x + g.w * 0.45 - b.cx;
    const dy = g.y + g.h * 0.55 - b.cy;
    const ball = spawn('item', '⚽', b.cx - 8, b.cy - 9, [
      { transform: 'translate(0,0) rotate(0) scale(.7)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) rotate(360deg) scale(.7)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(720deg) scale(.6)` },
    ], { duration: 700, easing: 'ease-in', fill: 'forwards' });
    await sleep(700);
    ball.remove();
    goal.classList.remove('net');
    void goal.offsetWidth;
    goal.classList.add('net');
    say('GOOOAL! ⚽', 1600);
    face('happy', 1600);
    sparkles(8);
    await play('celebrate', 1800);
  }

  async function goat() {
    face('happy', 1800);
    say('🐐 GOAT', 1600);
    toss('🐐', true);
    await play('celebrate', 1800);
  }

  async function giveThemed() {
    const t = prefs.theme;
    const item = t === 'women' ? pick(['🌹', '💐', '🌸']) : t === 'christmas' ? '🎁' : t === 'tet' ? '🧧' : '⚽';
    play('give', 1200);
    await sleep(300);
    toss(item);
    if (t === 'tet') sparkles(6);
    if (t === 'women') hearts(2);
    say(pick(THEMES[t].lines), 1800);
    await sleep(900);
  }

  async function sitDown() {
    const ms = rand(3500, 6000);
    const p = play('sit', ms);
    await sleep(900);
    face('happy', ms - 1400);
    if (Math.random() < 0.5) say('loaf mode', 1500);
    await p;
  }

  async function hum() {
    face('happy', 2400);
    notes(5);
    await play('sway', 2400);
  }

  async function sneeze() {
    say('a… a…', 900);
    await sleep(500);
    const p = play('sneeze', 1500);
    await sleep(750);
    say('ACHOO!', 1000);
    steam();
    await p;
    flag('blushing', 1800);
    face('squeeze', 700);
    say('excuse me 😳', 1500);
  }

  async function wink() {
    face('wink', 900);
    const c = rel(critter);
    spawn('spark', '✧', c.x + c.w * 0.75, c.y + c.h * 0.15, [
      { transform: 'translate(0,0) scale(0.3) rotate(0)', opacity: 1 },
      { transform: 'translate(10px,-14px) scale(1.4) rotate(120deg)', opacity: 0 },
    ], { duration: 800, easing: 'ease-out' });
    await sleep(900);
  }

  async function shy() {
    flag('blushing', 1800);
    face('love', 1600);
    say('♡', 1400);
    await play('shy', 1600);
  }

  let lastPat = 0;
  async function headpat() {
    if (Date.now() - lastPat < 2500 || busy) return;
    lastPat = Date.now();
    busy = true;
    try {
      flag('blushing', 1800);
      hearts(2);
      if (mood === 'sleep' || mood === 'hibernate') {
        face('happy', 1800);
        say('mmm~ zz', 1500);
        await sleep(1500);
      } else if (mood === 'stressed' || mood === 'panic' || mood === 'stuffed') {
        say(pick(LINES.patSad), 1800);
        await play('squish', 500);
      } else {
        face('happy', 1800);
        say(pick(LINES.pat), 1600);
        await play('wiggle', 900);
      }
    } finally {
      busy = false;
    }
  }

  function blink() {
    if (mood === 'sleep' || mood === 'hibernate' || mood === 'compacting') return;
    flag('blink', 130);
    if (Math.random() < 0.2) setTimeout(() => flag('blink', 130), 260); // double blink
  }

  async function poke() {
    pokeCount++;
    clearTimeout(pokeReset);
    pokeReset = setTimeout(() => (pokeCount = 0), 2500);
    if (mood === 'hibernate') {
      // Deep sleep: only a real message to Claude (a fresh cache) wakes it up.
      stage.classList.add('snot-pop');
      setTimeout(() => stage.classList.remove('snot-pop'), 1500);
      say(pick(LINES.sleepTalk), 1800);
      await play('squish', 500);
      return;
    }
    if (mood === 'sleep') {
      state && (state.lastWrite = Date.now() - 60000); // nudged awake
      await play('bighop', 800);
      say(pick(LINES.wake));
      updateMood();
      return;
    }
    flag('blushing', 1400);
    hearts(pokeCount >= 3 ? 5 : 3);
    face(pokeCount >= 3 ? 'love' : pick(['happy', 'wink', 'happy']), 1300);
    if (pokeCount >= 5) {
      pokeCount = 0;
      say('ok ok, dance time!');
      face('happy', 2600);
      notes(3);
      await play('dance', 1600);
      await play('backflip', 1000);
      return;
    }
    const left = Math.max(0, Math.round(((state ? state.threshold : 0.75) - pct) * 100));
    say(Math.random() < 0.3 ? `${left}% until I need a /compact` : pick(LINES.poke), 1800);
    await play('squish', 500);
  }

  // ---------------------------------------------------------------- mood

  function computeMood() {
    if (!state || !state.found) return 'sleep';
    if (compacting) return 'compacting';
    if (cacheLeft() <= 0 && Date.now() - state.lastWrite >= 8000) return 'hibernate';
    if (pct >= 0.99) return 'stuffed';
    if (pct >= state.full) return 'panic';
    if (pct >= state.threshold) return 'stressed';
    const now = Date.now();
    const since = now - state.lastWrite;
    if (since < 8000) {
      // A long unbroken run of Claude working on its own = vibe coding.
      if (!workingSince) workingSince = now;
      return now - workingSince >= (state.vibeAfterMs || 60000) ? 'vibe' : 'working';
    }
    workingSince = 0;
    if (since > state.sleepAfterMs) return 'sleep';
    if (since > (state.boredAfterMs || 90000)) return 'bored';
    return 'idle';
  }

  let workingSince = 0;

  /** Milliseconds until Claude's prompt cache expires (Infinity when unknown). */
  function cacheLeft() {
    if (!state || !state.found || !state.cacheTtlMs || !state.lastApiAt) return Infinity;
    return state.lastApiAt + state.cacheTtlMs - Date.now();
  }

  function renderCache() {
    const el = $('model');
    if (!state || !state.found) return;
    const left = cacheLeft();
    const name = (state.model || '').replace(/^claude-/, '');
    const model = name ? name + ' · ' : '';
    if (left === Infinity) el.textContent = name;
    else if (left <= 0) el.textContent = model + '💤 cache cold';
    else el.textContent = model + `⚡ ${Math.max(1, Math.ceil(left / 60000))}m`;
    el.title = left <= 0
      ? 'The prompt cache expired: your next message re-reads the whole context at full price.'
      : 'Time until Claude’s prompt cache expires';
  }

  function updateMood() {
    const m = computeMood();
    if (m === mood) return;
    const prev = mood;
    stage.classList.remove('mood-' + mood);
    stage.classList.add('mood-' + m);
    mood = m;
    critter.title = pct >= (state ? state.threshold : 1) ? 'Click to /compact' : 'Double-click to /compact';

    if (m === 'stuffed') setSticky(pick(LINES.stuffed), 'alert');
    else if (m === 'panic') setSticky(pick(LINES.panic), 'alert');
    else if (m === 'compacting') setSticky('compacting ', '', true);
    else if (m === 'working') setSticky('', 'think', true);
    else setSticky(null);

    if (prev === 'sleep' && m !== 'sleep' && m !== 'hibernate' && state && state.found) {
      play('stretch', 1600);
    }
    if (m === 'vibe') {
      stage.classList.remove('drink-coffee', 'drink-beer');
      stage.classList.add('drink-' + drink());
      say(pick([...LINES.vibe, ...LINES[drink()]]), 2400);
      notes(2);
    }
    if (m === 'bored' && prev === 'idle') {
      sigh();
      say(pick(LINES.bored), 2200);
    }
    if (m === 'hibernate' && state && state.found) {
      say(pick(LINES.hibernate), 2600);
      play('stretch', 1600);
    }
    if (prev === 'hibernate' && state && state.found) {
      // Woken by a new message: the cache is being rebuilt from scratch.
      face('squeeze', 600);
      play('bighop', 800);
      say(pick(LINES.wakeCold), 2400);
    }
    if (m === 'stuffed') {
      wasStuffed = true;
      stuffedSince = Date.now();
      nextSwell = Date.now() + 2500;
      burps(3);
      play('squish', 500);
    } else if (m === 'panic' || m === 'stressed') {
      wasStuffed = false; // dropped below 100% without a compact
    }
    updateTension();
    if (m === 'stressed' && prev !== 'panic' && prev !== 'stuffed' && prev !== 'compacting') {
      play('hop', 600);
      say(pick(LINES.stressed), 2400);
    }
    renderHint();
  }

  function renderHint() {
    const hint = $('hint');
    if (!state || !state.found) hint.textContent = 'No Claude Code session found yet';
    else if (compacting) hint.textContent = 'Compacting…';
    else if (mood === 'hibernate')
      hint.textContent = pct >= state.threshold
        ? 'Cache expired · /compact first to save tokens'
        : 'Cache expired · next message re-reads everything';
    else if (mood === 'stuffed') hint.textContent = '100% full — click to /compact!';
    else if (pct >= state.threshold) hint.textContent = 'Click the octopus to /compact';
    else hint.textContent = 'Double-click to /compact anytime';
  }

  // ---------------------------------------------------------------- loops

  async function idleLoop() {
    for (;;) {
      await sleep(lively() ? rand(2800, 6500) : rand(6000, 14000));
      if (busy || document.hidden || quiet()) continue;
      busy = true;
      try {
        await idleAction();
      } catch (e) {
        console.error(e);
      }
      busy = false;
    }
  }

  function themeAction() {
    switch (prefs.theme) {
      case 'messi':
        return pick([juggle, juggle, shoot, goat, giveThemed])();
      case 'women':
        return pick([giveThemed, giveThemed, shy, hum])();
      case 'christmas':
        return pick([giveThemed, () => { say('Ho ho ho! 🎅', 1600); return play('bighop', 800); }, () => { notes(4); say('jingle bells 🔔', 1800); return play('sway', 2400); }])();
      case 'tet':
        return pick([giveThemed, giveThemed, () => { fireworks(lively() ? 3 : 1); say(pick(THEMES.tet.lines), 1800); return sleep(1500); }])();
    }
    return sleep(10);
  }

  function idleAction() {
    if (prefs.theme && THEMES[prefs.theme] && mood === 'idle' && Math.random() < 0.4) return themeAction();
    switch (mood) {
      case 'vibe':
        return pick([
          sip, sip,
          () => (drink() === 'beer' ? cheers() : sip()),
          () => { notes(3); return play('sway', 2400); },
          () => play('tap', 1100),
          () => { say(pick(LINES.vibe)); return sleep(10); },
        ])();
      case 'bored':
        return pick([
          melt, bubblegum, playGame, rollEyes,
          () => { sigh(); say(pick(LINES.bored)); return sleep(10); },
          () => { say('…still waiting', 1400); return play('tap', 1100); },
          () => walkTo(rand(-maxX(), maxX())),
        ])();
      case 'idle':
        return pick([
          lookAround, lookAround,
          () => walkTo(rand(-maxX(), maxX())), () => walkTo(rand(-maxX(), maxX())),
          () => play('wave', 1300),
          () => play('waveL', 1300),
          () => play('hop', 600),
          () => play('peek', 1800),
          () => play('flex', 1200),
          () => play('tap', 1100),
          () => play('stretch', 1600),
          () => { say(pick(LINES.idle)); return play('dance', 1600); },
          () => { say(pick(LINES.idle)); return sleep(10); },
          butterfly, butterfly,
          sitDown, sitDown,
          hum, hum,
          wink, shy,
          () => play('backflip', 1000),
          () => (Math.random() < 0.4 ? sneeze() : wink()),
        ])();
      case 'working':
        return pick([lookAround, () => play('tap', 1100), () => play('flex', 1200), () => sleep(10)])();
      case 'stressed':
        return pick([
          () => { sweat(true); return play('shake', 500); },
          lookAround,
          () => { say(pick(LINES.stressed)); return sleep(10); },
          () => { steam(); return play('squish', 500); },
        ])();
      case 'stuffed':
        return pick([
          () => { burps(2); say('*hic*', 900); return play('squish', 500); },
          () => { face('squeeze', 1200); sweat(true); return sleep(1200); },
          () => { say(pick(LINES.stuffed), 2000); return sleep(10); },
        ])();
      case 'panic':
        return pick([
          () => play('bighop', 800),
          () => { steam(); return play('shake', 500); },
          () => walkTo(rand(-maxX(), maxX())),
        ])();
      case 'hibernate':
        return pick([
          () => {
            stage.classList.add('snot-pop');
            return sleep(1400).then(() => stage.classList.remove('snot-pop'));
          },
          () => { say(pick(LINES.sleepTalk), 1800); return sleep(10); },
          () => sleep(10),
        ])();
      default:
        return sleep(10);
    }
  }

  function scheduleBlink() {
    setTimeout(() => {
      blink();
      scheduleBlink();
    }, rand(1800, 5200));
  }

  let tension = 0;
  let stuffedSince = 0;
  let nextSwell = 0;

  function updateTension() {
    const t = mood === 'stuffed' ? ((Date.now() - stuffedSince) < 8000 ? 1 : Date.now() - stuffedSince < 20000 ? 2 : 3) : 0;
    if (t === tension) return;
    stage.classList.remove('t1', 't2', 't3');
    if (t) stage.classList.add('t' + t);
    stage.style.setProperty('--tn', String(t / 3));
    tension = t;
  }

  let tickN = 0;
  setInterval(() => {
    tickN++;
    updateMood();
    renderCache();
    updateTension();
    stage.classList.toggle('hush', hushed());
    if (mood === 'stuffed' && !busy && !quiet() && Date.now() > nextSwell) {
      nextSwell = Date.now() + (lively() ? rand(6000, 9000) / tension : rand(25000, 40000));
      swellUp();
    }
    if (document.hidden || quiet()) return;
    if (!lively() && tickN % 2) return; // calm: half as many ambient particles
    if (prefs.theme === 'women' && tickN % 2 === 0) fall('petal');
    if (prefs.theme === 'christmas') fall('snow');
    if (prefs.theme === 'tet' && tickN % 2 === 0) fall('blossom', '✿');
    if (mood === 'vibe' && tickN % 4 === 0) notes(1);
    if (tickN % (lively() ? 3 : 5) === 0) bubbleUp(mood !== 'sleep' && mood !== 'hibernate' && Math.random() < 0.3);
    if (mood === 'sleep' && tickN % 2 === 0) zzz();
    if (mood === 'hibernate' && tickN % 3 === 0) zzz();
    if (mood === 'stressed' && tickN % 3 === 0) sweat();
    if (mood === 'panic') sweat(true);
    if (mood === 'stuffed' && tickN % 2 === 0) (Math.random() < 0.5 ? burps(1) : sweat());
  }, 1000);

  // Eyes follow the mouse when nothing else is steering them.
  world.addEventListener('mousemove', (e) => {
    if (Date.now() < lookUntil || mood === 'sleep' || mood === 'hibernate') return;
    const c = critter.getBoundingClientRect();
    const dx = clamp((e.clientX - (c.left + c.width / 2)) / 60, -1, 1);
    const dy = clamp((e.clientY - (c.top + c.height / 3)) / 80, -0.6, 0.6);
    eyes.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
  });
  let patDist = 0;
  let patLast = null;
  critter.addEventListener('mousemove', (e) => {
    const c = critter.getBoundingClientRect();
    if (e.clientY > c.top + c.height * 0.5) return;
    if (patLast) patDist += Math.abs(e.clientX - patLast.x) + Math.abs(e.clientY - patLast.y);
    patLast = { x: e.clientX, y: e.clientY };
    if (patDist > 160) {
      patDist = 0;
      headpat();
    }
  });
  critter.addEventListener('mouseleave', () => {
    patDist = 0;
    patLast = null;
  });
  setInterval(() => (patDist = Math.max(0, patDist - 40)), 500);

  // Say hi when the view comes back into sight.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !busy && (mood === 'idle' || mood === 'working')) {
      say('hi again!', 1500);
      play('wave', 1300);
    }
  });

  world.addEventListener('mouseleave', () => {
    if (Date.now() >= lookUntil) eyes.style.transform = '';
  });

  // ---------------------------------------------------------------- input

  let clickTimer = 0;
  critter.addEventListener('click', (e) => {
    if (e.detail > 1) return;
    clickTimer = setTimeout(onClick, 240);
  });
  critter.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    if (!compacting) vscode.postMessage({ type: 'compact', force: true });
  });

  function onClick() {
    if (!state || !state.found) {
      play('squish', 500);
      say('no Claude session yet 💤');
      return;
    }
    if (compacting) {
      say('working on it!', 1400);
      return;
    }
    if (pct >= state.threshold) vscode.postMessage({ type: 'compact', force: false });
    else poke();
  }

  function startCompacting() {
    compacting = true;
    updateMood();
    play('spin', 900);
    clearTimeout(compactTimeout);
    compactTimeout = setTimeout(() => {
      compacting = false;
      updateMood();
      say('hmm, did /compact run?', 3000);
    }, 180000);
  }

  function finishCompact() {
    compacting = false;
    clearTimeout(compactTimeout);
    updateMood();
    celebrate();
  }

  // ---------------------------------------------------------------- state

  function fmt(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
  }

  function applyPrefs(p) {
    if (!p) return;
    const changed = p.motion !== prefs.motion || p.size !== prefs.size;
    const newTheme = p.theme !== prefs.theme;
    prefs = { ...prefs, ...p };
    stage.classList.remove('motion-lively', 'motion-calm', 'motion-minimal');
    stage.classList.add('motion-' + (['lively', 'calm', 'minimal'].includes(prefs.motion) ? prefs.motion : 'calm'));
    if (newTheme) {
      for (const k of Object.keys(THEMES)) stage.classList.remove('theme-' + k);
      const t = THEMES[prefs.theme];
      $('banner').textContent = t ? t.banner : '';
      if (t) {
        stage.classList.add('theme-' + prefs.theme);
        setTimeout(() => say(pick(t.hello), 2600), 1500);
      }
    }
    if (changed) layout();
  }

  function applyState(s) {
    const prev = state;
    state = s;
    applyPrefs(s.prefs);
    if (!s.found) {
      stage.classList.add('nosession');
      $('pct').textContent = '–';
      $('tokens').textContent = '';
      $('session').textContent = 'waiting for a Claude Code session';
      $('model').textContent = '';
      $('fill').style.width = '0';
      setSize(MIN_SCALE);
      updateMood();
      renderHint();
      return;
    }
    stage.classList.remove('nosession');
    const old = pct;
    pct = s.pct;

    const shown = prefs.percent === 'left' ? 1 - pct : pct;
    $('pct').textContent = s.compacted
      ? 'compacted'
      : `${(shown * 100).toFixed(shown < 0.1 ? 1 : 0)}%${prefs.percent === 'left' ? ' left' : ''}`;
    $('tokens').textContent = `${fmt(s.used)} / ${fmt(s.window)}`;
    $('session').textContent =
      String(s.project || '').replace(/^-/, '').split('-').slice(-2).join('/') + ' · ' + String(s.sessionId || '').slice(0, 8);
    renderCache();
    $('fill').style.width = pct * 100 + '%';
    $('mark').style.left = `calc(${s.threshold * 100}% - 1px)`;
    setColor(pct);

    const newSize = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * Math.pow(pct, 0.85);
    const fresh = !prev || !prev.found || prev.sessionId !== s.sessionId;
    const delta = pct - old;

    if (fresh) {
      setSize(newSize);
      if (prev && prev.found) {
        say('new session!');
        play('bighop', 800);
      }
    } else if (compacting && (delta < -0.03 || s.compacted)) {
      setSize(newSize);
      finishCompact();
    } else if (delta <= -0.1) {
      setSize(newSize); // auto-compact or /compact typed by hand
      celebrate();
    } else if (delta > 0.001) {
      setTimeout(() => setSize(newSize), 2600); // grow once the knowledge is swallowed
      eat(delta);
    } else {
      setSize(newSize);
    }
    updateMood();
    renderHint();
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state' && m.state && typeof m.state === 'object') applyState(m.state);
    else if (m.type === 'feed' && Array.isArray(m.items)) {
      feed(m.items.filter((it) => it && typeof it.k === 'string').map((it) => ({ k: it.k, t: String(it.t || '').slice(0, 40) })));
    } else if (m.type === 'hush') {
      hushUntil = Date.now() + clamp(Number(m.ms) || 0, 0, 60000);
      stage.classList.add('hush');
    }
    else if (m.type === 'compacting') startCompacting();
    else if (m.type === 'compactFailed') {
      play('shake', 500);
      say('no Claude terminal — /compact copied!', 3500);
    }
  });

  // Lets test/harness.html trigger individual behaviours; never exposed inside VS Code.
  if (/** @type {any} */ (window).__OCTOPUS_TEST__) /** @type {any} */ (window).__octopus = { cheers, sip, rollEyes, playGame, bubblegum, melt, juggle, shoot, goat, giveThemed, themeCheer, swellUp, bigBang: () => { wasStuffed = true; return celebrate(); }, feed, butterfly, sitDown, hum, sneeze, wink, shy, headpat, poke, celebrate, backflip: () => play('backflip', 1000) };

  layout();
  scheduleBlink();
  idleLoop();
  stage.classList.add('mood-sleep', 'motion-calm');
  vscode.postMessage({ type: 'ready' });
})();

// @ts-check
// macOS only: shows the octopus as a tiny transparent sprite perched on the Claude Code input, in a
// window glued to the VS Code window. The helper (bin/darwin/octopus-overlay, source in
// native/macos) draws natively and talks to us over stdin/stdout only: no ports, no network.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

class FloatingOctopus {
  /**
   * @param {string} extensionPath
   * @param {(m: {type: string, force?: boolean}) => void} onMessage
   */
  constructor(extensionPath, onMessage) {
    this.bin = path.join(extensionPath, 'bin', 'darwin', 'octopus-overlay');
    this.onMessage = onMessage;
    /** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
    this.proc = null;
    this.lastLook = '';
  }

  static supported() {
    return process.platform === 'darwin';
  }

  /** @param {number} size the size multiplier setting */
  start(size = 1) {
    if (this.proc || !FloatingOctopus.supported() || !fs.existsSync(this.bin)) return;
    const proc = spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc = proc;
    this.lastLook = '';
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
    });
    proc.on('error', (e) => console.error('[claude-octopus] floating octopus:', e.message));
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      // Only these two are acted on.
      if (m && m.type === 'ready') this.onMessage({ type: 'ready' });
      else if (m && m.type === 'compact') this.onMessage({ type: 'compact', force: m.force === true });
    });
    this.send({ type: 'init', unit: 2.5 * size });
  }

  /** Sends the look only when it changed. */
  look(look) {
    const json = JSON.stringify({ type: 'look', ...look });
    if (json === this.lastLook) return;
    this.lastLook = json;
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(json + '\n');
  }

  send(msg) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  stop() {
    if (!this.proc) return;
    this.send({ type: 'quit' });
    const proc = this.proc;
    this.proc = null;
    setTimeout(() => proc.kill(), 500);
  }

  dispose() {
    this.stop();
  }
}

module.exports = { FloatingOctopus };

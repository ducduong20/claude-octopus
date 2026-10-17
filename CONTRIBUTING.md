# Contributing

## Run it

- Open this folder in VS Code and press **F5** to start an Extension Development Host.
- Preview the animations without VS Code: `python3 -m http.server 8765`, then open `http://localhost:8765/test/harness.html`. The page has buttons for every context level, mood, theme and action.

## Build

- `npx @vscode/vsce package` produces the `.vsix`. There are no dependencies and no build step.
- Development builds must never reuse a released version number; use a pre-release suffix such as `0.3.1-dev.1`.
- The floating mascot is a native macOS helper. After changing `native/macos`, rebuild it with `sh native/macos/build.sh` (Xcode command line tools; it writes the universal, ad-hoc signed `bin/darwin/octopus-overlay`).
- Sprites: `media/sprites/octopus.png` is the sheet (one row per animation, 22 × 22 frames). `python3 -I native/macos/redraw.py` applies the hand-composed and patched rows, and `python3 -I native/macos/make_sprites.py` turns the sheet into `native/macos/Sprites.swift` (`build.sh` runs the latter).
- `bin/darwin/octopus-overlay --snapshot <dir>` renders every animation into `<dir>/_sheet.png` without a window, for a quick visual check.

## How it works

- `transcript.js` reads the newest session transcript under `~/.claude/projects/<project>/`. Context used is `input + cache_creation + cache_read + output` tokens of the latest main-thread assistant message; the prompt cache TTL comes from which ephemeral bucket the last cache write used. New lines are turned into short, redacted "knowledge" labels.
- `extension.js` polls the transcript, validates settings, renders the status bar item and posts state to the webview. It only types `/compact` into a chosen terminal.
- `quota.js` reads the usage quota Claude Code caches in `~/.claude.json` (only the `cachedUsageUtilization` branch) and combines it with usage-limit messages from transcripts.
- `floating.js` starts the native overlay and talks to it over stdin/stdout (JSON lines, no network); `native/macos/main.swift` is the overlay: window placement over VS Code, the animation brain and drawing.
- `themes.js` picks the seasonal outfit for a date (tank view).
- `media/octopus.js` and `media/octopus.css` draw the classic tank view (Activity Bar, Explorer or panel).

## Security

The overlay only accepts known moods, levels, animation names and icon kinds, and caps tooltip length. The webview has a strict Content Security Policy (no network, nonce-only scripts), renders transcript-derived text with `textContent` only, and accepts only known messages. Please keep it that way.

# Contributing

## Run it

- Open this folder in VS Code and press **F5** to start an Extension Development Host.
- Preview the animations without VS Code: `python3 -m http.server 8765`, then open `http://localhost:8765/test/harness.html`. The page has buttons for every context level, mood, theme and action.

## Build

- `npx @vscode/vsce package` produces the `.vsix`. There are no dependencies and no build step.
- Development builds must never reuse a released version number; use a pre-release suffix such as `0.2.1-dev.1`.

## How it works

- `transcript.js` reads the newest session transcript under `~/.claude/projects/<project>/`. Context used is `input + cache_creation + cache_read + output` tokens of the latest main-thread assistant message; the prompt cache TTL comes from which ephemeral bucket the last cache write used. New lines are turned into short, redacted "knowledge" labels.
- `extension.js` polls the transcript, validates settings, renders the status bar item and posts state to the webview. It only types `/compact` into a chosen terminal.
- `themes.js` picks the seasonal outfit for a date.
- `media/octopus.js` and `media/octopus.css` draw the tank and the octopus, and run all moods and animations.

## Security

The webview has a strict Content Security Policy (no network, nonce-only scripts), renders transcript-derived text with `textContent` only, and accepts only known messages. Please keep it that way.

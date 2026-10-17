# Changelog

## 0.3.1

- The floating mascot can be dragged right up to either edge of the window: the drag is limited by the mascot itself, not by its whole walking strip, and it only walks on the part of the strip inside the window.

## 0.3.0

- **A new mascot**: a tiny pixel Claude that floats on top of the Claude Code chat box (macOS), with a transparent background, drawn natively so it costs almost no memory or CPU. Drag it once and it remembers the spot.
- **It shows your usage quota** (the 5-hour session and weekly limits) instead of only the context: tired from 80%, nearly out at 95%, asleep under a nightcap when a limit is hit, and a stretch when it resets. Hover for usage and reset times; the status bar shows the quota too.
- **16 animations**: idle, walk, football, music, chill, lifting weights, coding, coding with coffee, vibe coding, eating, tired, tired walk, nearly out, hibernate, sleep and stretch.
- **It eats your quota**: a green `$` drops into its mouth every time Claude answers, and an icon for every file read, command run, search or prompt.
- **Gym reminder**: it lifts weights every day at 16:45 (`claudeOctopus.gymReminder`).
- **Preview Mascot State** shows any animation on demand, or plays them all for a demo.
- Clicking the mascot or the status bar shows your usage, and offers `/compact` once the context is past the threshold; a double-click compacts.
- **Choose Session** picks which Claude Code session to follow; by default it follows the one that most recently talked to Claude.
- The context now matches Claude Code's `/context`: the window size (200k or 1M) is learned per model from your history.
- New settings: `eyes` (white or black) and `gymReminder`; `location` gains `floating`, now the default.
- Security: model names from transcripts can no longer reach object prototypes, pinned sessions must be regular files, `~/.claude.json` is read with a size cap and only its usage numbers are kept, and huge transcript lines are skipped without being loaded.

## 0.2.1

- The README is now a user guide: getting started, what the octopus is telling you, compacting, seasonal outfits, settings, privacy and an FAQ.

## 0.2.0

- The view is now a tank for the octopus: water with light rays, a rippling surface, sand, swaying seaweed and rising bubbles, with a lighter tank in light themes.
- Knowledge chips (files read, commands run, your prompts…) drop into the tank, sink like fish food and drift into the octopus' mouth.
- New `claudeOctopus.percentDisplay` setting to show the context as used or left; the status bar tooltip now shows both.
- Security hardening: `/compact` is only typed into a terminal you picked or that matches by name, labels never show raw commands and mask anything that looks like a secret, all settings are validated, transcripts are read asynchronously, and the webview only accepts known messages.
- Restricted Mode support, a Marketplace icon and an explicit "unofficial" notice.

## 0.1.0

- First version: a pixel octopus that grows with the Claude Code context and runs `/compact` when clicked.
- Moods for working, vibe coding, boredom, stress, a full context about to burst, compacting, sleep and an expired prompt cache.
- Seasonal themes, calm and minimal motion levels, and a quiet mode while you type.

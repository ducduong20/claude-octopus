# Claude Octopus

*Unofficial.* A context meter for Claude Code: a pixel octopus that lives in its own little tank in the VS Code sidebar or panel and **grows as the context of your running Claude Code session fills up**.
When the context is full, **click it to run `/compact`**.

## How it works
- Reads the transcript `~/.claude/projects/<project>/<session>.jsonl` of the most recent session in the workspace and takes the `usage`
  of the latest assistant message: `input + cache_creation + cache_read + output`, divided by the context window (200k by default, switching to 1M automatically when exceeded).
- `/compact` is sent to the terminal running `claude` (matched by terminal name, or you pick one).
  If no terminal is chosen, you can copy `/compact` with one click and paste it into Claude yourself.

## Interactions
| Action | Result |
|---|---|
| Click when context ≥ threshold (75%) | runs `/compact` |
| Click when context is low | poke: it blushes and sends hearts (poke 5 times and it dances) |
| Double-click | `/compact` at any time (asks for confirmation) |
| Move the mouse | its eyes follow the cursor |
| Rub the mouse back and forth over its head | head pat: `^^` eyes, blushing, wiggling |
| Status bar `$(hubot) 42%` | click: opens the view, or runs `/compact` when full |

## Moods and animations
- **idle**: breathes, blinks, looks around, wanders, waves, hops, peeks, flexes, taps its foot, stretches, dances, chatters,
  a butterfly lands on its head, sits in "loaf mode", hums (♪ notes), sneezes, winks ✧, gets shy (heart eyes), does backflips
- **working** (Claude is writing to the transcript): fast tapping feet, a "•••" thinking bubble
- **vibe** (Claude has been coding non-stop for ≥ 60 seconds while you just wait): sunglasses drop onto its eyes, headphones go on, and it holds an iced Vietnamese coffee (daytime) or a glass of Hanoi draft beer (from 17:00);
  it nods to lo-fi beats, taps along, sips "slurp ☕" or raises a glass "1, 2, 3… cheers! 🍺", music notes float up; "vibing ~ 🎧", "auto-accept mode 😎"
- **bored** (nothing has happened for ≥ 90 seconds, before it falls asleep): droopy eyes, flat mouth, "*sigh*";
  it lies flat and melts, blows bubblegum until it pops, plays a handheld game, rolls its eyes, taps impatiently; "type something 🥱"
- **the tank**: the view is the octopus' home: water with light rays, a rippling surface, sand and pebbles, swaying seaweed and rising bubbles (a lighter tank in light themes).
- **eating**: whatever Claude just loaded into the context drops into the tank as little "knowledge" chips, sinks like fish food and drifts into the octopus' mouth; it munches and grows:
  📄 file read · ✏️ file edited · ›_ Bash command · 🔍 grep/glob · 🌐 web · 🤖 subagent · 💬 your prompt · 💡 thinking · 🖼️ image · 🔧 other tool.
  Only newly written transcript lines are used (history is never replayed).
- **stressed** (≥ threshold): turns red, sweats, trembles, lets off steam
- **panic** (≥ 90%): shakes, flails its arms, gasps, glows red, "click me" bubble
- **stuffed** (100%), *about to burst*: sits down, puffed up, `><` eyes, pats its belly, burps bubbles; a red vignette pulses around the view,
  the context bar turns into moving yellow-red hazard stripes, the percentage trembles, glowing cracks appear on its body.
  The longer it stays full, the higher the tension (3 levels: 0–8s, 8–20s, >20s): more cracks, stronger shaking, faster breathing.
  Every so often it **swells up, flashes white faster and faster and the whole view shakes**, throws off debris… then barely holds it in: "phew…".
  On `/compact` from 100%: **💥 POP**: white flash, shockwave, pixel debris flying everywhere, then it springs back tiny: "…I'm okay!"
- **compacting**: squeezes with its eyes shut; when done it burps, puffs up and shrinks, throws sparkles, backflips, smiles
- **sleep** (no activity for 5 minutes): eyes closed, slow breathing, "Zzz"
- **hibernate**: *Claude's prompt cache has expired* (1 hour after the last API call by default; the 5m/1h TTL is read from the transcript).
  It puts on a nightcap, curls up, blows a snot bubble, and the view turns into a night sky with a moon and stars; the HUD shows `💤 cache cold`.
  Poking it only makes it talk in its sleep ("5 more minutes…"); it wakes with a start only when a new message is sent to Claude.
  While the cache is still warm, the HUD counts down `⚡ 42m`.

## Install
- From the Marketplace: search for **Claude Octopus** in the Extensions view.
- From a package: `code --install-extension claude-octopus-0.2.0.vsix`, then run **Developer: Reload Window**.
- The tank opens from its Activity Bar icon; set `claudeOctopus.location` to `explorer` or `panel` to move it.

## Development
- Open this folder in VS Code and press **F5** to start an Extension Development Host.
- Preview the animations without VS Code: `python3 -m http.server 8765`, then open `http://localhost:8765/test/harness.html`.
- Build a package: `npx @vscode/vsce package` (no other build step or dependencies).

## Seasonal themes (`claudeOctopus.theme`, default `auto`)
| Theme | When (auto) | Outfit & actions |
|---|---|---|
| 🐐 `messi` | 2–7 Oct 2026 (Argentina farewell match on 6 Oct), 23–24 Jun, 18 Dec | Sky-blue and white striped jersey, beard, captain's armband, three stars, a ball at its feet, a goal; juggles, shoots "GOOOAL!", celebrates 🐐; lifts the trophy 🏆 after a compact |
| 💐 `women` | 17–21 Oct (Vietnamese Women's Day, 20 Oct), 6–9 Mar (International Women's Day) | Flower crown, holds a rose, falling petals; gives flowers 🌹, gets shy |
| 🎄 `christmas` | 15–26 Dec | Santa hat, falling snow, a tree and a present; "Ho ho ho!", gives gifts 🎁, sings jingle bells |
| 🧧 `tet` | 7 days before to 7 days after Lunar New Year's day (2026–2035) | Swaying lanterns, holds a red envelope, falling apricot blossoms, fireworks; "a red envelope for you! 🧧" |

The HUD also shows a themed banner. Short events beat long seasons (18 Dec is Messi even during the Christmas season).
Set `theme` to `none` to turn themes off, or pick one directly. Add your own dates with `claudeOctopus.themeDates`:
`[{ "theme": "messi", "from": "2026-10-03", "to": "2026-10-07" }]` (dates as `YYYY-MM-DD`, or `MM-DD` to repeat every year).

## Stay out of the way while coding
| Setting | Default | Meaning |
|---|---|---|
| `claudeOctopus.motion` | `calm` | `lively`: every effect (including flashing at 100%) · `calm`: no flashing, no view shaking, fewer antics · `minimal`: almost still, only breathing, size and colour |
| `claudeOctopus.quietWhileTyping` | `true` | While you type in the editor it holds still for 6 seconds: no particles, speech or wandering |
| `claudeOctopus.size` | `1` | Size multiplier (0.3–2). It still grows with the context, but never outgrows the view |
| `claudeOctopus.location` | `activitybar` | `activitybar` · `explorer` (a small section in the Explorer) · `panel` (a tab next to the Terminal) · `hidden` (status bar only) |
| `claudeOctopus.showSpeech` | `true` | Turn off speech bubbles (the context-full alert is always shown) |
| `claudeOctopus.showStatusBar` | `true` | Show or hide `42%` in the status bar |
| `claudeOctopus.percentDisplay` | `used` | `used` or `left`. Claude Code's own "context left" counts down to auto-compact, so it reads a few points lower |

The **Claude Octopus: Cycle Motion Level** command switches quickly between `lively → calm → minimal`.
When the operating system has *Reduce motion* turned on, all looping animations are disabled.

## Privacy & security
- **Local only.** The extension makes no network requests; the view's Content Security Policy blocks every connection, image and form.
- **Reads, never writes, your transcripts.** Only token counts, timestamps and short labels leave the transcript reader; message text and tool results are never passed on.
- **Labels are redacted.** Raw Bash command lines are never shown (only Claude's description of the command), and anything that looks like a key, token or password is masked as `•••`. Set `claudeOctopus.knowledgeLabels` to `false` to show icons only, e.g. while screen sharing.
- **No API for other extensions.** Nothing is exported and no command returns data.
- **Typing into terminals.** `/compact` is only typed into the terminal you picked, or the single terminal whose name matches `terminalNamePattern`; otherwise you are asked. That setting and `sessionSource` can only be set in user settings, never by a workspace, and are restricted in untrusted workspaces.
- **Clipboard.** Only written when you click *Copy /compact*.

## Settings
`claudeOctopus.contextWindow`, `compactThreshold`, `sessionSource` (`workspace`/`latest`),
`terminalNamePattern`, `confirmBelowThreshold`, `sleepAfterMinutes`, `cacheTtl` (`auto`/`5m`/`1h`), `theme`, `themeDates`, `vibeAfterSeconds`, `boredAfterSeconds`, `knowledgeLabels`, plus the settings in the section above.

---

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.

# Claude Octopus

*Unofficial.* A pixel octopus that lives in a little tank in VS Code and shows how full your Claude Code conversation is. The more context Claude uses, the bigger and redder it gets. When it is full, click it to run `/compact`.

- **See your context at a glance**: size, colour, a progress bar and a percentage in the status bar.
- **Compact in one click** when the conversation gets too long.
- **Know when your prompt cache has gone cold**, so you know the next message will cost a full re-read.
- A little companion that reacts to what Claude is doing, while staying out of your way.

## Getting started

1. Install **Claude Octopus** from the Extensions view (search for "Claude Octopus").
2. Open the tank from the octopus icon in the Activity Bar. The status bar also shows the context percentage, for example `42%`.
3. Use Claude Code as usual in the same folder, either `claude` in the integrated terminal or the Claude Code extension. The octopus picks up the most recent session of the open workspace automatically.

That's it. There is nothing to sign in to and nothing to configure.

## Reading your octopus

| What you see | What it means |
|---|---|
| Small and orange | Plenty of room left in the context |
| Bigger, redder, sweating | The context is past the compact threshold (75% by default) |
| Shaking, glowing red, "click me" | Over 90%: time to compact |
| Sitting, puffed up, cracks on its body | 100%: about to burst |
| Tapping feet with a "•••" bubble | Claude is working right now |
| Sunglasses, headphones and a drink | Claude has been working on its own for a while: you are vibe coding |
| Droopy eyes, sighing, blowing bubblegum | Nothing has happened for a bit |
| Eyes closed, "Zzz" | No activity for several minutes |
| Nightcap, night sky, `💤 cache cold` | Claude's prompt cache has expired; your next message re-reads the whole conversation |
| `⚡ 42m` under the bar | Minutes left before the prompt cache expires |

When Claude reads a file, runs a command or gets a new prompt from you, a small label (📄 file, ›_ command, 💬 prompt, 🌐 web…) drops into the tank, sinks like fish food and the octopus eats it.

## Compacting

- **Click the octopus** once the context is past the threshold.
- **Double-click** to compact at any time (you are asked to confirm while there is still room).
- **Click the status bar item** when it turns yellow or red.
- Or run **Claude Octopus: Run /compact** from the Command Palette.

The octopus types `/compact` into the terminal where `claude` is running. If it can't tell which terminal that is, it asks you once and remembers; you can change it later with **Claude Octopus: Choose Claude Terminal**.

Using the Claude Code extension panel instead of the terminal? The octopus can't type into that panel, so it offers a **Copy /compact** button: paste it into the chat box.

## Playing with it

- **Poke it** when there is plenty of room: it blushes and sends hearts. Poke it five times and it dances.
- **Pat its head** by rubbing the mouse back and forth over it.
- Its **eyes follow your cursor**, and when idle it wanders, waves, hums, naps, and sometimes a butterfly lands on its head.

## Seasonal outfits

On special days the octopus dresses up automatically:

| When | Outfit |
|---|---|
| 20 October and 8 March (Women's Day) | Flower crown, a rose and falling petals |
| 15–26 December | Santa hat, snow and presents |
| Around Lunar New Year | Lanterns, a red envelope and fireworks |
| Messi's days (6 Oct 2026 farewell, 24 June, 18 December) | Argentina jersey, a ball and a goal. GOAT 🐐 |

Turn this off with `claudeOctopus.theme: none`, pick an outfit to wear all the time, or add your own dates with `claudeOctopus.themeDates`.

## Keeping it out of your way

- **Motion** (`claudeOctopus.motion`): `calm` by default (no flashing or shaking), `minimal` for an almost still octopus, `lively` for every effect. Switch quickly with **Claude Octopus: Cycle Motion Level**. If your system has *Reduce motion* turned on, animations stay still.
- **Quiet while typing**: the octopus holds still for a few seconds every time you type in an editor.
- **Where it lives** (`claudeOctopus.location`): its own Activity Bar icon, a small section in the **Explorer**, a tab in the bottom **panel** next to the Terminal, or **hidden** (status bar only).
- **Size**, **speech bubbles** and the **status bar item** can each be adjusted or turned off.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `claudeOctopus.location` | `activitybar` | Where the tank lives: `activitybar`, `explorer`, `panel` or `hidden` |
| `claudeOctopus.motion` | `calm` | How much it moves: `lively`, `calm` or `minimal` |
| `claudeOctopus.size` | `1` | Size of the octopus (0.3 to 2) |
| `claudeOctopus.compactThreshold` | `0.75` | How full the context must be before a single click compacts |
| `claudeOctopus.confirmBelowThreshold` | `true` | Ask before compacting while there is still room |
| `claudeOctopus.percentDisplay` | `used` | Show the percentage `used` or `left` |
| `claudeOctopus.showStatusBar` | `true` | Show the percentage in the status bar |
| `claudeOctopus.showSpeech` | `true` | Show speech bubbles (alerts are always shown) |
| `claudeOctopus.quietWhileTyping` | `true` | Hold still while you type |
| `claudeOctopus.knowledgeLabels` | `true` | Show names on the labels it eats; turn off to show icons only, for example while screen sharing |
| `claudeOctopus.theme` | `auto` | Seasonal outfit: `auto`, `none`, or a fixed one |
| `claudeOctopus.themeDates` | `[]` | Extra dates for outfits, for example `[{ "theme": "messi", "from": "10-01", "to": "10-07" }]` |
| `claudeOctopus.sessionSource` | `workspace` | Follow the open workspace's session, or the `latest` session anywhere |
| `claudeOctopus.terminalNamePattern` | `claude` | How to recognise the terminal running Claude Code |
| `claudeOctopus.contextWindow` | `200000` | Context window size; switches to 1,000,000 automatically when a session goes beyond it |
| `claudeOctopus.cacheTtl` | `auto` | Prompt cache lifetime: detected automatically, or `5m` / `1h` |
| `claudeOctopus.vibeAfterSeconds` | `60` | How long Claude must work on its own before vibe mode |
| `claudeOctopus.boredAfterSeconds` | `90` | How long without activity before it gets bored |
| `claudeOctopus.sleepAfterMinutes` | `5` | How long without activity before it falls asleep |

## Privacy

- **Everything stays on your machine.** The extension never connects to the internet.
- **It only reads** Claude Code's local session history to count tokens; it never changes it and never shows your messages.
- **Labels are masked.** Commands are shown by their description, never in full, and anything that looks like a key, token or password appears as `•••`.
- **It only types into the terminal you chose**, and only ever types `/compact`.

## FAQ

**The percentage is a little different from what Claude Code shows.**
Claude Code's "context left" counts down to the point where it compacts automatically, which is a bit before the context is completely full. The octopus measures against the whole context window, so its number reads a few points higher. Hover over the status bar item to see the exact token count.

**I can't see the octopus.**
Check `claudeOctopus.location`: with `panel` it is a tab in the bottom panel (it may be tucked behind the `···` menu), with `explorer` it is a section at the bottom of the Explorer. You can always run **Focus on Context View** from the Command Palette.

**It shows "No Claude Code session found".**
Start Claude Code in the folder you have open in VS Code. To follow a session from another folder, set `claudeOctopus.sessionSource` to `latest`.

**The numbers look stuck.**
Run **Claude Octopus: Refresh** from the Command Palette to re-read the session right away.

**Clicking doesn't compact.**
Make sure Claude Code is running in a VS Code terminal, then run **Claude Octopus: Choose Claude Terminal** to point the octopus at it. With the Claude Code extension panel, use the **Copy /compact** button and paste it into the chat.

## Requirements

- VS Code 1.85 or later
- Claude Code, either the command line tool or the VS Code extension

---

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.

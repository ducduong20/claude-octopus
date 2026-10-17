# Claude Octopus

*Unofficial.* A tiny pixel Claude that sits on top of the Claude Code chat box in VS Code and shows how much of your Claude usage quota is left. It codes while Claude works, eats a **$** of your quota every time Claude answers, gets tired as your quota runs low, and sleeps until the limit resets.

![The mascot playing every animation on top of the Claude Code input](media/readme/demo.gif)

## Getting started

1. Install **Claude Octopus** from the Extensions view (search for "Claude Octopus").
2. Open the Claude Code panel (or run `claude` in the terminal) and work as usual.
3. The mascot appears on top of the Claude Code chat box. Hover over it to see your quota.

That's it: no sign-in and nothing to configure. To move it, drag it once; it remembers the spot.

On Windows and Linux the floating mascot is not available yet: you get the classic octopus tank in the Activity Bar instead.

## What it does

| You see | It means |
|---|---|
| Strolling, kicking a ball, listening to music, chilling, lifting weights | Claude is idle and you have plenty of quota |
| Typing on a laptop, sometimes with a coffee | Claude is working |
| Sunglasses, nodding to the beat | Claude has been working on its own for a while: you are vibe coding |
| A green **$** falls into its mouth | Claude answered: your quota is being eaten |
| 📄 ✏️ 💻 🔍 🌐 💬 … fall into its mouth | Claude read a file, ran a command, searched or got your prompt |
| Heavy eyelids and a drop of sweat | You have used 80% of your quota |
| Slumped, a red empty battery above its head | 95% used: almost out |
| Asleep under a nightcap | You hit the session (5-hour) or weekly limit; it sleeps until the reset |
| Stretching | The limit has reset: back to work |
| Lifting weights at 16:45 | Time for the gym! |

**Hover** over the mascot to see your session and weekly usage, when each one resets, and how full the current conversation is.

The **status bar** shows your quota as a percentage, yellow from 80% and red from 95%.

## See every animation

Run **Claude Octopus: Preview Mascot State** from the Command Palette (`Cmd+Shift+P`):

- **Play all animations** plays all 16 in a row, 6 seconds each. Good for recording a demo.
- Pick a single animation to see it for a minute.
- **Stop preview** goes back to the real state.

## Commands

| Command | What it does |
|---|---|
| **Claude Octopus: Preview Mascot State** | Show any animation or state for a minute, or play them all |
| **Claude Octopus: Choose Session** | Pick which Claude Code session to follow (it follows the most active one by default) |
| **Claude Octopus: Run /compact** | Compact the current conversation |
| **Claude Octopus: Refresh** | Re-read the session and quota right away |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `claudeOctopus.location` | `floating` | `floating` sits on the chat box (macOS); or `activitybar`, `explorer`, `panel`, `hidden` |
| `claudeOctopus.eyes` | `white` | Eye colour: `white` or `black` |
| `claudeOctopus.gymReminder` | `16:45` | Daily time (`HH:MM`) when it lifts weights to remind you to go to the gym; empty turns it off |
| `claudeOctopus.size` | `1` | Size of the mascot (0.3 to 2) |
| `claudeOctopus.motion` | `calm` | `minimal` stops it eating while Claude works |
| `claudeOctopus.vibeAfterSeconds` | `600` | How long Claude must work on its own before vibe coding |
| `claudeOctopus.showStatusBar` | `true` | Show the quota in the status bar |
| `claudeOctopus.percentDisplay` | `used` | Show the percentage `used` or `left` |
| `claudeOctopus.sessionSource` | `workspace` | Follow the open folder's Claude Code session, or the `latest` one anywhere |

## Compacting

The mascot still helps with long conversations: **click it** once the context is past 75% to run `/compact` (double-click to compact at any time). With Claude Code in a terminal it types `/compact` for you; with the Claude Code panel it copies `/compact` and focuses the chat box, so you only press `Cmd+V` and `Enter`.

## Privacy

- **Everything stays on your machine.** The extension never connects to the internet.
- **It only reads** the usage numbers Claude Code already saves on your computer and Claude Code's local session history. It never changes them and never shows your messages.
- From Claude Code's settings file it reads **only the usage numbers**, nothing else.
- **It only types `/compact`**, and only into the terminal you chose.

## FAQ

**The quota says "not measured yet".**
Claude Code only saves your usage from time to time. After a limit window resets, the new numbers appear the next time Claude Code refreshes them.

**I can't see the mascot.**
Check that `claudeOctopus.location` is `floating` and that the VS Code window with Claude Code is on screen. If it went somewhere odd, drag it back onto the chat box.

**It shows "No Claude Code session found" or follows the wrong session.**
Start Claude Code in the folder you have open in VS Code, set `claudeOctopus.sessionSource` to `latest`, or pick the session with **Claude Octopus: Choose Session**.

**It covers something I want to click.**
Hold `Option` and click: the click goes through the mascot. Or drag it somewhere else.

**I don't want the gym reminder.**
Set `claudeOctopus.gymReminder` to an empty string, or to the time you actually go.

## Requirements

- VS Code 1.85 or later
- Claude Code (the VS Code extension or the command line tool)
- The floating mascot needs macOS

---

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.

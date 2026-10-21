# Claude Account Switcher

Status-bar toggle for swapping Claude Code between saved Claude accounts.

## Setup (one time)
1. While logged in to account #1: click **Claude: unsaved** in the status bar → *Save current login as profile…* (e.g. `personal`).
2. Pick *Add another account…*, type `/login` in the terminal that opens, sign in with account #2.
3. Save it as a profile (e.g. `work`).

## Use
Click the status bar item. With two profiles it toggles straight to the other one; with more it shows a picker.
Restart running Claude Code sessions (or reload the window) after a switch.

## How it works
Profiles live in `~/.claude-switcher/profiles/<name>/` (mode 600) and hold a copy of
`~/.claude/.credentials.json` plus the `oauthAccount` block from `~/.claude.json`.
Before switching away, the current profile is re-saved so refreshed tokens aren't lost.

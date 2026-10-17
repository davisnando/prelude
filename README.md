# Prelude

The review before the review. Prelude shows the changes in your git repo the way a GitHub or GitLab pull request would, lets you comment on lines, and copies the result as a review your AI agent can work through. No PR needed.

## What it does

- Shows everything on your branch since it split off `main`, including uncommitted and untracked files. Switch to **Uncommitted** to see only work that isn't committed yet.
- Unified or split diff, syntax highlighting, and expandable context around each change.
- Click a line number to comment on it. Drag or shift-click to comment on a range, including unchanged lines. Use **Comment on file** for whole-file notes and **Overall notes** for the review as a whole.
- Each comment has a severity (must fix, suggestion, question, nit) and can include a suggested change.
- Comments are saved per branch. When the agent edits the code, comments follow their lines if those lines move. If the lines themselves change, the comment is marked outdated and left out of the copied review.
- Mark files as **Viewed**. The mark clears itself when the file changes again.
- **Copy review** (⌘⇧C) puts a Markdown review on the clipboard and also writes it to `.prelude/review.md`, so you can tell the agent "read .prelude/review.md".
- The diff refreshes on its own while files change.

Review state lives in `.prelude/` at the repo root. Prelude adds that folder to `.git/info/exclude`, so it never shows up in `git status` and your `.gitignore` stays untouched.

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous file |
| `n` / `p` | Next / previous open comment |
| `c` | Comment on the selected lines, or on the current file |
| `v` | Toggle viewed on the current file |
| `s` | Switch between unified and split |
| `r` | Refresh |
| `⌘⇧C` | Copy review |
| `⌘O` | Open another repository |
| `⌘↩` / `esc` | Save / cancel a comment |

## Install

Requires Rust, Node 22+, pnpm and Xcode command line tools.

```sh
pnpm install
pnpm install:mac                                    # builds and copies Prelude.app to /Applications
ln -sf "$PWD/bin/prelude" /opt/homebrew/bin/prelude # or any directory on your PATH
prelude install                                     # teaches your agents about Prelude (see below)
```

Run `pnpm install:mac` again after changing the code. The `prelude` link points at this repo's script, so it doesn't need updating.

Then, in any repository:

```sh
prelude .
```

### In the terminal

```sh
prelude --tui .    # or: prelude -t
```

Same review, same `.prelude/` state and same copied output as the app, in a full-screen terminal UI. It runs the installed app's backend without opening a window, so `pnpm install:mac` (which also builds the terminal UI) is still the install step, and it needs Node 22+ at runtime.

| Key | Action |
| --- | --- |
| `↑` `↓` `pgup` `pgdn` `g` `G` | Move the cursor |
| `space` or `shift+↑↓` | Select a range of lines |
| `c` or `enter` | Comment on the line or selection (`enter` on `⋯` shows the hidden lines) |
| `f` / `o` | Comment on the whole file / overall notes |
| `e` `x` `d` | Edit, resolve or reopen, delete the comment under the cursor |
| `←` / `→` | Previous / next file |
| `n` / `p` | Next / previous open comment |
| `v` `s` `m` `b` | Viewed, split view (`tab` switches sides), uncommitted only, base branch |
| `t` `r` `?` `q` | File list, refresh, all keys, quit |
| `y` | Copy review |

While writing a comment: `enter` saves, `ctrl+j` (or `shift+enter` / `alt+enter` where the terminal sends them) adds a line, `tab` changes the severity, `ctrl+o` adds a suggested change prefilled with the selected lines, `ctrl+g` opens `$EDITOR`, and `esc` cancels.

Colours follow a dark terminal unless `PRELUDE_THEME=light` is set (or the terminal reports a light background through `COLORFGBG`). Copying uses `pbcopy` (or `wl-copy`/`xclip`), falling back to the terminal's OSC 52 clipboard.

Don't keep the app and the terminal UI open on the same repo at once: each saves its own copy of the review state, so the last one to save wins.

### Set up your agents

```sh
prelude install          # skill + Claude Code hook
prelude install skill    # or just one of them
prelude uninstall        # removes both again
```

**The skill** ([skills/prelude/SKILL.md](skills/prelude/SKILL.md)) tells an agent what a Prelude review is and how to work through it: every numbered item, must-fix first, questions answered before code changes, suggested changes applied as written, and a reply per item number. It also tells the agent to run `prelude .` when you ask to review its work. It is copied to `~/.claude/skills` and `~/.agents/skills` (Codex, Gemini CLI and other agents that read the shared folder), and to `~/.cursor/skills` and `~/.copilot/skills` when those are installed. Run `prelude install skill` again after updating Prelude to refresh the copies.

**The hook** (Claude Code only) adds `prelude --hook` to `UserPromptSubmit` in `~/.claude/settings.json`, leaving your other settings and hooks alone. After you press **Copy review**, the next message you send to Claude Code includes the review, so "go" is enough. Each review is sent only once (the hook records what it sent in `.prelude/review.seen`), and repos without a review are left alone. Long reviews are passed as a pointer to `.prelude/review.md` instead of inline.

## Develop

```sh
pnpm tauri dev                          # opens the repo picker
PRELUDE_REPO=~/code/some-repo pnpm tauri dev
pnpm tui ~/code/some-repo               # terminal UI against the debug backend (run `cargo build` in src-tauri first)
pnpm test                               # frontend unit tests
cd src-tauri && cargo test              # git/diff backend tests
```

### Layout

- `src-tauri/src/diff.rs`: runs git and builds a full-file line alignment per changed file
- `src-tauri/src/watch.rs`: file watcher that skips git-ignored paths
- `src-tauri/src/store.rs`: `.prelude/state.json` and `.prelude/review.md`
- `src/lib/anchor.ts`: re-finds comments after the code changes
- `src/lib/output.ts`: builds the Markdown review
- `src/components/FileView.tsx`: diff rendering, line selection and comment threads
- `src/lib/platform.ts`: what the shared store needs from its host (backend, clipboard, title, preferences)
- `src-tauri/src/headless.rs`: `prelude --core`, the backend as JSON lines over stdio for the terminal UI
- `src/tui/`: the terminal UI (Ink); `blocks.ts` turns a file's diff and comments into screen lines

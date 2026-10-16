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

Requires Rust, Node 20+, pnpm and Xcode command line tools.

```sh
pnpm install
pnpm install:mac                                    # builds and copies Prelude.app to /Applications
ln -sf "$PWD/bin/prelude" /opt/homebrew/bin/prelude # or any directory on your PATH
```

Run `pnpm install:mac` again after changing the code. The `prelude` link points at this repo's script, so it doesn't need updating.

Then, in any repository:

```sh
prelude .
```

## Develop

```sh
pnpm tauri dev                          # opens the repo picker
PRELUDE_REPO=~/code/some-repo pnpm tauri dev
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

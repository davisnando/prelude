# Prelude

> The review before the review. A local, PR-style review UI for your working changes, built to hand feedback to an AI agent.

## Flow

1. In a repo, run `prelude .` (or open the app and pick a folder or recent repo).
2. Prelude shows the diff the way a PR would. Select lines and add comments.
3. Click **Copy**. The review goes to the clipboard and is also written to `.prelude/review.md`.
4. Paste it into the agent, or tell the agent "read .prelude/review.md".
5. The agent edits files. Prelude refreshes live: comments on changed lines become **outdated**, and files the agent touched lose their "viewed" mark.
6. Resolve or delete comments, add new ones, and copy again.

## Stack

- **Tauri 2** (Rust backend) + **React + TypeScript** frontend
- Git through the `git` CLI from Rust, which is simplest and matches what users see
- Syntax highlighting with Shiki
- File watching with the `notify` crate, debounced (~300ms), ignoring `.git/` internals except `HEAD`/`index`
- CLI: a small `prelude` launcher that opens the app with a repo path (Tauri single-instance + deep-link/args)

## Diff scope

- **Default:** `merge-base(main|master|origin/HEAD, HEAD)` → working tree. That covers commits on the branch plus staged, unstaged **and untracked** files.
- **Toggle:** "Uncommitted only", which is `HEAD` → working tree.
- The base branch is auto-detected (`origin/HEAD`, then `main`, then `master`) and can be changed in the header.
- Binary files are listed but can't take comments. Renames show as renames.

## Diff view

- File tree sidebar with per-file comment counts and a **viewed** checkbox
- Progress indicator: `4 / 9 files viewed`
- A file's viewed mark resets when its content hash changes
- Unified view by default, with a split view toggle
- Context can be expanded around hunks (↑ / ↓ / all), and comments can go on unchanged context lines too

## Comments

- **Targets:** a line, a line range (click + shift-click, or drag on the gutter), a whole file, or the overall review summary
- **Fields:** body (markdown), severity (`must-fix` / `suggestion` / `nit` / `question`, default `suggestion`), and an optional **suggested change** block (replacement code for the selected lines)
- **States:** `open` → `resolved`. A comment is flagged `outdated` when its anchored lines no longer match.
- No threads. Each comment is single and editable.

### Persistence & anchoring

- Stored per repo and branch in `.prelude/state.json` (Prelude adds `.prelude/` to `.git/info/exclude`, not to `.gitignore`)
- **Anchor:** file path, side (old/new), line range, and a snapshot of the selected lines plus 3 lines of context on each side
- **On refresh:** re-locate the snapshot in the new content. An exact match at the same position means the comment is unchanged. An exact match elsewhere moves the anchor. No match means it is `outdated` and shows its original snippet.

## Output

Markdown. Only **open** comments, grouped by file and ordered must-fix first.

````markdown
# Pre-review: 5 comments (2 must-fix, 2 suggestions, 1 nit)

Address each item below. Items are referenced by file and line in the current working tree.

## Summary
<overall review comment, if any>

## src/api.ts

### 1. [must-fix] L12-18
```diff
-  const x = foo()
+  const x = await foo()
```
This can throw; wrap in try/catch.

**Suggested change:**
```ts
try {
  const x = await foo()
} catch (e) { ... }
```

### 2. [nit] (file)
Rename this file to `api-client.ts`.
````

Copy puts this on the clipboard and writes `.prelude/review.md`.

## Keyboard

`j/k` next/prev file · `n/p` next/prev comment · `c` comment on selection · `v` toggle viewed · `s` split/unified · `r` refresh · `⌘⇧C` copy review

## Out of scope (v1)

- Agent replying back into Prelude
- Comment threads
- Posting to GitHub/GitLab
- Non-git VCS

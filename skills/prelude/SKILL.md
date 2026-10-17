---
name: prelude
description: Work through a code review the user wrote in Prelude, a local PR-style review tool for uncommitted and branch changes. Use when the user mentions Prelude, a "pre-review", .prelude/review.md, or pastes a review that starts with "# Pre-review:"; also when the user asks to review your changes before committing.
---

# Prelude reviews

Prelude shows the user the changes in their git repo the way a pull request would. They comment on lines, then copy the result as a Markdown review. The same review is written to `.prelude/review.md` at the repo root.

## When the user hands you a review

1. Read the whole review first: `.prelude/review.md` (or the pasted text). It may also arrive as extra context on the user's message, starting with "The user left a new Prelude review".
2. Work through every numbered item. Each heading looks like `### 3. [must-fix] L12-14` under a `## \`path/to/file\`` heading:
   - Line numbers refer to the current working tree. `(removed lines)` means lines on the old side of the diff, which no longer exist.
   - `whole file` items apply to the file in general.
   - The `diff` block under an item is the code the comment points at. Find it in the file before editing; if the file has moved on, match by content, not just line number.
3. Treat items by severity:
   - **must-fix**: required.
   - **suggestion** and **nit**: apply unless you have a concrete reason not to; say why if you skip one.
   - **question**: answer it in your reply before changing that code. Only change code if the answer calls for it.
4. A **Suggested change** block is replacement code for the lines it names. Apply it as written unless it is wrong (does not compile, breaks something nearby); then apply the intent and say what you changed.
5. The `## Overall` section, if present, applies to the whole change.
6. Reply with one line per item, by number: what you did, or your answer, or why you skipped it. The user resolves items in Prelude, so the numbers are how they match your reply to their comments.

Do not edit anything in `.prelude/`. It holds the user's review state.

## When the user wants to review your changes

If the user asks to review your work in Prelude (or "before I commit, let me look"), finish your edits and run:

```sh
prelude .
```

from the repo. It opens the Prelude app on the repo and returns immediately. The app reloads by itself as files change, so there is no need to reopen it after later edits. `prelude --tui .` is the terminal version; it needs an interactive terminal, so suggest it to the user rather than running it yourself.

After the user reviews, they press **Copy review** and the new review reaches you as described above. Comments on code you have since changed are marked outdated in Prelude and left out of the next review.

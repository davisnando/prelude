import type { Anchor, Comment, FileDiff, Location, Row, Selection, Side } from "./types";

const CONTEXT = 3;

/** Lines of one side of the file, indexed by line number - 1. */
export function sideLines(rows: Row[], side: Side): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const no = side === "new" ? r.n : r.o;
    if (no) out[no - 1] = r.t;
  }
  return out;
}

export function rowLine(r: Row, side: Side): number {
  return side === "new" ? r.n : r.o;
}

export function makeAnchor(file: FileDiff, sel: Selection): Anchor {
  const lines = sideLines(file.rows, sel.side);
  return {
    side: sel.side,
    start: sel.start,
    end: sel.end,
    lines: lines.slice(sel.start - 1, sel.end),
    before: lines.slice(Math.max(0, sel.start - 1 - CONTEXT), sel.start - 1),
    after: lines.slice(sel.end, sel.end + CONTEXT),
  };
}

function matchesAt(lines: string[], snippet: string[], i: number): boolean {
  if (i < 0 || i + snippet.length > lines.length) return false;
  for (let j = 0; j < snippet.length; j++) if (lines[i + j] !== snippet[j]) return false;
  return true;
}

/** Matching non-blank context lines around position i. Blank lines match too easily to count. */
function contextScore(lines: string[], a: Anchor, i: number): number {
  let score = 0;
  for (let j = 1; j <= a.before.length; j++) {
    const want = a.before[a.before.length - j];
    if (want.trim() && lines[i - j] === want) score++;
  }
  const endIdx = i + a.lines.length;
  for (let j = 0; j < a.after.length; j++) {
    if (a.after[j].trim() && lines[endIdx + j] === a.after[j]) score++;
  }
  return score;
}

/** A short, generic snippet like "}" proves nothing on its own; it needs matching context. */
function needsContext(a: Anchor): boolean {
  return a.lines.join("").trim().length < 12 && [...a.before, ...a.after].some((l) => l.trim());
}

/** Re-finds an anchor in the current diff. Exact position first, then the best-matching move. */
export function locate(anchor: Anchor, file: FileDiff | undefined): Location {
  if (!file || file.binary || file.tooLarge || anchor.lines.length === 0) return { kind: "outdated" };
  const lines = sideLines(file.rows, anchor.side);
  const len = anchor.lines.length;
  const trivial = needsContext(anchor);
  if (matchesAt(lines, anchor.lines, anchor.start - 1) && (!trivial || contextScore(lines, anchor, anchor.start - 1) > 0)) {
    return { kind: "line", side: anchor.side, start: anchor.start, end: anchor.end, moved: false };
  }
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i + len <= lines.length; i++) {
    if (lines[i] !== anchor.lines[0] || !matchesAt(lines, anchor.lines, i)) continue;
    const score = contextScore(lines, anchor, i);
    const closer = best >= 0 && Math.abs(i - (anchor.start - 1)) < Math.abs(best - (anchor.start - 1));
    if (score > bestScore || (score === bestScore && closer)) {
      best = i;
      bestScore = score;
    }
  }
  if (best < 0 || (trivial && bestScore === 0)) return { kind: "outdated" };
  return { kind: "line", side: anchor.side, start: best + 1, end: best + len, moved: true };
}

export function locateAll(comments: Comment[], files: FileDiff[]): Map<string, Location> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const out = new Map<string, Location>();
  for (const c of comments) {
    out.set(c.id, c.anchor ? locate(c.anchor, byPath.get(c.file)) : { kind: "file" });
  }
  return out;
}

/** Row index range [first, last] covering a side's line range; dels/adds in between are included. */
export function rowSpan(rows: Row[], side: Side, start: number, end: number): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    const no = rowLine(rows[i], side);
    if (no >= start && no <= end) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? null : [first, last];
}

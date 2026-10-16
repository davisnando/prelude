import { describe, expect, it } from "vitest";
import { locate, makeAnchor } from "./anchor";
import { buildItems, toSplit } from "./hunks";
import { buildReview, numbering } from "./output";
import type { Comment, DiffResult, FileDiff, Row } from "./types";

/** Builds a file whose rows are all additions/context from a list of [kind, text]. */
function file(path: string, spec: [Row["k"], string][]): FileDiff {
  let o = 0;
  let n = 0;
  const rows = spec.map(([k, t]) => ({
    k,
    t,
    o: k === "a" ? 0 : ++o,
    n: k === "d" ? 0 : ++n,
  }));
  return {
    path, oldPath: null, status: "modified", binary: false, tooLarge: false,
    additions: rows.filter((r) => r.k === "a").length,
    deletions: rows.filter((r) => r.k === "d").length,
    hash: "h", rows,
  };
}

const lines = (...xs: string[]) => xs.map((t) => ["c", t] as [Row["k"], string]);

describe("locate", () => {
  const before = file("a.ts", [...lines("import x", "", "function a() {"), ["a", "  return fetchThing()"], ...lines("}", "", "export {}")]);
  const anchor = makeAnchor(before, { file: "a.ts", side: "new", start: 4, end: 4 });

  it("finds the comment at its original line", () => {
    expect(locate(anchor, before)).toEqual({ kind: "line", side: "new", start: 4, end: 4, moved: false });
  });

  it("follows the code when lines are inserted above", () => {
    const after = file("a.ts", [["a", "// header"], ["a", "// more"], ...before.rows.map((r) => [r.k, r.t] as [Row["k"], string])]);
    expect(locate(anchor, after)).toEqual({ kind: "line", side: "new", start: 6, end: 6, moved: true });
  });

  it("marks the comment outdated when the code is gone", () => {
    const after = file("a.ts", [...lines("import x", "", "function a() {"), ["a", "  return cached()"], ...lines("}", "", "export {}")]);
    expect(locate(anchor, after).kind).toBe("outdated");
  });

  it("does not jump a trivial snippet to an unrelated match", () => {
    const f = file("b.ts", [...lines("a()", "if (x) {", "  y()"), ["a", "}"], ...lines("", "z()")]);
    const brace = makeAnchor(f, { file: "b.ts", side: "new", start: 4, end: 4 });
    const after = file("b.ts", [...lines("q()", "other {", "  w()", "}", "", "r()")]);
    expect(locate(brace, after).kind).toBe("outdated");
  });
});

describe("hunks", () => {
  const big = file("c.ts", [...lines(...Array.from({ length: 30 }, (_, i) => `l${i}`)), ["d", "old"], ["a", "new"], ...lines(...Array.from({ length: 30 }, (_, i) => `m${i}`))]);

  it("folds unchanged lines outside the 3-line context", () => {
    const items = buildItems(big.rows, [], []);
    expect(items[0]).toEqual({ type: "gap", from: 0, to: 26 });
    expect(items.filter((i) => i.type === "row")).toHaveLength(8);
    expect(items[items.length - 1]).toEqual({ type: "gap", from: 35, to: 61 });
  });

  it("pairs deletions with additions for the split view", () => {
    const split = toSplit(buildItems(big.rows, [], []), big.rows);
    expect(split).toContainEqual({ type: "pair", left: 30, right: 31 });
  });
});

describe("buildReview", () => {
  const f = file("src/api.ts", [...lines("const a = 1"), ["d", "const x = foo()"], ["a", "const x = await foo()"], ...lines("export { x }")]);
  const diff: DiffResult = { branch: "feature", baseRef: "main", baseCommit: "abc", files: [f] };
  const base = { file: "src/api.ts", status: "open" as const, createdAt: 0, updatedAt: 0, suggestion: null };
  const comments: Comment[] = [
    { ...base, id: "1", anchor: null, body: "Rename this file.", severity: "nit" },
    { ...base, id: "2", anchor: makeAnchor(f, { file: "src/api.ts", side: "new", start: 2, end: 2 }), body: "This can throw.", severity: "must-fix", suggestion: "try {\n  const x = await foo()\n} catch {}" },
    { ...base, id: "3", anchor: null, body: "Already done.", severity: "suggestion", status: "resolved" },
  ];
  const locations = new Map(comments.map((c) => [c.id, c.anchor ? locate(c.anchor, f) : ({ kind: "file" } as const)]));

  it("orders must-fix first and skips resolved comments", () => {
    expect([...numbering(diff, comments, locations)]).toEqual([["2", 1], ["1", 2]]);
  });

  it("renders the diff snippet, body and suggestion", () => {
    const md = buildReview({ diff, comments, locations, summary: "Add tests." });
    expect(md).toContain("# Pre-review: 2 comments (1 must-fix, 1 nit)");
    expect(md).toContain("## Overall\n\nAdd tests.");
    expect(md).toContain("### 1. [must-fix] L2\n\n```diff\n+const x = await foo()\n```\n\nThis can throw.");
    expect(md).toContain("**Suggested change** (replace L2):\n\n```ts\ntry {");
    expect(md).toContain("### 2. [nit] whole file");
    expect(md).not.toContain("Already done.");
  });
});

import { describe, expect, it } from "vitest";
import { makeAnchor } from "../lib/anchor";
import type { Comment, FileDiff, Row } from "../lib/types";
import { buildBlocks, type BuildInput } from "./blocks";
import * as ed from "./editor";
import { expandTabs, fit, sanitize, width, wrap, type Line } from "./text";

const text = (l: Line) => l.map((s) => s.t).join("");

describe("editor", () => {
  it("inserts pasted multi-line text at the cursor", () => {
    let e = ed.fromText("ab");
    e = ed.left(e);
    e = ed.insert(e, "1\r\n2\n3");
    expect(e.lines).toEqual(["a1", "2", "3b"]);
    expect([e.row, e.col]).toEqual([2, 1]);
  });

  it("joins lines on backspace at the start of a line", () => {
    const e = ed.backspace(ed.home(ed.fromText("one\ntwo")));
    expect(ed.toText(e)).toBe("onetwo");
    expect([e.row, e.col]).toEqual([0, 3]);
  });

  it("counts emoji as one character", () => {
    const e = ed.backspace(ed.fromText("hi 👋"));
    expect(ed.toText(e)).toBe("hi ");
  });

  it("deletes the previous word", () => {
    expect(ed.toText(ed.deleteWordBack(ed.fromText("make it  faster  ")))).toBe("make it  ");
  });

  it("reports the edge so focus can move to another field", () => {
    expect(ed.vertical(ed.fromText("one line"), 1)).toBeNull();
    expect(ed.vertical(ed.fromText("a\nlonger"), -1)).toEqual({ lines: ["a", "longer"], row: 0, col: 1 });
  });

  it("draws the cursor as one inverted cell", () => {
    const lines = ed.renderEditor(ed.left(ed.fromText("abc")), 20, true, "");
    expect(lines[0]).toEqual([{ t: "ab" }, { t: "c", inverse: true }]);
  });
});

describe("text", () => {
  it("neutralises escape sequences", () => {
    expect(sanitize("a\x1b[31mb")).toBe("a�[31mb");
  });

  it("expands tabs to the next stop", () => {
    expect(expandTabs("a\tb")[0]).toBe("a   b");
    expect(expandTabs("\tx", 2)[0]).toBe("  x");
  });

  it("fits a line to an exact width, counting wide characters", () => {
    const l = fit([{ t: "世界abc" }], 5);
    expect(text(l)).toBe("世界a");
    expect(width(text(fit([{ t: "ab" }], 6)))).toBe(6);
  });

  it("wraps on word boundaries and hard-breaks long words", () => {
    expect(wrap("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });
});

describe("blocks", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 20; i++) rows.push({ k: "c", o: i, n: i, t: `line ${i}` });
  rows.splice(10, 0, { k: "a", o: 0, n: 11, t: "added" });
  for (let i = 11; i < rows.length; i++) if (rows[i].k === "c") rows[i] = { ...rows[i], n: rows[i].n + 1 };
  const file: FileDiff = { path: "a.ts", oldPath: null, status: "modified", binary: false, tooLarge: false, additions: 1, deletions: 0, hash: "h", rows };

  const input = (over: Partial<BuildInput> = {}): BuildInput => ({
    file,
    view: "unified",
    width: 60,
    comments: [],
    locations: new Map(),
    numbers: new Map(),
    revealed: [],
    tokens: { old: null, new: null },
    keep: null,
    composer: null,
    ...over,
  });

  it("folds unchanged lines into gaps around the change", () => {
    const kinds = buildBlocks(input()).map((b) => b.stop?.kind);
    expect(kinds).toEqual(["gap", "row", "row", "row", "row", "row", "row", "row", "gap"]);
  });

  it("puts a line comment right after its last line and gives it a number", () => {
    const comment: Comment = {
      id: "c1",
      file: "a.ts",
      anchor: makeAnchor(file, { file: "a.ts", side: "new", start: 11, end: 11 }),
      body: "Why add this?",
      severity: "question",
      suggestion: null,
      status: "open",
      createdAt: 0,
      updatedAt: 0,
    };
    const blocks = buildBlocks(
      input({
        comments: [comment],
        locations: new Map([["c1", { kind: "line", side: "new", start: 11, end: 11, moved: false }]]),
        numbers: new Map([["c1", 1]]),
      }),
    );
    const at = blocks.findIndex((b) => b.key === "c:c1");
    expect(blocks[at - 1].key).toBe("r:0:11");
    const lines = blocks[at].render({ cursor: false, side: "new", sel: null, selSpan: null }).map(text);
    expect(lines[0]).toContain("#1 Question · Line 11");
    expect(lines[1]).toContain("Why add this?");
    expect(lines.every((l) => width(l) === 60)).toBe(true);
  });

  it("places a new-comment composer under the selection", () => {
    const blocks = buildBlocks(input({ composer: { at: { side: "new", end: 12 }, lines: [[{ t: "composer" }]] } }));
    const at = blocks.findIndex((b) => b.key === "composer");
    expect(blocks[at - 1].key).toBe("r:11:12");
  });
});

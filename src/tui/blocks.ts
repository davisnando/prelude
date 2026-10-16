import { rowSpan } from "../lib/anchor";
import type { Tokens } from "../lib/highlight";
import { buildItems, toSplit } from "../lib/hunks";
import type { Comment, FileDiff, Location, Row, Selection, Side } from "../lib/types";
import { expandTabs, fit, sanitize, wrap, type Line, type Seg } from "./text";
import { theme } from "./theme";

/** Something the cursor can rest on. */
export type Stop =
  | { kind: "row"; idx: number }
  | { kind: "pair"; left: number | null; right: number | null }
  | { kind: "gap"; from: number; to: number }
  | { kind: "comment"; id: string };

export interface Ctx {
  cursor: boolean;
  /** Side the cursor is on in split view. */
  side: Side;
  sel: Selection | null;
  selSpan: [number, number] | null;
}

export interface Block {
  key: string;
  stop: Stop | null;
  height: number;
  render(ctx: Ctx): Line[];
}

export type View = "unified" | "split";

export const SEVERITY_LABEL: Record<Comment["severity"], string> = {
  "must-fix": "Must fix",
  suggestion: "Suggestion",
  question: "Question",
  nit: "Nit",
};

const CURSOR = "▌";

export function lineLabel(loc: Location | undefined): string {
  if (!loc || loc.kind === "file") return "Whole file";
  if (loc.kind === "outdated") return "Outdated";
  const r = loc.start === loc.end ? `Line ${loc.start}` : `Lines ${loc.start}–${loc.end}`;
  return loc.side === "old" ? `${r} (removed)` : r;
}

function tokenColor(t: { color?: string; htmlStyle?: unknown }): string | undefined {
  const style = t.htmlStyle as Record<string, string> | undefined;
  return style?.[theme.dark ? "--shiki-dark" : "--shiki-light"] ?? t.color;
}

/** Highlighted segments for one row, with tabs expanded and control characters made visible. */
function code(row: Row, tokens: { old: Tokens | null; new: Tokens | null }, side?: Side): Seg[] {
  const useNew = side ? side === "new" : !!row.n;
  const line = useNew ? (row.n ? tokens.new?.[row.n - 1] : undefined) : row.o ? tokens.old?.[row.o - 1] : undefined;
  let col = 0;
  if (!line) {
    const [t] = expandTabs(sanitize(row.t));
    return [{ t, fg: theme.fg }];
  }
  return line.map((tok) => {
    const [t, next] = expandTabs(sanitize(tok.content), col);
    col = next;
    return { t, fg: tokenColor(tok) ?? theme.fg };
  });
}

function marker(cursor: boolean, bg?: string): Seg {
  return cursor ? { t: CURSOR, fg: theme.accent, bg } : { t: " ", bg };
}

const num = (n: number, w: number) => (n ? String(n).padStart(w) : " ".repeat(w));

export interface BuildInput {
  file: FileDiff;
  view: View;
  width: number;
  comments: Comment[];
  locations: Map<string, Location>;
  numbers: Map<string, number>;
  revealed: [number, number][];
  tokens: { old: Tokens | null; new: Tokens | null };
  /** Rows that must stay visible, e.g. under the selection. */
  keep: [number, number] | null;
  composer: { at: "file" | { side: Side; end: number } | { editing: string }; lines: Line[] } | null;
}

/** Lines of a comment card; `cursor` adds the cursor marker on its first line. */
function commentLines(c: Comment, loc: Location | undefined, n: number | undefined, w: number, cursor: boolean): Line[] {
  const color = theme.sev[c.severity];
  const outdated = loc?.kind === "outdated";
  const resolved = c.status === "resolved";
  const inner = w - 4;
  const bar = (first = false): Seg[] => [marker(cursor && first), { t: " │ ", fg: resolved || outdated ? theme.faint : color }];

  if (resolved) {
    const first = c.body.split("\n")[0] || (c.suggestion !== null ? "Suggested change" : "");
    return [fit([...bar(true), { t: "✓ ", fg: theme.addFg }, { t: first, fg: theme.faint }, { t: "  resolved", fg: theme.faint, italic: true }], w)];
  }

  const head: Seg[] = [...bar(true)];
  if (n !== undefined) head.push({ t: `#${n} `, fg: theme.fg, bold: true });
  head.push({ t: SEVERITY_LABEL[c.severity], fg: color, bold: true }, { t: ` · ${lineLabel(loc)}`, fg: theme.muted });
  if (loc?.kind === "line" && loc.moved) head.push({ t: " · moved with its code", fg: theme.faint, italic: true });
  const out: Line[] = [fit(head, w)];

  if (outdated && c.anchor) {
    for (const l of wrap("The code this pointed at has changed, so it's left out of the copied review. Resolve or delete it.", inner)) {
      out.push(fit([...bar(), { t: l, fg: theme.faint, italic: true }], w));
    }
    for (const l of c.anchor.lines) out.push(fit([...bar(), { t: " " }, ...fit([{ t: expandTabs(sanitize(l))[0], fg: theme.faint }], inner - 1, theme.codeBg)], w));
  }
  for (const l of wrap(c.body, inner)) out.push(fit([...bar(), { t: l, fg: theme.fg }], w));
  if (c.suggestion !== null) {
    out.push(fit([...bar(), { t: "Suggested change", fg: theme.muted, bold: true }], w));
    for (const l of (c.suggestion || " ").split("\n")) {
      out.push(fit([...bar(), { t: " " }, ...fit([{ t: expandTabs(sanitize(l))[0], fg: theme.fg }], inner - 1, theme.codeBg)], w));
    }
  }
  return out;
}

function commentBlock(c: Comment, input: BuildInput): Block {
  const loc = input.locations.get(c.id);
  const n = loc?.kind === "outdated" ? undefined : input.numbers.get(c.id);
  const height = commentLines(c, loc, n, input.width, false).length;
  return {
    key: `c:${c.id}`,
    stop: { kind: "comment", id: c.id },
    height,
    render: (ctx) => commentLines(c, loc, n, input.width, ctx.cursor),
  };
}

function staticBlock(key: string, lines: Line[]): Block {
  return { key, stop: null, height: lines.length, render: () => lines };
}

function note(key: string, text: string, w: number): Block {
  return staticBlock(key, wrap(text, w - 3).map((l) => fit([{ t: "   " }, { t: l, fg: theme.muted, italic: true }], w)));
}

export function buildBlocks(input: BuildInput): Block[] {
  const { file, width: w, comments, locations, tokens, composer } = input;
  const rows = file.rows;
  const blocks: Block[] = [];

  // Line comments keyed by where they render: "<side>:<last line>".
  const threads = new Map<string, Comment[]>();
  const top: Comment[] = [];
  const outdated: Comment[] = [];
  const forced: number[] = input.keep ? [input.keep[0], input.keep[1]] : [];
  for (const c of comments) {
    const loc = locations.get(c.id);
    if (!loc || loc.kind === "file") top.push(c);
    else if (loc.kind === "outdated") outdated.push(c);
    else {
      const key = `${loc.side}:${loc.end}`;
      if (!threads.has(key)) threads.set(key, []);
      threads.get(key)!.push(c);
      const span = rowSpan(rows, loc.side, loc.start, loc.end);
      if (span) for (let i = span[0]; i <= span[1]; i++) forced.push(i);
    }
  }

  const editing = composer && typeof composer.at === "object" && "editing" in composer.at ? composer.at.editing : null;
  const composerBlock = () => staticBlock("composer", composer!.lines);
  const card = (c: Comment) => (c.id === editing ? composerBlock() : commentBlock(c, input));

  for (const c of top) blocks.push(card(c));
  if (composer?.at === "file") blocks.push(composerBlock());
  for (const c of outdated) blocks.push(card(c));
  if (blocks.length) blocks.push(staticBlock("top-gap", [[{ t: "" }]]));

  if (file.binary) {
    blocks.push(note("note", `Binary file${file.status === "deleted" ? " deleted" : ""}. Press f to comment on the whole file.`, w));
    return blocks;
  }
  if (file.tooLarge) {
    blocks.push(note("note", "This file is over 1.5 MB, so its diff isn't shown. Press f to comment on the whole file.", w));
    return blocks;
  }
  if (!rows.length) {
    blocks.push(note("note", "Empty file.", w));
    return blocks;
  }

  const newAt = composer && typeof composer.at === "object" && "side" in composer.at ? `${composer.at.side}:${composer.at.end}` : null;
  const thread = (keys: string[]) => {
    for (const k of keys) for (const c of threads.get(k) ?? []) blocks.push(card(c));
    if (newAt && keys.includes(newAt)) blocks.push(composerBlock());
  };

  const maxNo = rows.reduce((m, r) => Math.max(m, r.o, r.n), 0);
  const gw = Math.max(2, String(maxNo).length);
  const items = buildItems(rows, input.revealed, forced);

  const gapBlock = (from: number, to: number): Block => {
    const count = to - from + 1;
    return {
      key: `g:${from}`,
      stop: { kind: "gap", from, to },
      height: 1,
      render: (ctx) => {
        const bg = ctx.cursor ? theme.cursorBg : undefined;
        const label = `${"⋯".padStart(gw + 1)}  ${count} unchanged line${count === 1 ? "" : "s"}`;
        const hint = ctx.cursor ? "  enter to show" : "";
        return [fit([marker(ctx.cursor, bg), { t: label, fg: theme.faint }, { t: hint, fg: theme.muted, italic: true }], w, bg)];
      },
    };
  };

  const kindBg = (k: Row["k"]) => (k === "a" ? theme.addBg : k === "d" ? theme.delBg : undefined);
  const sign = (k: Row["k"]): Seg => (k === "a" ? { t: "+", fg: theme.addFg } : k === "d" ? { t: "-", fg: theme.delFg } : { t: " " });

  if (input.view === "unified") {
    for (const it of items) {
      if (it.type === "gap") {
        blocks.push(gapBlock(it.from, it.to));
        continue;
      }
      const idx = it.idx;
      const r = rows[idx];
      blocks.push({
        key: `r:${r.o}:${r.n}`,
        stop: { kind: "row", idx },
        height: 1,
        render: (ctx) => {
          const selected = !!ctx.selSpan && idx >= ctx.selSpan[0] && idx <= ctx.selSpan[1];
          const bg = selected ? theme.selBg : ctx.cursor ? theme.cursorBg : kindBg(r.k);
          const gutterFg = selected ? theme.accent : theme.faint;
          return [
            fit(
              [
                marker(ctx.cursor, bg),
                { t: `${num(r.o, gw)} ${num(r.n, gw)} `, fg: gutterFg },
                sign(r.k),
                { t: " " },
                ...code(r, tokens),
              ],
              w,
              bg,
            ),
          ];
        },
      });
      thread([r.o ? `old:${r.o}` : "", r.n ? `new:${r.n}` : ""].filter(Boolean));
    }
    return blocks;
  }

  // Split: old on the left, new on the right; the cursor sits on one side.
  const half = Math.max(10, Math.floor((w - 2) / 2));
  for (const it of toSplit(items, rows)) {
    if (it.type === "gap") {
      blocks.push(gapBlock(it.from, it.to));
      continue;
    }
    const L = it.left !== null ? rows[it.left] : null;
    const R = it.right !== null ? rows[it.right] : null;
    blocks.push({
      key: `p:${L?.o ?? 0}:${R?.n ?? 0}`,
      stop: { kind: "pair", left: it.left, right: it.right },
      height: 1,
      render: (ctx) => {
        const cell = (r: Row | null, side: Side): Line => {
          const no = r ? (side === "old" ? r.o : r.n) : 0;
          const selected = !!r && !!ctx.sel && ctx.sel.side === side && no >= ctx.sel.start && no <= ctx.sel.end;
          const here = ctx.cursor && ctx.side === side;
          const bg = selected ? theme.selBg : here ? theme.cursorBg : r ? kindBg(side === "old" && r.k === "c" ? "c" : r.k) : undefined;
          if (!r) return fit([{ t: "" }], half, bg ?? (theme.dark ? "#14161b" : "#f4f5f7"));
          return fit(
            [{ t: `${num(no, gw)} `, fg: selected ? theme.accent : theme.faint }, sign(r.k), { t: " " }, ...code(r, tokens, side)],
            half,
            bg,
          );
        };
        return [fit([marker(ctx.cursor), ...cell(L, "old"), { t: "│", fg: theme.faint }, ...cell(R, "new")], w)];
      },
    });
    thread([L?.o ? `old:${L.o}` : "", R?.n ? `new:${R.n}` : ""].filter(Boolean));
  }
  return blocks;
}

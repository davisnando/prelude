import { sanitize, TAB, width, type Line, type Seg } from "./text";

/** Multi-line text with a cursor. `col` counts code points. */
export interface Editor {
  lines: string[];
  row: number;
  col: number;
}

const chars = (s: string) => Array.from(s);

export function fromText(text: string): Editor {
  const lines = text.split("\n");
  return { lines, row: lines.length - 1, col: chars(lines[lines.length - 1]).length };
}

export function toText(e: Editor): string {
  return e.lines.join("\n");
}

export function isEmpty(e: Editor): boolean {
  return !toText(e).trim();
}

export function insert(e: Editor, text: string): Editor {
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  const line = chars(e.lines[e.row]);
  const before = line.slice(0, e.col).join("");
  const after = line.slice(e.col).join("");
  const lines = [...e.lines];
  if (parts.length === 1) {
    lines[e.row] = before + parts[0] + after;
    return { lines, row: e.row, col: e.col + chars(parts[0]).length };
  }
  const last = parts[parts.length - 1];
  lines.splice(e.row, 1, before + parts[0], ...parts.slice(1, -1), last + after);
  return { lines, row: e.row + parts.length - 1, col: chars(last).length };
}

export function backspace(e: Editor): Editor {
  const lines = [...e.lines];
  if (e.col > 0) {
    const line = chars(lines[e.row]);
    line.splice(e.col - 1, 1);
    lines[e.row] = line.join("");
    return { lines, row: e.row, col: e.col - 1 };
  }
  if (e.row === 0) return e;
  const prev = lines[e.row - 1];
  lines.splice(e.row - 1, 2, prev + lines[e.row]);
  return { lines, row: e.row - 1, col: chars(prev).length };
}

export function deleteForward(e: Editor): Editor {
  const len = chars(e.lines[e.row]).length;
  if (e.col < len) return backspace(right(e));
  if (e.row === e.lines.length - 1) return e;
  const lines = [...e.lines];
  lines.splice(e.row, 2, lines[e.row] + lines[e.row + 1]);
  return { ...e, lines };
}

export function left(e: Editor): Editor {
  if (e.col > 0) return { ...e, col: e.col - 1 };
  if (e.row === 0) return e;
  return { ...e, row: e.row - 1, col: chars(e.lines[e.row - 1]).length };
}

export function right(e: Editor): Editor {
  if (e.col < chars(e.lines[e.row]).length) return { ...e, col: e.col + 1 };
  if (e.row === e.lines.length - 1) return e;
  return { ...e, row: e.row + 1, col: 0 };
}

/** Moves a line up or down; returns null at the edge so the caller can move to another field. */
export function vertical(e: Editor, dir: 1 | -1): Editor | null {
  const row = e.row + dir;
  if (row < 0 || row >= e.lines.length) return null;
  return { ...e, row, col: Math.min(e.col, chars(e.lines[row]).length) };
}

export const home = (e: Editor): Editor => ({ ...e, col: 0 });
export const end = (e: Editor): Editor => ({ ...e, col: chars(e.lines[e.row]).length });

export function killToStart(e: Editor): Editor {
  const lines = [...e.lines];
  lines[e.row] = chars(lines[e.row]).slice(e.col).join("");
  return { lines, row: e.row, col: 0 };
}

export function killToEnd(e: Editor): Editor {
  const lines = [...e.lines];
  lines[e.row] = chars(lines[e.row]).slice(0, e.col).join("");
  return { ...e, lines };
}

function wordStart(line: string[], col: number): number {
  let i = col;
  while (i > 0 && /\s/.test(line[i - 1])) i--;
  while (i > 0 && !/\s/.test(line[i - 1])) i--;
  return i;
}

export function deleteWordBack(e: Editor): Editor {
  if (e.col === 0) return backspace(e);
  const line = chars(e.lines[e.row]);
  const start = wordStart(line, e.col);
  const lines = [...e.lines];
  lines[e.row] = [...line.slice(0, start), ...line.slice(e.col)].join("");
  return { lines, row: e.row, col: start };
}

export function wordLeft(e: Editor): Editor {
  if (e.col === 0) return left(e);
  return { ...e, col: wordStart(chars(e.lines[e.row]), e.col) };
}

export function wordRight(e: Editor): Editor {
  const line = chars(e.lines[e.row]);
  if (e.col >= line.length) return right(e);
  let i = e.col;
  while (i < line.length && /\s/.test(line[i])) i++;
  while (i < line.length && !/\s/.test(line[i])) i++;
  return { ...e, col: i };
}

/**
 * Screen lines for the editor, hard-wrapped at `w` columns, with the cursor drawn as an inverted cell
 * when focused. Shows `placeholder` (dimmed) when empty.
 */
export function renderEditor(e: Editor, w: number, focused: boolean, placeholder: string): Line[] {
  w = Math.max(4, w);
  if (isEmpty(e) && e.lines.length === 1) {
    const hint: Seg = { t: placeholder, dim: true, italic: true };
    return [focused ? [{ t: " ", inverse: true }, hint] : [hint]];
  }
  const out: Line[] = [];
  e.lines.forEach((raw, row) => {
    const cells = chars(raw).map((ch) => (ch === "\t" ? " ".repeat(TAB) : sanitize(ch)));
    const cursorAt = focused && row === e.row ? e.col : -1;
    if (cursorAt === cells.length) cells.push(" ");
    let line: Line = [];
    let used = 0;
    cells.forEach((c, i) => {
      const cw = width(c);
      if (used + cw > w && line.length) {
        out.push(line);
        line = [];
        used = 0;
      }
      const inverse = i === cursorAt;
      const last = line[line.length - 1];
      if (last && !last.inverse && !inverse) last.t += c;
      else line.push(inverse ? { t: c, inverse } : { t: c });
      used += cw;
    });
    out.push(line);
  });
  return out;
}

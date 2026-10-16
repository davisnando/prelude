import stringWidth from "string-width";

/** A run of styled text; a screen line is a list of these. */
export interface Seg {
  t: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  inverse?: boolean;
}
export type Line = Seg[];

export const TAB = 4;

export function width(s: string): number {
  return stringWidth(s);
}

/** Control characters (escape sequences in particular) would be interpreted by the terminal. */
export function sanitize(s: string): string {
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "�");
}

/** Expands tabs to spaces, continuing from column `col`. Returns the text and the column it ends on. */
export function expandTabs(s: string, col = 0): [string, number] {
  if (!s.includes("\t")) return [s, col + width(s)];
  let out = "";
  for (const ch of s) {
    if (ch === "\t") {
      const n = TAB - (col % TAB);
      out += " ".repeat(n);
      col += n;
    } else {
      out += ch;
      col += width(ch);
    }
  }
  return [out, col];
}

/** Cuts `s` to at most `w` columns. */
export function cut(s: string, w: number): string {
  if (w <= 0) return "";
  if (width(s) <= w) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const cw = width(ch);
    if (used + cw > w) break;
    out += ch;
    used += cw;
  }
  return out;
}

/** Truncates a line to exactly `w` columns, padding with spaces; `bg` fills segments that have none. */
export function fit(line: Line, w: number, bg?: string): Line {
  const out: Line = [];
  let used = 0;
  for (const s of line) {
    if (used >= w) break;
    const t = cut(s.t, w - used);
    if (!t) continue;
    out.push(bg && !s.bg ? { ...s, t, bg } : { ...s, t });
    used += width(t);
  }
  if (used < w) out.push({ t: " ".repeat(w - used), bg });
  return out;
}

/** Word-wraps plain text to `w` columns. Hard-breaks words longer than a line. Keeps blank lines. */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  w = Math.max(1, w);
  for (const raw of text.split("\n")) {
    const [para] = expandTabs(sanitize(raw));
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/(?<=\s)/)) {
      if (width(line) + width(word.trimEnd()) <= w) {
        line += word;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      let rest = word;
      while (width(rest.trimEnd()) > w) {
        const head = cut(rest, w);
        out.push(head);
        rest = rest.slice(head.length);
      }
      line = rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}

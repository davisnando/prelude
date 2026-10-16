import type { Row } from "./types";

export const CONTEXT = 3;
export const EXPAND_STEP = 20;

export type Item =
  | { type: "row"; idx: number }
  /** hidden rows [from, to] inclusive */
  | { type: "gap"; from: number; to: number };

/** Changed rows plus context, revealed ranges and forced rows (e.g. under comments); the rest folds into gaps. */
export function buildItems(rows: Row[], revealed: [number, number][], forced: Iterable<number>): Item[] {
  const visible = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].k !== "c") {
      const lo = Math.max(0, i - CONTEXT);
      const hi = Math.min(rows.length - 1, i + CONTEXT);
      for (let j = lo; j <= hi; j++) visible[j] = 1;
    }
  }
  for (const [a, b] of revealed) for (let j = Math.max(0, a); j <= Math.min(rows.length - 1, b); j++) visible[j] = 1;
  for (const j of forced) if (j >= 0 && j < rows.length) visible[j] = 1;

  const items: Item[] = [];
  let i = 0;
  while (i < rows.length) {
    if (visible[i]) {
      items.push({ type: "row", idx: i });
      i++;
    } else {
      const from = i;
      while (i < rows.length && !visible[i]) i++;
      items.push({ type: "gap", from, to: i - 1 });
    }
  }
  return items;
}

export type SplitItem =
  | { type: "pair"; left: number | null; right: number | null }
  | { type: "gap"; from: number; to: number };

/** Pairs deletions with following additions so the split view lines them up. */
export function toSplit(items: Item[], rows: Row[]): SplitItem[] {
  const out: SplitItem[] = [];
  let dels: number[] = [];
  let adds: number[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let j = 0; j < n; j++) out.push({ type: "pair", left: dels[j] ?? null, right: adds[j] ?? null });
    dels = [];
    adds = [];
  };
  for (const it of items) {
    if (it.type === "gap") {
      flush();
      out.push(it);
      continue;
    }
    const r = rows[it.idx];
    if (r.k === "d") {
      if (adds.length) flush();
      dels.push(it.idx);
    } else if (r.k === "a") {
      adds.push(it.idx);
    } else {
      flush();
      out.push({ type: "pair", left: it.idx, right: it.idx });
    }
  }
  flush();
  return out;
}

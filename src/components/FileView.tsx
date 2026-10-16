import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { rowSpan, sideLines } from "../lib/anchor";
import { extendDrag, startDrag } from "../lib/drag";
import { highlight, type Tokens } from "../lib/highlight";
import { buildItems, EXPAND_STEP, toSplit, type Item } from "../lib/hunks";
import { useBranchState, useStore } from "../lib/store";
import type { Comment, FileDiff, Location, Row, Selection, Side } from "../lib/types";
import { CommentCard, Composer } from "./Comment";

const LARGE_ROWS = 2500;
const NO_RANGES: [number, number][] = [];

const STATUS: Record<FileDiff["status"], [string, string]> = {
  added: ["A", "Added"],
  untracked: ["U", "New, untracked"],
  modified: ["M", "Modified"],
  deleted: ["D", "Deleted"],
  renamed: ["R", "Renamed"],
};

export function StatusBadge({ status }: { status: FileDiff["status"] }) {
  const [letter, title] = STATUS[status];
  return (
    <span className={`status status-${status}`} title={title}>
      {letter}
    </span>
  );
}

function Code({ row, tokens }: { row: Row; tokens: { old: Tokens | null; new: Tokens | null } }) {
  const line = row.n ? tokens.new?.[row.n - 1] : row.o ? tokens.old?.[row.o - 1] : undefined;
  if (!line) return <>{row.t || " "}</>;
  return (
    <>
      {line.map((t, i) => (
        <span key={i} style={t.htmlStyle as React.CSSProperties}>
          {t.content}
        </span>
      ))}
      {line.length === 0 && " "}
    </>
  );
}

interface Props {
  file: FileDiff;
  numbers: Map<string, number>;
  locations: Map<string, Location>;
}

export const FileView = memo(function FileView({ file, numbers, locations }: Props) {
  const view = useStore((s) => s.view);
  const selection = useStore((s) => (s.selection?.file === file.path ? s.selection : null));
  const composer = useStore((s) => (s.composer?.file === file.path ? s.composer : null));
  const revealed = useStore((s) => s.revealed[file.path]) ?? NO_RANGES;
  const override = useStore((s) => s.openOverride[file.path]);
  const reveal = useStore((s) => s.reveal);
  const setFileOpen = useStore((s) => s.setFileOpen);
  const toggleViewed = useStore((s) => s.toggleViewed);
  const openComposer = useStore((s) => s.openComposer);
  const branch = useBranchState();

  const viewed = branch.viewed[file.path] === file.hash;
  const collapsed = override === false || (override === undefined && viewed);
  const gated = !collapsed && file.rows.length > LARGE_ROWS && override !== true;
  const rows = file.rows;

  const comments = useMemo(() => branch.comments.filter((c) => c.file === file.path), [branch.comments, file.path]);
  const openCount = comments.filter((c) => c.status === "open").length;

  // Line comments keyed by where their thread renders: "<side>:<last line>".
  const { threads, fileLevel, outdated, annotated, forced } = useMemo(() => {
    const threads = new Map<string, Comment[]>();
    const fileLevel: Comment[] = [];
    const outdated: Comment[] = [];
    const annotated = new Set<number>();
    const forced: number[] = [];
    for (const c of comments) {
      const loc = locations.get(c.id);
      if (!loc || loc.kind === "file") fileLevel.push(c);
      else if (loc.kind === "outdated") outdated.push(c);
      else {
        const key = `${loc.side}:${loc.end}`;
        if (!threads.has(key)) threads.set(key, []);
        threads.get(key)!.push(c);
        const span = rowSpan(rows, loc.side, loc.start, loc.end);
        if (span) {
          for (let i = span[0]; i <= span[1]; i++) {
            forced.push(i);
            if (c.status === "open") annotated.add(i);
          }
        }
      }
    }
    return { threads, fileLevel, outdated, annotated, forced };
  }, [comments, locations, rows]);

  const active: Selection | null = composer?.sel ?? selection;
  const activeSpan = active ? rowSpan(rows, active.side, active.start, active.end) : null;

  const items = useMemo(() => {
    const extra = activeSpan ? [activeSpan[0], activeSpan[1]] : [];
    return buildItems(rows, revealed, [...forced, ...extra]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, revealed, forced, activeSpan?.[0], activeSpan?.[1]]);

  const [tokens, setTokens] = useState<{ old: Tokens | null; new: Tokens | null }>({ old: null, new: null });
  useEffect(() => {
    if (collapsed || gated || file.binary || file.tooLarge) return;
    let live = true;
    Promise.all([
      highlight(file.path, `${file.hash}:old`, sideLines(rows, "old")),
      highlight(file.path, `${file.hash}:new`, sideLines(rows, "new")),
    ]).then(([o, n]) => live && setTokens({ old: o, new: n }));
    return () => {
      live = false;
    };
  }, [file.path, file.hash, rows, collapsed, gated, file.binary, file.tooLarge]);

  const selectedText = useMemo(() => {
    if (!composer?.sel || composer.sel.side !== "new") return null;
    return sideLines(rows, "new").slice(composer.sel.start - 1, composer.sel.end).join("\n");
  }, [composer?.sel, rows]);

  const newComposerKey = composer && composer.sel && !composer.editingId ? `${composer.sel.side}:${composer.sel.end}` : null;

  const thread = (keys: string[]): ReactNode => {
    const list = keys.flatMap((k) => threads.get(k) ?? []);
    const showComposer = newComposerKey !== null && keys.includes(newComposerKey);
    if (!list.length && !showComposer) return null;
    return (
      <div className="thread" key={`t-${keys.join("|")}`}>
        {list.map((c) =>
          composer?.editingId === c.id ? (
            <Composer key={c.id} initial={c} selectedText={selectedText} />
          ) : (
            <CommentCard key={c.id} comment={c} location={locations.get(c.id)} number={numbers.get(c.id)} />
          ),
        )}
        {showComposer && <Composer key="new" selectedText={selectedText} />}
      </div>
    );
  };

  const gutter = (side: Side, line: number) => ({
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0 || !line) return;
      e.preventDefault();
      startDrag(file.path, side, line, e.shiftKey);
    },
    onMouseEnter: () => line && extendDrag(file.path, side, line),
  });

  const gap = (it: Extract<Item, { type: "gap" }>) => {
    const count = it.to - it.from + 1;
    const atTop = it.from === 0;
    const atEnd = it.to === rows.length - 1;
    return (
      <div className="gap" key={`g-${it.from}`}>
        {count <= EXPAND_STEP ? (
          <button className="gap-btn" onClick={() => reveal(file.path, [it.from, it.to])}>
            Show {count} unchanged line{count === 1 ? "" : "s"}
          </button>
        ) : (
          <>
            {!atTop && (
              <button className="gap-btn" title="Show more below" onClick={() => reveal(file.path, [it.from, it.from + EXPAND_STEP - 1])}>
                ↓ {EXPAND_STEP}
              </button>
            )}
            {!atEnd && (
              <button className="gap-btn" title="Show more above" onClick={() => reveal(file.path, [it.to - EXPAND_STEP + 1, it.to])}>
                ↑ {EXPAND_STEP}
              </button>
            )}
            <button className="gap-btn" onClick={() => reveal(file.path, [it.from, it.to])}>
              Show all {count} unchanged lines
            </button>
          </>
        )}
      </div>
    );
  };

  const unified = () =>
    items.map((it) => {
      if (it.type === "gap") return gap(it);
      const r = rows[it.idx];
      const side: Side = r.k === "d" ? "old" : "new";
      const line = side === "old" ? r.o : r.n;
      const sel = activeSpan && it.idx >= activeSpan[0] && it.idx <= activeSpan[1];
      const cls = `row row-${r.k}${sel ? " selected" : ""}${annotated.has(it.idx) ? " annotated" : ""}`;
      const keys = [r.o ? `old:${r.o}` : "", r.n ? `new:${r.n}` : ""].filter(Boolean);
      return [
        <div className={cls} key={it.idx}>
          <span className="ln" {...gutter(side, line)}>{r.o || ""}</span>
          <span className="ln" {...gutter(side, line)}>{r.n || ""}</span>
          <span className="sign">{r.k === "a" ? "+" : r.k === "d" ? "−" : ""}</span>
          <span className="code"><Code row={r} tokens={tokens} /></span>
        </div>,
        thread(keys),
      ];
    });

  const split = () =>
    toSplit(items, rows).map((it) => {
      if (it.type === "gap") return gap(it);
      const L = it.left !== null ? rows[it.left] : null;
      const R = it.right !== null ? rows[it.right] : null;
      const inSel = (side: Side, no: number) => !!active && active.side === side && no >= active.start && no <= active.end;
      const half = (r: Row | null, side: Side, idx: number | null) => {
        const no = r ? (side === "old" ? r.o : r.n) : 0;
        const kind = !r ? "empty" : r.k;
        const cls = `half half-${kind}${r && inSel(side, no) ? " selected" : ""}${idx !== null && annotated.has(idx) ? " annotated" : ""}`;
        return (
          <div className={cls}>
            <span className="ln" {...gutter(side, no)}>{no || ""}</span>
            <span className="sign">{r?.k === "a" ? "+" : r?.k === "d" ? "−" : ""}</span>
            <span className="code">{r && <Code row={side === "old" && r.k === "c" ? { ...r, n: 0 } : r} tokens={tokens} />}</span>
          </div>
        );
      };
      const keys = [L?.o ? `old:${L.o}` : "", R?.n ? `new:${R.n}` : ""].filter(Boolean);
      return [
        <div className="pair" key={`p-${it.left}-${it.right}`}>
          {half(L, "old", it.left)}
          {half(R, "new", it.right)}
        </div>,
        thread(keys),
      ];
    });

  const fileComposer = composer && !composer.sel && !composer.editingId;
  const [letter] = STATUS[file.status];

  return (
    <section className={`file${collapsed ? " file-collapsed" : ""}`} data-path={file.path} id={`f-${file.path}`}>
      <header className="file-head">
        <button className="chevron" aria-label={collapsed ? "Expand file" : "Collapse file"} aria-expanded={!collapsed} onClick={() => setFileOpen(file.path, collapsed)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <StatusBadge status={file.status} />
        <span className="file-path" title={file.path}>
          {file.oldPath && <span className="file-old">{file.oldPath} → </span>}
          {file.path}
        </span>
        {!file.binary && !file.tooLarge && (
          <span className="file-stat">
            <span className="add">+{file.additions}</span>
            <span className="del">−{file.deletions}</span>
          </span>
        )}
        {openCount > 0 && <span className="file-count" title="Open comments">{openCount}</span>}
        <span className="spacer" />
        <button className="btn btn-quiet btn-sm" onClick={() => openComposer({ file: file.path, sel: null, editingId: null })}>
          Comment on file
        </button>
        <label className={`viewed${viewed ? " on" : ""}`}>
          <input type="checkbox" checked={viewed} onChange={() => toggleViewed(file.path)} />
          Viewed
        </label>
      </header>

      {!collapsed && (
        <div className="file-body">
          {(fileLevel.length > 0 || fileComposer) && (
            <div className="thread thread-file">
              {fileLevel.map((c) =>
                composer?.editingId === c.id ? (
                  <Composer key={c.id} initial={c} selectedText={null} />
                ) : (
                  <CommentCard key={c.id} comment={c} location={locations.get(c.id)} number={numbers.get(c.id)} />
                ),
              )}
              {fileComposer && <Composer key="new-file" selectedText={null} />}
            </div>
          )}
          {outdated.length > 0 && (
            <div className="thread thread-outdated">
              {outdated.map((c) =>
                composer?.editingId === c.id ? (
                  <Composer key={c.id} initial={c} selectedText={null} />
                ) : (
                  <CommentCard key={c.id} comment={c} location={locations.get(c.id)} number={undefined} />
                ),
              )}
            </div>
          )}
          {file.binary ? (
            <p className="file-note">Binary file{letter === "D" ? " deleted" : ""}. You can still leave a comment on the whole file.</p>
          ) : file.tooLarge ? (
            <p className="file-note">This file is over 1.5 MB, so its diff isn’t shown. You can still leave a comment on the whole file.</p>
          ) : rows.length === 0 ? (
            <p className="file-note">Empty file.</p>
          ) : gated ? (
            <div className="file-note">
              This diff has {rows.length.toLocaleString()} lines.{" "}
              <button className="btn btn-quiet btn-sm" onClick={() => setFileOpen(file.path, true)}>Show diff</button>
            </div>
          ) : (
            <div className={view === "split" ? "diff diff-split" : "diff diff-unified"}>
              {view === "split" ? split() : unified()}
            </div>
          )}
        </div>
      )}
    </section>
  );
});

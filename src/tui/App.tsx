import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, usePaste, useWindowSize } from "ink";
import { rowSpan, sideLines } from "../lib/anchor";
import { highlight, type Tokens } from "../lib/highlight";
import { exportable, numbering } from "../lib/output";
import { useBranchState, useStore } from "../lib/store";
import { SEVERITIES, type Comment, type FileDiff, type Row, type Selection, type Side } from "../lib/types";
import { buildBlocks, lineLabel, type Block, type Stop } from "./blocks";
import { newDraft, draftLines, type Draft } from "./draft";
import * as ed from "./editor";
import { cut, fit, width as textWidth, type Line, type Seg } from "./text";
import { theme } from "./theme";

const NO_RANGES: [number, number][] = [];
const NO_TOKENS = { old: null, new: null };
const SCROLL_OFF = 3;

type Overlay = null | "help" | { kind: "refs"; index: number } | { kind: "delete"; id: string };

const STATUS: Record<FileDiff["status"], [string, string]> = {
  added: ["A", theme.addFg],
  untracked: ["U", theme.addFg],
  modified: ["M", theme.accent],
  deleted: ["D", theme.delFg],
  renamed: ["R", theme.sev.question],
};

function Out({ line }: { line: Line }) {
  return (
    <Text wrap="truncate">
      {line.map((s, i) => (
        <Text key={i} color={s.fg} backgroundColor={s.bg} bold={s.bold} dimColor={s.dim} italic={s.italic} inverse={s.inverse}>
          {s.t}
        </Text>
      ))}
    </Text>
  );
}

/** The row a stop points at, and the side/line a comment there would attach to. */
function stopRow(stop: Stop | null, side: Side, rows: Row[]): { idx: number; side: Side; line: number } | null {
  if (!stop) return null;
  if (stop.kind === "row") {
    const r = rows[stop.idx];
    const s: Side = r.k === "d" ? "old" : "new";
    return { idx: stop.idx, side: s, line: s === "old" ? r.o : r.n };
  }
  if (stop.kind === "pair") {
    const pick = (s: Side) => {
      const idx = s === "old" ? stop.left : stop.right;
      if (idx === null) return null;
      const r = rows[idx];
      const line = s === "old" ? r.o : r.n;
      return line ? { idx, side: s, line } : null;
    };
    return pick(side) ?? pick(side === "old" ? "new" : "old");
  }
  return null;
}

/** Line number on `side` at row `idx`, walking toward `toward` past rows that only exist on the other side. */
function lineOn(rows: Row[], idx: number, side: Side, toward: number): number {
  const step = toward >= idx ? 1 : -1;
  for (let i = idx; ; i += step) {
    const no = side === "old" ? rows[i].o : rows[i].n;
    if (no || i === toward) return no;
  }
}

function runEditor(text: string, ext: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "prelude-"));
  const file = join(dir, `comment.${ext}`);
  try {
    writeFileSync(file, text);
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    const res = spawnSync(`${editor} "${file}"`, { stdio: "inherit", shell: true });
    if (res.status !== 0) return null;
    return readFileSync(file, "utf8").replace(/\n$/, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function App({ path }: { path: string }) {
  const { exit, suspendTerminal } = useApp();
  const { columns, rows: height } = useWindowSize();
  const repo = useStore((s) => s.repo);
  const diff = useStore((s) => s.diff);
  const error = useStore((s) => s.error);
  const loading = useStore((s) => s.loading);
  const view = useStore((s) => s.view);
  const locations = useStore((s) => s.locations);
  const revealedAll = useStore((s) => s.revealed);
  const composer = useStore((s) => s.composer);
  const activeFile = useStore((s) => s.activeFile);
  const toast = useStore((s) => s.toast);
  const branchName = useStore((s) => s.branch);
  const branch = useBranchState();
  const s = useStore.getState();

  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("new");
  const [anchor, setAnchor] = useState<{ idx: number; side: Side; line: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [showTree, setShowTree] = useState(true);
  const [tokens, setTokens] = useState<{ old: Tokens | null; new: Tokens | null }>(NO_TOKENS);
  const cursors = useRef(new Map<string, string>());
  const lastIndex = useRef(0);
  const top = useRef(0);

  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    s.openRepo(path).then(() => setOpenFailed(!useStore.getState().repo));
  }, [path]);

  const files = diff?.files ?? [];
  const file = files.find((f) => f.path === activeFile) ?? files[0] ?? null;
  useEffect(() => {
    if (file && file.path !== activeFile) s.setActiveFile(file.path);
  }, [file?.path, activeFile]);

  // Layout
  const treeW = showTree && columns >= 90 ? Math.min(44, Math.max(26, Math.floor(columns * 0.25))) : 0;
  const paneW = Math.max(20, columns - (treeW ? treeW + 1 : 0));
  const listH = Math.max(3, height - 3);

  useEffect(() => {
    setTokens(NO_TOKENS);
    if (!file || file.binary || file.tooLarge) return;
    let live = true;
    Promise.all([
      highlight(file.path, `${file.hash}:old`, sideLines(file.rows, "old")),
      highlight(file.path, `${file.hash}:new`, sideLines(file.rows, "new")),
    ]).then(([o, n]) => live && setTokens({ old: o, new: n }));
    return () => {
      live = false;
    };
  }, [file?.path, file?.hash]);

  const numbers = useMemo(() => (diff ? numbering(diff, branch.comments, locations) : new Map<string, number>()), [diff, branch.comments, locations]);
  const fileComments = useMemo(() => (file ? branch.comments.filter((c) => c.file === file.path) : []), [branch.comments, file?.path]);
  const exportCount = useMemo(() => exportable({ comments: branch.comments, locations }).length, [branch.comments, locations]);

  const commentDraft = draft?.kind === "comment" && composer?.file === file?.path ? draft : null;
  const draftAt = !commentDraft || !composer ? null : composer.editingId ? { editing: composer.editingId } : composer.sel ? { side: composer.sel.side, end: composer.sel.end } : ("file" as const);
  const composerLines = useMemo(() => (commentDraft ? draftLines(commentDraft, paneW) : []), [commentDraft, paneW]);
  const keep = composer?.sel && file ? rowSpan(file.rows, composer.sel.side, composer.sel.start, composer.sel.end) : null;

  const blocks: Block[] = useMemo(() => {
    if (!file) return [];
    return buildBlocks({
      file,
      view,
      width: paneW,
      comments: fileComments,
      locations,
      numbers,
      revealed: revealedAll[file.path] ?? NO_RANGES,
      tokens,
      keep,
      composer: draftAt ? { at: draftAt, lines: composerLines } : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, view, paneW, fileComments, locations, numbers, revealedAll, tokens, keep?.[0], keep?.[1], JSON.stringify(draftAt), composerLines]);

  // Resolve the cursor to a block, keeping its position when the block it was on disappears.
  let ci = blocks.findIndex((b) => b.key === cursorKey && b.stop);
  if (ci < 0) {
    const stops = blocks.map((b, i) => (b.stop ? i : -1)).filter((i) => i >= 0);
    ci = stops.find((i) => i >= Math.min(lastIndex.current, blocks.length - 1)) ?? stops[stops.length - 1] ?? -1;
  }
  lastIndex.current = Math.max(0, ci);
  const cursorBlock = ci >= 0 ? blocks[ci] : null;
  const rows = file?.rows ?? [];
  const here = stopRow(cursorBlock?.stop ?? null, side, rows);

  const sel: Selection | null = useMemo(() => {
    if (!file || !anchor || !here) return null;
    const line = lineOn(rows, here.idx, anchor.side, anchor.idx);
    return { file: file.path, side: anchor.side, start: Math.min(anchor.line, line), end: Math.max(anchor.line, line) };
  }, [file, anchor, here?.idx]);
  const shown = composer?.sel && composer.file === file?.path ? composer.sel : sel;
  const selSpan = shown ? rowSpan(rows, shown.side, shown.start, shown.end) : null;

  // Scrolling: keep the cursor (or the open composer) on screen with a little margin.
  const offsets: number[] = [];
  let total = 0;
  for (const b of blocks) {
    offsets.push(total);
    total += b.height;
  }
  const focusIdx = draftAt ? blocks.findIndex((b) => b.key === "composer") : ci;
  if (focusIdx >= 0) {
    const start = offsets[focusIdx];
    const end = start + blocks[focusIdx].height;
    const margin = Math.min(SCROLL_OFF, Math.floor((listH - 1) / 2));
    if (start - margin < top.current) top.current = Math.max(0, start - margin);
    else if (end + margin > top.current + listH) top.current = Math.min(start, end + margin - listH);
  }
  top.current = Math.max(0, Math.min(top.current, Math.max(0, total - listH)));

  // ---- actions ----

  const moveTo = (i: number) => {
    const b = blocks[i];
    if (b?.stop) setCursorKey(b.key);
  };
  const move = (delta: number) => {
    if (ci < 0) return;
    let i = ci;
    let left = Math.abs(delta);
    const step = Math.sign(delta);
    while (left > 0) {
      let j = i + step;
      while (j >= 0 && j < blocks.length && !blocks[j].stop) j += step;
      if (j < 0 || j >= blocks.length) break;
      i = j;
      left--;
    }
    moveTo(i);
  };
  const moveLines = (lines: number) => {
    if (ci < 0) return;
    const target = offsets[ci] + lines;
    let i = ci;
    const step = Math.sign(lines);
    for (let j = ci + step; j >= 0 && j < blocks.length; j += step) {
      if (!blocks[j].stop) continue;
      i = j;
      if (step > 0 ? offsets[j] >= target : offsets[j] <= target) break;
    }
    moveTo(i);
  };

  const switchFile = (next: FileDiff | undefined, key?: string) => {
    if (!next || !file) return;
    if (cursorKey) cursors.current.set(file.path, cursorKey);
    setCursorKey(key ?? cursors.current.get(next.path) ?? null);
    lastIndex.current = 0;
    top.current = 0;
    setAnchor(null);
    s.setActiveFile(next.path);
  };
  const jumpFile = (dir: 1 | -1) => {
    const i = files.findIndex((f) => f.path === file?.path);
    switchFile(files[Math.min(files.length - 1, Math.max(0, i + dir))]);
  };

  const isOpen = (id: string) => branch.comments.find((c) => c.id === id)?.status === "open";
  const jumpComment = (dir: 1 | -1) => {
    if (!file) return;
    const stops = blocks.map((b, i) => [b, i] as const).filter(([b]) => b.stop?.kind === "comment" && isOpen(b.stop.id));
    const next = dir === 1 ? stops.find(([, i]) => i > ci) : [...stops].reverse().find(([, i]) => i < ci);
    if (next) return moveTo(next[1]);
    const fi = files.findIndex((f) => f.path === file.path);
    const order = (c: Comment) => {
      const loc = locations.get(c.id);
      return loc?.kind === "line" ? loc.start : -1;
    };
    for (let k = 1; k <= files.length; k++) {
      const f = files[(((fi + dir * k) % files.length) + files.length) % files.length];
      const list = branch.comments.filter((c) => c.file === f.path && c.status === "open").sort((a, b) => order(a) - order(b));
      if (!list.length) continue;
      const target = dir === 1 ? list[0] : list[list.length - 1];
      if (f.path === file.path) return setCursorKey(`c:${target.id}`);
      return switchFile(f, `c:${target.id}`);
    }
    s.notify("No open comments", "error");
  };

  const selectedText = (sel: Selection) => (sel.side === "new" ? sideLines(rows, "new").slice(sel.start - 1, sel.end).join("\n") : "");

  const startComment = (target: Selection | null) => {
    if (!file) return;
    s.openComposer({ file: file.path, sel: target, editingId: null });
    const where = target ? lineLabel({ kind: "line", side: target.side, start: target.start, end: target.end, moved: false }) : "Whole file";
    setDraft(newDraft({ title: `New comment · ${where}`, selected: target ? selectedText(target) : null }));
  };

  const editComment = (c: Comment) => {
    const loc = locations.get(c.id);
    const target = loc?.kind === "line" ? { file: c.file, side: loc.side, start: loc.start, end: loc.end } : null;
    s.openComposer({ file: c.file, sel: target, editingId: c.id });
    setDraft(
      newDraft({
        title: `Edit comment · ${lineLabel(loc)}`,
        body: c.body,
        severity: c.severity,
        suggestion: c.suggestion,
        selected: target ? selectedText(target) : null,
      }),
    );
  };

  const closeDraft = () => {
    if (draft?.kind === "comment") s.closeComposer();
    setDraft(null);
    setAnchor(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const body = ed.toText(draft.body).trim();
    if (draft.kind === "summary") {
      s.setSummary(body);
      setDraft(null);
      return;
    }
    if (!body && draft.suggestion === null) return s.notify("Write a comment first", "error");
    const editing = composer?.editingId;
    s.saveComment({ body, severity: draft.severity, suggestion: draft.suggestion ? ed.toText(draft.suggestion) : null });
    if (editing) setCursorKey(`c:${editing}`);
    setDraft(null);
    setAnchor(null);
  };

  const editExternally = () => {
    if (!draft) return;
    const field = draft.focus === "suggestion" && draft.suggestion ? draft.suggestion : draft.body;
    const ext = draft.focus === "suggestion" && file ? file.path.split(".").pop() || "txt" : "md";
    let result: string | null = null;
    suspendTerminal(() => {
      result = runEditor(ed.toText(field), ext);
    }).then(() => {
      if (result === null) return;
      const next = ed.fromText(result);
      setDraft((d) => (d ? (d.focus === "suggestion" && d.suggestion ? { ...d, suggestion: next } : { ...d, body: next }) : d));
    });
  };

  const quit = async () => {
    await s.flush();
    exit();
  };

  // ---- input ----

  const editField = (fn: (e: ed.Editor) => ed.Editor) =>
    setDraft((d) => {
      if (!d) return d;
      if (d.focus === "suggestion" && d.suggestion) return { ...d, suggestion: fn(d.suggestion) };
      return { ...d, body: fn(d.body) };
    });

  usePaste((text) => editField((e) => ed.insert(e, text)), { isActive: !!draft });

  useInput((input, key) => {
    if (!draft) return;
    if (key.escape || (key.ctrl && input === "c")) return closeDraft();
    if (key.return && (key.shift || key.meta)) return editField((e) => ed.insert(e, "\n"));
    if (input === "\n" || (key.ctrl && input === "j")) return editField((e) => ed.insert(e, "\n"));
    if (key.return) return saveDraft();
    if (key.tab && draft.kind === "comment") {
      const i = SEVERITIES.indexOf(draft.severity);
      const next = SEVERITIES[(i + (key.shift ? SEVERITIES.length - 1 : 1)) % SEVERITIES.length];
      return setDraft({ ...draft, severity: next });
    }
    if (key.ctrl && input === "o" && draft.kind === "comment" && draft.selected !== null) {
      return setDraft(
        draft.suggestion
          ? { ...draft, suggestion: null, focus: "body" }
          : { ...draft, suggestion: ed.fromText(draft.selected), focus: "suggestion" },
      );
    }
    if (key.ctrl && input === "g") return editExternally();
    if (key.upArrow || key.downArrow) {
      const dir = key.upArrow ? -1 : 1;
      const field = draft.focus === "suggestion" && draft.suggestion ? draft.suggestion : draft.body;
      const moved = ed.vertical(field, dir);
      if (moved) return editField(() => moved);
      if (dir === 1 && draft.focus === "body" && draft.suggestion) return setDraft({ ...draft, focus: "suggestion" });
      if (dir === -1 && draft.focus === "suggestion") return setDraft({ ...draft, focus: "body" });
      return;
    }
    if (key.leftArrow) return editField(key.meta || key.ctrl ? ed.wordLeft : ed.left);
    if (key.rightArrow) return editField(key.meta || key.ctrl ? ed.wordRight : ed.right);
    if (key.home || (key.ctrl && input === "a")) return editField(ed.home);
    if (key.end || (key.ctrl && input === "e")) return editField(ed.end);
    if (key.backspace) return editField(key.meta ? ed.deleteWordBack : ed.backspace);
    if (key.delete) return editField(ed.deleteForward);
    if (key.ctrl && input === "u") return editField(ed.killToStart);
    if (key.ctrl && input === "k") return editField(ed.killToEnd);
    if (key.ctrl && input === "w") return editField(ed.deleteWordBack);
    if (key.meta && input === "b") return editField(ed.wordLeft);
    if (key.meta && input === "f") return editField(ed.wordRight);
    if (input && !key.ctrl && !key.meta) return editField((e) => ed.insert(e, input));
  });

  useInput((input, key) => {
    if (draft) return;

    if (overlay === "help") {
      setOverlay(null);
      return;
    }
    if (overlay && overlay.kind === "delete") {
      if (input === "y" || key.return) s.deleteComment(overlay.id);
      setOverlay(null);
      return;
    }
    if (overlay && overlay.kind === "refs") {
      const refs = repo ? repo.refs.filter((r) => r !== branchName) : [];
      if (key.escape || input === "q") return setOverlay(null);
      if (key.upArrow || input === "k") return setOverlay({ ...overlay, index: Math.max(0, overlay.index - 1) });
      if (key.downArrow || input === "j") return setOverlay({ ...overlay, index: Math.min(refs.length - 1, overlay.index + 1) });
      if (key.return && refs[overlay.index]) {
        s.setBaseRef(refs[overlay.index]);
        setOverlay(null);
      }
      return;
    }

    if (input === "q" || (key.ctrl && input === "c")) return void quit();
    if (input === "?") return setOverlay("help");
    if (!repo) return;

    if (key.escape) return setAnchor(null);
    if (input === "y" || input === "C") return void s.copyReview();
    if (input === "r") return void s.refresh();
    if (input === "s") {
      setAnchor(null);
      return s.setView(view === "unified" ? "split" : "unified");
    }
    if (input === "m") return s.setMode(branch.mode === "branch" ? "uncommitted" : "branch");
    if (input === "b") {
      const refs = repo.refs.filter((r) => r !== branchName);
      const base = diff?.baseRef ?? branch.baseRef ?? repo.defaultBase;
      return setOverlay({ kind: "refs", index: Math.max(0, refs.indexOf(base ?? "")) });
    }
    if (input === "t") return setShowTree(!showTree);
    if (input === "o") return setDraft(newDraft({ kind: "summary", title: "Overall notes", body: branch.summary }));
    if (key.rightArrow || input === "]") return jumpFile(1);
    if (key.leftArrow || input === "[") return jumpFile(-1);
    if (input === "n") return jumpComment(1);
    if (input === "p") return jumpComment(-1);
    if (!file) return;

    if (input === "v") return s.toggleViewed(file.path);
    if (input === "f") return startComment(null);

    const extend = key.shift && (key.upArrow || key.downArrow);
    if (extend && !anchor && here) setAnchor(here);
    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    if (key.pageUp || (key.ctrl && input === "u")) return moveLines(-Math.max(1, listH - 2));
    if (key.pageDown || (key.ctrl && input === "d")) return moveLines(Math.max(1, listH - 2));
    if (key.home || input === "g") return move(-blocks.length);
    if (key.end || input === "G") return move(blocks.length);
    if (view === "split" && key.tab) return setSide(side === "old" ? "new" : "old");
    if (input === " ") return setAnchor(anchor ? null : here);

    const stop = cursorBlock?.stop;
    const comment = stop?.kind === "comment" ? branch.comments.find((c) => c.id === stop.id) : undefined;
    if (comment) {
      if (input === "e" || input === "c" || key.return) return editComment(comment);
      if (input === "x") return s.setCommentStatus(comment.id, comment.status === "open" ? "resolved" : "open");
      if (input === "d" || key.backspace || key.delete) return setOverlay({ kind: "delete", id: comment.id });
      return;
    }
    if (stop?.kind === "gap" && (key.return || input === "c")) return s.reveal(file.path, [stop.from, stop.to]);
    if ((input === "c" || key.return) && here) {
      startComment(sel ?? { file: file.path, side: here.side, start: here.line, end: here.line });
    }
  });

  // ---- rendering ----

  const bar = (segs: Seg[], w = columns) => <Out line={fit(segs, w, theme.barBg)} />;

  const viewedCount = files.filter((f) => branch.viewed[f.path] === f.hash).length;
  const base = diff?.baseRef ?? branch.baseRef ?? repo?.defaultBase;
  const header: Seg[] = [
    { t: " Prelude ", fg: theme.accent, bold: true },
    { t: " " },
    { t: repo?.name ?? "", fg: theme.fg, bold: true },
    { t: "  " },
    { t: branchName, fg: theme.teal },
    { t: branch.mode === "branch" ? `  whole branch vs ${base ?? "?"}` : "  uncommitted only", fg: theme.muted },
    { t: `  ·  ${viewedCount}/${files.length} viewed  ·  `, fg: theme.faint },
    { t: `${exportCount} comment${exportCount === 1 ? "" : "s"} to copy`, fg: exportCount ? theme.accent : theme.faint },
    { t: loading ? "  ↻" : "", fg: theme.faint },
  ];

  const footer = (): Seg[] => {
    if (overlay && overlay !== "help" && overlay.kind === "delete") return [{ t: " Delete this comment? y to delete, any other key to keep", fg: theme.sev["must-fix"], bold: true }];
    if (toast) return [{ t: ` ${toast.message}`, fg: toast.kind === "error" ? theme.sev["must-fix"] : theme.addFg, bold: true }];
    const hints = draft
      ? draft.kind === "summary"
        ? "enter save · ctrl+j new line · ctrl+g $EDITOR · esc cancel"
        : "enter save · tab severity · ctrl+j new line · esc cancel"
      : cursorBlock?.stop?.kind === "comment"
        ? "e edit · x resolve · d delete · n/p next/prev comment · y copy review · ? help"
        : anchor
          ? "↑↓ extend selection · c comment on selection · esc clear"
          : "↑↓ move · space/shift+↑↓ select · c comment · f file comment · o overall · v viewed · ← → file · y copy review · ? help · q quit";
    return [{ t: ` ${hints}`, fg: theme.faint }];
  };

  // Pane header: the current file.
  const fileHead = (): Seg[] => {
    if (!file) return [{ t: "" }];
    const [letter, color] = STATUS[file.status];
    const viewed = branch.viewed[file.path] === file.hash;
    const open = fileComments.filter((c) => c.status === "open").length;
    const segs: Seg[] = [{ t: ` ${letter} `, fg: color, bold: true }];
    if (file.oldPath) segs.push({ t: `${file.oldPath} → `, fg: theme.muted });
    segs.push({ t: file.path, fg: theme.fg, bold: true });
    if (!file.binary && !file.tooLarge) segs.push({ t: `  +${file.additions}`, fg: theme.addFg }, { t: ` -${file.deletions}`, fg: theme.delFg });
    if (open) segs.push({ t: `  ${open} open`, fg: theme.accent });
    segs.push({ t: viewed ? "  ✓ viewed" : "", fg: theme.addFg });
    const pos = `${files.findIndex((f) => f.path === file.path) + 1}/${files.length} `;
    const used = segs.reduce((n, x) => n + textWidth(x.t), 0);
    segs.push({ t: " ".repeat(Math.max(1, paneW - used - pos.length)) }, { t: pos, fg: theme.faint });
    return segs;
  };

  const paneLines = (): Line[] => {
    const out: Line[] = [];
    const blank = (text = "", color = theme.muted) => out.push(fit([{ t: text ? `   ${text}` : "", fg: color }], paneW));

    if (overlay === "help") {
      const keys: [string, string][] = [
        ["↑ ↓  pgup pgdn  g G", "move the cursor"],
        ["space  /  shift+↑↓", "select a range of lines"],
        ["c  or  enter", "comment on the line or selection (enter on ⋯ shows hidden lines)"],
        ["f", "comment on the whole file"],
        ["o", "overall notes for the review"],
        ["e  x  d", "edit, resolve/reopen, delete the comment under the cursor"],
        ["n  p", "next / previous open comment"],
        ["← →  or  ] [", "previous / next file"],
        ["v", "mark the file viewed"],
        ["s", "unified / split view (tab switches sides in split)"],
        ["m", "whole branch / uncommitted only"],
        ["b", "change the base branch"],
        ["t", "show / hide the file list"],
        ["r", "refresh"],
        ["y", "copy the review and save it to .prelude/review.md"],
        ["q", "quit"],
        ["", ""],
        ["In a comment", "enter saves · ctrl+j or shift/alt+enter adds a line · tab changes severity"],
        ["", "ctrl+o suggests a change · ctrl+g opens $EDITOR · esc cancels"],
      ];
      blank();
      out.push(fit([{ t: "   Keys", fg: theme.accent, bold: true }], paneW));
      blank();
      for (const [k, d] of keys) out.push(fit([{ t: `   ${k.padEnd(24)}`, fg: theme.fg, bold: true }, { t: d, fg: theme.muted }], paneW));
      blank();
      blank("Press any key to close.", theme.faint);
      return out;
    }

    if (overlay && overlay.kind === "refs" && repo) {
      const refs = repo.refs.filter((r) => r !== branchName);
      blank();
      out.push(fit([{ t: "   Compare against", fg: theme.accent, bold: true }, { t: "   enter choose · esc cancel", fg: theme.faint }], paneW));
      blank();
      const first = Math.max(0, Math.min(overlay.index - Math.floor((listH - 4) / 2), refs.length - (listH - 4)));
      refs.slice(first, first + listH - 4).forEach((r, i) => {
        const on = first + i === overlay.index;
        const bg = on ? theme.cursorBg : undefined;
        out.push(fit([{ t: on ? " ▌ " : "   ", fg: theme.accent, bg }, { t: r, fg: r === base ? theme.teal : theme.fg, bold: on, bg }], paneW, bg));
      });
      return out;
    }

    if (draft?.kind === "summary") {
      blank();
      out.push(...draftLines(draft, paneW));
      return out;
    }

    if (openFailed) {
      blank();
      blank(`Couldn't open ${path}`, theme.sev["must-fix"]);
      blank("Prelude needs a git repository. Press q to quit.", theme.faint);
      return out;
    }
    if (error) {
      blank();
      for (const l of error.split("\n")) blank(l, theme.sev["must-fix"]);
      return out;
    }
    if (!diff) {
      blank();
      blank("Loading…");
      return out;
    }
    if (!file) {
      blank();
      blank(branch.mode === "branch" ? `No changes compared to ${base ?? "the base branch"}.` : "No uncommitted changes.");
      blank(branch.mode === "branch" ? "Press b to compare against another branch." : "Press m to review the whole branch.", theme.faint);
      return out;
    }

    let b = 0;
    while (b < blocks.length && offsets[b] + blocks[b].height <= top.current) b++;
    let skip = top.current - (offsets[b] ?? 0);
    for (; b < blocks.length && out.length < listH; b++) {
      const block = blocks[b];
      const lines = block.render({ cursor: b === ci && !draftAt, side, sel: shown, selSpan });
      for (const l of lines.slice(skip)) {
        if (out.length >= listH) break;
        out.push(l);
      }
      skip = 0;
    }
    return out;
  };

  const treeLines = (): Line[] => {
    const out: Line[] = [];
    const counts = new Map<string, number>();
    for (const c of branch.comments) if (c.status === "open") counts.set(c.file, (counts.get(c.file) ?? 0) + 1);
    const listRows = listH;
    const ai = Math.max(0, files.findIndex((f) => f.path === file?.path));
    const first = Math.max(0, Math.min(ai - Math.floor(listRows / 2), files.length - listRows));
    for (const f of files.slice(first, first + listRows)) {
      const active = f.path === file?.path;
      const bg = active ? theme.cursorBg : undefined;
      const [letter, color] = STATUS[f.status];
      const viewed = branch.viewed[f.path] === f.hash;
      const n = counts.get(f.path);
      const tail = `${n ? ` ${n}` : ""}${viewed ? " ✓" : ""} `;
      const room = treeW - 4 - tail.length;
      const p = textWidth(f.path) > room ? "…" + f.path.slice(-(room - 1)) : f.path;
      const slash = p.lastIndexOf("/");
      out.push(
        fit(
          [
            { t: active ? "▌" : " ", fg: theme.accent, bg },
            { t: `${letter} `, fg: color, bold: true, bg },
            { t: p.slice(0, slash + 1), fg: viewed ? theme.faint : theme.muted, bg },
            { t: p.slice(slash + 1), fg: viewed ? theme.faint : theme.fg, bold: active, bg },
            { t: " ".repeat(Math.max(0, room - textWidth(p))), bg },
            { t: n ? ` ${n}` : "", fg: theme.accent, bg },
            { t: viewed ? " ✓" : "", fg: theme.addFg, bg },
          ],
          treeW,
          bg,
        ),
      );
    }
    return out;
  };

  const pane = paneLines();
  while (pane.length < listH) pane.push([{ t: " ".repeat(paneW) }]);
  const tree = treeW ? treeLines() : [];
  while (tree.length < listH + 1) tree.push([{ t: " ".repeat(treeW) }]);
  const filesLabel: Seg[] = [{ t: ` ${files.length} file${files.length === 1 ? "" : "s"}`, fg: theme.muted, bold: true }];

  return (
    <Box flexDirection="column" width={columns} height={height}>
      {bar(header)}
      <Box flexDirection="row">
        {treeW > 0 && (
          <>
            <Box flexDirection="column" width={treeW}>
              <Out line={fit(filesLabel, treeW)} />
              {tree.slice(0, listH).map((l, i) => (
                <Out key={i} line={l} />
              ))}
            </Box>
            <Box flexDirection="column" width={1}>
              {Array.from({ length: listH + 1 }, (_, i) => (
                <Text key={i} color={theme.faint}>
                  │
                </Text>
              ))}
            </Box>
          </>
        )}
        <Box flexDirection="column" width={paneW}>
          <Out line={fit(fileHead(), paneW)} />
          {pane.slice(0, listH).map((l, i) => (
            <Out key={i} line={l} />
          ))}
        </Box>
      </Box>
      {bar([{ t: cut(footer()[0].t, columns), fg: footer()[0].fg, bold: footer()[0].bold }])}
    </Box>
  );
}

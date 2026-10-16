import { create } from "zustand";
import { platform } from "./platform";
import { locateAll, makeAnchor } from "./anchor";
import { buildReview, exportable } from "./output";
import type {
  BranchState,
  Comment,
  DiffMode,
  DiffResult,
  Location,
  PersistedState,
  RepoInfo,
  Selection,
  Severity,
} from "./types";

export type View = "unified" | "split";

export interface Composer {
  file: string;
  /** null = whole-file comment */
  sel: Selection | null;
  editingId: string | null;
}

interface Toast {
  id: number;
  message: string;
  kind: "ok" | "error";
}

export interface RecentRepo {
  root: string;
  name: string;
}

interface Store {
  repo: RepoInfo | null;
  diff: DiffResult | null;
  loading: boolean;
  error: string | null;
  persisted: PersistedState;
  branch: string;
  locations: Map<string, Location>;
  view: View;
  selection: Selection | null;
  composer: Composer | null;
  revealed: Record<string, [number, number][]>;
  openOverride: Record<string, boolean>;
  activeFile: string | null;
  toast: Toast | null;

  openRepo(path: string): Promise<void>;
  closeRepo(): void;
  refresh(): Promise<void>;
  setMode(mode: DiffMode): void;
  setBaseRef(ref: string): void;
  setView(view: View): void;
  setSelection(sel: Selection | null): void;
  openComposer(c: Composer): void;
  closeComposer(): void;
  saveComment(input: { body: string; severity: Severity; suggestion: string | null }): void;
  setCommentStatus(id: string, status: Comment["status"]): void;
  deleteComment(id: string): void;
  setSummary(text: string): void;
  toggleViewed(path: string): void;
  setFileOpen(path: string, open: boolean): void;
  reveal(path: string, range: [number, number]): void;
  setActiveFile(path: string | null): void;
  copyReview(): Promise<void>;
  notify(message: string, kind?: Toast["kind"]): void;
  /** Writes any pending state change now (e.g. before quitting). */
  flush(): Promise<void>;
}

const EMPTY_BRANCH: BranchState = { comments: [], summary: "", viewed: {}, mode: "branch", baseRef: null };

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = platform().storage.get(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    platform().storage.set(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; not critical */
  }
}

export function recentRepos(): RecentRepo[] {
  return readLocal<RecentRepo[]>("prelude.recent", []);
}

function rememberRepo(repo: RepoInfo) {
  const list = recentRepos().filter((r) => r.root !== repo.root);
  writeLocal("prelude.recent", [{ root: repo.root, name: repo.name }, ...list].slice(0, 8));
}

function parseState(json: string | null): PersistedState {
  if (!json) return { version: 1, branches: {} };
  try {
    const s = JSON.parse(json);
    if (s?.version === 1 && s.branches) return s;
  } catch {
    /* fall through to a fresh state */
  }
  return { version: 1, branches: {} };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let refreshing: Promise<void> | null = null;
let refreshQueued = false;
let toastId = 0;

export const useStore = create<Store>((set, get) => {
  const branchState = (): BranchState => get().persisted.branches[get().branch] ?? EMPTY_BRANCH;

  const saveNow = async () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const { repo, persisted } = get();
    if (!repo) return;
    const branches: Record<string, BranchState> = {};
    for (const [k, v] of Object.entries(persisted.branches)) {
      if (v.comments.length || v.summary || Object.keys(v.viewed).length || v.mode !== "branch" || v.baseRef) {
        branches[k] = v;
      }
    }
    await platform().api.saveState(repo.root, JSON.stringify({ version: 1, branches }, null, 2)).catch((e) =>
      get().notify(`Could not save review state: ${e}`, "error"),
    );
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  };

  const updateBranch = (fn: (b: BranchState) => BranchState) => {
    const { persisted, branch, diff } = get();
    const next = fn(persisted.branches[branch] ?? EMPTY_BRANCH);
    set({
      persisted: { ...persisted, branches: { ...persisted.branches, [branch]: next } },
      locations: locateAll(next.comments, diff?.files ?? []),
    });
    scheduleSave();
  };

  const doRefresh = async () => {
    const { repo } = get();
    if (!repo) return;
    const { mode, baseRef } = branchState();
    set({ loading: true });
    try {
      let diff = await platform().api.getDiff(repo.root, mode, baseRef);
      if (diff.branch !== get().branch) {
        // Branch switched under us: load that branch's settings and diff again.
        const next = get().persisted.branches[diff.branch] ?? EMPTY_BRANCH;
        set({ branch: diff.branch, selection: null, composer: null });
        if (next.mode !== mode || next.baseRef !== baseRef) {
          diff = await platform().api.getDiff(repo.root, next.mode, next.baseRef);
        }
      }
      if (get().repo?.root !== repo.root) return;
      const paths = new Set(diff.files.map((f) => f.path));
      const sel = get().selection;
      set({
        diff,
        error: null,
        loading: false,
        locations: locateAll(branchState().comments, diff.files),
        selection: sel && paths.has(sel.file) ? sel : null,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  };

  return {
    repo: null,
    diff: null,
    loading: false,
    error: null,
    persisted: { version: 1, branches: {} },
    branch: "",
    locations: new Map(),
    view: readLocal<View>("prelude.view", "unified"),
    selection: null,
    composer: null,
    revealed: {},
    openOverride: {},
    activeFile: null,
    toast: null,

    async openRepo(path) {
      try {
        const repo = await platform().api.openRepo(path);
        const persisted = parseState(await platform().api.loadState(repo.root));
        set({
          repo,
          persisted,
          branch: repo.branch,
          diff: null,
          error: null,
          selection: null,
          composer: null,
          revealed: {},
          openOverride: {},
          activeFile: null,
          locations: new Map(),
        });
        rememberRepo(repo);
        platform().setTitle(`${repo.name} — Prelude`);
        platform().api.watchRepo(repo.root).catch((e) => get().notify(`Live reload unavailable: ${e}`, "error"));
        await get().refresh();
      } catch (e) {
        get().notify(String(e), "error");
      }
    },

    closeRepo() {
      set({ repo: null, diff: null, error: null, selection: null, composer: null });
      platform().setTitle("Prelude");
    },

    async refresh() {
      if (refreshing) {
        refreshQueued = true;
        return refreshing;
      }
      refreshing = (async () => {
        do {
          refreshQueued = false;
          await doRefresh();
        } while (refreshQueued);
      })().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    setMode(mode) {
      updateBranch((b) => ({ ...b, mode }));
      get().refresh();
    },

    setBaseRef(baseRef) {
      updateBranch((b) => ({ ...b, baseRef, mode: "branch" }));
      get().refresh();
    },

    setView(view) {
      writeLocal("prelude.view", view);
      set({ view, selection: null });
    },

    setSelection(selection) {
      set({ selection, activeFile: selection?.file ?? get().activeFile });
    },

    openComposer(composer) {
      set({ composer, activeFile: composer.file });
    },

    closeComposer() {
      set({ composer: null, selection: null });
    },

    saveComment({ body, severity, suggestion }) {
      const { composer, diff } = get();
      if (!composer) return;
      const now = Date.now();
      if (composer.editingId) {
        const id = composer.editingId;
        updateBranch((b) => ({
          ...b,
          comments: b.comments.map((c) => (c.id === id ? { ...c, body, severity, suggestion, updatedAt: now } : c)),
        }));
      } else {
        const file = diff?.files.find((f) => f.path === composer.file);
        if (!file) return;
        const comment: Comment = {
          id: crypto.randomUUID(),
          file: composer.file,
          anchor: composer.sel ? makeAnchor(file, composer.sel) : null,
          body,
          severity,
          suggestion,
          status: "open",
          createdAt: now,
          updatedAt: now,
        };
        updateBranch((b) => ({ ...b, comments: [...b.comments, comment] }));
      }
      set({ composer: null, selection: null });
    },

    setCommentStatus(id, status) {
      updateBranch((b) => ({
        ...b,
        comments: b.comments.map((c) => (c.id === id ? { ...c, status, updatedAt: Date.now() } : c)),
      }));
    },

    deleteComment(id) {
      updateBranch((b) => ({ ...b, comments: b.comments.filter((c) => c.id !== id) }));
    },

    setSummary(summary) {
      updateBranch((b) => ({ ...b, summary }));
    },

    toggleViewed(path) {
      const file = get().diff?.files.find((f) => f.path === path);
      if (!file) return;
      const viewed = branchState().viewed[path] === file.hash;
      updateBranch((b) => {
        const next = { ...b.viewed };
        if (viewed) delete next[path];
        else next[path] = file.hash;
        return { ...b, viewed: next };
      });
      const openOverride = { ...get().openOverride };
      delete openOverride[path];
      set({ openOverride });
    },

    setFileOpen(path, open) {
      set({ openOverride: { ...get().openOverride, [path]: open } });
    },

    reveal(path, range) {
      const revealed = get().revealed;
      set({ revealed: { ...revealed, [path]: [...(revealed[path] ?? []), range] } });
    },

    setActiveFile(activeFile) {
      if (get().activeFile !== activeFile) set({ activeFile });
    },

    async copyReview() {
      const { repo, diff, locations } = get();
      if (!repo || !diff) return;
      const { comments, summary } = branchState();
      const count = exportable({ comments, locations }).length;
      if (!count && !summary.trim()) {
        get().notify("Nothing to copy yet — add a comment first.", "error");
        return;
      }
      const markdown = buildReview({ diff, comments, locations, summary });
      try {
        await platform().copyText(markdown);
        await platform().api.writeReview(repo.root, markdown);
        get().notify(`Copied ${count} comment${count === 1 ? "" : "s"} · saved to .prelude/review.md`);
      } catch (e) {
        get().notify(`Copy failed: ${e}`, "error");
      }
    },

    flush() {
      return saveTimer === undefined ? Promise.resolve() : saveNow();
    },

    notify(message, kind = "ok") {
      const id = ++toastId;
      set({ toast: { id, message, kind } });
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null });
      }, kind === "error" ? 6000 : 3200);
    },
  };
});

export function useBranchState(): BranchState {
  return useStore((s) => s.persisted.branches[s.branch] ?? EMPTY_BRANCH);
}

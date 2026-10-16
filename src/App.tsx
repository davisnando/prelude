import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { endDrag } from "./lib/drag";
import { useStore } from "./lib/store";
import { DiffPane } from "./components/DiffPane";
import { Header } from "./components/Header";
import { Sidebar, scrollToFile } from "./components/Sidebar";
import { pickRepo, Welcome } from "./components/Welcome";
import "./App.css";

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable);
}

function jumpComment(dir: 1 | -1) {
  const cards = [...document.querySelectorAll<HTMLElement>("article.comment:not(.comment-resolved)")];
  if (!cards.length) return;
  const mid = window.innerHeight / 3;
  const tops = cards.map((c) => c.getBoundingClientRect().top);
  let target = dir === 1 ? cards.find((_, i) => tops[i] > mid + 4) : [...cards].reverse().find((_, i, arr) => arr[i].getBoundingClientRect().top < mid - 4);
  target ??= dir === 1 ? cards[0] : cards[cards.length - 1];
  target.scrollIntoView({ block: "center", behavior: "smooth" });
}

function jumpFile(dir: 1 | -1) {
  const { diff, activeFile } = useStore.getState();
  const files = diff?.files ?? [];
  if (!files.length) return;
  const i = files.findIndex((f) => f.path === activeFile);
  const next = files[Math.min(files.length - 1, Math.max(0, i < 0 ? 0 : i + dir))];
  scrollToFile(next.path);
}

function onKey(e: KeyboardEvent) {
  const s = useStore.getState();
  if (e.metaKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    pickRepo();
    return;
  }
  if (!s.repo) return;
  if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "c") {
    e.preventDefault();
    s.copyReview();
    return;
  }
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case "j": return jumpFile(1);
    case "k": return jumpFile(-1);
    case "n": return jumpComment(1);
    case "p": return jumpComment(-1);
    case "r": s.refresh(); return;
    case "s": s.setView(s.view === "unified" ? "split" : "unified"); return;
    case "v": if (s.activeFile) s.toggleViewed(s.activeFile); return;
    case "c":
      e.preventDefault();
      if (s.selection) s.openComposer({ file: s.selection.file, sel: s.selection, editingId: null });
      else if (s.activeFile) s.openComposer({ file: s.activeFile, sel: null, editingId: null });
      return;
    case "Escape": if (s.composer || s.selection) s.closeComposer(); return;
  }
}

export default function App() {
  const repo = useStore((s) => s.repo);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    api.initialRepo().then((path) => {
      if (path) useStore.getState().openRepo(path);
    });
    const unlisten = listen("repo-changed", () => useStore.getState().refresh());
    const onFocus = () => useStore.getState().repo && useStore.getState().refresh();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("focus", onFocus);
    return () => {
      unlisten.then((f) => f());
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <>
      {repo ? (
        <div className="app">
          <Header />
          <div className="workspace">
            <Sidebar />
            <DiffPane />
          </div>
        </div>
      ) : (
        <Welcome />
      )}
      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status" key={toast.id}>
          {toast.message}
        </div>
      )}
    </>
  );
}

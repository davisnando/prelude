import { useMemo, useState } from "react";
import { useBranchState, useStore } from "../lib/store";
import type { FileDiff } from "../lib/types";
import { StatusBadge } from "./FileView";

interface Dir {
  name: string;
  path: string;
  dirs: Dir[];
  files: FileDiff[];
}

function buildTree(files: FileDiff[]): Dir {
  const root: Dir = { name: "", path: "", dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.find((d) => d.name === part);
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(f);
  }
  // Fold chains of single-child folders into one row: "src/lib/utils".
  const compact = (d: Dir): Dir => {
    let cur = { ...d, dirs: d.dirs.map(compact) };
    while (cur.dirs.length === 1 && cur.files.length === 0 && cur.name) {
      const only = cur.dirs[0];
      cur = { ...only, name: `${cur.name}/${only.name}` };
    }
    return cur;
  };
  return compact(root);
}

export function scrollToFile(path: string) {
  document.getElementById(`f-${path}`)?.scrollIntoView({ block: "start" });
  useStore.getState().setActiveFile(path);
}

export function Sidebar() {
  const diff = useStore((s) => s.diff);
  const activeFile = useStore((s) => s.activeFile);
  const branch = useBranchState();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const files = diff?.files ?? [];
  const tree = useMemo(() => buildTree(files), [files]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of branch.comments) if (c.status === "open") m.set(c.file, (m.get(c.file) ?? 0) + 1);
    return m;
  }, [branch.comments]);

  const viewedCount = files.filter((f) => branch.viewed[f.path] === f.hash).length;

  const toggle = (path: string) => {
    const next = new Set(closed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setClosed(next);
  };

  const renderDir = (d: Dir, depth: number) => (
    <>
      {d.dirs.map((sub) => (
        <li key={`d-${sub.path}`}>
          <button className="tree-dir" style={{ paddingLeft: 12 + depth * 12 }} onClick={() => toggle(sub.path)} aria-expanded={!closed.has(sub.path)}>
            <svg className={`tree-caret${closed.has(sub.path) ? "" : " open"}`} width="8" height="8" viewBox="0 0 10 10" aria-hidden>
              <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <span className="tree-name">{sub.name}</span>
          </button>
          {!closed.has(sub.path) && <ul>{renderDir(sub, depth + 1)}</ul>}
        </li>
      ))}
      {d.files.map((f) => {
        const name = f.path.split("/").pop();
        const viewed = branch.viewed[f.path] === f.hash;
        const n = counts.get(f.path);
        return (
          <li key={f.path}>
            <button
              className={`tree-file${activeFile === f.path ? " active" : ""}${viewed ? " is-viewed" : ""}`}
              style={{ paddingLeft: 12 + depth * 12 }}
              onClick={() => scrollToFile(f.path)}
              title={f.path}
            >
              <StatusBadge status={f.status} />
              <span className="tree-name">{name}</span>
              {n ? <span className="tree-count">{n}</span> : null}
              {viewed && <span className="tree-viewed" aria-label="Viewed">✓</span>}
            </button>
          </li>
        );
      })}
    </>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>{files.length} changed file{files.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="tree">{renderDir(tree, 0)}</ul>
      {files.length > 0 && (
        <div className="progress" title="Files marked as viewed">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(viewedCount / files.length) * 100}%` }} />
          </div>
          <span>
            {viewedCount} of {files.length} viewed
          </span>
        </div>
      )}
    </aside>
  );
}

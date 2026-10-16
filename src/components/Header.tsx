import { useMemo } from "react";
import { exportable } from "../lib/output";
import { useBranchState, useStore } from "../lib/store";

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: [T, string, string?][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text, title]) => (
        <button key={v} role="radio" aria-checked={value === v} title={title} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const repo = useStore((s) => s.repo)!;
  const diff = useStore((s) => s.diff);
  const loading = useStore((s) => s.loading);
  const view = useStore((s) => s.view);
  const locations = useStore((s) => s.locations);
  const branchName = useStore((s) => s.branch);
  const { setMode, setBaseRef, setView, copyReview, closeRepo, refresh } = useStore.getState();
  const branch = useBranchState();

  const count = useMemo(() => exportable({ comments: branch.comments, locations }).length, [branch.comments, locations]);
  const base = diff?.baseRef ?? branch.baseRef ?? repo.defaultBase ?? "";
  const refs = useMemo(() => {
    const list = repo.refs.filter((r) => r !== branchName);
    return base && !list.includes(base) ? [base, ...list] : list;
  }, [repo.refs, branchName, base]);

  return (
    <header className="topbar" data-tauri-drag-region>
      <button className="wordmark" onClick={closeRepo} title="Open another repository">
        Prelude
      </button>
      <div className="crumbs" data-tauri-drag-region>
        <span className="repo-name" title={repo.root}>{repo.name}</span>
        <span className="branch" title="Current branch">{branchName}</span>
        {branch.mode === "branch" && (
          <label className="base">
            <span>compared to</span>
            <select value={base} onChange={(e) => setBaseRef(e.target.value)}>
              {refs.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        <Segmented
          label="Changes to review"
          value={branch.mode}
          onChange={setMode}
          options={[
            ["branch", "Whole branch", "Everything since this branch split off, plus uncommitted work"],
            ["uncommitted", "Uncommitted", "Only changes not yet committed"],
          ]}
        />
      </div>
      <div className="topbar-right" data-tauri-drag-region>
        <button className={`icon-btn${loading ? " spinning" : ""}`} onClick={() => refresh()} title="Refresh (R)" aria-label="Refresh">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Segmented
          label="Diff layout"
          value={view}
          onChange={setView}
          options={[
            ["unified", "Unified", "One column (S to switch)"],
            ["split", "Split", "Side by side (S to switch)"],
          ]}
        />
        <button className="btn btn-primary copy" onClick={copyReview} title="Copy review for your agent (⌘⇧C)">
          Copy review
          <span className="copy-count">{count}</span>
        </button>
      </div>
    </header>
  );
}

import { useEffect, useMemo, useRef } from "react";
import { numbering } from "../lib/output";
import { useBranchState, useStore } from "../lib/store";
import { CommentCard } from "./Comment";
import { FileView } from "./FileView";

function Summary() {
  const branch = useBranchState();
  const setSummary = useStore((s) => s.setSummary);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [branch.summary]);

  return (
    <section className="summary">
      <label htmlFor="summary" className="summary-label">Overall notes</label>
      <textarea
        id="summary"
        ref={ref}
        rows={2}
        placeholder="Anything that applies to the whole change: missing tests, the approach, what to leave alone…"
        value={branch.summary}
        onChange={(e) => setSummary(e.target.value)}
      />
    </section>
  );
}

export function DiffPane() {
  const diff = useStore((s) => s.diff);
  const error = useStore((s) => s.error);
  const locations = useStore((s) => s.locations);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const branch = useBranchState();
  const scroller = useRef<HTMLDivElement>(null);

  const numbers = useMemo(
    () => (diff ? numbering(diff, branch.comments, locations) : new Map<string, number>()),
    [diff, branch.comments, locations],
  );

  // Comments on files that are no longer part of the diff (reverted, or out of scope after switching mode).
  const orphans = useMemo(() => {
    const paths = new Set(diff?.files.map((f) => f.path));
    return branch.comments.filter((c) => !paths.has(c.file));
  }, [diff, branch.comments]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + 8;
        let current: string | null = null;
        for (const s of el.querySelectorAll<HTMLElement>("section.file")) {
          if (s.getBoundingClientRect().top <= top) current = s.dataset.path ?? null;
          else break;
        }
        setActiveFile(current ?? diff?.files[0]?.path ?? null);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [diff, setActiveFile]);

  if (error) {
    return (
      <main className="pane pane-empty">
        <div className="empty">
          <h2>Couldn’t read the changes</h2>
          <pre className="error-text">{error}</pre>
          <button className="btn btn-quiet" onClick={() => useStore.getState().refresh()}>Try again</button>
        </div>
      </main>
    );
  }
  if (!diff) {
    return <main className="pane pane-empty"><div className="empty"><p className="muted">Reading changes…</p></div></main>;
  }

  return (
    <main className="pane" ref={scroller}>
      <Summary />
      {orphans.length > 0 && (
        <section className="orphans">
          <h3>Comments on files that no longer have changes</h3>
          {orphans.map((c) => (
            <div key={c.id}>
              <div className="orphan-path">{c.file}</div>
              <CommentCard comment={c} location={{ kind: "outdated" }} number={undefined} />
            </div>
          ))}
        </section>
      )}
      {diff.files.length === 0 ? (
        <div className="empty">
          <h2>No changes to review</h2>
          <p className="muted">
            {diff.baseRef
              ? `This branch has nothing that isn’t already on ${diff.baseRef}. Changes show up here as soon as files change.`
              : "There are no uncommitted changes. Changes show up here as soon as files change."}
          </p>
        </div>
      ) : (
        diff.files.map((f) => <FileView key={f.path} file={f} numbers={numbers} locations={locations} />)
      )}
    </main>
  );
}

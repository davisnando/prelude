import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { SEVERITIES, type Comment, type Location, type Severity } from "../lib/types";

const SEVERITY_LABEL: Record<Severity, string> = {
  "must-fix": "Must fix",
  suggestion: "Suggestion",
  question: "Question",
  nit: "Nit",
};

export function lineLabel(loc: Location | undefined): string {
  if (!loc || loc.kind === "file") return "Whole file";
  if (loc.kind === "outdated") return "Outdated";
  const r = loc.start === loc.end ? `Line ${loc.start}` : `Lines ${loc.start}–${loc.end}`;
  return loc.side === "old" ? `${r} (removed)` : r;
}

/** The boxed number a comment gets in the copied review, like a rehearsal mark in a score. */
export function Mark({ n, muted }: { n?: number; muted?: boolean }) {
  return (
    <span className={`mark${muted || n === undefined ? " mark-muted" : ""}`} aria-label={n ? `Item ${n}` : undefined}>
      {n ?? "–"}
    </span>
  );
}

interface CardProps {
  comment: Comment;
  location: Location | undefined;
  number: number | undefined;
}

export function CommentCard({ comment, location, number }: CardProps) {
  const setStatus = useStore((s) => s.setCommentStatus);
  const remove = useStore((s) => s.deleteComment);
  const openComposer = useStore((s) => s.openComposer);
  const [expanded, setExpanded] = useState(false);
  const resolved = comment.status === "resolved";
  const outdated = location?.kind === "outdated";

  const edit = () =>
    openComposer({
      file: comment.file,
      sel: location?.kind === "line" ? { file: comment.file, side: location.side, start: location.start, end: location.end } : null,
      editingId: comment.id,
    });

  if (resolved && !expanded) {
    return (
      <div className="comment comment-resolved" id={`c-${comment.id}`}>
        <button className="comment-collapsed" onClick={() => setExpanded(true)}>
          <span className="check-glyph" aria-hidden>✓</span>
          <span className="comment-collapsed-text">{comment.body.split("\n")[0]}</span>
          <span className="comment-collapsed-meta">Resolved</span>
        </button>
      </div>
    );
  }

  return (
    <article className={`comment sev-${comment.severity}${resolved ? " comment-resolved" : ""}`} id={`c-${comment.id}`}>
      <header className="comment-head">
        <Mark n={number} muted={resolved || outdated} />
        <span className={`sev sev-${comment.severity}`}>{SEVERITY_LABEL[comment.severity]}</span>
        <span className="comment-where">
          {lineLabel(location)}
          {location?.kind === "line" && location.moved && <span className="hint"> · moved with its code</span>}
        </span>
        <span className="spacer" />
        <button className="link" onClick={edit}>Edit</button>
        <button className="link" onClick={() => setStatus(comment.id, resolved ? "open" : "resolved")}>
          {resolved ? "Reopen" : "Resolve"}
        </button>
        <button className="link link-danger" onClick={() => remove(comment.id)}>Delete</button>
        {resolved && (
          <button className="link" onClick={() => setExpanded(false)}>Collapse</button>
        )}
      </header>
      {outdated && comment.anchor && (
        <div className="outdated-note">
          <p>The code this comment pointed at has changed, so it’s left out of the copied review. Resolve it if the change addressed it, or delete it.</p>
          <pre className="snippet">{comment.anchor.lines.join("\n")}</pre>
        </div>
      )}
      <div className="comment-body">{comment.body}</div>
      {comment.suggestion !== null && (
        <div className="suggestion">
          <div className="suggestion-label">Suggested change</div>
          <pre className="snippet">{comment.suggestion || " "}</pre>
        </div>
      )}
    </article>
  );
}

interface ComposerProps {
  initial?: Comment;
  /** Lines under the selection, used to prefill a suggested change. */
  selectedText: string | null;
}

export function Composer({ initial, selectedText }: ComposerProps) {
  const save = useStore((s) => s.saveComment);
  const close = useStore((s) => s.closeComposer);
  const composer = useStore((s) => s.composer);
  const [body, setBody] = useState(initial?.body ?? "");
  const [severity, setSeverity] = useState<Severity>(initial?.severity ?? "suggestion");
  const [suggestion, setSuggestion] = useState<string | null>(initial?.suggestion ?? null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const isLine = !!composer?.sel;

  useEffect(() => {
    textRef.current?.focus();
    textRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const submit = () => {
    if (!body.trim() && suggestion === null) return;
    save({ body: body.trim(), severity, suggestion });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="composer" onKeyDown={onKey}>
      <div className="composer-sev" role="radiogroup" aria-label="Severity">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={severity === s}
            className={`sev-choice sev-${s}${severity === s ? " on" : ""}`}
            onClick={() => setSeverity(s)}
          >
            {SEVERITY_LABEL[s]}
          </button>
        ))}
      </div>
      <textarea
        ref={textRef}
        className="composer-text"
        placeholder={isLine ? "What should the agent change here?" : "What should the agent change in this file?"}
        value={body}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
      />
      {suggestion !== null && (
        <div className="suggestion suggestion-edit">
          <div className="suggestion-label">
            Suggested change
            <button className="link" onClick={() => setSuggestion(null)}>Remove</button>
          </div>
          <textarea
            className="composer-code"
            value={suggestion}
            spellCheck={false}
            rows={Math.min(14, Math.max(2, suggestion.split("\n").length + 1))}
            onChange={(e) => setSuggestion(e.target.value)}
          />
        </div>
      )}
      <div className="composer-actions">
        {isLine && suggestion === null && (
          <button className="btn btn-quiet" onClick={() => setSuggestion(selectedText ?? "")}>
            Suggest a change
          </button>
        )}
        <span className="spacer" />
        <span className="kbd-hint">⌘↩ to save · esc to cancel</span>
        <button className="btn btn-quiet" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!body.trim() && suggestion === null}>
          {initial ? "Save changes" : "Add comment"}
        </button>
      </div>
    </div>
  );
}

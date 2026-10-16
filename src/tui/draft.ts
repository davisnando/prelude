import { SEVERITIES, type Severity } from "../lib/types";
import { SEVERITY_LABEL } from "./blocks";
import { fromText, renderEditor, type Editor } from "./editor";
import { fit, type Line, type Seg } from "./text";
import { theme } from "./theme";

/** A comment (or the overall notes) being written. */
export interface Draft {
  kind: "comment" | "summary";
  title: string;
  body: Editor;
  severity: Severity;
  /** null = no suggested change */
  suggestion: Editor | null;
  focus: "body" | "suggestion";
  /** Lines under the selection, to prefill a suggested change; null when suggestions don't apply. */
  selected: string | null;
}

export function newDraft(init: Partial<Pick<Draft, "kind" | "severity" | "selected">> & { title: string; body?: string; suggestion?: string | null }): Draft {
  return {
    kind: init.kind ?? "comment",
    title: init.title,
    body: fromText(init.body ?? ""),
    severity: init.severity ?? "suggestion",
    suggestion: init.suggestion == null ? null : fromText(init.suggestion),
    focus: "body",
    selected: init.selected ?? null,
  };
}

export function draftLines(d: Draft, w: number): Line[] {
  const inner = w - 4;
  const bar: Seg[] = [{ t: " " }, { t: " ┃ ", fg: theme.teal }];
  const row = (segs: Seg[]) => fit([...bar, ...segs], w);
  const out: Line[] = [row([{ t: d.title, fg: theme.teal, bold: true }])];

  if (d.kind === "comment") {
    const chips: Seg[] = [];
    for (const s of SEVERITIES) {
      const on = s === d.severity;
      chips.push({ t: on ? "● " : "○ ", fg: on ? theme.sev[s] : theme.faint }, { t: SEVERITY_LABEL[s], fg: on ? theme.sev[s] : theme.muted, bold: on }, { t: "  " });
    }
    chips.push({ t: "tab", fg: theme.faint, italic: true });
    out.push(row(chips));
  }

  const placeholder = d.kind === "summary" ? "Notes about the review as a whole" : "What should the agent change here?";
  for (const l of renderEditor(d.body, inner, d.focus === "body", placeholder)) out.push(row(l));

  if (d.suggestion) {
    out.push(row([{ t: "Suggested change", fg: theme.muted, bold: true }]));
    for (const l of renderEditor(d.suggestion, inner - 1, d.focus === "suggestion", "Replacement code")) {
      out.push(row([{ t: " " }, ...fit(l, inner - 1, theme.codeBg)]));
    }
  }

  const hints = ["enter save", "ctrl+j new line"];
  if (d.kind === "comment" && d.selected !== null) hints.push(d.suggestion ? "ctrl+o remove suggestion" : "ctrl+o suggest a change");
  hints.push("ctrl+g $EDITOR", "esc cancel");
  out.push(row([{ t: hints.join(" · "), fg: theme.faint, italic: true }]));
  return out;
}

import { rowSpan } from "./anchor";
import { fenceFor } from "./lang";
import { SEVERITIES, type Comment, type DiffResult, type FileDiff, type Location, type Severity } from "./types";

const PLURAL: Record<Severity, string> = {
  "must-fix": "must-fix",
  suggestion: "suggestions",
  question: "questions",
  nit: "nits",
};

function fence(body: string, lang = ""): string {
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

function range(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-${end}`;
}

function snippet(file: FileDiff, loc: Extract<Location, { kind: "line" }>): string {
  const span = rowSpan(file.rows, loc.side, loc.start, loc.end);
  if (!span) return "";
  const lines: string[] = [];
  for (let i = span[0]; i <= span[1]; i++) {
    const r = file.rows[i];
    lines.push((r.k === "a" ? "+" : r.k === "d" ? "-" : " ") + r.t);
  }
  return lines.join("\n");
}

export interface ReviewInput {
  diff: DiffResult;
  comments: Comment[];
  locations: Map<string, Location>;
  summary: string;
}

/** Comments that go into the output: open and still pointing at existing code. */
export function exportable({ comments, locations }: Pick<ReviewInput, "comments" | "locations">): Comment[] {
  return comments.filter((c) => c.status === "open" && locations.get(c.id)?.kind !== "outdated");
}

/** Exportable comments grouped by file in diff order; must-fix first within a file, then by line. */
export function ordered(
  diff: DiffResult,
  comments: Comment[],
  locations: Map<string, Location>,
): { path: string; comments: Comment[] }[] {
  const order = new Map(diff.files.map((f, i) => [f.path, i]));
  const byFile = new Map<string, Comment[]>();
  for (const c of exportable({ comments, locations })) {
    if (!byFile.has(c.file)) byFile.set(c.file, []);
    byFile.get(c.file)!.push(c);
  }
  const line = (c: Comment) => {
    const l = locations.get(c.id);
    return l?.kind === "line" ? l.start : 0;
  };
  return [...byFile.keys()]
    .sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b))
    .map((path) => ({
      path,
      comments: byFile
        .get(path)!
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || line(a) - line(b)),
    }));
}

/** Comment id -> the number it gets in the copied review. */
export function numbering(diff: DiffResult, comments: Comment[], locations: Map<string, Location>): Map<string, number> {
  const out = new Map<string, number>();
  for (const group of ordered(diff, comments, locations)) for (const c of group.comments) out.set(c.id, out.size + 1);
  return out;
}

export function buildReview(input: ReviewInput): string {
  const { diff, locations } = input;
  const files = new Map(diff.files.map((f) => [f.path, f]));
  const groups = ordered(diff, input.comments, locations);
  const comments = groups.flatMap((g) => g.comments);
  const summary = input.summary.trim();

  const counts = SEVERITIES.map((s) => [s, comments.filter((c) => c.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${n === 1 && s !== "must-fix" ? s : PLURAL[s]}`);
  const total = comments.length;
  const out: string[] = [];
  out.push(`# Pre-review: ${total} comment${total === 1 ? "" : "s"}${counts.length ? ` (${counts.join(", ")})` : ""}`);
  out.push("");
  const scope = diff.baseRef
    ? `the changes on \`${diff.branch}\` compared to \`${diff.baseRef}\`, including uncommitted work`
    : `the uncommitted changes on \`${diff.branch}\``;
  out.push(
    `This is a review of ${scope}. Address every item below. Line numbers refer to the current working tree ` +
      `unless marked "removed". Treat **must-fix** as required, use judgment on **suggestion** and **nit**, ` +
      `and answer each **question** before changing that code. Apply suggested changes as written unless they are wrong.`,
  );

  if (summary) {
    out.push("", "## Overall", "", summary);
  }

  let n = 0;
  for (const { path, comments: list } of groups) {
    const file = files.get(path);
    out.push("", `## \`${path}\``);
    for (const c of list) {
      n++;
      const loc = locations.get(c.id)!;
      let where = "whole file";
      if (loc.kind === "line") where = range(loc.start, loc.end) + (loc.side === "old" ? " (removed lines)" : "");
      out.push("", `### ${n}. [${c.severity}] ${where}`);
      if (loc.kind === "line" && file) {
        const code = snippet(file, loc);
        if (code) out.push("", fence(code, "diff"));
      }
      out.push("", c.body.trim());
      if (c.suggestion !== null && loc.kind === "line") {
        out.push("", `**Suggested change** (replace ${range(loc.start, loc.end)}):`, "", fence(c.suggestion, fenceFor(path)));
      }
    }
  }

  return out.join("\n") + "\n";
}

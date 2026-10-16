export type RowKind = "c" | "a" | "d";

/** One line of the full-file alignment: kind, old line no, new line no (0 = none), text. */
export interface Row {
  k: RowKind;
  o: number;
  n: number;
  t: string;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  tooLarge: boolean;
  additions: number;
  deletions: number;
  hash: string;
  rows: Row[];
}

export interface DiffResult {
  branch: string;
  baseRef: string | null;
  baseCommit: string;
  files: FileDiff[];
}

export interface RepoInfo {
  root: string;
  name: string;
  branch: string;
  defaultBase: string | null;
  refs: string[];
}

export type DiffMode = "branch" | "uncommitted";
export type Side = "old" | "new";
export type Severity = "must-fix" | "suggestion" | "question" | "nit";
export const SEVERITIES: Severity[] = ["must-fix", "suggestion", "question", "nit"];

/** Where a line comment points, plus a snapshot used to re-find it after edits. */
export interface Anchor {
  side: Side;
  start: number;
  end: number;
  lines: string[];
  before: string[];
  after: string[];
}

export interface Comment {
  id: string;
  file: string;
  /** null = whole-file comment */
  anchor: Anchor | null;
  body: string;
  severity: Severity;
  suggestion: string | null;
  status: "open" | "resolved";
  createdAt: number;
  updatedAt: number;
}

export interface BranchState {
  comments: Comment[];
  summary: string;
  /** file path -> content hash at the time it was marked viewed */
  viewed: Record<string, string>;
  mode: DiffMode;
  baseRef: string | null;
}

export interface PersistedState {
  version: 1;
  branches: Record<string, BranchState>;
}

export interface Selection {
  file: string;
  side: Side;
  start: number;
  end: number;
}

/** Where a comment currently sits in the diff. */
export type Location =
  | { kind: "file" }
  | { kind: "line"; side: Side; start: number; end: number; moved: boolean }
  | { kind: "outdated" };

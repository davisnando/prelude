import type { DiffMode, DiffResult, RepoInfo } from "./types";

/** The backend commands the store needs; served by Tauri in the app and by `prelude --core` in the terminal. */
export interface Backend {
  openRepo(path: string): Promise<RepoInfo>;
  getDiff(root: string, mode: DiffMode, baseRef: string | null): Promise<DiffResult>;
  loadState(root: string): Promise<string | null>;
  saveState(root: string, json: string): Promise<void>;
  writeReview(root: string, markdown: string): Promise<string>;
  watchRepo(root: string): Promise<void>;
}

export interface Platform {
  api: Backend;
  copyText(text: string): Promise<void>;
  setTitle(title: string): void;
  /** Small per-user preferences (recent repos, view). */
  storage: { get(key: string): string | null; set(key: string, value: string): void };
}

let current: Platform | undefined;

/** Call before the store is imported, i.e. from a module the entry point imports first. */
export function setPlatform(p: Platform) {
  current = p;
}

export function platform(): Platform {
  if (!current) throw new Error("platform not set");
  return current;
}

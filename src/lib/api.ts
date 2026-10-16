import { invoke } from "@tauri-apps/api/core";
import type { DiffMode, DiffResult, RepoInfo } from "./types";

export const api = {
  initialRepo: () => invoke<string | null>("initial_repo"),
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  getDiff: (root: string, mode: DiffMode, baseRef: string | null) =>
    invoke<DiffResult>("get_diff", { root, mode, baseRef }),
  loadState: (root: string) => invoke<string | null>("load_state", { root }),
  saveState: (root: string, json: string) => invoke<void>("save_state", { root, json }),
  writeReview: (root: string, markdown: string) => invoke<string>("write_review", { root, markdown }),
  watchRepo: (root: string) => invoke<void>("watch_repo", { root }),
};

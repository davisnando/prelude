import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Backend } from "../lib/platform";

/** The Prelude binary, which serves the backend with `--core` (see src-tauri/src/headless.rs). */
export function coreBinary(): string {
  return process.env.PRELUDE_CORE ?? "/Applications/Prelude.app/Contents/MacOS/prelude";
}

export interface Core {
  api: Backend;
  onChange(fn: () => void): void;
  stop(): void;
}

export function startCore(bin = coreBinary()): Core {
  if (!existsSync(bin)) throw new Error(`Prelude backend not found at ${bin} (set PRELUDE_CORE to the prelude binary)`);
  const child = spawn(bin, ["--core"], { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  const listeners: (() => void)[] = [];
  let nextId = 1;
  let dead: Error | null = null;

  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg: { id?: number; ok?: unknown; err?: string; event?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event === "repo-changed") {
      for (const fn of listeners) fn();
      return;
    }
    const p = msg.id != null ? pending.get(msg.id) : undefined;
    if (!p) return;
    pending.delete(msg.id!);
    if (msg.err !== undefined) p.reject(new Error(msg.err));
    else p.resolve(msg.ok ?? null);
  });

  const fail = (e: Error) => {
    dead = e;
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code) => fail(new Error(`Prelude backend exited (${code ?? "signal"})`)));

  const call = <T>(cmd: string, args: Record<string, unknown>) =>
    new Promise<T>((resolve, reject) => {
      if (dead) return reject(dead);
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      child.stdin.write(JSON.stringify({ id, cmd, ...args }) + "\n");
    });

  return {
    api: {
      openRepo: (path) => call("open_repo", { path }),
      getDiff: (root, mode, baseRef) => call("get_diff", { root, mode, baseRef }),
      loadState: (root) => call("load_state", { root }),
      saveState: (root, json) => call("save_state", { root, json }),
      writeReview: (root, markdown) => call("write_review", { root, markdown }),
      watchRepo: (root) => call("watch_repo", { root }),
    },
    onChange: (fn) => listeners.push(fn),
    stop: () => child.kill(),
  };
}

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setPlatform } from "../lib/platform";
import { startCore, type Core } from "./backend";

const settingsPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "prelude", "tui.json");
let settings: Record<string, string> = {};
try {
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
} catch {
  /* first run */
}

function pipeTo(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
    child.stdin.end(text);
  });
}

/** System clipboard if a tool is available; otherwise OSC 52, which most terminals (and ssh) pass through. */
async function copyText(text: string): Promise<void> {
  const tools: [string, string[]][] =
    process.platform === "darwin" ? [["pbcopy", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["-ib"]]];
  for (const [cmd, args] of tools) if (await pipeTo(cmd, args, text)) return;
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
}

/** Starts the backend and installs the terminal platform. Must run before the store is imported. */
export function initPlatform(): Core {
  const core = startCore();
  setPlatform({
    api: core.api,
    copyText,
    setTitle: (title) => process.stdout.write(`\x1b]0;${title.replace(/[\x00-\x1f]/g, "")}\x07`),
    storage: {
      get: (key) => settings[key] ?? null,
      set: (key, value) => {
        settings[key] = value;
        try {
          mkdirSync(dirname(settingsPath), { recursive: true });
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        } catch {
          /* preferences only */
        }
      },
    },
  });
  return core;
}

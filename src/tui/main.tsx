// Prelude in the terminal: `prelude --tui [path]`.
import { resolve } from "node:path";
import { render } from "ink";
import { initPlatform } from "./platform-node";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("prelude: the terminal UI needs an interactive terminal");
  process.exit(1);
}

const path = resolve(process.argv[2] ?? ".");

let core;
try {
  core = initPlatform();
} catch (e) {
  console.error(`prelude: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

// The store reads preferences when it loads, so import it only once the platform is set.
const [{ App }, { useStore }] = await Promise.all([import("./App"), import("../lib/store")]);
core.onChange(() => useStore.getState().refresh());

const app = render(<App path={path} />, { alternateScreen: true, exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } });
process.on("SIGINT", async () => {
  await useStore.getState().flush();
  app.unmount();
});
await app.waitUntilExit();
core.stop();
process.exit(0);

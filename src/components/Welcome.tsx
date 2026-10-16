import { open } from "@tauri-apps/plugin-dialog";
import { recentRepos, useStore } from "../lib/store";

export async function pickRepo() {
  const dir = await open({ directory: true, multiple: false, title: "Open a git repository" });
  if (typeof dir === "string") await useStore.getState().openRepo(dir);
}

export function Welcome() {
  const openRepo = useStore((s) => s.openRepo);
  const recent = recentRepos();

  return (
    <div className="welcome" data-tauri-drag-region>
      <div className="welcome-inner">
        <h1 className="welcome-mark">Prelude</h1>
        <p className="welcome-lede">
          Review what your agent changed, line by line, the way you would a pull request. Then hand the notes back
          before anyone else sees the code.
        </p>
        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={pickRepo}>Open repository…</button>
          <span className="kbd-hint">⌘O</span>
        </div>

        {recent.length > 0 && (
          <section className="recent">
            <h2>Recent</h2>
            <ul>
              {recent.map((r) => (
                <li key={r.root}>
                  <button onClick={() => openRepo(r.root)}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-path">{r.root}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="welcome-cli">
          From a terminal, run <code>prelude .</code> inside any repository.
        </p>
      </div>
    </div>
  );
}

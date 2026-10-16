import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { langFor } from "./lang";

export type Tokens = ThemedToken[][];

const MAX_LINES = 6000;
let highlighter: Promise<Highlighter> | null = null;
const loaded = new Set<string>();
const failed = new Set<string>();
const cache = new Map<string, Promise<Tokens | null>>();

function get(): Promise<Highlighter> {
  highlighter ??= createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

async function tokenize(text: string, lang: string): Promise<Tokens | null> {
  const h = await get();
  if (!loaded.has(lang)) {
    if (failed.has(lang)) return null;
    try {
      await h.loadLanguage(lang as never);
      loaded.add(lang);
    } catch {
      failed.add(lang);
      return null;
    }
  }
  const { tokens } = h.codeToTokens(text, {
    lang: lang as never,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
  return tokens;
}

/** Tokens per line (index = line number - 1), or null when not highlightable. */
export function highlight(path: string, key: string, lines: string[]): Promise<Tokens | null> {
  const lang = langFor(path);
  if (!lang || lines.length === 0 || lines.length > MAX_LINES) return Promise.resolve(null);
  const k = `${path}\0${key}`;
  if (!cache.has(k)) {
    if (cache.size > 400) cache.clear();
    cache.set(k, tokenize(lines.join("\n"), lang).catch(() => null));
  }
  return cache.get(k)!;
}

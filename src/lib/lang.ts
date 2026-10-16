const EXT: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "jsonc", json5: "json5",
  md: "markdown", mdx: "mdx", markdown: "markdown",
  css: "css", scss: "scss", sass: "sass", less: "less",
  html: "html", htm: "html", vue: "vue", svelte: "svelte", astro: "astro",
  py: "python", pyi: "python", rb: "ruby", rs: "rust", go: "go",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", fs: "fsharp", php: "php", dart: "dart", lua: "lua", zig: "zig",
  ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", clj: "clojure",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", fish: "fish", ps1: "powershell",
  yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", xml: "xml", svg: "xml",
  sql: "sql", graphql: "graphql", gql: "graphql", prisma: "prisma", proto: "proto",
  tf: "terraform", hcl: "hcl", nix: "nix", r: "r", jl: "julia", ml: "ocaml",
  dockerfile: "docker", make: "make", mk: "make", cmake: "cmake", diff: "diff",
};

const NAMES: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  justfile: "just",
};

/** Shiki language id for a path, or null for plain text. */
export function langFor(path: string): string | null {
  const name = path.split("/").pop()!.toLowerCase();
  if (NAMES[name]) return NAMES[name];
  if (name.startsWith("dockerfile")) return "docker";
  if (name.startsWith(".env")) return "dotenv";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return EXT[ext] ?? null;
}

/** Short fence tag for markdown code blocks. */
export function fenceFor(path: string): string {
  const name = path.split("/").pop()!.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return ext || langFor(path) || "";
}

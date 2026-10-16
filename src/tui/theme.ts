import type { Severity } from "../lib/types";

export interface Theme {
  dark: boolean;
  fg: string;
  muted: string;
  faint: string;
  accent: string;
  teal: string;
  addFg: string;
  delFg: string;
  addBg: string;
  delBg: string;
  cursorBg: string;
  selBg: string;
  codeBg: string;
  barBg: string;
  sev: Record<Severity, string>;
}

const dark: Theme = {
  dark: true,
  fg: "#e6e8ee",
  muted: "#a3a9b7",
  faint: "#6f7584",
  accent: "#d9a441",
  teal: "#1FB5C9",
  addFg: "#6fcf97",
  delFg: "#f08a86",
  addBg: "#16291f",
  delBg: "#2f191b",
  cursorBg: "#2a2e38",
  selBg: "#3a3220",
  codeBg: "#1f232b",
  barBg: "#1b1e25",
  sev: { "must-fix": "#f0716b", suggestion: "#d9a441", question: "#74a7e8", nit: "#8f95a3" },
};

const light: Theme = {
  dark: false,
  fg: "#1a1d26",
  muted: "#555b6b",
  faint: "#868c9b",
  accent: "#a8751b",
  teal: "#0f8a9b",
  addFg: "#1d7542",
  delFg: "#b13b39",
  addBg: "#e3f4e8",
  delBg: "#fbe7e6",
  cursorBg: "#e8eaef",
  selBg: "#f6ead2",
  codeBg: "#eef0f4",
  barBg: "#eef0f4",
  sev: { "must-fix": "#b6342f", suggestion: "#a8751b", question: "#2d66ad", nit: "#7a7f8c" },
};

/** Dark unless PRELUDE_THEME=light, or the terminal reports a light background through COLORFGBG. */
function pick(): Theme {
  const env = process.env.PRELUDE_THEME;
  if (env === "light") return light;
  if (env === "dark") return dark;
  const bg = Number(process.env.COLORFGBG?.split(";").pop());
  return bg === 7 || bg === 15 ? light : dark;
}

export const theme = pick();

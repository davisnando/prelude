import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { setPlatform } from "./platform";

setPlatform({
  api,
  copyText: writeText,
  setTitle: (title) => {
    getCurrentWindow().setTitle(title).catch(() => {});
  },
  storage: {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
  },
});

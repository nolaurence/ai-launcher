import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LauncherSettings } from "./types.js";

const defaultSettings: LauncherSettings = {
  clipboardMaxItems: 1000,
  shortcuts: {
    launcher: "Alt+Space",
    clipboard: "CommandOrControl+Shift+V"
  },
  piCoding: {
    webUrl: "http://127.0.0.1:31415",
    apiBaseUrl: "http://127.0.0.1:31415/api",
    command: ""
  },
  skills: [
    { id: "coding", name: "Coding Agent", enabled: true },
    { id: "browser", name: "Web UI", enabled: true }
  ]
};

const settingsPath = (): string => join(app.getPath("userData"), "settings.json");

export function readSettings(): LauncherSettings {
  const path = settingsPath();
  if (!existsSync(path)) {
    writeSettings(defaultSettings);
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LauncherSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      shortcuts: { ...defaultSettings.shortcuts, ...parsed.shortcuts },
      piCoding: { ...defaultSettings.piCoding, ...parsed.piCoding },
      skills: parsed.skills ?? defaultSettings.skills
    };
  } catch {
    return defaultSettings;
  }
}

export function writeSettings(settings: LauncherSettings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
}

export function getDefaultSettings(): LauncherSettings {
  return defaultSettings;
}

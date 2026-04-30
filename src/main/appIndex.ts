import { existsSync, readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, extname, join } from "node:path";
import type { LauncherApp } from "./types.js";

const startMenuRoots = (): string[] => {
  const roots = [
    process.env.ProgramData ? join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs") : "",
    process.env.APPDATA ? join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs") : "",
    process.env.PUBLIC ? join(process.env.PUBLIC, "Desktop") : "",
    process.env.USERPROFILE ? join(process.env.USERPROFILE, "Desktop") : ""
  ];

  return roots.filter((root) => root.length > 0 && existsSync(root));
};

function walkApps(root: string, bucket: LauncherApp[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of entries) {
    const itemPath = join(root, item.name);
    if (item.isDirectory()) {
      walkApps(itemPath, bucket);
      continue;
    }

    const extension = extname(item.name).toLowerCase();
    if (extension !== ".lnk" && extension !== ".exe" && extension !== ".appref-ms") {
      continue;
    }

    const name = basename(item.name, extension);
    bucket.push({
      id: Buffer.from(itemPath).toString("base64url"),
      name,
      path: itemPath,
      source: "start-menu"
    });
  }
}

const commonExecutableRoots = (): string[] => {
  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs") : "",
    process.env.ProgramFiles ?? "",
    process.env["ProgramFiles(x86)"] ?? ""
  ];

  return roots.filter((root) => root.length > 0 && existsSync(root));
};

function walkExecutables(root: string, bucket: LauncherApp[], depth = 0): void {
  if (depth > 3) {
    return;
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of entries) {
    const itemPath = join(root, item.name);
    if (item.isDirectory()) {
      walkExecutables(itemPath, bucket, depth + 1);
      continue;
    }

    if (extname(item.name).toLowerCase() !== ".exe") {
      continue;
    }

    const rawName = basename(item.name, ".exe");
    if (!isLikelyUserFacingExecutable(rawName, itemPath)) {
      continue;
    }

    bucket.push({
      id: Buffer.from(itemPath).toString("base64url"),
      name: prettifyExecutableName(rawName, itemPath),
      path: itemPath,
      source: "path"
    });
  }
}

function isLikelyUserFacingExecutable(name: string, path: string): boolean {
  const lower = `${name} ${path}`.toLowerCase();
  const blocked = ["unins", "setup", "installer", "update", "crash", "helper", "service", "broker", "host", "daemon"];
  if (blocked.some((part) => lower.includes(part))) {
    return false;
  }

  return ["code", "chrome", "firefox", "edge", "cursor", "notepad", "studio", "terminal", "obsidian", "discord", "slack"].some((part) =>
    lower.includes(part)
  );
}

function prettifyExecutableName(name: string, path: string): string {
  if (name.toLowerCase() === "code" && path.toLowerCase().includes("microsoft vs code")) {
    return "Visual Studio Code";
  }
  if (name.toLowerCase() === "cursor") {
    return "Cursor";
  }
  return name.replaceAll("_", " ").replaceAll("-", " ");
}

export function buildAppIndex(): LauncherApp[] {
  const apps: LauncherApp[] = [];
  for (const root of startMenuRoots()) {
    try {
      if (statSync(root).isDirectory()) {
        walkApps(root, apps);
      }
    } catch {
      continue;
    }
  }

  for (const root of commonExecutableRoots()) {
    walkExecutables(root, apps);
  }

  const seen = new Set<string>();
  return apps
    .filter((item) => {
      const key = item.path.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

function initials(value: string): string {
  return value
    .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .join("")
    .toLowerCase();
}

function isSubsequence(query: string, target: string): boolean {
  let queryIndex = 0;
  for (const char of target) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) {
        return true;
      }
    }
  }
  return query.length === 0;
}

function scoreApp(app: LauncherApp, query: string): number {
  const name = app.name.toLowerCase();
  const compactName = normalize(app.name);
  const compactQuery = normalize(query);
  const appInitials = initials(app.name);
  const path = app.path.toLowerCase();

  if (name === query || compactName === compactQuery) {
    return 0;
  }
  if (name.startsWith(query) || compactName.startsWith(compactQuery)) {
    return 1;
  }
  if (appInitials === compactQuery || appInitials.startsWith(compactQuery)) {
    return 2;
  }
  if (name.includes(query) || compactName.includes(compactQuery)) {
    return 3;
  }
  if (isSubsequence(compactQuery, compactName)) {
    return 4;
  }
  if (path.includes(query) || path.includes(compactQuery)) {
    return 5;
  }
  return Number.POSITIVE_INFINITY;
}

export function searchApps(apps: LauncherApp[], query: string, limit = 8): LauncherApp[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return apps.slice(0, limit);
  }

  return apps
    .map((app) => {
      const score = scoreApp(app, normalized);
      return { app, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.app.name.length - b.app.name.length || a.app.name.localeCompare(b.app.name, "zh-CN"))
    .slice(0, limit)
    .map((item) => item.app);
}

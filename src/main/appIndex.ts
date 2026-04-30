import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { LauncherApp } from "./types.js";

const startMenuRoots = (): string[] => {
  const roots = [
    process.env.ProgramData ? join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs") : "",
    process.env.APPDATA ? join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs") : ""
  ];

  return roots.filter((root) => root.length > 0 && existsSync(root));
};

function walkApps(root: string, bucket: LauncherApp[]): void {
  for (const item of readdirSync(root, { withFileTypes: true })) {
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

export function searchApps(apps: LauncherApp[], query: string, limit = 8): LauncherApp[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return apps.slice(0, limit);
  }

  return apps
    .map((app) => {
      const name = app.name.toLowerCase();
      const score = name === normalized ? 0 : name.startsWith(normalized) ? 1 : name.includes(normalized) ? 2 : 10;
      return { app, score };
    })
    .filter((item) => item.score < 10)
    .sort((a, b) => a.score - b.score || a.app.name.length - b.app.name.length)
    .slice(0, limit)
    .map((item) => item.app);
}

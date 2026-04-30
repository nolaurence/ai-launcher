import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppIndex, searchApps } from "./appIndex.js";
import { ClipboardHistory } from "./clipboardHistory.js";
import { PiCodingAdapter } from "./piCoding.js";
import { readSettings, writeSettings } from "./settings.js";
import type { LauncherSettings, WindowName } from "./types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined || !app.isPackaged;

let settings: LauncherSettings;
let clipboardHistory: ClipboardHistory;
let piCoding: PiCodingAdapter;
let appIndex = buildAppIndex();

const windows = new Map<WindowName, BrowserWindow>();

function rendererUrl(view: WindowName): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  if (isDev) {
    return `${devUrl}/?view=${view}`;
  }
  return `file://${join(__dirname, "../renderer/index.html")}?view=${view}`;
}

function createWindow(name: WindowName): BrowserWindow {
  const size = name === "launcher" ? { width: 1040, height: 620 } : name === "clipboard" ? { width: 940, height: 680 } : { width: 1100, height: 760 };
  const window = new BrowserWindow({
    ...size,
    show: false,
    frame: false,
    resizable: name !== "launcher",
    transparent: false,
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundMaterial: "mica",
    backgroundColor: "#00000000",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  });

  window.loadURL(rendererUrl(name));
  window.on("blur", () => {
    if (name === "launcher") {
      window.hide();
    }
  });
  windows.set(name, window);
  return window;
}

function getWindow(name: WindowName): BrowserWindow {
  return windows.get(name) ?? createWindow(name);
}

function centerLauncher(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea;
  const [width, height] = window.getSize();
  window.setPosition(Math.round(bounds.x + (bounds.width - width) / 2), Math.round(bounds.y + bounds.height * 0.18));
}

function showWindow(name: WindowName, payload?: unknown): void {
  const window = getWindow(name);
  if (name === "launcher") {
    centerLauncher(window);
  }
  window.show();
  window.focus();
  window.webContents.send("window:shown", payload ?? null);
}

function registerShortcuts(): void {
  globalShortcut.unregisterAll();
  globalShortcut.register(settings.shortcuts.launcher, () => showWindow("launcher"));
  globalShortcut.register(settings.shortcuts.clipboard, () => showWindow("clipboard"));
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:update", (_event, next: LauncherSettings) => {
    settings = next;
    writeSettings(settings);
    clipboardHistory.setMaxItems(settings.clipboardMaxItems);
    registerShortcuts();
    return settings;
  });

  ipcMain.handle("apps:search", (_event, query: string) => searchApps(appIndex, query));
  ipcMain.handle("apps:refresh", () => {
    appIndex = buildAppIndex();
    return appIndex.length;
  });
  ipcMain.handle("apps:open", async (_event, path: string) => {
    const result = await shell.openPath(path);
    if (result) {
      throw new Error(result);
    }
    getWindow("launcher").hide();
    return true;
  });

  ipcMain.handle("clipboard:list", () => clipboardHistory.list());
  ipcMain.handle("clipboard:use", (_event, id: string) => clipboardHistory.write(id));
  ipcMain.handle("clipboard:writeText", (_event, text: string) => {
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("window:show", (_event, name: WindowName, payload?: unknown) => {
    showWindow(name, payload);
    return true;
  });
  ipcMain.handle("window:hide", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.hide();
    return true;
  });
  ipcMain.handle("ai:ask", async (_event, prompt: string) => {
    const response = await piCoding.ask({ prompt });
    showWindow("ai", response);
    return response;
  });
}

app.whenReady().then(() => {
  settings = readSettings();
  clipboardHistory = new ClipboardHistory(settings.clipboardMaxItems);
  piCoding = new PiCodingAdapter(() => settings);
  clipboardHistory.start();
  registerIpc();
  registerShortcuts();
  createWindow("launcher");
  createWindow("clipboard");
  createWindow("ai");
});

app.on("will-quit", () => {
  clipboardHistory?.stop();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    return;
  }
});

import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, screen, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppIndex, searchApps } from "./appIndex.js";
import { ClipboardHistory } from "./clipboardHistory.js";
import { PiCodingAdapter } from "./piCoding.js";
import { readSettings, writeSettings } from "./settings.js";
import type { LauncherSettings, ThemeMode, WindowName } from "./types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined || !app.isPackaged;

let settings: LauncherSettings;
let clipboardHistory: ClipboardHistory;
let piCoding: PiCodingAdapter;
let appIndex = buildAppIndex();

const windows = new Map<WindowName, BrowserWindow>();
const launcherPhysicalSize = { width: 1321, height: 831 };
const fixedToolPhysicalSize = { width: 1321, height: 831 };

function currentTheme(): ThemeMode {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function titleBarOverlayOptions(): Electron.TitleBarOverlay {
  const isDark = currentTheme() === "dark";
  return {
    color: "#00000000",
    symbolColor: isDark ? "#f5f7fb" : "#111827",
    height: 46
  };
}

function syncTitleBarOverlay(window: BrowserWindow): void {
  if (process.platform === "win32" || process.platform === "linux") {
    window.setTitleBarOverlay(titleBarOverlayOptions());
  }
}

function toDipSize(width: number, height: number, scaleFactor: number): { width: number; height: number } {
  const scale = scaleFactor > 0 ? scaleFactor : 1;
  return {
    width: Math.round(width / scale),
    height: Math.round(height / scale)
  };
}

function rendererUrl(view: WindowName): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  if (isDev) {
    return `${devUrl}/?view=${view}`;
  }
  return `file://${join(__dirname, "../renderer/index.html")}?view=${view}`;
}

function createWindow(name: WindowName): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const launcherSize = toDipSize(launcherPhysicalSize.width, launcherPhysicalSize.height, display.scaleFactor);
  const fixedToolSize = toDipSize(fixedToolPhysicalSize.width, fixedToolPhysicalSize.height, display.scaleFactor);
  const fixedSizeWindow = name === "launcher" || name === "clipboard";
  const size = name === "launcher" ? launcherSize : name === "clipboard" ? fixedToolSize : { width: 1100, height: 760 };
  const useNativeOverlayControls = name === "ai";
  const window = new BrowserWindow({
    ...size,
    title: useNativeOverlayControls ? "" : "Mica Launcher",
    show: false,
    frame: false,
    resizable: !fixedSizeWindow,
    maximizable: !fixedSizeWindow,
    fullscreenable: !fixedSizeWindow,
    minWidth: fixedSizeWindow ? size.width : undefined,
    maxWidth: fixedSizeWindow ? size.width : undefined,
    minHeight: fixedSizeWindow ? size.height : undefined,
    maxHeight: fixedSizeWindow ? size.height : undefined,
    transparent: false,
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundMaterial: "mica",
    backgroundColor: "#00000000",
    titleBarStyle: "hidden",
    titleBarOverlay: useNativeOverlayControls ? titleBarOverlayOptions() : false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  });
  if (useNativeOverlayControls) {
    syncTitleBarOverlay(window);
  }

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

function centerFixedWindow(window: BrowserWindow, physicalSize: { width: number; height: number }): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea;
  const size = toDipSize(physicalSize.width, physicalSize.height, display.scaleFactor);
  window.setMinimumSize(size.width, size.height);
  window.setMaximumSize(size.width, size.height);
  window.setSize(size.width, size.height);
  const [width, height] = window.getSize();
  window.setPosition(Math.round(bounds.x + (bounds.width - width) / 2), Math.round(bounds.y + bounds.height * 0.18));
}

function showWindow(name: WindowName, payload?: unknown): void {
  const window = getWindow(name);
  if (name === "launcher") {
    centerFixedWindow(window, launcherPhysicalSize);
  }
  if (name === "clipboard") {
    centerFixedWindow(window, fixedToolPhysicalSize);
  }
  window.show();
  window.focus();
  window.webContents.send("window:shown", payload ?? null);
  window.webContents.send("theme:changed", currentTheme());
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

  ipcMain.handle("apps:search", (_event, query: string) => {
    if (appIndex.length === 0) {
      appIndex = buildAppIndex();
    }
    return searchApps(appIndex, query);
  });
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
  ipcMain.handle("clipboard:imageDataUrl", (_event, id: string) => clipboardHistory.imageDataUrl(id));
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
  ipcMain.handle("window:control", (event, action: "minimize" | "maximize" | "close") => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }
    if (action === "minimize") {
      window.minimize();
      return true;
    }
    if (action === "maximize") {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      return true;
    }
    window.close();
    return true;
  });
  ipcMain.handle("theme:get", () => currentTheme());
  ipcMain.handle("ai:ask", async (_event, prompt: string) => {
    const response = await piCoding.ask({ prompt });
    showWindow("ai", response);
    return response;
  });
  ipcMain.handle("ai:send", (_event, prompt: string) => piCoding.ask({ prompt }));
  ipcMain.handle("ai:start", () => {
    const output = piCoding.start();
    return { output, logs: piCoding.allLogs() };
  });
  ipcMain.handle("ai:logs", () => piCoding.allLogs());
}

app.whenReady().then(() => {
  settings = readSettings();
  clipboardHistory = new ClipboardHistory(settings.clipboardMaxItems);
  piCoding = new PiCodingAdapter(() => settings, (output) => {
    windows.get("ai")?.webContents.send("ai:output", output);
  });
  clipboardHistory.start();
  registerIpc();
  registerShortcuts();
  createWindow("launcher");
  createWindow("clipboard");
  createWindow("ai");
  nativeTheme.on("updated", () => {
    const theme = currentTheme();
    for (const window of windows.values()) {
      syncTitleBarOverlay(window);
      window.webContents.send("theme:changed", theme);
    }
  });
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

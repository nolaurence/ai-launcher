import { contextBridge, ipcRenderer } from "electron";
import type { ClipboardEntry, LauncherApp, LauncherSettings, WindowName } from "../main/types.js";

const api = {
  getSettings: (): Promise<LauncherSettings> => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: LauncherSettings): Promise<LauncherSettings> => ipcRenderer.invoke("settings:update", settings),
  searchApps: (query: string): Promise<LauncherApp[]> => ipcRenderer.invoke("apps:search", query),
  refreshApps: (): Promise<number> => ipcRenderer.invoke("apps:refresh"),
  openApp: (path: string): Promise<boolean> => ipcRenderer.invoke("apps:open", path),
  listClipboard: (): Promise<ClipboardEntry[]> => ipcRenderer.invoke("clipboard:list"),
  useClipboard: (id: string): Promise<boolean> => ipcRenderer.invoke("clipboard:use", id),
  writeClipboardText: (text: string): Promise<boolean> => ipcRenderer.invoke("clipboard:writeText", text),
  showWindow: (name: WindowName, payload?: unknown): Promise<boolean> => ipcRenderer.invoke("window:show", name, payload),
  hideWindow: (): Promise<boolean> => ipcRenderer.invoke("window:hide"),
  askAi: (prompt: string): Promise<{ url: string; prompt: string }> => ipcRenderer.invoke("ai:ask", prompt),
  onWindowShown: (handler: (payload: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => handler(payload);
    ipcRenderer.on("window:shown", listener);
    return () => ipcRenderer.off("window:shown", listener);
  }
};

contextBridge.exposeInMainWorld("launcherApi", api);

declare global {
  interface Window {
    launcherApi: typeof api;
  }
}

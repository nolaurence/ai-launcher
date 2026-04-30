import type { IpcRendererEvent } from "electron";
import type { ClipboardEntry, LauncherApp, LauncherSettings, WindowName } from "../main/types.js";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = {
  getSettings: (): Promise<LauncherSettings> => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: LauncherSettings): Promise<LauncherSettings> => ipcRenderer.invoke("settings:update", settings),
  searchApps: (query: string): Promise<LauncherApp[]> => ipcRenderer.invoke("apps:search", query),
  refreshApps: (): Promise<number> => ipcRenderer.invoke("apps:refresh"),
  openApp: (path: string): Promise<boolean> => ipcRenderer.invoke("apps:open", path),
  listClipboard: (): Promise<ClipboardEntry[]> => ipcRenderer.invoke("clipboard:list"),
  useClipboard: (id: string): Promise<boolean> => ipcRenderer.invoke("clipboard:use", id),
  getClipboardImageDataUrl: (id: string): Promise<string | null> => ipcRenderer.invoke("clipboard:imageDataUrl", id),
  writeClipboardText: (text: string): Promise<boolean> => ipcRenderer.invoke("clipboard:writeText", text),
  showWindow: (name: WindowName, payload?: unknown): Promise<boolean> => ipcRenderer.invoke("window:show", name, payload),
  hideWindow: (): Promise<boolean> => ipcRenderer.invoke("window:hide"),
  askAi: (prompt: string): Promise<{ url: string; prompt: string }> => ipcRenderer.invoke("ai:ask", prompt),
  startAi: (): Promise<{ output: { type: string; text: string; createdAt: number }; logs: Array<{ type: string; text: string; createdAt: number }> }> =>
    ipcRenderer.invoke("ai:start"),
  getAiLogs: (): Promise<Array<{ type: string; text: string; createdAt: number }>> => ipcRenderer.invoke("ai:logs"),
  onAiOutput: (handler: (output: { type: string; text: string; createdAt: number }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, output: { type: string; text: string; createdAt: number }): void => handler(output);
    ipcRenderer.on("ai:output", listener);
    return () => ipcRenderer.off("ai:output", listener);
  },
  onWindowShown: (handler: (payload: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => handler(payload);
    ipcRenderer.on("window:shown", listener);
    return () => ipcRenderer.off("window:shown", listener);
  }
};

contextBridge.exposeInMainWorld("launcherApi", api);

export type LauncherApi = typeof api;

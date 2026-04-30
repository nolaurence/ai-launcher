import type { ClipboardEntry, LauncherApp, LauncherSettings, WindowName } from "../main/types.js";

interface LauncherApi {
  getSettings: () => Promise<LauncherSettings>;
  updateSettings: (settings: LauncherSettings) => Promise<LauncherSettings>;
  searchApps: (query: string) => Promise<LauncherApp[]>;
  refreshApps: () => Promise<number>;
  openApp: (path: string) => Promise<boolean>;
  listClipboard: () => Promise<ClipboardEntry[]>;
  useClipboard: (id: string) => Promise<boolean>;
  getClipboardImageDataUrl: (id: string) => Promise<string | null>;
  writeClipboardText: (text: string) => Promise<boolean>;
  showWindow: (name: WindowName, payload?: unknown) => Promise<boolean>;
  hideWindow: () => Promise<boolean>;
  askAi: (prompt: string) => Promise<{ url: string; prompt: string }>;
  startAi: () => Promise<{ output: AiOutput; logs: AiOutput[] }>;
  getAiLogs: () => Promise<AiOutput[]>;
  onAiOutput: (handler: (output: AiOutput) => void) => () => void;
  onWindowShown: (handler: (payload: unknown) => void) => () => void;
}

interface AiOutput {
  type: string;
  text: string;
  createdAt: number;
  eventType?: string;
  role?: string;
}

declare global {
  interface Window {
    launcherApi: LauncherApi;
  }
}

export {};

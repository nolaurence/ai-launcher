import type { ClipboardEntry, LauncherApp, LauncherSettings, ThemeMode, WindowName } from "../main/types.js";

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
  controlWindow: (action: "minimize" | "maximize" | "close") => Promise<boolean>;
  getTheme: () => Promise<ThemeMode>;
  askAi: (prompt: string) => Promise<{ prompt: string }>;
  sendAiPrompt: (prompt: string) => Promise<{ prompt: string }>;
  startAi: () => Promise<{ output: AiOutput; logs: AiOutput[] }>;
  getAiLogs: () => Promise<AiOutput[]>;
  onAiOutput: (handler: (output: AiOutput) => void) => () => void;
  onWindowShown: (handler: (payload: unknown) => void) => () => void;
  onThemeChanged: (handler: (theme: ThemeMode) => void) => () => void;
}

interface AiOutput {
  type: string;
  text: string;
  createdAt: number;
  eventType?: string;
  messageEventType?: string;
  role?: string;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: unknown;
  status?: "started" | "delta" | "ended" | "error";
  raw?: unknown;
}

declare global {
  interface Window {
    launcherApi: LauncherApi;
  }
}

export {};

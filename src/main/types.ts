export type WindowName = "launcher" | "clipboard" | "ai";
export type ThemeMode = "dark" | "light";

export interface LauncherApp {
  id: string;
  name: string;
  path: string;
  source: "start-menu" | "path";
}

export interface ClipboardEntry {
  id: string;
  type: "text" | "image" | "file" | "video";
  text?: string;
  filePath?: string;
  previewPath?: string;
  mime?: string;
  createdAt: number;
}

export interface LauncherSettings {
  clipboardMaxItems: number;
  shortcuts: {
    launcher: string;
    clipboard: string;
  };
  piCoding: {
    command: string;
  };
  skills: Array<{
    id: string;
    name: string;
    enabled: boolean;
  }>;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  directory: string;
  source: "user" | "global" | "project";
  enabled: boolean;
  slashCommand: string;
  disableModelInvocation: boolean;
}

export interface AiSessionRequest {
  prompt: string;
}

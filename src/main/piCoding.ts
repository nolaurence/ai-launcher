import { spawn } from "node:child_process";
import type { AiSessionRequest, LauncherSettings } from "./types.js";

export class PiCodingAdapter {
  constructor(private getSettings: () => LauncherSettings) {}

  async ask(request: AiSessionRequest): Promise<{ url: string; prompt: string }> {
    const settings = this.getSettings().piCoding;
    if (settings.command.trim()) {
      const child = spawn(settings.command, ["--prompt", request.prompt], {
        shell: true,
        detached: true,
        stdio: "ignore"
      });
      child.unref();
    }

    const encoded = encodeURIComponent(request.prompt);
    const separator = settings.webUrl.includes("?") ? "&" : "?";
    return {
      url: `${settings.webUrl}${separator}prompt=${encoded}`,
      prompt: request.prompt
    };
  }
}

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AiSessionRequest, LauncherSettings } from "./types.js";

export interface PiCodingOutput {
  type: "status" | "stdout" | "stderr" | "exit";
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

export class PiCodingAdapter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private logs: PiCodingOutput[] = [];
  private stdoutBuffer = "";
  private requestId = 0;

  constructor(
    private getSettings: () => LauncherSettings,
    private emit?: (output: PiCodingOutput) => void
  ) {}

  start(): PiCodingOutput {
    if (this.child && !this.child.killed) {
      return this.push({ type: "status", text: "pi is already running.", createdAt: Date.now() });
    }

    const command = this.getSettings().piCoding.command.trim() || "pi";
    const started = this.push({ type: "status", text: `Starting: ${command} --mode rpc`, createdAt: Date.now() });

    try {
      const spawnConfig = this.spawnConfig(command);
      this.child = spawn(spawnConfig.command, spawnConfig.args, {
        shell: spawnConfig.shell,
        windowsHide: true,
        env: process.env
      });

      this.child.stdout.on("data", (chunk: Buffer) => {
        this.handleStdout(chunk.toString());
      });
      this.child.stderr.on("data", (chunk: Buffer) => {
        this.push({ type: "stderr", text: chunk.toString(), createdAt: Date.now() });
      });
      this.child.on("error", (error) => {
        this.push({ type: "stderr", text: error.message, createdAt: Date.now() });
      });
      this.child.on("exit", (code) => {
        this.push({ type: "exit", text: `pi exited with code ${code ?? "unknown"}.`, createdAt: Date.now() });
        this.child = undefined;
      });
    } catch (error) {
      this.push({ type: "stderr", text: error instanceof Error ? error.message : String(error), createdAt: Date.now() });
    }

    return started;
  }

  allLogs(): PiCodingOutput[] {
    return this.logs;
  }

  async ask(request: AiSessionRequest): Promise<{ prompt: string }> {
    this.start();
    if (this.child?.stdin.writable && request.prompt.trim()) {
      this.push({ type: "stdout", text: request.prompt, eventType: "user_prompt", role: "user", createdAt: Date.now() });
      this.sendRpc({ type: "prompt", message: request.prompt, streamingBehavior: "followUp" });
    }

    return {
      prompt: request.prompt
    };
  }

  private push(output: PiCodingOutput): PiCodingOutput {
    this.logs.push(output);
    this.logs = this.logs.slice(-500);
    this.emit?.(output);
    return output;
  }

  private spawnConfig(command: string): { command: string; args: string[]; shell: boolean } {
    if (process.platform === "win32" && command.toLowerCase() === "pi") {
      return {
        command: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "pi --mode rpc"],
        shell: false
      };
    }

    return { command, args: ["--mode", "rpc"], shell: true };
  }

  private sendRpc(command: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) {
      this.push({ type: "stderr", text: "pi RPC process is not writable.", createdAt: Date.now() });
      return;
    }

    const id = `launcher_${++this.requestId}`;
    this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.trim()) {
        continue;
      }

      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        this.push(this.outputFromRpcEvent(event));
      } catch {
        this.push({ type: "stdout", text: line, createdAt: Date.now() });
      }
    }
  }

  private outputFromRpcEvent(event: Record<string, unknown>): PiCodingOutput {
    const eventType = typeof event.type === "string" ? event.type : undefined;
    const base = {
      type: "stdout" as const,
      eventType,
      role: this.extractRole(event),
      raw: event,
      createdAt: Date.now()
    };

    if (event.type === "message_update") {
      const messageEvent = event.assistantMessageEvent;
      if (messageEvent && typeof messageEvent === "object") {
        const record = messageEvent as Record<string, unknown>;
        const messageEventType = typeof record.type === "string" ? record.type : undefined;
        const toolCall = this.extractToolCall(record);
        const toolName = this.extractToolName(record);
        return {
          ...base,
          text: this.formatAssistantMessageEvent(record),
          messageEventType,
          role: messageEventType?.startsWith("thinking") ? "thinking" : base.role,
          toolName,
          toolCallId: this.extractToolCallId(record),
          toolArguments: toolCall?.arguments ?? toolCall?.input ?? record.args ?? record.arguments,
          status: this.statusFromMessageEvent(messageEventType),
          raw: event
        };
      }
    }

    if (event.type === "tool_execution_start") {
      return {
        ...base,
        text: this.extractText(event) || `Running ${String(event.toolName ?? "tool")}...`,
        messageEventType: "tool_execution_start",
        role: "tool",
        toolName: typeof event.toolName === "string" ? event.toolName : undefined,
        status: "started"
      };
    }

    if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      const ended = event.type === "tool_execution_end";
      return {
        ...base,
        text: this.extractText(event.partialResult) || this.extractText(event.result) || this.extractText(event) || String(event.toolName ?? ""),
        messageEventType: typeof event.type === "string" ? event.type : undefined,
        role: "tool",
        toolName: typeof event.toolName === "string" ? event.toolName : undefined,
        status: ended ? "ended" : "delta"
      };
    }

    return {
      ...base,
      text: this.formatRpcEvent(event)
    };
  }

  private formatAssistantMessageEvent(record: Record<string, unknown>): string {
    if ((record.type === "text_delta" || record.type === "thinking_delta") && typeof record.delta === "string") {
      return record.delta;
    }
    if (record.type === "toolcall_start" || record.type === "toolcall_delta" || record.type === "toolcall_end") {
      return this.extractText(record.delta) || this.extractText(record.toolCall) || "";
    }
    if (typeof record.error === "string") {
      return record.error;
    }
    return this.extractText(record);
  }

  private formatRpcEvent(event: Record<string, unknown>): string {
    if (event.type === "response") {
      const command = typeof event.command === "string" ? event.command : "command";
      const success = event.success === true ? "ok" : "failed";
      const error = typeof event.error === "string" ? `: ${event.error}` : "";
      return `[response:${command}] ${success}${error}`;
    }

    if (event.type === "message_update") {
      const messageEvent = event.assistantMessageEvent;
      if (messageEvent && typeof messageEvent === "object") {
        const record = messageEvent as Record<string, unknown>;
        if (record.type === "text_delta" && typeof record.delta === "string") {
          return record.delta;
        }
        if (record.type === "thinking_delta" && typeof record.delta === "string") {
          return record.delta;
        }
        if (record.type === "toolcall_start" || record.type === "toolcall_end") {
          const toolCall = record.toolCall && typeof record.toolCall === "object" ? (record.toolCall as Record<string, unknown>) : undefined;
          const toolName = typeof toolCall?.name === "string" ? toolCall.name : "tool";
          return `${record.type}: ${toolName}`;
        }
        if (typeof record.error === "string") {
          return record.error;
        }
        return "";
      }
    }

    if (event.type === "tool_execution_start") {
      return `Running ${String(event.toolName ?? "tool")}...`;
    }

    if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      return this.extractText(event.partialResult) || this.extractText(event.result) || String(event.toolName ?? "");
    }

    return "";
  }

  private extractText(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (!value || typeof value !== "object") {
      return "";
    }

    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "message", "error"]) {
      const item = record[key];
      if (typeof item === "string") {
        return item;
      }
    }

    for (const key of ["assistantMessageEvent", "partialResult", "result", "message", "delta", "data", "params"]) {
      const nested = this.extractText(record[key]);
      if (nested) {
        return nested;
      }
    }

    for (const [key, item] of Object.entries(record)) {
      if (key === "type" || key === "id" || key === "timestamp" || key === "role") {
        continue;
      }
      const nested = this.extractText(item);
      if (nested) {
        return nested;
      }
    }

    return "";
  }

  private extractToolCall(value: Record<string, unknown>): Record<string, unknown> | undefined {
    const toolCall = value.toolCall ?? value.tool_call ?? value.call;
    return toolCall && typeof toolCall === "object" ? (toolCall as Record<string, unknown>) : undefined;
  }

  private extractToolName(value: Record<string, unknown>): string | undefined {
    const toolCall = this.extractToolCall(value);
    for (const item of [value.name, value.toolName, value.tool_name, toolCall?.name, toolCall?.toolName, toolCall?.tool_name]) {
      if (typeof item === "string") {
        return item;
      }
    }
    return undefined;
  }

  private extractToolCallId(value: Record<string, unknown>): string | undefined {
    const toolCall = this.extractToolCall(value);
    for (const item of [value.id, value.toolCallId, value.tool_call_id, toolCall?.id]) {
      if (typeof item === "string") {
        return item;
      }
    }
    return undefined;
  }

  private statusFromMessageEvent(eventType: string | undefined): PiCodingOutput["status"] {
    if (!eventType) {
      return undefined;
    }
    if (eventType.endsWith("_start")) {
      return "started";
    }
    if (eventType.endsWith("_end")) {
      return "ended";
    }
    if (eventType.endsWith("_delta")) {
      return "delta";
    }
    return undefined;
  }

  private extractRole(value: unknown): string | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.role === "string") {
      return record.role;
    }
    for (const key of ["message", "data", "params", "result"]) {
      const role = this.extractRole(record[key]);
      if (role) {
        return role;
      }
    }
    return undefined;
  }
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider, Input, Switch, theme } from "antd";
import { CodeOutlined, LoadingOutlined, PlusOutlined, ToolOutlined } from "@ant-design/icons";
import { Bubble, Conversations, Sender, Think, XProvider, type BubbleItemType, type ConversationItemType } from "@ant-design/x";
import type { LauncherSettings, ThemeMode } from "../../main/types.js";

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

type ChatPartType = "text" | "thinking" | "tool-call" | "tool-result" | "error";

interface ChatPart {
  id: string;
  type: ChatPartType;
  content: string;
  createdAt: number;
  status?: "started" | "delta" | "ended" | "error";
  toolName?: string;
  toolArguments?: unknown;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content?: string;
  parts?: ChatPart[];
  createdAt: number;
  streaming?: boolean;
}

interface ChatSession {
  key: string;
  title: string;
  group: string;
  messages: ChatMessage[];
  createdAt: number;
}

const initialSession = (): ChatSession => ({
  key: `session-${Date.now()}`,
  title: "新对话",
  group: "今天",
  messages: [],
  createdAt: Date.now()
});

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 28) : "新对话";
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isLifecycleEvent(output: AiOutput): boolean {
  return ["turn_start", "agent_start", "agent_end", "response"].includes(output.eventType ?? "");
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function endStreaming(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    streaming: false,
    parts: message.parts?.map((part) => (part.status === "started" || part.status === "delta" ? { ...part, status: "ended" as const } : part))
  }));
}

function appendAssistantPart(messages: ChatMessage[], part: ChatPart, mergeWithLast = true): ChatMessage[] {
  const last = messages[messages.length - 1];
  const shouldReuse = last?.role === "assistant";
  const assistant: ChatMessage = shouldReuse
    ? last
    : {
        id: makeId("assistant"),
        role: "assistant",
        createdAt: part.createdAt,
        streaming: true,
        parts: []
      };
  const parts = assistant.parts ?? [];
  const previous = parts[parts.length - 1];
  const canMerge =
    mergeWithLast &&
    previous &&
    previous.type === part.type &&
    previous.toolName === part.toolName &&
    (part.type === "text" || part.type === "thinking" || part.type === "tool-result");
  const nextParts = canMerge
    ? [...parts.slice(0, -1), { ...previous, content: `${previous.content}${part.content}`, status: part.status ?? previous.status }]
    : [...parts, part];
  const nextAssistant = { ...assistant, streaming: part.status !== "ended", parts: nextParts };
  return shouldReuse ? [...messages.slice(0, -1), nextAssistant] : [...messages, nextAssistant];
}

function updateLastPart(messages: ChatMessage[], type: ChatPartType, updater: (part: ChatPart) => ChatPart): ChatMessage[] {
  let messageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].parts?.some((part) => part.type === type)) {
      messageIndex = index;
      break;
    }
  }
  if (messageIndex < 0) {
    return messages;
  }
  const message = messages[messageIndex];
  const parts = message.parts ?? [];
  let partIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].type === type) {
      partIndex = index;
      break;
    }
  }
  if (partIndex < 0) {
    return messages;
  }
  const nextParts = parts.map((part, currentIndex) => (currentIndex === partIndex ? updater(part) : part));
  return messages.map((item, currentIndex) => (currentIndex === messageIndex ? { ...message, parts: nextParts } : item));
}

function addOutputToMessages(messages: ChatMessage[], output: AiOutput): ChatMessage[] {
  if (output.type === "status" || isLifecycleEvent(output)) {
    return messages;
  }
  if (output.eventType === "message_end" || output.eventType === "agent_end" || output.eventType === "turn_end") {
    return endStreaming(messages);
  }

  if (output.eventType === "user_prompt") {
    return [...messages, { id: makeId("user"), role: "user", content: output.text, createdAt: output.createdAt }];
  }

  if (output.type === "stderr" || output.type === "exit") {
    return appendAssistantPart(messages, {
      id: makeId("error"),
      type: "error",
      content: output.text,
      createdAt: output.createdAt,
      status: "error"
    });
  }

  if (output.messageEventType === "text_delta") {
    return appendAssistantPart(messages, { id: makeId("text"), type: "text", content: output.text, createdAt: output.createdAt, status: output.status });
  }

  if (output.messageEventType === "thinking_delta") {
    return appendAssistantPart(messages, {
      id: makeId("thinking"),
      type: "thinking",
      content: output.text,
      createdAt: output.createdAt,
      status: output.status
    });
  }

  if (output.messageEventType === "thinking_end") {
    return updateLastPart(messages, "thinking", (part) => ({ ...part, status: "ended" }));
  }

  if (output.messageEventType === "toolcall_start") {
    return appendAssistantPart(
      messages,
      {
        id: output.toolCallId ?? makeId("tool-call"),
        type: "tool-call",
        content: output.text,
        createdAt: output.createdAt,
        status: "started",
        toolName: output.toolName ?? "tool",
        toolArguments: output.toolArguments
      },
      false
    );
  }

  if (output.messageEventType === "toolcall_delta") {
    return updateLastPart(messages, "tool-call", (part) => ({
      ...part,
      content: `${part.content}${output.text}`,
      status: "delta",
      toolArguments: output.toolArguments ?? part.toolArguments
    }));
  }

  if (output.messageEventType === "toolcall_end") {
    return updateLastPart(messages, "tool-call", (part) => ({
      ...part,
      content: part.content || output.text,
      status: "ended",
      toolName: output.toolName ?? part.toolName,
      toolArguments: output.toolArguments ?? part.toolArguments
    }));
  }

  if (output.messageEventType?.startsWith("tool_execution_")) {
    const part: ChatPart = {
      id: makeId("tool-result"),
      type: "tool-result",
      content: output.messageEventType === "tool_execution_start" ? "" : output.text,
      createdAt: output.createdAt,
      status: output.status,
      toolName: output.toolName ?? "tool"
    };
    if (output.messageEventType === "tool_execution_start") {
      return appendAssistantPart(messages, part, false);
    }
    return appendAssistantPart(messages, part);
  }

  if (output.text.trim() && !output.messageEventType) {
    const trimmed = output.text.trim().toLowerCase();
    if (trimmed === "user" || trimmed === "assistant" || trimmed === "system" || trimmed === "tool") {
      return messages;
    }
    return appendAssistantPart(messages, { id: makeId("text"), type: "text", content: output.text, createdAt: output.createdAt, status: output.status });
  }

  return messages;
}

function buildMessages(logs: AiOutput[]): ChatMessage[] {
  return logs.reduce<ChatMessage[]>((items, output) => addOutputToMessages(items, output), []);
}

function renderCodeBlock(content: string, lang = "text"): React.ReactElement {
  return content.trim() ? (
    <pre className="ai-code-block" data-lang={lang}>
      {content}
    </pre>
  ) : (
    <span className="ai-muted">等待输出...</span>
  );
}

function renderToolArguments(part: ChatPart): React.ReactNode {
  const toolArgs = part.toolArguments;
  if (toolArgs && typeof toolArgs === "object" && !Array.isArray(toolArgs)) {
    const record = toolArgs as Record<string, unknown>;
    if (typeof record.command === "string") {
      return <div className="ai-tool-args">{renderCodeBlock(record.command, "bash")}</div>;
    }
  }
  const args = stringifyValue(toolArgs) || part.content;
  if (!args.trim()) {
    return null;
  }
  return <div className="ai-tool-args">{renderCodeBlock(args, "json")}</div>;
}

function renderAssistantPart(part: ChatPart): React.ReactElement {
  if (part.type === "text") {
    return (
      <div className="ai-agent-text" key={part.id}>
        {part.content}
      </div>
    );
  }

  if (part.type === "thinking") {
    const loading = part.status !== "ended";
    return (
      <Think className="ai-thinking" defaultExpanded={false} key={part.id} loading={loading} title={loading ? "正在思考" : "思考过程"}>
        <pre>{part.content}</pre>
      </Think>
    );
  }

  if (part.type === "tool-call") {
    const running = part.status !== "ended";
    return (
      <div className="ai-tool-card" key={part.id}>
        <div className="ai-tool-header">
          {running ? <LoadingOutlined spin /> : <ToolOutlined />}
          <span>调用工具</span>
          <strong>{part.toolName ?? "tool"}</strong>
          <em>{running ? "运行中" : "已完成"}</em>
        </div>
        {renderToolArguments(part)}
      </div>
    );
  }

  if (part.type === "tool-result") {
    const lang = part.toolName === "bash" || part.toolName === "shell" ? "bash" : "text";
    return (
      <div className="ai-tool-card ai-tool-result" key={part.id}>
        <div className="ai-tool-header">
          {part.status === "ended" ? <CodeOutlined /> : <LoadingOutlined spin />}
          <span>工具结果</span>
          <strong>{part.toolName ?? "tool"}</strong>
        </div>
        {renderCodeBlock(part.content, lang)}
      </div>
    );
  }

  return (
    <div className="ai-error-block" key={part.id}>
      {part.content}
    </div>
  );
}

function renderAssistantMessage(message: ChatMessage): React.ReactElement {
  return <div className="ai-agent-content">{(message.parts ?? []).map(renderAssistantPart)}</div>;
}

function AiWindow({ initialTheme }: { initialTheme: ThemeMode }): React.ReactElement {
  const [mode, setMode] = useState<ThemeMode>(initialTheme);
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>(() => [initialSession()]);
  const [activeKey, setActiveKey] = useState<string>(() => sessions[0].key);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const activeKeyRef = useRef(activeKey);

  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const activeSession = sessions.find((item) => item.key === activeKey) ?? sessions[0];

  const updateActiveSession = (updater: (session: ChatSession) => ChatSession): void => {
    setSessions((current) => current.map((session) => (session.key === activeKeyRef.current ? updater(session) : session)));
  };

  const appendPrompt = async (prompt: string, send: (value: string) => Promise<{ prompt: string }>): Promise<void> => {
    const value = prompt.trim();
    if (!value) {
      return;
    }
    setSending(true);
    updateActiveSession((session) => ({
      ...session,
      title: session.title === "新对话" ? titleFromPrompt(value) : session.title,
      messages: session.messages
    }));
    try {
      await send(value);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    void window.launcherApi.getSettings().then(setSettings);
    void window.launcherApi.startAi().then((started) => {
      const messages = buildMessages(started.logs);
      if (messages.length > 0) {
        updateActiveSession((session) => ({
          ...session,
          title: session.title === "新对话" ? "pi-coding 会话" : session.title,
          messages
        }));
      }
    });

    const offOutput = window.launcherApi.onAiOutput((output) => {
      updateActiveSession((session) => ({ ...session, messages: addOutputToMessages(session.messages, output) }));
    });
    const offShown = window.launcherApi.onWindowShown((payload) => {
      const data = payload as { prompt?: string } | null;
      if (data?.prompt) {
        updateActiveSession((session) => ({
          ...session,
          title: session.title === "新对话" ? titleFromPrompt(data.prompt ?? "") : session.title
        }));
      }
    });
    const offTheme = window.launcherApi.onThemeChanged((themeName) => setMode(themeName));
    return () => {
      offOutput();
      offShown();
      offTheme();
    };
  }, []);

  const conversationItems = useMemo<ConversationItemType[]>(
    () =>
      sessions.map((session) => ({
        key: session.key,
        label: session.title,
        group: session.group
      })),
    [sessions]
  );

  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      activeSession.messages.map((message) => ({
        key: message.id,
        role: message.role === "user" ? "user" : message.role === "error" ? "system" : "ai",
        content: message,
        header: null,
        avatar: null,
        extra: null,
        className: `ai-message ai-message-${message.role}`,
        streaming: message.streaming,
        variant: message.role === "user" ? "filled" : "borderless"
      })),
    [activeSession.messages]
  );

  const dark = mode === "dark";

  return (
    <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
      <XProvider>
        <App className="ai-react-app">
          <section className="ai-window ai-flow-window">
            <header className="ai-titlebar">
              <div className="ai-title-main">
                <h1>快速 AI</h1>
                <p>对话流、会话列表和 pi-coding RPC 输出</p>
              </div>
            </header>

            <div className="ai-flow-body">
              <aside className="ai-conversation-rail">
                <Button
                  block
                  icon={<PlusOutlined />}
                  type="primary"
                  onClick={() => {
                    const next = initialSession();
                    setSessions((current) => [next, ...current]);
                    setActiveKey(next.key);
                  }}
                >
                  新对话
                </Button>
                <Conversations
                  activeKey={activeKey}
                  className="ai-conversations"
                  groupable
                  items={conversationItems}
                  onActiveChange={(key) => setActiveKey(key)}
                />
                <div className="ai-settings-panel">
                  <label className="ai-setting-label">pi-coding 命令</label>
                  <Input
                    value={settings?.piCoding.command ?? ""}
                    onChange={(event) => {
                      const command = event.target.value;
                      setSettings((current) => (current ? { ...current, piCoding: { ...current.piCoding, command } } : current));
                    }}
                    onBlur={() => {
                      if (settings) {
                        void window.launcherApi.updateSettings({
                          ...settings,
                          piCoding: { command: settings.piCoding.command.trim() || "pi" }
                        });
                      }
                    }}
                  />
                  <div className="ai-skill-list">
                    {settings?.skills.map((skill) => (
                      <label className="ai-skill-row" key={skill.id}>
                        <span>{skill.name}</span>
                        <Switch
                          size="small"
                          checked={skill.enabled}
                          onChange={(checked) => {
                            if (!settings) {
                              return;
                            }
                            const next = {
                              ...settings,
                              skills: settings.skills.map((item) => (item.id === skill.id ? { ...item, enabled: checked } : item))
                            };
                            setSettings(next);
                            void window.launcherApi.updateSettings(next);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </aside>

              <main className="ai-chat-flow">
                <div className="ai-chat-scroll">
                  {bubbleItems.length > 0 ? (
                    <Bubble.List
                      autoScroll
                      className="ai-bubble-list"
                      items={bubbleItems}
                      role={{
                        ai: {
                          placement: "start",
                          typing: { effect: "fade-in" },
                          variant: "borderless",
                          contentRender: (content: ChatMessage) => renderAssistantMessage(content)
                        },
                        user: {
                          placement: "end",
                          variant: "filled",
                          contentRender: (content: ChatMessage) => <div className="ai-user-content">{content.content}</div>
                        },
                        system: {
                          placement: "start",
                          variant: "borderless",
                          contentRender: (content: ChatMessage) => renderAssistantMessage(content)
                        }
                      }}
                    />
                  ) : (
                    <div className="ai-empty-flow">从 Launcher 按 Tab 发送问题，或直接在下方输入。</div>
                  )}
                </div>
                <Sender
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  className="ai-sender"
                  loading={sending}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                  submitType="enter"
                  styles={{ suffix: { flexShrink: 0 }, input: { minWidth: 0 } }}
                  value={input}
                  onCancel={() => setSending(false)}
                  onChange={setInput}
                  onSubmit={(message) => {
                    setInput("");
                    void appendPrompt(message, window.launcherApi.sendAiPrompt);
                  }}
                />
              </main>
            </div>
          </section>
        </App>
      </XProvider>
    </ConfigProvider>
  );
}

export async function mountAiWindow(root: HTMLElement): Promise<void> {
  const initialTheme = await window.launcherApi.getTheme();
  createRoot(root).render(<AiWindow initialTheme={initialTheme} />);
}

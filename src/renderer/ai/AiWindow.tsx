import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider, Input, Switch, theme } from "antd";
import { CloseOutlined, ExpandOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Bubble, Conversations, Sender, XProvider, type BubbleItemType, type ConversationItemType } from "@ant-design/x";
import type { LauncherSettings, ThemeMode } from "../../main/types.js";

interface AiOutput {
  type: string;
  text: string;
  createdAt: number;
  eventType?: string;
  role?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
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

function shouldShowInChat(output: AiOutput): boolean {
  const text = output.text.trim();
  if (!text || output.type === "status") {
    return false;
  }
  if (["turn_start", "turn_end", "agent_start", "agent_end", "message_end", "response"].includes(output.eventType ?? "")) {
    return false;
  }
  return text !== "assistant" && text !== "user" && text !== "system";
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 28) : "新对话";
}

function messageFromOutput(output: AiOutput): ChatMessage | null {
  if (!shouldShowInChat(output)) {
    return null;
  }
  const role = output.role === "user" ? "user" : output.type === "stderr" || output.type === "exit" ? "error" : "assistant";
  return {
    id: `${output.createdAt}-${output.eventType ?? output.type}-${Math.random().toString(16).slice(2)}`,
    role,
    content: output.text,
    createdAt: output.createdAt,
    streaming: output.eventType === "message_update" && role === "assistant"
  };
}

function addOutputToMessages(messages: ChatMessage[], output: AiOutput): ChatMessage[] {
  if (output.eventType === "message_end" || output.eventType === "agent_end" || output.eventType === "turn_end") {
    return messages.map((item) => (item.streaming ? { ...item, streaming: false } : item));
  }

  const next = messageFromOutput(output);
  if (!next) {
    return messages;
  }

  if (next.role === "assistant" && output.eventType === "message_update") {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.streaming) {
      return [...messages.slice(0, -1), { ...last, content: `${last.content}${next.content}`, createdAt: next.createdAt }];
    }
  }

  return [...messages, next];
}

function buildMessages(logs: AiOutput[]): ChatMessage[] {
  return logs.reduce<ChatMessage[]>((items, output) => addOutputToMessages(items, output), []);
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
        content: message.content,
        streaming: message.streaming,
        variant: message.role === "error" ? "outlined" : "filled"
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
              <div className="ai-window-actions">
                <Button aria-label="最小化" icon={<MinusOutlined />} type="text" onClick={() => void window.launcherApi.controlWindow("minimize")} />
                <Button aria-label="最大化" icon={<ExpandOutlined />} type="text" onClick={() => void window.launcherApi.controlWindow("maximize")} />
                <Button aria-label="关闭" danger icon={<CloseOutlined />} type="text" onClick={() => void window.launcherApi.controlWindow("close")} />
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
                        ai: { placement: "start", avatar: <span className="ai-avatar">AI</span>, typing: { effect: "fade-in" } },
                        user: { placement: "end", avatar: <span className="ai-avatar">你</span> },
                        system: { placement: "start", avatar: <span className="ai-avatar">!</span>, variant: "outlined" }
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

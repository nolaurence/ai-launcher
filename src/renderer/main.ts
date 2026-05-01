import "./styles.css";
import { mountAiWindow } from "./ai/AiWindow";
import type { ClipboardEntry, LauncherApp, LauncherSettings } from "../main/types.js";

type LauncherResult =
  | { kind: "app"; app: LauncherApp }
  | { kind: "color"; value: string; label: string }
  | { kind: "calc"; value: string; label: string }
  | { kind: "command"; value: "clipboard" | "settings"; label: string };

const appRoot = document.querySelector<HTMLElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app root");
}
const app: HTMLElement = appRoot;

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "launcher";

function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

if (window.launcherApi) {
  void window.launcherApi.getTheme().then(applyTheme);
  window.launcherApi.onThemeChanged(applyTheme);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; title?: string } = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.title) {
    node.title = options.title;
  }
  return node;
}

function fileUrl(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const encoded = normalized
    .split("/")
    .map((part, index) => (index === 0 && /^[a-zA-Z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join("/");
  return `file:///${encoded}`;
}

function parseColor(input: string): { value: string; label: string } | null {
  const value = input.trim();
  const named = new Set(["red", "green", "blue", "black", "white", "transparent", "cyan", "magenta", "yellow", "orange", "purple"]);
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    return { value, label: value.toUpperCase() };
  }
  if (/^0x[0-9a-f]{6,8}$/i.test(value)) {
    const hex = value.slice(2);
    return { value: `#${hex.slice(-6)}`, label: `#${hex.slice(-6).toUpperCase()}` };
  }
  if (/^(rgb|rgba|hsl|hsla)\([\d\s.,%/-]+\)$/i.test(value)) {
    return { value, label: value };
  }
  if (named.has(value.toLowerCase())) {
    return { value, label: value.toLowerCase() };
  }
  return null;
}

function calculate(input: string): string | null {
  const expression = input.trim().replaceAll("×", "*").replaceAll("÷", "/").replaceAll("^", "**");
  if (!/[+\-*/%()]/.test(expression) || !/^[\d+\-*/%().\s*]+$/.test(expression)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${expression});`)() as unknown;
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return null;
    }
    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(10)));
  } catch {
    return null;
  }
}

function empty(node: HTMLElement): void {
  node.replaceChildren();
}

async function renderLauncher(): Promise<void> {
  app.className = "launcher-shell";
  const scale = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty("--launcher-search-height", `${115 / scale}px`);
  document.documentElement.style.setProperty("--launcher-row-height", `${80 / scale}px`);
  document.documentElement.style.setProperty("--launcher-footer-height", `${70 / scale}px`);
  const panel = el("section", { className: "launcher-panel" });
  const searchBar = el("div", { className: "launcher-searchbar" });
  const brand = el("span", { className: "launcher-brand", text: "M" });
  const input = el("input", { className: "launcher-input" });
  input.placeholder = "Search apps, colors, math...";
  input.autocomplete = "off";
  const aiHint = el("div", { className: "quick-ai-hint" });
  aiHint.append(el("span", { text: "Quick AI" }), el("kbd", { text: "Tab" }));

  searchBar.append(brand, input, aiHint);
  const resultsTitle = el("div", { className: "results-title", text: "Results" });
  const results = el("div", { className: "result-list" });
  const footer = el("footer", { className: "launcher-footer" });
  footer.append(
    el("span", { className: "footer-icon", text: "=" }),
    el("span", { className: "footer-action", text: "Open Command" }),
    el("kbd", { text: "Enter" }),
    el("span", { className: "footer-divider" }),
    el("span", { className: "footer-muted", text: "Actions" }),
    el("kbd", { text: "Ctrl" }),
    el("kbd", { text: "K" })
  );
  panel.append(searchBar, resultsTitle, results, footer);
  app.replaceChildren(panel);

  let active = 0;
  let current: LauncherResult[] = [];

  const update = async (): Promise<void> => {
    const query = input.value.trim();
    const next: LauncherResult[] = [];

    const color = parseColor(query);
    if (color) {
      next.push({ kind: "color", ...color });
    }

    const calc = calculate(query);
    if (calc) {
      next.push({ kind: "calc", value: calc, label: `${query} = ${calc}` });
    }

    if (/^(clip|剪贴板|clipboard)/i.test(query)) {
      next.push({ kind: "command", value: "clipboard", label: "打开剪贴板历史" });
    }

    if (/^(settings|设置|config)/i.test(query)) {
      next.push({ kind: "command", value: "settings", label: "打开设置" });
    }

    if (!window.launcherApi) {
      current = [];
      renderResults();
      return;
    }

    const apps = await window.launcherApi.searchApps(query);
    next.push(...apps.map((item) => ({ kind: "app" as const, app: item })));
    current = next.slice(0, 10);
    active = Math.min(active, Math.max(0, current.length - 1));
    renderResults();
  };

  const renderResults = (): void => {
    empty(results);
    if (current.length === 0) {
      results.append(el("div", { className: "empty-state", text: "继续输入以搜索应用或触发工具" }));
      return;
    }

    current.forEach((item, index) => {
      const row = el("button", { className: `result-row ${index === active ? "active" : ""}` });
      row.type = "button";
      const icon = el("span", { className: "result-icon" });
      const textWrap = el("span", { className: "result-text-wrap" });
      const text = el("span", { className: "result-text" });
      const subtext = el("span", { className: "result-subtext" });
      const meta = el("span", { className: "result-meta" });

      if (item.kind === "app") {
        icon.textContent = item.app.name.slice(0, 1).toUpperCase();
        text.textContent = item.app.name;
        subtext.textContent = item.app.source === "start-menu" ? "Apps" : "Path";
        meta.textContent = "Open";
      } else if (item.kind === "color") {
        icon.classList.add("swatch");
        icon.style.background = item.value;
        text.textContent = item.label;
        subtext.textContent = "Color";
        meta.textContent = "Copy";
      } else if (item.kind === "calc") {
        icon.textContent = "=";
        text.textContent = item.label;
        subtext.textContent = "Calculator";
        meta.textContent = "Copy";
      } else {
        icon.textContent = item.value === "settings" ? "S" : "C";
        text.textContent = item.label;
        subtext.textContent = "Mica Launcher";
        meta.textContent = "Command";
      }

      textWrap.append(text, subtext);
      row.append(icon, textWrap, meta);
      row.addEventListener("click", () => void runResult(item));
      results.append(row);
    });
  };

  const runResult = async (item: LauncherResult): Promise<void> => {
    if (item.kind === "app") {
      await window.launcherApi.openApp(item.app.path);
    } else if (item.kind === "command" && item.value === "clipboard") {
      await window.launcherApi.showWindow("clipboard");
      await window.launcherApi.hideWindow();
    } else if (item.kind === "command" && item.value === "settings") {
      await window.launcherApi.showWindow("ai", { settings: true });
      await window.launcherApi.hideWindow();
    } else if (item.kind === "calc" || item.kind === "color") {
      await window.launcherApi.writeClipboardText(item.value);
      await window.launcherApi.hideWindow();
    }
  };

  input.addEventListener("input", () => void update());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const prompt = input.value.trim();
      if (prompt) {
        void window.launcherApi.askAi(prompt);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(active + 1, current.length - 1);
      renderResults();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      renderResults();
    }
    if (event.key === "Enter" && current[active]) {
      event.preventDefault();
      void runResult(current[active]);
    }
    if (event.key === "Escape") {
      void window.launcherApi.hideWindow();
    }
  });

  window.launcherApi.onWindowShown(() => {
    input.value = "";
    active = 0;
    input.focus();
    void update();
  });
  input.focus();
  await update();
}

async function renderClipboard(): Promise<void> {
  app.className = "page-shell";
  const root = el("section", { className: "tool-window" });
  const header = el("header", { className: "window-header" });
  header.append(el("h1", { text: "剪贴板历史" }), el("p", { text: "最多保存 1000 条，可在设置中调整" }));
  const grid = el("div", { className: "clipboard-grid" });
  root.append(header, grid);
  app.replaceChildren(root);

  const settings = await window.launcherApi.getSettings();
  const maxInput = el("input", { className: "small-input", title: "剪贴板最大条数" });
  maxInput.type = "number";
  maxInput.min = "1";
  maxInput.max = "1000";
  maxInput.value = String(settings.clipboardMaxItems);
  maxInput.addEventListener("change", () => {
    const value = Math.min(1000, Math.max(1, Number(maxInput.value) || 1000));
    void window.launcherApi.updateSettings({ ...settings, clipboardMaxItems: value });
  });
  header.append(maxInput);

  const renderItems = async (): Promise<void> => {
    const items = await window.launcherApi.listClipboard();
    empty(grid);
    for (const item of items) {
      const card = el("button", { className: "clip-card" });
      card.type = "button";
      const preview = el("div", { className: "clip-preview" });
      const meta = el("span", { className: "clip-meta", text: `${item.type} · ${new Date(item.createdAt).toLocaleString()}` });

      if (item.type === "image" && item.previewPath) {
        const image = el("img");
        image.src = fileUrl(item.previewPath);
        preview.append(image);
      } else if (item.type === "video" && item.filePath) {
        const video = el("video");
        video.src = fileUrl(item.filePath);
        video.controls = true;
        preview.append(video);
      } else {
        preview.textContent = item.text ?? item.filePath ?? "";
      }

      card.append(preview, meta);
      card.addEventListener("click", () => void window.launcherApi.useClipboard(item.id));
      grid.append(card);
    }

    if (items.length === 0) {
      grid.append(el("div", { className: "empty-state", text: "复制文本、图片或文件后会出现在这里" }));
    }
  };

  window.launcherApi.onWindowShown(() => void renderItems());
  await renderItems();
}

async function renderAi(): Promise<void> {
  app.className = "page-shell";
  let settings = await window.launcherApi.getSettings();
  const root = el("section", { className: "ai-window" });
  const header = el("header", { className: "window-header ai-header" });
  const titleBlock = el("div");
  titleBlock.append(el("h1", { text: "快速 AI" }), el("p", { text: "复用 pi-coding 能力，支持技能管理与本地对话页" }));
  const promptBadge = el("span", { className: "prompt-badge", text: "等待 Launcher 输入" });
  header.append(titleBlock, promptBadge);

  const body = el("div", { className: "ai-body" });
  const side = el("aside", { className: "ai-side" });
  const main = el("section", { className: "ai-main" });
  const chat = el("div", { className: "pi-chat" });
  const emptyChat = el("div", { className: "pi-empty", text: "Ask something from Launcher to start a pi session." });
  chat.append(emptyChat);
  const consolePanel = el("pre", { className: "ai-console" });
  let activeAssistantBubble: HTMLElement | null = null;
  const shouldShowInChat = (output: { type: string; text: string; eventType?: string; role?: string }): boolean => {
    const text = output.text.trim();
    if (!text) {
      return false;
    }
    if (output.type === "status") {
      return false;
    }
    if (["turn_start", "turn_end", "agent_start", "agent_end", "message_end", "response"].includes(output.eventType ?? "")) {
      return false;
    }
    if (text === "assistant" || text === "user" || text === "system") {
      return false;
    }
    return true;
  };
  const appendChat = (output: { type: string; text: string; eventType?: string; role?: string }): void => {
    if (output.eventType === "message_end" || output.eventType === "agent_end" || output.eventType === "turn_end") {
      activeAssistantBubble = null;
    }
    if (!shouldShowInChat(output)) {
      return;
    }

    emptyChat.remove();

    if (output.eventType === "message_update" && output.type === "stdout" && output.role !== "user") {
      if (!activeAssistantBubble) {
        activeAssistantBubble = el("div", { className: "pi-message assistant" });
        activeAssistantBubble.append(el("span", { className: "pi-message-label", text: "assistant" }), el("div", { className: "pi-message-content" }));
        chat.append(activeAssistantBubble);
      }
      const content = activeAssistantBubble.querySelector<HTMLElement>(".pi-message-content");
      if (content) {
        content.textContent = `${content.textContent ?? ""}${output.text}`;
      }
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    const message = el("div", { className: `pi-message ${output.role === "user" ? "user" : output.type}` });
    const label = el("span", { className: "pi-message-label", text: output.role ?? output.eventType ?? output.type });
    const content = el("div", { className: "pi-message-content", text: output.text });
    message.append(label, content);
    chat.append(message);
    if (output.eventType === "message_end" || output.eventType === "agent_end" || output.eventType === "turn_end") {
      activeAssistantBubble = null;
    }
    chat.scrollTop = chat.scrollHeight;
  };
  const appendOutput = (output: { type: string; text: string; createdAt: number; eventType?: string; role?: string }): void => {
    appendChat(output);
    const time = new Date(output.createdAt).toLocaleTimeString();
    const prefix = output.eventType ? `${output.type.toUpperCase()} ${output.eventType}` : output.type.toUpperCase();
    consolePanel.textContent += `[${time}] ${prefix} ${output.text || ""}`;
    if (!output.text.endsWith("\n")) {
      consolePanel.textContent += "\n";
    }
    consolePanel.scrollTop = consolePanel.scrollHeight;
  };

  const command = el("input", { className: "settings-input", title: "pi-coding 命令" });
  command.value = settings.piCoding.command;
  const save = el("button", { className: "primary-button", text: "保存配置" });
  save.type = "button";
  save.addEventListener("click", async () => {
    settings = await window.launcherApi.updateSettings({
      ...settings,
      piCoding: {
        command: command.value.trim() || "pi"
      }
    });
    const started = await window.launcherApi.startAi();
    activeAssistantBubble = null;
    empty(chat);
    chat.append(emptyChat);
    empty(consolePanel);
    for (const output of started.logs) {
      appendOutput(output);
    }
  });

  side.append(el("h2", { text: "pi-coding" }), command, save, el("h2", { text: "技能管理" }));
  for (const skill of settings.skills) {
    const label = el("label", { className: "skill-toggle" });
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = skill.enabled;
    checkbox.addEventListener("change", async () => {
      settings = await window.launcherApi.updateSettings({
        ...settings,
        skills: settings.skills.map((item) => (item.id === skill.id ? { ...item, enabled: checkbox.checked } : item))
      });
    });
    label.append(checkbox, el("span", { text: skill.name }));
    side.append(label);
  }

  main.append(chat, consolePanel);
  body.append(side, main);
  root.append(header, body);
  app.replaceChildren(root);
  window.launcherApi.onAiOutput(appendOutput);

  const started = await window.launcherApi.startAi();
  activeAssistantBubble = null;
  empty(chat);
  chat.append(emptyChat);
  empty(consolePanel);
  for (const output of started.logs) {
    appendOutput(output);
  }

  window.launcherApi.onWindowShown((payload) => {
    const data = payload as { prompt?: string } | null;
    promptBadge.textContent = data?.prompt ? data.prompt : "pi-coding";
  });
}

async function renderClipboardPanel(): Promise<void> {
  app.className = "clipboard-shell";
  const scale = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty("--clipboard-header-height", `${120 / scale}px`);
  document.documentElement.style.setProperty("--clipboard-footer-height", `${80 / scale}px`);
  const root = el("section", { className: "clipboard-window" });
  const header = el("header", { className: "clipboard-header" });
  const back = el("button", { className: "clipboard-back", text: "<", title: "Back to launcher" });
  back.type = "button";
  const filter = el("input", { className: "clipboard-filter" });
  filter.placeholder = "Type to filter entries...";
  filter.autocomplete = "off";
  const typeSelect = el("select", { className: "clipboard-type" });

  for (const [value, label] of [
    ["all", "All Types"],
    ["text", "Text"],
    ["image", "Image"],
    ["file", "File"],
    ["video", "Video"]
  ]) {
    const option = el("option", { text: label });
    option.value = value;
    typeSelect.append(option);
  }

  const body = el("div", { className: "clipboard-body" });
  const listPane = el("aside", { className: "clipboard-list-pane" });
  const sectionTitle = el("div", { className: "clipboard-section-title", text: "Today" });
  const list = el("div", { className: "clipboard-list" });
  listPane.append(sectionTitle, list);

  const previewPane = el("section", { className: "clipboard-preview-pane" });
  const preview = el("div", { className: "clipboard-preview-large" });
  const info = el("div", { className: "clipboard-info" });
  previewPane.append(preview, info);

  const footer = el("footer", { className: "launcher-footer clipboard-footer" });
  footer.append(
    el("span", { className: "footer-icon", text: "=" }),
    el("span", { className: "footer-action", text: "Paste" }),
    el("kbd", { text: "Enter" }),
    el("span", { className: "footer-divider" }),
    el("span", { className: "footer-muted", text: "Actions" }),
    el("kbd", { text: "Ctrl" }),
    el("kbd", { text: "K" })
  );

  header.append(back, filter, typeSelect);
  body.append(listPane, previewPane);
  root.append(header, body, footer);
  app.replaceChildren(root);

  let items: ClipboardEntry[] = [];
  let active = 0;

  const backToLauncher = async (): Promise<void> => {
    await window.launcherApi.hideWindow();
    await window.launcherApi.showWindow("launcher");
  };

  const entryTitle = (item: ClipboardEntry): string => {
    if (item.type === "image") {
      return `Image (${new Date(item.createdAt).toLocaleString()})`;
    }
    if (item.type === "video") {
      return `Video (${new Date(item.createdAt).toLocaleString()})`;
    }
    const value = item.text ?? item.filePath ?? "";
    return value.length > 42 ? `${value.slice(0, 42)}...` : value;
  };

  const filteredItems = (): ClipboardEntry[] => {
    const query = filter.value.trim().toLowerCase();
    const selectedType = typeSelect.value;
    return items.filter((item) => {
      const matchesType = selectedType === "all" || item.type === selectedType;
      const haystack = `${item.type} ${item.text ?? ""} ${item.filePath ?? ""}`.toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });
  };

  const showPreview = (item: ClipboardEntry | undefined): void => {
    empty(preview);
    empty(info);
    if (!item) {
      preview.append(el("div", { className: "empty-state", text: "No clipboard entry selected" }));
      return;
    }

    if (item.type === "image" && item.previewPath) {
      preview.append(el("div", { className: "empty-state", text: "Loading image..." }));
      void window.launcherApi.getClipboardImageDataUrl(item.id).then((dataUrl) => {
        empty(preview);
        if (dataUrl) {
          const image = el("img");
          image.src = dataUrl;
          preview.append(image);
        } else {
          preview.append(el("div", { className: "empty-state", text: "Image preview unavailable" }));
        }
      });
    } else if (item.type === "video" && item.filePath) {
      const video = el("video");
      video.src = fileUrl(item.filePath);
      video.controls = true;
      preview.append(video);
    } else {
      preview.textContent = item.text ?? item.filePath ?? "";
    }

    info.append(el("h2", { text: "Information" }));
    for (const [label, value] of [
      ["Source", "Clipboard"],
      ["Type", item.type],
      ["Created", new Date(item.createdAt).toLocaleString()],
      ["Path", item.filePath ?? item.previewPath ?? ""]
    ]) {
      const row = el("div", { className: "clipboard-info-row" });
      row.append(el("span", { text: label }), el("strong", { text: value || "-" }));
      info.append(row);
    }
  };

  const renderListOnly = (): void => {
    const visible = filteredItems();
    for (const [index, node] of Array.from(list.children).entries()) {
      node.classList.toggle("active", index === active);
    }
    list.children.item(active)?.scrollIntoView({ block: "nearest" });
    showPreview(visible[active]);
  };

  const renderItems = async (): Promise<void> => {
    items = await window.launcherApi.listClipboard();
    const visible = filteredItems();
    active = Math.min(active, Math.max(0, visible.length - 1));
    empty(list);
    for (const [index, item] of visible.entries()) {
      const row = el("button", { className: `clipboard-entry ${index === active ? "active" : ""}` });
      row.type = "button";
      const thumb = el("span", { className: `clipboard-thumb ${item.type}` });
      if (item.type === "image" && item.previewPath) {
        thumb.textContent = "I";
        void window.launcherApi.getClipboardImageDataUrl(item.id).then((dataUrl) => {
          if (dataUrl) {
            const image = el("img");
            image.src = dataUrl;
            thumb.replaceChildren(image);
          }
        });
      } else {
        thumb.textContent = item.type === "text" ? "T" : item.type.slice(0, 1).toUpperCase();
      }
      row.append(thumb, el("span", { className: "clipboard-entry-title", text: entryTitle(item) }));
      row.addEventListener("click", () => {
        active = index;
        renderListOnly();
      });
      row.addEventListener("dblclick", () => void window.launcherApi.useClipboard(item.id));
      list.append(row);
    }

    if (visible.length === 0) {
      list.append(el("div", { className: "empty-state", text: "No clipboard history yet" }));
    }
    showPreview(visible[active]);
  };

  back.addEventListener("click", () => void backToLauncher());
  filter.addEventListener("input", () => {
    active = 0;
    void renderItems();
  });
  typeSelect.addEventListener("change", () => {
    active = 0;
    void renderItems();
  });
  window.addEventListener("keydown", (event) => {
    const visible = filteredItems();
    if (event.key === "Escape") {
      event.preventDefault();
      void backToLauncher();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(active + 1, visible.length - 1);
      renderListOnly();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      renderListOnly();
    }
    if (event.key === "Enter" && visible[active]) {
      event.preventDefault();
      void window.launcherApi.useClipboard(visible[active].id);
    }
  });

  window.launcherApi.onWindowShown(() => {
    filter.focus();
    void renderItems();
  });
  await renderItems();
}

if (view === "clipboard") {
  void renderClipboardPanel();
} else if (view === "ai") {
  void mountAiWindow(app);
} else {
  void renderLauncher();
}

import "./styles.css";
import type { ClipboardEntry, LauncherApp, LauncherSettings } from "../main/types.js";

type LauncherResult =
  | { kind: "app"; app: LauncherApp }
  | { kind: "color"; value: string; label: string }
  | { kind: "calc"; value: string; label: string }
  | { kind: "command"; value: "clipboard" | "settings"; label: string };

const app = document.querySelector<HTMLMainElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "launcher";

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
  return `file:///${normalized.split("/").map(encodeURIComponent).join("/")}`;
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
  titleBlock.append(el("h1", { text: "快速 AI" }), el("p", { text: "复用 pi-coding 能力，支持技能管理与 web-ui 对话页" }));
  const promptBadge = el("span", { className: "prompt-badge", text: "等待 Launcher 输入" });
  header.append(titleBlock, promptBadge);

  const body = el("div", { className: "ai-body" });
  const side = el("aside", { className: "ai-side" });
  const frame = el("iframe", { className: "ai-frame", title: "pi-coding web ui" });
  frame.src = settings.piCoding.webUrl;

  const webUrl = el("input", { className: "settings-input", title: "pi-coding web-ui 地址" });
  webUrl.value = settings.piCoding.webUrl;
  const apiBaseUrl = el("input", { className: "settings-input", title: "pi-coding API 地址" });
  apiBaseUrl.value = settings.piCoding.apiBaseUrl;
  const command = el("input", { className: "settings-input", title: "pi-coding 命令" });
  command.value = settings.piCoding.command;
  const save = el("button", { className: "primary-button", text: "保存配置" });
  save.type = "button";
  save.addEventListener("click", async () => {
    settings = await window.launcherApi.updateSettings({
      ...settings,
      piCoding: {
        webUrl: webUrl.value.trim() || settings.piCoding.webUrl,
        apiBaseUrl: apiBaseUrl.value.trim(),
        command: command.value.trim()
      }
    });
    frame.src = settings.piCoding.webUrl;
  });

  side.append(el("h2", { text: "pi-coding" }), webUrl, apiBaseUrl, command, save, el("h2", { text: "技能管理" }));
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

  body.append(side, frame);
  root.append(header, body);
  app.replaceChildren(root);

  window.launcherApi.onWindowShown((payload) => {
    const data = payload as { url?: string; prompt?: string } | null;
    if (data?.url) {
      frame.src = data.url;
    }
    promptBadge.textContent = data?.prompt ? data.prompt : "pi-coding";
  });
}

if (view === "clipboard") {
  void renderClipboard();
} else if (view === "ai") {
  void renderAi();
} else {
  void renderLauncher();
}

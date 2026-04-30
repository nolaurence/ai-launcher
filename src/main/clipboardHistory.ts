import { app, clipboard, nativeImage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ClipboardEntry } from "./types.js";

const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".wmv"]);

export class ClipboardHistory {
  private entries: ClipboardEntry[] = [];
  private lastSignature = "";
  private timer: NodeJS.Timeout | undefined;

  constructor(private maxItems: number) {}

  start(): void {
    this.load();
    this.timer = setInterval(() => this.capture(), 800);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  setMaxItems(maxItems: number): void {
    this.maxItems = Math.max(1, maxItems);
    this.entries = this.entries.slice(0, this.maxItems);
    this.save();
  }

  list(): ClipboardEntry[] {
    return this.entries;
  }

  write(entryId: string): boolean {
    const entry = this.entries.find((item) => item.id === entryId);
    if (!entry) {
      return false;
    }

    if (entry.type === "image" && entry.previewPath) {
      const image = nativeImage.createFromPath(entry.previewPath);
      if (!image.isEmpty()) {
        clipboard.writeImage(image);
        return true;
      }
    }

    if (entry.text) {
      clipboard.writeText(entry.text);
      return true;
    }

    if (entry.filePath) {
      clipboard.writeText(entry.filePath);
      return true;
    }

    return false;
  }

  private capture(): void {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const png = image.toPNG();
      const signature = `image:${png.byteLength}:${png.subarray(0, 24).toString("base64")}`;
      if (signature !== this.lastSignature) {
        const filePath = join(this.assetsDir(), `${Date.now()}.png`);
        writeFileSync(filePath, png);
        this.push({ id: randomUUID(), type: "image", previewPath: filePath, createdAt: Date.now() }, signature);
      }
      return;
    }

    const text = clipboard.readText().trim();
    if (!text) {
      return;
    }

    const type = this.detectTextType(text);
    const signature = `${type}:${text}`;
    if (signature === this.lastSignature) {
      return;
    }

    this.push(
      {
        id: randomUUID(),
        type,
        text,
        filePath: type === "file" || type === "video" ? text : undefined,
        createdAt: Date.now()
      },
      signature
    );
  }

  private detectTextType(text: string): ClipboardEntry["type"] {
    if (existsSync(text)) {
      return videoExtensions.has(extname(text).toLowerCase()) ? "video" : "file";
    }
    return "text";
  }

  private push(entry: ClipboardEntry, signature: string): void {
    this.lastSignature = signature;
    this.entries = [entry, ...this.entries.filter((item) => this.entrySignature(item) !== signature)].slice(0, this.maxItems);
    this.save();
  }

  private entrySignature(entry: ClipboardEntry): string {
    if (entry.type === "image") {
      return `image:${basename(entry.previewPath ?? "")}`;
    }
    return `${entry.type}:${entry.text ?? entry.filePath ?? ""}`;
  }

  private storagePath(): string {
    return join(app.getPath("userData"), "clipboard-history.json");
  }

  private assetsDir(): string {
    const path = join(app.getPath("userData"), "clipboard-assets");
    mkdirSync(path, { recursive: true });
    return path;
  }

  private load(): void {
    const path = this.storagePath();
    if (!existsSync(path)) {
      return;
    }

    try {
      this.entries = (JSON.parse(readFileSync(path, "utf8")) as ClipboardEntry[]).slice(0, this.maxItems);
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    const path = this.storagePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.entries, null, 2), "utf8");
  }
}

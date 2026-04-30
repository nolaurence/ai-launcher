import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "index.html")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});

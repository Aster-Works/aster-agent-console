import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Same single source of truth the CLI uses (tsup define) — the sidebar version
// can no longer drift from package.json.
const version: string = JSON.parse(readFileSync("./package.json", "utf8")).version;

// Aster Agent Audit — dashboard build.
// The dashboard is a fully static SPA; the CLI serves dist/web.
export default defineConfig({
  define: { __AAC_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@web": fileURLToPath(new URL("./src/web", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    // In dev the dashboard runs on 5173 and the collector on 48321; proxy the
    // API/collector so the live data toggle works against a running server.
    proxy: {
      "/api": "http://127.0.0.1:48321",
      "/events": "http://127.0.0.1:48321",
      "/health": "http://127.0.0.1:48321",
    },
  },
});

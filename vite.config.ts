import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "path";

// One dev server (:5173) runs both the React client (HMR) and the Worker
// (server/index.ts in workerd, with a local D1) — the same shape as prod.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      configPath: path.resolve(import.meta.dirname, "wrangler.jsonc"),
      // Share local D1 state with the wrangler CLI (npm run db:migrate).
      persistState: { path: path.resolve(import.meta.dirname, ".wrangler/state") },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@eightsleep": path.resolve(import.meta.dirname, "eightsleep"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  // The cloudflare plugin appends one folder per environment:
  // dist/client (static assets) and dist/eightfajr (the Worker).
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true, deny: ["**/.*"] },
  },
});

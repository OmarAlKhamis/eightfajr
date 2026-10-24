import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests run in plain Node (WebCrypto + full ICU are built in on Node 22+).
export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "eightsleep/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@eightsleep": path.resolve(import.meta.dirname, "eightsleep"),
    },
  },
});

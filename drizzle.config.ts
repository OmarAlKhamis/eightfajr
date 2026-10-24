import { defineConfig } from "drizzle-kit";

// Generates D1/SQLite migrations into ./migrations. Apply them with:
//   npm run db:migrate        (local dev database)
//   npm run db:migrate:prod   (the real D1 database)
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
});

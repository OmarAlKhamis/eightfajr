import type { Hono } from "hono";
import type { AppEnv } from "../env";
import { registerAuthRoutes } from "./auth";
import { registerConnectRoutes } from "./connect";
import { registerSettingsRoutes } from "./settings";
import { registerMiscRoutes } from "./misc";

export function registerRoutes(app: Hono<AppEnv>) {
  registerAuthRoutes(app);
  registerConnectRoutes(app);
  registerSettingsRoutes(app);
  registerMiscRoutes(app);
}

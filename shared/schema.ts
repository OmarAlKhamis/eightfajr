import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// All timestamps are ISO-8601 UTC strings (D1 is SQLite; TEXT keeps them sortable
// and readable). Ids are UUIDs generated in the Worker (crypto.randomUUID()).

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(), // always lower-cased
  locale: text("locale", { enum: ["ar", "en"] }).notNull().default("ar"),
  createdAt: text("created_at").notNull(),
  lastLoginAt: text("last_login_at"),
});

// Magic-link sign-in. Only the SHA-256 of the token is stored; the raw token lives
// in the emailed URL. Single use, 15-minute expiry.
export const magicLinks = sqliteTable(
  "magic_links",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("magic_links_email_idx").on(t.email)],
);

// One Eight Sleep account per app user. The password is NEVER stored; the access
// token is AES-256-GCM encrypted (server/crypto.ts) with a key held only in env.
export const eightConnections = sqliteTable("eight_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  eightUserId: text("eight_user_id").notNull(),
  // IANA zone of the Eight Sleep profile — alarm `time` strings are wall-clock in it.
  eightTimezone: text("eight_timezone"),
  accessTokenEnc: text("access_token_enc").notNull(),
  tokenExpiresAt: text("token_expires_at"),
  status: text("status", { enum: ["connected", "needs_reconnect", "no_subscription"] })
    .notNull()
    .default("connected"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  attentionEmailSentAt: text("attention_email_sent_at"),
  lastErrorCode: text("last_error_code"),
  connectedAt: text("connected_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const alarmSettings = sqliteTable("alarm_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  cityName: text("city_name").notNull(),
  countryCode: text("country_code").notNull(), // ISO-3166 alpha-2
  admin1: text("admin1"),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  timezone: text("timezone").notNull(), // IANA zone of the city
  method: text("method").notNull(), // shared/methods.ts MethodKey
  offsetMinutes: integer("offset_minutes").notNull().default(0), // -60..60, negative = before Fajr
  vibrationEnabled: integer("vibration_enabled", { mode: "boolean" }).notNull().default(true),
  vibrationPower: integer("vibration_power").notNull().default(50), // 20 | 50 | 100
  thermalEnabled: integer("thermal_enabled", { mode: "boolean" }).notNull().default(true),
  thermalLevel: integer("thermal_level").notNull().default(0), // -100..100
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

// The ONE alarm we manage on the user's Pod. `scheduledForUtc` is the instant we
// last pushed; the cron compares it with "now" to decide whether a user is due.
export const managedAlarms = sqliteTable("managed_alarms", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  eightAlarmId: text("eight_alarm_id").notNull(),
  scheduledForUtc: text("scheduled_for_utc"),
  scheduledLocal: text("scheduled_local"), // "HH:MM:SS" in eightTimezone
  pushedEnabled: integer("pushed_enabled", { mode: "boolean" }).notNull().default(true),
  recreatedCount: integer("recreated_count").notNull().default(0),
  lastPushedAt: text("last_pushed_at"),
});

export const syncLog = sqliteTable(
  "sync_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"), // nulled on disconnect (no FK on purpose)
    startedAt: text("started_at").notNull(),
    trigger: text("trigger", { enum: ["cron", "settings", "resume", "pause", "connect", "manual"] }).notNull(),
    result: text("result", {
      enum: ["updated", "created", "recreated", "skipped", "paused", "failed"],
    }).notNull(),
    errorCode: text("error_code"),
    message: text("message"),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("sync_log_user_idx").on(t.userId, t.startedAt), index("sync_log_started_idx").on(t.startedAt)],
);

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  rating: text("rating", { enum: ["up", "down"] }).notNull(),
  comment: text("comment"),
  page: text("page").notNull(),
  locale: text("locale").notNull(),
  createdAt: text("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type MagicLink = typeof magicLinks.$inferSelect;
export type EightConnection = typeof eightConnections.$inferSelect;
export type AlarmSettings = typeof alarmSettings.$inferSelect;
export type ManagedAlarm = typeof managedAlarms.$inferSelect;
export type SyncLogEntry = typeof syncLog.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;

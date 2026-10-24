import type { EightErrorCode } from "@eightsleep/index";
import { capture } from "./analytics";
import { createDb, nowIso } from "./db";
import { decryptString } from "./crypto";
import { getEightSleep, getQueue } from "./eight";
import { sendNeedsAttention } from "./email";
import type { Env } from "./env";
import { Storage } from "./storage";
import { syncUser, type SyncDeps, type SyncResult, type SyncTrigger } from "./sync";

// The hourly job (wrangler.jsonc triggers.crons). For every due user, run one
// idempotent sync through the serial queue so we never burst Eight Sleep.

export interface CronSummary {
  startedAt: string;
  due: number;
  results: Record<SyncResult, number>;
  durationMs: number;
}

export function buildSyncDeps(env: Env, storage: Storage): SyncDeps {
  return {
    store: storage,
    eight: getEightSleep(env),
    decryptToken: (enc) => decryptString(env.TOKEN_ENCRYPTION_KEY, enc),
    notifyNeedsAttention: async (userId: string, code: EightErrorCode) => {
      const user = await storage.getUser(userId);
      if (user) await sendNeedsAttention(env, user.email, user.locale, code);
    },
    analytics: (event, userId, props) => capture(env, event, userId, props),
  };
}

export async function runScheduledSync(env: Env, trigger: SyncTrigger = "cron", nowMs = Date.now()): Promise<CronSummary> {
  const startedAt = nowIso(nowMs);
  const storage = new Storage(createDb(env.DB));
  const deps = buildSyncDeps(env, storage);
  const queue = getQueue();

  const due = await storage.listDueUsers(startedAt);
  const results: Record<SyncResult, number> = { updated: 0, created: 0, recreated: 0, skipped: 0, paused: 0, failed: 0 };

  for (const { userId } of due) {
    try {
      const outcome = await queue.run(() => syncUser(deps, userId, { trigger }));
      results[outcome.result]++;
    } catch (e) {
      // syncUser catches API errors itself; this guards storage/crypto failures.
      results.failed++;
      console.error("sync crashed", userId.slice(0, 8), e instanceof Error ? e.message : e);
    }
  }

  // Housekeeping: expired magic links older than a day.
  await storage.purgeExpiredMagicLinks(nowIso(nowMs - 86_400_000)).catch(() => {});

  const summary: CronSummary = { startedAt, due: due.length, results, durationMs: Date.now() - nowMs };
  console.log("hourly sync", JSON.stringify(summary));
  return summary;
}

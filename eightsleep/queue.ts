import { EightSleepError, isEightSleepError } from "./errors";

// Two tools for being a polite client of a private, rate-limited API:
//  - withRetry: exponential backoff with full jitter on 429 / 5xx / network.
//  - SerialQueue: one request at a time with a minimum gap, so a cron run that
//    touches many users never bursts.

export interface RetryOptions {
  attempts?: number; // total attempts incl. the first
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number; // injectable for tests
  onRetry?: (err: EightSleepError, attempt: number, delayMs: number) => void;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 20_000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isEightSleepError(err) || !err.retryable || attempt === attempts) throw err;
      // Full jitter: U(0, min(max, base * 2^(n-1))), floored at the server's Retry-After.
      const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      let delay = Math.floor(random() * cap);
      if (err.retryAfterMs && err.retryAfterMs > delay) delay = Math.min(maxMs, err.retryAfterMs);
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private lastFinishedAt = 0;

  constructor(
    private readonly minGapMs = 300,
    private readonly jitterMs = 200,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const gap = this.minGapMs + Math.floor(this.random() * this.jitterMs);
      const wait = this.lastFinishedAt + gap - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await fn();
      } finally {
        this.lastFinishedAt = this.now();
      }
    });
    // Keep the chain alive even when a job rejects.
    this.tail = next.catch(() => undefined);
    return next;
  }
}

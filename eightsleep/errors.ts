export type EightErrorCode =
  | "INVALID_CREDENTIALS" // login rejected
  | "AUTH_FAILED" // 401 on an API call: token expired/revoked → user must reconnect
  | "NO_SUBSCRIPTION" // 403 mentioning subscription: alarms need Autopilot
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVER_ERROR" // 5xx
  | "NETWORK" // fetch threw / timeout
  | "UNEXPECTED_RESPONSE" // 2xx but not the JSON we expected
  | "UNKNOWN";

const RETRYABLE: ReadonlySet<EightErrorCode> = new Set(["RATE_LIMITED", "SERVER_ERROR", "NETWORK"]);

export class EightSleepError extends Error {
  readonly code: EightErrorCode;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(code: EightErrorCode, message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    // Messages are safe to log: they never contain tokens, passwords or bodies.
    super(message);
    this.name = "EightSleepError";
    this.code = code;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export function isEightSleepError(e: unknown): e is EightSleepError {
  return e instanceof EightSleepError;
}

export function codeOf(e: unknown): EightErrorCode {
  return isEightSleepError(e) ? e.code : "UNKNOWN";
}

/** Map an HTTP failure to a typed error. `snippet` is a short, sanitised body excerpt. */
export function errorFromStatus(status: number, snippet: string, retryAfterMs?: number): EightSleepError {
  if (status === 401) return new EightSleepError("AUTH_FAILED", "Eight Sleep rejected the token (401)", { status });
  if (status === 403) {
    if (/subscri/i.test(snippet)) {
      return new EightSleepError("NO_SUBSCRIPTION", "Eight Sleep alarms require an active Autopilot subscription (403)", { status });
    }
    return new EightSleepError("FORBIDDEN", "Eight Sleep refused the request (403)", { status });
  }
  if (status === 404) return new EightSleepError("NOT_FOUND", "Eight Sleep resource not found (404)", { status });
  if (status === 429) return new EightSleepError("RATE_LIMITED", "Eight Sleep rate limit (429)", { status, retryAfterMs });
  if (status >= 500) return new EightSleepError("SERVER_ERROR", `Eight Sleep server error (${status})`, { status });
  return new EightSleepError("UNKNOWN", `Eight Sleep returned ${status}`, { status });
}

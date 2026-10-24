import { createEightSleepClient, MockEightSleep, SerialQueue, type EightSleepApi } from "@eightsleep/index";
import { isMock, type Env } from "./env";

// One API instance and one serial queue per isolate. The mock keeps its state at
// module level so a dev session (and the smoke test) sees a consistent fake Pod.

let mock: MockEightSleep | null = null;
let real: EightSleepApi | null = null;
let queue: SerialQueue | null = null;

export function getMock(): MockEightSleep {
  if (!mock) mock = new MockEightSleep();
  return mock;
}

export function getEightSleep(env: Env): EightSleepApi {
  if (isMock(env)) return getMock();
  if (!real) {
    if (!env.EIGHT_CLIENT_ID || !env.EIGHT_CLIENT_SECRET) {
      throw new Error("EIGHT_CLIENT_ID / EIGHT_CLIENT_SECRET are not configured (or set EIGHT_MOCK=1)");
    }
    real = createEightSleepClient({ clientId: env.EIGHT_CLIENT_ID, clientSecret: env.EIGHT_CLIENT_SECRET });
  }
  return real;
}

export function getQueue(): SerialQueue {
  if (!queue) queue = new SerialQueue(300, 200);
  return queue;
}

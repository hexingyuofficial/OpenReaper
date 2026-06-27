import type { Result } from "@streetlight/core";
import type { FileQueueClient } from "../transport/file-queue.js";

export interface PingResult {
  bridge: string;
  reaper_version: string;
}

/** Step 1's only template. Returns a Result; never throws. */
export async function ping(
  client: FileQueueClient,
  timeoutMs = 5000,
): Promise<Result<PingResult>> {
  return client.send<PingResult>("ping", {}, { timeoutMs });
}

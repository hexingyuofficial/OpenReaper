import { promises as fs } from "node:fs";
import path from "node:path";

export type FakeBridgeResponse =
  | { ok: true; result: unknown }
  | {
      ok: false;
      error: { code: string; message: string; recoverable: boolean };
    };

export type FakeBridgeResponder = (cmd: ParsedCommand) => FakeBridgeResponse;

export interface ParsedCommand {
  id: string;
  kind: string;
  name?: string;
  params: unknown;
  created_at: string;
}

export interface FakeBridgeOptions {
  malformed?: boolean;
}

export interface FakeBridge {
  stop: () => Promise<void>;
  /**
   * Every command the fake bridge processed, in the order it saw them.
   * Useful for asserting on-wire kind/params/name.
   */
  seen: ParsedCommand[];
}

const defaultResponder: FakeBridgeResponder = () => ({
  ok: true,
  result: { bridge: "connected", reaper_version: "7.21/x64" },
});

/**
 * In-process imitation of streetlight_bridge.lua for tests. Watches
 * `pending/` at ~5 ms cadence, calls `responseFor(cmd)` on each picked-up
 * command, and writes the envelope atomically to `done/`.
 */
export function startFakeBridge(
  queueDir: string,
  responseFor: FakeBridgeResponder = defaultResponder,
  opts: FakeBridgeOptions = {},
): FakeBridge {
  const pendingDir = path.join(queueDir, "pending");
  const doneDir = path.join(queueDir, "done");
  const seen: ParsedCommand[] = [];
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const entries = await fs.readdir(pendingDir);
      const jsons = entries
        .filter((e) => e.endsWith(".json") && !e.endsWith(".tmp"))
        .sort();
      for (const name of jsons) {
        const fullPath = path.join(pendingDir, name);
        const raw = await fs.readFile(fullPath, "utf8").catch(() => null);
        if (raw === null) continue;
        const cmd = JSON.parse(raw) as ParsedCommand;
        seen.push(cmd);
        await fs.unlink(fullPath).catch(() => {});

        const donePath = path.join(doneDir, `${cmd.id}.json`);
        const tmpDone = `${donePath}.tmp`;

        if (opts.malformed) {
          await fs.writeFile(tmpDone, "{ this is not json", "utf8");
        } else {
          const response = responseFor(cmd);
          const envelope = {
            id: cmd.id,
            ...response,
            completed_at: new Date().toISOString(),
          };
          await fs.writeFile(tmpDone, JSON.stringify(envelope), "utf8");
        }
        await fs.rename(tmpDone, donePath);
      }
    } catch {
      // ignore — directory may have been torn down
    }
    timer = setTimeout(tick, 5);
  };

  timer = setTimeout(tick, 0);

  return {
    seen,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Small grace period so any in-flight tick finishes.
      await new Promise((r) => setTimeout(r, 10));
    },
  };
}

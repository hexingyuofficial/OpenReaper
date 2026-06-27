import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  makeCommandId,
  err,
  ok,
  ErrorCodes,
  type QueueCommand,
  type QueueResultEnvelope,
  type Result,
  type CommandKind,
  type ErrorCode,
} from "@streetlight/core";

/**
 * Resolve the queue directory the MCP server shares with the Lua bridge.
 *
 * Precedence:
 *   1. STREETLIGHT_QUEUE_DIR env var (must be set in both processes if used)
 *   2. Platform defaults
 *     - macOS:   ~/Library/Application Support/Streetlight/queue
 *     - Windows: %APPDATA%/Streetlight/queue
 *     - Linux:   ~/.local/share/streetlight/queue
 */
export function resolveQueueDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.STREETLIGHT_QUEUE_DIR;
  if (override !== undefined && override.length > 0) return override;

  switch (platform) {
    case "darwin":
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Streetlight",
        "queue",
      );
    case "win32": {
      const appData =
        env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
      return path.join(appData, "Streetlight", "queue");
    }
    default:
      return path.join(os.homedir(), ".local", "share", "streetlight", "queue");
  }
}

export interface SendOptions {
  /** Total wall-clock budget before we return BRIDGE_NOT_RUNNING. */
  timeoutMs: number;
}

export interface FileQueueClientOptions {
  queueDir: string;
  /** First poll interval; backs off geometrically to maxPollIntervalMs. */
  initialPollIntervalMs?: number;
  maxPollIntervalMs?: number;
}

/**
 * Client side of the Streetlight file-queue protocol.
 *
 * Sends commands by writing JSON to `pending/`, polls `done/` for the
 * matching command id, and unlinks the result file once consumed. Errors
 * never reject — they resolve into a Result<R>.
 */
export class FileQueueClient {
  private readonly pendingDir: string;
  private readonly runningDir: string;
  private readonly doneDir: string;
  private readonly initialPollMs: number;
  private readonly maxPollMs: number;

  constructor(opts: FileQueueClientOptions) {
    this.pendingDir = path.join(opts.queueDir, "pending");
    this.runningDir = path.join(opts.queueDir, "running");
    this.doneDir = path.join(opts.queueDir, "done");
    this.initialPollMs = opts.initialPollIntervalMs ?? 50;
    this.maxPollMs = opts.maxPollIntervalMs ?? 200;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.pendingDir, { recursive: true });
    await fs.mkdir(this.runningDir, { recursive: true });
    await fs.mkdir(this.doneDir, { recursive: true });
  }

  async send<R>(
    kind: CommandKind,
    params: unknown,
    opts: SendOptions,
    name?: string,
  ): Promise<Result<R>> {
    const id = makeCommandId();
    const command: QueueCommand = {
      id,
      kind,
      params,
      created_at: new Date().toISOString(),
      ...(name !== undefined ? { name } : {}),
    };

    try {
      await this.writePendingAtomic(command);
    } catch (e) {
      return err(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to write pending command: ${stringifyError(e)}`,
        { recoverable: false },
      );
    }

    return this.pollForResult<R>(id, opts.timeoutMs);
  }

  private async writePendingAtomic(command: QueueCommand): Promise<void> {
    const tmp = path.join(this.pendingDir, `${command.id}.json.tmp`);
    const final = path.join(this.pendingDir, `${command.id}.json`);
    await fs.writeFile(tmp, JSON.stringify(command), "utf8");
    await fs.rename(tmp, final);
  }

  private async pollForResult<R>(
    id: string,
    timeoutMs: number,
  ): Promise<Result<R>> {
    const donePath = path.join(this.doneDir, `${id}.json`);
    const pendingPath = path.join(this.pendingDir, `${id}.json`);
    const deadline = Date.now() + timeoutMs;
    let interval = this.initialPollMs;

    while (Date.now() < deadline) {
      const data = await readIfExists(donePath);
      if (data !== null) {
        await fs.unlink(donePath).catch(() => {});
        return parseEnvelope<R>(data);
      }
      await sleep(interval);
      interval = Math.min(Math.floor(interval * 1.5), this.maxPollMs);
    }

    // Timeout — best-effort cleanup of the pending file in case the bridge
    // never picked it up. If it has already been claimed, this is a no-op.
    await fs.unlink(pendingPath).catch(() => {});
    return err(
      ErrorCodes.BRIDGE_NOT_RUNNING,
      `No response from REAPER bridge within ${timeoutMs}ms. Make sure REAPER is running and streetlight_bridge.lua is loaded.`,
    );
  }
}

function parseEnvelope<R>(data: string): Result<R> {
  let envelope: QueueResultEnvelope<R>;
  try {
    envelope = JSON.parse(data) as QueueResultEnvelope<R>;
  } catch (e) {
    return err(
      ErrorCodes.INTERNAL_ERROR,
      `Bridge returned malformed JSON: ${stringifyError(e)}`,
      { recoverable: false },
    );
  }

  if (envelope.ok) {
    return ok(envelope.result as R);
  }

  const code =
    (envelope.error?.code as ErrorCode | undefined) ?? ErrorCodes.INTERNAL_ERROR;
  const message = envelope.error?.message ?? "Bridge reported an unknown error.";
  const errOpts: { recoverable?: boolean; details?: Record<string, unknown> } =
    {};
  if (envelope.error?.recoverable !== undefined) {
    errOpts.recoverable = envelope.error.recoverable;
  }
  if (envelope.error?.details !== undefined) {
    errOpts.details = envelope.error.details;
  }
  return err(code, message, errOpts);
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (e) {
    if (isENOENT(e)) return null;
    throw e;
  }
}

function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "ENOENT"
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

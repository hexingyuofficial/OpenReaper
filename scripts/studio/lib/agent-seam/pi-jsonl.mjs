import { StringDecoder } from "node:string_decoder";

/**
 * Split Pi RPC stdout into JSONL records (LF only; strip optional CR).
 * @param {string} chunk
 * @param {string} buffer
 * @returns {{ lines: string[], buffer: string }}
 */
export function drainJsonlBuffer(chunk, buffer = "") {
  let combined = buffer + chunk;
  const lines = [];
  while (true) {
    const newlineIndex = combined.indexOf("\n");
    if (newlineIndex === -1) {
      break;
    }
    let line = combined.slice(0, newlineIndex);
    combined = combined.slice(newlineIndex + 1);
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    if (line.length > 0) {
      lines.push(line);
    }
  }
  return { lines, buffer: combined };
}

export function attachJsonlReader(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk) => {
    const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    const drained = drainJsonlBuffer(text, buffer);
    buffer = drained.buffer;
    for (const line of drained.lines) {
      onLine(line);
    }
  });

  stream.on("end", () => {
    const tail = decoder.end();
    if (tail) {
      const drained = drainJsonlBuffer(tail, buffer);
      buffer = drained.buffer;
      for (const line of drained.lines) {
        onLine(line);
      }
    }
    if (buffer.length > 0) {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      if (line.length > 0) {
        onLine(line);
      }
      buffer = "";
    }
  });
}

let requestCounter = 0;

export function nextRpcRequestId(prefix = "or-studio") {
  requestCounter += 1;
  return `${prefix}-${Date.now()}-${requestCounter}`;
}

/** Dialog methods that block Pi until the RPC client replies. */
export const EXTENSION_UI_DIALOG_METHODS = Object.freeze([
  "select",
  "confirm",
  "input",
  "editor",
]);

/**
 * Pi 0.79.x emits `agent_end` (willRetry=false) and never `agent_settled`.
 * Newer Pi emits `agent_settled` after the full run. Both mean Send can return.
 */
export function isAgentSettledEvent(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  if (parsed.type === "agent_settled") {
    return true;
  }
  return parsed.type === "agent_end" && parsed.willRetry !== true;
}

export function isExtensionUiDialogRequest(parsed) {
  return (
    parsed?.type === "extension_ui_request" &&
    typeof parsed.id === "string" &&
    parsed.id.length > 0 &&
    EXTENSION_UI_DIALOG_METHODS.includes(parsed.method)
  );
}

/**
 * Minimal Pi RPC client over piped stdin/stdout (one in-flight command).
 */
export class PiJsonlRpcClient {
  constructor({ stdin, pendingSettled }) {
    this.stdin = stdin;
    this.pendingSettled = pendingSettled ?? (() => {});
    this.waiters = new Map();
    this.settledResolvers = [];
  }

  flushSettled() {
    for (const entry of this.settledResolvers.splice(0)) {
      entry.resolve();
    }
    this.pendingSettled();
  }

  cancelSettledWaiters() {
    for (const entry of this.settledResolvers.splice(0)) {
      entry.resolve();
    }
  }

  handleLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (isExtensionUiDialogRequest(parsed)) {
      try {
        this.writeCommand({
          type: "extension_ui_response",
          id: parsed.id,
          cancelled: true,
        });
      } catch {
        /* stdin closed */
      }
      return;
    }
    if (parsed?.type === "response" && parsed.id && this.waiters.has(parsed.id)) {
      const resolve = this.waiters.get(parsed.id);
      this.waiters.delete(parsed.id);
      resolve(parsed);
      return;
    }
    if (isAgentSettledEvent(parsed)) {
      this.flushSettled();
    }
  }

  writeCommand(command) {
    const payload = `${JSON.stringify(command)}\n`;
    this.stdin.write(payload);
  }

  sendCommand(command, { timeoutMs = 120_000 } = {}) {
    const id = command.id ?? nextRpcRequestId();
    const withId = { ...command, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`Pi RPC command timed out (${command.type})`));
      }, timeoutMs);
      this.waiters.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      try {
        this.writeCommand(withId);
      } catch (error) {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(error);
      }
    });
  }

  waitForAgentSettled(timeoutMs = 300_000) {
    return new Promise((resolve, reject) => {
      const entry = {
        resolve() {
          if (entry.done) {
            return;
          }
          entry.done = true;
          clearTimeout(entry.timer);
          resolve();
        },
        reject(error) {
          if (entry.done) {
            return;
          }
          entry.done = true;
          clearTimeout(entry.timer);
          reject(error);
        },
      };
      entry.timer = setTimeout(() => {
        const index = this.settledResolvers.indexOf(entry);
        if (index >= 0) {
          this.settledResolvers.splice(index, 1);
        }
        entry.reject(new Error("Timed out waiting for Pi agent_settled/agent_end"));
      }, timeoutMs);
      this.settledResolvers.push(entry);
    });
  }

  /**
   * Arm the settle waiter before sending `prompt` so a fast `agent_end`
   * (Pi 0.79) cannot arrive between the prompt response and waitForAgentSettled.
   */
  async promptAndWait(message, { timeoutMs = 120_000, settleTimeoutMs = 300_000 } = {}) {
    const settled = this.waitForAgentSettled(settleTimeoutMs);
    try {
      const promptResponse = await this.sendCommand(
        { type: "prompt", message },
        { timeoutMs },
      );
      if (!promptResponse?.success) {
        this.cancelSettledWaiters();
        return { promptResponse };
      }
      await settled;
      return { promptResponse };
    } catch (error) {
      this.cancelSettledWaiters();
      throw error;
    }
  }
}

export function formatStudioPromptMessage(message, chips = []) {
  if (!chips.length) {
    return message;
  }
  const lines = chips.map((chip) => `- [${chip.kind ?? "context"}] ${chip.label ?? ""}`);
  return `[OpenReaper Studio context]\n${lines.join("\n")}\n\n${message}`;
}

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

  handleLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed?.type === "response" && parsed.id && this.waiters.has(parsed.id)) {
      const resolve = this.waiters.get(parsed.id);
      this.waiters.delete(parsed.id);
      resolve(parsed);
      return;
    }
    if (parsed?.type === "agent_settled") {
      for (const resolve of this.settledResolvers.splice(0)) {
        resolve();
      }
      this.pendingSettled();
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
      const timer = setTimeout(() => {
        const index = this.settledResolvers.indexOf(resolve);
        if (index >= 0) {
          this.settledResolvers.splice(index, 1);
        }
        reject(new Error("Timed out waiting for Pi agent_settled"));
      }, timeoutMs);
      this.settledResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export function formatStudioPromptMessage(message, chips = []) {
  if (!chips.length) {
    return message;
  }
  const lines = chips.map((chip) => `- [${chip.kind ?? "context"}] ${chip.label ?? ""}`);
  return `[OpenReaper Studio context]\n${lines.join("\n")}\n\n${message}`;
}

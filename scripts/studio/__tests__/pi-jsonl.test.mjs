import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import {
  drainJsonlBuffer,
  isAgentSettledEvent,
  PiJsonlRpcClient,
} from "../lib/agent-seam/pi-jsonl.mjs";

describe("drainJsonlBuffer", () => {
  it("splits on LF only and strips CR", () => {
    const first = drainJsonlBuffer('{"a":1}\r\n{"b":');
    expect(first.lines).toEqual(['{"a":1}']);
    expect(first.buffer).toBe('{"b":');
    const second = drainJsonlBuffer("2}\n", first.buffer);
    expect(second.lines).toEqual(['{"b":2}']);
    expect(second.buffer).toBe("");
  });
});

describe("isAgentSettledEvent", () => {
  it("treats agent_end with willRetry !== true as settle (Pi 0.79)", () => {
    expect(isAgentSettledEvent({ type: "agent_end" })).toBe(true);
    expect(isAgentSettledEvent({ type: "agent_end", willRetry: false })).toBe(true);
    expect(isAgentSettledEvent({ type: "agent_end", willRetry: true })).toBe(false);
    expect(isAgentSettledEvent({ type: "agent_settled" })).toBe(true);
    expect(isAgentSettledEvent({ type: "agent_start" })).toBe(false);
  });
});

describe("PiJsonlRpcClient settle + extension UI", () => {
  it("agent_end resolves waitForAgentSettled", async () => {
    const stdin = new PassThrough();
    const client = new PiJsonlRpcClient({ stdin });
    const waiting = client.waitForAgentSettled(1000);
    client.handleLine(JSON.stringify({ type: "agent_end", willRetry: false }));
    await expect(waiting).resolves.toBeUndefined();
  });

  it("does not settle on agent_end while willRetry is true", async () => {
    const stdin = new PassThrough();
    const client = new PiJsonlRpcClient({ stdin });
    let settled = false;
    const waiting = client.waitForAgentSettled(80).then(
      () => {
        settled = true;
      },
      () => {
        /* timeout expected */
      },
    );
    client.handleLine(JSON.stringify({ type: "agent_end", willRetry: true }));
    await waiting;
    expect(settled).toBe(false);
  });

  it("promptAndWait arms settle before prompt so a fast agent_end is not missed", async () => {
    const stdin = new PassThrough();
    const written = [];
    let client;
    stdin.write = (chunk) => {
      written.push(String(chunk));
      const command = JSON.parse(String(chunk).trim());
      queueMicrotask(() => {
        client.handleLine(
          JSON.stringify({ type: "response", id: command.id, success: true, command: "prompt" }),
        );
        client.handleLine(JSON.stringify({ type: "agent_end", willRetry: false }));
      });
      return true;
    };
    client = new PiJsonlRpcClient({ stdin });
    const result = await client.promptAndWait("hello", { timeoutMs: 1000, settleTimeoutMs: 1000 });
    expect(result.promptResponse.success).toBe(true);
    expect(written[0]).toContain('"type":"prompt"');
  });

  it("auto-cancels extension_ui_request dialog methods so RPC cannot block on UI", () => {
    const stdin = new PassThrough();
    const written = [];
    stdin.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    const client = new PiJsonlRpcClient({ stdin });
    client.handleLine(
      JSON.stringify({
        type: "extension_ui_request",
        id: "uuid-confirm",
        method: "confirm",
        title: "Allow?",
      }),
    );
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0])).toEqual({
      type: "extension_ui_response",
      id: "uuid-confirm",
      cancelled: true,
    });
  });
});

import { describe, it, expect } from "vitest";
import { drainJsonlBuffer } from "../lib/agent-seam/pi-jsonl.mjs";

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

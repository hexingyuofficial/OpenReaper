import { describe, it, expect, beforeEach } from "vitest";
import { makeCommandId, _resetCounterForTests } from "../queue.js";

describe("makeCommandId", () => {
  beforeEach(() => {
    _resetCounterForTests();
  });

  it("produces the documented format", () => {
    const id = makeCommandId(new Date("2026-06-27T12:00:00Z"));
    expect(id).toMatch(/^cmd_20260627120000_\d{3}$/);
  });

  it("counter advances within the same second", () => {
    const now = new Date("2026-06-27T12:00:00Z");
    const a = makeCommandId(now);
    const b = makeCommandId(now);
    expect(a).not.toBe(b);
    expect(a.split("_").pop()).toBe("001");
    expect(b.split("_").pop()).toBe("002");
  });

  it("zero-pads the counter to three digits", () => {
    const now = new Date("2026-06-27T12:00:00Z");
    const id = makeCommandId(now);
    expect(id).toMatch(/_\d{3}$/);
  });

  it("uses UTC, not local time", () => {
    const id = makeCommandId(new Date("2026-12-31T23:59:59Z"));
    expect(id).toMatch(/^cmd_20261231235959_/);
  });
});

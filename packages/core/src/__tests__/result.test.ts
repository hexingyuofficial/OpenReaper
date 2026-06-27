import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr } from "../result.js";

describe("ok / err", () => {
  it("ok wraps a value in the documented shape", () => {
    const r = ok({ items: 3 });
    expect(r).toEqual({ ok: true, result: { items: 3 } });
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it("err produces the documented shape", () => {
    const r = err("ITEM_NOT_FOUND", "Could not resolve selected:0");
    expect(r).toEqual({
      ok: false,
      error: {
        code: "ITEM_NOT_FOUND",
        message: "Could not resolve selected:0",
        recoverable: true,
      },
    });
  });

  it("err carries optional details", () => {
    const r = err("PARAMS_INVALID", "bad input", {
      details: { field: "semitones" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.details).toEqual({ field: "semitones" });
    }
  });

  it("INTERNAL_ERROR defaults to non-recoverable", () => {
    const r = err("INTERNAL_ERROR", "oops");
    if (!r.ok) {
      expect(r.error.recoverable).toBe(false);
    }
  });

  it("caller can override recoverable flag", () => {
    const r = err("BRIDGE_NOT_RUNNING", "no bridge", { recoverable: false });
    if (!r.ok) {
      expect(r.error.recoverable).toBe(false);
    }
  });

  it("isOk and isErr narrow the type", () => {
    const r = ok(42);
    if (isOk(r)) {
      // Type narrows to Ok<number>.
      const v: number = r.result;
      expect(v).toBe(42);
    }
    const e = err("INTERNAL_ERROR", "x");
    if (isErr(e)) {
      const c: string = e.error.code;
      expect(c).toBe("INTERNAL_ERROR");
    }
  });
});

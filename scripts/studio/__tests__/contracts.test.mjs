import { describe, it, expect } from "vitest";
import { normalizeContextChips, CONTEXT_CHIP_KINDS } from "../lib/contracts/context-chip.mjs";
import {
  buildPromptRequest,
  parsePromptRequest,
  PROMPT_REQUEST_CONTRACT,
} from "../lib/contracts/prompt.mjs";

describe("context-chip contract", () => {
  it("accepts known kinds and rejects unknown", () => {
    expect(CONTEXT_CHIP_KINDS).toContain("track");
    const chips = normalizeContextChips([
      { kind: "track", label: "Track 1", data: { number: 1 } },
      { kind: "invalid", label: "nope" },
    ]);
    expect(chips).toHaveLength(1);
    expect(chips[0].kind).toBe("track");
  });
});

describe("prompt contract", () => {
  it("round-trips a minimal request", () => {
    const req = buildPromptRequest("hello", [{ kind: "time", label: "Time 0–1s" }]);
    expect(req.contract).toBe(PROMPT_REQUEST_CONTRACT);
    const parsed = parsePromptRequest(req);
    expect(parsed?.message).toBe("hello");
    expect(parsed?.chips).toHaveLength(1);
  });
});

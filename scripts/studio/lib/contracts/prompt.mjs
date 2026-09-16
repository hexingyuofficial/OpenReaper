import { normalizeContextChips } from "./context-chip.mjs";

export const PROMPT_REQUEST_CONTRACT = "openreaper.studio.prompt_request.v1";
export const PROMPT_RESPONSE_CONTRACT = "openreaper.studio.prompt_response.v1";

/**
 * @typedef {object} PromptRequest
 * @property {string} contract
 * @property {string} message
 * @property {import("./context-chip.mjs").normalizeContextChip[]} chips
 */

/**
 * @typedef {object} PromptResponse
 * @property {string} contract
 * @property {boolean} ok
 * @property {string} mode
 * @property {string} text
 */

export function buildPromptRequest(message, chips) {
  return {
    contract: PROMPT_REQUEST_CONTRACT,
    message: String(message ?? "").trim(),
    chips: normalizeContextChips(chips),
  };
}

export function parsePromptRequest(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const message = String(raw.message ?? "").trim();
  if (!message) {
    return null;
  }
  return buildPromptRequest(message, raw.chips);
}

export function buildPromptResponse({ ok, mode, text }) {
  return {
    contract: PROMPT_RESPONSE_CONTRACT,
    ok: Boolean(ok),
    mode: String(mode ?? "unknown"),
    text: String(text ?? ""),
  };
}

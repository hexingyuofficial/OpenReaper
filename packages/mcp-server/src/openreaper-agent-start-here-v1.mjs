import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
} from "./alpha3-3-b1-macro-portfolio-v1.mjs";

export const OPENREAPER_AGENT_START_HERE_CONTRACT = "openreaper.alpha3.4.agent_start_here.v1";
export const OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN = "<!-- OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN -->";
export const OPENREAPER_AGENT_START_HERE_COMPACT_END = "<!-- OPENREAPER_AGENT_START_HERE_COMPACT_END -->";
export const OPENREAPER_AGENT_START_HERE_MAX_UTF8_BYTES = 16_384;
export const OPENREAPER_AGENT_START_HERE_DOCUMENT = "docs/AGENT_START_HERE.md";
export const OPENREAPER_AGENT_FIRST_ROUND_FLOW =
  "ping -> search the user's original words -> prefer one Macro or official Recipe -> exact-id expansion -> one call_template or call_recipe run -> live readback";

export const OPENREAPER_PUBLIC_TOOL_IDS = Object.freeze([
  "ping",
  "get_state",
  "list_templates",
  "list_recipes",
  "call_template",
  "call_recipe",
]);

export const OPENREAPER_FLAT_FIFTEEN_MACRO_IDS = Object.freeze([
  ...ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
]);

export const OPENREAPER_AGENT_START_HERE_DEFAULT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/AGENT_START_HERE.md",
);

export function resolveOpenReaperAgentStartHereDocumentPath(input = {}) {
  if (typeof input.document_path === "string" && input.document_path.trim() !== "") {
    return path.resolve(input.document_path.trim());
  }
  if (typeof input.package_root === "string" && input.package_root.trim() !== "") {
    return path.resolve(input.package_root.trim(), "docs", "AGENT_START_HERE.md");
  }
  if (typeof input.repo_root === "string" && input.repo_root.trim() !== "") {
    return path.resolve(input.repo_root.trim(), "docs", "AGENT_START_HERE.md");
  }
  const packageRoot = process.env.OPENREAPER_MCP_PACKAGE_ROOT;
  if (typeof packageRoot === "string" && packageRoot.trim() !== "") {
    return path.resolve(packageRoot.trim(), "docs", "AGENT_START_HERE.md");
  }
  return OPENREAPER_AGENT_START_HERE_DEFAULT_PATH;
}

export function extractOpenReaperAgentStartHereCompactSection(documentText, {
  maxUtf8Bytes = OPENREAPER_AGENT_START_HERE_MAX_UTF8_BYTES,
} = {}) {
  if (typeof documentText !== "string") {
    throw startHereError("AGENT_START_HERE_DOCUMENT_TYPE_INVALID", "AGENT_START_HERE document text must be a string.");
  }

  const begin = OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN;
  const end = OPENREAPER_AGENT_START_HERE_COMPACT_END;
  const beginMatches = countOccurrences(documentText, begin);
  const endMatches = countOccurrences(documentText, end);
  if (beginMatches === 0 || endMatches === 0) {
    throw startHereError("AGENT_START_HERE_MARKER_MISSING", "AGENT_START_HERE compact markers are missing.", {
      begin_matches: beginMatches,
      end_matches: endMatches,
    });
  }
  if (beginMatches !== 1 || endMatches !== 1) {
    throw startHereError("AGENT_START_HERE_MARKER_DUPLICATE", "AGENT_START_HERE compact markers must appear exactly once.", {
      begin_matches: beginMatches,
      end_matches: endMatches,
    });
  }

  const beginIndex = documentText.indexOf(begin);
  const endIndex = documentText.indexOf(end);
  if (beginIndex < 0 || endIndex < 0 || endIndex <= beginIndex) {
    throw startHereError("AGENT_START_HERE_MARKER_ORDER_INVALID", "AGENT_START_HERE compact END must follow BEGIN exactly once.");
  }

  const compact = documentText
    .slice(beginIndex + begin.length, endIndex)
    .replace(/^\uFEFF?/u, "")
    .replace(/^\r?\n/u, "")
    .replace(/\r?\n$/u, "")
    .trimEnd();

  if (compact.trim() === "") {
    throw startHereError("AGENT_START_HERE_COMPACT_EMPTY", "AGENT_START_HERE compact section is empty.");
  }

  const utf8Bytes = Buffer.byteLength(compact, "utf8");
  if (utf8Bytes > maxUtf8Bytes) {
    throw startHereError("AGENT_START_HERE_COMPACT_BUDGET_EXCEEDED", "AGENT_START_HERE compact projection exceeds the UTF-8 budget.", {
      utf8_bytes: utf8Bytes,
      max_utf8_bytes: maxUtf8Bytes,
    });
  }

  return {
    contract: OPENREAPER_AGENT_START_HERE_CONTRACT,
    compact_text: compact,
    utf8_bytes: utf8Bytes,
    max_utf8_bytes: maxUtf8Bytes,
    markers: {
      begin,
      end,
      begin_matches: beginMatches,
      end_matches: endMatches,
    },
  };
}

export function loadOpenReaperAgentStartHereProjection(input = {}) {
  const documentPath = resolveOpenReaperAgentStartHereDocumentPath(input);
  let documentText;
  try {
    documentText = readFileSync(documentPath, "utf8");
  } catch (error) {
    throw startHereError("AGENT_START_HERE_DOCUMENT_UNREADABLE", "AGENT_START_HERE document could not be read.", {
      document_path: documentPath,
      cause: error?.message ?? String(error),
    });
  }
  const projection = extractOpenReaperAgentStartHereCompactSection(documentText, {
    maxUtf8Bytes: input.max_utf8_bytes ?? OPENREAPER_AGENT_START_HERE_MAX_UTF8_BYTES,
  });
  assertCompactContainsRequiredTruth(projection.compact_text);
  return Object.freeze({
    ...projection,
    document_path: documentPath,
    tool_ids: OPENREAPER_PUBLIC_TOOL_IDS,
    macro_ids: OPENREAPER_FLAT_FIFTEEN_MACRO_IDS,
  });
}

export function createOpenReaperMcpInitializationInstructions(input = {}) {
  const projection = input.projection ?? loadOpenReaperAgentStartHereProjection(input);
  return projection.compact_text;
}

export function assertCompactContainsRequiredTruth(compactText) {
  if (typeof compactText !== "string" || compactText.trim() === "") {
    throw startHereError("AGENT_START_HERE_COMPACT_EMPTY", "AGENT_START_HERE compact section is empty.");
  }
  for (const tool of OPENREAPER_PUBLIC_TOOL_IDS) {
    if (!compactText.includes(tool)) {
      throw startHereError("AGENT_START_HERE_TOOL_MISSING", `AGENT_START_HERE compact section is missing tool ${tool}.`, { tool });
    }
  }
  for (const macroId of OPENREAPER_FLAT_FIFTEEN_MACRO_IDS) {
    if (!compactText.includes(macroId)) {
      throw startHereError("AGENT_START_HERE_MACRO_MISSING", `AGENT_START_HERE compact section is missing Macro ${macroId}.`, { macro_id: macroId });
    }
  }
  for (const required of [
    "list_templates",
    "call_template",
    "ping",
    "cursor",
    "get_state",
    "artifact",
    "Macro-first",
    "openreaper-start",
    "OpenReaper: Start MCP bridge",
    "Raw Lua",
    '"mode":"create_clips"',
    '"plugin":"reacomp"',
    "call_recipe",
    "Exactly six tools",
    "exactly seven operations",
    "evidence_ref",
    "Never run by fuzzy recipe id alone",
  ]) {
    if (!compactText.includes(required)) {
      throw startHereError("AGENT_START_HERE_REQUIRED_PHRASE_MISSING", `AGENT_START_HERE compact section is missing required phrase: ${required}.`, {
        phrase: required,
      });
    }
  }
  if (/\{(?:TRACK|TAKE|ITEM)\}/u.test(compactText)) {
    throw startHereError("AGENT_START_HERE_PLACEHOLDER_FORBIDDEN", "AGENT_START_HERE compact section must not contain TRACK/TAKE/ITEM placeholder refs.");
  }
  return true;
}

function countOccurrences(text, needle) {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    const found = text.indexOf(needle, index);
    if (found < 0) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function startHereError(code, message, details = null) {
  return Object.assign(new Error(message), {
    name: "OpenReaperAgentStartHereError",
    code,
    details,
  });
}

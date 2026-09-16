/** @typedef {"time"|"track"|"item"|"region"|"marker"} ContextChipKind */

export const CONTEXT_CHIP_KINDS = Object.freeze([
  "time",
  "track",
  "item",
  "region",
  "marker",
]);

/**
 * Minimal chip shape exchanged between the ReaImGui face and the agent seam.
 * `data` is REAPER-specific; keep it JSON-serializable.
 */
export function normalizeContextChip(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const kind = String(raw.kind ?? "");
  if (!CONTEXT_CHIP_KINDS.includes(kind)) {
    return null;
  }
  const label = String(raw.label ?? "").trim();
  if (!label) {
    return null;
  }
  return {
    kind,
    label,
    data: raw.data && typeof raw.data === "object" ? raw.data : {},
  };
}

export function normalizeContextChips(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const out = [];
  for (const entry of list) {
    const chip = normalizeContextChip(entry);
    if (chip) {
      out.push(chip);
    }
  }
  return out;
}

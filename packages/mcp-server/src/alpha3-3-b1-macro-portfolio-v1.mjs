export const ALPHA3_3_B1_MACRO_PORTFOLIO_CONTRACT = "alpha3.3.macro_portfolio.v1";
export const ALPHA3_3_B1_MACRO_PORTFOLIO_VERSION = "1.0.0";

export const ALPHA3_3_B1_FINAL_TARGET_IDS = deepFreeze([
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.project.file",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.items.analyze",
  "macro.items.apply",
  "macro.midi.apply",
  "macro.fx.apply_chain",
  "macro.fx.set_controls",
  "macro.controls.set",
  "macro.automation.apply",
  "macro.render.targets",
]);

export const ALPHA3_3_B1_INTERNAL_DRAFT_IDS = deepFreeze([]);

const INTERNAL_DRAFT_ID_SET = new Set(ALPHA3_3_B1_INTERNAL_DRAFT_IDS);

export const ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS = deepFreeze(
  ALPHA3_3_B1_FINAL_TARGET_IDS.filter((id) => !INTERNAL_DRAFT_ID_SET.has(id)),
);

export const ALPHA3_3_B1_DEPRECATED_ALIASES = deepFreeze([
  alias("macro.midi.create_clip", "macro.midi.apply", { mode: "create_clips" }),
  alias("macro.fx.apply_native_chain", "macro.fx.apply_chain", {}),
  alias("macro.set_stock_plugin_controls", "macro.fx.set_controls", {}),
  alias("macro.items.arrange", "macro.items.apply", { mode: "align_starts", target: "selected", dry_run: true }),
  alias(
    "macro.items.process",
    "macro.items.apply",
    { mode: "normalize_peak", target: "selected", dry_run: true },
    {
      replacement_available_now: false,
      blocker_code: "ITEM_APPLY_MODE_HELD",
      blocker_message: "macro.items.process maps to the canonical processing family, but normalize_peak is not executable in Alpha3.3-B1c yet.",
    },
  ),
]);

const ALIAS_BY_ID = new Map(ALPHA3_3_B1_DEPRECATED_ALIASES.map((entry) => [entry.id, entry]));
const EXECUTOR_SOURCE_BY_CANONICAL_ID = new Map([
  ["macro.midi.apply", "macro.midi.create_clip"],
  ["macro.fx.apply_chain", "macro.fx.apply_native_chain"],
  ["macro.fx.set_controls", "macro.set_stock_plugin_controls"],
]);
const PROGRAM_ID_BY_CANONICAL_ID = new Map([
  ["macro.midi.apply", "openreaper.macro.midi.apply"],
  ["macro.fx.apply_chain", "openreaper.macro.fx.apply_chain"],
  ["macro.fx.set_controls", "openreaper.macro.fx.set_controls"],
]);

export const ALPHA3_3_B1_MACRO_PORTFOLIO = deepFreeze({
  contract: ALPHA3_3_B1_MACRO_PORTFOLIO_CONTRACT,
  version: ALPHA3_3_B1_MACRO_PORTFOLIO_VERSION,
  target_ids: ALPHA3_3_B1_FINAL_TARGET_IDS,
  visible_executable_ids: ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
  internal_draft_ids: ALPHA3_3_B1_INTERNAL_DRAFT_IDS,
  deprecated_aliases: ALPHA3_3_B1_DEPRECATED_ALIASES,
});

export function validateAlpha3_3B1MacroPortfolio(portfolio = ALPHA3_3_B1_MACRO_PORTFOLIO) {
  const errors = [];
  if (!isPlainObject(portfolio)) return { valid: false, errors: ["Macro portfolio must be an object"] };

  const targetIds = stringArray(portfolio.target_ids);
  const visibleIds = stringArray(portfolio.visible_executable_ids);
  const draftIds = stringArray(portfolio.internal_draft_ids);
  const aliasRows = Array.isArray(portfolio.deprecated_aliases) ? portfolio.deprecated_aliases : [];
  const targetSet = new Set(targetIds);
  const visibleSet = new Set(visibleIds);
  const draftSet = new Set(draftIds);

  if (targetIds.length !== 15 || targetSet.size !== 15) errors.push("Alpha3.3 target portfolio must contain exactly 15 unique ids");
  if (visibleIds.length !== 15 || visibleSet.size !== 15) errors.push("Alpha3.3-B1d visible portfolio must contain exactly 15 unique executable ids");
  if (draftIds.length !== 0 || draftSet.size !== 0) errors.push("Alpha3.3-B1d must not retain an internal draft id");
  if (aliasRows.length !== 5) errors.push("Alpha3.3-B1d must retain exactly five renamed compatibility aliases");

  for (const id of [...targetIds, ...visibleIds, ...draftIds]) {
    if (typeof id !== "string" || !id.startsWith("macro.")) errors.push(`Invalid Macro id: ${String(id)}`);
  }
  for (const id of visibleIds) {
    if (!targetSet.has(id)) errors.push(`Visible Macro is outside the final target: ${id}`);
    if (draftSet.has(id)) errors.push(`Internal draft Macro is visible: ${id}`);
  }
  for (const id of draftIds) {
    if (!targetSet.has(id)) errors.push(`Internal draft Macro is outside the final target: ${id}`);
  }
  if (visibleSet.size + draftSet.size !== targetSet.size) errors.push("Visible and draft groups must partition the final target");

  const aliasIds = new Set();
  for (const entry of aliasRows) {
    if (!isPlainObject(entry) || typeof entry.id !== "string" || typeof entry.replacement !== "string") {
      errors.push("Every deprecated alias requires id and replacement strings");
      continue;
    }
    if (aliasIds.has(entry.id)) errors.push(`Duplicate deprecated alias: ${entry.id}`);
    aliasIds.add(entry.id);
    if (targetSet.has(entry.id)) errors.push(`Deprecated alias must not be a final target: ${entry.id}`);
    if (!visibleSet.has(entry.replacement)) errors.push(`Deprecated alias replacement is not visible executable: ${entry.id}`);
    if (!isPlainObject(entry.replacement_input)) errors.push(`Deprecated alias requires replacement_input: ${entry.id}`);
  }

  return { valid: errors.length === 0, errors };
}

export function isAlpha3_3B1VisibleExecutableMacroId(id) {
  return ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.includes(id);
}

export function isAlpha3_3B1InternalDraftMacroId(id) {
  return INTERNAL_DRAFT_ID_SET.has(id);
}

export function isAlpha3_3B1DeprecatedAlias(id) {
  return ALIAS_BY_ID.has(id);
}

export function alpha3_3B1DeprecatedAlias(id, input = {}) {
  const entry = ALIAS_BY_ID.get(id);
  if (!entry) return null;
  return deepFreeze({
    ...cloneJson(entry),
    replacement_input: {
      ...(isPlainObject(input) ? cloneJson(input) : {}),
      ...cloneJson(entry.replacement_input),
    },
  });
}

export function alpha3_3B1ExecutorSourceId(id) {
  return EXECUTOR_SOURCE_BY_CANONICAL_ID.get(id) ?? id;
}

export function adaptAlpha3_3B1CanonicalExecutionRequest(request = {}) {
  const canonicalId = request.id;
  const executorId = alpha3_3B1ExecutorSourceId(canonicalId);
  const input = isPlainObject(request.input) ? cloneJson(request.input) : {};

  if (canonicalId === "macro.midi.apply") {
    const mode = input.mode ?? "create_clips";
    if (!["create_clips", "edit_notes", "quantize", "write_cc"].includes(mode)) {
      return deepFreeze({
        ok: false,
        code: "MIDI_APPLY_MODE_UNSUPPORTED",
        message: `macro.midi.apply does not support mode=${String(mode)}.`,
        details: {
          requested_mode: mode,
          supported_modes: ["create_clips", "edit_notes", "quantize", "write_cc"],
        },
      });
    }
    if (mode === "create_clips") delete input.mode;
  }

  return deepFreeze({
    ok: true,
    canonical_id: canonicalId,
    executor_id: executorId,
    request: {
      ...cloneJson(request),
      id: executorId,
      input,
    },
  });
}

export function canonicalizeAlpha3_3B1MacroDiscoveryItem(item, canonicalId) {
  const executorId = alpha3_3B1ExecutorSourceId(canonicalId);
  const canonical = replaceStrings(cloneJson(item), executorId, canonicalId);
  canonical.id = canonicalId;

  if (canonicalId === "macro.midi.apply") {
    canonical.title = "Apply bounded MIDI changes";
    canonical.user_label = "Apply MIDI";
    canonical.summary = "Create a MIDI clip or edit, quantize, and write CC to one to eight exact MIDI Takes with independent live readback.";
    canonical.macro_kind = "midi_apply";
  } else if (canonicalId === "macro.fx.apply_chain") {
    canonical.title = "Apply bounded FX chain";
    canonical.user_label = "Apply FX chain";
    canonical.summary = "Apply one or a bounded ordered Track/Take FX chain from REAPER's installed inventory with duplicate policy, optional preset/bypass/reorder, supported initial controls, and complete final-chain readback.";
    canonical.macro_kind = "fx_apply_chain";
  } else if (canonicalId === "macro.fx.set_controls") {
    canonical.title = "Set supported FX controls";
    canonical.user_label = "Set FX controls";
    canonical.summary = "Set FX controls via proven stock semantic mappings, one-FX exact_parameters, or multi-FX exact_assignments with complete inventory paging and live readback.";
    canonical.macro_kind = "fx_set_controls";
  }

  return deepFreeze(canonical);
}

export function canonicalizeAlpha3_3B1MacroExecutionEnvelope(envelope, canonicalId) {
  if (!isPlainObject(envelope)) return envelope;
  const executorId = alpha3_3B1ExecutorSourceId(canonicalId);
  const canonical = replaceStrings(cloneJson(envelope), executorId, canonicalId);
  if (isPlainObject(canonical.macro)) {
    canonical.macro.id = canonicalId;
    canonical.macro.program_id = PROGRAM_ID_BY_CANONICAL_ID.get(canonicalId)
      ?? canonical.macro.program_id;
  }
  return canonical;
}

function alias(id, replacement, replacementInput, metadata = {}) {
  return {
    id,
    implementation_status: "deprecated_alias",
    visible: false,
    replacement,
    replacement_input: replacementInput,
    ...metadata,
  };
}

function replaceStrings(value, from, to) {
  if (typeof value === "string") return value.replaceAll(from, to);
  if (Array.isArray(value)) return value.map((entry) => replaceStrings(entry, from, to));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceStrings(entry, from, to)]));
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

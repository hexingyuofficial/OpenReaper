import {
  MACRO_INVENTORY_CONTRACT,
  MACRO_TARGET_OUTCOMES,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_2_5_0_MACRO_INVENTORY_CONTRACT = MACRO_INVENTORY_CONTRACT;

export const ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS = deepFreeze([
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.project.file",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.render.targets",
  "macro.set_stock_plugin_controls",
  "macro.controls.set",
]);

const EXECUTABLE_TARGET_IDS = new Set(ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS);

export const ALPHA3_2_5_0_MACRO_INVENTORY = deepFreeze([
  official("macro.project.inspect", "public_plan_only_aggregation"),
  official("macro.project.query", "public_plan_only_sqlite_query"),
  official("macro.project.delete_targets", "public_preview_first_child_request_plan"),
  official("macro.project.apply_layout", "public_preview_first_child_request_plan"),
  official("macro.project.file", "public_save_child_request_plan"),
  official("macro.routing.apply", "public_preview_first_child_request_plan"),
  official("macro.media.place_assets", "public_preview_first_child_request_plan"),
  official("macro.render.targets", "public_render_child_request_plan"),
  mapping("macro.selected_context", "current", "public_compatibility_query_plan", "macro.project.query", { entity: "selected_context" }),
  mapping("macro.set_track_controls", "current", "public_generic_control_plan", "macro.controls.set", { target_kind: "track" }),
  mapping("macro.set_item_controls", "current", "public_generic_control_plan", "macro.controls.set", { target_kind: "item" }),
  mapping("macro.set_take_controls", "current", "public_generic_control_plan", "macro.controls.set", { target_kind: "take" }),
  mapping("macro.set_transport_controls", "current", "public_generic_control_plan", "macro.controls.set", { target_kind: "transport" }),
  mapping("macro.set_send_controls", "current", "public_generic_control_plan", "macro.controls.set", { target_kind: "send" }),
  withdrawn(
    "macro.set_midi_controls",
    "blocked_draft_generic_midi_plan",
    ["macro.midi.create_clip", "macro.midi.edit_notes"],
    "Future explicit MIDI task Macros must wait for Alpha3.2.5-A ref and seconds-mode safety.",
  ),
  official("macro.set_stock_plugin_controls", "public_semantic_stock_plugin_plan"),
  mapping("macro.index_status", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "status" }),
  mapping("macro.query_tracks", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "tracks" }),
  mapping("macro.query_items", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "items" }),
  mapping("macro.query_takes", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "takes" }),
  mapping("macro.query_fx", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "fx" }),
  mapping("macro.query_routing", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "routing" }),
  mapping("macro.query_automation", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "automation" }),
  mapping("macro.query_markers", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "markers_regions" }),
  mapping("macro.query_media", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "media_sources" }),
  mapping(
    "macro.hydrate_refs",
    "legacy_query",
    "replaced_legacy_sqlite_hydration_query",
    "macro.project.query",
    { entity: "derived_from_requested_ref_kind", refresh_policy: "if_stale" },
  ),
  mapping("macro.changed_since", "legacy_query", "replaced_legacy_sqlite_query", "macro.project.query", { entity: "changed_since" }),
  official("macro.controls.set", "proposed_consolidation_target", "proposed"),
]);

export const ALPHA3_2_5_0_MACRO_INVENTORY_COUNTS = deepFreeze({
  current: 16,
  legacy_query: 11,
  proposed: 1,
  total: 28,
  executable_official: 10,
  consolidated_legacy_mapping: 17,
  internal_withdrawn_draft: 1,
});

export function validateMacroInventory(inventory = ALPHA3_2_5_0_MACRO_INVENTORY) {
  const errors = [];
  if (!Array.isArray(inventory)) return { valid: false, errors: ["Macro inventory must be an array"] };

  const ids = new Set();
  const sourceCounts = {
    current: 0,
    legacy_query: 0,
    proposed: 0,
  };
  const outcomeCounts = {
    executable_official: 0,
    consolidated_legacy_mapping: 0,
    internal_withdrawn_draft: 0,
  };

  for (const row of inventory) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push("Every Macro inventory row must be an object");
      continue;
    }
    if (typeof row.id !== "string" || !row.id.startsWith("macro.")) errors.push("Every Macro inventory row requires a macro.* id");
    if (ids.has(row.id)) errors.push(`Duplicate Macro inventory id: ${row.id}`);
    ids.add(row.id);

    if (!Object.hasOwn(sourceCounts, row.source_group)) errors.push(`${row.id} has an invalid source_group`);
    else sourceCounts[row.source_group] += 1;
    if (!MACRO_TARGET_OUTCOMES.includes(row.target_outcome)) errors.push(`${row.id} has an invalid target_outcome`);
    else outcomeCounts[row.target_outcome] += 1;
    if (typeof row.current_truth !== "string" || row.current_truth.length === 0) errors.push(`${row.id} requires current_truth`);

    if (row.target_outcome === "consolidated_legacy_mapping") {
      if (!row.replacement || !EXECUTABLE_TARGET_IDS.has(row.replacement.id)) {
        errors.push(`${row.id} requires an executable official replacement`);
      }
      if (!row.replacement || typeof row.replacement.input !== "object" || Array.isArray(row.replacement.input)) {
        errors.push(`${row.id} requires replacement input mapping`);
      }
    } else if (row.replacement !== null) {
      errors.push(`${row.id} must not declare a replacement`);
    }

    if (row.target_outcome === "internal_withdrawn_draft") {
      if (!Array.isArray(row.future_candidates) || row.future_candidates.length === 0) {
        errors.push(`${row.id} requires future task Macro candidates`);
      }
    } else if (!Array.isArray(row.future_candidates) || row.future_candidates.length !== 0) {
      errors.push(`${row.id} must not declare future candidates`);
    }
  }

  if (inventory.length !== ALPHA3_2_5_0_MACRO_INVENTORY_COUNTS.total) errors.push("Macro inventory must contain exactly 28 rows");
  for (const [key, observed] of Object.entries({ ...sourceCounts, ...outcomeCounts })) {
    const expected = ALPHA3_2_5_0_MACRO_INVENTORY_COUNTS[key];
    if (observed !== expected) errors.push(`Macro inventory ${key} count must be ${expected}, observed ${observed}`);
  }

  const officialRows = inventory.filter((row) => row.target_outcome === "executable_official").map((row) => row.id).sort();
  if (JSON.stringify(officialRows) !== JSON.stringify([...ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS].sort())) {
    errors.push("Executable official target ids do not match the approved target set");
  }

  return { valid: errors.length === 0, errors };
}

export function summarizeMacroInventory(inventory = ALPHA3_2_5_0_MACRO_INVENTORY) {
  const validation = validateMacroInventory(inventory);
  return deepFreeze({
    contract: ALPHA3_2_5_0_MACRO_INVENTORY_CONTRACT,
    valid: validation.valid,
    counts: ALPHA3_2_5_0_MACRO_INVENTORY_COUNTS,
    executable_target_ids: ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS,
    errors: validation.errors,
  });
}

function official(id, currentTruth, sourceGroup = "current") {
  return row(id, sourceGroup, currentTruth, "executable_official");
}

function mapping(id, sourceGroup, currentTruth, replacementId, input) {
  return row(id, sourceGroup, currentTruth, "consolidated_legacy_mapping", {
    replacement: { id: replacementId, input },
  });
}

function withdrawn(id, currentTruth, futureCandidates, note) {
  return row(id, "current", currentTruth, "internal_withdrawn_draft", {
    future_candidates: futureCandidates,
    note,
  });
}

function row(id, sourceGroup, currentTruth, targetOutcome, overrides = {}) {
  return {
    id,
    source_group: sourceGroup,
    current_truth: currentTruth,
    target_outcome: targetOutcome,
    replacement: null,
    future_candidates: [],
    note: null,
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

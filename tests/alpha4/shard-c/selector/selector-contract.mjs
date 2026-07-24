const SELECTOR_CONTRACT = "alpha4.shard-c.selector.contract.v1";
const MATRIX_CONTRACT = "alpha4.shard-c.selector.matrix.v1";
const FAILURE_CONTRACT = "alpha4.shard-c.selector.failure-fixtures.v1";

export const SELECTOR_STATUSES = Object.freeze([
  "selected_supported",
  "exact_only",
  "not_applicable",
  "held",
]);

export const SELECTOR_KINDS = Object.freeze([
  "current_selection",
  "explicit_refs",
  "predicate",
]);

export const PREDICATE_FIELDS = Object.freeze({
  track: Object.freeze(["muted", "soloed", "record_armed", "name"]),
  item: Object.freeze(["muted", "locked", "active_take_name"]),
});

export const PREDICATE_OPERATORS = Object.freeze([
  "equals",
  "contains",
  "starts_with",
]);

export const ALPHA4_SHARD_C_SELECTOR_SCHEMA = Object.freeze({
  contract: SELECTOR_CONTRACT,
  version: "1.0.0",
  selector: {
    oneOf: ["current_selection", "explicit_refs", "predicate"],
    current_selection: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "current_selection" },
        entity_kind: { enum: ["track", "item"] },
        snapshot: { type: "string", minLength: 1 },
      },
      required: ["kind", "entity_kind"],
    },
    explicit_refs: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "explicit_refs" },
        refs: { type: "array", minItems: 1, maxItems: 512, uniqueItems: true },
      },
      required: ["kind", "refs"],
    },
    predicate: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "predicate" },
        entity_kind: { enum: ["track", "item"] },
        field: { type: "string" },
        operator: { enum: ["equals", "contains", "starts_with"] },
        value: {},
        snapshot: { type: "string", minLength: 1 },
      },
      required: ["kind", "entity_kind", "field", "operator", "value"],
    },
  },
  snapshot: {
    type: "object",
    additionalProperties: false,
    properties: {
      project_ref: { type: "string", minLength: 1 },
      bridge_owner: { type: "string", minLength: 1 },
      bridge_generation: { type: "integer", minimum: 0 },
      selection_token: { type: "string", minLength: 1 },
      revision: { type: "string", minLength: 1 },
      frozen_refs: { type: "array", uniqueItems: true, maxItems: 512 },
    },
    required: ["project_ref", "bridge_owner", "bridge_generation", "selection_token", "revision", "frozen_refs"],
  },
});

const MACRO_SELECTOR_MATRIX = [
  {
    macro_id: "macro.project.inspect",
    status: "not_applicable",
    selector_shape: ["selected_context:read_output"],
    empty_behavior: "read_empty_context",
    ceiling: { current: 1, alpha4_candidate: null, claim: "read_only_projection" },
    reason: "Current selection is observed as output context, not accepted as a target input.",
    dependency: "none",
  },
  {
    macro_id: "macro.project.query",
    status: "selected_supported",
    selector_shape: ["current_selection:track|item", "predicate:project_index_read"],
    empty_behavior: "typed_empty_query_result",
    ceiling: { current: 100, alpha4_candidate: 512, claim: "source_read_only" },
    reason: "Selection scope and selected filters are existing read-only query shapes.",
    dependency: "project_index_selection_truth:B-owned",
  },
  {
    macro_id: "macro.project.delete_targets",
    status: "exact_only",
    selector_shape: ["explicit_refs:track|item|marker|region|fx"],
    empty_behavior: "typed_empty_target_blocker",
    ceiling: { current: 250, alpha4_candidate: 512, claim: "exact_refs_only" },
    reason: "Current source resolves bounded selectors to exact refs; typed predicate delete is a C target.",
    dependency: "B truth contract + C predicate route",
  },
  {
    macro_id: "macro.project.apply_layout",
    status: "not_applicable",
    selector_shape: ["layout_rows", "annotation_rows"],
    empty_behavior: "typed_layout_empty_blocker",
    ceiling: { current: 100, alpha4_candidate: null, claim: "layout_row_source" },
    reason: "Current public input is declarative layout data, not a selection target.",
    dependency: "none",
  },
  {
    macro_id: "macro.project.file",
    status: "not_applicable",
    selector_shape: ["project_identity", "file_path_policy"],
    empty_behavior: "typed_project_identity_blocker",
    ceiling: { current: 1, alpha4_candidate: null, claim: "project_operation" },
    reason: "Save/save-as operates on the active project identity, not a target collection.",
    dependency: "B project/file truth",
  },
  {
    macro_id: "macro.routing.apply",
    status: "exact_only",
    selector_shape: ["explicit_refs:track", "explicit_refs:send"],
    empty_behavior: "typed_routing_empty_blocker",
    ceiling: { current: 64, alpha4_candidate: 512, claim: "route_rows_source" },
    reason: "Routing rows require canonical internal track/send refs and forbid implicit endpoints.",
    dependency: "routing native atoms",
  },
  {
    macro_id: "macro.media.place_assets",
    status: "not_applicable",
    selector_shape: ["asset_rows", "search_library", "relink_take_refs"],
    empty_behavior: "typed_asset_empty_blocker",
    ceiling: { current: 8, alpha4_candidate: null, claim: "asset_row_source" },
    reason: "Current public targeting is asset-driven, not selected/predicate-driven.",
    dependency: "none",
  },
  {
    macro_id: "macro.items.analyze",
    status: "selected_supported",
    selector_shape: ["current_selection:item", "explicit_refs:item"],
    empty_behavior: "typed_items_empty_blocker",
    ceiling: { current: 8, alpha4_candidate: 512, claim: "source_limit" },
    reason: "The existing analysis input accepts selected or exact Item targets.",
    dependency: "template.items.list_selected_items",
  },
  {
    macro_id: "macro.items.apply",
    status: "selected_supported",
    selector_shape: ["current_selection:item", "explicit_refs:item", "predicate:item:held"],
    empty_behavior: "typed_items_empty_blocker",
    ceiling: { current: 8, alpha4_candidate: 512, claim: "selected_source_limit" },
    reason: "Arrangement/property modes accept selected Items; assignment and Take modes remain exact-only.",
    dependency: "B selection freshness + C shared batch",
  },
  {
    macro_id: "macro.midi.apply",
    status: "exact_only",
    selector_shape: ["explicit_refs:track|take", "operation_rows"],
    empty_behavior: "typed_midi_target_blocker",
    ceiling: { current: 8, alpha4_candidate: 512, claim: "operation_source_limit" },
    reason: "Current MIDI write operations chain exact track/take refs; selected bulk support is not established.",
    dependency: "D MIDI capability truth",
  },
  {
    macro_id: "macro.fx.apply_chain",
    status: "exact_only",
    selector_shape: ["selector_or_exact_track_ref", "exact_take_ref"],
    empty_behavior: "typed_track_empty_or_ambiguous_blocker",
    ceiling: { current: 1, alpha4_candidate: null, claim: "current_owner_source" },
    reason: "Current public FX owner targeting is selector/ref based rather than direct current selection.",
    dependency: "D FX semantic truth",
  },
  {
    macro_id: "macro.fx.set_controls",
    status: "exact_only",
    selector_shape: ["explicit_refs:fx", "parameter_rows"],
    empty_behavior: "typed_fx_ref_blocker",
    ceiling: { current: 64, alpha4_candidate: 512, claim: "assignment_source_limit" },
    reason: "Control writes require owner-scoped exact FX refs and parameter identity.",
    dependency: "D FX semantic truth",
  },
  {
    macro_id: "macro.controls.set",
    status: "exact_only",
    selector_shape: ["one_project_index_selector", "explicit_refs:track|item|take|fx"],
    empty_behavior: "typed_selector_truth_blocker",
    ceiling: { current: 8, alpha4_candidate: null, claim: "explicit_selector_source" },
    reason: "Current public input is explicit selector/ref based rather than current-selection based.",
    dependency: "accepted_shard_b_selection_identity",
  },
  {
    macro_id: "macro.automation.apply",
    status: "exact_only",
    selector_shape: ["explicit_refs:track|item|take", "automation_rows"],
    empty_behavior: "typed_automation_target_blocker",
    ceiling: { current: 8, alpha4_candidate: 512, claim: "source_row_limit" },
    reason: "Automation rows carry explicit owner identity; current selection routing is not established.",
    dependency: "B selection truth + D automation atoms",
  },
  {
    macro_id: "macro.render.targets",
    status: "selected_supported",
    selector_shape: ["current_selection:item|track", "explicit_refs:item|track|region"],
    empty_behavior: "typed_render_target_blocker",
    ceiling: { current: 16, alpha4_candidate: 512, claim: "render_target_source_limit" },
    reason: "The render target kind explicitly distinguishes selected Items/Tracks from explicit refs.",
    dependency: "managed render root + D render truth",
  },
];

export const ALPHA4_SHARD_C_SELECTOR_MATRIX = Object.freeze(MACRO_SELECTOR_MATRIX.map((row) => Object.freeze({
  ...row,
  selector_shape: Object.freeze([...row.selector_shape]),
  ceiling: Object.freeze({ ...row.ceiling }),
  dependency: row.dependency,
})));

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, path, message) {
  return { valid: false, errors: [{ code, path, message }] };
}

export function validateSelector(value) {
  if (!isObject(value)) return fail("SELECTOR_TYPE_INVALID", "$", "selector must be an object");
  if (!SELECTOR_KINDS.includes(value.kind)) return fail("SELECTOR_KIND_INVALID", "$.kind", "selector kind is not accepted");
  if (value.kind === "explicit_refs") {
    if (!Array.isArray(value.refs)) return fail("SELECTOR_REFS_REQUIRED", "$.refs", "explicit_refs requires refs");
    if (value.refs.length === 0) return fail("SELECTOR_EMPTY", "$.refs", "explicit_refs cannot be empty");
    if (value.refs.length > 512) return fail("SELECTOR_LIMIT_EXCEEDED", "$.refs", "selector candidate ceiling is 512");
    if (new Set(value.refs).size !== value.refs.length) return fail("SELECTOR_DUPLICATE_REF", "$.refs", "refs must be unique");
    if (value.refs.some((ref) => typeof ref !== "string" || !/^(track|item|take|fx|marker|region):/u.test(ref))) {
      return fail("SELECTOR_REF_INVALID", "$.refs", "refs must be canonical typed refs");
    }
  }
  if (value.kind === "current_selection" && !["track", "item"].includes(value.entity_kind)) {
    return fail("SELECTOR_ENTITY_KIND_INVALID", "$.entity_kind", "current selection supports track or item");
  }
  if (value.kind === "predicate") {
    if (!Object.hasOwn(PREDICATE_FIELDS, value.entity_kind)) return fail("PREDICATE_ENTITY_KIND_INVALID", "$.entity_kind", "predicate entity kind is not accepted");
    if (!PREDICATE_FIELDS[value.entity_kind].includes(value.field)) return fail("PREDICATE_FIELD_INVALID", "$.field", "predicate field is not approved for this entity");
    if (!PREDICATE_OPERATORS.includes(value.operator)) return fail("PREDICATE_OPERATOR_INVALID", "$.operator", "predicate operator is not accepted");
    if (typeof value.value !== "string" && typeof value.value !== "boolean") return fail("PREDICATE_VALUE_INVALID", "$.value", "predicate value must be a string or boolean");
    if (typeof value.value === "boolean" && value.operator !== "equals") return fail("PREDICATE_VALUE_OPERATOR_INVALID", "$.operator", "boolean predicates only support equals");
  }
  return { valid: true, errors: [] };
}

export function validateSnapshot(value) {
  if (!isObject(value)) return fail("SNAPSHOT_TYPE_INVALID", "$", "snapshot must be an object");
  for (const field of ["project_ref", "bridge_owner", "selection_token", "revision"]) {
    if (typeof value[field] !== "string" || value[field].length === 0) return fail("SNAPSHOT_FIELD_REQUIRED", `$.${field}`, `${field} is required`);
  }
  if (!Number.isInteger(value.bridge_generation) || value.bridge_generation < 0) return fail("SNAPSHOT_GENERATION_INVALID", "$.bridge_generation", "bridge_generation must be a non-negative integer");
  if (!Array.isArray(value.frozen_refs) || new Set(value.frozen_refs).size !== value.frozen_refs.length) return fail("SNAPSHOT_REFS_INVALID", "$.frozen_refs", "frozen_refs must be a unique array");
  return { valid: true, errors: [] };
}

export function validateSelectorMatrix(matrix = ALPHA4_SHARD_C_SELECTOR_MATRIX) {
  if (!Array.isArray(matrix)) return fail("MATRIX_TYPE_INVALID", "$", "selector matrix must be an array");
  if (matrix.length !== 15) return fail("MATRIX_COUNT_INVALID", "$", "selector matrix must contain exactly 15 Macro rows");
  const ids = new Set();
  for (const row of matrix) {
    if (!isObject(row) || typeof row.macro_id !== "string") return fail("MATRIX_ROW_INVALID", "$", "each matrix row requires macro_id");
    if (ids.has(row.macro_id)) return fail("MATRIX_DUPLICATE_ID", `$.${row.macro_id}`, "Macro ids must be unique");
    ids.add(row.macro_id);
    if (!SELECTOR_STATUSES.includes(row.status)) return fail("MATRIX_STATUS_INVALID", `$.${row.macro_id}.status`, "selector status is not accepted");
    if (!Array.isArray(row.selector_shape) || row.selector_shape.length === 0) return fail("MATRIX_SHAPE_INVALID", `$.${row.macro_id}.selector_shape`, "selector_shape must be non-empty");
    if (typeof row.empty_behavior !== "string" || typeof row.reason !== "string" || typeof row.dependency !== "string") return fail("MATRIX_METADATA_INVALID", `$.${row.macro_id}`, "matrix row requires behavior, reason, and dependency");
    if (!isObject(row.ceiling) || !Number.isInteger(row.ceiling.current) || row.ceiling.current < 1) return fail("MATRIX_CEILING_INVALID", `$.${row.macro_id}.ceiling`, "current ceiling must be a positive integer");
  }
  return { valid: true, errors: [] };
}

export const ALPHA4_SHARD_C_SELECTOR_FAILURE_FIXTURES = Object.freeze([
  { id: "empty-current-selection", kind: "current_selection", input: { kind: "current_selection", entity_kind: "item" }, expected: { code: "SELECTOR_EMPTY", writes: 0, undo_opened: false } },
  { id: "invalid-selector-type", kind: "schema", input: null, expected: { code: "SELECTOR_TYPE_INVALID", writes: 0, undo_opened: false } },
  { id: "unsupported-predicate-field", kind: "predicate", input: { kind: "predicate", entity_kind: "track", field: "locked", operator: "equals", value: true }, expected: { code: "PREDICATE_FIELD_INVALID", writes: 0, undo_opened: false } },
  { id: "predicate-name-ambiguity", kind: "predicate", input: { kind: "predicate", entity_kind: "track", field: "name", operator: "equals", value: "VOX" }, expected: { code: "SELECTOR_AMBIGUOUS", writes: 0, undo_opened: false } },
  { id: "candidate-limit-513", kind: "explicit_refs", input: { kind: "explicit_refs", refs: Array.from({ length: 513 }, (_, index) => `item:guid:{C-${index}}`) }, expected: { code: "SELECTOR_LIMIT_EXCEEDED", writes: 0, undo_opened: false } },
  { id: "duplicate-guid-snapshot", kind: "snapshot", input: { project_ref: "project:current", bridge_owner: "owner:c", bridge_generation: 1, selection_token: "selection:1", revision: "revision:1", frozen_refs: ["item:guid:{A}", "item:guid:{A}"] }, expected: { code: "SNAPSHOT_REFS_INVALID", writes: 0, undo_opened: false } },
  { id: "selection-drift-before-write", kind: "snapshot", input: { project_ref: "project:current", bridge_owner: "owner:c", bridge_generation: 1, selection_token: "selection:old", revision: "revision:1", frozen_refs: ["item:guid:{A}"] }, drift: { observed_selection_token: "selection:new" }, expected: { code: "PREWRITE_SELECTION_DRIFT", writes: 0, undo_opened: false } },
  { id: "master-protected", kind: "predicate", input: { kind: "predicate", entity_kind: "track", field: "name", operator: "equals", value: "MASTER" }, expected: { code: "PROTECTED_MASTER_TARGET", writes: 0, undo_opened: false } },
  { id: "folder-cascade-explicit", kind: "explicit_refs", input: { kind: "explicit_refs", refs: ["track:guid:{FOLDER}"] }, cascade: { descendants: ["track:guid:{CHILD}"] }, expected: { code: "FOLDER_CASCADE_CONFIRMATION_REQUIRED", writes: 0, undo_opened: false } },
]);

export const ALPHA4_SHARD_C_SELECTOR_CONTRACTS = Object.freeze({
  selector: SELECTOR_CONTRACT,
  matrix: MATRIX_CONTRACT,
  failures: FAILURE_CONTRACT,
});

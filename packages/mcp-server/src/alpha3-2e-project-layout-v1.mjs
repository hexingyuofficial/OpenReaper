export const ALPHA3_2E_PROJECT_LAYOUT_MACRO_CONTRACT = "alpha3.2e.project_layout_macro.v1";
export const ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID = "macro.project.apply_layout";
export const ALPHA3_2E_PROJECT_LAYOUT_MACRO_VERSION = "1.0.0";

export async function executeAlpha3_2EProjectLayoutMacro(options) {
  const { executeAlpha3_2_5CProjectWriteMacro } = await import("./alpha3-2-5-c-project-write-runtime-v1.mjs");
  return executeAlpha3_2_5CProjectWriteMacro(options);
}

const ALLOWED_INPUT_FIELDS = new Set(["layout", "annotations", "match_policy", "conflict_policy", "dry_run", "compact_response"]);
const ALLOWED_ROW_FIELDS = new Set(["id", "kind", "name", "track_ref", "color", "parent_id", "index", "folder_depth", "children"]);
const ALLOWED_ANNOTATION_FIELDS = new Set(["id", "kind", "name", "position_seconds", "start_seconds", "end_seconds", "color", "marker_ref", "region_ref"]);
const ALLOWED_KINDS = new Set(["track", "folder"]);
const ALLOWED_ANNOTATION_KINDS = new Set(["marker", "region"]);
const ALLOWED_MATCH_POLICIES = new Set(["by_ref", "exact_name", "create_only"]);
const ALLOWED_CONFLICT_POLICIES = new Set(["skip", "update_declared_fields", "stop"]);
const MAX_LAYOUT_ROWS = 100;
const MAX_TRACK_SCAN_ROWS = 256;
const MAX_LAYOUT_NESTING_DEPTH = 8;
const MAX_ANNOTATION_ROWS = 50;
const MAX_OPERATION_ROWS = 100;
const MAX_NAME_BYTES = 160;
const MAX_ID_BYTES = 96;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;

const LIST_TRACKS_ID = "template.tracks.list_tracks";
const READ_FOLDERS_ID = "template.tracks.read_folder_structure";
const CREATE_TRACK_ID = "template.tracks.create_track";
const CREATE_FOLDER_ID = "template.tracks.create_folder_track";
const RENAME_TRACK_ID = "template.tracks.rename_track";
const SET_COLOR_ID = "template.tracks.set_color";
const MOVE_TRACK_ID = "template.tracks.move_track";
const SET_FOLDER_DEPTH_ID = "template.tracks.set_folder_depth";
const NEST_TRACKS_ID = "template.tracks.nest_tracks_in_folder";
const LIST_MARKERS_REGIONS_ID = "template.project.list_markers_regions";
const CREATE_MARKER_ID = "template.project.create_marker";
const CREATE_REGION_ID = "template.project.create_region";

export function isAlpha3_2EProjectLayoutMacroId(id) {
  return id === ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID;
}

export function planAlpha3_2EProjectLayoutMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = [
    ...validateUnusedRequestPosture(requestPosture),
    ...validateInput(input, normalized),
  ];
  const rows = normalizeRows(normalized.layout);
  const annotations = normalizeAnnotations(normalized.annotations);
  blockers.push(...rows.blockers);
  blockers.push(...annotations.blockers);
  if (rows.rows.length + annotations.rows.length > MAX_OPERATION_ROWS) blockers.push(blocker("LAYOUT_OPERATIONS_TOO_LARGE", `layout and annotations accept at most ${MAX_OPERATION_ROWS} total rows after recursive children are flattened.`));
  blockers.push(...validateOperationIds(rows.rows, annotations.rows));
  const matchPolicy = normalizeMatchPolicy(normalized.match_policy);
  const conflictPolicy = normalizeConflictPolicy(normalized.conflict_policy);
  const dryRun = normalized.dry_run !== false;
  const preview = buildPreview(rows.rows, annotations.rows, { matchPolicy, conflictPolicy });

  if (blockers.length > 0) return blockedPlan(blockers, preview);
  if (rows.rows.length + annotations.rows.length === 0) return blockedPlan([blocker("LAYOUT_EMPTY", "macro.project.apply_layout requires at least one layout or annotations row.")], preview);
  if (dryRun) return dryRunPlan(preview);

  const mutationRequests = buildMutationRequests(rows.rows, annotations.rows);
  const preflight = preflightRequests(preview);
  const readback = readbackRequests(preview);
  const childRequests = [...preflight, ...mutationRequests, ...readback];
  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_LAYOUT_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_LAYOUT_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
    ok: true,
    mode: "plan_only_agent_executed_child_requests",
    dry_run: false,
    match_policy: matchPolicy,
    conflict_policy: conflictPolicy,
    preview,
    preflight_requests: preflight,
    mutation_requests: mutationRequests,
    readback_requests: readback,
    child_requests: childRequests,
    success_criteria: successCriteriaFor(preview),
    agent_execution_flow: agentExecutionFlow(preview),
    blockers: [],
    typed_blockers: [],
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

export function createAlpha3_2EProjectLayoutMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3_2EProjectLayoutMacro(request.input ?? {}, requestPosture(request));
  const envelope = {
    contract: "call_template.runtime.v1",
    ok: normalizedPlan.ok,
    template: {
      id: ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
      pack: "project",
      risk: "write",
    },
    request: summarizeRuntimeRequest(request),
    completed_at: safeNowIso(now),
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2E_PROJECT_LAYOUT_MACRO_CONTRACT,
      action_kind: "macro",
      mode: normalizedPlan.mode,
      executed: false,
      plan: normalizedPlan,
      dry_run: normalizedPlan.dry_run,
      preview: normalizedPlan.preview,
      preflight_requests: normalizedPlan.preflight_requests,
      mutation_requests: normalizedPlan.mutation_requests,
      readback_requests: normalizedPlan.readback_requests,
      child_requests: normalizedPlan.child_requests,
      agent_execution_flow: normalizedPlan.agent_execution_flow,
      typed_blockers: normalizedPlan.typed_blockers,
      no_executor_safety_posture: normalizedPlan.no_executor_safety_posture,
      execution: {
        executed: false,
        executor_call_count: 0,
        reason: "macro.project.apply_layout only returns an agent-executed child-request plan; the server never dispatches layout mutations.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_action_lua_shell_ui: false,
        bridge_request_created: false,
        live_executor_allowlist_member: false,
      },
      safety: normalizedPlan.safety,
    },
    budget: { max_response_bytes: 65_536, response_bytes: 0 },
  };
  envelope.budget.response_bytes = Buffer.byteLength(JSON.stringify(envelope));
  return deepFreeze(envelope);
}

export function createAlpha3_2EProjectLayoutMacroDiscoveryItems(options = {}) {
  return [deepFreeze({
    id: ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
    title: "Apply project layout",
    summary: "Preview or execute bounded track/folder layout plus create-only Marker/Region timeline annotations with structural live readback.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.project.apply_layout",
    tags: ["macro", "project", "layout", "tracks", "folders", "markers", "regions", "timeline", "executable"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "project_apply_layout",
    menu_group: "primary",
    execution_shape: "registered_macro_program",
    user_label: "Apply project layout",
    task_intents: ["create track layout", "organize track folders", "apply track colors", "arrange track order", "create timeline markers", "create timeline regions"],
    support_status: "executable_runtime_bound",
    implementation_status: "executable",
    support_state: "supported_with_readback",
    exists_in_catalog: true,
    live_runnable_now: options.liveRunnableNow === true,
    evidence_level: options.liveRunnableNow === true ? "runtime_bound_live_route_available" : "runtime_bound_executable",
    known_blocker: null,
    allowed_live_group: null,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        layout: { type: "array" },
        annotations: { type: "array", maxItems: MAX_ANNOTATION_ROWS },
        match_policy: { enum: [...ALLOWED_MATCH_POLICIES] },
        conflict_policy: { enum: [...ALLOWED_CONFLICT_POLICIES] },
        dry_run: { type: "boolean" },
        compact_response: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["contract", "ok", "macro", "execution", "result"],
      properties: {
        contract: { const: "macro.execution.v1" },
        ok: { type: "boolean" },
        macro: { type: "object" },
        execution: { type: "object" },
        result: { type: "object" },
      },
    },
    refs: { input: ["track_ref"], output: ["track_ref", "marker_ref", "region_ref"] },
    expectedDelta: {
      kind: "write",
      action: "apply_project_layout",
      entities: ["track", "folder", "marker", "region"],
      summary: "Executes the fixed bounded layout program and verifies track/folder structure plus created timeline annotations.",
    },
    examples: [
      { input: { layout: [{ id: "drums", kind: "folder", name: "Drums" }, { id: "kick", kind: "track", name: "Kick", parent_id: "drums", color: "#C00000" }], dry_run: true } },
      { input: { annotations: [{ id: "intro", kind: "marker", name: "Intro", position_seconds: 0 }, { id: "chorus", kind: "region", name: "Chorus", start_seconds: 8, end_seconds: 16 }], dry_run: true } },
    ],
  })];
}

function dryRunPlan(preview) {
  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_LAYOUT_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_LAYOUT_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
    ok: true,
    mode: "dry_run_preview",
    dry_run: true,
    match_policy: preview.match_policy,
    conflict_policy: preview.conflict_policy,
    preview,
    preflight_requests: preflightRequests(preview),
    mutation_requests: [],
    readback_requests: readbackRequests(preview),
    child_requests: preflightRequests(preview),
    success_criteria: successCriteriaFor(preview),
    agent_execution_flow: { instruction: "Run preflight reads, show the layout diff, then retry with dry_run:false to receive mutation child requests.", child_request_policy: "preflight_only_on_dry_run", stop_on_blocker: true },
    blockers: [],
    typed_blockers: [],
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function blockedPlan(blockers, preview = emptyPreview()) {
  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_LAYOUT_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_LAYOUT_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
    ok: false,
    mode: "blocked",
    dry_run: true,
    preview,
    preflight_requests: [],
    mutation_requests: [],
    readback_requests: [],
    child_requests: [],
    success_criteria: {},
    agent_execution_flow: {},
    blockers,
    typed_blockers: blockers,
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function validateUnusedRequestPosture(posture) {
  const blockers = [];
  if (posture.idempotency_key_present === true) blockers.push(blocker("LAYOUT_IDEMPOTENCY_KEY_UNSUPPORTED", "macro.project.apply_layout does not accept idempotency_key; child templates own idempotency semantics."));
  return blockers;
}

function validateInput(original, normalized) {
  if (!isPlainObject(original)) return [blocker("LAYOUT_INPUT_INVALID", "macro.project.apply_layout input must be an object.")];
  const blockers = [];
  const keys = Object.keys(normalized);
  const unknown = keys.filter((key) => !ALLOWED_INPUT_FIELDS.has(key));
  if (unknown.length > 0) blockers.push(blocker("LAYOUT_INPUT_FIELDS_UNSUPPORTED", "macro.project.apply_layout input contains unsupported fields.", { fields: unknown.slice(0, UNKNOWN_FIELD_DETAIL_LIMIT), omitted_count: Math.max(0, unknown.length - UNKNOWN_FIELD_DETAIL_LIMIT) }));
  if (normalized.layout !== undefined && !Array.isArray(normalized.layout)) blockers.push(blocker("LAYOUT_ROWS_INVALID", "layout must be an array."));
  if (normalized.annotations !== undefined && !Array.isArray(normalized.annotations)) blockers.push(blocker("LAYOUT_ANNOTATIONS_INVALID", "annotations must be an array."));
  if (Array.isArray(normalized.annotations) && normalized.annotations.length > MAX_ANNOTATION_ROWS) blockers.push(blocker("LAYOUT_ANNOTATIONS_TOO_LARGE", `annotations accepts at most ${MAX_ANNOTATION_ROWS} rows so one complete native read can verify every row.`));
  if (normalized.match_policy !== undefined && !ALLOWED_MATCH_POLICIES.has(normalized.match_policy)) blockers.push(blocker("LAYOUT_MATCH_POLICY_INVALID", "match_policy must be by_ref, exact_name, or create_only."));
  if (normalized.conflict_policy !== undefined && !ALLOWED_CONFLICT_POLICIES.has(normalized.conflict_policy)) blockers.push(blocker("LAYOUT_CONFLICT_POLICY_INVALID", "conflict_policy must be skip, update_declared_fields, or stop."));
  if (normalized.dry_run !== undefined && typeof normalized.dry_run !== "boolean") blockers.push(blocker("LAYOUT_DRY_RUN_INVALID", "dry_run must be boolean when supplied."));
  if (normalized.compact_response !== undefined && typeof normalized.compact_response !== "boolean") blockers.push(blocker("LAYOUT_COMPACT_RESPONSE_INVALID", "compact_response must be boolean when supplied."));
  return blockers;
}

function normalizeRows(layout) {
  const rows = [];
  const blockers = [];
  if (!Array.isArray(layout)) return { rows, blockers };
  const flattened = flattenLayoutRows(layout);
  blockers.push(...flattened.blockers);
  const ids = new Set();
  for (const [index, entry] of flattened.entries.entries()) {
    const { row } = entry;
    if (!isPlainObject(row)) {
      blockers.push(blocker("LAYOUT_ROW_INVALID", "Each layout row must be an object.", { index, path: entry.path }));
      continue;
    }
    const unknown = Object.keys(row).filter((key) => !ALLOWED_ROW_FIELDS.has(key));
    if (unknown.length > 0) blockers.push(blocker("LAYOUT_ROW_FIELDS_UNSUPPORTED", "Layout row contains unsupported fields.", { index, fields: unknown.slice(0, UNKNOWN_FIELD_DETAIL_LIMIT) }));
    const id = row.id;
    if (typeof id !== "string" || id.length === 0 || Buffer.byteLength(id) > MAX_ID_BYTES || /[\u0000-\u001f\u007f]/u.test(id)) {
      blockers.push(blocker("LAYOUT_ROW_ID_INVALID", "Each layout row requires a bounded string id without control characters.", { index }));
      continue;
    }
    if (ids.has(id)) blockers.push(blocker("LAYOUT_ROW_ID_DUPLICATE", "Layout row ids must be unique.", { id }));
    ids.add(id);
    const kind = row.kind ?? "track";
    if (!ALLOWED_KINDS.has(kind)) blockers.push(blocker("LAYOUT_ROW_KIND_INVALID", "Layout row kind must be track or folder.", { id, kind }));
    if (typeof row.name !== "string" || row.name.length === 0 || Buffer.byteLength(row.name) > MAX_NAME_BYTES || /[\u0000-\u001f\u007f]/u.test(row.name)) blockers.push(blocker("LAYOUT_ROW_NAME_INVALID", "Layout row name must be a bounded non-empty string without control characters.", { id }));
    if (row.track_ref !== undefined && (typeof row.track_ref !== "string" || !row.track_ref.startsWith("track:"))) blockers.push(blocker("LAYOUT_TRACK_REF_INVALID", "track_ref must be a canonical track ref when supplied.", { id }));
    if (row.parent_id !== undefined && (typeof row.parent_id !== "string" || row.parent_id.length === 0)) blockers.push(blocker("LAYOUT_PARENT_ID_INVALID", "parent_id must reference another layout row id.", { id }));
    if (entry.nested && row.parent_id !== undefined && row.parent_id !== entry.parentId) blockers.push(blocker("LAYOUT_PARENT_ID_CONFLICT", "A row nested under children cannot declare a different explicit parent_id.", { id, parent_id: row.parent_id, children_parent_id: entry.parentId }));
    if (row.index !== undefined && (!Number.isInteger(row.index) || row.index < 0)) blockers.push(blocker("LAYOUT_INDEX_INVALID", "index must be a non-negative integer when supplied.", { id }));
    if (row.folder_depth !== undefined && (!Number.isInteger(row.folder_depth) || row.folder_depth < -1 || row.folder_depth > 1)) blockers.push(blocker("LAYOUT_FOLDER_DEPTH_INVALID", "folder_depth must be -1, 0, or 1 when supplied.", { id }));
    if (row.color !== undefined && (typeof row.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(row.color))) blockers.push(blocker("LAYOUT_COLOR_INVALID", "color must be a #RRGGBB string when supplied.", { id }));
    rows.push({ id, kind, name: row.name, track_ref: row.track_ref ?? null, color: row.color ?? null, parent_id: entry.nested ? entry.parentId ?? null : row.parent_id ?? null, index: row.index ?? index, folder_depth: row.folder_depth ?? null });
  }
  const idSet = new Set(rows.map((row) => row.id));
  for (const row of rows) if (row.parent_id && !idSet.has(row.parent_id)) blockers.push(blocker("LAYOUT_PARENT_MISSING", "parent_id must reference an existing layout row.", { id: row.id, parent_id: row.parent_id }));
  blockers.push(...detectCycles(rows));
  return { rows: deepFreeze(rows), blockers };
}

function flattenLayoutRows(layout) {
  const entries = [];
  const blockers = [];
  const ancestors = new WeakSet();
  let rowLimitBlocked = false;
  let depthBlocked = false;
  let cycleBlocked = false;

  function visit(row, { parentId = null, nested = false, depth = 0, path }) {
    if (isPlainObject(row) && ancestors.has(row)) {
      if (!cycleBlocked) blockers.push(blocker("LAYOUT_CHILDREN_CYCLE", "Layout children must not contain a recursive object cycle.", { path }));
      cycleBlocked = true;
      return;
    }
    if (depth > MAX_LAYOUT_NESTING_DEPTH) {
      if (!depthBlocked) blockers.push(blocker("LAYOUT_CHILDREN_DEPTH_EXCEEDED", `Layout children nesting may not exceed ${MAX_LAYOUT_NESTING_DEPTH} levels.`, { path, max_depth: MAX_LAYOUT_NESTING_DEPTH }));
      depthBlocked = true;
      return;
    }
    if (entries.length >= MAX_LAYOUT_ROWS) {
      if (!rowLimitBlocked) blockers.push(blocker("LAYOUT_TOO_LARGE", `layout accepts at most ${MAX_LAYOUT_ROWS} rows after recursive children are flattened.`));
      rowLimitBlocked = true;
      return;
    }

    entries.push({ row, parentId, nested, depth, path });
    if (!isPlainObject(row) || row.children === undefined) return;
    if (!Array.isArray(row.children)) {
      blockers.push(blocker("LAYOUT_CHILDREN_INVALID", "children must be an array when supplied.", { id: row.id, path }));
      return;
    }

    ancestors.add(row);
    for (const [childIndex, child] of row.children.entries()) {
      visit(child, {
        parentId: row.id,
        nested: true,
        depth: depth + 1,
        path: `${path}.children[${childIndex}]`,
      });
    }
    ancestors.delete(row);
  }

  for (const [index, row] of layout.entries()) visit(row, { path: `layout[${index}]` });
  return { entries, blockers };
}

function normalizeAnnotations(annotations) {
  const rows = [];
  const blockers = [];
  if (!Array.isArray(annotations)) return { rows, blockers };
  const ids = new Set();
  for (const [index, row] of annotations.entries()) {
    if (!isPlainObject(row)) {
      blockers.push(blocker("LAYOUT_ANNOTATION_INVALID", "Each annotation row must be an object.", { index }));
      continue;
    }
    const unknown = Object.keys(row).filter((key) => !ALLOWED_ANNOTATION_FIELDS.has(key));
    if (unknown.length > 0) blockers.push(blocker("LAYOUT_ANNOTATION_FIELDS_UNSUPPORTED", "Annotation row contains unsupported fields.", { index, fields: unknown.slice(0, UNKNOWN_FIELD_DETAIL_LIMIT) }));
    const id = row.id;
    if (typeof id !== "string" || id.length === 0 || Buffer.byteLength(id) > MAX_ID_BYTES || /[\u0000-\u001f\u007f]/u.test(id)) {
      blockers.push(blocker("LAYOUT_ANNOTATION_ID_INVALID", "Each annotation row requires a bounded string id without control characters.", { index }));
      continue;
    }
    if (ids.has(id)) blockers.push(blocker("LAYOUT_ANNOTATION_ID_DUPLICATE", "Annotation row ids must be unique.", { id }));
    ids.add(id);
    if (!ALLOWED_ANNOTATION_KINDS.has(row.kind)) blockers.push(blocker("LAYOUT_ANNOTATION_KIND_INVALID", "Annotation kind must be marker or region.", { id, kind: row.kind }));
    if (typeof row.name !== "string" || row.name.length === 0 || Buffer.byteLength(row.name) > MAX_NAME_BYTES || /[\u0000-\u001f\u007f]/u.test(row.name)) blockers.push(blocker("LAYOUT_ANNOTATION_NAME_INVALID", "Annotation name must be a bounded non-empty string without control characters.", { id }));
    if (row.marker_ref !== undefined || row.region_ref !== undefined) blockers.push(blocker("LAYOUT_ANNOTATION_UPDATE_UNSUPPORTED", "Existing Marker/Region timing updates are not exposed because no accepted atom can move a Marker or change Region bounds.", { id }));
    if (row.color !== undefined) blockers.push(blocker("LAYOUT_ANNOTATION_COLOR_READBACK_UNSUPPORTED", "Annotation color is not exposed until a portable live readback can compare #RRGGBB with REAPER native color.", { id }));
    if (row.kind === "marker") {
      if (!finiteNonNegative(row.position_seconds)) blockers.push(blocker("LAYOUT_MARKER_POSITION_INVALID", "Marker position_seconds must be a finite non-negative number.", { id }));
      if (row.start_seconds !== undefined || row.end_seconds !== undefined) blockers.push(blocker("LAYOUT_MARKER_FIELDS_INVALID", "Marker rows use position_seconds, not Region bounds.", { id }));
    }
    if (row.kind === "region") {
      if (!finiteNonNegative(row.start_seconds)) blockers.push(blocker("LAYOUT_REGION_START_INVALID", "Region start_seconds must be a finite non-negative number.", { id }));
      if (!finiteNonNegative(row.end_seconds) || !(row.end_seconds > row.start_seconds)) blockers.push(blocker("LAYOUT_REGION_END_INVALID", "Region end_seconds must be finite and greater than start_seconds.", { id }));
      if (row.position_seconds !== undefined) blockers.push(blocker("LAYOUT_REGION_FIELDS_INVALID", "Region rows use start_seconds and end_seconds, not position_seconds.", { id }));
    }
    rows.push({
      id,
      kind: row.kind,
      name: row.name,
      ...(row.kind === "marker" ? { position_seconds: row.position_seconds } : { start_seconds: row.start_seconds, end_seconds: row.end_seconds }),
    });
  }
  const identityKeys = new Set();
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.name}`;
    if (identityKeys.has(key)) blockers.push(blocker("LAYOUT_ANNOTATION_REQUEST_CONFLICT", "One request cannot create multiple same-kind annotations with the same name.", { id: row.id, kind: row.kind, name: row.name }));
    identityKeys.add(key);
  }
  return { rows: deepFreeze(rows), blockers };
}

function validateOperationIds(layoutRows, annotationRows) {
  const layoutIds = new Set(layoutRows.map((row) => row.id));
  return annotationRows
    .filter((row) => layoutIds.has(row.id))
    .map((row) => blocker("LAYOUT_OPERATION_ID_DUPLICATE", "Layout and annotation operation ids must be unique across the whole request.", { id: row.id }));
}

function detectCycles(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const blockers = [];
  for (const row of rows) {
    const seen = new Set([row.id]);
    let cursor = row.parent_id;
    while (cursor) {
      if (seen.has(cursor)) {
        blockers.push(blocker("LAYOUT_CYCLE", "Layout parent graph must be acyclic.", { id: row.id, parent_id: cursor }));
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent_id ?? null;
    }
  }
  return blockers;
}

function buildPreview(rows, annotations, { matchPolicy, conflictPolicy }) {
  const counts = {
    rows: rows.length + annotations.length,
    layout_rows: rows.length,
    annotations: annotations.length,
    markers: annotations.filter((row) => row.kind === "marker").length,
    regions: annotations.filter((row) => row.kind === "region").length,
    folders: rows.filter((row) => row.kind === "folder").length,
    tracks: rows.filter((row) => row.kind === "track").length,
    create: rows.filter((row) => !row.track_ref).length,
    update: rows.filter((row) => row.track_ref).length,
    color: rows.filter((row) => row.color).length,
    nesting: rows.filter((row) => row.parent_id || row.folder_depth !== null).length,
  };
  return deepFreeze({
    contract: "alpha3.2e.project_layout.preview.v1",
    match_policy: matchPolicy,
    conflict_policy: conflictPolicy,
    target_counts: counts,
    rows: [
      ...rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, track_ref: row.track_ref, parent_id: row.parent_id, index: row.index, color: row.color, folder_depth: row.folder_depth })),
      ...annotations.map((row) => ({ ...row, annotation: true })),
    ],
    local_ref_map: Object.fromEntries([
      ...rows.map((row) => [row.id, row.track_ref ?? `track:planned:${row.id}`]),
      ...annotations.map((row) => [row.id, `${row.kind}:planned:${row.id}`]),
    ]),
  });
}

function emptyPreview() {
  return buildPreview([], [], { matchPolicy: "by_ref", conflictPolicy: "stop" });
}

function preflightRequests(preview) {
  const requests = [];
  if (preview.target_counts.layout_rows > 0) {
    requests.push(childRequest(requests.length + 1, "preflight", LIST_TRACKS_ID, {}, { limit: MAX_TRACK_SCAN_ROWS }, "Read current tracks before planning layout changes."));
    requests.push(childRequest(requests.length + 1, "preflight", READ_FOLDERS_ID, {}, { limit: MAX_TRACK_SCAN_ROWS }, "Read current folder structure before planning nesting/order changes."));
  }
  if (preview.target_counts.annotations > 0) requests.push(childRequest(requests.length + 1, "preflight", LIST_MARKERS_REGIONS_ID, {}, { limit: MAX_ANNOTATION_ROWS }, "Read every current Marker/Region before creating timeline annotations."));
  return deepFreeze(requests);
}

function readbackRequests(preview) {
  const requests = [];
  if (preview.target_counts.layout_rows > 0) {
    requests.push(childRequest(requests.length + 1, "readback", LIST_TRACKS_ID, {}, { limit: MAX_TRACK_SCAN_ROWS }, "Read tracks after layout changes."));
    requests.push(childRequest(requests.length + 1, "readback", READ_FOLDERS_ID, {}, { limit: MAX_TRACK_SCAN_ROWS }, "Read folder structure after layout changes."));
  }
  if (preview.target_counts.annotations > 0) requests.push(childRequest(requests.length + 1, "readback", LIST_MARKERS_REGIONS_ID, {}, { limit: MAX_ANNOTATION_ROWS }, "Read every Marker/Region and verify each created annotation by exact ref and fields."));
  return deepFreeze(requests);
}

function buildMutationRequests(rows, annotations) {
  const requests = [];
  const newIndexCounts = new Map();
  for (const row of rows) {
    if (!row.track_ref && row.index !== null && row.index !== undefined) {
      newIndexCounts.set(row.index, (newIndexCounts.get(row.index) ?? 0) + 1);
    }
  }
  let sequence = 1;
  for (const row of [...rows].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))) {
    const trackRef = row.track_ref ?? `track:planned:${row.id}`;
    if (!row.track_ref) {
      requests.push(childRequest(sequence++, "mutation", row.kind === "folder" ? CREATE_FOLDER_ID : CREATE_TRACK_ID, {}, { name: row.name, index: row.index }, `Create ${row.kind} ${row.id}.`, { produces_local_id: row.id }));
    } else {
      requests.push(childRequest(sequence++, "mutation", RENAME_TRACK_ID, { track_ref: trackRef }, { name: row.name }, `Rename matched track ${row.id}.`));
    }
    if (row.color) requests.push(childRequest(sequence++, "mutation", SET_COLOR_ID, { track_ref: trackRef }, { color: row.color }, `Set color for ${row.id}.`, dependencyFor(row)));
    const createAlreadyPlacesUniqueIndex = !row.track_ref && newIndexCounts.get(row.index) === 1;
    if (row.index !== null && row.index !== undefined && !createAlreadyPlacesUniqueIndex) requests.push(childRequest(sequence++, "mutation", MOVE_TRACK_ID, { track_ref: trackRef }, { index: row.index }, `Move ${row.id} to declared index.`, dependencyFor(row)));
    if (row.folder_depth !== null) requests.push(childRequest(sequence++, "mutation", SET_FOLDER_DEPTH_ID, { track_ref: trackRef }, { folder_depth: row.folder_depth }, `Set folder depth for ${row.id}.`, dependencyFor(row)));
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const parentIds = [...new Set(rows.filter((row) => row.parent_id).map((row) => row.parent_id))]
    .sort((left, right) => nestingDepth(rowsById.get(left), rowsById) - nestingDepth(rowsById.get(right), rowsById)
      || rowsById.get(left).index - rowsById.get(right).index
      || left.localeCompare(right));
  for (const parentId of parentIds) {
    const parent = rowsById.get(parentId);
    if (!parent) continue;
    const orderedDescendants = rows
      .filter((row) => isDescendantOf(row, parentId, rowsById))
      .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
    requests.push(childRequest(
      sequence++,
      "mutation",
      NEST_TRACKS_ID,
      {
        folder_ref: parent.track_ref ?? `track:planned:${parent.id}`,
        track_ref: orderedDescendants.map((row) => row.track_ref ?? `track:planned:${row.id}`),
      },
      {},
      `Nest the complete descendant block ${orderedDescendants.map((row) => row.id).join(", ")} under ${parent.id}.`,
      { depends_on_local_ids: [parent.id, ...orderedDescendants.map((row) => row.id)] },
    ));
  }
  for (const row of annotations) {
    const input = row.kind === "marker"
      ? { name: row.name, position_seconds: row.position_seconds }
      : { name: row.name, start_seconds: row.start_seconds, end_seconds: row.end_seconds };
    requests.push(childRequest(sequence++, "mutation", row.kind === "marker" ? CREATE_MARKER_ID : CREATE_REGION_ID, {}, input, `Create ${row.kind} annotation ${row.id}.`, { produces_local_id: row.id, produces_kind: row.kind }));
  }
  return deepFreeze(requests);
}

function nestingDepth(row, rowsById) {
  let depth = 0;
  let parentId = row?.parent_id ?? null;
  while (parentId) {
    depth += 1;
    parentId = rowsById.get(parentId)?.parent_id ?? null;
  }
  return depth;
}

function isDescendantOf(row, parentId, rowsById) {
  let currentParentId = row.parent_id;
  while (currentParentId) {
    if (currentParentId === parentId) return true;
    currentParentId = rowsById.get(currentParentId)?.parent_id ?? null;
  }
  return false;
}

function dependencyFor(row) {
  return row.track_ref ? {} : { depends_on_local_ids: [row.id] };
}

function childRequest(sequence, phase, id, refs, input, purpose, extra = {}) {
  return deepFreeze({ sequence, phase, tool: "call_template", id, refs, input, purpose, callable_now: true, required: true, ...extra });
}

function successCriteriaFor(preview) {
  return deepFreeze({
    declared_rows: preview.target_counts.rows,
    no_delete: "Unmatched existing tracks are not deleted or repurposed by this macro.",
    readback: "Agent must execute readback requests and compare track structure plus exact Marker/Region refs, names, and time bounds before claiming success.",
    no_executor: "Server executor_call_count remains 0; the agent executes child requests explicitly.",
  });
}

function agentExecutionFlow(preview) {
  return deepFreeze({
    instruction: "Execute preflight requests, mutation_requests in order, then readback requests. Stop on ambiguity or child blocker.",
    child_request_policy: "serial_agent_executed_call_template_only",
    declared_rows: preview.target_counts.rows,
    stop_on_blocker: true,
  });
}

function noExecutorSafetyPosture() {
  return { plan_only: true, agent_executes_children_explicitly: true, server_executes_children: false, executor_call_count: 0, bridge_request_created: false, live_executor_allowlist_member: false, added_tools: 0, public_call_recipe: false, hidden_executor: false, raw_action_lua_shell_ui: false, deletes_existing_tracks: false, hardware_or_device_io: false };
}

function macroRuntimeError(plan) {
  const first = plan.blockers[0] ?? blocker("LAYOUT_MACRO_BLOCKED", "Project layout macro planning was blocked.");
  return { source: "macro", code: first.code, message: first.message, recoverable: first.recoverable, details: { blockers: plan.blockers, mutation_requests: 0 } };
}

function normalizeMatchPolicy(value) { return value === undefined ? "by_ref" : value; }
function normalizeConflictPolicy(value) { return value === undefined ? "stop" : value; }
function requestPosture(request = {}) { return { idempotency_key_present: request.idempotency_key !== undefined }; }
function summarizeRuntimeRequest(request) { return { id: request.id ?? ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID, input_keys: isPlainObject(request.input) ? Object.keys(request.input).sort() : [], idempotency_key_present: requestPosture(request).idempotency_key_present }; }
function blocker(code, message, details = undefined) { return { code, message, recoverable: true, ...(details === undefined ? {} : { details }) }; }
function safeNowIso(now) { try { const value = now(); return (value instanceof Date ? value : new Date(value)).toISOString(); } catch { return new Date(0).toISOString(); } }
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function finiteNonNegative(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function deepFreeze(value) { if (!value || typeof value !== "object") return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }

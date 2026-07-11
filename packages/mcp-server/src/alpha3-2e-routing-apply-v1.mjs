export const ALPHA3_2E_ROUTING_APPLY_MACRO_CONTRACT = "alpha3.2e.routing_apply_macro.v1";
export const ALPHA3_2E_ROUTING_APPLY_MACRO_ID = "macro.routing.apply";
export const ALPHA3_2E_ROUTING_APPLY_MACRO_VERSION = "1.0.0";

const ALLOWED_INPUT_FIELDS = new Set(["routes", "master_parent", "channel_counts", "dry_run", "compact_response"]);
const ALLOWED_ROUTE_FIELDS = new Set(["id", "action", "source_track_ref", "destination_track_ref", "send_ref", "duplicate_policy", "volume", "pan", "muted"]);
const ALLOWED_MASTER_PARENT_FIELDS = new Set(["id", "track_ref", "enabled"]);
const ALLOWED_CHANNEL_COUNT_FIELDS = new Set(["id", "track_ref", "channel_count"]);
const MAX_ROUTE_ROWS = 64;
const MAX_ID_BYTES = 96;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;

const READ_PROJECT_ROUTING_ID = "template.routing.read_project_routing_graph";
const CREATE_SEND_ID = "template.routing.create_track_send";
const SET_SEND_VOLUME_ID = "template.routing.set_send_volume";
const SET_SEND_PAN_ID = "template.routing.set_send_pan";
const SET_SEND_MUTE_ID = "template.routing.set_send_mute";
const SET_MASTER_PARENT_ID = "template.routing.set_master_parent_send";
const SET_CHANNEL_COUNT_ID = "template.routing.set_track_channel_count";
const READ_TRACK_ROUTING_ID = "template.routing.read_track_routing";

export function isAlpha3_2ERoutingApplyMacroId(id) {
  return id === ALPHA3_2E_ROUTING_APPLY_MACRO_ID;
}

export function planAlpha3_2ERoutingApplyMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = [
    ...validateUnusedRequestPosture(requestPosture),
    ...validateInput(input, normalized),
  ];
  const routes = normalizeRoutes(normalized.routes);
  const masterParent = normalizeMasterParent(normalized.master_parent);
  const channelCounts = normalizeChannelCounts(normalized.channel_counts);
  blockers.push(...routes.blockers, ...masterParent.blockers, ...channelCounts.blockers);
  const dryRun = normalized.dry_run !== false;
  const operations = { routes: routes.rows, master_parent: masterParent.rows, channel_counts: channelCounts.rows };
  const preview = buildPreview(operations);

  if (blockers.length > 0) return blockedPlan(blockers, preview);
  if (preview.target_counts.total_operations === 0) return blockedPlan([blocker("ROUTING_APPLY_EMPTY", "macro.routing.apply requires at least one route, master_parent, or channel_count operation.")], preview);
  if (dryRun) return dryRunPlan(preview);

  const mutationRequests = buildMutationRequests(operations);
  const readback = readbackRequests(operations);
  const childRequests = [...preflightRequests(), ...mutationRequests, ...readback];
  return deepFreeze({
    contract: ALPHA3_2E_ROUTING_APPLY_MACRO_CONTRACT,
    version: ALPHA3_2E_ROUTING_APPLY_MACRO_VERSION,
    id: ALPHA3_2E_ROUTING_APPLY_MACRO_ID,
    ok: true,
    mode: "plan_only_agent_executed_child_requests",
    dry_run: false,
    preview,
    preflight_requests: preflightRequests(),
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

export function createAlpha3_2ERoutingApplyMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3_2ERoutingApplyMacro(request.input ?? {}, requestPosture(request));
  return deepFreeze({
    contract: "call_template.runtime.v1",
    ok: normalizedPlan.ok,
    template: { id: ALPHA3_2E_ROUTING_APPLY_MACRO_ID, pack: "routing", risk: "write" },
    request: summarizeRuntimeRequest(request),
    completed_at: safeNowIso(now),
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2E_ROUTING_APPLY_MACRO_CONTRACT,
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
        reason: "macro.routing.apply only returns an agent-executed child-request plan; the server never applies routing itself.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_action_lua_shell_ui: false,
        bridge_request_created: false,
        live_reaper_called: false,
        hardware_device_io: false,
      },
    },
  });
}

export function createAlpha3_2ERoutingApplyMacroDiscoveryItems() {
  return deepFreeze([{
    id: ALPHA3_2E_ROUTING_APPLY_MACRO_ID,
    title: "Apply internal routing",
    summary: "Plan bounded internal track-send, master-parent, and track-channel routing changes with readback.",
    pack: "routing",
    risk: "write",
    lifecycle: "accepted",
    entity_kind: "macro.routing.apply",
    tags: ["alpha3.2", "macro", "routing", "send", "plan_only"],
    action_kind: "macro",
    execution_shape: "plan_only_agent_executed_child_requests",
    implementation_status: "plan_only_runtime_bound_preview_first",
    runnable: true,
    input_schema: {
      type: "object",
      properties: {
        routes: { type: "array", maxItems: MAX_ROUTE_ROWS },
        master_parent: { type: "array", maxItems: MAX_ROUTE_ROWS },
        channel_counts: { type: "array", maxItems: MAX_ROUTE_ROWS },
        dry_run: { type: "boolean" },
        compact_response: { type: "boolean" },
      },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        mode: { enum: ["dry_run_preview", "plan_only_agent_executed_child_requests", "blocked"] },
        preview: { type: "object" },
        child_requests: { type: "array" },
        typed_blockers: { type: "array" },
      },
      required: ["mode", "preview", "child_requests", "typed_blockers"],
      additionalProperties: false,
    },
    examples: [{
      name: "create_send_and_set_gain",
      input: {
        routes: [{ id: "vox_to_verb", action: "create", source_track_ref: "track:guid:{VOX}", destination_track_ref: "track:guid:{VERB}", volume: 0.5, pan: 0, muted: false }],
        dry_run: true,
      },
    }],
  }]);
}

function validateInput(rawInput, input) {
  const blockers = [];
  if (!isPlainObject(rawInput)) blockers.push(blocker("ROUTING_INPUT_NOT_OBJECT", "macro.routing.apply input must be an object."));
  blockers.push(...unknownFieldBlockers(input, ALLOWED_INPUT_FIELDS, "ROUTING_INPUT_UNKNOWN_FIELD", "Unsupported macro.routing.apply input field."));
  for (const field of ["routes", "master_parent", "channel_counts"]) {
    if (input[field] !== undefined && !Array.isArray(input[field])) blockers.push(blocker("ROUTING_OPERATION_ARRAY_INVALID", `${field} must be an array when supplied.`, { field }));
    if (Array.isArray(input[field]) && input[field].length > MAX_ROUTE_ROWS) blockers.push(blocker("ROUTING_OPERATION_TOO_MANY", `${field} is limited to ${MAX_ROUTE_ROWS} rows.`, { field, count: input[field].length, limit: MAX_ROUTE_ROWS }));
  }
  return blockers;
}

function validateUnusedRequestPosture(posture = {}) {
  return posture.idempotency_key_present ? [blocker("ROUTING_APPLY_IDEMPOTENCY_KEY_UNSUPPORTED", "macro.routing.apply does not currently accept idempotency keys; child requests carry per-template evidence.")] : [];
}

function normalizeRoutes(value) {
  if (value === undefined) return { rows: deepFreeze([]), blockers: [] };
  if (!Array.isArray(value)) return { rows: deepFreeze([]), blockers: [] };
  const blockers = [];
  const ids = new Set();
  const rows = [];
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) {
      blockers.push(blocker("ROUTING_ROUTE_ROW_INVALID", "Each route row must be an object.", { index }));
      continue;
    }
    blockers.push(...unknownFieldBlockers(row, ALLOWED_ROUTE_FIELDS, "ROUTING_ROUTE_UNKNOWN_FIELD", "Unsupported route row field.", { index }));
    const id = normalizeId(row.id, index, "route");
    if (id.invalid) blockers.push(blocker("ROUTING_ROUTE_ID_INVALID", "Route rows require a bounded string id without control characters.", { index }));
    else if (ids.has(id.value)) blockers.push(blocker("ROUTING_ROUTE_ID_DUPLICATE", "Route ids must be unique.", { id: id.value }));
    else ids.add(id.value);
    const action = row.action ?? (row.send_ref ? "update" : "create");
    if (!["create", "update", "delete"].includes(action)) blockers.push(blocker("ROUTING_ROUTE_ACTION_INVALID", "Route action must be create, update, or delete.", { id: id.value, action }));
    if (action === "delete") blockers.push(blocker("ROUTE_DELETE_NOT_AUDITED", "Ordinary send deletion is not audited for macro.routing.apply yet.", { id: id.value }));
    if (row.source_track_ref !== undefined && !isTrackRef(row.source_track_ref)) blockers.push(blocker("ROUTING_SOURCE_TRACK_REF_INVALID", "source_track_ref must be a canonical track ref.", { id: id.value }));
    if (row.destination_track_ref !== undefined && !isTrackRef(row.destination_track_ref)) blockers.push(blocker("ROUTING_DESTINATION_TRACK_REF_INVALID", "destination_track_ref must be a canonical internal track ref; hardware/device endpoints are blocked.", { id: id.value }));
    if (isDeviceEndpoint(row.destination_track_ref) || isDeviceEndpoint(row.source_track_ref)) blockers.push(blocker("ROUTING_DEVICE_ENDPOINT_FORBIDDEN", "Hardware/device routing endpoints are hard-stopped.", { id: id.value }));
    if (row.send_ref !== undefined && !isSendRef(row.send_ref)) blockers.push(blocker("ROUTING_SEND_REF_INVALID", "send_ref must be a canonical send ref when supplied.", { id: id.value }));
    if (action === "create" && (!isTrackRef(row.source_track_ref) || !isTrackRef(row.destination_track_ref))) blockers.push(blocker("ROUTING_CREATE_REFS_REQUIRED", "Create route rows require source_track_ref and destination_track_ref.", { id: id.value }));
    if (action === "update" && !isSendRef(row.send_ref)) blockers.push(blocker("ROUTING_UPDATE_SEND_REF_REQUIRED", "Update route rows require send_ref.", { id: id.value }));
    if (row.duplicate_policy !== undefined && !["reject_existing", "allow_duplicate"].includes(row.duplicate_policy)) blockers.push(blocker("ROUTING_DUPLICATE_POLICY_INVALID", "duplicate_policy must be reject_existing or allow_duplicate.", { id: id.value }));
    if (row.volume !== undefined && !isNumberInRange(row.volume, 0, 4)) blockers.push(blocker("ROUTING_SEND_VOLUME_INVALID", "volume must be a finite scalar from 0 through 4.", { id: id.value }));
    if (row.pan !== undefined && !isNumberInRange(row.pan, -1, 1)) blockers.push(blocker("ROUTING_SEND_PAN_INVALID", "pan must be a finite value from -1 through 1.", { id: id.value }));
    if (row.muted !== undefined && typeof row.muted !== "boolean") blockers.push(blocker("ROUTING_SEND_MUTE_INVALID", "muted must be boolean when supplied.", { id: id.value }));
    rows.push({ id: id.value, action, source_track_ref: row.source_track_ref ?? null, destination_track_ref: row.destination_track_ref ?? null, send_ref: row.send_ref ?? null, duplicate_policy: row.duplicate_policy ?? "reject_existing", volume: row.volume, pan: row.pan, muted: row.muted });
  }
  return { rows: deepFreeze(rows), blockers };
}

function normalizeMasterParent(value) {
  if (value === undefined) return { rows: deepFreeze([]), blockers: [] };
  if (!Array.isArray(value)) return { rows: deepFreeze([]), blockers: [] };
  const blockers = [];
  const ids = new Set();
  const rows = [];
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) { blockers.push(blocker("ROUTING_MASTER_PARENT_ROW_INVALID", "Each master_parent row must be an object.", { index })); continue; }
    blockers.push(...unknownFieldBlockers(row, ALLOWED_MASTER_PARENT_FIELDS, "ROUTING_MASTER_PARENT_UNKNOWN_FIELD", "Unsupported master_parent row field.", { index }));
    const id = normalizeId(row.id ?? row.track_ref, index, "master_parent");
    if (id.invalid) blockers.push(blocker("ROUTING_MASTER_PARENT_ID_INVALID", "master_parent rows require a bounded id or track_ref.", { index }));
    else if (ids.has(id.value)) blockers.push(blocker("ROUTING_MASTER_PARENT_ID_DUPLICATE", "master_parent ids must be unique.", { id: id.value }));
    else ids.add(id.value);
    if (!isTrackRef(row.track_ref)) blockers.push(blocker("ROUTING_MASTER_PARENT_TRACK_REF_INVALID", "master_parent.track_ref must be a canonical track ref.", { id: id.value }));
    if (typeof row.enabled !== "boolean") blockers.push(blocker("ROUTING_MASTER_PARENT_ENABLED_INVALID", "master_parent.enabled must be boolean.", { id: id.value }));
    rows.push({ id: id.value, track_ref: row.track_ref, enabled: row.enabled });
  }
  return { rows: deepFreeze(rows), blockers };
}

function normalizeChannelCounts(value) {
  if (value === undefined) return { rows: deepFreeze([]), blockers: [] };
  if (!Array.isArray(value)) return { rows: deepFreeze([]), blockers: [] };
  const blockers = [];
  const ids = new Set();
  const rows = [];
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) { blockers.push(blocker("ROUTING_CHANNEL_COUNT_ROW_INVALID", "Each channel_counts row must be an object.", { index })); continue; }
    blockers.push(...unknownFieldBlockers(row, ALLOWED_CHANNEL_COUNT_FIELDS, "ROUTING_CHANNEL_COUNT_UNKNOWN_FIELD", "Unsupported channel_counts row field.", { index }));
    const id = normalizeId(row.id ?? row.track_ref, index, "channel_count");
    if (id.invalid) blockers.push(blocker("ROUTING_CHANNEL_COUNT_ID_INVALID", "channel_counts rows require a bounded id or track_ref.", { index }));
    else if (ids.has(id.value)) blockers.push(blocker("ROUTING_CHANNEL_COUNT_ID_DUPLICATE", "channel_counts ids must be unique.", { id: id.value }));
    else ids.add(id.value);
    if (!isTrackRef(row.track_ref)) blockers.push(blocker("ROUTING_CHANNEL_COUNT_TRACK_REF_INVALID", "channel_counts.track_ref must be a canonical track ref.", { id: id.value }));
    if (!Number.isInteger(row.channel_count) || row.channel_count < 2 || row.channel_count > 128 || row.channel_count % 2 !== 0) blockers.push(blocker("ROUTING_CHANNEL_COUNT_INVALID", "channel_count must be an even integer from 2 through 128.", { id: id.value }));
    rows.push({ id: id.value, track_ref: row.track_ref, channel_count: row.channel_count });
  }
  return { rows: deepFreeze(rows), blockers };
}

function buildPreview(operations) {
  const routeCreates = operations.routes.filter((row) => row.action === "create");
  const sendUpdates = operations.routes.filter((row) => row.volume !== undefined || row.pan !== undefined || row.muted !== undefined);
  return deepFreeze({
    contract: "alpha3.2e.routing_apply.preview.v1",
    target_counts: {
      routes: operations.routes.length,
      create_sends: routeCreates.length,
      send_updates: sendUpdates.length,
      master_parent: operations.master_parent.length,
      channel_counts: operations.channel_counts.length,
      total_operations: routeCreates.length + sendUpdates.length + operations.master_parent.length + operations.channel_counts.length,
    },
    routes: operations.routes.map((row) => ({ id: row.id, action: row.action, source_track_ref: row.source_track_ref, destination_track_ref: row.destination_track_ref, send_ref: plannedSendRef(row), volume: row.volume, pan: row.pan, muted: row.muted })),
    master_parent: operations.master_parent.map((row) => ({ id: row.id, track_ref: row.track_ref, enabled: row.enabled })),
    channel_counts: operations.channel_counts.map((row) => ({ id: row.id, track_ref: row.track_ref, channel_count: row.channel_count })),
  });
}

function preflightRequests() {
  return deepFreeze([childRequest(1, "preflight", READ_PROJECT_ROUTING_ID, {}, { include_master_parent: true, max_tracks: 128, max_edges: 256 }, "Read project routing graph before planning internal routing changes.")]);
}

function buildMutationRequests(operations) {
  const requests = [];
  let sequence = 1;
  for (const row of operations.routes) {
    if (row.action === "create") requests.push(childRequest(sequence++, "mutation", CREATE_SEND_ID, { source_track_ref: row.source_track_ref, destination_track_ref: row.destination_track_ref }, { duplicate_policy: row.duplicate_policy }, `Create internal track send ${row.id}.`));
    const sendRef = plannedSendRef(row);
    if (row.volume !== undefined) requests.push(childRequest(sequence++, "mutation", SET_SEND_VOLUME_ID, { send_ref: sendRef }, { volume: row.volume }, `Set send volume for route ${row.id}.`));
    if (row.pan !== undefined) requests.push(childRequest(sequence++, "mutation", SET_SEND_PAN_ID, { send_ref: sendRef }, { pan: row.pan }, `Set send pan for route ${row.id}.`));
    if (row.muted !== undefined) requests.push(childRequest(sequence++, "mutation", SET_SEND_MUTE_ID, { send_ref: sendRef }, { muted: row.muted }, `Set send mute for route ${row.id}.`));
  }
  for (const row of operations.master_parent) requests.push(childRequest(sequence++, "mutation", SET_MASTER_PARENT_ID, { track_ref: row.track_ref }, { enabled: row.enabled }, `Set master-parent routing for ${row.id}.`));
  for (const row of operations.channel_counts) requests.push(childRequest(sequence++, "mutation", SET_CHANNEL_COUNT_ID, { track_ref: row.track_ref }, { channel_count: row.channel_count }, `Set track channel count for ${row.id}.`));
  return deepFreeze(requests);
}

function readbackRequests(operations) {
  const tracks = new Set();
  for (const row of operations.routes) {
    if (row.source_track_ref) tracks.add(row.source_track_ref);
    if (row.destination_track_ref) tracks.add(row.destination_track_ref);
  }
  for (const row of operations.master_parent) tracks.add(row.track_ref);
  for (const row of operations.channel_counts) tracks.add(row.track_ref);
  return deepFreeze([...tracks].slice(0, MAX_ROUTE_ROWS).map((trackRef, index) => childRequest(index + 1, "readback", READ_TRACK_ROUTING_ID, { track_ref: trackRef }, { include_receives: true, include_master_parent: true, max_routes: 64 }, `Read routing for affected track ${trackRef}.`)));
}

function dryRunPlan(preview) {
  return deepFreeze({ contract: ALPHA3_2E_ROUTING_APPLY_MACRO_CONTRACT, version: ALPHA3_2E_ROUTING_APPLY_MACRO_VERSION, id: ALPHA3_2E_ROUTING_APPLY_MACRO_ID, ok: true, mode: "dry_run_preview", dry_run: true, preview, preflight_requests: [], mutation_requests: [], readback_requests: [], child_requests: [], blockers: [], typed_blockers: [], no_executor_safety_posture: noExecutorSafetyPosture(), safety: noExecutorSafetyPosture() });
}

function blockedPlan(blockers, preview = emptyPreview()) {
  const frozenBlockers = deepFreeze(blockers.map((entry) => ({ ...entry })));
  return deepFreeze({ contract: ALPHA3_2E_ROUTING_APPLY_MACRO_CONTRACT, version: ALPHA3_2E_ROUTING_APPLY_MACRO_VERSION, id: ALPHA3_2E_ROUTING_APPLY_MACRO_ID, ok: false, mode: "blocked", dry_run: true, preview, preflight_requests: [], mutation_requests: [], readback_requests: [], child_requests: [], blockers: frozenBlockers, typed_blockers: frozenBlockers, no_executor_safety_posture: noExecutorSafetyPosture(), safety: noExecutorSafetyPosture() });
}

function emptyPreview() { return buildPreview({ routes: [], master_parent: [], channel_counts: [] }); }

function successCriteriaFor(preview) {
  return deepFreeze([
    `Project routing preflight succeeds before ${preview.target_counts.total_operations} routing operation(s).`,
    "Every emitted internal routing child request returns accepted template evidence.",
    "Affected-track routing readback must match the requested sends, master-parent state, and channel counts before success wording.",
  ]);
}

function agentExecutionFlow(preview) {
  return deepFreeze([
    { step: "run_preflight", request_count: 1, stop_on_error: true },
    { step: "run_mutations", request_count: preview.target_counts.create_sends + preview.target_counts.send_updates + preview.target_counts.master_parent + preview.target_counts.channel_counts, stop_on_error: true },
    { step: "run_readback", request_count: "affected_tracks", stop_on_mismatch: true },
  ]);
}

function noExecutorSafetyPosture() {
  return deepFreeze({ added_tools: 0, server_executes_children: false, hidden_executor: false, public_call_recipe: false, raw_action_lua_shell_ui: false, hardware_device_io: false, external_device_endpoints: false, live_reaper_called: false });
}

function plannedSendRef(row) { return row.send_ref ?? `send:planned:${row.id}`; }
function childRequest(sequence, stage, id, refs, input, purpose) { return deepFreeze({ sequence, stage, tool: "call_template", id, refs: deepFreeze(refs), input: deepFreeze(input), purpose }); }
function blocker(code, message, details = {}) { return deepFreeze({ code, message, details: deepFreeze(details) }); }
function unknownFieldBlockers(object, allowed, code, message, details = {}) { return Object.keys(object ?? {}).filter((field) => !allowed.has(field)).slice(0, UNKNOWN_FIELD_DETAIL_LIMIT).map((field) => blocker(code, message, { ...details, field })); }
function requestPosture(request = {}) { return { idempotency_key_present: request.idempotency_key !== undefined }; }
function summarizeRuntimeRequest(request = {}) { return { id: request.id ?? ALPHA3_2E_ROUTING_APPLY_MACRO_ID, has_input: request.input !== undefined, has_refs: request.refs !== undefined, idempotency_key_present: request.idempotency_key !== undefined }; }
function macroRuntimeError(plan) { return { code: plan.typed_blockers?.[0]?.code ?? "ROUTING_APPLY_BLOCKED", message: plan.typed_blockers?.[0]?.message ?? "macro.routing.apply is blocked." }; }
function safeNowIso(now) { try { return now().toISOString(); } catch { return new Date(0).toISOString(); } }
function normalizeId(value, index, prefix) { if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_ID_BYTES || /[\u0000-\u001f\u007f]/u.test(value)) return { invalid: true, value: `${prefix}_${index}` }; return { invalid: false, value }; }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isTrackRef(value) { return typeof value === "string" && value.startsWith("track:") && !/[\u0000-\u001f\u007f]/u.test(value) && !isDeviceEndpoint(value); }
function isSendRef(value) { return typeof value === "string" && value.startsWith("send:") && !/[\u0000-\u001f\u007f]/u.test(value); }
function isDeviceEndpoint(value) { return typeof value === "string" && /^(hardware|device|audio_device|midi_device):/u.test(value); }
function isNumberInRange(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

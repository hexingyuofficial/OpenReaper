export const ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT = "alpha3.2e.media_place_assets_macro.v1";
export const ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID = "macro.media.place_assets";
export const ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION = "1.0.0";

const ALLOWED_INPUT_FIELDS = new Set(["assets", "dry_run", "compact_response"]);
const ALLOWED_ASSET_FIELDS = new Set(["id", "path", "track_ref", "track_name", "create_track", "track_index", "position_seconds", "start_percent", "end_percent", "preserve_selection", "region", "take_name", "delete_source_media"]);
const ALLOWED_REGION_FIELDS = new Set(["name", "start_seconds", "end_seconds", "color"]);
const MAX_ASSETS = 48;
const MAX_ID_BYTES = 96;
const MAX_PATH_BYTES = 1024;
const MAX_NAME_BYTES = 160;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;

const PROBE_FILE_ID = "template.media.probe_file";
const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const CREATE_TRACK_ID = "template.tracks.create_track";
const IMPORT_FILE_ID = "template.media.import_file_to_track";
const IMPORT_SECTION_ID = "template.media.import_file_section_to_track";
const READ_ITEM_ID = "template.items.read_item_summary";
const READ_TAKE_SOURCE_ID = "template.media.read_take_source";
const CREATE_REGION_ID = "template.project.create_region";
const LIST_MARKERS_REGIONS_ID = "template.project.list_markers_regions";
const QUERY_PROJECT_ID = "macro.project.query";

export function isAlpha3_2EMediaPlaceAssetsMacroId(id) {
  return id === ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID;
}

export function planAlpha3_2EMediaPlaceAssetsMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = [
    ...validateUnusedRequestPosture(requestPosture),
    ...validateInput(input, normalized),
  ];
  const assets = normalizeAssets(normalized.assets);
  blockers.push(...assets.blockers);
  const dryRun = normalized.dry_run !== false;
  const preview = buildPreview(assets.assets);

  if (blockers.length > 0) return blockedPlan(blockers, preview);
  if (assets.assets.length === 0) return blockedPlan([blocker("MEDIA_ASSETS_EMPTY", "macro.media.place_assets requires at least one asset row.")], preview);
  if (dryRun) return dryRunPlan(preview);

  const mutationRequests = buildMutationRequests(assets.assets);
  const readback = readbackRequests(assets.assets);
  const childRequests = [...preflightRequests(assets.assets), ...mutationRequests, ...readback];
  return deepFreeze({
    contract: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT,
    version: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION,
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    ok: true,
    mode: "plan_only_agent_executed_child_requests",
    dry_run: false,
    preview,
    preflight_requests: preflightRequests(assets.assets),
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

export function createAlpha3_2EMediaPlaceAssetsMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3_2EMediaPlaceAssetsMacro(request.input ?? {}, requestPosture(request));
  return deepFreeze({
    contract: "call_template.runtime.v1",
    ok: normalizedPlan.ok,
    template: { id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, pack: "media", risk: "write" },
    request: summarizeRuntimeRequest(request),
    completed_at: safeNowIso(now),
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT,
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
        reason: "macro.media.place_assets only returns an agent-executed child-request plan; the server never imports media itself.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_action_lua_shell_ui: false,
        bridge_request_created: false,
        live_reaper_called: false,
        source_media_deleted: false,
      },
    },
  });
}

export function createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems() {
  return deepFreeze([{
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    title: "Place media assets",
    summary: "Plan bounded probe, track resolve/create, import, optional region, and readback requests for media placement.",
    pack: "media",
    risk: "write",
    lifecycle: "accepted",
    entity_kind: "macro.media.place_assets",
    tags: ["alpha3.2", "macro", "media", "import", "plan_only"],
    action_kind: "macro",
    execution_shape: "plan_only_agent_executed_child_requests",
    implementation_status: "plan_only_runtime_bound_preview_first",
    runnable: true,
    support_status: "plan_only_runtime_bound_preview_first",
    support_state: "supported_with_readback",
    evidence_level: "runtime_bound_static_fake",
    known_blocker: "Dry-run preview and media/item/source readback required before success wording",
    input_schema: {
      type: "object",
      properties: {
        assets: { type: "array", maxItems: MAX_ASSETS },
        dry_run: { type: "boolean" },
        compact_response: { type: "boolean" },
      },
      required: ["assets"],
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
      name: "place_two_assets",
      input: {
        assets: [
          { id: "kick", path: "/Users/Shared/OpenReaper/kick.wav", track_name: "Drums", create_track: true, position_seconds: 0 },
          { id: "loop", path: "/Users/Shared/OpenReaper/loop.wav", track_ref: "track:guid:{DRUMS}", position_seconds: 8, start_percent: 0.25, end_percent: 0.75 },
        ],
        dry_run: true,
      },
    }],
  }]);
}

function validateInput(rawInput, input) {
  const blockers = [];
  if (!isPlainObject(rawInput)) blockers.push(blocker("MEDIA_INPUT_NOT_OBJECT", "macro.media.place_assets input must be an object."));
  blockers.push(...unknownFieldBlockers(input, ALLOWED_INPUT_FIELDS, "MEDIA_INPUT_UNKNOWN_FIELD", "Unsupported macro.media.place_assets input field."));
  if (!Array.isArray(input.assets)) blockers.push(blocker("MEDIA_ASSETS_REQUIRED", "assets must be an array."));
  else if (input.assets.length > MAX_ASSETS) blockers.push(blocker("MEDIA_ASSETS_TOO_MANY", `assets is limited to ${MAX_ASSETS} rows.`, { count: input.assets.length, limit: MAX_ASSETS }));
  return blockers;
}

function validateUnusedRequestPosture(posture = {}) {
  return posture.idempotency_key_present ? [blocker("MEDIA_PLACE_ASSETS_IDEMPOTENCY_KEY_UNSUPPORTED", "macro.media.place_assets does not currently accept idempotency keys; child requests carry per-template evidence.")] : [];
}

function normalizeAssets(value) {
  if (!Array.isArray(value)) return { assets: deepFreeze([]), blockers: [] };
  const blockers = [];
  const ids = new Set();
  const assets = [];
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) {
      blockers.push(blocker("MEDIA_ASSET_ROW_INVALID", "Each media asset row must be an object.", { index }));
      continue;
    }
    blockers.push(...unknownFieldBlockers(row, ALLOWED_ASSET_FIELDS, "MEDIA_ASSET_UNKNOWN_FIELD", "Unsupported media asset row field.", { index }));
    const id = row.id;
    if (typeof id !== "string" || id.length === 0 || Buffer.byteLength(id) > MAX_ID_BYTES || /[\u0000-\u001f\u007f]/u.test(id)) blockers.push(blocker("MEDIA_ASSET_ID_INVALID", "Each media asset requires a bounded string id without control characters.", { index }));
    else if (ids.has(id)) blockers.push(blocker("MEDIA_ASSET_ID_DUPLICATE", "Media asset ids must be unique.", { id }));
    else ids.add(id);

    const path = row.path;
    if (!isSafeAbsoluteFilePath(path)) blockers.push(blocker("MEDIA_SOURCE_PATH_UNSAFE", "path must be a bounded absolute local file path and must not be a URL, device, or control path.", { id, path }));
    if (row.delete_source_media === true) blockers.push(blocker("MEDIA_SOURCE_DELETE_FORBIDDEN", "macro.media.place_assets never deletes or mutates source media files.", { id }));
    if (row.track_ref !== undefined && !isTrackRef(row.track_ref)) blockers.push(blocker("MEDIA_TRACK_REF_INVALID", "track_ref must be a canonical track ref when supplied.", { id }));
    if (row.track_name !== undefined && !isSafeName(row.track_name)) blockers.push(blocker("MEDIA_TRACK_NAME_INVALID", "track_name must be a bounded non-empty string without control characters.", { id }));
    if (row.track_ref && row.track_name) blockers.push(blocker("MEDIA_TRACK_SELECTOR_AMBIGUOUS", "Use either track_ref or track_name/create_track, not both.", { id }));
    if (!row.track_ref && !row.track_name) blockers.push(blocker("MEDIA_TRACK_TARGET_REQUIRED", "Each asset needs either track_ref or track_name/create_track.", { id }));
    if (row.track_name && row.create_track !== true) blockers.push(blocker("MEDIA_TRACK_CREATE_REQUIRED", "track_name targets require create_track:true so no name selector is used as write authorization.", { id }));
    if (row.track_index !== undefined && (!Number.isInteger(row.track_index) || row.track_index < 0)) blockers.push(blocker("MEDIA_TRACK_INDEX_INVALID", "track_index must be a non-negative integer when supplied.", { id }));
    if (!isNonNegativeNumber(row.position_seconds)) blockers.push(blocker("MEDIA_POSITION_INVALID", "position_seconds must be a non-negative number.", { id }));
    const hasStart = row.start_percent !== undefined;
    const hasEnd = row.end_percent !== undefined;
    if (hasStart !== hasEnd) blockers.push(blocker("MEDIA_SECTION_RANGE_INCOMPLETE", "start_percent and end_percent must be supplied together.", { id }));
    if (hasStart && (!isPercent(row.start_percent) || !isPercent(row.end_percent) || row.start_percent >= row.end_percent)) blockers.push(blocker("MEDIA_SECTION_RANGE_INVALID", "Section range must satisfy 0 <= start_percent < end_percent <= 1.", { id }));
    if (row.preserve_selection !== undefined && typeof row.preserve_selection !== "boolean") blockers.push(blocker("MEDIA_PRESERVE_SELECTION_INVALID", "preserve_selection must be boolean when supplied.", { id }));
    if (row.take_name !== undefined) blockers.push(blocker("MEDIA_TAKE_RENAME_NOT_BOUND", "Take renaming is not emitted by this macro until an accepted take-rename template id is bound.", { id }));
    const region = normalizeRegion(row.region, id, blockers);
    assets.push({
      id: typeof id === "string" ? id : `row_${index}`,
      path,
      track_ref: row.track_ref ?? null,
      track_name: row.track_name ?? null,
      create_track: row.create_track === true,
      track_index: row.track_index ?? null,
      position_seconds: row.position_seconds,
      start_percent: hasStart ? row.start_percent : null,
      end_percent: hasEnd ? row.end_percent : null,
      preserve_selection: row.preserve_selection ?? true,
      region,
    });
  }
  return { assets: deepFreeze(assets), blockers };
}

function normalizeRegion(value, id, blockers) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    blockers.push(blocker("MEDIA_REGION_INVALID", "region must be an object when supplied.", { id }));
    return null;
  }
  blockers.push(...unknownFieldBlockers(value, ALLOWED_REGION_FIELDS, "MEDIA_REGION_UNKNOWN_FIELD", "Unsupported region field.", { id }));
  if (!isSafeName(value.name)) blockers.push(blocker("MEDIA_REGION_NAME_INVALID", "region.name must be a bounded non-empty string without control characters.", { id }));
  if (!isNonNegativeNumber(value.start_seconds) || !isNonNegativeNumber(value.end_seconds) || value.start_seconds >= value.end_seconds) blockers.push(blocker("MEDIA_REGION_BOUNDS_INVALID", "region requires 0 <= start_seconds < end_seconds.", { id }));
  if (value.color !== undefined && (typeof value.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value.color))) blockers.push(blocker("MEDIA_REGION_COLOR_INVALID", "region.color must be #RRGGBB when supplied.", { id }));
  return { name: value.name, start_seconds: value.start_seconds, end_seconds: value.end_seconds, color: value.color ?? null };
}

function buildPreview(assets) {
  return deepFreeze({
    contract: "alpha3.2e.media_place_assets.preview.v1",
    target_counts: {
      assets: assets.length,
      probes: assets.length,
      create_tracks: assets.filter((asset) => asset.create_track).length,
      resolve_tracks: assets.filter((asset) => asset.track_ref).length,
      imports: assets.length,
      section_imports: assets.filter((asset) => asset.start_percent !== null).length,
      regions: assets.filter((asset) => asset.region).length,
    },
    rows: assets.map((asset) => ({ id: asset.id, path: asset.path, track_ref: plannedTrackRef(asset), track_name: asset.track_name, position_seconds: asset.position_seconds, section: asset.start_percent === null ? null : { start_percent: asset.start_percent, end_percent: asset.end_percent }, region: asset.region })),
    local_ref_map: Object.fromEntries(assets.map((asset) => [asset.id, { file_ref: plannedFileRef(asset), track_ref: plannedTrackRef(asset), item_ref: plannedItemRef(asset), take_ref: plannedTakeRef(asset) }])),
  });
}

function preflightRequests(assets) {
  const requests = [];
  let sequence = 1;
  for (const asset of assets) requests.push(childRequest(sequence++, "preflight", PROBE_FILE_ID, {}, { path: asset.path, include_metadata_keys: false }, `Probe media source before importing asset ${asset.id}.`));
  for (const asset of assets.filter((row) => row.track_ref)) requests.push(childRequest(sequence++, "preflight", RESOLVE_TRACK_ID, {}, { track_ref: asset.track_ref }, `Resolve target track before importing asset ${asset.id}.`));
  return deepFreeze(requests);
}

function buildMutationRequests(assets) {
  const requests = [];
  let sequence = 1;
  for (const asset of assets) {
    if (asset.create_track) requests.push(childRequest(sequence++, "mutation", CREATE_TRACK_ID, {}, compactObject({ name: asset.track_name, index: asset.track_index }), `Create target track for media asset ${asset.id}.`));
    const importId = asset.start_percent === null ? IMPORT_FILE_ID : IMPORT_SECTION_ID;
    const input = asset.start_percent === null
      ? { position_seconds: asset.position_seconds, preserve_selection: asset.preserve_selection }
      : { position_seconds: asset.position_seconds, start_percent: asset.start_percent, end_percent: asset.end_percent, preserve_selection: asset.preserve_selection };
    requests.push(childRequest(sequence++, "mutation", importId, { track_ref: plannedTrackRef(asset), file_ref: plannedFileRef(asset) }, input, `Import media asset ${asset.id} to its planned target track.`));
    if (asset.region) requests.push(childRequest(sequence++, "mutation", CREATE_REGION_ID, {}, compactObject({ name: asset.region.name, start_seconds: asset.region.start_seconds, end_seconds: asset.region.end_seconds, color: asset.region.color }), `Create optional project region for media asset ${asset.id}.`));
  }
  return deepFreeze(requests);
}

function readbackRequests(assets) {
  const requests = [];
  let sequence = 1;
  for (const asset of assets) {
    requests.push(childRequest(sequence++, "readback", READ_ITEM_ID, { item_ref: plannedItemRef(asset) }, { include_take_summary: true }, `Read imported item summary for asset ${asset.id}.`));
    requests.push(childRequest(sequence++, "readback", READ_TAKE_SOURCE_ID, { take_ref: plannedTakeRef(asset) }, { include_metadata_keys: false, include_parent_source: false }, `Read imported take source for asset ${asset.id}.`));
  }
  if (assets.some((asset) => asset.region)) requests.push(childRequest(sequence++, "readback", LIST_MARKERS_REGIONS_ID, {}, { include_markers: false, include_regions: true, limit: MAX_ASSETS }, "Read regions after optional region creation."));
  requests.push(childRequest(sequence++, "readback", QUERY_PROJECT_ID, {}, { entity: "media_sources", limit: Math.min(MAX_ASSETS, assets.length * 2), refresh: "if_stale" }, "Refresh/query project media-source index after placement."));
  return deepFreeze(requests);
}

function dryRunPlan(preview) {
  return deepFreeze({
    contract: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT,
    version: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION,
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    ok: true,
    mode: "dry_run_preview",
    dry_run: true,
    preview,
    preflight_requests: [],
    mutation_requests: [],
    readback_requests: [],
    child_requests: [],
    blockers: [],
    typed_blockers: [],
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function blockedPlan(blockers, preview = emptyPreview()) {
  const frozenBlockers = deepFreeze(blockers.map((entry) => ({ ...entry })));
  return deepFreeze({
    contract: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT,
    version: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION,
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    ok: false,
    mode: "blocked",
    dry_run: true,
    preview,
    preflight_requests: [],
    mutation_requests: [],
    readback_requests: [],
    child_requests: [],
    blockers: frozenBlockers,
    typed_blockers: frozenBlockers,
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function emptyPreview() {
  return buildPreview([]);
}

function successCriteriaFor(preview) {
  return deepFreeze([
    `All ${preview.target_counts.probes} media probe request(s) succeed before import.`,
    `All ${preview.target_counts.imports} import request(s) return item/take refs.`,
    "Readback item/source and media index requests must match the planned assets before success wording.",
  ]);
}

function agentExecutionFlow(preview) {
  return deepFreeze([
    { step: "run_preflight", request_count: preview.target_counts.probes + preview.target_counts.resolve_tracks, stop_on_error: true },
    { step: "run_mutations", request_count: preview.target_counts.imports + preview.target_counts.create_tracks + preview.target_counts.regions, stop_on_error: true },
    { step: "run_readback", request_count: preview.target_counts.assets * 2 + 1 + (preview.target_counts.regions > 0 ? 1 : 0), stop_on_mismatch: true },
  ]);
}

function noExecutorSafetyPosture() {
  return deepFreeze({
    added_tools: 0,
    server_executes_children: false,
    hidden_executor: false,
    public_call_recipe: false,
    raw_action_lua_shell_ui: false,
    hardware_device_io: false,
    source_media_deleted: false,
    source_media_mutated: false,
    live_reaper_called: false,
  });
}

function plannedFileRef(asset) { return `file:planned:${asset.id}`; }
function plannedTrackRef(asset) { return asset.track_ref ?? `track:planned:${asset.id}`; }
function plannedItemRef(asset) { return `item:planned:${asset.id}`; }
function plannedTakeRef(asset) { return `take:planned:${asset.id}`; }

function childRequest(sequence, stage, id, refs, input, purpose) {
  return deepFreeze({ sequence, stage, tool: "call_template", id, refs: deepFreeze(refs), input: deepFreeze(input), purpose });
}

function blocker(code, message, details = {}) {
  return deepFreeze({ code, message, details: deepFreeze(details) });
}

function unknownFieldBlockers(object, allowed, code, message, details = {}) {
  return Object.keys(object ?? {})
    .filter((field) => !allowed.has(field))
    .slice(0, UNKNOWN_FIELD_DETAIL_LIMIT)
    .map((field) => blocker(code, message, { ...details, field }));
}

function requestPosture(request = {}) { return { idempotency_key_present: request.idempotency_key !== undefined }; }
function summarizeRuntimeRequest(request = {}) { return { id: request.id ?? ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, has_input: request.input !== undefined, has_refs: request.refs !== undefined, idempotency_key_present: request.idempotency_key !== undefined }; }
function macroRuntimeError(plan) { return { code: plan.typed_blockers?.[0]?.code ?? "MEDIA_PLACE_ASSETS_BLOCKED", message: plan.typed_blockers?.[0]?.message ?? "macro.media.place_assets is blocked." }; }
function safeNowIso(now) { try { return now().toISOString(); } catch { return new Date(0).toISOString(); } }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isTrackRef(value) { return typeof value === "string" && value.startsWith("track:") && !/[\u0000-\u001f\u007f]/u.test(value); }
function isSafeName(value) { return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= MAX_NAME_BYTES && !/[\u0000-\u001f\u007f]/u.test(value); }
function isNonNegativeNumber(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isPercent(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function isSafeAbsoluteFilePath(value) {
  return typeof value === "string"
    && value.startsWith("/")
    && Buffer.byteLength(value) <= MAX_PATH_BYTES
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !/^\/(dev|Volumes\/Hardware|System\/Volumes\/Data\/dev)(\/|$)/u.test(value)
    && !/^[a-z][a-z0-9+.-]*:/iu.test(value);
}
function compactObject(object) { return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

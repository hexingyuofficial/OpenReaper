import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT = "alpha3.3.media_place_assets_macro.v1";
export const ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID = "macro.media.place_assets";
export const ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION = "2.0.0";
export const ALPHA3_3_MEDIA_PLACE_ASSETS_MODES = deepFreeze([
  "place_assets",
  "relink_sources",
]);
export const ALPHA3_3_MEDIA_PLACEMENT_MODES = deepFreeze([
  "explicit",
  "sequence_on_one_track",
  "stack_on_separate_tracks",
  "columns",
  "append_after_existing",
]);
export const ALPHA3_3_MEDIA_TRACK_POLICIES = deepFreeze([
  "existing_track",
  "one_shared_new_track",
  "one_new_track_per_asset",
  "explicit_per_asset",
]);
export const ALPHA3_3_MEDIA_PLACE_ASSETS_TEMPLATE_IDS = deepFreeze([
  "template.media.probe_file",
  "template.media.read_take_source",
  "template.media.import_file_to_track",
  "template.media.import_file_section_to_track",
  "template.media.relink_take_source",
  "template.tracks.resolve_track_ref",
  "template.tracks.create_track",
  "template.items.list_items_on_track",
  "template.items.read_item_summary",
  "template.project.list_markers_regions",
  "template.project.create_region",
]);

const PROBE_FILE_ID = "template.media.probe_file";
const READ_TAKE_SOURCE_ID = "template.media.read_take_source";
const IMPORT_FILE_ID = "template.media.import_file_to_track";
const IMPORT_SECTION_ID = "template.media.import_file_section_to_track";
const RELINK_TAKE_ID = "template.media.relink_take_source";
const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const CREATE_TRACK_ID = "template.tracks.create_track";
const LIST_TRACK_ITEMS_ID = "template.items.list_items_on_track";
const READ_ITEM_ID = "template.items.read_item_summary";
const LIST_REGIONS_ID = "template.project.list_markers_regions";
const CREATE_REGION_ID = "template.project.create_region";
const MAX_ASSETS = 8;
const MAX_TRACK_ITEMS = 128;
const MAX_PATH_BYTES = 1_024;
const MAX_NAME_BYTES = 160;
const MAX_ID_BYTES = 96;
const MIN_RESPONSE_BUDGET = 2_048;
const EPSILON = 1e-7;
const INDEX_SCOPES = deepFreeze(["tracks", "items", "takes", "markers", "media"]);
const INTERNAL_BUDGET = deepFreeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: MAX_TRACK_ITEMS,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});

const REGISTRY_ENTRY = deepFreeze({
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
  program_id: "openreaper.macro.media.place_assets",
  program_version: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION,
  implementation_status: "executable",
  risk: "write",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ALPHA3_3_MEDIA_PLACE_ASSETS_MODES },
      assets: { type: "array", minItems: 1, maxItems: MAX_ASSETS },
      placement: { type: "object" },
      track_policy: { type: "string", enum: ALPHA3_3_MEDIA_TRACK_POLICIES },
      track_ref: { type: "string" },
      new_track: { type: "object" },
      columns: { type: "integer", minimum: 1, maximum: MAX_ASSETS },
      gap_seconds: { type: "number", minimum: 0 },
      column_gap_seconds: { type: "number", minimum: 0 },
      dry_run: { type: "boolean", default: true },
      compact_response: { type: "boolean", default: true },
    },
    required: ["assets"],
  },
  selector_policy: {
    task_shaped: true,
    canonical_refs_optional_at_public_boundary: true,
    live_reresolve_before_write: true,
  },
  sqlite_policy: {
    mode: "invalidate_after_write",
    write_authority: false,
    identity_fields: ["track_ref", "take_ref", "item_ref", "source_file_ref"],
  },
  dependencies: { template_ids: ALPHA3_3_MEDIA_PLACE_ASSETS_TEMPLATE_IDS, runtime_capabilities: [] },
  stages: [
    { id: "media-place-assets-probe", kind: "selector_resolve", risk: "read", stop_on_error: true },
    { id: "media-place-assets-preflight", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "media-place-assets-layout", kind: "selector_resolve", risk: "read", stop_on_error: true },
    { id: "media-place-assets-mutate", kind: "template_execute", risk: "write", stop_on_error: true, dependency_ref: IMPORT_FILE_ID },
    { id: "media-place-assets-readback", kind: "verify", risk: "read", stop_on_error: true },
    { id: "media-place-assets-index", kind: "index_update", risk: "read", stop_on_error: true },
    { id: "media-place-assets-result", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "per_stage_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
});

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRY.stages.map((stage) => stage.id));

export function createAlpha3_3MediaPlaceAssetsRegistry(options = {}) {
  return createMacroProgramRegistry([REGISTRY_ENTRY], {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ALPHA3_3_MEDIA_PLACE_ASSETS_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_3_MEDIA_PLACE_ASSETS_REGISTRY = createAlpha3_3MediaPlaceAssetsRegistry();

export async function executeAlpha3_2EMediaPlaceAssetsMacro(options = {}) {
  return executeAlpha3_3MediaPlaceAssetsMacro(options);
}

export function isAlpha3_2EMediaPlaceAssetsMacroId(id) {
  return id === ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID;
}

export function createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems({ liveRunnableNow = false } = {}) {
  return deepFreeze([{
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    title: "Place or relink media assets",
    user_label: "Place media assets",
    summary: "Probe all bounded sources, compute deterministic explicit/sequence/stack/columns/append placement, import or exact-relink, and prove every applied row through independent live readback.",
    pack: "media",
    risk: "write",
    lifecycle: "experimental",
    entity_kind: "macro.media.place_assets",
    tags: ["alpha3.3", "macro", "media", "import", "place", "sequence", "columns", "append", "relink"],
    task_intents: ["import audio", "place assets", "sequence media", "stack media", "append media", "relink source"],
    action_kind: "macro",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    runnable: true,
    support_status: "executable_runtime_bound",
    support_state: "supported_with_exact_live_readback",
    live_runnable_now: liveRunnableNow,
    evidence_level: liveRunnableNow ? "runtime_bound_live_route_available" : "runtime_bound_executable",
    known_blocker: liveRunnableNow ? null : "macro_fixed_dependencies_not_available",
    input_schema: clone(REGISTRY_ENTRY.input_schema),
    output_schema: {
      type: "object",
      required: ["contract", "ok", "macro", "execution", "result"],
      properties: { contract: { const: MACRO_EXECUTION_CONTRACT }, ok: { type: "boolean" }, macro: { type: "object" }, execution: { type: "object" }, result: { type: "object" } },
    },
    supported_modes: ALPHA3_3_MEDIA_PLACE_ASSETS_MODES,
    supported_placement_modes: ALPHA3_3_MEDIA_PLACEMENT_MODES,
    supported_track_policies: ALPHA3_3_MEDIA_TRACK_POLICIES,
    limits: { assets: MAX_ASSETS, append_track_items: MAX_TRACK_ITEMS },
    examples: [
      { name: "sequence_on_one_track", input: { assets: [{ id: "kick", path: "/Users/Shared/OpenReaper/kick.wav" }, { id: "snare", path: "/Users/Shared/OpenReaper/snare.wav" }], placement: { mode: "sequence_on_one_track", start_seconds: 0, gap_seconds: 0.25 }, track_policy: "existing_track", track_ref: "track:guid:{DRUMS}", dry_run: true } },
      { name: "stack_new_tracks", input: { assets: [{ id: "a", path: "/Users/Shared/OpenReaper/a.wav" }, { id: "b", path: "/Users/Shared/OpenReaper/b.wav" }], placement: { mode: "stack_on_separate_tracks", start_seconds: 0 }, track_policy: "one_new_track_per_asset", new_track: { name_prefix: "Layer" }, dry_run: true } },
      { name: "relink_exact_take", input: { mode: "relink_sources", assets: [{ id: "replacement", path: "/Users/Shared/OpenReaper/replacement.wav", take_ref: "take:guid:{TAKE}" }], dry_run: true } },
    ],
  }]);
}

export function createAlpha3_3MediaPlaceAssetsExactManual() {
  return deepFreeze({
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    rollout_slice: "Alpha3.3 media placement expansion",
    action_manual: {
      when_to_use: [
        "Use place_assets to import up to eight explicit files through explicit, sequence_on_one_track, stack_on_separate_tracks, columns, or append_after_existing placement.",
        "Use relink_sources to change the source of up to eight exact take:guid refs after probing each explicit replacement path.",
      ],
      when_not_to_use: [
        "Do not scan arbitrary folders, delete/move/overwrite source files, silently substitute another asset, or address hardware/device media paths.",
        "Do not use detected_onset alignment in this slice; placement aligns item starts only.",
      ],
      required_readiness: [
        "All source paths are probed and all existing Track/Take/region/append facts are read before the first mutation.",
        "append_after_existing requires one complete non-truncated <=128-item live page for every target track.",
        "Region placement requires a non-truncated inventory whose declared region_count exactly matches the returned Region rows.",
        "folder_ref selection remains held because the current folder:path handler does not prove an approved-folder identity boundary.",
      ],
      input_shape: {
        mode: "place_assets (default) | relink_sources",
        assets: "1-8 unique rows. Placement rows require id/path and policy-specific track fields; relink rows require id/path/exact take_ref.",
        placement: "{mode: explicit | sequence_on_one_track | stack_on_separate_tracks | columns | append_after_existing, start_seconds?, gap_seconds?, column_gap_seconds?, columns?, align_basis:'item_start'}; top-level gap/columns aliases remain accepted.",
        track_policy: "existing_track | one_shared_new_track | one_new_track_per_asset | explicit_per_asset",
        new_track: "For new-track policies: bounded name (shared) or name_prefix plus optional starting_index.",
        dry_run: "Defaults true and still runs complete probe/preflight/layout without mutation.",
      },
      underlying_actions: ALPHA3_3_MEDIA_PLACE_ASSETS_TEMPLATE_IDS,
      readback_steps: [
        "Every created Track and Region is independently resolved by its exact returned ref and must match its requested name and bounds before applied.",
        "Every imported Item is independently read and must match exact source, Track, position, and probed/section duration before that asset is applied.",
        "Every relinked exact Take is independently read and must report the exact probed replacement file_ref before applied.",
        "Per-asset mutation, live readback, and Project Index maintenance remain separate; dispatch success alone never marks applied.",
      ],
      success_criteria: [
        "Every applied asset has a row-specific canonical Item/Take ref and exact native-backed live state.",
        "No mutation starts until every asset probe and every policy preflight succeeds.",
      ],
      common_blockers: [
        blocker("MEDIA_COMPLETE_PREFLIGHT_REQUIRED", "All probes, existing targets, append pages, and regions must be complete before mutation."),
        blocker("MEDIA_APPEND_COVERAGE_INCOMPLETE", "append_after_existing requires a complete <=128-item live Track page."),
        blocker("MEDIA_REGION_COVERAGE_INCOMPLETE", "Region placement requires a complete live Region inventory whose count matches its returned rows."),
        blocker("MEDIA_REGION_COLOR_READBACK_UNSUPPORTED", "Portable #RRGGBB Region color readback is unavailable, so colored Region requests fail before mutation."),
        blocker("MEDIA_RESPONSE_BUDGET_EXCEEDED", "The projected truthful result does not fit the caller's public response budget, so mutation does not start."),
        blocker("MEDIA_FOLDER_APPROVAL_UNPROVEN", "Current folder:path listing does not prove approved-folder identity, so folder_ref selection is held."),
        blocker("MEDIA_LIVE_READBACK_MISMATCH", "Independent Item/Take source readback does not match the planned asset."),
      ],
      recovery_steps: [
        "Use exact Track/Take GUID refs, reduce the batch or append Track item count, and retry the same fixed request once.",
        "If mutation is partial, keep rows proved by live readback and inspect unverified assets before retrying; never replay imports blindly.",
      ],
      dry_run_shape: { supported: true, behavior: "Runs complete native probes/preflight/layout and returns per-asset planned positions/targets without mutation or index invalidation." },
    },
  });
}

export function planAlpha3_2EMediaPlaceAssetsMacro(input = {}, requestPosture = {}) {
  const normalized = normalizeInput(input, requestPosture);
  if (!normalized.ok) return legacyBlockedPlan(normalized.blockers);
  const rows = normalized.input.assets.map((asset) => ({
    id: asset.id,
    path: asset.path,
    track_ref: asset.track_ref ?? null,
    position_seconds: asset.position_seconds ?? null,
    take_ref: asset.take_ref ?? null,
  }));
  return deepFreeze({
    contract: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT,
    version: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION,
    id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
    ok: true,
    mode: normalized.input.dry_run ? "dry_run_preview" : "registered_program_required",
    dry_run: normalized.input.dry_run,
    preview: { contract: "alpha3.3.media_place_assets.preview.v1", placement_mode: normalized.input.placement.mode, track_policy: normalized.input.track_policy, target_counts: { assets: rows.length }, rows },
    preflight_requests: [], mutation_requests: [], readback_requests: [], child_requests: [], blockers: [], typed_blockers: [],
    safety: safetyPosture(), no_executor_safety_posture: safetyPosture(),
  });
}

export function createAlpha3_2EMediaPlaceAssetsMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3_2EMediaPlaceAssetsMacro(request.input ?? {}, { idempotency_key_present: request.idempotency_key !== undefined });
  const blocked = normalizedPlan.ok !== true;
  return deepFreeze({
    contract: "call_template.runtime.v1",
    ok: !blocked,
    template: { id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, pack: "media", risk: "write" },
    request: { id: request.id ?? ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, has_input: request.input !== undefined },
    completed_at: safeNowIso(now),
    error: blocked ? { code: normalizedPlan.blockers[0]?.code ?? "MEDIA_PLACE_ASSETS_BLOCKED", message: normalizedPlan.blockers[0]?.message ?? "Media placement is blocked." } : null,
    result: { contract: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT, action_kind: "macro", executed: false, plan: normalizedPlan, preview: normalizedPlan.preview, execution: { executed: false, executor_call_count: 0, reason: "Use the registered executable Macro runtime.", source_media_deleted: false } },
  });
}

export async function executeAlpha3_3MediaPlaceAssetsMacro({ request = {}, executeAtomic, projectIndexRuntime, now = () => new Date() } = {}) {
  const entry = ALPHA3_3_MEDIA_PLACE_ASSETS_REGISTRY.get(ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID);
  const startedAt = safeNowIso(now);
  const stages = [];
  const state = createState();
  const activeBudget = responseBudget(request);
  const normalized = normalizeInput(request.input, { idempotency_key_present: request.idempotency_key !== undefined });
  if (!normalized.ok) return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: normalized.code, message: normalized.message, blockers: normalized.blockers });
  const input = normalized.input;
  if (request.id !== ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID) return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "MEDIA_MACRO_ID_UNSUPPORTED", message: `Unsupported media Macro id: ${String(request.id)}.` });
  const validation = validateMacroProgramRequest({ macro_id: request.id, input, refs: request.refs ?? {}, dry_run: input.dry_run }, { registry: ALPHA3_3_MEDIA_PLACE_ASSETS_REGISTRY });
  if (!validation.valid) return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "MEDIA_REQUEST_INVALID", message: validation.errors.join("; "), blockers: validation.errors.map((message) => blocker("MEDIA_REQUEST_INVALID", message)) });
  if (typeof executeAtomic !== "function") return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "MEDIA_LIVE_EXECUTOR_REQUIRED", message: "macro.media.place_assets requires the managed OpenReaper live executor." });

  try {
    state.operations = await prepareOperations({ request, input, executeAtomic, state });
    pushStage(stages, "media-place-assets-probe", "selector_resolve", "completed", `Probed ${state.operations.length} exact source file(s).`, state.evidenceRefs);
    pushStage(stages, "media-place-assets-preflight", "live_ref_resolve", "completed", "Resolved all existing targets and captured complete append/region facts before mutation.", state.evidenceRefs);
    pushStage(stages, "media-place-assets-layout", "runtime_execute", "completed", "Computed the complete deterministic placement map before mutation.");

    const budgetFailure = responseBudgetBlocker({ entry, request, input, stages, state, activeBudget });
    if (budgetFailure) {
      return failureEnvelope({ entry, request, startedAt, now, stages: [], state: createState(), activeBudget, code: budgetFailure.code, message: budgetFailure.message, blockers: [budgetFailure], data: { required_bytes: budgetFailure.required_bytes, available_bytes: activeBudget } });
    }

    if (input.dry_run) {
      state.changes = state.operations.map(previewChange);
      pushStage(stages, "media-place-assets-mutate", "template_execute", "skipped", "Media mutation skipped during dry_run.");
      pushStage(stages, "media-place-assets-readback", "verify", "skipped", "Post-write live readback was not required during dry_run.");
      pushStage(stages, "media-place-assets-index", "index_update", "skipped", "No Project Index scope changed during dry_run.");
      pushStage(stages, "media-place-assets-result", "result_project", "completed", "Validated the complete bounded media plan without mutation.");
      return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "dry_run_completed", summary: `Validated ${state.operations.length} media asset operation(s) without mutation.`, data: resultData(input, state) });
    }

    await createPlannedTracks({ request, input, executeAtomic, state });
    for (const operation of state.operations) {
      const change = pendingChange(operation);
      state.changes.push(change);
      const target = targetForOperation(operation, state);
      const mutation = input.mode === "relink_sources"
        ? await child({ request, executeAtomic, state, id: RELINK_TAKE_ID, input: { verify_source_type: operation.verify_source_type }, refs: { take_ref: operation.take_object, source_file_ref: operation.file_object }, mutation: true })
        : await child({ request, executeAtomic, state, id: operation.import_template_id, input: operation.import_input, refs: { track_ref: target.track_object, source_file_ref: operation.file_object }, mutation: true });
      change.mutation = mutationOutcome(mutation);
      if (!mutation.ok || !mutation.verificationPassed) {
        change.live_readback = { status: "not_run", blocker_code: mutation.code };
        throw coded(mutation.code, mutation.message, mutation.blockers);
      }
      const mutationFacts = readback(mutation.execution);
      if (input.mode === "place_assets") {
        const itemRefs = stringArray(mutationFacts.imported_item_refs).filter(isItemRef);
        if (itemRefs.length !== 1) throw coded("MEDIA_IMPORTED_ITEM_IDENTITY_REQUIRED", `${operation.id} import did not return exactly one canonical Item ref.`);
        operation.item_ref = itemRefs[0];
        operation.item_object = executionObjectRefs(mutation.execution).find((ref) => ref.kind === "item" && ref.ref === operation.item_ref) ?? exactGuidObjectRef("item", operation.item_ref);
        if (!operation.item_object) throw coded("MEDIA_IMPORTED_ITEM_OBJECT_REQUIRED", `${operation.id} import did not return a reusable Item object ref.`);
        const itemRead = await child({ request, executeAtomic, state, id: READ_ITEM_ID, input: { include_take_summary: true }, refs: { item_ref: operation.item_object } });
        ensureChangeReadOk(itemRead, READ_ITEM_ID, change);
        const item = readback(itemRead.execution);
        const takeRef = item.active_take_ref;
        if (!isTakeRef(takeRef)) throw coded("MEDIA_IMPORTED_TAKE_REF_REQUIRED", `${operation.id} Item readback did not expose one active Take ref.`);
        const takeObject = executionObjectRefs(itemRead.execution).find((ref) => ref.kind === "take" && ref.ref === takeRef) ?? exactGuidObjectRef("take", takeRef);
        const sourceRead = await child({ request, executeAtomic, state, id: READ_TAKE_SOURCE_ID, input: { include_metadata_keys: false, include_parent_source: false }, refs: { take_ref: takeObject } });
        ensureChangeReadOk(sourceRead, READ_TAKE_SOURCE_ID, change);
        const source = readback(sourceRead.execution);
        const passed = item.item_ref === operation.item_ref && item.track_ref === target.track_ref && close(item.position_seconds, operation.position_seconds) && close(item.length_seconds, operation.import_length_seconds) && source.take_ref === takeRef && source.file_ref === operation.file_ref;
        change.live_readback = { status: passed ? "passed" : "failed", source: "independent_item_and_take_source_readback", item_ref: item.item_ref ?? null, take_ref: takeRef, track_ref: item.track_ref ?? null, position_seconds: item.position_seconds ?? null, length_seconds: item.length_seconds ?? null, source_file_ref: source.file_ref ?? null };
        state.canonicalRefs.push(operation.item_ref, takeRef);
        if (!passed) throw coded("MEDIA_LIVE_READBACK_MISMATCH", `${operation.id} independent Item/source readback did not match the planned import.`);
        change.status = "applied";
        if (operation.region) await createAndVerifyRegion({ request, operation, executeAtomic, state });
      } else {
        const sourceRead = await child({ request, executeAtomic, state, id: READ_TAKE_SOURCE_ID, input: { include_metadata_keys: false, include_parent_source: false }, refs: { take_ref: operation.take_object } });
        ensureChangeReadOk(sourceRead, READ_TAKE_SOURCE_ID, change);
        const source = readback(sourceRead.execution);
        const passed = source.take_ref === operation.take_ref && source.file_ref === operation.file_ref;
        change.live_readback = { status: passed ? "passed" : "failed", source: "independent_take_source_readback", take_ref: source.take_ref ?? null, source_file_ref: source.file_ref ?? null };
        if (!passed) throw coded("MEDIA_LIVE_READBACK_MISMATCH", `${operation.id} independent Take source readback did not match the exact replacement.`);
        change.status = "applied";
      }
    }
    pushStage(stages, "media-place-assets-mutate", "template_execute", "completed", `Dispatched ${state.changes.length} bounded mutation row(s), including explicit Track/Region setup rows.`, state.evidenceRefs);
    pushStage(stages, "media-place-assets-readback", "verify", "completed", "Every applied media asset passed independent native-backed live readback.", state.evidenceRefs);
    const indexResult = maintainIndex(projectIndexRuntime, state, now);
    applyIndex(state.changes, indexResult);
    pushStage(stages, "media-place-assets-index", "index_update", indexResult.status, indexResult.message);
    if (!indexResult.ok) throw coded(indexResult.code, indexResult.message, indexResult.blockers);
    pushStage(stages, "media-place-assets-result", "result_project", "completed", "Applied and verified the bounded media asset batch.");
    return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, summary: `Applied and verified ${state.operations.length} media asset operation(s) and ${setupChanges(state).length} setup mutation(s).`, data: resultData(input, state) });
  } catch (error) {
    appendNotRunChanges(state);
    const mutated = state.changes.some((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status));
    if (mutated && state.changes.some((change) => change.index_maintenance?.status === "pending")) {
      const indexResult = maintainIndex(projectIndexRuntime, state, now);
      applyIndex(state.changes, indexResult);
      if (!stages.some((stage) => stage.id === "media-place-assets-index")) pushStage(stages, "media-place-assets-index", "index_update", indexResult.status, indexResult.message);
    }
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: mutated ? "partial_failure" : "blocked", code: error.code ?? "MEDIA_EXECUTION_FAILED", message: error.message ?? "The registered media placement program failed.", blockers: error.blockers, data: resultData(input, state) });
  }
}

async function prepareOperations({ request, input, executeAtomic, state }) {
  const operations = [];
  for (const asset of input.assets) {
    const probe = await child({ request, executeAtomic, state, id: PROBE_FILE_ID, input: { path: asset.path, include_metadata_keys: false }, refs: {} });
    ensureReadOk(probe, PROBE_FILE_ID);
    const facts = readback(probe.execution);
    if (facts.decodable !== true || !isFileRef(facts.file_ref) || !finitePositive(facts.length_seconds) || facts.length_is_quarter_notes === true) throw coded("MEDIA_SOURCE_PROBE_INVALID", `${asset.id} is not a decodable finite-duration media source.`);
    const fileObject = executionObjectRefs(probe.execution).find((ref) => ref.kind === "file" && ref.ref === facts.file_ref) ?? fileObjectFromPath(facts.file_ref, asset.path);
    if (!fileObject) throw coded("MEDIA_SOURCE_FILE_REF_REQUIRED", `${asset.id} probe did not return a reusable exact file ref.`);
    operations.push({ ...asset, file_ref: facts.file_ref, file_object: fileObject, source_length_seconds: facts.length_seconds, import_length_seconds: asset.start_percent === null ? facts.length_seconds : facts.length_seconds * (asset.end_percent - asset.start_percent) });
  }

  if (input.mode === "relink_sources") {
    for (const operation of operations) {
      const read = await child({ request, executeAtomic, state, id: READ_TAKE_SOURCE_ID, input: { include_metadata_keys: false, include_parent_source: false }, refs: { take_ref: exactGuidObjectRef("take", operation.take_ref) } });
      ensureReadOk(read, READ_TAKE_SOURCE_ID);
      const facts = readback(read.execution);
      if (facts.take_ref !== operation.take_ref) throw coded("MEDIA_TAKE_IDENTITY_MISMATCH", `${operation.id} did not live-resolve to the exact requested Take.`);
      operation.take_object = executionObjectRefs(read.execution).find((ref) => ref.kind === "take" && ref.ref === operation.take_ref) ?? exactGuidObjectRef("take", operation.take_ref);
      operation.before_source_file_ref = facts.file_ref ?? null;
      state.canonicalRefs.push(operation.take_ref, operation.file_ref);
    }
    return operations;
  }

  const existingTrackRefs = uniqueStrings([
    input.track_ref,
    ...operations.map((operation) => operation.track_ref),
  ]);
  state.trackObjects = new Map();
  for (const trackRef of existingTrackRefs) {
    if (!trackRef) continue;
    const resolved = await child({ request, executeAtomic, state, id: RESOLVE_TRACK_ID, input: { track_ref: trackRef }, refs: {} });
    ensureReadOk(resolved, RESOLVE_TRACK_ID);
    const facts = readback(resolved.execution);
    if (facts.track_ref !== trackRef) throw coded("MEDIA_TRACK_IDENTITY_MISMATCH", `Track resolver did not return exact ${trackRef}.`);
    const object = executionObjectRefs(resolved.execution).find((ref) => ref.kind === "track" && ref.ref === trackRef) ?? exactGuidObjectRef("track", trackRef);
    state.trackObjects.set(trackRef, object);
    state.canonicalRefs.push(trackRef);
  }

  const appendEnds = new Map();
  if (input.placement.mode === "append_after_existing") {
    const refs = targetTrackRefsForAppend(input, operations);
    for (const trackRef of refs) {
      const trackObject = state.trackObjects.get(trackRef);
      if (!trackObject) throw coded("MEDIA_APPEND_TRACK_REQUIRED", `append_after_existing requires an existing exact Track ref; ${trackRef} is unavailable.`);
      const listed = await child({ request, executeAtomic, state, id: LIST_TRACK_ITEMS_ID, input: { limit: MAX_TRACK_ITEMS, include_take_summary: false }, refs: { track_ref: trackObject } });
      ensureReadOk(listed, LIST_TRACK_ITEMS_ID);
      const facts = readback(listed.execution);
      const items = Array.isArray(facts.items) ? facts.items : [];
      if (facts.track_ref !== trackRef || facts.truncated === true || facts.item_count !== items.length || facts.item_count > MAX_TRACK_ITEMS) throw coded("MEDIA_APPEND_COVERAGE_INCOMPLETE", `${trackRef} Item page is not complete within ${MAX_TRACK_ITEMS} rows.`);
      appendEnds.set(trackRef, items.reduce((max, item) => Math.max(max, finiteNonNegative(item.position_seconds) && finiteNonNegative(item.length_seconds) ? item.position_seconds + item.length_seconds : max), 0));
    }
  }

  if (operations.some((operation) => operation.region)) {
    const regions = await child({ request, executeAtomic, state, id: LIST_REGIONS_ID, input: { include_markers: false, include_regions: true, limit: 250 }, refs: {} });
    ensureReadOk(regions, LIST_REGIONS_ID);
    const facts = readback(regions.execution);
    const rows = Array.isArray(facts.items) ? facts.items.filter((row) => row.kind === "region") : [];
    const complete = facts.truncated === false && Number.isInteger(facts.region_count) && facts.region_count === rows.length;
    if (!complete) throw coded("MEDIA_REGION_COVERAGE_INCOMPLETE", "Existing Region inventory is incomplete; region_count must exactly match the returned non-truncated Region rows before mutation.");
    state.beforeRegions = rows;
  }

  assignTrackPlans(input, operations);
  assignPositions(input, operations, appendEnds);
  for (const operation of operations) {
    operation.import_template_id = operation.start_percent === null ? IMPORT_FILE_ID : IMPORT_SECTION_ID;
    operation.import_input = operation.start_percent === null
      ? { position_seconds: operation.position_seconds, preserve_selection: operation.preserve_selection }
      : { position_seconds: operation.position_seconds, start_percent: operation.start_percent, end_percent: operation.end_percent, preserve_selection: operation.preserve_selection };
  }
  return operations;
}

function assignTrackPlans(input, operations) {
  if (input.track_policy === "existing_track") for (const operation of operations) operation.target_track_ref = input.track_ref;
  else if (input.track_policy === "explicit_per_asset") for (const operation of operations) operation.target_track_ref = operation.track_ref;
  else if (input.track_policy === "one_shared_new_track") for (const operation of operations) operation.target_track_key = "shared";
  else for (const [index, operation] of operations.entries()) operation.target_track_key = `asset:${index}`;
}

function assignPositions(input, operations, appendEnds) {
  const { mode, start_seconds: start, gap_seconds: gap, column_gap_seconds: columnGap, columns } = input.placement;
  if (mode === "explicit") return;
  if (mode === "sequence_on_one_track") {
    let cursor = start;
    for (const operation of operations) { operation.position_seconds = cursor; cursor += operation.import_length_seconds + gap; }
    return;
  }
  if (mode === "stack_on_separate_tracks") { for (const operation of operations) operation.position_seconds = start; return; }
  if (mode === "columns") {
    const widths = [];
    for (let index = 0; index < operations.length; index += 1) {
      const column = index % columns;
      widths[column] = Math.max(widths[column] ?? 0, operations[index].import_length_seconds);
    }
    const starts = [];
    for (let column = 0; column < columns; column += 1) starts[column] = column === 0 ? start : starts[column - 1] + widths[column - 1] + columnGap;
    for (let index = 0; index < operations.length; index += 1) operations[index].position_seconds = starts[index % columns];
    return;
  }
  const cursors = new Map(appendEnds);
  for (const operation of operations) {
    const trackRef = operation.target_track_ref;
    const cursor = cursors.get(trackRef) ?? start;
    operation.position_seconds = Math.max(start, cursor) + gap;
    cursors.set(trackRef, operation.position_seconds + operation.import_length_seconds);
  }
}

async function createPlannedTracks({ request, input, executeAtomic, state }) {
  state.createdTracks = new Map();
  if (!new Set(["one_shared_new_track", "one_new_track_per_asset"]).has(input.track_policy)) return;
  const keys = input.track_policy === "one_shared_new_track" ? ["shared"] : state.operations.map((operation) => operation.target_track_key);
  for (const [index, key] of keys.entries()) {
    const name = input.track_policy === "one_shared_new_track" ? input.new_track.name : `${input.new_track.name_prefix} ${input.new_track.starting_index + index}`;
    const change = setupChange({ id: `track:${key}`, kind: "track", templateId: CREATE_TRACK_ID, targetRef: key, requested: { name } });
    state.changes.push(change);
    const created = await child({ request, executeAtomic, state, id: CREATE_TRACK_ID, input: { name }, refs: {}, mutation: true });
    change.mutation = mutationOutcome(created);
    if (!created.ok || !created.verificationPassed) {
      change.live_readback = { status: "not_run", blocker_code: created.code };
      throw coded(created.code, created.message, created.blockers);
    }
    const facts = readback(created.execution);
    const trackRef = facts.track_ref ?? canonicalRefs(created.execution).find(isTrackRef);
    const trackObject = executionObjectRefs(created.execution).find((ref) => ref.kind === "track" && ref.ref === trackRef) ?? exactGuidObjectRef("track", trackRef);
    change.target_ref = trackRef ?? key;
    if (!isExactTrackRef(trackRef) || !trackObject) {
      change.live_readback = { status: "failed", blocker_code: "MEDIA_CREATED_TRACK_REF_REQUIRED", source: "create_track_result", track_ref: trackRef ?? null, name: facts.name ?? null };
      throw coded("MEDIA_CREATED_TRACK_REF_REQUIRED", `Created Track ${name} did not return an exact reusable track:guid ref.`);
    }

    const resolved = await child({ request, executeAtomic, state, id: RESOLVE_TRACK_ID, input: { track_ref: trackRef }, refs: {} });
    ensureChangeReadOk(resolved, RESOLVE_TRACK_ID, change);
    const resolvedFacts = readback(resolved.execution);
    const passed = resolvedFacts.track_ref === trackRef && resolvedFacts.name === name;
    change.live_readback = { status: passed ? "passed" : "failed", source: "exact_track_resolver", track_ref: resolvedFacts.track_ref ?? null, name: resolvedFacts.name ?? null };
    if (!passed) throw coded("MEDIA_CREATED_TRACK_READBACK_MISMATCH", `Created Track ${name} did not independently resolve with its exact ref and name.`);
    change.status = "applied";
    state.createdTracks.set(key, { track_ref: trackRef, track_object: trackObject });
    state.canonicalRefs.push(trackRef);
  }
}

function targetForOperation(operation, state) {
  if (operation.target_track_ref) return { track_ref: operation.target_track_ref, track_object: state.trackObjects.get(operation.target_track_ref) };
  return state.createdTracks.get(operation.target_track_key);
}

async function createAndVerifyRegion({ request, operation, executeAtomic, state }) {
  const region = operation.region;
  const start = region.start_seconds ?? operation.position_seconds;
  const end = region.end_seconds ?? operation.position_seconds + operation.import_length_seconds;
  const change = setupChange({ id: `region:${operation.id}`, kind: "region", templateId: CREATE_REGION_ID, targetRef: null, assetId: operation.id, requested: compact({ name: region.name, start_seconds: start, end_seconds: end, color: region.color }) });
  state.changes.push(change);
  const created = await child({ request, executeAtomic, state, id: CREATE_REGION_ID, input: compact({ name: region.name, start_seconds: start, end_seconds: end, color: region.color }), refs: {}, mutation: true });
  change.mutation = mutationOutcome(created);
  if (!created.ok || !created.verificationPassed) {
    change.live_readback = { status: "not_run", blocker_code: created.code };
    throw coded(created.code, created.message, created.blockers);
  }
  const createdFacts = readback(created.execution);
  const regionRef = createdFacts.region_ref ?? canonicalRefs(created.execution).find(isRegionRef);
  change.target_ref = regionRef ?? null;
  if (!isRegionRef(regionRef)) {
    change.live_readback = { status: "failed", blocker_code: "MEDIA_CREATED_REGION_REF_REQUIRED", source: "create_region_result", region_ref: regionRef ?? null };
    throw coded("MEDIA_CREATED_REGION_REF_REQUIRED", `${operation.id} region creation did not return one exact region:index ref.`);
  }

  const listed = await child({ request, executeAtomic, state, id: LIST_REGIONS_ID, input: { include_markers: false, include_regions: true, limit: 250 }, refs: {} });
  ensureChangeReadOk(listed, LIST_REGIONS_ID, change);
  const facts = readback(listed.execution);
  const rows = Array.isArray(facts.items) ? facts.items.filter((row) => row.kind === "region") : [];
  const observed = rows.find((row) => row.region_ref === regionRef);
  const complete = facts.truncated === false && Number.isInteger(facts.region_count) && facts.region_count === rows.length;
  const passed = complete && observed?.kind === "region" && observed.name === region.name && close(observed.position_seconds, start) && close(observed.end_seconds, end);
  change.live_readback = { status: passed ? "passed" : "failed", source: "exact_region_inventory", region_ref: observed?.region_ref ?? null, name: observed?.name ?? null, start_seconds: observed?.position_seconds ?? null, end_seconds: observed?.end_seconds ?? null };
  state.canonicalRefs.push(regionRef);
  if (!passed) throw coded("MEDIA_REGION_READBACK_MISMATCH", `${operation.id} region did not independently read back by its exact returned ref, name, and bounds.`);
  change.status = "applied";
}

async function child({ request, executeAtomic, state, id, input, refs, mutation = false }) {
  let execution;
  try {
    execution = await executeAtomic({ id, input, refs, context: request.context, budget: INTERNAL_BUDGET, observeProjectIndex: false });
  } catch (error) {
    return { ok: false, execution: null, verificationPassed: false, code: mutation ? "MEDIA_MUTATION_DISPATCH_THROWN" : "MEDIA_READ_DISPATCH_THROWN", message: error?.message ?? `${id} threw.`, blockers: [blocker(mutation ? "MEDIA_MUTATION_DISPATCH_THROWN" : "MEDIA_READ_DISPATCH_THROWN", error?.message ?? `${id} threw.`)] };
  }
  collectEvidence(state, execution);
  const verification = execution?.verification ?? execution?.result?.verification;
  return { ok: execution?.ok === true, execution, verificationPassed: verification?.status === "passed", code: execution?.error?.code ?? (mutation ? "MEDIA_MUTATION_FAILED" : "MEDIA_READ_FAILED"), message: execution?.error?.message ?? `${id} failed.`, blockers: execution?.error?.details?.blockers };
}

function ensureReadOk(result, id) { if (!result.ok) throw coded(result.code, result.message ?? `${id} failed.`, result.blockers); }
function ensureChangeReadOk(result, id, change) {
  if (result.ok) return;
  change.live_readback = { status: "failed", blocker_code: result.code, source: id };
  throw coded(result.code, result.message ?? `${id} failed.`, result.blockers);
}

function normalizeInput(raw, posture = {}) {
  if (!isObject(raw)) return failed("MEDIA_INPUT_NOT_OBJECT", "macro.media.place_assets input must be an object.");
  if (posture.idempotency_key_present) return failed("MEDIA_IDEMPOTENCY_UNSUPPORTED", "Bounded import/relink batches have no accepted Macro replay ledger; omit idempotency_key.");
  const allowed = ["mode", "assets", "placement", "placement_policy", "track_policy", "target_policy", "track_ref", "new_track", "columns", "gap_seconds", "column_gap_seconds", "dry_run", "compact_response", "folder_ref", "folder_selection"];
  const unknown = Object.keys(raw).filter((field) => !allowed.includes(field));
  if (unknown.length) return failed("MEDIA_INPUT_UNKNOWN_FIELD", `Unsupported media input field(s): ${unknown.slice(0, 8).join(", ")}.`);
  if (raw.folder_ref !== undefined || raw.folder_selection !== undefined) return failed("MEDIA_FOLDER_APPROVAL_UNPROVEN", "Current folder:path listing does not prove an approved-folder identity boundary; supply up to eight explicit asset paths.");
  const mode = raw.mode ?? "place_assets";
  if (!ALPHA3_3_MEDIA_PLACE_ASSETS_MODES.includes(mode)) return failed("MEDIA_MODE_UNSUPPORTED", `mode must be ${ALPHA3_3_MEDIA_PLACE_ASSETS_MODES.join(" or ")}.`);
  if (!Array.isArray(raw.assets) || raw.assets.length < 1 || raw.assets.length > MAX_ASSETS) return failed("MEDIA_ASSETS_INVALID", `assets must contain 1-${MAX_ASSETS} rows.`);
  if (raw.dry_run !== undefined && typeof raw.dry_run !== "boolean") return failed("MEDIA_INPUT_INVALID", "dry_run must be boolean.");
  if (raw.compact_response !== undefined && typeof raw.compact_response !== "boolean") return failed("MEDIA_INPUT_INVALID", "compact_response must be boolean.");
  const placement = normalizePlacement(raw);
  if (!placement.ok) return placement;
  const trackPolicy = normalizeTrackPolicy(raw, mode, placement.value.mode);
  if (!trackPolicy.ok) return trackPolicy;
  const assets = [];
  const ids = new Set();
  for (const [index, row] of raw.assets.entries()) {
    const asset = normalizeAsset(row, index, mode, placement.value.mode, trackPolicy.value);
    if (!asset.ok) return asset;
    if (ids.has(asset.value.id)) return failed("MEDIA_ASSET_ID_DUPLICATE", `Asset id ${asset.value.id} is duplicated.`);
    ids.add(asset.value.id);
    assets.push(asset.value);
  }
  const newTrack = normalizeNewTrack(raw.new_track, trackPolicy.value);
  if (!newTrack.ok) return newTrack;
  if (trackPolicy.value === "existing_track" && !isExactTrackRef(raw.track_ref)) return failed("MEDIA_EXACT_TRACK_REF_REQUIRED", "track_policy=existing_track requires top-level exact track:guid ref.");
  if (placement.value.mode === "append_after_existing" && new Set(["one_shared_new_track", "one_new_track_per_asset"]).has(trackPolicy.value)) return failed("MEDIA_APPEND_EXISTING_TRACK_REQUIRED", "append_after_existing requires existing_track or explicit_per_asset targets.");
  if (placement.value.mode === "sequence_on_one_track" && new Set(["one_new_track_per_asset", "explicit_per_asset"]).has(trackPolicy.value)) return failed("MEDIA_SEQUENCE_SINGLE_TRACK_REQUIRED", "sequence_on_one_track requires existing_track or one_shared_new_track.");
  if (placement.value.mode === "stack_on_separate_tracks" && new Set(["existing_track", "one_shared_new_track"]).has(trackPolicy.value)) return failed("MEDIA_STACK_SEPARATE_TRACKS_REQUIRED", "stack_on_separate_tracks requires explicit_per_asset or one_new_track_per_asset.");
  return { ok: true, input: { mode, assets, placement: placement.value, track_policy: trackPolicy.value, track_ref: raw.track_ref ?? null, new_track: newTrack.value, dry_run: raw.dry_run !== false, compact_response: raw.compact_response !== false } };
}

function normalizePlacement(raw) {
  const source = isObject(raw.placement) ? raw.placement : isObject(raw.placement_policy) ? raw.placement_policy : {};
  const allowed = ["mode", "start_seconds", "gap_seconds", "column_gap_seconds", "columns", "align_basis"];
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) return failed("MEDIA_PLACEMENT_INVALID", `Unsupported placement field(s): ${unknown.join(", ")}.`);
  const aliases = { sequential: "sequence_on_one_track", append_on_track: "append_after_existing" };
  const mode = aliases[source.mode] ?? source.mode ?? "explicit";
  if (!ALPHA3_3_MEDIA_PLACEMENT_MODES.includes(mode)) return failed("MEDIA_PLACEMENT_MODE_UNSUPPORTED", `placement.mode must be ${ALPHA3_3_MEDIA_PLACEMENT_MODES.join(", ")}.`);
  if (source.align_basis !== undefined && source.align_basis !== "item_start") return failed("MEDIA_ONSET_ALIGNMENT_HELD", "Only align_basis=item_start is executable; detected_onset remains held.");
  const start = source.start_seconds ?? 0;
  const gap = source.gap_seconds ?? raw.gap_seconds ?? 0;
  const columnGap = source.column_gap_seconds ?? raw.column_gap_seconds ?? gap;
  const columns = source.columns ?? raw.columns ?? 2;
  if (!finiteNonNegative(start) || !finiteNonNegative(gap) || !finiteNonNegative(columnGap) || !integerRange(columns, 1, MAX_ASSETS)) return failed("MEDIA_PLACEMENT_INVALID", "Placement start/gaps must be finite >=0 and columns must be 1-8.");
  return { ok: true, value: { mode, start_seconds: start, gap_seconds: gap, column_gap_seconds: columnGap, columns, align_basis: "item_start" } };
}

function normalizeTrackPolicy(raw, mode, placementMode) {
  if (mode === "relink_sources") return { ok: true, value: "explicit_per_asset" };
  const aliases = { require_existing: placementMode === "sequence_on_one_track" ? "existing_track" : "explicit_per_asset", allow_explicit_create: "explicit_per_asset" };
  const policy = aliases[raw.target_policy] ?? raw.track_policy ?? inferTrackPolicy(raw.assets);
  return ALPHA3_3_MEDIA_TRACK_POLICIES.includes(policy) ? { ok: true, value: policy } : failed("MEDIA_TRACK_POLICY_INVALID", `track_policy must be ${ALPHA3_3_MEDIA_TRACK_POLICIES.join(", ")}.`);
}

function inferTrackPolicy(assets) {
  if (assets.every((asset) => isObject(asset) && isExactTrackRef(asset.track_ref ?? asset.target_ref))) return "explicit_per_asset";
  if (assets.length > 0 && assets.every((asset) => isObject(asset) && asset.create_track === true)) return "one_new_track_per_asset";
  return null;
}

function normalizeAsset(row, index, mode, placementMode, trackPolicy) {
  if (!isObject(row)) return failed("MEDIA_ASSET_ROW_INVALID", `assets[${index}] must be an object.`);
  const allowed = ["id", "path", "take_ref", "track_ref", "target_ref", "track_name", "create_track", "track_index", "position_seconds", "start_percent", "end_percent", "preserve_selection", "region", "verify_source_type", "delete_source_media", "take_name"];
  const unknown = Object.keys(row).filter((field) => !allowed.includes(field));
  if (unknown.length) return failed("MEDIA_ASSET_UNKNOWN_FIELD", `assets[${index}] has unsupported field(s): ${unknown.join(", ")}.`);
  const id = row.id ?? `asset-${index + 1}`;
  if (typeof id !== "string" || !id.length || Buffer.byteLength(id) > MAX_ID_BYTES || hasControls(id)) return failed("MEDIA_ASSET_ID_INVALID", `assets[${index}].id must be a bounded non-control string.`);
  if (!isSafeAbsoluteFilePath(row.path)) return failed("MEDIA_SOURCE_PATH_UNSAFE", `assets[${index}].path must be a bounded absolute non-device local path.`);
  if (row.delete_source_media === true) return failed("MEDIA_SOURCE_DELETE_FORBIDDEN", "macro.media.place_assets never deletes source media files.");
  if (row.take_name !== undefined) return failed("MEDIA_TAKE_RENAME_NOT_BOUND", "Take renaming is not part of this media placement slice.");
  if (mode === "relink_sources") {
    if (!isExactTakeRef(row.take_ref)) return failed("MEDIA_EXACT_TAKE_REF_REQUIRED", `assets[${index}].take_ref must be exact take:guid for relink_sources.`);
    return { ok: true, value: { id, path: row.path, take_ref: row.take_ref, verify_source_type: row.verify_source_type !== false, start_percent: null, end_percent: null, position_seconds: null, preserve_selection: true, region: null } };
  }
  const trackRef = row.track_ref ?? row.target_ref ?? null;
  if (trackPolicy === "explicit_per_asset" && !isExactTrackRef(trackRef)) return failed("MEDIA_EXACT_TRACK_REF_REQUIRED", `assets[${index}] requires exact track:guid under explicit_per_asset.`);
  const position = row.position_seconds;
  if (placementMode === "explicit" && !finiteNonNegative(position)) return failed("MEDIA_POSITION_INVALID", `assets[${index}].position_seconds must be finite >=0 for explicit placement.`);
  if (placementMode !== "explicit" && position !== undefined) return failed("MEDIA_POSITION_POLICY_CONFLICT", `assets[${index}].position_seconds is valid only with placement.mode=explicit.`);
  const hasStart = row.start_percent !== undefined;
  const hasEnd = row.end_percent !== undefined;
  if (hasStart !== hasEnd || hasStart && (!isPercent(row.start_percent) || !isPercent(row.end_percent) || row.start_percent >= row.end_percent)) return failed("MEDIA_SECTION_RANGE_INVALID", `assets[${index}] section must satisfy 0<=start_percent<end_percent<=1.`);
  if (row.preserve_selection !== undefined && typeof row.preserve_selection !== "boolean") return failed("MEDIA_PRESERVE_SELECTION_INVALID", `assets[${index}].preserve_selection must be boolean.`);
  const region = normalizeRegion(row.region, index);
  if (!region.ok) return region;
  return { ok: true, value: { id, path: row.path, track_ref: trackRef, position_seconds: position ?? null, start_percent: hasStart ? row.start_percent : null, end_percent: hasEnd ? row.end_percent : null, preserve_selection: row.preserve_selection ?? true, region: region.value } };
}

function normalizeRegion(value, index) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isObject(value)) return failed("MEDIA_REGION_INVALID", `assets[${index}].region must be an object.`);
  const unknown = Object.keys(value).filter((field) => !["name", "start_seconds", "end_seconds", "color"].includes(field));
  if (unknown.length || !isSafeName(value.name) || value.color !== undefined && !/^#[0-9A-Fa-f]{6}$/u.test(value.color)) return failed("MEDIA_REGION_INVALID", `assets[${index}].region requires a bounded name and optional #RRGGBB color.`);
  if (value.color !== undefined) return failed("MEDIA_REGION_COLOR_READBACK_UNSUPPORTED", `assets[${index}].region.color cannot yet be independently read back as portable #RRGGBB; omit color so the Region can be verified exactly.`);
  if ((value.start_seconds === undefined) !== (value.end_seconds === undefined) || value.start_seconds !== undefined && (!finiteNonNegative(value.start_seconds) || !finitePositive(value.end_seconds) || value.start_seconds >= value.end_seconds)) return failed("MEDIA_REGION_INVALID", `assets[${index}].region explicit bounds must satisfy 0<=start<end.`);
  return { ok: true, value: { name: value.name, start_seconds: value.start_seconds ?? null, end_seconds: value.end_seconds ?? null, color: value.color ?? null } };
}

function normalizeNewTrack(value, policy) {
  if (!new Set(["one_shared_new_track", "one_new_track_per_asset"]).has(policy)) return value === undefined ? { ok: true, value: null } : failed("MEDIA_NEW_TRACK_POLICY_CONFLICT", "new_track is valid only with a new-track policy.");
  const row = isObject(value) ? value : {};
  if (policy === "one_shared_new_track") {
    if (!isSafeName(row.name)) return failed("MEDIA_NEW_TRACK_INVALID", "one_shared_new_track requires new_track.name.");
    return { ok: true, value: { name: row.name } };
  }
  const prefix = row.name_prefix ?? "Asset";
  const starting = row.starting_index ?? 1;
  if (!isSafeName(prefix) || !integerRange(starting, 1, 999)) return failed("MEDIA_NEW_TRACK_INVALID", "one_new_track_per_asset requires bounded name_prefix and starting_index 1..999.");
  return { ok: true, value: { name_prefix: prefix, starting_index: starting } };
}

function targetTrackRefsForAppend(input, operations) { return input.track_policy === "existing_track" ? [input.track_ref] : uniqueStrings(operations.map((operation) => operation.track_ref)); }

function maintainIndex(runtime, state, now) {
  const mutated = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status));
  if (!mutated.length) return { ok: true, status: "skipped", message: "No completed media mutation required index maintenance.", scopes: [] };
  const scopes = state.operations.some((operation) => operation.region) ? INDEX_SCOPES : INDEX_SCOPES.filter((scope) => scope !== "markers");
  if (typeof runtime?.invalidateScopes !== "function") return { ok: true, status: "skipped", message: "No Project Index runtime was attached; exact live readback remains authority.", scopes };
  try {
    const result = runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
    state.sqlite = sqliteEvidence(runtime, true);
    if (result?.ok === false) { const first = result.blockers?.[0] ?? blocker("MEDIA_INDEX_MAINTENANCE_FAILED", "Media index invalidation failed."); return { ok: false, status: "failed", code: first.code, message: first.message, blockers: [first], scopes }; }
    return { ok: true, status: "completed", message: `Invalidated affected ${scopes.join("/")} index scopes.`, scopes };
  } catch (error) {
    state.sqlite = sqliteEvidence(runtime, true);
    return { ok: false, status: "failed", code: "MEDIA_INDEX_MAINTENANCE_FAILED", message: error?.message ?? "Media index invalidation failed.", blockers: [blocker("MEDIA_INDEX_MAINTENANCE_FAILED", error?.message ?? "Media index invalidation failed.")], scopes };
  }
}

function applyIndex(changes, result) { for (const change of changes) if (["completed", "unknown_or_partial"].includes(change.mutation?.status)) change.index_maintenance = { status: result.status, scopes: result.scopes, ...(result.code ? { blocker_code: result.code } : {}) }; }
function mutationOutcome(result) { return result.ok && result.verificationPassed ? { status: "completed", dispatch_status: "completed", verification_status: "passed" } : { status: "unknown_or_partial", dispatch_status: result.ok ? "completed" : "failed", verification_status: result.verificationPassed ? "passed" : "not_passed", blocker_code: result.code }; }
function setupChange({ id, kind, templateId, targetRef, assetId, requested }) { return { change_id: `setup:${id}`, ...(assetId ? { related_asset_id: assetId } : {}), mode: "setup", setup_kind: kind, template_id: templateId, target_ref: targetRef, requested, status: "pending", mutation: { status: "pending" }, live_readback: { status: "pending" }, index_maintenance: { status: "pending", scopes: [] } }; }
function pendingChange(operation) { return { asset_id: operation.id, mode: operation.take_ref ? "relink_sources" : "place_assets", template_id: operation.take_ref ? RELINK_TAKE_ID : operation.import_template_id, source_file_ref: operation.file_ref, target_ref: operation.take_ref ?? operation.target_track_ref ?? operation.target_track_key, planned_position_seconds: operation.position_seconds, status: "pending", mutation: { status: "pending" }, live_readback: { status: "pending" }, index_maintenance: { status: "pending", scopes: [] } }; }
function previewChange(operation) { return { ...pendingChange(operation), status: "planned", mutation: { status: "not_run" }, live_readback: { status: "not_run", source_file_ref: operation.file_ref, planned_duration_seconds: operation.import_length_seconds ?? null }, index_maintenance: { status: "skipped", scopes: [] } }; }
function appendNotRunChanges(state) { const seen = new Set(state.changes.map((change) => change.asset_id)); for (const operation of state.operations) if (!seen.has(operation.id)) state.changes.push({ ...pendingChange(operation), status: "not_run", mutation: { status: "not_run" }, live_readback: { status: "not_run" }, index_maintenance: { status: "skipped", scopes: [] } }); }
function setupChanges(state) { return state.changes.filter((change) => change.mode === "setup"); }

function responseBudgetBlocker({ entry, request, input, stages, state, activeBudget }) {
  const projectedState = {
    ...state,
    changes: [
      ...projectedTrackSetupChanges(input, state.operations),
      ...state.operations.flatMap((operation) => [
        projectedAppliedChange(operation),
        ...(operation.region ? [projectedRegionSetupChange(operation)] : []),
      ]),
    ],
  };
  const projectedStages = [
    ...stages,
    { id: "media-place-assets-mutate", kind: "template_execute", status: input.dry_run ? "skipped" : "completed", summary: "Projected bounded mutation rows.", evidence_refs: [] },
    { id: "media-place-assets-readback", kind: "verify", status: input.dry_run ? "skipped" : "completed", summary: "Projected independent live readback rows.", evidence_refs: [] },
    { id: "media-place-assets-index", kind: "index_update", status: input.dry_run ? "skipped" : "completed", summary: "Projected affected-scope invalidation.", evidence_refs: [] },
    { id: "media-place-assets-result", kind: "result_project", status: "completed", summary: "Projected bounded media result.", evidence_refs: [] },
  ];
  const envelope = buildSuccessEnvelope({
    entry,
    request,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    stages: projectedStages,
    state: projectedState,
    activeBudget: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
    status: input.dry_run ? "dry_run_completed" : "completed",
    summary: `Projected ${state.operations.length} media asset operation(s).`,
    data: resultData(input, projectedState),
  });
  const required = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (required <= activeBudget) return null;
  return {
    code: "MEDIA_RESPONSE_BUDGET_EXCEEDED",
    message: `The compact ${state.operations.length}-asset result needs about ${required} bytes but only ${activeBudget} response bytes are available; split the asset batch or raise the public response budget before mutation.`,
    recoverable: true,
    required_bytes: required,
  };
}

function projectedTrackSetupChanges(input, operations) {
  if (!new Set(["one_shared_new_track", "one_new_track_per_asset"]).has(input.track_policy)) return [];
  const keys = input.track_policy === "one_shared_new_track" ? ["shared"] : operations.map((operation) => operation.target_track_key);
  return keys.map((key, index) => {
    const name = input.track_policy === "one_shared_new_track" ? input.new_track.name : `${input.new_track.name_prefix} ${input.new_track.starting_index + index}`;
    return projectedAppliedSetupChange(setupChange({ id: `track:${key}`, kind: "track", templateId: CREATE_TRACK_ID, targetRef: `track:guid:{PROJECTED-${index + 1}}`, requested: { name } }));
  });
}

function projectedRegionSetupChange(operation) {
  const start = operation.region.start_seconds ?? operation.position_seconds;
  const end = operation.region.end_seconds ?? operation.position_seconds + operation.import_length_seconds;
  return projectedAppliedSetupChange(setupChange({ id: `region:${operation.id}`, kind: "region", templateId: CREATE_REGION_ID, targetRef: "region:index:999", assetId: operation.id, requested: { name: operation.region.name, start_seconds: start, end_seconds: end } }));
}

function projectedAppliedSetupChange(change) {
  return { ...change, status: "applied", mutation: { status: "completed", dispatch_status: "completed", verification_status: "passed" }, live_readback: { status: "passed", source: `projected_exact_${change.setup_kind}_readback` }, index_maintenance: { status: "completed", scopes: change.setup_kind === "region" ? INDEX_SCOPES : INDEX_SCOPES.filter((scope) => scope !== "markers") } };
}

function projectedAppliedChange(operation) {
  return { ...pendingChange(operation), status: "applied", mutation: { status: "completed", dispatch_status: "completed", verification_status: "passed" }, live_readback: { status: "passed", source: operation.take_ref ? "independent_take_source_readback" : "independent_item_and_take_source_readback", source_file_ref: operation.file_ref }, index_maintenance: { status: "completed", scopes: operation.region ? INDEX_SCOPES : INDEX_SCOPES.filter((scope) => scope !== "markers") } };
}

function resultData(input, state) {
  const mutated = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status));
  const applied = state.changes.filter((change) => change.status === "applied" && change.live_readback?.status === "passed");
  const indexStatuses = uniqueStrings(mutated.map((change) => change.index_maintenance?.status));
  return { mode: input.mode, placement_mode: input.placement.mode, track_policy: input.track_policy, asset_count: input.assets.length, setup_mutation_count: setupChanges(state).length, selected_sources: state.operations.map((operation) => ({ id: operation.id, source_file_ref: operation.file_ref, path: operation.path })), layout: state.operations.map((operation) => ({ id: operation.id, position_seconds: operation.position_seconds, target_ref: operation.take_ref ?? operation.target_track_ref ?? operation.target_track_key, duration_seconds: operation.import_length_seconds ?? null })), source_media_deleted: false, arbitrary_folder_scan: false, sqlite_write_authority: false, outcome: { mutation: { status: mutated.some((change) => change.mutation.status === "unknown_or_partial") ? "unknown_or_partial" : mutated.length ? "completed" : "not_run", completed_count: mutated.filter((change) => change.mutation.status === "completed").length, unknown_or_partial_count: mutated.filter((change) => change.mutation.status === "unknown_or_partial").length, total_count: state.changes.length }, live_readback: { status: applied.length === mutated.length && mutated.length ? "passed" : applied.length ? "partial" : "not_run", passed_count: applied.length, total_count: mutated.length }, index_maintenance: { status: indexStatuses.length === 1 ? indexStatuses[0] : indexStatuses.length > 1 ? "mixed" : "not_run", scopes: uniqueStrings(mutated.flatMap((change) => change.index_maintenance?.scopes ?? [])) } } };
}

function createState() { return { operations: [], changes: [], canonicalRefs: [], evidenceRefs: [], trackObjects: new Map(), createdTracks: new Map(), beforeRegions: [], sqlite: sqliteEvidence() }; }

function successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status = "completed", summary, data }) { return finalizeEnvelope(buildSuccessEnvelope({ entry, request, startedAt, completedAt: safeNowIso(now), stages, state, activeBudget, status, summary, data })); }
function buildSuccessEnvelope({ entry, request, startedAt, completedAt, stages, state, activeBudget, status, summary, data }) { return { contract: MACRO_EXECUTION_CONTRACT, ok: true, macro: macroIdentity(entry), request: requestSummary(request), execution: { status, started_at: startedAt, completed_at: completedAt, stage_count: stages.length, stages }, sqlite: state.sqlite, result: { summary, canonical_refs: uniqueStrings(state.canonicalRefs), changes: clone(state.changes), verification: { status: "passed", evidence_refs: uniqueStrings(state.evidenceRefs) }, data }, blockers: [], error: null, recovery: null, budget: { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false } }; }
function failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status = "blocked", code, message, blockers = [], data = {} }) { const mutated = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status)); const verified = mutated.length > 0 && mutated.every((change) => change.live_readback?.status === "passed"); return finalizeEnvelope({ contract: MACRO_EXECUTION_CONTRACT, ok: false, macro: macroIdentity(entry), request: requestSummary(request, true), execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages }, sqlite: state.sqlite, result: { summary: message, canonical_refs: uniqueStrings(state.canonicalRefs), changes: clone(state.changes), verification: { status: verified ? "passed" : status === "partial_failure" ? "failed" : "not_required", evidence_refs: status === "partial_failure" ? uniqueStrings(state.evidenceRefs) : [] }, data }, blockers: (blockers?.length ? blockers : [blocker(code, message)]).slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count), error: { code, message, recoverable: true }, recovery: { undo_policy: entry.undo_policy, partial_changes_possible: status === "partial_failure", source_media_deleted: false, action: status === "partial_failure" ? "Keep rows proved by live readback and inspect unverified assets before retrying." : "Fix the typed source/target/coverage blocker and retry once." }, budget: { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false } }); }
function finalizeEnvelope(envelope) { const result = structuredClone(envelope); for (let attempt = 0; attempt < 3; attempt += 1) result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8"); const validation = validateMacroExecutionEnvelope(result); if (!validation.valid) throw new TypeError(`Invalid Alpha3.3 media Macro envelope: ${validation.errors.join("; ")}`); return deepFreeze(result); }

function legacyBlockedPlan(blockers) { return deepFreeze({ contract: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT, version: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_VERSION, id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, ok: false, mode: "blocked", dry_run: true, preview: { contract: "alpha3.3.media_place_assets.preview.v1", target_counts: { assets: 0 }, rows: [] }, preflight_requests: [], mutation_requests: [], readback_requests: [], child_requests: [], blockers, typed_blockers: blockers, safety: safetyPosture(), no_executor_safety_posture: safetyPosture() }); }
function safetyPosture() { return deepFreeze({ added_tools: 0, server_executes_children: true, hidden_executor: false, public_call_recipe: false, raw_action_lua_shell_ui: false, hardware_device_io: false, source_media_deleted: false, source_media_mutated: false, arbitrary_folder_scan: false }); }
function collectEvidence(state, execution) { state.evidenceRefs.push(...uniqueStrings([execution?.request?.id, execution?.template?.id, ...(execution?.result?.verification?.evidence_refs ?? [])])); }
function executionObjectRefs(execution) { const refs = []; const visit = (value) => { if (Array.isArray(value)) value.forEach(visit); else if (isObject(value)) { if (typeof value.kind === "string" && typeof value.ref === "string" && isObject(value.identity)) refs.push(value); else Object.values(value).forEach(visit); } }; visit(execution?.result?.refs); visit(execution?.result?.canonical_refs); return refs; }
function canonicalRefs(execution) { const refs = []; const visit = (value) => { if (typeof value === "string" && /^(track|item|take|file|region):/u.test(value)) refs.push(value); else if (Array.isArray(value)) value.forEach(visit); else if (isObject(value)) Object.values(value).forEach(visit); }; visit(execution?.result?.refs); visit(execution?.result?.canonical_refs); visit(execution?.result?.readback); visit(execution?.result?.summary); return uniqueStrings(refs); }
function readback(execution) { return isObject(execution?.result?.readback) ? execution.result.readback : isObject(execution?.result?.summary) ? execution.result.summary : isObject(execution?.result?.data) ? execution.result.data : {}; }
function pushStage(stages, id, kind, status, summary, evidenceRefs = []) { const row = { id, kind, status, summary, evidence_refs: uniqueStrings(evidenceRefs) }; const index = stages.findIndex((stage) => stage.id === id); if (index >= 0) stages[index] = row; else stages.push(row); }
function sqliteEvidence(runtime, used = false) { let status = {}; try { status = runtime?.status?.() ?? {}; } catch {} return { used, source: used ? "warm_index" : "not_used", freshness: used ? "stale" : "not_applicable", snapshot_ref: used ? status.snapshot_id ?? null : null, revision: used ? String(status.revision ?? status.project_revision ?? "") || null : null, refreshed: false }; }
function requestSummary(request, forceNonDry = false) { return { request_id: request?.context?.request_id ?? `${ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID}:${request?.context?.created_at ?? "request"}`, dry_run: forceNonDry ? false : request?.input?.dry_run !== false }; }
function responseBudget(request) { const requested = request?.budget?.max_response_bytes ?? request?.response_budget ?? MACRO_CONTRACT_CEILINGS.envelope_max_bytes; return Number.isInteger(requested) && requested >= MIN_RESPONSE_BUDGET && requested <= MACRO_CONTRACT_CEILINGS.envelope_max_bytes ? requested : MACRO_CONTRACT_CEILINGS.envelope_max_bytes; }
function macroIdentity(entry) { return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk }; }
function blocker(code, message, recoverable = true) { return { code, message, recoverable }; }
function failed(code, message, blockers = [blocker(code, message)]) { return { ok: false, code, message, blockers }; }
function coded(code, message, blockers = [blocker(code, message)]) { const error = new Error(message); error.code = code; error.blockers = blockers; return error; }
function exactGuidObjectRef(kind, ref) { if (typeof ref !== "string" || !ref.startsWith(`${kind}:guid:`)) return null; return { kind, ref, identity: { scheme: "guid", value: ref.slice(`${kind}:guid:`.length) } }; }
function fileObjectFromPath(ref, path) { return isFileRef(ref) ? { kind: "file", ref, identity: { scheme: "path", value: path } } : null; }
function isExactTrackRef(value) { return typeof value === "string" && /^track:guid:\{[^{}\r\n]{1,128}\}$/u.test(value); }
function isExactTakeRef(value) { return typeof value === "string" && /^take:guid:\{[^{}\r\n]{1,128}\}$/u.test(value); }
function isRegionRef(value) { return typeof value === "string" && /^region:index:\d+$/u.test(value); }
function isTrackRef(value) { return typeof value === "string" && /^track:(guid|index):/u.test(value); }
function isItemRef(value) { return typeof value === "string" && /^item:(guid|index):/u.test(value); }
function isTakeRef(value) { return typeof value === "string" && /^take:(guid|index):/u.test(value); }
function isFileRef(value) { return typeof value === "string" && value.startsWith("file:"); }
function isSafeAbsoluteFilePath(value) { return typeof value === "string" && value.startsWith("/") && Buffer.byteLength(value) <= MAX_PATH_BYTES && !hasControls(value) && !/^\/(dev|Volumes\/Hardware|System\/Volumes\/Data\/dev)(\/|$)/u.test(value) && !/^[a-z][a-z0-9+.-]*:/iu.test(value); }
function isSafeName(value) { return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= MAX_NAME_BYTES && !hasControls(value); }
function hasControls(value) { return /[\u0000-\u001f\u007f]/u.test(value); }
function isPercent(value) { return Number.isFinite(value) && value >= 0 && value <= 1; }
function finitePositive(value) { return Number.isFinite(value) && value > 0; }
function finiteNonNegative(value) { return Number.isFinite(value) && value >= 0; }
function integerRange(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
function close(left, right) { return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= EPSILON; }
function stringArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; }
function uniqueStrings(values) { return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))].slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count); }
function compact(value) { return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null && child !== undefined)); }
function safeNowIso(now) { try { const value = now(); const date = value instanceof Date ? value : new Date(value); if (!Number.isNaN(date.getTime())) return date.toISOString(); } catch {} return new Date().toISOString(); }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }

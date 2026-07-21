import {
  EXECUTABLE_RECIPE_DRAFT_CONTRACT,
  EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT,
  validateExecutableRecipeDraft,
} from "../../core/src/executable-recipe-contract-v1.mjs";

export const ALPHA3_4_F_LEARNED_OPERATION_CONTRACT = "alpha3.4.learned_operation.v1";
export const ALPHA3_4_F_LEARNED_RECORD_CONTRACT = "alpha3.4.learned_operation.record.v1";
export const ALPHA3_4_F_REPLAY_CONTRACT = "alpha3.4.learned_operation.replay.v1";
export const ALPHA3_4_F_REPETITION_COUNT = 10;
export const ALPHA3_4_F_MACRO_BATCH_SIZES = Object.freeze([8, 2]);

const RESOLVE_ITEM_ID = "template.items.resolve_item_ref";
const READ_ITEM_ID = "template.items.read_item_summary";
const LIST_TRACK_ITEMS_ID = "template.items.list_items_on_track";
const COPY_ITEM_ID = "template.items.copy_item_to_track";
const ITEMS_APPLY_ID = "macro.items.apply";

const ITEM_FACTS = Object.freeze({
  track_ref: "string",
  position_seconds: "number",
  length_seconds: "number",
  volume_db: "number",
  fade_in_seconds: "number",
  fade_out_seconds: "number",
  snap_offset_seconds: "number",
});

const TAKE_FACTS = Object.freeze({
  active_take_ref: "nullable_string",
  take_volume_db: "number",
  take_pan: "number",
  take_pitch_semitones: "number",
  playrate: "number",
  preserve_pitch: "boolean",
});

export class Alpha3_4FLearnedOperationError extends Error {
  constructor(message, code = "LEARNED_OPERATION_FAILED", details = {}) {
    super(message);
    this.name = "Alpha3_4FLearnedOperationError";
    this.code = code;
    this.details = details;
  }
}

export function createAlpha3_4FLearnedOperationExperiment(options = {}) {
  const callTemplate = options.callTemplate ?? options.call_template;
  const callRecipe = options.callRecipe ?? options.call_recipe;
  const catalog = options.catalog ?? options.dependencyCatalog ?? null;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const records = new Map();
  const replays = new Map();
  const savedRevisions = new Map();
  let recordSequence = 0;
  let replaySequence = 0;

  async function captureItemCopy(request = {}) {
    try {
      requireFunction(callTemplate, "callTemplate");
      const sourceItemRef = exactRef(request.source_item_ref, "item", "source_item_ref");
      const demonstratedItemRef = exactRef(request.demonstrated_item_ref, "item", "demonstrated_item_ref");
      const targetTrackRef = exactRef(request.target_track_ref, "track", "target_track_ref");
      const pitchStep = positiveFinite(request.pitch_step_semitones ?? 1, "pitch_step_semitones");
      const spacing = positiveFinite(request.spacing_seconds ?? 1, "spacing_seconds");

      const sourceObject = await resolveExactItem(callTemplate, sourceItemRef);
      const demonstratedObject = await resolveExactItem(callTemplate, demonstratedItemRef);
      await listCompleteTrackInventory(callTemplate, targetTrackRef);
      const beforeSummary = await readExactItem(callTemplate, sourceObject, sourceItemRef);
      const afterSummary = await readExactItem(callTemplate, demonstratedObject, demonstratedItemRef);
      const before = captureTypedItemState(beforeSummary);
      const after = captureTypedItemState(afterSummary);
      const diff = diffTypedItemStates(before, after);
      const relativePosition = knownNumberDelta(before.position_seconds, after.position_seconds);
      const recordId = request.record_id ?? `learned_item_copy_${++recordSequence}`;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(recordId) || records.has(recordId)) {
        throw new Alpha3_4FLearnedOperationError("record_id must be unique bounded ASCII.", "LEARNED_RECORD_ID_INVALID");
      }
      const record = deepFreeze({
        contract: ALPHA3_4_F_LEARNED_RECORD_CONTRACT,
        record_id: recordId,
        kind: "item_copy_controls",
        captured_at: iso(now()),
        immutable: true,
        transient: true,
        repetitions: ALPHA3_4_F_REPETITION_COUNT,
        source_item_ref: sourceItemRef,
        demonstrated_item_ref: demonstratedItemRef,
        target_track_ref: targetTrackRef,
        before,
        after,
        diff,
        learned: {
          relative_position_seconds: relativePosition,
          spacing_seconds: spacing,
          pitch_step_semitones: pitchStep,
          item: learnedItemControls(after),
          take: learnedTakeControls(after),
        },
        replayable: replayBlockers(after, relativePosition).length === 0,
        blockers: replayBlockers(after, relativePosition),
      });
      records.set(recordId, record);
      return ok("captured", { record });
    } catch (error) {
      return failure(error, "capture");
    }
  }

  async function replayItemCopy(request = {}) {
    const applied = [];
    try {
      requireFunction(callTemplate, "callTemplate");
      const record = requireRecord(records, request.record_id);
      if (!record.replayable) {
        throw new Alpha3_4FLearnedOperationError(
          "Learned record lacks required known facts for replay.",
          "LEARNED_RECORD_INCOMPLETE",
          { blockers: record.blockers },
        );
      }
      const sourceItemRef = exactRef(request.source_item_ref ?? record.source_item_ref, "item", "source_item_ref");
      const targetTrackRef = exactRef(request.target_track_ref ?? record.target_track_ref, "track", "target_track_ref");

      // Complete all source/target authority checks before the first copying write.
      const sourceObject = await resolveExactItem(callTemplate, sourceItemRef);
      const inventory = await listCompleteTrackInventory(callTemplate, targetTrackRef);
      const liveSource = await readExactItem(callTemplate, sourceObject, sourceItemRef);
      const sourceState = captureTypedItemState(liveSource);
      if (sourceState.position_seconds.status !== "known") {
        throw new Alpha3_4FLearnedOperationError(
          "Live source position is unknown.",
          "LEARNED_REPLAY_PREFLIGHT_FAILED",
        );
      }

      const positions = Array.from({ length: ALPHA3_4_F_REPETITION_COUNT }, (_, index) => (
        sourceState.position_seconds.value
        + record.learned.relative_position_seconds
        + (record.learned.spacing_seconds * index)
      ));
      if (new Set(positions).size !== ALPHA3_4_F_REPETITION_COUNT) {
        throw new Alpha3_4FLearnedOperationError("Replay positions are not unique.", "LEARNED_REPLAY_PREFLIGHT_FAILED");
      }

      const copied = [];
      for (const [index, positionSeconds] of positions.entries()) {
        const execution = await invoke(callTemplate, {
          id: COPY_ITEM_ID,
          input: { position_seconds: positionSeconds },
          refs: { source_item_ref: sourceObject, target_track_ref: targetTrackRef },
        }, "LEARNED_COPY_FAILED");
        const summary = executionSummary(execution);
        const newItemRef = exactRef(summary.new_item_ref ?? findRef(execution, "item", sourceItemRef), "item", "new_item_ref");
        if (newItemRef === sourceItemRef || copied.some((item) => item.item_ref === newItemRef)) {
          throw new Alpha3_4FLearnedOperationError("Copy did not return one unique new Item ref.", "LEARNED_COPY_IDENTITY_INVALID");
        }
        const readback = await readExactItem(callTemplate, newItemRef, newItemRef);
        if (!near(readback.position_seconds, positionSeconds)) {
          throw new Alpha3_4FLearnedOperationError(
            `Copied Item ${index + 1} position readback mismatched.`,
            "LEARNED_COPY_READBACK_MISMATCH",
            { item_ref: newItemRef, expected: positionSeconds, actual: readback.position_seconds },
          );
        }
        copied.push({
          index,
          item_ref: newItemRef,
          take_ref: exactRef(readback.active_take_ref, "take", "active_take_ref"),
          position_seconds: positionSeconds,
        });
        applied.push({ kind: "copy", item_ref: newItemRef, verified: true });
      }

      const changes = copied.map((copy, index) => buildControlRow(record, copy, index));
      const batches = [changes.slice(0, 8), changes.slice(8, 10)];
      for (const [index, batch] of batches.entries()) {
        if (batch.length !== ALPHA3_4_F_MACRO_BATCH_SIZES[index]) {
          throw new Alpha3_4FLearnedOperationError("Macro batch size drift.", "LEARNED_BATCH_SIZE_INVALID");
        }
        const execution = await invoke(callTemplate, {
          id: ITEMS_APPLY_ID,
          input: { mode: "set_item_take_controls", changes: batch, dry_run: false },
          refs: {},
        }, "LEARNED_CONTROL_BATCH_FAILED");
        assertMacroBatchTruth(execution, batch);
        applied.push({ kind: "macro_batch", batch: index + 1, count: batch.length, verified: true });
      }

      const replayId = `learned_replay_${++replaySequence}`;
      const replay = deepFreeze({
        contract: ALPHA3_4_F_REPLAY_CONTRACT,
        replay_id: replayId,
        record_id: record.record_id,
        status: "completed",
        repetitions: copied.length,
        preflight: {
          source_item_ref: sourceItemRef,
          target_track_ref: targetTrackRef,
          target_inventory_count: inventory.items.length,
          complete: true,
          writes_before_complete: 0,
        },
        copied,
        batches: batches.map((batch) => batch.map(cloneJson)),
        macro_batch_sizes: batches.map((batch) => batch.length),
        applied,
      });
      replays.set(replayId, replay);
      return ok("completed", { replay });
    } catch (error) {
      return failure(error, "replay", {
        applied: cloneJson(applied),
        outcome: applied.length === 0 ? "zero_write" : "partial_or_unknown",
      });
    }
  }

  async function saveLearnedRecipe(request = {}) {
    try {
      requireFunction(callRecipe, "callRecipe");
      if (!catalog) {
        throw new Alpha3_4FLearnedOperationError("Executable Recipe dependency catalog is required.", "LEARNED_RECIPE_CATALOG_REQUIRED");
      }
      const replay = requireReplay(replays, request.replay_id);
      const record = requireRecord(records, replay.record_id);
      const draft = buildLearnedOperationRecipeDraft(record, replay, {
        catalog,
        recipe_id: request.recipe_id,
        portability: request.portability,
      });
      const localValidation = validateExecutableRecipeDraft(draft, { catalog });
      if (!localValidation.ok) {
        throw new Alpha3_4FLearnedOperationError(
          "Learned Recipe draft failed local E validation.",
          "LEARNED_RECIPE_INVALID",
          { errors: localValidation.errors },
        );
      }
      const validated = await callRecipe({ operation: "validate", draft });
      if (validated?.ok !== true || validated.status !== "validated") {
        throw new Alpha3_4FLearnedOperationError("call_recipe validate rejected learned draft.", "LEARNED_RECIPE_VALIDATE_FAILED");
      }
      const saved = await callRecipe({
        operation: "save",
        draft,
        version: request.version ?? "1.0.0",
        revision_number: request.revision ?? 1,
      });
      const identity = exactSavedIdentity(saved);
      savedRevisions.set(record.record_id, deepFreeze({ identity, inputs: recipeRunInputs(replay), draft }));
      return ok("saved", { identity, draft });
    } catch (error) {
      return failure(error, "save");
    }
  }

  async function runSavedLearnedRecipe(request = {}) {
    try {
      requireFunction(callRecipe, "callRecipe");
      const saved = savedRevisions.get(request.record_id);
      if (!saved) {
        throw new Alpha3_4FLearnedOperationError("No saved revision exists for record_id.", "LEARNED_RECIPE_NOT_SAVED");
      }
      const result = await callRecipe({
        operation: "run",
        ...saved.identity,
        inputs: saved.inputs,
      });
      if (result?.ok !== true) {
        throw new Alpha3_4FLearnedOperationError("Exact saved learned Recipe run failed.", "LEARNED_RECIPE_RUN_FAILED", {
          status: result?.status,
          code: result?.error?.code,
        });
      }
      return ok("ran_saved_revision", { identity: saved.identity, result });
    } catch (error) {
      return failure(error, "run_saved");
    }
  }

  return Object.freeze({
    contract: ALPHA3_4_F_LEARNED_OPERATION_CONTRACT,
    captureItemCopy,
    replayItemCopy,
    saveLearnedRecipe,
    runSavedLearnedRecipe,
    getRecord(recordId) { return records.get(recordId) ?? null; },
    getReplay(replayId) { return replays.get(replayId) ?? null; },
  });
}

export function captureTypedItemState(summary = {}) {
  const facts = { item_ref: fact(summary.item_ref, "string") };
  for (const [field, type] of Object.entries(ITEM_FACTS)) facts[field] = fact(summary[field], type);
  for (const [field, type] of Object.entries(TAKE_FACTS)) facts[field] = fact(summary[field], type);
  return deepFreeze(facts);
}

export function diffTypedItemStates(before, after) {
  const changed = [];
  const unchanged = [];
  const unknown = [];
  for (const field of [...Object.keys(ITEM_FACTS), ...Object.keys(TAKE_FACTS)]) {
    const left = before?.[field] ?? unknownFact("missing_before_fact");
    const right = after?.[field] ?? unknownFact("missing_after_fact");
    if (left.status !== "known" || right.status !== "known") {
      unknown.push({ field, before: left, after: right });
    } else if (same(left.value, right.value)) {
      unchanged.push({ field, value: left.value });
    } else {
      changed.push({ field, before: left.value, after: right.value });
    }
  }
  return deepFreeze({ changed, unchanged, unknown });
}

export function buildLearnedOperationRecipeDraft(record, replay, options = {}) {
  const catalog = options.catalog;
  const macro = catalog?.getMacro?.(ITEMS_APPLY_ID);
  if (!macro) {
    throw new Alpha3_4FLearnedOperationError("macro.items.apply is absent from the dependency catalog.", "LEARNED_RECIPE_DEPENDENCY_MISSING");
  }
  const recipeId = options.recipe_id ?? "recipe.items.learned_item_copy_controls";
  const stages = [1, 2].map((batch) => ({
    id: `apply_batch_${batch}`,
    kind: "macro",
    dependency: { kind: "macro", id: macro.id, version: macro.version, fallback_reason: null },
    inputs: ["mode", "changes", "dry_run"],
    outputs: [],
    risk: macro.risk,
    checkpoint: `checkpoint_apply_batch_${batch}`,
  }));
  const inputs = [1, 2].flatMap((batch) => [
    { id: `batch_${batch}_mode`, type: "string", required: true },
    { id: `batch_${batch}_changes`, type: "array", required: true },
    { id: `batch_${batch}_dry_run`, type: "boolean", required: true },
  ]);
  const bindings = [1, 2].flatMap((batch) => ["mode", "changes", "dry_run"].map((port) => ({
    from: { scope: "recipe_input", id: null, port: `batch_${batch}_${port}` },
    to: { scope: "stage", id: `apply_batch_${batch}`, port },
  })));
  const portability = normalizePortability(options.portability);
  return deepFreeze({
    contract: EXECUTABLE_RECIPE_DRAFT_CONTRACT,
    id: recipeId,
    title: "Learned item copy controls",
    summary: "Apply one captured Item/Active-Take control pattern to ten concrete copied Items in bounded 8+2 Macro batches.",
    pack: "items",
    risk: macro.risk,
    inputs,
    outputs: [],
    stages,
    bindings,
    dependencies: [{
      kind: "macro",
      id: macro.id,
      version: macro.version,
      risk: macro.risk,
      fallback_reason: null,
      descriptor_hash: macro.descriptor_hash,
    }],
    required_capabilities: [...macro.capabilities],
    risk_grants: [macro.risk],
    checkpoints: stages.map((stage) => ({
      id: stage.checkpoint,
      after_stage: stage.id,
      evidence_id: `evidence_${stage.id}`,
      resume_identity: `${recipeId}.${stage.id}`,
      summary: `${stage.id} verified by macro native readback.`,
    })),
    preflight: {
      contract: EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT,
      complete_graph: true,
      stage_count: stages.length,
      dependency_count: 1,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability,
  });
}

function buildControlRow(record, copy, index) {
  const item = cloneJson(record.learned.item);
  const take = {
    ...cloneJson(record.learned.take),
    pitch_semitones: record.after.take_pitch_semitones.value + (record.learned.pitch_step_semitones * index),
  };
  if (Object.keys(item).length === 0 && Object.keys(take).length === 0) {
    throw new Alpha3_4FLearnedOperationError("Learned record has no known controls.", "LEARNED_RECORD_INCOMPLETE");
  }
  return {
    id: `copy_${String(index + 1).padStart(2, "0")}`,
    item_ref: copy.item_ref,
    take_ref: copy.take_ref,
    ...(Object.keys(item).length > 0 ? { item } : {}),
    take,
  };
}

function learnedItemControls(after) {
  return knownValues(after, {
    volume_db: "volume_db",
    length_seconds: "length_seconds",
    fade_in_seconds: "fade_in_seconds",
    fade_out_seconds: "fade_out_seconds",
    snap_offset_seconds: "snap_offset_seconds",
  });
}

function learnedTakeControls(after) {
  return knownValues(after, {
    take_volume_db: "volume_db",
    take_pan: "pan",
    playrate: "playrate",
    preserve_pitch: "preserve_pitch",
  });
}

function knownValues(state, mapping) {
  const result = {};
  for (const [factName, controlName] of Object.entries(mapping)) {
    if (state[factName]?.status === "known") result[controlName] = state[factName].value;
  }
  return result;
}

function replayBlockers(after, relativePosition) {
  const blockers = [];
  if (!Number.isFinite(relativePosition)) blockers.push("relative_position_seconds_unknown");
  if (after.active_take_ref?.status !== "known" || after.active_take_ref.value === null) blockers.push("active_take_ref_unknown");
  if (after.take_pitch_semitones?.status !== "known") blockers.push("take_pitch_semitones_unknown");
  return blockers;
}

async function resolveExactItem(callTemplate, itemRef) {
  const execution = await invoke(callTemplate, {
    id: RESOLVE_ITEM_ID,
    input: { ref: itemRef },
    refs: {},
  }, "LEARNED_RESOLVE_FAILED");
  const resolved = findObjectRef(execution, "item") ?? findRef(execution, "item");
  const resolvedRef = typeof resolved === "string" ? resolved : resolved?.ref;
  if (resolvedRef !== itemRef) {
    throw new Alpha3_4FLearnedOperationError("Item resolver identity mismatched.", "LEARNED_RESOLVE_IDENTITY_MISMATCH");
  }
  return resolved;
}

async function readExactItem(callTemplate, itemObject, expectedRef) {
  const execution = await invoke(callTemplate, {
    id: READ_ITEM_ID,
    input: { include_take_summary: true },
    refs: { item_ref: itemObject },
  }, "LEARNED_READ_FAILED");
  const summary = executionSummary(execution);
  if (summary.item_ref !== expectedRef) {
    throw new Alpha3_4FLearnedOperationError("Item readback identity mismatched.", "LEARNED_READ_IDENTITY_MISMATCH");
  }
  return summary;
}

async function listCompleteTrackInventory(callTemplate, trackRef) {
  const execution = await invoke(callTemplate, {
    id: LIST_TRACK_ITEMS_ID,
    input: { limit: 100, include_take_summary: false },
    refs: { track_ref: trackRef },
  }, "LEARNED_TRACK_INVENTORY_FAILED");
  const summary = executionSummary(execution);
  const items = Array.isArray(summary.items) ? summary.items : [];
  const hasMore = summary.page?.has_more === true || summary.has_more === true || summary.truncated === true;
  if (hasMore) {
    throw new Alpha3_4FLearnedOperationError("Target Track inventory is incomplete.", "LEARNED_TRACK_INVENTORY_INCOMPLETE");
  }
  return { items };
}

async function invoke(dispatch, request, code) {
  let result;
  try {
    result = await dispatch(request);
  } catch (error) {
    throw new Alpha3_4FLearnedOperationError(error?.message ?? "Injected dispatcher threw.", code);
  }
  if (result?.ok !== true) {
    throw new Alpha3_4FLearnedOperationError(
      result?.error?.message ?? `${request.id} failed.`,
      result?.error?.code ?? code,
      { id: request.id },
    );
  }
  return result;
}

function assertMacroBatchTruth(execution, batch) {
  const changes = execution?.result?.changes;
  if (!Array.isArray(changes) || changes.length !== batch.length) {
    throw new Alpha3_4FLearnedOperationError("Macro batch omitted complete change truth.", "LEARNED_CONTROL_READBACK_MISMATCH");
  }
  if (changes.some((change) => change.status !== "applied" || change.live_readback?.status !== "passed")) {
    throw new Alpha3_4FLearnedOperationError("Macro batch lacked applied native readback.", "LEARNED_CONTROL_READBACK_MISMATCH");
  }
}

function executionSummary(execution) {
  const candidates = [
    execution?.result?.readback,
    execution?.result?.summary,
    execution?.result?.data,
    execution?.summary,
  ];
  return candidates.find(isPlainObject) ?? {};
}

function findObjectRef(execution, kind) {
  return executionRefs(execution).find((ref) => isPlainObject(ref) && ref.kind === kind && typeof ref.ref === "string") ?? null;
}

function findRef(execution, kind, excluded = null) {
  const refs = executionRefs(execution);
  for (const candidate of refs) {
    const value = typeof candidate === "string" ? candidate : candidate?.ref;
    if (typeof value === "string" && value.startsWith(`${kind}:`) && value !== excluded) return value;
  }
  return null;
}

function executionRefs(execution) {
  const refs = execution?.result?.refs;
  return Array.isArray(refs) ? refs : [];
}

function fact(value, type) {
  if (type === "number" && Number.isFinite(value)) return deepFreeze({ status: "known", type, value });
  if (type === "boolean" && typeof value === "boolean") return deepFreeze({ status: "known", type, value });
  if (type === "string" && typeof value === "string" && value.length > 0) return deepFreeze({ status: "known", type, value });
  if (type === "nullable_string" && (value === null || (typeof value === "string" && value.length > 0))) {
    return deepFreeze({ status: "known", type, value });
  }
  return unknownFact(value === undefined ? "missing" : "invalid_type", type);
}

function unknownFact(reason, type = "unknown") {
  return deepFreeze({ status: "unknown", type, reason });
}

function knownNumberDelta(left, right) {
  return left?.status === "known" && right?.status === "known" ? right.value - left.value : null;
}

function recipeRunInputs(replay) {
  return deepFreeze({
    batch_1_mode: "set_item_take_controls",
    batch_1_changes: replay.batches[0],
    batch_1_dry_run: false,
    batch_2_mode: "set_item_take_controls",
    batch_2_changes: replay.batches[1],
    batch_2_dry_run: false,
  });
}

function exactSavedIdentity(saved) {
  if (saved?.ok !== true || saved.status !== "saved") {
    throw new Alpha3_4FLearnedOperationError("call_recipe save failed.", "LEARNED_RECIPE_SAVE_FAILED");
  }
  const identity = {
    recipe_id: saved.recipe_id,
    version: saved.version,
    revision: saved.revision,
    content_hash: saved.content_hash,
    validation_result_id: saved.validation_result_id,
  };
  if (
    typeof identity.recipe_id !== "string"
    || typeof identity.version !== "string"
    || !Number.isInteger(identity.revision)
    || !/^[a-f0-9]{64}$/.test(identity.content_hash ?? "")
    || typeof identity.validation_result_id !== "string"
  ) {
    throw new Alpha3_4FLearnedOperationError("Saved revision identity is incomplete.", "LEARNED_RECIPE_IDENTITY_INVALID");
  }
  return deepFreeze(identity);
}

function normalizePortability(value) {
  if (!isPlainObject(value)) {
    throw new Alpha3_4FLearnedOperationError("portability is required for Recipe save.", "LEARNED_RECIPE_PORTABILITY_REQUIRED");
  }
  const result = {
    project_identity: value.project_identity,
    bridge_owner: value.bridge_owner,
    bridge_generation: String(value.bridge_generation ?? ""),
    platform: value.platform,
  };
  if (Object.values(result).some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Alpha3_4FLearnedOperationError("portability fields must be non-empty strings.", "LEARNED_RECIPE_PORTABILITY_REQUIRED");
  }
  return result;
}

function exactRef(value, kind, field) {
  if (typeof value !== "string" || !new RegExp(`^${kind}:guid:\\{[^{}]+\\}$`).test(value)) {
    throw new Alpha3_4FLearnedOperationError(`${field} must be an exact ${kind}:guid ref.`, "LEARNED_EXACT_REF_REQUIRED", { field });
  }
  return value;
}

function requireRecord(records, recordId) {
  const record = records.get(recordId);
  if (!record) throw new Alpha3_4FLearnedOperationError("Unknown record_id.", "LEARNED_RECORD_NOT_FOUND");
  return record;
}

function requireReplay(replays, replayId) {
  const replay = replays.get(replayId);
  if (!replay) throw new Alpha3_4FLearnedOperationError("Unknown replay_id.", "LEARNED_REPLAY_NOT_FOUND");
  return replay;
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Alpha3_4FLearnedOperationError(`${name} is required.`, "LEARNED_DISPATCHER_REQUIRED");
  }
}

function positiveFinite(value, field) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Alpha3_4FLearnedOperationError(`${field} must be greater than zero.`, "LEARNED_PARAMS_INVALID");
  }
  return value;
}

function same(left, right) {
  return typeof left === "number" && typeof right === "number" ? near(left, right) : left === right;
}

function near(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-7;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Alpha3_4FLearnedOperationError("now returned invalid date.", "LEARNED_CLOCK_INVALID");
  return date.toISOString();
}

function ok(status, extra = {}) {
  return deepFreeze({ contract: ALPHA3_4_F_LEARNED_OPERATION_CONTRACT, ok: true, status, ...extra });
}

function failure(error, phase, extra = {}) {
  return deepFreeze({
    contract: ALPHA3_4_F_LEARNED_OPERATION_CONTRACT,
    ok: false,
    status: "failed",
    phase,
    error: {
      code: error?.code ?? "LEARNED_OPERATION_FAILED",
      message: error?.message ?? "Learned operation failed.",
      details: isPlainObject(error?.details) ? cloneJson(error.details) : {},
    },
    ...extra,
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

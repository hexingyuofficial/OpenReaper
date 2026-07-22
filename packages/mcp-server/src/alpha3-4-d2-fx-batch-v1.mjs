import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  validateMacroExecutionEnvelope,
} from "./macro-runtime-contract-v1.mjs";
import {
  ALPHA3_4_C_PARAMETER_PAGE_HARD_CEILING,
  hydrateCompleteFxParameterInventory,
  resolveExactParameterTargets,
} from "./alpha3-4-c-fx-semantic-truth-v1.mjs";

export const ALPHA3_4_D2_FX_BATCH_CONTRACT = "openreaper.alpha3.4.d2_fx_batch.v1";
export const ALPHA3_4_D2_FX_BATCH_MODE = "exact_assignments";
export const ALPHA3_4_D2_FX_BATCH_ROW_ID_PATTERN = /^[A-Za-z0-9_-]{1,12}$/u;
export const ALPHA3_4_D2_FX_BATCH_MAX_ROWS = 64;
export const ALPHA3_4_D2_MIN_RESPONSE_BUDGET = 2_048;

const SET_FX_PARAMETER_ID = "template.fx.set_fx_parameter_normalized";
const READ_FX_PARAMETER_ID = "template.fx.read_fx_parameter";
const LIST_FX_PARAMETERS_ID = "template.fx.list_fx_parameters";
const RESOLVE_FX_ID = "template.fx.resolve_fx_ref";
const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const RESOLVE_MIDI_TAKE_ID = "template.midi.resolve_midi_take_ref";

const ASSIGNMENT_ROW_FIELDS = new Set([
  "id",
  "fx_ref",
  "param_index",
  "param_ident",
  "param_name",
  "normalized_value",
  "requested_formatted_value",
]);
const EXACT_ASSIGNMENTS_TOP_LEVEL = new Set(["mode", "assignments", "dry_run"]);
const FORBIDDEN_LEGACY_FIELDS = new Set([
  "plugin",
  "controls",
  "starter_action",
  "action_parameters",
  "control_overrides",
  "selector",
  "changes",
  "fx_ref",
  "plugin_id",
  "plugin_name",
  "parameter_metadata",
]);

export function isExactAssignmentsMode(input) {
  return isPlainObject(input) && input.mode === ALPHA3_4_D2_FX_BATCH_MODE;
}

export function normalizeExactAssignmentsInput(input = {}) {
  if (!isPlainObject(input)) {
    return failed("FX_ASSIGNMENTS_REQUEST_INVALID", "macro.fx.set_controls input must be an object.");
  }
  const unknown = Object.keys(input).filter((field) => !EXACT_ASSIGNMENTS_TOP_LEVEL.has(field));
  if (unknown.length > 0) {
    return failed(
      "FX_ASSIGNMENTS_FIELDS_INVALID",
      `exact_assignments accepts only mode, assignments, and dry_run; unsupported field(s): ${unknown.join(", ")}.`,
    );
  }
  for (const field of FORBIDDEN_LEGACY_FIELDS) {
    if (Object.hasOwn(input, field)) {
      return failed(
        "FX_ASSIGNMENTS_FIELDS_INVALID",
        `exact_assignments rejects legacy field ${field} before live resolution.`,
      );
    }
  }
  if (typeof input.dry_run !== "undefined" && typeof input.dry_run !== "boolean") {
    return failed("FX_ASSIGNMENTS_DRY_RUN_INVALID", "dry_run must be boolean.");
  }
  if (!Array.isArray(input.assignments) || input.assignments.length < 1 || input.assignments.length > ALPHA3_4_D2_FX_BATCH_MAX_ROWS) {
    return failed(
      "FX_ASSIGNMENTS_SIZE_INVALID",
      `assignments must contain 1-${ALPHA3_4_D2_FX_BATCH_MAX_ROWS} rows.`,
    );
  }
  const rows = [];
  const seenIds = new Set();
  const seenTargets = new Set();
  for (const [index, raw] of input.assignments.entries()) {
    if (!isPlainObject(raw)) {
      return failed("FX_ASSIGNMENTS_ROW_INVALID", `assignments[${index}] must be an object.`);
    }
    const rowUnknown = Object.keys(raw).filter((field) => !ASSIGNMENT_ROW_FIELDS.has(field));
    if (rowUnknown.length > 0) {
      return failed(
        "FX_ASSIGNMENTS_ROW_INVALID",
        `assignments[${index}] has unsupported field(s): ${rowUnknown.join(", ")}.`,
      );
    }
    if (typeof raw.id !== "string" || !ALPHA3_4_D2_FX_BATCH_ROW_ID_PATTERN.test(raw.id)) {
      return failed(
        "FX_ASSIGNMENTS_ROW_ID_INVALID",
        `assignments[${index}].id must match ^[A-Za-z0-9_-]{1,12}$.`,
      );
    }
    if (seenIds.has(raw.id)) {
      return failed("FX_ASSIGNMENTS_ROW_ID_DUPLICATE", `assignments repeats id ${raw.id}.`);
    }
    seenIds.add(raw.id);
    if (typeof raw.fx_ref !== "string" || !raw.fx_ref.startsWith("fx:")) {
      return failed(
        "FX_ASSIGNMENTS_FX_REF_REQUIRED",
        `assignments[${index}].fx_ref must be an exact owner-scoped fx: ref.`,
      );
    }
    const hasIndex = Number.isInteger(raw.param_index) && raw.param_index >= 0;
    const hasIdent = typeof raw.param_ident === "string" && raw.param_ident.trim() !== "";
    const hasName = typeof raw.param_name === "string" && raw.param_name.trim() !== "";
    if (!hasIndex && !hasIdent && !hasName) {
      return failed(
        "FX_ASSIGNMENTS_PARAM_TARGET_REQUIRED",
        `assignments[${index}] requires param_index, or one exact param_ident, or one exact param_name.`,
      );
    }
    if (hasName && hasIdent) {
      return failed(
        "FX_ASSIGNMENTS_PARAM_TARGET_AMBIGUOUS",
        `assignments[${index}] must not supply both param_name and param_ident.`,
      );
    }
    if (hasName && hasIndex) {
      return failed(
        "FX_ASSIGNMENTS_PARAM_TARGET_AMBIGUOUS",
        `assignments[${index}] must not mix param_name with param_index.`,
      );
    }
    if (typeof raw.normalized_value !== "number" || !Number.isFinite(raw.normalized_value) || raw.normalized_value < 0 || raw.normalized_value > 1) {
      return failed(
        "FX_ASSIGNMENTS_VALUE_INVALID",
        `assignments[${index}].normalized_value must be a finite number in [0,1].`,
      );
    }
    if (Object.hasOwn(raw, "requested_formatted_value") && (typeof raw.requested_formatted_value !== "string" || raw.requested_formatted_value.length === 0)) {
      return failed(
        "FX_ASSIGNMENTS_FORMATTED_VALUE_INVALID",
        `assignments[${index}].requested_formatted_value must be a non-empty string when supplied.`,
      );
    }
    const provisionalTarget = hasIndex
      ? `${raw.fx_ref}#index:${raw.param_index}`
      : hasIdent
        ? `${raw.fx_ref}#ident:${raw.param_ident.trim().toLowerCase()}`
        : `${raw.fx_ref}#name:${raw.param_name.trim().toLowerCase()}`;
    if (seenTargets.has(provisionalTarget)) {
      return failed(
        "FX_ASSIGNMENTS_DUPLICATE_TARGET",
        `assignments repeats exact parameter target ${provisionalTarget}.`,
      );
    }
    seenTargets.add(provisionalTarget);
    rows.push({
      id: raw.id,
      fx_ref: raw.fx_ref,
      param_index: hasIndex ? raw.param_index : null,
      param_ident: hasIdent ? raw.param_ident.trim() : null,
      param_name: hasName ? raw.param_name.trim() : null,
      normalized_value: raw.normalized_value,
      requested_formatted_value: typeof raw.requested_formatted_value === "string" ? raw.requested_formatted_value : null,
    });
  }
  return {
    ok: true,
    mode: ALPHA3_4_D2_FX_BATCH_MODE,
    dry_run: input.dry_run !== false,
    assignments: rows,
  };
}

export async function executeExactAssignmentsBatch({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  now = () => new Date(),
  monoNow = () => performance.now(),
  entry,
  startedAt,
  stages,
  state,
  listBudget,
  readBudget,
} = {}) {
  const activeBudget = responseBudget(request);
  const t0 = monoTick(monoNow);
  state.batchMode = true;
  state.calls = emptyCalls();
  state.timings = emptyTimings();

  const normalized = normalizeExactAssignmentsInput(request.input);
  if (!normalized.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: normalized.code,
      message: normalized.message,
      blockers: normalized.blockers,
      data: compactBatchData(state, { dry_run: request.input?.dry_run !== false }),
    });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "FX_ASSIGNMENTS_LIVE_EXECUTOR_REQUIRED",
      message: "macro.fx.set_controls exact_assignments needs the managed OpenReaper atomic route.",
      data: compactBatchData(state, { dry_run: normalized.dry_run }),
    });
  }

  const dryRun = normalized.dry_run;
  const resolveStarted = monoTick(monoNow);
  const resolvedRows = [];
  const fxCache = new Map();
  for (const row of normalized.assignments) {
    let fxRef = fxCache.get(row.fx_ref);
    if (!fxRef) {
      const resolved = await resolveExactFxRef({
        fxRef: row.fx_ref,
        executeAtomic,
        request,
        state,
      });
      if (!resolved.ok) {
        return failureEnvelope({
          entry, request, startedAt, now, stages, state, activeBudget,
          code: resolved.code,
          message: resolved.message,
          blockers: resolved.blockers,
          data: compactBatchData(state, { dry_run: dryRun }),
        });
      }
      fxRef = resolved.fx_ref;
      fxCache.set(row.fx_ref, fxRef);
    }
    if (fxRef !== row.fx_ref) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "FX_ASSIGNMENTS_FX_IDENTITY_MISMATCH",
        message: `Live FX resolution changed identity from ${row.fx_ref} to ${fxRef}.`,
        blockers: [blocker("FX_ASSIGNMENTS_FX_IDENTITY_MISMATCH", `Live FX resolution changed identity from ${row.fx_ref} to ${fxRef}.`)],
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    state.canonicalRefs.push(fxRef);
    resolvedRows.push({ ...row, resolved_fx_ref: fxRef });
  }
  state.timings.target_resolution_ms = monoElapsed(resolveStarted, monoNow);
  pushStage(stages, "stock-plugin-live-resolve", "live_ref_resolve", "completed", `Resolved ${fxCache.size} unique FX target(s) for ${resolvedRows.length} assignment row(s).`, state.evidenceRefs);

  const hydrateStarted = monoTick(monoNow);
  const inventories = new Map();
  for (const fxRef of new Set(resolvedRows.map((row) => row.resolved_fx_ref))) {
    const inventory = await hydrateCompleteFxParameterInventory({
      executeAtomic: async (childRequest) => {
        state.calls.inventory += 1;
        const execution = await runAtomic(executeAtomic, request, state, childRequest);
        return execution;
      },
      request,
      fxRef,
      listTemplateId: LIST_FX_PARAMETERS_ID,
      budget: listBudget,
    });
    if (!inventory.ok) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: inventory.code ?? "FX_PARAMETER_INVENTORY_INCOMPLETE",
        message: inventory.message ?? "Complete FX parameter inventory could not be proven.",
        data: compactBatchData(state, { dry_run: dryRun, unique_fx_count: inventories.size }),
      });
    }
    inventories.set(fxRef, inventory);
  }
  state.timings.inventory_hydration_ms = monoElapsed(hydrateStarted, monoNow);

  const preflightStarted = monoTick(monoNow);
  const prepared = [];
  const resolvedParamTargets = new Set();
  for (const row of resolvedRows) {
    const inventory = inventories.get(row.resolved_fx_ref);
    const resolved = resolveExactParameterTargets([row], inventory.parameters);
    if (!resolved.ok) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: resolved.code,
        message: resolved.message,
        data: compactBatchData(state, { dry_run: dryRun, unique_fx_count: inventories.size }),
      });
    }
    const change = resolved.resolved[0];
    const targetKey = `${row.resolved_fx_ref}#${change.param_index}`;
    if (resolvedParamTargets.has(targetKey)) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "FX_ASSIGNMENTS_DUPLICATE_TARGET",
        message: `More than one assignment resolves to ${targetKey}.`,
        blockers: [blocker("FX_ASSIGNMENTS_DUPLICATE_TARGET", `More than one assignment resolves to ${targetKey}.`)],
        data: compactBatchData(state, { dry_run: dryRun, unique_fx_count: inventories.size }),
      });
    }
    resolvedParamTargets.add(targetKey);

    let probeExecution;
    try {
      state.calls.preflight += 1;
      probeExecution = await runAtomic(executeAtomic, request, state, {
        id: READ_FX_PARAMETER_ID,
        input: {
          param_index: change.param_index,
          ...(change.param_ident ? { param_ident: change.param_ident } : {}),
          probe_normalized_value: change.normalized_value,
        },
        refs: { fx_ref: row.resolved_fx_ref },
        budget: readBudget,
      });
    } catch (error) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: error?.code ?? "FX_ASSIGNMENTS_PREFLIGHT_FAILED",
        message: error?.message ?? "Native preflight probe failed.",
        data: compactBatchData(state, { dry_run: dryRun, unique_fx_count: inventories.size }),
      });
    }
    const probe = executionReadback(probeExecution);
    const probeIndexMatches = probe?.param_index === change.param_index;
    const probeIdentMatches = !change.param_ident || probe?.param_ident === change.param_ident;
    const probeNormalized = Number(probe?.normalized_value);
    const probeFormatted = probe?.formatted_value;
    if (!probeIndexMatches
      || !probeIdentMatches
      || !Number.isFinite(probeNormalized)
      || Math.abs(probeNormalized - change.normalized_value) > 0.000001
      || typeof probeFormatted !== "string"
      || probeFormatted.length === 0) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "FX_ASSIGNMENTS_PREFLIGHT_INVALID",
        message: `Native preflight for ${row.id} did not return matching identity and formatted target truth.`,
        blockers: [blocker("FX_ASSIGNMENTS_PREFLIGHT_INVALID", `Native preflight for ${row.id} did not return matching identity and formatted target truth.`)],
        data: compactBatchData(state, { dry_run: dryRun, unique_fx_count: inventories.size }),
      });
    }
    if (typeof row.requested_formatted_value === "string" && row.requested_formatted_value !== probeFormatted) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "FX_ASSIGNMENTS_FORMATTED_TARGET_MISMATCH",
        message: `assignments[${row.id}] requested_formatted_value does not match REAPER native formatting.`,
        blockers: [blocker("FX_ASSIGNMENTS_FORMATTED_TARGET_MISMATCH", `assignments[${row.id}] requested_formatted_value does not match REAPER native formatting.`)],
        data: compactBatchData(state, { dry_run: dryRun, unique_fx_count: inventories.size }),
      });
    }
    prepared.push({
      ...change,
      fx_ref: row.resolved_fx_ref,
      native_target_formatted_value: probeFormatted,
      step_sizes_available: probe?.step_sizes_available ?? false,
      step_size: probe?.step_size ?? null,
      is_toggle: probe?.is_toggle ?? null,
      is_discrete: probe?.is_discrete ?? null,
    });
  }
  state.timings.preflight_ms = monoElapsed(preflightStarted, monoNow);
  pushStage(stages, "stock-plugin-preflight", "template_execute", "completed", `Preflighted ${prepared.length} exact assignment row(s) across ${inventories.size} FX.`, state.evidenceRefs);

  state.changes = prepared.map((row) => batchRowChange(row, {
    status: dryRun ? "planned" : "pending",
    mutation: dryRun ? "not_run" : "pending",
    readback: dryRun ? "not_run" : "pending",
    index: dryRun ? "skipped" : "pending",
  }));

  if (dryRun) {
    state.timings.mutation_ms = 0;
    state.timings.final_readback_ms = 0;
    state.timings.index_maintenance_ms = 0;
    state.timings.total_ms = monoElapsed(t0, monoNow);
    pushStage(stages, "stock-plugin-execute", "runtime_execute", "skipped", "exact_assignments dry_run skipped mutation.");
    pushStage(stages, "stock-plugin-verify", "verify", "completed", "Validated complete multi-FX assignment preview.");
    pushStage(stages, "stock-plugin-index-update", "index_update", "skipped", "Dry run did not stale the Project Index.");
    pushStage(stages, "stock-plugin-result", "result_project", "completed", "Projected compact multi-FX assignment preview.");
    return successEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: "dry_run_completed",
      summary: `Previewed ${prepared.length} exact FX assignment row(s) with no mutation.`,
      data: compactBatchData(state, { dry_run: true, unique_fx_count: inventories.size }),
      compact: activeBudget <= ALPHA3_4_D2_MIN_RESPONSE_BUDGET,
    });
  }

  let executionFailure = null;
  let failedIndex = -1;
  let mutationWallMs = 0;
  let readbackWallMs = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    const row = prepared[index];
    const change = state.changes[index];
    let mutationUnknown = false;
    let mutationFailed = false;
    let mutationError = null;
    let writeReadback = null;
    const rowMutationStarted = monoTick(monoNow);
    try {
      state.calls.mutation += 1;
      const writeExecution = await runAtomic(executeAtomic, request, state, {
        id: SET_FX_PARAMETER_ID,
        input: {
          param_index: row.param_index,
          normalized_value: row.normalized_value,
          ...(row.param_ident ? { param_ident: row.param_ident } : {}),
        },
        refs: { fx_ref: row.fx_ref },
        budget: readBudget,
      });
      writeReadback = executionReadback(writeExecution);
      if (writeExecution?.ok !== true) {
        mutationFailed = true;
        mutationError = {
          code: writeExecution?.error?.code ?? "FX_ASSIGNMENTS_MUTATION_FAILED",
          message: writeExecution?.error?.message ?? `${SET_FX_PARAMETER_ID} failed.`,
          blockers: [blocker(writeExecution?.error?.code ?? "FX_ASSIGNMENTS_MUTATION_FAILED", writeExecution?.error?.message ?? `${SET_FX_PARAMETER_ID} failed.`)],
          phase: "mutation",
        };
      }
    } catch (error) {
      mutationUnknown = true;
      mutationError = {
        code: error?.code ?? "FX_ASSIGNMENTS_MUTATION_FAILED",
        message: error?.message ?? `${SET_FX_PARAMETER_ID} threw.`,
        blockers: [blocker(error?.code ?? "FX_ASSIGNMENTS_MUTATION_FAILED", error?.message ?? `${SET_FX_PARAMETER_ID} threw.`)],
        phase: "mutation",
      };
    }
    mutationWallMs += monoElapsed(rowMutationStarted, monoNow);
    if (mutationFailed || mutationUnknown) {
      change.mutation = { status: mutationUnknown ? "unknown_or_partial" : "failed" };
      change.status = mutationUnknown ? "unknown_or_partial" : "failed";
    } else {
      change.mutation = { status: "completed" };
    }

    const readbackStarted = monoTick(monoNow);
    let observed = null;
    try {
      state.calls.readback += 1;
      const readExecution = await runAtomic(executeAtomic, request, state, {
        id: READ_FX_PARAMETER_ID,
        input: {
          param_index: row.param_index,
          ...(row.param_ident ? { param_ident: row.param_ident } : {}),
        },
        refs: { fx_ref: row.fx_ref },
        budget: readBudget,
      });
      observed = executionReadback(readExecution);
      if (readExecution?.ok !== true) {
        change.live_readback = { status: "failed" };
        change.status = mutationUnknown || mutationFailed ? change.status : "readback_failed";
        executionFailure = {
          code: readExecution?.error?.code ?? "FX_ASSIGNMENTS_READBACK_FAILED",
          message: readExecution?.error?.message ?? "Independent parameter readback failed.",
          blockers: [blocker(readExecution?.error?.code ?? "FX_ASSIGNMENTS_READBACK_FAILED", readExecution?.error?.message ?? "Independent parameter readback failed.")],
          phase: "readback",
        };
        failedIndex = index;
        readbackWallMs += monoElapsed(readbackStarted, monoNow);
        break;
      }
    } catch (error) {
      change.live_readback = { status: "failed" };
      change.status = mutationUnknown || mutationFailed ? change.status : "readback_failed";
      executionFailure = {
        code: error?.code ?? "FX_ASSIGNMENTS_READBACK_FAILED",
        message: error?.message ?? "Independent parameter readback threw.",
        blockers: [blocker(error?.code ?? "FX_ASSIGNMENTS_READBACK_FAILED", error?.message ?? "Independent parameter readback threw.")],
        phase: "readback",
      };
      failedIndex = index;
      readbackWallMs += monoElapsed(readbackStarted, monoNow);
      break;
    }
    readbackWallMs += monoElapsed(readbackStarted, monoNow);

    const actual = Number(observed?.normalized_value);
    const expected = row.normalized_value;
    const nativeTolerance = Number(writeReadback?.tolerance);
    const tolerance = Number.isFinite(nativeTolerance) && nativeTolerance >= 0 ? nativeTolerance : 0.001;
    const identityOk = observed?.param_index === row.param_index
      && (!row.param_ident || observed?.param_ident === row.param_ident)
      && (writeReadback == null || writeReadback?.param_index === row.param_index)
      && (writeReadback == null || !row.param_ident || writeReadback?.param_ident === row.param_ident)
      && (writeReadback == null || writeReadback?.updated === true || mutationFailed || mutationUnknown);
    const discrete = observed?.is_discrete === true
      || row.is_discrete === true
      || writeReadback?.is_discrete === true
      || writeReadback?.verification_mode === "native_discrete_format";
    const formattedOk = discrete && row.native_target_formatted_value === (observed?.formatted_value ?? null);
    const continuousOk = Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
    const valueOk = discrete ? formattedOk : continuousOk;
    const fields = [];
    if (!identityOk) fields.push("param_identity");
    if (!valueOk) fields.push(discrete ? "formatted_value" : "normalized_value");
    if (fields.length === 0) {
      change.live_readback = { status: "passed", source: "final_read_fx_parameter" };
      if (!mutationFailed && !mutationUnknown) change.status = "applied";
      else change.status = "live_matched_with_mutation_uncertainty";
    } else {
      change.live_readback = { status: "failed", source: "final_read_fx_parameter", fields };
      change.status = mutationUnknown || mutationFailed ? change.status : "readback_failed";
      change.fields = fields;
      change.code = "FX_ASSIGNMENTS_READBACK_MISMATCH";
      if (!mutationFailed && !mutationUnknown) {
        executionFailure = {
          code: "FX_ASSIGNMENTS_READBACK_MISMATCH",
          message: `Final live readback for ${row.id} did not match requested native truth.`,
          blockers: [blocker("FX_ASSIGNMENTS_READBACK_MISMATCH", `Final live readback for ${row.id} mismatched: ${fields.join(",")}.`)],
          phase: "readback",
        };
      } else {
        executionFailure = mutationError ?? {
          code: "FX_ASSIGNMENTS_MUTATION_FAILED",
          message: `Row ${row.id} mutation failed with final mismatch.`,
          blockers: [blocker("FX_ASSIGNMENTS_MUTATION_FAILED", `Row ${row.id} mutation failed with final mismatch.`)],
          phase: "mutation",
        };
      }
      failedIndex = index;
      break;
    }
    if (mutationFailed || mutationUnknown) {
      executionFailure = mutationError;
      failedIndex = index;
      break;
    }
  }
  state.timings.mutation_ms = mutationWallMs;
  state.timings.final_readback_ms = readbackWallMs;

  if (failedIndex >= 0) {
    for (let later = failedIndex + 1; later < state.changes.length; later += 1) {
      state.changes[later] = batchRowChange(prepared[later], {
        status: "not_run",
        mutation: "not_run",
        readback: "not_run",
        index: "not_run",
      });
    }
  }

  const indexStarted = monoTick(monoNow);
  const indexResult = maintainBatchProjectIndex(projectIndexRuntime, state, now);
  state.timings.index_maintenance_ms = monoElapsed(indexStarted, monoNow);
  state.timings.total_ms = monoElapsed(t0, monoNow);
  applyBatchIndexMaintenance(state.changes, indexResult);
  pushStage(
    stages,
    "stock-plugin-execute",
    "runtime_execute",
    executionFailure?.phase === "mutation" ? "failed" : "completed",
    `${state.changes.filter((change) => change.mutation?.status === "completed" || change.status === "applied").length} assignment mutation phase(s) completed.`,
    state.evidenceRefs,
  );
  pushStage(
    stages,
    "stock-plugin-verify",
    "verify",
    executionFailure?.phase === "readback" ? "failed" : "completed",
    `${state.changes.filter((change) => change.live_readback?.status === "passed").length} row(s) passed final live readback.`,
    state.evidenceRefs,
  );
  pushStage(
    stages,
    "stock-plugin-index-update",
    "index_update",
    indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed",
    indexResult.message,
    [],
  );

  if (executionFailure) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: state.changes.some((change) => change.mutation?.status === "completed" || change.status === "applied" || change.status === "live_matched_with_mutation_uncertainty")
        ? "partial_failure"
        : "failed",
      code: executionFailure.code,
      message: executionFailure.message,
      blockers: executionFailure.blockers,
      data: compactBatchData(state, { dry_run: false, unique_fx_count: inventories.size }),
      compact: activeBudget <= ALPHA3_4_D2_MIN_RESPONSE_BUDGET,
    });
  }
  if (indexResult.ok === false) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: "partial_failure",
      code: indexResult.code,
      message: indexResult.message,
      blockers: indexResult.blockers,
      data: compactBatchData(state, { dry_run: false, unique_fx_count: inventories.size }),
      compact: activeBudget <= ALPHA3_4_D2_MIN_RESPONSE_BUDGET,
    });
  }
  pushStage(stages, "stock-plugin-result", "result_project", "completed", "Projected compact multi-FX assignment truth.", state.evidenceRefs);
  return successEnvelope({
    entry, request, startedAt, now, stages, state, activeBudget,
    status: "completed",
    summary: `Applied and verified ${state.changes.filter((change) => change.status === "applied").length} exact FX assignment row(s).`,
    data: compactBatchData(state, { dry_run: false, unique_fx_count: inventories.size }),
    compact: activeBudget <= ALPHA3_4_D2_MIN_RESPONSE_BUDGET,
  });
}

async function resolveExactFxRef({ fxRef, executeAtomic, request, state }) {
  const parsed = parseFxRef(fxRef);
  if (!parsed) {
    return failed("FX_ASSIGNMENTS_FX_REF_UNSUPPORTED", "The FX ref must be an owner-scoped track/take slot ref.");
  }
  try {
    if (state.calls) state.calls.resolve += 1;
    const ownerExecution = await runAtomic(executeAtomic, request, state, parsed.ownerKind === "track"
      ? { id: RESOLVE_TRACK_ID, input: { track_ref: parsed.ownerRef }, refs: {} }
      : { id: RESOLVE_MIDI_TAKE_ID, input: { take_ref: parsed.ownerRef }, refs: {} });
    if (ownerExecution?.ok !== true) {
      return failed(ownerExecution?.error?.code ?? "FX_ASSIGNMENTS_OWNER_RESOLVE_FAILED", ownerExecution?.error?.message ?? "Owner resolve failed.");
    }
    const ownerObject = executionObjectRefs(ownerExecution).find((entry) => entry.kind === parsed.ownerKind);
    if (!ownerObject || ownerObject.ref !== parsed.ownerRef) {
      return failed("FX_ASSIGNMENTS_OWNER_IDENTITY_MISMATCH", "Live owner resolution did not preserve exact identity.");
    }
    if (state.calls) state.calls.resolve += 1;
    const fxExecution = await runAtomic(executeAtomic, request, state, {
      id: RESOLVE_FX_ID,
      input: { owner_kind: parsed.ownerKind, slot_index: parsed.slotIndex },
      refs: parsed.ownerKind === "track"
        ? { track_ref: ownerObject }
        : { take_ref: ownerObject },
    });
    if (fxExecution?.ok !== true) {
      return failed(fxExecution?.error?.code ?? "FX_ASSIGNMENTS_FX_RESOLVE_FAILED", fxExecution?.error?.message ?? "FX resolve failed.");
    }
    const objectRef = executionObjectRefs(fxExecution).find((entry) => entry.kind === "fx");
    if (!isAuthoritativeFxObjectRef(objectRef)) {
      return failed("FX_ASSIGNMENTS_RESOLVE_REF_REQUIRED", `FX resolver for ${fxRef} did not return an authoritative FX object ref.`);
    }
    if (objectRef.ref !== fxRef) {
      return failed("FX_ASSIGNMENTS_FX_IDENTITY_MISMATCH", `Live FX resolution changed identity from ${fxRef} to ${objectRef.ref}.`);
    }
    return { ok: true, fx_ref: objectRef.ref };
  } catch (error) {
    return failed(error?.code ?? "FX_ASSIGNMENTS_FX_RESOLVE_FAILED", error?.message ?? "FX resolve failed.");
  }
}

function parseFxRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("fx:")) return null;
  const lastColon = ref.lastIndexOf(":");
  if (lastColon <= 3) return null;
  const slotIndex = Number(ref.slice(lastColon + 1));
  const ownerRef = ref.slice(3, lastColon);
  const ownerKind = ownerRef.startsWith("track:") ? "track" : ownerRef.startsWith("take:") ? "take" : null;
  if (!ownerKind || !Number.isInteger(slotIndex) || slotIndex < 0) return null;
  return { ownerKind, ownerRef, slotIndex };
}

function isAuthoritativeFxObjectRef(value) {
  return isPlainObject(value)
    && value.kind === "fx"
    && typeof value.ref === "string"
    && value.ref.startsWith("fx:")
    && parseFxRef(value.ref) !== null;
}

function maintainBatchProjectIndex(runtime, state, now) {
  const attempted = state.changes.some((change) => ["completed", "unknown_or_partial", "failed"].includes(change.mutation?.status));
  if (!attempted) return { ok: true, status: "skipped", message: "No mutation was attempted; Project Index scopes were left unchanged.", scopes: [] };
  if (typeof runtime?.invalidateScopes !== "function") {
    return { ok: true, status: "skipped", message: "No Project Index runtime was configured; live readback remains the result authority.", scopes: [] };
  }
  const scopes = ["fx"];
  if (state.calls) state.calls.index += 1;
  let result;
  try {
    result = runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
  } catch (error) {
    state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
    return {
      ok: false,
      status: "failed",
      code: "FX_ASSIGNMENTS_INDEX_INVALIDATION_FAILED",
      message: error?.message ?? "Project Index invalidation threw.",
      blockers: [blocker("FX_ASSIGNMENTS_INDEX_INVALIDATION_FAILED", error?.message ?? "Project Index invalidation threw.")],
      scopes,
    };
  }
  state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
  if (result?.ok === false) {
    return {
      ok: false,
      status: "failed",
      code: result?.blockers?.[0]?.code ?? "FX_ASSIGNMENTS_INDEX_INVALIDATION_FAILED",
      message: result?.blockers?.[0]?.message ?? "Project Index invalidation failed.",
      blockers: result?.blockers ?? [blocker("FX_ASSIGNMENTS_INDEX_INVALIDATION_FAILED", "Project Index invalidation failed.")],
      scopes,
    };
  }
  return { ok: true, status: "completed", message: `Invalidated Project Index scopes once: ${scopes.join(", ")}.`, scopes };
}

function applyBatchIndexMaintenance(changes, indexResult) {
  for (const change of changes) {
    if (change.status === "not_run" || change.mutation?.status === "not_run" || change.mutation?.status === "pending") {
      if (change.index_maintenance?.status === "pending") {
        change.index_maintenance = { status: "not_run", scopes: [] };
      }
      continue;
    }
    if (["completed", "unknown_or_partial", "failed"].includes(change.mutation?.status) || change.status === "applied" || change.status === "live_matched_with_mutation_uncertainty") {
      change.index_maintenance = {
        status: indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed",
        scopes: indexResult.scopes ?? [],
      };
    }
  }
}

function batchRowChange(row, { status, mutation, readback, index, code, fields } = {}) {
  return compactObject({
    id: row.id,
    status,
    mutation: { status: mutation },
    live_readback: { status: readback },
    index_maintenance: { status: index, scopes: [] },
    code,
    fields,
    fx_ref: row.fx_ref,
    param_index: row.param_index,
    normalized_value: row.normalized_value,
  });
}

function compactBatchData(state, { dry_run, unique_fx_count = 0 } = {}) {
  return {
    mode: ALPHA3_4_D2_FX_BATCH_MODE,
    timings: {
      target_resolution_ms: state.timings?.target_resolution_ms ?? 0,
      inventory_hydration_ms: state.timings?.inventory_hydration_ms ?? 0,
      preflight_ms: state.timings?.preflight_ms ?? 0,
      mutation_ms: state.timings?.mutation_ms ?? 0,
      final_readback_ms: state.timings?.final_readback_ms ?? 0,
      index_maintenance_ms: state.timings?.index_maintenance_ms ?? 0,
      total_ms: state.timings?.total_ms ?? 0,
    },
    calls: finalizeCalls(state.calls),
    unique_fx_count,
    dry_run: dry_run === true,
  };
}

function emptyCalls() {
  return { resolve: 0, inventory: 0, preflight: 0, mutation: 0, readback: 0, index: 0, total: 0 };
}

function emptyTimings() {
  return {
    target_resolution_ms: 0,
    inventory_hydration_ms: 0,
    preflight_ms: 0,
    mutation_ms: 0,
    final_readback_ms: 0,
    index_maintenance_ms: 0,
    total_ms: 0,
  };
}

function finalizeCalls(calls) {
  const value = calls ?? emptyCalls();
  return {
    resolve: value.resolve,
    inventory: value.inventory,
    preflight: value.preflight,
    mutation: value.mutation,
    readback: value.readback,
    index: value.index,
    total: value.resolve + value.inventory + value.preflight + value.mutation + value.readback + value.index,
  };
}

function successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status, summary, data, compact = false }) {
  return finalizeEnvelope(buildSuccessEnvelope({
    entry, request, startedAt, completedAt: safeNowIso(now), stages, state, activeBudget, status, summary, data, compact,
  }));
}

function buildSuccessEnvelope({ entry, request, startedAt, completedAt, stages, state, activeBudget, status, summary, data, compact = false }) {
  const useCompact = compact === true || (state.batchMode === true && activeBudget <= ALPHA3_4_D2_MIN_RESPONSE_BUDGET);
  return {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: useCompact ? compactMacroIdentity(entry) : macroIdentity(entry),
    request: requestSummary(request),
    execution: useCompact
      ? { status, started_at: compactIso(startedAt), completed_at: compactIso(completedAt), stage_count: 0, stages: [] }
      : { status, started_at: startedAt, completed_at: completedAt, stage_count: stages.length, stages },
    sqlite: useCompact ? compactSqliteEvidence(state.sqlite) : (state.sqlite ?? sqliteEvidence()),
    result: {
      summary: useCompact ? String(summary ?? "").slice(0, 48) : summary,
      canonical_refs: useCompact ? [] : uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: useCompact
        ? projectCompactBatchChanges(state.changes)
        : clone(state.changes).slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: {
        status: "passed",
        evidence_refs: useCompact ? [] : uniqueStrings(state.evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      },
      data: useCompact ? projectCompactBatchData(data) : data,
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: useCompact
      ? { max_bytes: activeBudget, actual_bytes: 0, truncated: false }
      : { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
}

function failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status = "blocked", code, message, blockers = [], data = {}, compact = false }) {
  const useCompact = compact === true || (state.batchMode === true && activeBudget <= ALPHA3_4_D2_MIN_RESPONSE_BUDGET);
  const verified = state.changes.length > 0
    && state.changes
      .filter((change) => change.mutation?.status === "completed" || change.status === "applied")
      .every((change) => change.live_readback?.status === "passed");
  return finalizeEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: useCompact ? compactMacroIdentity(entry) : macroIdentity(entry),
    request: requestSummary(request),
    execution: useCompact
      ? { status, started_at: compactIso(startedAt), completed_at: compactIso(safeNowIso(now)), stage_count: 0, stages: [] }
      : { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: useCompact ? compactSqliteEvidence(state.sqlite) : (state.sqlite ?? sqliteEvidence()),
    result: {
      summary: useCompact ? String(message ?? "").slice(0, 48) : message,
      canonical_refs: useCompact ? [] : uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: useCompact
        ? projectCompactBatchChanges(state.changes)
        : clone(state.changes).slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: {
        status: verified ? "passed" : status === "partial_failure" ? "failed" : "not_required",
        evidence_refs: useCompact ? [] : (status === "partial_failure" ? uniqueStrings(state.evidenceRefs) : []),
      },
      data: useCompact ? projectCompactBatchData(data) : data,
    },
    blockers: (blockers.length > 0 ? blockers : [blocker(code, message)])
      .slice(0, useCompact ? 1 : MACRO_CONTRACT_CEILINGS.blocker_max_count)
      .map((entry) => useCompact
        ? { code: entry.code, message: String(entry.message ?? "").slice(0, 64), recoverable: entry.recoverable !== false }
        : entry),
    error: {
      code,
      message: useCompact ? String(message ?? "").slice(0, 64) : message,
      recoverable: true,
    },
    recovery: useCompact ? null : {
      undo_policy: "per_stage_undo",
      partial_changes_possible: status === "partial_failure",
      source_media_deleted: false,
      action: status === "partial_failure"
        ? "Inspect row truth and use the reported per-stage REAPER undo entries before retrying only the remaining task."
        : "Fix the typed preflight blocker and retry the bounded request.",
    },
    budget: useCompact
      ? { max_bytes: activeBudget, actual_bytes: 0, truncated: false }
      : { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false },
  });
}

function projectCompactBatchChanges(changes) {
  return (Array.isArray(changes) ? changes : []).slice(0, ALPHA3_4_D2_FX_BATCH_MAX_ROWS).map((change) => {
    const mutation = typeof change.mutation === "string" ? change.mutation : (change.mutation?.status ?? "not_run");
    const readback = typeof change.live_readback === "string"
      ? change.live_readback
      : (change.live_readback?.status ?? "not_run");
    const index = typeof change.index_maintenance === "string"
      ? change.index_maintenance
      : (change.index_maintenance?.status ?? "not_run");
    return compactObject({
      id: change.id,
      status: compactStatusToken(change.status),
      mutation: compactStatusToken(mutation),
      readback: compactStatusToken(readback),
      index: compactStatusToken(index),
      code: change.code ? String(change.code).replace(/^FX_ASSIGNMENTS_/u, "").slice(0, 24) : undefined,
      fields: Array.isArray(change.fields) ? change.fields.slice(0, 4) : undefined,
    });
  });
}

function compactStatusToken(value) {
  switch (value) {
    case "applied": return "ok";
    case "planned": return "plan";
    case "pending": return "pend";
    case "not_run": return "skip";
    case "completed": return "done";
    case "failed": return "fail";
    case "passed": return "pass";
    case "skipped": return "skip";
    case "unknown_or_partial": return "unk";
    case "live_matched_with_mutation_uncertainty": return "unk";
    case "readback_failed": return "rbf";
    default: return String(value ?? "skip").slice(0, 8);
  }
}

function projectCompactBatchData(data) {
  const value = isPlainObject(data) ? data : {};
  return {
    mode: ALPHA3_4_D2_FX_BATCH_MODE,
    timings: {
      target_resolution_ms: Math.round(Number(value.timings?.target_resolution_ms) || 0),
      inventory_hydration_ms: Math.round(Number(value.timings?.inventory_hydration_ms) || 0),
      preflight_ms: Math.round(Number(value.timings?.preflight_ms) || 0),
      mutation_ms: Math.round(Number(value.timings?.mutation_ms) || 0),
      final_readback_ms: Math.round(Number(value.timings?.final_readback_ms) || 0),
      index_maintenance_ms: Math.round(Number(value.timings?.index_maintenance_ms) || 0),
      total_ms: Math.round(Number(value.timings?.total_ms) || 0),
    },
    calls: finalizeCalls(value.calls),
    unique_fx_count: Number(value.unique_fx_count) || 0,
  };
}

function compactMacroIdentity(entry) {
  return {
    id: entry.macro_id,
    program_id: entry.program_id,
    program_version: entry.program_version,
    risk: entry.risk,
  };
}

function macroIdentity(entry) {
  return {
    id: entry.macro_id,
    program_id: entry.program_id,
    program_version: entry.program_version,
    risk: entry.risk,
  };
}

function compactSqliteEvidence(sqlite) {
  if (sqlite?.used === true) {
    return {
      used: true,
      source: "warm_index",
      freshness: sqlite.freshness === "refreshed" ? "refreshed" : "stale",
      snapshot_ref: null,
      revision: null,
      refreshed: sqlite.refreshed === true,
    };
  }
  return {
    used: false,
    source: "not_used",
    freshness: "not_applicable",
    snapshot_ref: null,
    revision: null,
    refreshed: false,
  };
}

function finalizeEnvelope(envelope) {
  const result = structuredClone(envelope);
  const isCompactBatch = Array.isArray(result.execution?.stages)
    && result.execution.stages.length === 0
    && result.result?.data?.mode === ALPHA3_4_D2_FX_BATCH_MODE
    && Number.isInteger(result.budget?.max_bytes)
    && result.budget.max_bytes <= ALPHA3_4_D2_MIN_RESPONSE_BUDGET;
  if (isCompactBatch) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
      if (result.budget.actual_bytes <= result.budget.max_bytes) break;
      result.recovery = null;
      if (result.result?.summary) result.result.summary = String(result.result.summary).slice(0, 24);
      if (result.error?.message) result.error.message = String(result.error.message).slice(0, 24);
      if (Array.isArray(result.blockers)) {
        result.blockers = result.blockers.slice(0, 1).map((entry) => ({
          code: entry.code,
          message: String(entry.message ?? "").slice(0, 24),
          recoverable: entry.recoverable !== false,
        }));
      }
      if (Array.isArray(result.result?.changes)) {
        result.result.changes = result.result.changes.map((change) => {
          const next = { ...change };
          if (Array.isArray(next.fields) && next.fields.length > 4) next.fields = next.fields.slice(0, 4);
          if (next.code && String(next.code).length > 24) next.code = String(next.code).slice(0, 24);
          return next;
        });
      }
    }
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  }
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.4-D2 fx batch envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}

async function runAtomic(executeAtomic, request, state, child) {
  const execution = await executeAtomic({
    ...child,
    context: request.context,
    budget: child.budget ?? request.budget,
    observeProjectIndex: false,
  });
  collectExecution(state, execution);
  return execution;
}

function collectExecution(state, execution) {
  state.evidenceRefs.push(...uniqueStrings([
    execution?.request?.id,
    execution?.template?.id,
    ...(Array.isArray(execution?.result?.artifacts) ? execution.result.artifacts.map((entry) => entry?.ref) : []),
  ]));
}

function executionObjectRefs(execution) {
  const refs = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isPlainObject(value)) {
      if (typeof value.kind === "string" && typeof value.ref === "string") refs.push(value);
      else Object.values(value).forEach(visit);
    }
  };
  visit(execution?.result?.refs);
  visit(execution?.result);
  return refs;
}

function executionReadback(execution) {
  return execution?.result?.readback
    ?? execution?.result?.summary
    ?? execution?.result?.data
    ?? execution?.result
    ?? {};
}

function responseBudget(request) {
  const requested = request?.budget?.max_response_bytes ?? request?.response_budget ?? MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
  if (!Number.isInteger(requested) || requested < ALPHA3_4_D2_MIN_RESPONSE_BUDGET || requested > MACRO_CONTRACT_CEILINGS.envelope_max_bytes) {
    return MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
  }
  return requested;
}

function requestSummary(request) {
  return {
    request_id: typeof request?.context?.request_id === "string"
      ? request.context.request_id
      : `${request?.id ?? "macro.fx.set_controls"}:${request?.context?.created_at ?? "request"}`,
    dry_run: request?.input?.dry_run !== false,
  };
}

function sqliteEvidence(runtime, { used = false, freshness = "not_applicable" } = {}) {
  if (!used) return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  let status = {};
  try {
    status = runtime?.status?.() ?? {};
  } catch {
    status = {};
  }
  return {
    used: true,
    source: "warm_index",
    freshness,
    snapshot_ref: typeof status.snapshot_id === "string" ? status.snapshot_id : null,
    revision: status.revision === null || status.revision === undefined ? null : String(status.revision),
    refreshed: false,
  };
}

function pushStage(stages, id, kind, status, summary, evidenceRefs = []) {
  const row = {
    id,
    kind,
    status,
    summary,
    evidence_refs: uniqueStrings(evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
  };
  const index = stages.findIndex((stage) => stage.id === id);
  if (index >= 0) stages[index] = row;
  else stages.push(row);
}

function monoTick(monoNow) {
  if (typeof monoNow === "function") {
    try {
      const value = monoNow();
      if (typeof value === "number" && Number.isFinite(value)) return value;
    } catch {
      // fall through
    }
  }
  return performance.now();
}

function monoElapsed(started, monoNow) {
  return Math.max(0, monoTick(monoNow) - started);
}

function failed(code, message, blockers) {
  return {
    ok: false,
    code,
    message,
    blockers: blockers ?? [blocker(code, message)],
  };
}

function blocker(code, message, recoverable = true) {
  return { code, message, recoverable };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null && child !== undefined));
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))];
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // fall through
  }
  return new Date().toISOString();
}

function compactIso(value) {
  if (typeof value !== "string") return safeNowIso(() => new Date());
  return value.replace(/\.\d{3}Z$/u, "Z");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export const ALPHA3_4_D2_FX_BATCH_HARD_CEILING = ALPHA3_4_C_PARAMETER_PAGE_HARD_CEILING;

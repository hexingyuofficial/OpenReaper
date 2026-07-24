const BATCH_CONTRACT = "alpha4.shard-c.batch.dispatcher.v1";
const BENCHMARK_CONTRACT = "alpha4.shard-c.batch.benchmark.v1";
const DEFAULT_CHUNK_SIZE = 128;
const CANDIDATE_CEILING = 512;

const BENCHMARK_COUNTS = Object.freeze([1, 8, 64, 128, 300, 400, 512]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function targetRef(index) {
  return `item:guid:{BATCH-${String(index + 1).padStart(4, "0")}}`;
}

function makeTargets(count) {
  return Array.from({ length: count }, (_, index) => targetRef(index));
}

function error(code, message, stage) {
  return { code, message, stage };
}

function emptyTimings() {
  return { validation: 0, preflight: 0, mutation: 0, readback: 0, total: 0 };
}

function createEvidence() {
  return {
    public_calls: [],
    bridge_calls: [],
    native_calls: [],
    request_bytes: 0,
    response_bytes: 0,
    writes: [],
    undo_scopes: [],
    selection_snapshot_reads: 0,
    timings_ms: emptyTimings(),
  };
}

function ensureRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return error("BATCH_SCHEMA_INVALID", "batch request must be an object", "validation");
  }
  const hasTargetRefs = request.target_refs !== undefined;
  const hasTargetSelector = request.target_selector !== undefined;
  if (hasTargetRefs === hasTargetSelector) {
    return error("BATCH_TARGET_SOURCE_INVALID", "supply exactly one target_refs or target_selector", "validation");
  }
  if (hasTargetRefs) {
    if (!Array.isArray(request.target_refs)) {
      return error("BATCH_SCHEMA_INVALID", "target_refs must be an array", "validation");
    }
    if (request.target_refs.length === 0) {
      return error("BATCH_EMPTY_SELECTION", "batch requires at least one target", "validation");
    }
    if (request.target_refs.some((ref) => typeof ref !== "string" || ref.length === 0)) {
      return error("BATCH_SCHEMA_INVALID", "target_refs must contain non-empty strings", "validation");
    }
    if (new Set(request.target_refs).size !== request.target_refs.length) {
      return error("BATCH_DUPLICATE_TARGET", "target_refs must be unique", "validation");
    }
  } else if (request.target_selector?.kind !== "current_selection"
    || request.target_selector?.entity_kind !== "item") {
    return error("BATCH_SELECTOR_INVALID", "benchmark selector must target the current Item selection", "validation");
  }
  if (request.node_graph !== undefined && request.node_graph?.valid !== true) {
    return error("BATCH_NODE_GRAPH_INVALID", "model-supplied node graph is invalid", "validation");
  }
  if (request.expression !== undefined && request.expression !== "identity") {
    return error("BATCH_EXPRESSION_INVALID", "batch expression is not accepted", "validation");
  }
  if (request.response_budget !== undefined
    && (!Number.isInteger(request.response_budget) || request.response_budget <= 0)) {
    return error("BATCH_RESPONSE_BUDGET_INVALID", "response_budget must be a positive integer", "validation");
  }
  if (request.recipe !== undefined) {
    const fixedTemplateId = request.recipe?.fixed_template_id;
    if (typeof fixedTemplateId !== "string" || request.template_id !== fixedTemplateId) {
      return error(
        "RECIPE_FIXED_TEMPLATE_DEPENDENCY_INJECTION_REJECTED",
        "a Recipe batch must use its saved fixed Template dependency",
        "validation",
      );
    }
  }
  return null;
}

function makeResponseSkeleton(request, evidence) {
  return {
    contract: BATCH_CONTRACT,
    request_id: request.request_id ?? "batch-request",
    ok: false,
    status: "blocked",
    target_count: request.target_refs?.length ?? null,
    chunk_count: 0,
    error: null,
    recovery: null,
    evidence,
  };
}

function recordResponse(evidence, response) {
  const payload = {
    contract: response.contract,
    request_id: response.request_id,
    ok: response.ok,
    status: response.status,
    target_count: response.target_count,
    chunk_count: response.chunk_count,
    error: response.error,
    recovery: response.recovery,
  };
  evidence.response_bytes += bytes(payload);
  evidence.timings_ms.total = Object.values(evidence.timings_ms)
    .filter((value) => typeof value === "number")
    .reduce((total, value) => total + value, 0);
}

function fail(response, evidence, failure, recovery = null) {
  response.error = failure;
  response.recovery = recovery ?? {
    posture: "zero_write",
    undo_scope: "not_opened",
    writes: evidence.writes.length,
  };
  recordResponse(evidence, response);
  return response;
}

export function createFakeNativeExecutor(options = {}) {
  const evidence = createEvidence();
  const state = {
    current_selection_snapshot: options.current_selection_snapshot ?? "selection:live-1",
    selected_target_refs: clone(options.selected_target_refs ?? []),
    native_failure_at: options.native_failure_at ?? null,
    preflight_blocker: options.preflight_blocker ?? null,
    ref_drift_before_write: options.ref_drift_before_write ?? false,
    readback_failure: options.readback_failure ?? false,
    native_attempts: 0,
  };

  return {
    evidence,
    recordPublicCall(request) {
      evidence.public_calls.push({
        id: request.macro_id ?? "macro.batch.fake",
        request_id: request.request_id ?? "batch-request",
      });
      evidence.request_bytes += bytes(request);
    },
    bridgeCall(stage, payload, handler) {
      const call = {
        stage,
        chunk_index: payload.chunk_index ?? null,
        target_count: payload.target_count ?? null,
        request_bytes: bytes(payload),
      };
      evidence.bridge_calls.push(call);
      evidence.request_bytes += call.request_bytes;
      const result = handler?.() ?? { ok: true };
      evidence.response_bytes += bytes({ stage, result });
      return result;
    },
    readSelectionSnapshot() {
      return state.current_selection_snapshot;
    },
    resolveBatchTargets(request) {
      if (Array.isArray(request.target_refs)) return { ok: true, refs: [...request.target_refs] };
      evidence.selection_snapshot_reads += 1;
      return {
        ok: true,
        refs: [...state.selected_target_refs],
        selection_snapshot: state.current_selection_snapshot,
      };
    },
    preflight() {
      if (state.preflight_blocker) {
        return { ok: false, blocker: clone(state.preflight_blocker) };
      }
      return { ok: true };
    },
    resolveCanonicalRefs(targetRefs) {
      if (state.ref_drift_before_write) {
        return {
          ok: false,
          blocker: {
            code: "BATCH_REF_DRIFT",
            message: "canonical refs changed before the first write",
          },
        };
      }
      return { ok: true, refs: [...targetRefs] };
    },
    beginUndo() {
      evidence.undo_scopes.push({
        id: "undo:alpha4-shard-c-batch-1",
        status: "open",
        writes: 0,
        recovery: "single_undo_scope",
      });
    },
    executeNative(targetRefValue, chunkIndex) {
      state.native_attempts += 1;
      if (state.native_failure_at === state.native_attempts) {
        const call = {
          stage: "mutation",
          target_ref: targetRefValue,
          chunk_index: chunkIndex,
          status: "failed",
          call_index: state.native_attempts,
        };
        evidence.native_calls.push(call);
        return { ok: false, error: error("BATCH_NATIVE_EXECUTION_FAILED", "fake native executor failed", "mutation") };
      }
      evidence.native_calls.push({
        stage: "mutation",
        target_ref: targetRefValue,
        chunk_index: chunkIndex,
        status: "completed",
        call_index: state.native_attempts,
      });
      evidence.writes.push({ target_ref: targetRefValue, chunk_index: chunkIndex });
      evidence.undo_scopes[0].writes = evidence.writes.length;
      return { ok: true };
    },
    readback(targetRefs) {
      if (state.readback_failure) {
        return {
          ok: false,
          error: error("BATCH_VERIFICATION_READBACK_FAILED", "fake readback did not match expected state", "readback"),
        };
      }
      return { ok: true, count: targetRefs.length };
    },
    closeUndo(status, recovery) {
      const scope = evidence.undo_scopes.at(-1);
      if (scope) {
        scope.status = status;
        scope.recovery = recovery;
      }
    },
  };
}

function projectedResponseBytes(request, targetCount, chunkCount) {
  return bytes({
    contract: BATCH_CONTRACT,
    request_id: request.request_id ?? "batch-request",
    ok: true,
    status: "completed",
    target_count: targetCount,
    chunk_count: chunkCount,
    summary: "compact batch evidence",
  });
}

export function dispatchFakeBatch(request, {
  nativeExecutor = createFakeNativeExecutor(),
  chunkSize = DEFAULT_CHUNK_SIZE,
  candidateCeiling = CANDIDATE_CEILING,
} = {}) {
  const evidence = nativeExecutor.evidence;
  const response = makeResponseSkeleton(request ?? {}, evidence);
  nativeExecutor.recordPublicCall(request ?? {});

  const validationStart = 1;
  const validationError = ensureRequest(request);
  evidence.timings_ms.validation = validationStart;
  if (validationError) return fail(response, evidence, validationError);

  evidence.timings_ms.preflight = 2;
  let targetRefs = [];
  const preflightResult = nativeExecutor.bridgeCall("preflight", {
    stage: "preflight",
    target_source: request.target_selector?.kind ?? "explicit_refs",
  }, () => {
    const resolvedTargets = nativeExecutor.resolveBatchTargets(request);
    if (!resolvedTargets.ok) return resolvedTargets;
    targetRefs = resolvedTargets.refs;
    if (targetRefs.length === 0) {
      return {
        ok: false,
        blocker: {
          code: "BATCH_EMPTY_SELECTION",
          message: "batch requires at least one target",
        },
      };
    }
    if (targetRefs.length > candidateCeiling) {
      return {
        ok: false,
        blocker: {
          code: "BATCH_CANDIDATE_CEILING_EXCEEDED",
          message: `candidate count ${targetRefs.length} exceeds ceiling ${candidateCeiling}`,
        },
      };
    }
    if (request.selection_snapshot !== undefined
      && request.selection_snapshot !== nativeExecutor.readSelectionSnapshot()) {
      return {
        ok: false,
        blocker: {
          code: "BATCH_STALE_SELECTION",
          message: "selection snapshot changed before the first write",
        },
      };
    }
    const explicitPreflight = nativeExecutor.preflight();
    if (!explicitPreflight.ok) return explicitPreflight;
    return nativeExecutor.resolveCanonicalRefs(targetRefs);
  });
  if (!preflightResult.ok) {
    return fail(response, evidence, {
      ...preflightResult.blocker,
      stage: preflightResult.blocker.stage ?? "preflight",
    }, {
      posture: "zero_write",
      undo_scope: "not_opened",
      writes: 0,
    });
  }

  response.target_count = targetRefs.length;
  const chunkCount = Math.ceil(targetRefs.length / chunkSize);
  response.chunk_count = chunkCount;
  const expectedResponseBytes = projectedResponseBytes(request, targetRefs.length, chunkCount);
  if (request.response_budget !== undefined && expectedResponseBytes > request.response_budget) {
    return fail(response, evidence, error(
      "BATCH_RESPONSE_BUDGET_EXCEEDED",
      `projected response ${expectedResponseBytes} exceeds budget ${request.response_budget}`,
      "preflight",
    ));
  }

  nativeExecutor.beginUndo();
  const chunks = [];
  for (let offset = 0; offset < targetRefs.length; offset += chunkSize) {
    const rows = targetRefs.slice(offset, offset + chunkSize);
    const chunkIndex = chunks.length;
    chunks.push(rows.length);
    const mutationResult = nativeExecutor.bridgeCall("mutation", {
      stage: "mutation",
      chunk_index: chunkIndex,
      target_count: rows.length,
    }, () => {
      for (const ref of rows) {
        const nativeResult = nativeExecutor.executeNative(ref, chunkIndex);
        if (!nativeResult.ok) return nativeResult;
      }
      return { ok: true, count: rows.length };
    });
    evidence.timings_ms.mutation += rows.length;
    if (!mutationResult.ok) {
      nativeExecutor.closeUndo("partial_failure", "single_undo_can_revert_partial_writes");
      response.status = "partial_failure";
      return fail(response, evidence, mutationResult.error, {
        posture: "partial_writes_recoverable_with_single_undo",
        undo_scope: "single_undo_can_revert_partial_writes",
        writes: evidence.writes.length,
      });
    }
  }

  const readbackResult = nativeExecutor.bridgeCall("readback", {
    stage: "readback",
    target_count: targetRefs.length,
  }, () => nativeExecutor.readback(targetRefs));
  evidence.timings_ms.readback = 1;
  if (!readbackResult.ok) {
    nativeExecutor.closeUndo("verification_failed", "single_undo_can_revert_verified_failure");
    response.status = "failed";
    return fail(response, evidence, readbackResult.error, {
      posture: "writes_require_single_undo_recovery",
      undo_scope: "single_undo_can_revert_verified_failure",
      writes: evidence.writes.length,
    });
  }

  nativeExecutor.closeUndo("completed", "none_required");
  response.ok = true;
  response.status = "completed";
  response.error = null;
  response.recovery = { posture: "completed", undo_scope: "single_undo_scope", writes: evidence.writes.length };
  recordResponse(evidence, response);
  return response;
}

export function runBatchBenchmark({ counts = BENCHMARK_COUNTS, chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  const results = counts.map((count) => {
    const executor = createFakeNativeExecutor({ selected_target_refs: makeTargets(count) });
    const response = dispatchFakeBatch({
      request_id: `benchmark-${count}`,
      macro_id: "macro.items.apply",
      template_id: "template.items.set_item_volume",
      target_selector: { kind: "current_selection", entity_kind: "item" },
    }, { nativeExecutor: executor, chunkSize });
    const { evidence } = executor;
    return {
      target_count: count,
      status: response.status,
      chunk_count: response.chunk_count,
      public_calls: evidence.public_calls.length,
      bridge_calls: evidence.bridge_calls.length,
      bridge_stages: evidence.bridge_calls.map((call) => call.stage),
      native_calls: evidence.native_calls.length,
      writes: evidence.writes.length,
      undo_scopes: evidence.undo_scopes.length,
      selection_snapshot_reads: evidence.selection_snapshot_reads,
      request_bytes: evidence.request_bytes,
      response_bytes: evidence.response_bytes,
      timings_ms: clone(evidence.timings_ms),
    };
  });

  const ceilingExecutor = createFakeNativeExecutor({ selected_target_refs: makeTargets(CANDIDATE_CEILING + 1) });
  const ceilingResponse = dispatchFakeBatch({
    request_id: "benchmark-513",
    macro_id: "macro.items.apply",
    template_id: "template.items.set_item_volume",
    target_selector: { kind: "current_selection", entity_kind: "item" },
  }, { nativeExecutor: ceilingExecutor, chunkSize });
  results.push({
    target_count: CANDIDATE_CEILING + 1,
    status: ceilingResponse.status,
    chunk_count: ceilingResponse.chunk_count,
    public_calls: ceilingExecutor.evidence.public_calls.length,
    bridge_calls: ceilingExecutor.evidence.bridge_calls.length,
    bridge_stages: ceilingExecutor.evidence.bridge_calls.map((call) => call.stage),
    native_calls: ceilingExecutor.evidence.native_calls.length,
    writes: ceilingExecutor.evidence.writes.length,
    undo_scopes: ceilingExecutor.evidence.undo_scopes.length,
    selection_snapshot_reads: ceilingExecutor.evidence.selection_snapshot_reads,
    request_bytes: ceilingExecutor.evidence.request_bytes,
    response_bytes: ceilingExecutor.evidence.response_bytes,
    timings_ms: clone(ceilingExecutor.evidence.timings_ms),
    error_code: ceilingResponse.error?.code ?? null,
  });

  return {
    contract: BENCHMARK_CONTRACT,
    mode: "injected_fake_native_executor",
    timing_semantics: "deterministic_fake_harness_units_not_live_wall_clock",
    live_reaper: false,
    shared_runtime_dispatcher: false,
    public_target_mode: "current_selection_without_agent_guid_inventory",
    chunk_size: chunkSize,
    candidate_ceiling: CANDIDATE_CEILING,
    results,
  };
}

export const ALPHA4_SHARD_C_BATCH_CONTRACT = BATCH_CONTRACT;
export const ALPHA4_SHARD_C_BATCH_BENCHMARK_CONTRACT = BENCHMARK_CONTRACT;
export const ALPHA4_SHARD_C_BATCH_COUNTS = BENCHMARK_COUNTS;
export const ALPHA4_SHARD_C_BATCH_CHUNK_SIZE = DEFAULT_CHUNK_SIZE;
export const ALPHA4_SHARD_C_BATCH_CANDIDATE_CEILING = CANDIDATE_CEILING;

export const EXECUTION_PERFORMANCE_CONTRACT = "openreaper.execution_performance.v1";
export const INTERNAL_EXECUTION_SPEED_GATE_MS = 30_000;

export const EXECUTION_PERFORMANCE_PHASES = Object.freeze([
  "validation",
  "live_preflight",
  "transport",
  "mutation",
  "native_mutation",
  "readback",
  "evidence",
  "undo",
  "total",
]);

export const EXECUTION_PERFORMANCE_COUNTERS = Object.freeze([
  "transport_call_count",
  "native_mutation_count",
  "readback_count",
  "evidence_count",
  "undo_call_count",
  "batch_count",
  "job_count",
]);

export function createExecutionPerformance(existing = null) {
  const phaseTimings = Object.fromEntries(EXECUTION_PERFORMANCE_PHASES.map((phase) => [
    phase,
    nonNegativeMilliseconds(existing?.phase_timings_ms?.[phase]),
  ]));
  return {
    contract: EXECUTION_PERFORMANCE_CONTRACT,
    gate_ms: INTERNAL_EXECUTION_SPEED_GATE_MS,
    gate_mode: "internal_acceptance_only",
    runtime_cancellation: false,
    phase_timings_ms: phaseTimings,
    counters: Object.fromEntries(EXECUTION_PERFORMANCE_COUNTERS.map((counter) => [
      counter,
      nonNegativeMilliseconds(existing?.counters?.[counter]),
    ])),
    measurement_sources: {
      runtime: true,
      bridge: existing?.measurement_sources?.bridge === true,
    },
    total_ms: nonNegativeMilliseconds(existing?.total_ms),
    gate_ok: existing?.gate_ok === undefined ? null : existing.gate_ok === true,
  };
}

export function addExecutionPerformancePhase(performance, phase, durationMs) {
  if (!performance || !Object.hasOwn(performance.phase_timings_ms, phase)) return;
  performance.phase_timings_ms[phase] += nonNegativeMilliseconds(durationMs);
}

export function addExecutionPerformanceCounter(performance, counter, count = 1) {
  if (!performance || !Object.hasOwn(performance.counters, counter)) return;
  performance.counters[counter] += nonNegativeMilliseconds(count);
}

export function recordExecutionPerformanceBridgeResult(performance, preparedRequest, bridgeResult, options = {}) {
  // Keep the two-argument form usable for small adapters that only have a bridge result.
  if (bridgeResult === undefined) {
    bridgeResult = preparedRequest;
    preparedRequest = null;
  }
  if (!performance || !bridgeResult || typeof bridgeResult !== "object") return;
  performance.measurement_sources.bridge = true;
  addExecutionPerformanceCounter(performance, "transport_call_count", 1);

  const result = bridgeResult.result ?? {};
  const timings = bridgeTimings(bridgeResult);
  addBridgeTiming(performance, "live_preflight", timings.preflight_ms);
  addBridgeTiming(performance, "transport", timings.transport_ms ?? options.dispatch_elapsed_ms);
  addBridgeTiming(performance, "mutation", timings.mutation_ms);
  addBridgeTiming(performance, "native_mutation", timings.native_mutation_ms ?? timings.mutation_ms);
  addBridgeTiming(performance, "readback", timings.readback_ms ?? timings.final_readback_ms);
  addBridgeTiming(performance, "evidence", timings.evidence_ms);

  const mutationCount = firstNonNegativeInteger(
    timings.native_mutation_count,
    result?.data?.outcome?.mutation?.completed_count,
    result?.mutation?.completed_count,
    bridgeResult?.error?.details?.mutation?.completed_count,
  );
  if (mutationCount !== null) {
    addExecutionPerformanceCounter(performance, "native_mutation_count", mutationCount);
  } else if (bridgeResult.ok === true && preparedRequest?.pack?.risk !== "read") {
    addExecutionPerformanceCounter(performance, "native_mutation_count", 1);
  }

  const readback = result.readback ?? null;
  const verificationPassed = bridgeResult.verification?.status === "passed"
    || result.verification?.status === "passed"
    || bridgeResult.ok === true && readback !== null;
  const readbackCount = firstNonNegativeInteger(
    timings.native_readback_count,
    timings.readback_count,
  );
  if (readbackCount !== null && verificationPassed) {
    addExecutionPerformanceCounter(performance, "readback_count", readbackCount);
  } else if (verificationPassed) {
    addExecutionPerformanceCounter(performance, "readback_count", 1);
  }

  const evidenceRefs = [
    ...(Array.isArray(bridgeResult.verification?.evidence_refs) ? bridgeResult.verification.evidence_refs : []),
    ...(Array.isArray(result.artifacts) ? result.artifacts : []),
  ];
  const evidenceCount = firstNonNegativeInteger(timings.evidence_count);
  if (evidenceCount !== null) {
    addExecutionPerformanceCounter(performance, "evidence_count", evidenceCount);
  } else if (evidenceRefs.length > 0) {
    addExecutionPerformanceCounter(performance, "evidence_count", 1);
  }

  const batchCount = firstNonNegativeInteger(
    timings.batch_count,
    timings.batches,
    timings.chunks,
  );
  if (batchCount !== null) addExecutionPerformanceCounter(performance, "batch_count", batchCount);

  const jobCount = firstNonNegativeInteger(
    timings.job_count,
    timings.jobs,
    Array.isArray(result.jobs) ? result.jobs.length : null,
  );
  if (jobCount !== null) addExecutionPerformanceCounter(performance, "job_count", jobCount);
}

export function finishExecutionPerformance(performance, totalMs) {
  const duration = nonNegativeMilliseconds(totalMs);
  performance.total_ms = duration;
  performance.phase_timings_ms.total = duration;
  performance.gate_ok = duration < performance.gate_ms;
  return performance;
}

export function attachExecutionPerformance(response, performance, totalMs) {
  const target = performance ?? createExecutionPerformance();
  finishExecutionPerformance(target, totalMs);
  return Object.freeze({
    ...(response && typeof response === "object" ? response : {}),
    performance: snapshotExecutionPerformance(target),
  });
}

export function snapshotExecutionPerformance(performance) {
  const source = performance ?? createExecutionPerformance();
  return Object.freeze({
    contract: source.contract,
    gate_ms: source.gate_ms,
    gate_mode: source.gate_mode,
    runtime_cancellation: source.runtime_cancellation,
    phase_timings_ms: Object.freeze(Object.fromEntries(EXECUTION_PERFORMANCE_PHASES.map((phase) => [
      phase,
      nonNegativeMilliseconds(source.phase_timings_ms?.[phase]),
    ]))),
    counters: Object.freeze(Object.fromEntries(EXECUTION_PERFORMANCE_COUNTERS.map((counter) => [
      counter,
      nonNegativeMilliseconds(source.counters?.[counter]),
    ]))),
    measurement_sources: Object.freeze({
      runtime: source.measurement_sources?.runtime === true,
      bridge: source.measurement_sources?.bridge === true,
    }),
    total_ms: nonNegativeMilliseconds(source.total_ms),
    gate_ok: source.gate_ok === null ? null : source.gate_ok === true,
  });
}

function nonNegativeMilliseconds(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function firstNonNegativeInteger(...values) {
  for (const value of values) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

function addBridgeTiming(performance, phase, value) {
  if (Number.isFinite(value) && value >= 0) addExecutionPerformancePhase(performance, phase, value);
}

function bridgeTimings(bridgeResult) {
  const result = bridgeResult.result ?? {};
  const candidates = [
    result?.summary?.batch_timings,
    result?.summary?.timings,
    result?.batch_timings,
    result?.timings,
    result?.data?.summary?.batch_timings,
    result?.data?.summary?.timings,
    result?.data?.batch_timings,
    result?.data?.timings,
    result?.data?.outcome?.batch_timings,
    result?.data?.outcome?.timings,
  ];
  return Object.assign({}, ...candidates.filter((candidate) => candidate && typeof candidate === "object"));
}

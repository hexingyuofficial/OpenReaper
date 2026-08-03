function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resultData(value) {
  const result = value?.result;
  if (isObject(result?.data)) return result.data;
  if (isObject(result?.summary)) return result.summary;
  if (isObject(result?.readback)) return result.readback;
  if (isObject(result)) return result;
  return isObject(value) ? value : {};
}

function evidenceZeroWrite(value, data) {
  if (data.zero_write === true || value?.zero_write === true) return true;
  if (value?.error?.details?.zero_write === true) return true;
  if (Array.isArray(value?.blockers) && value.blockers.some((entry) => entry?.details?.zero_write === true)) return true;
  const messages = [value?.error?.message, ...(value?.blockers ?? []).map((entry) => entry?.message)]
    .filter((entry) => typeof entry === "string");
  return messages.some((entry) => /zero[_ -]?write\s*[:=]\s*true/i.test(entry));
}

export function summarizeS3Result(value) {
  const row = value ?? {};
  const data = resultData(row);
  const aggregate = Array.isArray(data.aggregate_readback)
    ? data.aggregate_readback
    : Array.isArray(row.aggregate_readback) ? row.aggregate_readback : [];
  return {
    ok: row.ok ?? false,
    execution_status: row.execution?.status ?? row.status ?? null,
    error_code: row.error?.code ?? row.error_code ?? null,
    error_message: row.error?.message ?? row.error_message ?? null,
    reason_code: row.error?.details?.reason_code ?? row.reason_code ?? null,
    zero_write: evidenceZeroWrite(row, data),
    status: aggregate[0]?.status ?? data.status ?? row.status ?? null,
    code: aggregate[0]?.code ?? data.code ?? null,
  };
}

export function buildS3AudioRunRow(value, { label, refs, elapsedMs }) {
  const data = resultData(value);
  const aggregateReadback = Array.isArray(data.aggregate_readback) ? data.aggregate_readback : [];
  const artifactRefs = Array.isArray(data.artifact_refs)
    ? data.artifact_refs
    : Array.isArray(value?.result?.verification?.evidence_refs) ? value.result.verification.evidence_refs : [];
  return {
    label,
    ok: value?.ok === true,
    elapsed_ms: elapsedMs,
    target_count: data.target_count ?? refs.length,
    returned_target_count: data.returned_target_count ?? data.aggregate_readback_count ?? aggregateReadback.length,
    plan_hash: data.plan_hash ?? value?.result?.plan_hash ?? null,
    zero_write: evidenceZeroWrite(value, data),
    undo_opened: data.undo_opened ?? data.undo?.undo_opened ?? false,
    undo_closed: data.undo_closed ?? data.undo?.undo_closed ?? false,
    source_media_deleted: data.source_media_deleted ?? false,
    aggregate_readback_count: data.aggregate_readback_count ?? aggregateReadback.length,
    artifact_refs: artifactRefs,
    timings: data.timings ?? data.batch_timings ?? {},
    native_counters: data.native_counters ?? {},
    status: value?.execution?.status ?? null,
    error_code: value?.error?.code ?? null,
    reason_code: value?.error?.details?.reason_code ?? null,
    aggregate_readback: aggregateReadback,
    before_item: null,
  };
}

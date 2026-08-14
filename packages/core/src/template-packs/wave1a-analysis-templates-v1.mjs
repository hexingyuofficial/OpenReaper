import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_ANALYSIS_TEMPLATE_IDS = Object.freeze([
  "template.analysis.analyze_items_batch",
  "template.analysis.measure_item_rms",
  "template.analysis.measure_item_peaks",
  "template.analysis.detect_item_silence",
  "template.analysis.detect_item_transients",
]);

export const WAVE1A_ANALYSIS_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.analysis.analyze_items_batch",
    title: "Analyze Items batch",
    summary: "Read compact Item/take truth and optional native audio metrics for 1-128 exact or selected Items in one aggregate batch.",
    pack: "analysis",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "item_analysis_batch",
    tags: ["analysis", "audio", "items", "batch", "aggregate"],
    bridge: {
      operation_family: "run_job",
      operation_name: "analysis.analyze_items_batch",
      capability: "analysis.analyze_items_batch",
      idempotency: "none",
      timeout_ms: 120_000,
    },
    inputSchema: objectSchema({
      profile: { type: "string", enum: ["quick", "audio", "timing", "full"] },
      target: { type: "string", enum: ["selected", "exact"] },
      target_refs: { type: "array", minItems: 1, maxItems: 128, items: { type: "string" } },
      limit: { type: "integer", minimum: 1, maximum: 128 },
      include_plan_facts: { type: "boolean" },
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
    }, ["profile", "target", "limit"]),
    outputSchema: objectSchema({
      profile: { type: "string" },
      target_scope: { type: "string" },
      target_count: { type: "integer" },
      item_refs: { type: "array" },
      items: { type: "array" },
      plan_facts: { type: "array" },
      batch_timings: { type: "object" },
      mutation_occurred: { const: false },
    }, ["profile", "target_scope", "target_count", "item_refs", "items", "batch_timings", "mutation_occurred"]),
    refs: {
      input: [{ name: "item_ref", kind: "item", required: false, summary: "Optional exact Item refs analyzed by the batch." }],
      output: [{ name: "item_ref", kind: "item", required: false, summary: "Complete exact Item refs represented by the aggregate rows." }],
    },
    artifacts: { mode: "none", input: [], output: [] },
    expectedDelta: {
      kind: "read",
      summary: "Reads bounded Item/take and native source/pre-FX analysis truth without mutation.",
      entities: [{ entity_kind: "item", action: "read", summary: "Complete target Item rows are read once and returned as aggregate truth." }],
      idempotent: true,
    },
    verification: { mode: "none", checks: [] },
    examples: [{
      name: "quick_selected_items_batch",
      summary: "Read up to 128 selected Item/take summaries in one native batch.",
      input: { profile: "quick", target: "selected", limit: 128 },
    }],
  },
  analysisArtifactDescriptor({
    id: "template.analysis.measure_item_rms",
    title: "Measure item RMS",
    summary: "Measure source-region RMS and LUFS-I for one item's active take with explicit native measurement evidence.",
    entity_kind: "rms",
    tags: ["analysis", "audio", "rms", "artifact"],
    operation_name: "analysis.measure_item_rms",
    capability: "analysis.measure_item_rms",
    artifact_name: "item_rms_report",
    artifact_schema: "analysis.item_rms.v1",
    artifact_summary: "RMS dBFS measurement artifact for one item.",
    inputProperties: {
      max_analysis_seconds: { type: "number" },
    },
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_rms.v1" },
      rms_dbfs: { type: "number" },
      rms_linear: { type: "number" },
      lufs_i: { type: "number" },
      duration_seconds: { type: "number" },
      sample_frames: { type: "integer" },
      measurement_basis: { type: "string" },
      sample_rate: { type: "integer" },
      channels: { type: "integer" },
      coverage: { type: "object" },
      truncated: { type: "boolean" },
    },
    expectedSummary: "Emits an RMS analysis artifact without editing project data.",
    expectedEntitySummary: "RMS measurement artifact is produced.",
    examples: [
      {
        name: "measure_selected_item_rms",
        summary: "Measure RMS for a resolved item over its full length.",
        input: {},
      },
      {
        name: "measure_item_rms_range",
        summary: "Measure RMS for a bounded item-local time range.",
        input: { start_seconds: 0, end_seconds: 1.5 },
      },
    ],
  }),
  analysisArtifactDescriptor({
    id: "template.analysis.measure_item_peaks",
    title: "Measure item peaks",
    summary: "Measure one item's sample peaks over an optional item-local time range and emit an analysis artifact.",
    entity_kind: "peak",
    tags: ["analysis", "audio", "peak", "artifact"],
    operation_name: "analysis.measure_item_peaks",
    capability: "analysis.measure_item_peaks",
    artifact_name: "item_peaks_report",
    artifact_schema: "analysis.item_peaks.v1",
    artifact_summary: "Sample peak measurement artifact for one item.",
    inputProperties: {
      max_analysis_seconds: { type: "number" },
    },
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_peaks.v1" },
      abs_peak_dbfs: { type: "number" },
      abs_peak_linear: { type: "number" },
      positive_peak_linear: { type: "number" },
      negative_peak_linear: { type: "number" },
      source_sample_peak_dbfs: { type: "number" },
      true_peak_dbfs: { type: "number" },
      true_peak_available: { type: "boolean" },
      per_channel: { type: "array" },
      measurement_basis: { type: "string" },
      sample_rate: { type: "integer" },
      channels: { type: "integer" },
      coverage: { type: "object" },
      truncated: { type: "boolean" },
    },
    expectedSummary: "Emits a sample-peak analysis artifact without editing project data.",
    expectedEntitySummary: "Sample peak measurement artifact is produced.",
    examples: [
      {
        name: "measure_item_peaks",
        summary: "Measure sample peaks for a resolved item.",
        input: {},
      },
      {
        name: "measure_item_peaks_range",
        summary: "Measure sample peaks for an item-local time range.",
        input: { start_seconds: 0.25, end_seconds: 2 },
      },
    ],
  }),
  analysisArtifactDescriptor({
    id: "template.analysis.detect_item_silence",
    title: "Detect item silence",
    summary: "Detect fixed-threshold silence segments for one item and emit bounded analysis facts.",
    entity_kind: "silence",
    tags: ["analysis", "audio", "silence", "artifact"],
    operation_name: "analysis.detect_item_silence",
    capability: "analysis.detect_item_silence",
    artifact_name: "item_silence_report",
    artifact_schema: "analysis.item_silence.v1",
    artifact_summary: "Bounded silence detection artifact for one item.",
    inputProperties: {
      max_analysis_seconds: { type: "number" },
      silence_threshold_dbfs: { type: "number" },
      min_silence_ms: { type: "number" },
      max_segments: { type: "integer" },
    },
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_silence.v1" },
      segment_count: { type: "integer" },
      total_silence_seconds: { type: "number" },
      truncated: { type: "boolean" },
      threshold_dbfs: { type: "number" },
      total_detected: { type: "integer" },
      returned_count: { type: "integer" },
      measurement_basis: { type: "string" },
      sample_rate: { type: "integer" },
      channels: { type: "integer" },
      coverage: { type: "object" },
    },
    expectedSummary: "Emits a silence analysis artifact without splitting or trimming items.",
    expectedEntitySummary: "Silence detection artifact is produced.",
    examples: [
      {
        name: "detect_item_silence",
        summary: "Detect silence in one resolved item.",
        input: {},
      },
      {
        name: "detect_item_silence_range",
        summary: "Detect silence inside an item-local time range.",
        input: { start_seconds: 0, end_seconds: 4 },
      },
    ],
  }),
  analysisArtifactDescriptor({
    id: "template.analysis.detect_item_transients",
    title: "Detect item transients",
    summary: "Detect bounded heuristic onset facts for one item and emit an analysis artifact.",
    entity_kind: "transient",
    tags: ["analysis", "audio", "transient", "artifact"],
    operation_name: "analysis.detect_item_transients",
    capability: "analysis.detect_item_transients",
    artifact_name: "item_transients_report",
    artifact_schema: "analysis.item_transients.v1",
    artifact_summary: "Bounded transient detection artifact for one item.",
    inputProperties: {
      max_analysis_seconds: { type: "number" },
      transient_delta_linear: { type: "number" },
      min_transient_gap_ms: { type: "number" },
      max_transients: { type: "integer" },
    },
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_transients.v1" },
      transient_count: { type: "integer" },
      total_detected: { type: "integer" },
      truncated: { type: "boolean" },
      first_transient_time: { type: "number" },
      last_transient_time: { type: "number" },
      transient_delta_linear: { type: "number" },
      measurement_basis: { type: "string" },
      sample_rate: { type: "integer" },
      channels: { type: "integer" },
      coverage: { type: "object" },
    },
    expectedSummary: "Emits a transient analysis artifact without moving or splitting items.",
    expectedEntitySummary: "Transient detection artifact is produced.",
    examples: [
      {
        name: "detect_item_transients",
        summary: "Detect transient facts for one resolved item.",
        input: {},
      },
      {
        name: "detect_item_transients_range",
        summary: "Detect transients inside an item-local time range.",
        input: { start_seconds: 0.5, end_seconds: 3 },
      },
    ],
  }),
]);

export function createWave1AAnalysisTemplates() {
  return cloneJson(WAVE1A_ANALYSIS_TEMPLATES);
}

function analysisArtifactDescriptor(options) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: "analysis",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: options.entity_kind,
    tags: options.tags,
    bridge: {
      operation_family: "run_job",
      operation_name: options.operation_name,
      capability: options.capability,
      idempotency: "none",
      timeout_ms: 120_000,
    },
    inputSchema: objectSchema({
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      ...(options.inputProperties ?? {}),
    }, []),
    outputSchema: objectSchema(options.outputProperties, ["artifact_ref"]),
    refs: {
      input: [
        {
          name: "item_ref",
          kind: "item",
          required: true,
          summary: "Item ref whose active take is analyzed.",
        },
      ],
      output: [
        {
          name: "artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Analysis artifact emitted by this template.",
        },
      ],
    },
    artifacts: {
      mode: "produces",
      input: [],
      output: [
        {
          name: options.artifact_name,
          schema: options.artifact_schema,
          owner_pack: "analysis",
          summary: options.artifact_summary,
        },
      ],
    },
    expectedDelta: {
      kind: "artifact",
      summary: options.expectedSummary,
      entities: [
        {
          entity_kind: "analysis_artifact",
          action: "emit",
          summary: options.expectedEntitySummary,
        },
      ],
      idempotent: false,
    },
    verification: {
      mode: "none",
      checks: [],
    },
    examples: options.examples,
  };
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

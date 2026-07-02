import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_ANALYSIS_TEMPLATE_IDS = Object.freeze([
  "template.analysis.measure_item_rms",
  "template.analysis.measure_item_peaks",
  "template.analysis.detect_item_silence",
  "template.analysis.detect_item_transients",
]);

export const WAVE1A_ANALYSIS_TEMPLATES = deepFreeze([
  analysisArtifactDescriptor({
    id: "template.analysis.measure_item_rms",
    title: "Measure item RMS",
    summary: "Measure one item's RMS dBFS over an optional item-local time range and emit an analysis artifact.",
    entity_kind: "rms",
    tags: ["analysis", "audio", "rms", "artifact"],
    operation_name: "analysis.measure_item_rms",
    capability: "analysis.measure_item_rms",
    artifact_name: "item_rms_report",
    artifact_schema: "analysis.item_rms.v1",
    artifact_summary: "RMS dBFS measurement artifact for one item.",
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_rms.v1" },
      rms_dbfs: { type: "number" },
      rms_linear: { type: "number" },
      duration_seconds: { type: "number" },
      sample_frames: { type: "integer" },
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
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_peaks.v1" },
      abs_peak_dbfs: { type: "number" },
      abs_peak_linear: { type: "number" },
      positive_peak_linear: { type: "number" },
      negative_peak_linear: { type: "number" },
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
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_silence.v1" },
      segment_count: { type: "integer" },
      total_silence_seconds: { type: "number" },
      truncated: { type: "boolean" },
      threshold_dbfs: { type: "number" },
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
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.item_transients.v1" },
      transient_count: { type: "integer" },
      total_detected: { type: "integer" },
      truncated: { type: "boolean" },
      first_transient_time: { type: "number" },
      last_transient_time: { type: "number" },
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

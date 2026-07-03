import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const CRITICAL_ANALYSIS_TEMPLATE_IDS = Object.freeze([
  "template.analysis.detect_loop_candidates",
  "template.analysis.measure_loop_click_risk",
  "template.analysis.create_loop_qa_report",
]);

export const CRITICAL_ANALYSIS_TEMPLATES = deepFreeze([
  analysisArtifactDescriptor({
    id: "template.analysis.detect_loop_candidates",
    title: "Detect loop candidates",
    summary: "Detect bounded loop-candidate facts for one item and emit a canonical analysis artifact.",
    entity_kind: "loop_candidates",
    tags: ["analysis", "audio", "loop", "artifact"],
    operation_name: "analysis.detect_loop_candidates",
    capability: "analysis.detect_loop_candidates",
    inputProperties: {
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      min_loop_seconds: { type: "number" },
      max_loop_seconds: { type: "number" },
      max_candidates: { type: "integer" },
    },
    refs: refs({
      input: [
        ref("item_ref", "item", true, "Item ref whose active take is analyzed for loop-candidate facts."),
      ],
      output: [
        ref("artifact_ref", "artifact", true, "Canonical analysis artifact ref for loop-candidate facts."),
      ],
    }),
    artifactInputs: [],
    artifactOutput: artifact(
      "loop_candidates",
      "analysis.loop_candidates.v1",
      "Bounded loop-candidate analysis artifact.",
    ),
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.loop_candidates.v1" },
      candidate_count: { type: "integer" },
      analyzed_seconds: { type: "number" },
      truncated: { type: "boolean" },
    },
    expectedSummary: "Emits loop-candidate analysis facts without editing project data.",
    expectedEntitySummary: "Loop-candidate analysis artifact is produced.",
    examples: [
      {
        name: "detect_loop_candidates",
        summary: "Detect bounded loop-candidate facts for a resolved item.",
        input: {},
      },
      {
        name: "detect_loop_candidates_range",
        summary: "Detect loop-candidate facts inside an item-local range.",
        input: { start_seconds: 0, end_seconds: 8, max_candidates: 12 },
      },
    ],
  }),
  analysisArtifactDescriptor({
    id: "template.analysis.measure_loop_click_risk",
    title: "Measure loop click risk",
    summary: "Measure bounded boundary-risk facts for loop candidates and emit a canonical analysis artifact.",
    entity_kind: "loop_click_risk",
    tags: ["analysis", "audio", "loop", "artifact"],
    operation_name: "analysis.measure_loop_click_risk",
    capability: "analysis.measure_loop_click_risk",
    inputProperties: {
      boundary_window_ms: { type: "integer" },
      max_candidates: { type: "integer" },
    },
    refs: refs({
      input: [
        ref("item_ref", "item", true, "Item ref whose active take boundaries are measured."),
        ref(
          "candidate_artifact_ref",
          "artifact",
          true,
          "Canonical analysis.loop_candidates.v1 artifact ref consumed for measurement.",
        ),
      ],
      output: [
        ref("artifact_ref", "artifact", true, "Canonical analysis artifact ref for click-risk facts."),
      ],
    }),
    artifactInputs: [
      artifact(
        "loop_candidates",
        "analysis.loop_candidates.v1",
        "Loop-candidate analysis artifact consumed for boundary-risk measurement.",
      ),
    ],
    artifactOutput: artifact(
      "loop_click_risk",
      "analysis.loop_click_risk.v1",
      "Bounded loop boundary click-risk artifact.",
    ),
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.loop_click_risk.v1" },
      measured_candidate_count: { type: "integer" },
      risk_fact_count: { type: "integer" },
      truncated: { type: "boolean" },
    },
    expectedSummary: "Emits loop click-risk facts without changing items or loop points.",
    expectedEntitySummary: "Loop click-risk analysis artifact is produced.",
    examples: [
      {
        name: "measure_loop_click_risk",
        summary: "Measure boundary-risk facts for all bounded candidates in an artifact.",
        input: {},
      },
      {
        name: "measure_loop_click_risk_window",
        summary: "Measure boundary-risk facts with a bounded boundary window.",
        input: { boundary_window_ms: 20, max_candidates: 12 },
      },
    ],
  }),
  analysisArtifactDescriptor({
    id: "template.analysis.create_loop_qa_report",
    title: "Create loop QA report",
    summary: "Create a bounded QA report from loop analysis inputs and emit a canonical analysis artifact.",
    entity_kind: "loop_qa_report",
    tags: ["analysis", "audio", "loop", "qa", "artifact"],
    operation_name: "analysis.create_loop_qa_report",
    capability: "analysis.create_loop_qa_report",
    inputProperties: {
      max_report_rows: { type: "integer" },
    },
    refs: refs({
      input: [
        ref(
          "candidate_artifact_ref",
          "artifact",
          true,
          "Canonical analysis.loop_candidates.v1 artifact ref consumed for QA reporting.",
        ),
        ref(
          "click_risk_artifact_ref",
          "artifact",
          true,
          "Canonical analysis.loop_click_risk.v1 artifact ref consumed for QA reporting.",
        ),
      ],
      output: [
        ref("artifact_ref", "artifact", true, "Canonical analysis artifact ref for the loop QA report."),
      ],
    }),
    artifactInputs: [
      artifact(
        "loop_candidates",
        "analysis.loop_candidates.v1",
        "Loop-candidate analysis artifact consumed for QA reporting.",
      ),
      artifact(
        "loop_click_risk",
        "analysis.loop_click_risk.v1",
        "Loop click-risk artifact consumed for QA reporting.",
      ),
    ],
    artifactOutput: artifact(
      "loop_qa_report",
      "analysis.loop_qa_report.v1",
      "Bounded loop QA report artifact.",
    ),
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "analysis.loop_qa_report.v1" },
      candidate_count: { type: "integer" },
      risk_fact_count: { type: "integer" },
      report_row_count: { type: "integer" },
      truncated: { type: "boolean" },
    },
    expectedSummary: "Emits a loop QA report artifact without item edits, rendering, or acceptance decisions.",
    expectedEntitySummary: "Loop QA report artifact is produced.",
    examples: [
      {
        name: "create_loop_qa_report",
        summary: "Create a bounded QA report from candidate and click-risk artifacts.",
        input: {},
      },
      {
        name: "create_loop_qa_report_rows",
        summary: "Create a QA report with a bounded row budget.",
        input: { max_report_rows: 12 },
      },
    ],
  }),
]);

export function createCriticalAnalysisTemplates() {
  return cloneJson(CRITICAL_ANALYSIS_TEMPLATES);
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
    inputSchema: objectSchema(options.inputProperties ?? {}, []),
    outputSchema: objectSchema(options.outputProperties, ["artifact_ref"]),
    refs: options.refs,
    artifacts: {
      mode: "produces",
      input: options.artifactInputs,
      output: [options.artifactOutput],
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

function refs(options = {}) {
  return {
    input: options.input ?? [],
    output: options.output ?? [],
  };
}

function ref(name, kind, required, summary) {
  return {
    name,
    kind,
    required,
    summary,
  };
}

function artifact(name, schema, summary) {
  return {
    name,
    schema,
    owner_pack: "analysis",
    summary,
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

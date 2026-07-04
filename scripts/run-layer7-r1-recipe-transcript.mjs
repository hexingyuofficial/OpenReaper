import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_STATE_STORE_CONTRACT,
  formatArtifactRef,
  parseArtifactRef,
} from "../packages/core/src/artifact-state-store-v1.mjs";
import {
  FakeFoundationBridge,
  createArtifactRef,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  RECIPE_CONTRACT,
  RECIPE_TEMPLATE_EVIDENCE_CONTRACT,
  RecipeContractValidationError,
  normalizeRecipeContract,
  recipeTemplateDependencies,
} from "../packages/core/src/recipe-contract-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  GET_STATE_ARTIFACT_SCOPE,
  createGetStateArtifactRuntime,
} from "../packages/mcp-server/src/get-state-runtime-v1.mjs";
import {
  createLiveBridgeExecutorFromEnv,
} from "../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const OFFICIAL_LAYER7_R1_RECIPE_RELATIVE =
  "recipes/official/layer7/first_atoms_a/project.cleanup_fingerprint_report.recipe.json";
export const OFFICIAL_LAYER7_R1_RECIPE_FILE = path.join(REPO_ROOT, OFFICIAL_LAYER7_R1_RECIPE_RELATIVE);

export const LAYER7_R1_TRANSCRIPT_CONTRACT = "recipe.live_transcript.v1";
export const LAYER7_R1_RECIPE_ID = "recipe.project.cleanup_fingerprint_report";
export const LAYER7_R1_TEMPLATE_ID = "template.project.create_cleanup_report";
export const LAYER7_R1_ARTIFACT_LABEL = "cleanup_report";
export const LAYER7_R1_ARTIFACT_SCHEMA = "project.cleanup_report.v1";

export const LAYER7_R1_EXPECTED_STEP_IDS = Object.freeze([
  "create_cleanup_report",
  "read_cleanup_summary",
  "read_cleanup_payload",
]);

const ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const SESSION_ENV = "OPENREAPER_LIVE_BRIDGE_SESSION_ID";
const OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER";
const GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION";
const LAYER7_RUN_ID_ENV = "OPENREAPER_LAYER7_RECIPE_RUN_ID";

const EXPECTED_TEMPLATE_INPUT = deepFreeze({
  max_report_rows: 24,
  marker_region_limit: 64,
  tempo_marker_limit: 32,
  include_markers: true,
  include_regions: true,
  include_metadata: true,
  include_tempo: true,
  include_project_fingerprint: true,
});

const EXPECTED_CHECKPOINTS = deepFreeze([
  {
    id: "checkpoint_create_cleanup_report",
    after_step: "create_cleanup_report",
    required_evidence: ["evidence_create_cleanup_report"],
  },
  {
    id: "checkpoint_read_cleanup_summary",
    after_step: "read_cleanup_summary",
    required_evidence: [],
  },
  {
    id: "checkpoint_read_cleanup_payload",
    after_step: "read_cleanup_payload",
    required_evidence: [],
  },
]);

export class Layer7R1TranscriptDriverError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "Layer7R1TranscriptDriverError";
    this.code = code;
    this.status = options.status ?? "failed";
    this.recoverable = options.recoverable ?? true;
    if (options.details !== undefined) this.details = options.details;
  }
}

export async function loadLayer7R1Recipe({ recipePath = OFFICIAL_LAYER7_R1_RECIPE_FILE } = {}) {
  const resolvedRecipePath = resolveSelectedRecipePath(recipePath);
  const raw = await readFile(resolvedRecipePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_RECIPE_JSON_INVALID",
      "Layer 7 R1 recipe JSON could not be parsed.",
      { details: { recipe_file: displayRecipeFile(resolvedRecipePath), message: boundedString(error?.message) } },
    );
  }
}

export function assertLayer7R1Recipe(input, { recipeFile = OFFICIAL_LAYER7_R1_RECIPE_FILE } = {}) {
  precheckForbiddenArtifactAliases(input);
  const recipe = normalizeLayer7R1Recipe(input);

  assertEqual(recipe.contract, RECIPE_CONTRACT, "LAYER7_R1_RECIPE_CONTRACT_MISMATCH", "Recipe contract mismatch.");
  assertEqual(recipe.id, LAYER7_R1_RECIPE_ID, "LAYER7_R1_RECIPE_ID_MISMATCH", "Recipe id mismatch.");
  assertEqual(recipe.lifecycle, "draft", "LAYER7_R1_RECIPE_LIFECYCLE_MISMATCH", "Layer 7 R1 recipe must remain draft.");
  assertEqual(recipe.risk, "read", "LAYER7_R1_RECIPE_RISK_MISMATCH", "Layer 7 R1 recipe must remain read risk.");

  assertDeepEqual(
    recipeTemplateDependencies(recipe),
    [LAYER7_R1_TEMPLATE_ID],
    "LAYER7_R1_RECIPE_DEPENDENCIES_MISMATCH",
    "Layer 7 R1 dependency set mismatch.",
  );
  assertDeepEqual(
    recipe.steps.map((step) => step.id),
    LAYER7_R1_EXPECTED_STEP_IDS,
    "LAYER7_R1_STEP_ORDER_MISMATCH",
    "Layer 7 R1 step order mismatch.",
  );

  assertExpectedOutputs(recipe);
  assertExactStepShapes(recipe);
  assertExactRecoveryShape(recipe);

  return deepFreeze({
    recipe,
    recipe_file: displayRecipeFile(recipeFile),
    dependencies: [LAYER7_R1_TEMPLATE_ID],
    step_order: [...LAYER7_R1_EXPECTED_STEP_IDS],
    artifact_label: LAYER7_R1_ARTIFACT_LABEL,
  });
}

function precheckForbiddenArtifactAliases(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.steps)) return;
  for (const step of input.steps) {
    if (!step || typeof step !== "object" || !step.get_state || !Array.isArray(step.get_state.refs)) continue;
    for (const ref of step.get_state.refs) {
      validateArtifactLabelRef(ref, typeof step.id === "string" ? step.id : "unknown_step");
    }
  }
}

export function createFakeLayer7R1Runtimes(options = {}) {
  const now = typeof options.now === "function"
    ? options.now
    : () => new Date("2026-07-04T00:00:00.000Z");
  const artifactMap = options.artifactMap ?? new Map();
  const bridge = new FakeFoundationBridge({
    owner: "owner-test",
    generation: 1,
    now,
  });
  const artifactStore = options.artifactStore ?? memoryArtifactStore(artifactMap);
  const executor = options.executor ?? ((request) => fakeCleanupReportDispatch({
    request,
    bridge,
    artifactMap,
    now,
  }));

  return Object.freeze({
    mode: "fake",
    spawned_reaper: false,
    callTemplateRuntime: createCallTemplateRuntime({
      executor,
      evidenceLimit: 3,
    }),
    getStateRuntime: createGetStateArtifactRuntime({
      artifactStore,
      now,
    }),
    artifactMap,
    artifactStore,
  });
}

export async function runLayer7R1RecipeTranscript(options = {}) {
  const env = options.env ?? process.env;
  const recipePath = options.recipePath ?? options.recipe ?? OFFICIAL_LAYER7_R1_RECIPE_FILE;
  const recipeFile = resolveSelectedRecipePath(recipePath);
  const recipeInput = options.recipeObject ?? await loadLayer7R1Recipe({ recipePath: recipeFile });
  const assertion = assertLayer7R1Recipe(recipeInput, { recipeFile });
  const runId = options.runId ?? env[LAYER7_RUN_ID_ENV] ?? env[SESSION_ENV] ?? `layer7-r1-${randomUUID()}`;
  const mode = options.live === true ? "live" : "fake";
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const writer = await createTranscriptWriter({
    transcriptPath: options.transcriptPath ?? options.transcript,
    now,
    runId,
  });
  const state = {
    run_id: runId,
    mode,
    recipe_id: assertion.recipe.id,
    recipe_file: assertion.recipe_file,
    dependencies: assertion.dependencies,
    step_order: assertion.step_order,
    checkpoints: [],
    artifact_labels: {},
    events: writer.events,
    transcript_path: writer.transcriptPath,
    report_path: options.reportPath ?? options.report ?? null,
    spawned_reaper: false,
  };

  await writer.write({
    event: "run_started",
    mode,
    recipe_id: state.recipe_id,
    recipe_file: state.recipe_file,
    lifecycle: assertion.recipe.lifecycle,
    risk: assertion.recipe.risk,
    dependencies: assertion.dependencies,
    step_order: assertion.step_order,
  });

  try {
    const runtimes = await resolveRuntimes({
      ...options,
      mode,
      env,
      now,
    });
    state.spawned_reaper = Boolean(runtimes.spawned_reaper);

    await executeLayer7R1Sequence({
      recipe: assertion.recipe,
      runId,
      mode,
      env,
      now,
      writer,
      state,
      callTemplateRuntime: runtimes.callTemplateRuntime,
      getStateRuntime: runtimes.getStateRuntime,
    });

    const summary = finalSummary(state, {
      status: "succeeded",
      reason: "layer7_r1_recipe_transcript_succeeded",
    });
    await writer.write({
      event: "run_succeeded",
      status: summary.status,
      reason: summary.reason,
      checkpoints: summary.checkpoints,
      artifact_labels: summary.artifact_labels,
      spawned_reaper: summary.spawned_reaper,
    });
    await maybeWriteReport(summary, writer.events, state.report_path);
    return summary;
  } catch (error) {
    const normalized = normalizeDriverError(error);
    const event = normalized.status === "blocked" ? "run_blocked" : "run_failed";
    const summary = finalSummary(state, {
      status: normalized.status,
      reason: normalized.code,
      error: {
        code: normalized.code,
        message: normalized.message,
        recoverable: normalized.recoverable,
        details: normalized.details,
      },
    });
    await writer.write({
      event,
      status: summary.status,
      reason: summary.reason,
      error: summary.error,
      checkpoints: summary.checkpoints,
      artifact_labels: summary.artifact_labels,
      spawned_reaper: summary.spawned_reaper,
    });
    await maybeWriteReport(summary, writer.events, state.report_path);
    return summary;
  }
}

async function executeLayer7R1Sequence({
  recipe,
  runId,
  mode,
  env,
  now,
  writer,
  state,
  callTemplateRuntime,
  getStateRuntime,
}) {
  const artifactBindings = new Map();
  const evidenceByStep = new Map(recipe.recovery.evidence_requirements.map((entry) => [entry.step, entry]));
  const checkpointsByStep = new Map(recipe.recovery.checkpoints.map((entry) => [entry.after_step, entry]));

  for (const [index, step] of recipe.steps.entries()) {
    const requestSequence = index + 1;
    await writer.write({
      event: "step_started",
      step_id: step.id,
      step_index: index,
      tool: step.uses,
      request_sequence: requestSequence,
    });

    if (step.uses === "call_template") {
      const response = await runCallTemplateStep({
        step,
        requestSequence,
        runId,
        mode,
        env,
        now,
        writer,
        callTemplateRuntime,
      });
      const evidence = assertTemplateRuntimeEvidence({
        runtime: callTemplateRuntime,
        response,
        requirement: evidenceByStep.get(step.id),
        step,
      });
      const binding = bindCleanupReportArtifact({ response, evidence, step });
      artifactBindings.set(LAYER7_R1_ARTIFACT_LABEL, binding);
      state.artifact_labels[LAYER7_R1_ARTIFACT_LABEL] = binding.ref;
      await writer.write({
        event: "artifact_label_bound",
        step_id: step.id,
        source_step: binding.source_step,
        label: LAYER7_R1_ARTIFACT_LABEL,
        artifact_ref: binding.ref,
        schema: binding.schema,
        source: {
          tool: "call_template",
          template_id: LAYER7_R1_TEMPLATE_ID,
          request_id: binding.request_id,
          evidence_contract: RECIPE_TEMPLATE_EVIDENCE_CONTRACT,
        },
      });
    } else {
      await runGetStateStep({
        step,
        requestSequence,
        writer,
        getStateRuntime,
        artifactBindings,
      });
    }

    const checkpoint = checkpointsByStep.get(step.id);
    assertCheckpointReady({ checkpoint, step });
    state.checkpoints.push({
      id: checkpoint.id,
      after_step: checkpoint.after_step,
      required_evidence: checkpoint.required_evidence,
    });
    await writer.write({
      event: "checkpoint_reached",
      step_id: step.id,
      checkpoint: checkpoint.id,
      required_evidence: checkpoint.required_evidence,
    });
  }
}

async function runCallTemplateStep({
  step,
  requestSequence,
  runId,
  mode,
  env,
  now,
  writer,
  callTemplateRuntime,
}) {
  const request = {
    id: step.call_template.id,
    input: cloneJson(step.call_template.input),
    refs: cloneJson(step.call_template.refs),
    context: runtimeContext({
      runId,
      requestSequence,
      env,
      mode,
      createdAt: safeNowIso(now),
    }),
  };

  await writer.write({
    event: "frozen_tool_request_summary",
    step_id: step.id,
    tool: "call_template",
    request_sequence: requestSequence,
    summary: {
      template_id: request.id,
      input_keys: Object.keys(request.input).sort(),
      refs_keys: Object.keys(request.refs).sort(),
      context: {
        session_id: request.context.session_id,
        expected_owner: request.context.expected_owner,
        expected_generation: request.context.expected_generation,
        request_sequence: request.context.request_sequence,
      },
    },
  });

  const response = await callTemplateRuntime.call_template(request);
  await writer.write({
    event: "frozen_tool_response_summary",
    step_id: step.id,
    tool: "call_template",
    request_sequence: requestSequence,
    summary: summarizeCallTemplateResponse(response),
  });
  return response;
}

async function runGetStateStep({
  step,
  requestSequence,
  writer,
  getStateRuntime,
  artifactBindings,
}) {
  const projection = step.get_state.projection;
  const label = step.get_state.refs[0];
  validateArtifactLabelRef(label, step.id);
  const binding = artifactBindings.get(label);
  if (!binding) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_ARTIFACT_BINDING_MISSING",
      "get_state may read only an artifact label bound from prior template evidence.",
      { details: { step_id: step.id, label } },
    );
  }
  const view = projection === "artifact.payload" ? "payload" : "summary";
  const request = {
    scope: GET_STATE_ARTIFACT_SCOPE,
    artifact_ref: binding.ref,
    view,
  };

  await writer.write({
    event: "frozen_tool_request_summary",
    step_id: step.id,
    tool: "get_state",
    request_sequence: requestSequence,
    summary: {
      projection,
      label,
      scope: request.scope,
      artifact_ref: request.artifact_ref,
      view,
    },
  });

  const response = await getStateRuntime.get_state(request);
  await writer.write({
    event: "frozen_tool_response_summary",
    step_id: step.id,
    tool: "get_state",
    request_sequence: requestSequence,
    summary: summarizeGetStateResponse(response),
  });
  assertGetStateResponse({ response, binding, step, view });
}

async function resolveRuntimes(options) {
  if (options.callTemplateRuntime || options.getStateRuntime) {
    if (!options.callTemplateRuntime || !options.getStateRuntime) {
      throw new Layer7R1TranscriptDriverError(
        "LAYER7_R1_RUNTIME_INJECTION_INCOMPLETE",
        "Injected transcript driver runtimes must provide both call_template and get_state.",
      );
    }
    return {
      mode: options.mode,
      spawned_reaper: false,
      callTemplateRuntime: options.callTemplateRuntime,
      getStateRuntime: options.getStateRuntime,
    };
  }

  if (options.mode === "live") {
    const artifactRoot = options.artifactRoot ?? options.env[ARTIFACT_ROOT_ENV];
    if (typeof artifactRoot !== "string" || artifactRoot.trim() === "") {
      throw new Layer7R1TranscriptDriverError(
        "LAYER7_R1_LIVE_ARTIFACT_ROOT_BLOCKED",
        "Live Layer 7 R1 transcript run requires an artifact root.",
        {
          status: "blocked",
          details: { env: ARTIFACT_ROOT_ENV, spawned_reaper: false },
        },
      );
    }

    const liveConfig = createLiveBridgeExecutorFromEnv(options.env);
    if (!liveConfig.configured) {
      throw new Layer7R1TranscriptDriverError(
        "LAYER7_R1_LIVE_EXECUTOR_BLOCKED",
        "Live Layer 7 R1 transcript run requires configured non-spawning live bridge transport.",
        {
          status: "blocked",
          details: {
            blocker: liveConfig.reason,
            env: liveConfig.env,
            spawned_reaper: false,
          },
        },
      );
    }

    return {
      mode: "live",
      spawned_reaper: false,
      callTemplateRuntime: createCallTemplateRuntime({
        live: {
          opted_in: true,
          executor: liveConfig.executor,
          executor_config: liveConfig.config,
          allowed_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
          opt_in_env: "OPENREAPER_LAYER7_R1_RECIPE_LIVE",
          opt_in_flag: "--live",
        },
        evidenceLimit: 3,
      }),
      getStateRuntime: createGetStateArtifactRuntime({ artifactRoot }),
    };
  }

  return createFakeLayer7R1Runtimes({
    now: options.now,
    executor: options.executor,
    artifactStore: options.artifactStore,
    artifactMap: options.artifactMap,
  });
}

function assertExpectedOutputs(recipe) {
  const expectedArtifacts = new Set();
  for (const assertion of recipe.assertions) {
    if (assertion.kind !== "expected_output") continue;
    for (const label of assertion.outputs.artifacts) expectedArtifacts.add(label);
  }
  assertDeepEqual(
    [...expectedArtifacts].sort(),
    [LAYER7_R1_ARTIFACT_LABEL],
    "LAYER7_R1_EXPECTED_ARTIFACTS_MISMATCH",
    "Layer 7 R1 must declare only the cleanup_report artifact label.",
  );
}

function assertExactStepShapes(recipe) {
  const [createReport, readSummary, readPayload] = recipe.steps;
  assertEqual(createReport.uses, "call_template", "LAYER7_R1_STEP_TOOL_MISMATCH", "First R1 step must use call_template.");
  assertEqual(
    createReport.call_template.id,
    LAYER7_R1_TEMPLATE_ID,
    "LAYER7_R1_STEP_TEMPLATE_MISMATCH",
    "R1 call_template step must call the cleanup report template.",
  );
  assertDeepEqual(
    createReport.call_template.input,
    EXPECTED_TEMPLATE_INPUT,
    "LAYER7_R1_TEMPLATE_INPUT_MISMATCH",
    "R1 cleanup report input changed.",
  );
  assertDeepEqual(
    createReport.call_template.refs,
    {},
    "LAYER7_R1_TEMPLATE_REFS_MISMATCH",
    "R1 cleanup report template step must not use hidden refs.",
  );
  assertEqual(
    createReport.evidence,
    "evidence_create_cleanup_report",
    "LAYER7_R1_STEP_EVIDENCE_MISMATCH",
    "R1 cleanup report evidence id changed.",
  );

  assertGetStateStepShape(readSummary, {
    projection: "artifact.summary",
    checkpoint: "checkpoint_read_cleanup_summary",
  });
  assertGetStateStepShape(readPayload, {
    projection: "artifact.payload",
    checkpoint: "checkpoint_read_cleanup_payload",
  });
}

function assertGetStateStepShape(step, expected) {
  assertEqual(step.uses, "get_state", "LAYER7_R1_STEP_TOOL_MISMATCH", "R1 read steps must use get_state.");
  assertEqual(
    step.get_state.projection,
    expected.projection,
    "LAYER7_R1_GET_STATE_PROJECTION_MISMATCH",
    "R1 get_state projection changed.",
  );
  if (Array.isArray(step.get_state.refs)) {
    for (const label of step.get_state.refs) validateArtifactLabelRef(label, step.id);
  }
  assertDeepEqual(
    step.get_state.refs,
    [LAYER7_R1_ARTIFACT_LABEL],
    "LAYER7_R1_GET_STATE_LABEL_MISMATCH",
    "R1 get_state must read the cleanup_report label only.",
  );
  assertEqual(step.checkpoint, expected.checkpoint, "LAYER7_R1_CHECKPOINT_MISMATCH", "R1 checkpoint changed.");
}

function assertExactRecoveryShape(recipe) {
  assertDeepEqual(
    recipe.recovery.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      after_step: checkpoint.after_step,
      required_evidence: checkpoint.required_evidence,
    })),
    EXPECTED_CHECKPOINTS,
    "LAYER7_R1_RECOVERY_CHECKPOINTS_MISMATCH",
    "R1 recovery checkpoints changed.",
  );
  assertEqual(
    recipe.recovery.evidence_requirements.length,
    1,
    "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH",
    "R1 must have one template evidence requirement.",
  );
  const [evidence] = recipe.recovery.evidence_requirements;
  assertEqual(evidence.id, "evidence_create_cleanup_report", "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH", "R1 evidence id changed.");
  assertEqual(evidence.step, "create_cleanup_report", "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH", "R1 evidence step changed.");
  assertEqual(evidence.source, RECIPE_TEMPLATE_EVIDENCE_CONTRACT, "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH", "R1 evidence source changed.");
  assertEqual(evidence.template_id, LAYER7_R1_TEMPLATE_ID, "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH", "R1 evidence template changed.");
  assertEqual(evidence.require_ok, true, "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH", "R1 evidence must require ok.");
  assertEqual(evidence.require_request_id, true, "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH", "R1 evidence must require request id.");
  assertDeepEqual(
    evidence.counts,
    {
      refs_min: 0,
      artifacts_min: 1,
      jobs_min: 0,
      last_result_refs_min: 0,
    },
    "LAYER7_R1_EVIDENCE_REQUIREMENTS_MISMATCH",
    "R1 evidence count minima changed.",
  );
}

function assertTemplateRuntimeEvidence({ runtime, response, requirement, step }) {
  if (!requirement) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_TEMPLATE_EVIDENCE_MISSING",
      "Missing recipe evidence requirement for call_template step.",
      { details: { step_id: step.id } },
    );
  }
  if (response?.ok !== true) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_TEMPLATE_CALL_FAILED",
      "call_template did not return ok:true for the R1 cleanup report step.",
      { details: summarizeCallTemplateResponse(response) },
    );
  }
  const evidence = typeof runtime.last_evidence === "function" ? runtime.last_evidence() : null;
  if (!evidence || evidence.contract !== RECIPE_TEMPLATE_EVIDENCE_CONTRACT) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_TEMPLATE_EVIDENCE_MISSING",
      "call_template runtime did not retain template.runtime.evidence.v1.",
      { details: { step_id: step.id } },
    );
  }
  assertEqual(
    evidence.template?.id,
    LAYER7_R1_TEMPLATE_ID,
    "LAYER7_R1_TEMPLATE_EVIDENCE_MISMATCH",
    "call_template evidence template id mismatch.",
  );
  assertEqual(evidence.ok, true, "LAYER7_R1_TEMPLATE_EVIDENCE_MISMATCH", "call_template evidence must be ok.");
  if (requirement.require_request_id && typeof evidence.request_id !== "string") {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_TEMPLATE_EVIDENCE_MISMATCH",
      "call_template evidence is missing request_id.",
      { details: { step_id: step.id } },
    );
  }
  assertMinimumCount(evidence.counts?.refs, requirement.counts.refs_min, "refs", step.id);
  assertMinimumCount(evidence.counts?.artifacts, requirement.counts.artifacts_min, "artifacts", step.id);
  assertMinimumCount(evidence.counts?.jobs, requirement.counts.jobs_min, "jobs", step.id);
  assertMinimumCount(
    evidence.counts?.last_result_refs,
    requirement.counts.last_result_refs_min,
    "last_result_refs",
    step.id,
  );
  return evidence;
}

function bindCleanupReportArtifact({ response, evidence, step }) {
  const artifacts = Array.isArray(response?.result?.artifacts) ? response.result.artifacts : [];
  const matches = artifacts.filter((artifact) => {
    if (artifact?.kind !== "artifact" || typeof artifact.ref !== "string") return false;
    let parsed;
    try {
      parsed = parseArtifactRef(artifact.ref);
    } catch {
      return false;
    }
    return parsed.owner_pack === "project" &&
      parsed.scope === LAYER7_R1_ARTIFACT_LABEL &&
      artifact.summary?.schema === LAYER7_R1_ARTIFACT_SCHEMA;
  });

  if (matches.length !== 1) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_ARTIFACT_BINDING_MISSING",
      "R1 cleanup_report must bind exactly one artifact produced by the cleanup report template evidence.",
      {
        details: {
          step_id: step.id,
          evidence_request_id: evidence.request_id,
          produced_artifact_refs: artifacts.map((artifact) => artifact?.ref).filter(Boolean),
        },
      },
    );
  }

  return deepFreeze({
    label: LAYER7_R1_ARTIFACT_LABEL,
    ref: matches[0].ref,
    schema: LAYER7_R1_ARTIFACT_SCHEMA,
    request_id: evidence.request_id,
    source_step: step.id,
  });
}

function assertGetStateResponse({ response, binding, step, view }) {
  if (response?.ok !== true) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_GET_STATE_FAILED",
      "get_state artifact read did not return ok:true.",
      { details: { step_id: step.id, response: summarizeGetStateResponse(response) } },
    );
  }
  assertEqual(
    response.request?.artifact_ref,
    binding.ref,
    "LAYER7_R1_GET_STATE_RESPONSE_MISMATCH",
    "get_state response artifact ref mismatch.",
  );
  assertEqual(
    response.result?.artifact?.schema,
    binding.schema,
    "LAYER7_R1_GET_STATE_RESPONSE_MISMATCH",
    "get_state response schema mismatch.",
  );
  assertEqual(
    response.result?.artifact?.view,
    view,
    "LAYER7_R1_GET_STATE_RESPONSE_MISMATCH",
    "get_state response view mismatch.",
  );
}

function assertCheckpointReady({ checkpoint, step }) {
  if (!checkpoint || checkpoint.after_step !== step.id || checkpoint.id !== step.checkpoint) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_CHECKPOINT_MISMATCH",
      "Recipe checkpoint is not aligned with the executed step.",
      { details: { step_id: step.id } },
    );
  }
}

function validateArtifactLabelRef(label, stepId) {
  if (typeof label !== "string" || label.trim() === "") {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_ARTIFACT_LABEL_INVALID",
      "Artifact get_state ref must be a symbolic label string.",
      { details: { step_id: stepId } },
    );
  }
  if (/^artifact:/.test(label) || /^last_result:artifact(?::|$)/.test(label)) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_ARTIFACT_ALIAS_REJECTED",
      "R1 get_state refs must not use canonical artifact refs or public last_result artifact aliases.",
      { details: { step_id: stepId, ref: boundedString(label) } },
    );
  }
}

function normalizeLayer7R1Recipe(input) {
  try {
    return normalizeRecipeContract(input);
  } catch (error) {
    if (error instanceof RecipeContractValidationError) {
      throw new Layer7R1TranscriptDriverError(
        "LAYER7_R1_RECIPE_CONTRACT_INVALID",
        "Layer 7 R1 recipe does not satisfy recipe.contract.v1.",
        { details: { errors: error.errors } },
      );
    }
    throw error;
  }
}

function fakeCleanupReportDispatch({ request, bridge, artifactMap, now }) {
  if (request?.operation?.family !== "run_job" || request.operation.name !== "project.create_cleanup_report") {
    return bridge.errorEnvelope(request, "OPERATION_NOT_FOUND", "Fake R1 driver only supports project.create_cleanup_report.", {
      startedAt: request?.created_at ?? safeNowIso(now),
    });
  }

  const id = "art_20260704000000000_001_000001";
  const ref = formatArtifactRef({
    owner_pack: "project",
    scope: LAYER7_R1_ARTIFACT_LABEL,
    id,
  });
  const createdAt = request.created_at ?? safeNowIso(now);
  artifactMap.set(ref, cleanupReportEnvelope({ ref, id, createdAt }));
  const artifact = {
    ...createArtifactRef({
      owner_pack: "project",
      scope: LAYER7_R1_ARTIFACT_LABEL,
      id,
      schema: LAYER7_R1_ARTIFACT_SCHEMA,
      summary: {
        schema: LAYER7_R1_ARTIFACT_SCHEMA,
        template_id: LAYER7_R1_TEMPLATE_ID,
        report_row_count: 4,
        truncated: false,
      },
    }),
    name: "artifact_ref",
    label: LAYER7_R1_ARTIFACT_LABEL,
  };

  return bridge.okEnvelope(request, createdAt, {
    summary: {
      schema: LAYER7_R1_ARTIFACT_SCHEMA,
      artifact_ref: ref,
      evidence_family_count: 4,
      report_row_count: 4,
      marker_count: 1,
      region_count: 1,
      metadata_field_count: 2,
      tempo_marker_count: 1,
      project_fingerprint: "fake-project-fingerprint-r1",
      truncated: false,
    },
    refs: [],
    artifacts: [artifact],
    jobs: [],
    last_result: {
      updated: false,
      refs: [],
      truncated: false,
    },
  });
}

function cleanupReportEnvelope({ ref, id, createdAt }) {
  return {
    contract: ARTIFACT_STATE_STORE_CONTRACT,
    ref,
    id,
    owner_pack: "project",
    scope: LAYER7_R1_ARTIFACT_LABEL,
    schema: LAYER7_R1_ARTIFACT_SCHEMA,
    producer: {
      kind: "template",
      id: LAYER7_R1_TEMPLATE_ID,
      pack: "project",
    },
    created_at: createdAt,
    summary: {
      schema: LAYER7_R1_ARTIFACT_SCHEMA,
      template_id: LAYER7_R1_TEMPLATE_ID,
      report_row_count: 4,
      marker_count: 1,
      region_count: 1,
      project_fingerprint: "fake-project-fingerprint-r1",
      truncated: false,
    },
    payload: {
      schema: LAYER7_R1_ARTIFACT_SCHEMA,
      project_fingerprint: "fake-project-fingerprint-r1",
      rows: [
        { family: "metadata", fact: "project metadata inspected" },
        { family: "markers", fact: "one marker counted" },
        { family: "regions", fact: "one region counted" },
        { family: "tempo", fact: "one tempo marker counted" },
      ],
      no_cleanup_apply_authority: true,
    },
  };
}

function memoryArtifactStore(map) {
  const seen = [];
  return {
    seen,
    async read(ref, parts) {
      seen.push({ ref, owner_pack: parts.owner_pack, scope: parts.scope });
      return map.get(ref);
    },
  };
}

async function createTranscriptWriter({ transcriptPath, now, runId }) {
  const events = [];
  const resolvedPath = transcriptPath ? path.resolve(transcriptPath) : null;
  if (resolvedPath) {
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, "");
  }

  return {
    events,
    transcriptPath: resolvedPath,
    async write(event) {
      const enriched = {
        contract: LAYER7_R1_TRANSCRIPT_CONTRACT,
        run_id: runId,
        at: safeNowIso(now),
        ...event,
      };
      events.push(enriched);
      if (resolvedPath) await appendFile(resolvedPath, `${JSON.stringify(enriched)}\n`);
    },
  };
}

async function maybeWriteReport(summary, events, reportPath) {
  if (!reportPath) return;
  const resolved = path.resolve(reportPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const lines = [
    "# Layer 7 R1 Recipe Transcript Evidence",
    "",
    `- status: ${summary.status}`,
    `- reason: ${summary.reason}`,
    `- run_id: ${summary.run_id}`,
    `- recipe_id: ${summary.recipe_id}`,
    `- recipe_file: ${summary.recipe_file}`,
    `- mode: ${summary.mode}`,
    `- transcript: ${summary.transcript_path ?? "not written"}`,
    `- spawned_reaper: ${summary.spawned_reaper}`,
    `- step_order: ${summary.step_order.join(", ")}`,
    `- dependencies: ${summary.dependencies.join(", ")}`,
    `- checkpoints: ${summary.checkpoints.map((checkpoint) => checkpoint.id).join(", ")}`,
    `- artifact_labels: ${JSON.stringify(summary.artifact_labels)}`,
    `- transcript_events: ${events.length}`,
    "",
  ];
  await writeFile(resolved, `${lines.join("\n")}\n`);
}

function finalSummary(state, overrides) {
  return deepFreeze({
    status: overrides.status,
    ok: overrides.status === "succeeded",
    reason: overrides.reason,
    run_id: state.run_id,
    mode: state.mode,
    recipe_id: state.recipe_id,
    recipe_file: state.recipe_file,
    dependencies: state.dependencies,
    step_order: state.step_order,
    checkpoints: cloneJson(state.checkpoints),
    artifact_labels: cloneJson(state.artifact_labels),
    transcript_path: state.transcript_path,
    report_path: state.report_path,
    spawned_reaper: state.spawned_reaper,
    live_matrix_updated: false,
    old_repo_changed: false,
    commit_made: false,
    ...(overrides.error ? { error: overrides.error } : {}),
  });
}

function summarizeCallTemplateResponse(response) {
  const result = response?.result ?? {};
  const lastResult = result.last_result ?? {};
  return {
    contract: response?.contract ?? null,
    ok: Boolean(response?.ok),
    template_id: response?.template?.id ?? null,
    request_id: response?.request?.id ?? null,
    error: response?.ok ? null : compactError(response?.error),
    counts: {
      refs: Array.isArray(result.refs) ? result.refs.length : 0,
      artifacts: Array.isArray(result.artifacts) ? result.artifacts.length : 0,
      jobs: Array.isArray(result.jobs) ? result.jobs.length : 0,
      last_result_refs: Array.isArray(lastResult.refs) ? lastResult.refs.length : 0,
    },
    artifact_refs: Array.isArray(result.artifacts)
      ? result.artifacts.map((artifact) => artifact?.ref).filter(Boolean)
      : [],
    last_result_updated: Boolean(lastResult.updated),
    budget: {
      response_bytes: response?.budget?.response_bytes ?? null,
      truncated: Boolean(response?.budget?.truncated),
    },
  };
}

function summarizeGetStateResponse(response) {
  return {
    contract: response?.contract ?? null,
    ok: Boolean(response?.ok),
    scope: response?.scope ?? null,
    request: response?.request
      ? {
          scope: response.request.scope,
          artifact_ref: response.request.artifact_ref,
          view: response.request.view,
        }
      : null,
    error: response?.ok ? null : compactError(response?.error),
    artifact: response?.result?.artifact
      ? {
          ref: response.result.artifact.ref,
          schema: response.result.artifact.schema,
          view: response.result.artifact.view,
          payload_included: Object.hasOwn(response.result.artifact, "payload"),
          response_bytes: response.result.artifact.response_bytes,
        }
      : null,
    last_result_updated: Boolean(response?.last_result?.updated),
    budget: {
      response_bytes: response?.budget?.response_bytes ?? null,
      truncated: Boolean(response?.budget?.truncated),
    },
  };
}

function runtimeContext({ runId, requestSequence, env, mode, createdAt }) {
  return {
    client_id: "openreaper-layer7-r1-transcript-driver",
    session_id: env[SESSION_ENV] ?? runId,
    expected_owner: env[OWNER_ENV] ?? (mode === "live" ? "openreaper-layer7-r1-cleanup" : "owner-test"),
    expected_generation: positiveInteger(env[GENERATION_ENV], 1),
    created_at: createdAt,
    request_sequence: requestSequence,
  };
}

function resolveSelectedRecipePath(recipePath) {
  const resolved = path.resolve(REPO_ROOT, recipePath);
  if (resolved !== OFFICIAL_LAYER7_R1_RECIPE_FILE) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_RECIPE_FILE_REJECTED",
      "Layer 7 R1 transcript driver may load only the cleanup fingerprint report recipe file.",
      {
        details: {
          expected: OFFICIAL_LAYER7_R1_RECIPE_RELATIVE,
          received: displayRecipeFile(resolved),
        },
      },
    );
  }
  return resolved;
}

function displayRecipeFile(file) {
  const resolved = path.resolve(file);
  const relative = path.relative(REPO_ROOT, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? resolved : relative;
}

function assertMinimumCount(actual, expected, label, stepId) {
  if (!Number.isInteger(actual) || actual < expected) {
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_TEMPLATE_EVIDENCE_MISMATCH",
      "call_template evidence count is below the recipe requirement.",
      { details: { step_id: stepId, count: label, actual, expected } },
    );
  }
}

function assertEqual(actual, expected, code, message) {
  if (actual !== expected) {
    throw new Layer7R1TranscriptDriverError(code, message, {
      details: { expected, actual },
    });
  }
}

function assertDeepEqual(actual, expected, code, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Layer7R1TranscriptDriverError(code, message, {
      details: { expected, actual },
    });
  }
}

function normalizeDriverError(error) {
  if (error instanceof Layer7R1TranscriptDriverError) return error;
  return new Layer7R1TranscriptDriverError(
    "LAYER7_R1_UNEXPECTED_FAILURE",
    error instanceof Error ? error.message : "Layer 7 R1 transcript run failed.",
    {
      recoverable: false,
      details: error?.code ? { code: error.code } : undefined,
    },
  );
}

function compactError(error) {
  if (!error) return null;
  return {
    source: error.source ?? null,
    code: error.code ?? null,
    message: boundedString(error.message),
    recoverable: error.recoverable ?? null,
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeNowIso(now) {
  try {
    const value = typeof now === "function" ? now() : new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function boundedString(value, maxLength = 200) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 3)}...`;
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") {
      options.live = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const [key, inlineValue] = arg.split("=", 2);
    if (["--recipe", "--transcript", "--report", "--artifact-root", "--run-id"].includes(key)) {
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (typeof value !== "string" || value.trim() === "") {
        throw new Layer7R1TranscriptDriverError(
          "LAYER7_R1_CLI_ARGS_INVALID",
          `${key} requires a value.`,
          { recoverable: false },
        );
      }
      if (key === "--recipe") options.recipePath = value;
      if (key === "--transcript") options.transcriptPath = value;
      if (key === "--report") options.reportPath = value;
      if (key === "--artifact-root") options.artifactRoot = value;
      if (key === "--run-id") options.runId = value;
      continue;
    }
    throw new Layer7R1TranscriptDriverError(
      "LAYER7_R1_CLI_ARGS_INVALID",
      `Unknown argument: ${arg}`,
      { recoverable: false },
    );
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/run-layer7-r1-recipe-transcript.mjs [--recipe <official-r1-recipe>] [--transcript <jsonl>] [--report <md>]",
    "  node scripts/run-layer7-r1-recipe-transcript.mjs --live --artifact-root <artifact-root> --transcript <jsonl>",
    "",
    "Default mode is fake/no-REAPER. --live requires configured non-spawning live bridge env.",
  ].join("\n");
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const summary = await runLayer7R1RecipeTranscript(options);
    console.log(JSON.stringify({
      status: summary.status,
      reason: summary.reason,
      run_id: summary.run_id,
      recipe_id: summary.recipe_id,
      transcript_path: summary.transcript_path,
      report_path: summary.report_path,
      checkpoints: summary.checkpoints.map((checkpoint) => checkpoint.id),
      artifact_labels: summary.artifact_labels,
      spawned_reaper: summary.spawned_reaper,
    }, null, 2));
    process.exit(summary.status === "succeeded" ? 0 : summary.status === "blocked" ? 2 : 1);
  } catch (error) {
    const normalized = normalizeDriverError(error);
    console.error(JSON.stringify({
      status: normalized.status,
      reason: normalized.code,
      message: normalized.message,
      details: normalized.details,
    }, null, 2));
    process.exit(normalized.status === "blocked" ? 2 : 1);
  }
}

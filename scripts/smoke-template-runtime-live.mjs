import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  createObjectRef,
  validateFoundationBridgeResult,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  artifactIdFromCommandId,
  artifactPathFromRef,
  formatArtifactRef,
  parseArtifactRef,
} from "../packages/core/src/artifact-state-store-v1.mjs";
import {
  createArtifactStateStoreEnvelope,
  writeArtifactStateStoreEnvelope,
} from "../packages/core/src/artifact-state-store-live-helper-v1.mjs";
import {
  createGetStateArtifactRuntime,
} from "../packages/mcp-server/src/get-state-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
  createLiveBridgeExecutorFromEnv,
} from "../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const WAVE1A_OPT_IN_ENV = "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE";
const FIRST_REAL_A1_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A1_LIVE_SMOKE";
const FIRST_REAL_A2_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A2_LIVE_SMOKE";
const OPT_IN_FLAG = "--live";
const READ_B_FLAG = "--read-b";
const FIRST_REAL_A1_FLAG = "--first-real-a1";
const FIRST_REAL_A2_FLAG = "--first-real-a2-render";
const PHASE_FLAG = "--phase";
const FIRST_REAL_A2_PHASE = "A2-render-delivery";
const FAKE_FLAG = "--fake";
const OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER";
const GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION";
const SESSION_ENV = "OPENREAPER_LIVE_BRIDGE_SESSION_ID";
const TRACK_REF_ENV = "OPENREAPER_LIVE_SMOKE_TRACK_REF";
const ITEM_REF_ENV = "OPENREAPER_LIVE_SMOKE_ITEM_REF";
const FIRST_REAL_A1_ITEM_REF_ENV = "OPENREAPER_FIRST_REAL_A_ITEM_REF";
const FIRST_REAL_A1_PROJECT_REF_ENV = "OPENREAPER_FIRST_REAL_A_PROJECT_REF";
const FIRST_REAL_A1_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const FIRST_REAL_A1_BATCH = "First-Real-Fixture-A A1";
const FIRST_REAL_A2_REGION_REF_ENV = "OPENREAPER_FIRST_REAL_A_REGION_REF";
const FIRST_REAL_A2_PROJECT_REF_ENV = "OPENREAPER_FIRST_REAL_A_PROJECT_REF";
const FIRST_REAL_A2_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const FIRST_REAL_A2_RENDER_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_RENDER_ROOT";
const FIRST_REAL_A2_BATCH = "First-Real-Fixture-A A2 Render Route";
const READ_B_BATCH = "read-b-live-handlers";
const READ_B_ACTION_SECTION_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_SECTION";
const READ_B_ACTION_COMMAND_ID_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_COMMAND_ID";
const READ_B_ACTION_TOGGLE_COMMAND_ID_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_TOGGLE_COMMAND_ID";
const READ_B_NAMED_COMMAND_ENV = "OPENREAPER_LIVE_SMOKE_NAMED_COMMAND";
const READ_B_ACTION_SEARCH_QUERY_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_SEARCH_QUERY";
const READ_B_ACTION_SEARCH_LIMIT_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_SEARCH_LIMIT";
const READ_B_ACTION_SEARCH_DEFAULT_LIMIT = 6;
const READ_B_ACTION_SEARCH_MAX_LIMIT = 6;
const READ_B_MARKER_ACTION_TEXT_ENV = "OPENREAPER_LIVE_SMOKE_MARKER_ACTION_TEXT";
const READ_B_MIDI_TAKE_REF_ENV = "OPENREAPER_LIVE_SMOKE_MIDI_TAKE_REF";
const READ_B_AUDIO_TAKE_REF_ENV = "OPENREAPER_LIVE_SMOKE_AUDIO_TAKE_REF";
const READ_B_MEDIA_PATH_ENV = "OPENREAPER_LIVE_SMOKE_MEDIA_PATH";

const READ_B_OPERATIONS = Object.freeze([
  "query_state:actions.resolve_named_command",
  "query_state:actions.read_action_metadata",
  "query_state:actions.read_action_toggle_state",
  "query_state:actions.read_action_shortcuts",
  "query_state:actions.parse_marker_action_text",
  "query_state:actions.search_action_commands",
  "query_state:midi.resolve_midi_take_ref",
  "query_state:midi.read_take_event_counts",
  "query_state:midi.list_take_notes",
  "query_state:midi.list_take_cc_events",
  "query_state:midi.list_take_text_sysex_events",
  "query_state:midi.read_take_grid",
  "query_state:media.file.probe",
  "query_state:media.take_source.read",
  "query_state:media.project_files.read",
]);

const FIRST_REAL_A1_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.analysis.detect_loop_candidates",
    operation: "run_job:analysis.detect_loop_candidates",
    owner_pack: "analysis",
    scope: "loop_candidates",
    schema: "analysis.loop_candidates.v1",
  }),
  Object.freeze({
    id: "template.analysis.measure_loop_click_risk",
    operation: "run_job:analysis.measure_loop_click_risk",
    owner_pack: "analysis",
    scope: "loop_click_risk",
    schema: "analysis.loop_click_risk.v1",
    consumes: Object.freeze(["analysis.loop_candidates.v1"]),
  }),
  Object.freeze({
    id: "template.analysis.create_loop_qa_report",
    operation: "run_job:analysis.create_loop_qa_report",
    owner_pack: "analysis",
    scope: "loop_qa_report",
    schema: "analysis.loop_qa_report.v1",
    consumes: Object.freeze(["analysis.loop_candidates.v1", "analysis.loop_click_risk.v1"]),
  }),
  Object.freeze({
    id: "template.project.create_cleanup_report",
    operation: "run_job:project.create_cleanup_report",
    owner_pack: "project",
    scope: "cleanup_report",
    schema: "project.cleanup_report.v1",
  }),
]);

const FIRST_REAL_A1_SPEC_BY_ID = new Map(FIRST_REAL_A1_TEMPLATE_SPECS.map((spec) => [spec.id, spec]));
const FIRST_REAL_A1_SPEC_BY_OPERATION = new Map(FIRST_REAL_A1_TEMPLATE_SPECS.map((spec) => [spec.operation, spec]));

const FIRST_REAL_A2_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.render.render_region_wav",
    operation: "run_job:render.region_wav",
    owner_pack: "render",
    output_scope: "region_wav_output",
    output_schema: "render.region_wav_output.v1",
    evidence_scope: "render_job_evidence",
    evidence_schema: "render.render_job_evidence.v1",
  }),
  Object.freeze({
    id: "template.render.create_delivery_report",
    operation: "run_job:render.delivery_report.create",
    owner_pack: "render",
    scope: "delivery_report",
    schema: "render.delivery_report.v1",
    consumes: Object.freeze(["render.region_wav_output.v1", "render.render_job_evidence.v1"]),
  }),
]);

const FIRST_REAL_A2_SPEC_BY_OPERATION = new Map(FIRST_REAL_A2_TEMPLATE_SPECS.map((spec) => [spec.operation, spec]));

const runtime = createCallTemplateRuntime();
const route = selectRoute(process.argv, process.env);
const optedIn = route.fake || process.env[route.optInEnv] === "1" || process.argv.includes(OPT_IN_FLAG);
const fixtureInputs = route.fixtureInputs(process.env);
const baseReport = {
  gate: "template-runtime-live",
  contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
  accepted_catalog: runtime.accepted_catalog,
  opt_in_env: route.optInEnv,
  opt_in_flag: OPT_IN_FLAG,
  route_flag: route.routeFlag,
  opted_in: optedIn,
  mode: route.fake ? "fake" : "live",
  spawned_reaper: false,
  wave: route.wave,
  batch: route.batch,
  allowed_template_ids: route.templateIds,
  allowed_bridge_operations: route.operations,
  fixture_inputs: fixtureInputs.report,
};

if (route.fake) {
  const blocker = route.name === "first-real-a2-render"
    ? await firstRealA2RootBlocker(fixtureInputs)
    : await firstRealA1ArtifactRootBlocker(fixtureInputs.artifact_root);
  if (blocker) {
    console.log(JSON.stringify({
      ...baseReport,
      ok: false,
      skipped: false,
      ...blocker,
      live_pass_claimed: false,
    }));
    process.exit(2);
  }

  const fakeExecutor = {
    config: {
      contract: route.name === "first-real-a2-render"
        ? "first_real_fixture_a2.fake_executor.v1"
        : "first_real_fixture_a1.fake_executor.v1",
      kind: "fake_artifact_writer",
      spawned_reaper: false,
    },
    async dispatch(request) {
      if (route.name === "first-real-a2-render") {
        return dispatchFakeFirstRealA2(request, {
          artifactRoot: fixtureInputs.artifact_root,
          renderRoot: fixtureInputs.render_root,
        });
      }
      return dispatchFakeFirstRealA1(request, { artifactRoot: fixtureInputs.artifact_root });
    },
  };
  const fakeRuntime = createLiveRuntimeForRoute(route, fakeExecutor, fakeExecutor.config);
  const contextBase = liveContextBase();
  const fakeReport = route.name === "first-real-a2-render"
    ? await runFirstRealA2Smoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
        artifactRoot: fixtureInputs.artifact_root,
        renderRoot: fixtureInputs.render_root,
      })
    : await runFirstRealA1Smoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
        artifactRoot: fixtureInputs.artifact_root,
      });
  console.log(JSON.stringify({
    ...baseReport,
    ...fakeReport,
    skipped: false,
    live_executor: fakeExecutor.config,
    context: contextSummary(contextBase),
    evidence: fakeRuntime.evidence(),
    live_pass_claimed: false,
  }));
  process.exit(fakeReport.ok ? 0 : 2);
}

if (!optedIn) {
  console.log(JSON.stringify({
    ...baseReport,
    ok: true,
    skipped: true,
    reason: "explicit_opt_in_required",
  }));
  process.exit(0);
}

const executorConfig = createLiveBridgeExecutorFromEnv(process.env);
if (!executorConfig.configured) {
  console.log(JSON.stringify({
    ...baseReport,
    ok: false,
    skipped: false,
    reason: executorConfig.reason,
    blocker: executorConfig.reason,
    live_executor_env: LIVE_BRIDGE_EXECUTOR_ENV,
    message: "Opt-in live smoke entered the gate, but no explicit live bridge executor transport was configured.",
    live_pass_claimed: false,
  }));
  process.exit(2);
}

if (route.configuredBlocker) {
  const blocker = await route.configuredBlocker({
    fixtureInputs,
    executorConfig,
  });
  if (blocker) {
    console.log(JSON.stringify({
      ...baseReport,
      ok: false,
      skipped: false,
      ...blocker,
      live_executor: executorConfig.config,
      live_pass_claimed: false,
    }));
    process.exit(2);
  }
}

const liveRuntime = createLiveRuntimeForRoute(route, executorConfig.executor, executorConfig.config);
const contextBase = liveContextBase();
const routeReport = route.name === "first-real-a2-render"
  ? await runFirstRealA2Smoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      artifactRoot: fixtureInputs.artifact_root,
      renderRoot: fixtureInputs.render_root,
    })
  : route.name === "first-real-a1"
  ? await runFirstRealA1Smoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      artifactRoot: fixtureInputs.artifact_root,
    })
  : await runReadOnlySmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      route,
    });

console.log(JSON.stringify({
  ...baseReport,
  ...routeReport,
  skipped: false,
  live_executor: executorConfig.config,
  context: contextSummary(contextBase),
  evidence: liveRuntime.evidence(),
  live_pass_claimed: false,
}));
process.exit(routeReport.ok ? 0 : 2);

function selectRoute(argv, env) {
  const phaseIndex = argv.indexOf(PHASE_FLAG);
  const selectedPhase = phaseIndex >= 0 ? argv[phaseIndex + 1] : null;
  const firstRealA2Selected =
    argv.includes(FIRST_REAL_A2_FLAG) ||
    selectedPhase === FIRST_REAL_A2_PHASE ||
    env[FIRST_REAL_A2_OPT_IN_ENV] === "1";
  if (firstRealA2Selected) {
    return {
      name: "first-real-a2-render",
      wave: FIRST_REAL_A2_BATCH,
      batch: FIRST_REAL_A2_BATCH,
      routeFlag: selectedPhase === FIRST_REAL_A2_PHASE ? `${PHASE_FLAG} ${FIRST_REAL_A2_PHASE}` : FIRST_REAL_A2_FLAG,
      optInEnv: FIRST_REAL_A2_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
      operations: FIRST_REAL_A2_TEMPLATE_SPECS.map((spec) => spec.operation),
      fixtureInputs: firstRealA2FixtureInputs,
      configuredBlocker: firstRealA2ConfiguredBlocker,
      passReason: "first_real_fixture_a2_render_delivery_readback_passed",
      failReason: "first_real_fixture_a2_render_delivery_readback_failed",
    };
  }

  const firstRealA1Selected = argv.includes(FIRST_REAL_A1_FLAG) || env[FIRST_REAL_A1_OPT_IN_ENV] === "1";
  if (firstRealA1Selected) {
    return {
      name: "first-real-a1",
      wave: FIRST_REAL_A1_BATCH,
      batch: FIRST_REAL_A1_BATCH,
      routeFlag: FIRST_REAL_A1_FLAG,
      optInEnv: FIRST_REAL_A1_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
      operations: FIRST_REAL_A1_TEMPLATE_SPECS.map((spec) => spec.operation),
      fixtureInputs: firstRealA1FixtureInputs,
      configuredBlocker: firstRealA1ConfiguredBlocker,
      passReason: "first_real_fixture_a1_live_readback_passed",
      failReason: "first_real_fixture_a1_live_readback_failed",
    };
  }

  if (argv.includes(READ_B_FLAG)) {
    return {
      name: "read-b",
      wave: READ_B_BATCH,
      batch: READ_B_BATCH,
      routeFlag: READ_B_FLAG,
      optInEnv: WAVE1A_OPT_IN_ENV,
      fake: false,
      templateIds: CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
      operations: READ_B_OPERATIONS,
      fixtureInputs: readBFixtureInputs,
      configuredBlocker: readOnlyConfiguredBlocker,
      inputBuilder: readBInputs,
      refsBuilder: readBRefs,
      passReason: "read_b_live_handlers_passed",
      failReason: "read_b_live_handlers_failed",
    };
  }

  return {
    name: "wave1a",
    wave: "wave1a-read-handlers",
    batch: "wave1a-read-handlers",
    routeFlag: null,
    optInEnv: WAVE1A_OPT_IN_ENV,
    fake: false,
    templateIds: CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
    operations: [],
    fixtureInputs: liveSmokeFixtureInputs,
    inputBuilder: wave1AInputs,
    refsBuilder: wave1ARefs,
    passReason: "wave1a_live_read_handlers_passed",
    failReason: "wave1a_live_read_handlers_failed",
  };
}

function createLiveRuntimeForRoute(selectedRoute, executor, executorConfig) {
  return createCallTemplateRuntime({
    live: {
      opted_in: true,
      executor,
      executor_config: executorConfig,
      allowed_template_ids: selectedRoute.templateIds,
      opt_in_env: selectedRoute.optInEnv,
      opt_in_flag: OPT_IN_FLAG,
    },
    evidenceLimit: selectedRoute.templateIds.length,
  });
}

async function runReadOnlySmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase, route: selectedRoute }) {
  const templateIds = selectedRoute.templateIds;
  const exampleInputsById = selectedRoute.inputBuilder(liveRuntime, fixtureInputsForRun, templateIds);
  const exampleRefsById = selectedRoute.refsBuilder(fixtureInputsForRun);
  const executions = [];

  for (const [index, id] of templateIds.entries()) {
    const response = await liveRuntime.call_template({
      id,
      input: exampleInputsById[id] ?? {},
      refs: exampleRefsById[id] ?? [],
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });
    executions.push(summarizeExecution(response));
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? selectedRoute.passReason : firstBlocker(executions) ?? selectedRoute.failReason,
    attempted_template_ids: templateIds,
    executions,
  };
}

async function runFirstRealA1Smoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase, artifactRoot }) {
  const stateRuntime = createGetStateArtifactRuntime({ artifactRoot });
  const executions = [];
  const artifactRefsBySchema = new Map();
  const attempted = [];

  for (const [index, spec] of FIRST_REAL_A1_TEMPLATE_SPECS.entries()) {
    const dependency = dependencyBlocker(spec, artifactRefsBySchema);
    if (dependency) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: "dependency_artifact_unavailable",
        dependency,
      });
      continue;
    }

    const consumedReadbacks = [];
    for (const schema of spec.consumes ?? []) {
      const ref = artifactRefsBySchema.get(schema);
      consumedReadbacks.push(await readBackArtifact(stateRuntime, ref, schema));
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: firstRealA1Input(spec),
      refs: firstRealA1Refs(spec, fixtureInputsForRun, artifactRefsBySchema),
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.consumed_readbacks = consumedReadbacks;

    const producedRef = producedArtifactRef(response);
    if (response?.ok && producedRef) {
      artifactRefsBySchema.set(spec.schema, producedRef);
      execution.produced_readback = await readBackArtifact(stateRuntime, producedRef, spec.schema);
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) =>
    execution.ok &&
      execution.produced_readback?.summary_ok === true &&
      execution.produced_readback?.payload_ok === true &&
      (execution.consumed_readbacks ?? []).every((readback) => readback.summary_ok && readback.payload_ok),
  );

  return {
    ok,
    reason: ok ? "first_real_fixture_a1_live_readback_passed" : firstBlocker(executions) ?? "first_real_fixture_a1_live_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
    artifact_refs: Object.fromEntries([...artifactRefsBySchema.entries()].map(([schema, ref]) => [schema, ref])),
    executions,
  };
}

async function runFirstRealA2Smoke({
  liveRuntime,
  fixtureInputs: fixtureInputsForRun,
  contextBase,
  artifactRoot,
  renderRoot,
}) {
  const stateRuntime = createGetStateArtifactRuntime({ artifactRoot });
  const executions = [];
  const artifactRefsBySchema = new Map();
  const attempted = [];
  let renderJobRef = null;
  let physicalOutput = null;

  const renderSpec = FIRST_REAL_A2_TEMPLATE_SPECS[0];
  attempted.push(renderSpec.id);
  const renderResponse = await liveRuntime.call_template({
    id: renderSpec.id,
    input: firstRealA2RenderInput(),
    refs: {
      region_ref: regionObjectRefFromFixture(fixtureInputsForRun.region_ref),
    },
    context: {
      ...contextBase,
      created_at: new Date().toISOString(),
      request_sequence: 1,
    },
  });
  const renderExecution = summarizeExecution(renderResponse);
  renderExecution.operation = renderSpec.operation;

  for (const [schema, ref] of producedArtifactRefsBySchema(renderResponse)) {
    artifactRefsBySchema.set(schema, ref);
  }
  renderJobRef = producedJobRef(renderResponse);
  const outputRef = artifactRefsBySchema.get(renderSpec.output_schema);
  const evidenceRef = artifactRefsBySchema.get(renderSpec.evidence_schema);
  if (renderResponse?.ok && outputRef && evidenceRef) {
    renderExecution.produced_readbacks = [
      await readBackArtifact(stateRuntime, outputRef, renderSpec.output_schema),
      await readBackArtifact(stateRuntime, evidenceRef, renderSpec.evidence_schema),
    ];
    physicalOutput = await physicalOutputReadback({
      renderRoot,
      outputReadback: renderExecution.produced_readbacks[0],
    });
    renderExecution.physical_output = physicalOutput;
  }
  executions.push(renderExecution);

  const deliverySpec = FIRST_REAL_A2_TEMPLATE_SPECS[1];
  const dependency = firstRealA2DeliveryDependencyBlocker({
    artifactRefsBySchema,
    renderExecution,
    physicalOutput,
  });
  if (dependency) {
    executions.push({
      id: deliverySpec.id,
      ok: false,
      skipped: true,
      reason: "dependency_render_evidence_unavailable",
      dependency,
      operation: deliverySpec.operation,
    });
  } else {
    const consumedReadbacks = [
      await readBackArtifact(stateRuntime, outputRef, renderSpec.output_schema),
      await readBackArtifact(stateRuntime, evidenceRef, renderSpec.evidence_schema),
    ];
    attempted.push(deliverySpec.id);
    const deliveryResponse = await liveRuntime.call_template({
      id: deliverySpec.id,
      input: firstRealA2DeliveryInput(),
      refs: firstRealA2DeliveryRefs({
        fixtureInputs: fixtureInputsForRun,
        outputRef,
        evidenceRef,
        renderJobRef,
      }),
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: 2,
      },
    });
    const deliveryExecution = summarizeExecution(deliveryResponse);
    deliveryExecution.operation = deliverySpec.operation;
    deliveryExecution.consumed_readbacks = consumedReadbacks;
    const deliveryRef = producedArtifactRef(deliveryResponse);
    if (deliveryResponse?.ok && deliveryRef) {
      artifactRefsBySchema.set(deliverySpec.schema, deliveryRef);
      deliveryExecution.produced_readback = await readBackArtifact(stateRuntime, deliveryRef, deliverySpec.schema);
    }
    executions.push(deliveryExecution);
  }

  const ok = executions.every((execution) =>
    execution.ok &&
      (execution.produced_readback === undefined ||
        (execution.produced_readback.summary_ok === true && execution.produced_readback.payload_ok === true)) &&
      (execution.produced_readbacks === undefined ||
        execution.produced_readbacks.every((readback) => readback.summary_ok === true && readback.payload_ok === true)) &&
      (execution.consumed_readbacks === undefined ||
        execution.consumed_readbacks.every((readback) => readback.summary_ok === true && readback.payload_ok === true)) &&
      (execution.physical_output === undefined || execution.physical_output.ok === true),
  );

  return {
    ok,
    reason: ok ? "first_real_fixture_a2_render_delivery_readback_passed" : firstBlocker(executions) ?? "first_real_fixture_a2_render_delivery_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
    artifact_refs: Object.fromEntries([...artifactRefsBySchema.entries()].map(([schema, ref]) => [schema, ref])),
    job_ref: renderJobRef,
    physical_output: physicalOutput,
    executions,
  };
}

function dependencyBlocker(spec, artifactRefsBySchema) {
  const missing = (spec.consumes ?? []).filter((schema) => !artifactRefsBySchema.has(schema));
  return missing.length > 0 ? { missing_schemas: missing } : null;
}

function firstRealA1Input(spec) {
  if (spec.id === "template.analysis.detect_loop_candidates") {
    return {
      max_candidates: 8,
      min_loop_seconds: 1,
      max_loop_seconds: 12,
    };
  }
  if (spec.id === "template.analysis.measure_loop_click_risk") {
    return {
      boundary_window_ms: 20,
      max_candidates: 8,
    };
  }
  if (spec.id === "template.analysis.create_loop_qa_report") {
    return {
      max_report_rows: 8,
    };
  }
  return {
    max_report_rows: 32,
    marker_region_limit: 64,
    tempo_marker_limit: 32,
    include_markers: true,
    include_regions: true,
    include_metadata: true,
    include_tempo: true,
    include_project_fingerprint: true,
  };
}

function firstRealA1Refs(spec, fixtureInputsForRun, artifactRefsBySchema) {
  if (spec.id === "template.analysis.detect_loop_candidates") {
    return {
      item_ref: itemObjectRefFromFixture(fixtureInputsForRun.item_ref),
    };
  }
  if (spec.id === "template.analysis.measure_loop_click_risk") {
    return {
      item_ref: itemObjectRefFromFixture(fixtureInputsForRun.item_ref),
      candidate_artifact_ref: artifactObjectRef(
        artifactRefsBySchema.get("analysis.loop_candidates.v1"),
        "analysis.loop_candidates.v1",
      ),
    };
  }
  if (spec.id === "template.analysis.create_loop_qa_report") {
    return {
      candidate_artifact_ref: artifactObjectRef(
        artifactRefsBySchema.get("analysis.loop_candidates.v1"),
        "analysis.loop_candidates.v1",
      ),
      click_risk_artifact_ref: artifactObjectRef(
        artifactRefsBySchema.get("analysis.loop_click_risk.v1"),
        "analysis.loop_click_risk.v1",
      ),
    };
  }
  const projectRef = projectObjectRefFromFixture(fixtureInputsForRun.project_ref);
  return projectRef ? { project_ref: projectRef } : {};
}

function firstRealA2RenderInput() {
  return {
    format: "wav",
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
    sample_rate_hz: 48000,
    bit_depth: 24,
    channel_count: 2,
    include_sidecar_manifest: false,
  };
}

function firstRealA2DeliveryInput() {
  return {
    max_report_rows: 12,
    include_output_metadata: true,
    include_job_evidence: true,
    include_region_summary: true,
  };
}

function firstRealA2DeliveryRefs({ fixtureInputs, outputRef, evidenceRef, renderJobRef }) {
  const refs = {
    output_artifact_refs: artifactObjectRef(outputRef, "render.region_wav_output.v1"),
    render_job_evidence_ref: artifactObjectRef(evidenceRef, "render.render_job_evidence.v1"),
    region_ref: regionObjectRefFromFixture(fixtureInputs.region_ref),
  };
  if (renderJobRef) refs.job_ref = renderJobRef;
  return refs;
}

function firstRealA2DeliveryDependencyBlocker({ artifactRefsBySchema, renderExecution, physicalOutput }) {
  const missing = [
    "render.region_wav_output.v1",
    "render.render_job_evidence.v1",
  ].filter((schema) => !artifactRefsBySchema.has(schema));
  if (missing.length > 0) return { missing_schemas: missing };
  if (!renderExecution?.ok) return { render_ok: false };
  const readbacks = renderExecution.produced_readbacks ?? [];
  const failedReadback = readbacks.find((readback) => !readback.summary_ok || !readback.payload_ok);
  if (failedReadback) {
    return {
      failed_readback_schema: failedReadback.schema,
      failed_readback_error: failedReadback.error,
    };
  }
  if (!physicalOutput?.ok) {
    return {
      physical_output_ok: false,
      reason: physicalOutput?.reason ?? "physical_output_missing",
    };
  }
  return null;
}

async function readBackArtifact(stateRuntime, ref, schema) {
  const summary = await stateRuntime.get_state({
    scope: "artifact",
    artifact_ref: ref,
    view: "summary",
  });
  const payload = await stateRuntime.get_state({
    scope: "artifact",
    artifact_ref: ref,
    view: "payload",
  });
  const summaryArtifact = summary?.result?.artifact ?? {};
  const payloadArtifact = payload?.result?.artifact ?? {};
  const summaryFacts = isPlainObjectForReport(summaryArtifact.summary) ? summaryArtifact.summary : {};
  const payloadFacts = isPlainObjectForReport(payloadArtifact.payload) ? payloadArtifact.payload : {};
  return {
    ref,
    schema,
    get_state_contract: summary?.contract ?? null,
    summary_ok: Boolean(summary?.ok),
    payload_ok: Boolean(payload?.ok),
    summary_view: summaryArtifact.view ?? null,
    payload_view: payloadArtifact.view ?? null,
    summary_schema: summaryArtifact.schema ?? null,
    payload_schema: payloadArtifact.schema ?? null,
    summary_keys: objectKeys(summaryArtifact.summary),
    payload_keys: objectKeys(payloadArtifact.payload),
    facts: compactArtifactFacts(summaryFacts, payloadFacts),
    summary_response_bytes: summary?.budget?.response_bytes ?? null,
    payload_response_bytes: payload?.budget?.response_bytes ?? null,
    last_result_updated: Boolean(summary?.last_result?.updated || payload?.last_result?.updated),
    error: summary?.ok && payload?.ok
      ? null
      : {
          summary_code: summary?.error?.code ?? null,
          payload_code: payload?.error?.code ?? null,
        },
  };
}

function compactArtifactFacts(summary, payload) {
  const output = isPlainObjectForReport(payload.output) ? payload.output : payload;
  return pruneNullValues({
    artifact_ref: summary.artifact_ref,
    output_basename: summary.output_basename ?? output.output_basename,
    managed_relative_path: summary.managed_relative_path ?? output.managed_relative_path,
    file_size_bytes: summary.file_size_bytes ?? output.file_size_bytes,
    wav_header: summary.wav_header ?? output.wav_header,
    output_count: summary.output_count,
    nonempty_output_count: summary.nonempty_output_count,
    report_row_count: summary.report_row_count,
    issue_count: summary.issue_count,
  });
}

async function physicalOutputReadback({ renderRoot, outputReadback }) {
  const relative = outputReadback?.facts?.managed_relative_path;
  if (typeof relative !== "string" || relative.includes("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      reason: "managed_relative_path_missing",
    };
  }
  const outputPath = path.resolve(renderRoot, relative);
  const root = path.resolve(renderRoot);
  if (!isPathInside(outputPath, root)) {
    return {
      ok: false,
      reason: "managed_relative_path_escaped_root",
    };
  }
  try {
    const stats = await stat(outputPath);
    const header = await readFile(outputPath, { encoding: null });
    const wavHeader = header.length >= 12 &&
      header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WAVE";
    return {
      ok: stats.isFile() && stats.size > 0 && wavHeader,
      output_basename: path.basename(outputPath),
      managed_relative_path: relative,
      file_size_bytes: stats.size,
      wav_header: wavHeader,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "physical_output_unreadable",
      message: boundedString(error?.message),
    };
  }
}

async function firstRealA1ConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const artifactRootBlocker = await firstRealA1ArtifactRootBlocker(fixtureInputsForRun.artifact_root);
  if (artifactRootBlocker) return artifactRootBlocker;

  const transportDir = executorConfig.config?.transport_dir;
  const requestsDir = transportDir ? `${transportDir}/requests` : null;
  const resultsDir = transportDir ? `${transportDir}/results` : null;
  const missingTransport = [];
  for (const [label, path] of [
    ["transport_dir", transportDir],
    ["requests_dir", requestsDir],
    ["results_dir", resultsDir],
  ]) {
    if (!(await isDirectory(path))) missingTransport.push(label);
  }
  if (missingTransport.length > 0) {
    return {
      reason: "live_bridge_transport_absent",
      blocker: "live_bridge_transport_absent",
      message: "Configured live bridge transport directory is absent or incomplete.",
      details: {
        missing: missingTransport,
        transport_dir: boundedString(transportDir, 240),
        requests_dir: boundedString(requestsDir, 240),
        results_dir: boundedString(resultsDir, 240),
      },
    };
  }

  if (!(await isReadableFile(executorConfig.config?.bridge_script_path))) {
    return {
      reason: "reaper_bridge_script_absent",
      blocker: "reaper_bridge_script_absent",
      message: "Configured REAPER bridge script is absent; live bridge transport cannot handshake.",
      details: {
        bridge_script_path: boundedString(executorConfig.config?.bridge_script_path, 240),
      },
    };
  }
  return null;
}

async function firstRealA2ConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const rootBlocker = await firstRealA2RootBlocker(fixtureInputsForRun);
  if (rootBlocker) return rootBlocker;
  return readOnlyConfiguredBlocker({ executorConfig });
}

async function firstRealA2RootBlocker(fixtureInputsForRun) {
  const artifactBlocker = await firstRealA2DirectoryBlocker({
    value: fixtureInputsForRun.artifact_root,
    envName: FIRST_REAL_A2_ARTIFACT_ROOT_ENV,
    label: "artifact_root",
    notConfigured: "artifact_root_not_configured",
    absent: "artifact_root_absent",
  });
  if (artifactBlocker) return artifactBlocker;

  const renderBlocker = await firstRealA2DirectoryBlocker({
    value: fixtureInputsForRun.render_root,
    envName: FIRST_REAL_A2_RENDER_ROOT_ENV,
    label: "render_root",
    notConfigured: "render_root_not_configured",
    absent: "render_root_absent",
  });
  if (renderBlocker) return renderBlocker;

  for (const [label, value] of [
    ["artifact_root", fixtureInputsForRun.artifact_root],
    ["render_root", fixtureInputsForRun.render_root],
  ]) {
    const repoBlocker = firstRealA2RepoRootBlocker(label, value);
    if (repoBlocker) return repoBlocker;
  }
  return null;
}

async function firstRealA2DirectoryBlocker({ value, envName, label, notConfigured, absent }) {
  if (!value) {
    return {
      reason: notConfigured,
      blocker: notConfigured,
      message: `First-Real-Fixture-A A2 live smoke requires an explicit ${label}.`,
      details: {
        [`${label}_env`]: envName,
      },
    };
  }
  if (!path.isAbsolute(value) || value.startsWith("file://")) {
    return {
      reason: `${label}_invalid`,
      blocker: `${label}_invalid`,
      message: `Configured First-Real-Fixture-A A2 ${label} must be an absolute filesystem directory.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  if (!(await isDirectory(value))) {
    return {
      reason: absent,
      blocker: absent,
      message: `Configured First-Real-Fixture-A A2 ${label} is absent.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  return null;
}

function firstRealA2RepoRootBlocker(label, value) {
  const resolved = path.resolve(value);
  const forbiddenRoots = [
    path.resolve(new URL("..", import.meta.url).pathname),
    "/Users/Zhuanz/Documents/streetlight-reaper-mcp",
  ];
  const forbidden = forbiddenRoots.find((root) => isPathInside(resolved, root));
  if (!forbidden) return null;
  return {
    reason: `${label}_inside_repo`,
    blocker: `${label}_inside_repo`,
    message: `Configured First-Real-Fixture-A A2 ${label} must be outside the OpenReaper and old-control repos.`,
    details: {
      [label]: boundedString(resolved, 240),
      forbidden_root: boundedString(forbidden, 240),
    },
  };
}

async function firstRealA1ArtifactRootBlocker(artifactRoot) {
  if (!artifactRoot) {
    return {
      reason: "artifact_root_not_configured",
      blocker: "artifact_root_not_configured",
      message: "First-Real-Fixture-A A1 live smoke requires an explicit artifact root.",
      details: {
        artifact_root_env: FIRST_REAL_A1_ARTIFACT_ROOT_ENV,
      },
    };
  }
  if (!(await isDirectory(artifactRoot))) {
    return {
      reason: "artifact_root_absent",
      blocker: "artifact_root_absent",
      message: "Configured First-Real-Fixture-A A1 artifact root is absent.",
      details: {
        artifact_root_env: FIRST_REAL_A1_ARTIFACT_ROOT_ENV,
        artifact_root: boundedString(artifactRoot, 240),
      },
    };
  }
  return null;
}

async function isDirectory(path) {
  if (!path) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isReadableFile(path) {
  if (!path) return false;
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readOnlyConfiguredBlocker({ executorConfig }) {
  const transportDir = executorConfig.config?.transport_dir;
  const requestsDir = transportDir ? `${transportDir}/requests` : null;
  const resultsDir = transportDir ? `${transportDir}/results` : null;
  const missingTransport = [];
  for (const [label, path] of [
    ["transport_dir", transportDir],
    ["requests_dir", requestsDir],
    ["results_dir", resultsDir],
  ]) {
    if (!(await isDirectory(path))) missingTransport.push(label);
  }
  if (missingTransport.length > 0) {
    return {
      reason: "live_bridge_transport_absent",
      blocker: "live_bridge_transport_absent",
      message: "Configured live bridge transport directory is absent or incomplete.",
      details: {
        missing: missingTransport,
        transport_dir: boundedString(transportDir, 240),
        requests_dir: boundedString(requestsDir, 240),
        results_dir: boundedString(resultsDir, 240),
      },
    };
  }

  if (!(await isReadableFile(executorConfig.config?.bridge_script_path))) {
    return {
      reason: "reaper_bridge_script_absent",
      blocker: "reaper_bridge_script_absent",
      message: "Configured REAPER bridge script is absent; live bridge transport cannot handshake.",
      details: {
        bridge_script_path: boundedString(executorConfig.config?.bridge_script_path, 240),
      },
    };
  }
  return null;
}

function catalogExampleInputs(liveRuntime, templateIds) {
  const menu = liveRuntime.list_templates({
    ids: templateIds,
    fields: ["examples"],
  });
  return Object.fromEntries(
    menu.items.map((item) => [item.id, cloneJson(item.examples?.[0]?.input ?? {})]),
  );
}

function wave1AInputs(liveRuntime, fixtureInputsForRun, templateIds) {
  const inputs = catalogExampleInputs(liveRuntime, templateIds);
  if (fixtureInputsForRun.track_ref) {
    inputs["template.tracks.resolve_track_ref"] = { track_ref: fixtureInputsForRun.track_ref };
  }
  if (fixtureInputsForRun.item_ref) {
    inputs["template.items.resolve_item_ref"] = { ref: fixtureInputsForRun.item_ref };
  }
  return inputs;
}

function wave1ARefs(fixtureInputsForRun) {
  return {
    "template.items.read_item_summary": {
      item_ref: itemObjectRefFromFixture(fixtureInputsForRun.item_ref),
    },
  };
}

function readBInputs(_liveRuntime, fixtureInputsForRun) {
  return {
    "template.actions.resolve_named_command": {
      named_command: fixtureInputsForRun.named_command,
      section: fixtureInputsForRun.action_section,
    },
    "template.actions.read_action_metadata": {
      section: fixtureInputsForRun.action_section,
      command_id: fixtureInputsForRun.action_command_id,
    },
    "template.actions.read_action_toggle_state": {
      section: fixtureInputsForRun.action_section,
      command_id: fixtureInputsForRun.action_toggle_command_id,
    },
    "template.actions.read_action_shortcuts": {
      section: fixtureInputsForRun.action_section,
      command_id: fixtureInputsForRun.action_command_id,
      max_shortcuts: 8,
    },
    "template.actions.parse_marker_action_text": {
      text: fixtureInputsForRun.marker_action_text,
      section: fixtureInputsForRun.action_section,
      resolve_tokens: true,
    },
    "template.actions.search_action_commands": {
      section: fixtureInputsForRun.action_section,
      query: fixtureInputsForRun.action_search_query,
      limit: fixtureInputsForRun.action_search_limit,
    },
    "template.midi.resolve_midi_take_ref": {
      ref: fixtureInputsForRun.midi_take_ref,
    },
    "template.midi.read_take_event_counts": {},
    "template.midi.list_take_notes": {
      limit: 16,
      include_project_time: true,
    },
    "template.midi.list_take_cc_events": {
      controller: 1,
      limit: 16,
    },
    "template.midi.list_take_text_sysex_events": {
      event_kind: "any",
      limit: 16,
    },
    "template.midi.read_take_grid": {},
    "template.media.probe_file": {
      path: fixtureInputsForRun.media_path,
      include_metadata_keys: true,
    },
    "template.media.read_take_source": {
      include_metadata_keys: true,
      include_parent_source: false,
    },
    "template.media.read_project_media_files": {
      include_offline: true,
      include_metadata_keys: false,
      max_sources: 25,
    },
  };
}

function readBRefs(fixtureInputsForRun) {
  const midiTakeRef = takeObjectRefFromFixture(fixtureInputsForRun.midi_take_ref);
  const audioTakeRef = takeObjectRefFromFixture(fixtureInputsForRun.audio_take_ref);
  return {
    "template.midi.read_take_event_counts": { take_ref: midiTakeRef },
    "template.midi.list_take_notes": { take_ref: midiTakeRef },
    "template.midi.list_take_cc_events": { take_ref: midiTakeRef },
    "template.midi.list_take_text_sysex_events": { take_ref: midiTakeRef },
    "template.midi.read_take_grid": { take_ref: midiTakeRef },
    "template.media.read_take_source": { take_ref: audioTakeRef },
  };
}

function liveSmokeFixtureInputs(env) {
  const trackRef = nonEmpty(env[TRACK_REF_ENV]);
  const itemRef = normalizeItemFixtureRef(nonEmpty(env[ITEM_REF_ENV])) ?? "selected:0";
  return {
    track_ref: trackRef,
    item_ref: itemRef,
    report: {
      track_ref_env: TRACK_REF_ENV,
      item_ref_env: ITEM_REF_ENV,
      track_ref: trackRef,
      item_ref: itemRef,
      applies_to_template_ids: [
        "template.tracks.resolve_track_ref",
        "template.items.resolve_item_ref",
        "template.items.read_item_summary",
      ],
    },
  };
}

function readBFixtureInputs(env) {
  const actionSection = normalizeActionSection(nonEmpty(env[READ_B_ACTION_SECTION_ENV])) ?? "main";
  const actionCommandId = positiveInteger(env[READ_B_ACTION_COMMAND_ID_ENV], 40044);
  const actionToggleCommandId = positiveInteger(env[READ_B_ACTION_TOGGLE_COMMAND_ID_ENV], 40364);
  const namedCommand = nonEmpty(env[READ_B_NAMED_COMMAND_ENV]) ?? "_OPENREAPER_READ_B_NO_SUCH_COMMAND";
  const actionSearchQuery = nonEmpty(env[READ_B_ACTION_SEARCH_QUERY_ENV]) ?? "marker";
  const actionSearchLimit = Math.min(
    positiveInteger(env[READ_B_ACTION_SEARCH_LIMIT_ENV], READ_B_ACTION_SEARCH_DEFAULT_LIMIT),
    READ_B_ACTION_SEARCH_MAX_LIMIT,
  );
  const markerActionText = nonEmpty(env[READ_B_MARKER_ACTION_TEXT_ENV]) ?? "!40044 !40364";
  const midiTakeRef = normalizeTakeFixtureRef(nonEmpty(env[READ_B_MIDI_TAKE_REF_ENV])) ?? "selected:0";
  const audioTakeRef = normalizeTakeFixtureRef(nonEmpty(env[READ_B_AUDIO_TAKE_REF_ENV])) ?? "take:index:0";
  const mediaPath = nonEmpty(env[READ_B_MEDIA_PATH_ENV]) ?? "/Users/Shared/OpenReaper/read-b-fixture/read-b-tone.wav";
  return {
    action_section: actionSection,
    action_command_id: actionCommandId,
    action_toggle_command_id: actionToggleCommandId,
    named_command: namedCommand,
    action_search_query: actionSearchQuery,
    action_search_limit: actionSearchLimit,
    marker_action_text: markerActionText,
    midi_take_ref: midiTakeRef,
    audio_take_ref: audioTakeRef,
    media_path: mediaPath,
    report: {
      action_section_env: READ_B_ACTION_SECTION_ENV,
      action_command_id_env: READ_B_ACTION_COMMAND_ID_ENV,
      action_toggle_command_id_env: READ_B_ACTION_TOGGLE_COMMAND_ID_ENV,
      named_command_env: READ_B_NAMED_COMMAND_ENV,
      action_search_query_env: READ_B_ACTION_SEARCH_QUERY_ENV,
      action_search_limit_env: READ_B_ACTION_SEARCH_LIMIT_ENV,
      marker_action_text_env: READ_B_MARKER_ACTION_TEXT_ENV,
      midi_take_ref_env: READ_B_MIDI_TAKE_REF_ENV,
      audio_take_ref_env: READ_B_AUDIO_TAKE_REF_ENV,
      media_path_env: READ_B_MEDIA_PATH_ENV,
      action_section: actionSection,
      action_command_id: actionCommandId,
      action_toggle_command_id: actionToggleCommandId,
      named_command: namedCommand,
      action_search_query: actionSearchQuery,
      action_search_limit: actionSearchLimit,
      marker_action_text: markerActionText,
      midi_take_ref: midiTakeRef,
      audio_take_ref: audioTakeRef,
      media_path: boundedString(mediaPath, 240),
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
    },
  };
}

function firstRealA1FixtureInputs(env) {
  const itemRef = normalizeItemFixtureRef(nonEmpty(env[FIRST_REAL_A1_ITEM_REF_ENV])) ?? "selected:0";
  const projectRef = normalizeProjectFixtureRef(nonEmpty(env[FIRST_REAL_A1_PROJECT_REF_ENV]));
  const artifactRoot = nonEmpty(env[FIRST_REAL_A1_ARTIFACT_ROOT_ENV]);
  return {
    item_ref: itemRef,
    project_ref: projectRef,
    artifact_root: artifactRoot,
    report: {
      item_ref_env: FIRST_REAL_A1_ITEM_REF_ENV,
      project_ref_env: FIRST_REAL_A1_PROJECT_REF_ENV,
      artifact_root_env: FIRST_REAL_A1_ARTIFACT_ROOT_ENV,
      item_ref: itemRef,
      project_ref: projectRef,
      artifact_root: boundedString(artifactRoot, 240),
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
    },
  };
}

function firstRealA2FixtureInputs(env) {
  const regionRef = normalizeRegionFixtureRef(nonEmpty(env[FIRST_REAL_A2_REGION_REF_ENV])) ?? "region:index:0";
  const projectRef = normalizeProjectFixtureRef(nonEmpty(env[FIRST_REAL_A2_PROJECT_REF_ENV]));
  const artifactRoot = nonEmpty(env[FIRST_REAL_A2_ARTIFACT_ROOT_ENV]);
  const renderRoot = nonEmpty(env[FIRST_REAL_A2_RENDER_ROOT_ENV]);
  return {
    region_ref: regionRef,
    project_ref: projectRef,
    artifact_root: artifactRoot,
    render_root: renderRoot,
    report: {
      region_ref_env: FIRST_REAL_A2_REGION_REF_ENV,
      project_ref_env: FIRST_REAL_A2_PROJECT_REF_ENV,
      artifact_root_env: FIRST_REAL_A2_ARTIFACT_ROOT_ENV,
      render_root_env: FIRST_REAL_A2_RENDER_ROOT_ENV,
      region_ref: regionRef,
      project_ref: projectRef,
      artifact_root: boundedString(artifactRoot, 240),
      render_root: boundedString(renderRoot, 240),
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
    },
  };
}

function itemObjectRefFromFixture(itemRef) {
  const parsed = parseItemFixtureRef(itemRef) ?? parseItemFixtureRef("selected:0");
  return createObjectRef("item", parsed.identity, { ref: parsed.ref });
}

function regionObjectRefFromFixture(regionRef) {
  const parsed = parseRegionFixtureRef(regionRef) ?? parseRegionFixtureRef("region:index:0");
  return createObjectRef("region", parsed.identity, { ref: parsed.ref });
}

function takeObjectRefFromFixture(takeRef) {
  const parsed = parseTakeFixtureRef(takeRef) ?? parseTakeFixtureRef("selected:0");
  return createObjectRef("take", parsed.identity, { ref: parsed.ref });
}

function projectObjectRefFromFixture(projectRef) {
  const normalized = normalizeProjectFixtureRef(projectRef);
  if (!normalized) return null;
  return createObjectRef("project", { scheme: "current", value: "current" }, { ref: normalized });
}

function artifactObjectRef(ref, schema) {
  const parts = parseArtifactRef(ref);
  return createObjectRef("artifact", { scheme: "artifact_ref", value: ref }, {
    ref,
    summary: {
      schema,
      owner_pack: parts.owner_pack,
      scope: parts.scope,
    },
  });
}

function normalizeItemFixtureRef(itemRef) {
  return parseItemFixtureRef(itemRef)?.input_ref ?? null;
}

function normalizeTakeFixtureRef(takeRef) {
  return parseTakeFixtureRef(takeRef)?.input_ref ?? null;
}

function normalizeRegionFixtureRef(regionRef) {
  return parseRegionFixtureRef(regionRef)?.input_ref ?? null;
}

function parseItemFixtureRef(itemRef) {
  const token = String(itemRef ?? "").trim();
  for (const scheme of ["selected", "index", "guid"]) {
    const prefix = `${scheme}:`;
    const typedPrefix = `item:${scheme}:`;
    if (token.startsWith(typedPrefix)) {
      const value = token.slice(typedPrefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: token };
    }
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: `item:${scheme}:${value}` };
    }
  }
  return null;
}

function parseRegionFixtureRef(regionRef) {
  const token = String(regionRef ?? "").trim();
  for (const scheme of ["index", "name", "guid"]) {
    const prefix = `${scheme}:`;
    const typedPrefix = `region:${scheme}:`;
    if (token.startsWith(typedPrefix)) {
      const value = token.slice(typedPrefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: token };
    }
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: `region:${scheme}:${value}` };
    }
  }
  return null;
}

function parseTakeFixtureRef(takeRef) {
  const token = String(takeRef ?? "").trim();
  for (const scheme of ["selected", "index", "guid"]) {
    const prefix = `${scheme}:`;
    const typedPrefix = `take:${scheme}:`;
    if (token.startsWith(typedPrefix)) {
      const value = token.slice(typedPrefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: token };
    }
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: `take:${scheme}:${value}` };
    }
  }
  return null;
}

function normalizeProjectFixtureRef(projectRef) {
  const token = String(projectRef ?? "").trim();
  if (token === "" || token === "current" || token === "project:current") return token ? "project:current" : null;
  return null;
}

function normalizeActionSection(value) {
  if (["main", "midi_editor", "midi_event_list", "media_explorer", "crossfade_editor"].includes(value)) {
    return value;
  }
  return null;
}

function liveContextBase() {
  return {
    session_id: nonEmpty(process.env[SESSION_ENV]) ?? `openreaper-live-smoke-${process.pid}`,
    expected_owner: nonEmpty(process.env[OWNER_ENV]) ?? "openreaper-live-smoke",
    expected_generation: positiveInteger(process.env[GENERATION_ENV], 1),
  };
}

function contextSummary(contextBase) {
  return {
    session_id: contextBase.session_id,
    expected_owner: contextBase.expected_owner,
    expected_generation: contextBase.expected_generation,
  };
}

function summarizeExecution(response) {
  const result = response?.result ?? {};
  const lastResult = result.last_result ?? {};
  return {
    id: response?.template?.id ?? null,
    ok: Boolean(response?.ok),
    request_id: response?.request?.id ?? null,
    bridge: {
      expected_owner: response?.request?.bridge?.expected_owner ?? null,
      expected_generation: response?.request?.bridge?.expected_generation ?? null,
      owner: response?.bridge?.owner ?? null,
      generation: response?.bridge?.generation ?? null,
    },
    error: response?.ok
      ? null
      : {
          source: response?.error?.source ?? null,
          code: response?.error?.code ?? null,
          message: boundedString(response?.error?.message),
          details: boundedDetails(response?.error?.details),
        },
    counts: {
      refs: Array.isArray(result.refs) ? result.refs.length : 0,
      artifacts: Array.isArray(result.artifacts) ? result.artifacts.length : 0,
      jobs: Array.isArray(result.jobs) ? result.jobs.length : 0,
      last_result_refs: Array.isArray(lastResult.refs) ? lastResult.refs.length : 0,
    },
    summary: compactSummary(result.summary),
    artifact_refs: Array.isArray(result.artifacts)
      ? result.artifacts.map((artifact) => artifact.ref).filter(Boolean)
      : [],
    last_result_updated: Boolean(lastResult.updated),
    budget: {
      response_bytes: response?.budget?.response_bytes ?? null,
      bridge_response_bytes: response?.budget?.bridge_response_bytes ?? null,
      truncated: Boolean(response?.budget?.truncated),
    },
  };
}

function producedArtifactRef(response) {
  const artifacts = response?.result?.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  const ref = artifacts[0]?.ref;
  return typeof ref === "string" ? ref : null;
}

function producedArtifactRefsBySchema(response) {
  const artifacts = response?.result?.artifacts;
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((artifact) => [artifact?.summary?.schema, artifact?.ref])
    .filter(([schema, ref]) => typeof schema === "string" && typeof ref === "string");
}

function producedJobRef(response) {
  const jobs = response?.result?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  return jobs[0] ?? null;
}

async function dispatchFakeFirstRealA1(request, { artifactRoot }) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = FIRST_REAL_A1_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake A1 executor accepts only First-Real-Fixture-A A1 operations.", {
      operation: boundedString(key),
    });
  }
  if (request?.artifacts?.allow !== true) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "First-Real-Fixture-A A1 artifact operations require artifacts.allow true.", {
      operation: key,
    });
  }

  let artifactRef;
  try {
    const artifactId = artifactIdFromCommandId(request.id);
    artifactRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.scope,
      id: artifactId,
    });
    const summary = fakeA1Summary(spec, artifactRef, request);
    const payload = fakeA1Payload(spec, request);
    const envelope = createArtifactStateStoreEnvelope({
      ref: artifactRef,
      schema: spec.schema,
      producer: {
        kind: "template",
        id: spec.id,
        pack: spec.owner_pack,
      },
      created_at: request.created_at,
      summary,
      payload,
    });
    await writeArtifactStateStoreEnvelope({ artifactRoot, envelope });
    return bridgeOkEnvelope(request, {
      summary,
      artifacts: [artifactObjectRef(artifactRef, spec.schema)],
    });
  } catch (error) {
    return bridgeErrorEnvelope(request, "ARTIFACT_INVALID", "Fake A1 executor could not write artifact envelope.", {
      artifact_ref: artifactRef,
      message: boundedString(error?.message),
    });
  }
}

async function dispatchFakeFirstRealA2(request, { artifactRoot, renderRoot }) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = FIRST_REAL_A2_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake A2 executor accepts only First-Real-Fixture-A A2 operations.", {
      operation: boundedString(key),
    });
  }
  if (request?.artifacts?.allow !== true) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "First-Real-Fixture-A A2 operations require artifacts.allow true.", {
      operation: key,
    });
  }
  if (key === "run_job:render.region_wav") {
    return dispatchFakeFirstRealA2Render(request, { artifactRoot, renderRoot, spec });
  }
  return dispatchFakeFirstRealA2Delivery(request, { artifactRoot, spec });
}

async function dispatchFakeFirstRealA2Render(request, { artifactRoot, renderRoot, spec }) {
  if (request?.pack?.risk !== "write") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "A2 render_region_wav must use write risk.", {
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.params?.output_policy !== "openreaper_managed_render_root") {
    return bridgeErrorEnvelope(request, "PARAMS_INVALID", "A2 render_region_wav requires the managed render root output policy.", {
      output_policy: request?.params?.output_policy,
    });
  }
  if (request?.params?.collision_policy !== "fail_if_exists") {
    return bridgeErrorEnvelope(request, "IDEMPOTENCY_CONFLICT", "Fake A2 render supports only the first-pass fail_if_exists collision policy.", {
      collision_policy: request?.params?.collision_policy,
      blocker: "reuse_idempotent_match_not_supported_in_fake",
    });
  }

  const managed = managedRenderOutputForRequest(request);
  const outputPath = path.resolve(renderRoot, managed.relative_path);
  if (!isPathInside(outputPath, path.resolve(renderRoot))) {
    return bridgeErrorEnvelope(request, "PARAMS_INVALID", "Managed render output escaped the configured render root.", {
      blocker: "managed_render_path_escape",
    });
  }

  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, fakeWavFileBytes(), { flag: "wx" });
    const file = await stat(outputPath);
    const artifactId = artifactIdFromCommandId(request.id);
    const outputRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.output_scope,
      id: artifactId,
    });
    const evidenceRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.evidence_scope,
      id: artifactId,
    });
    const jobRef = createObjectRef("job", { scheme: "job_id", value: `render.region_wav.${artifactId}` });
    const regionRef = request.refs?.find((ref) => ref.kind === "region")?.ref ?? "region:index:0";
    const outputSummary = {
      artifact_ref: outputRef,
      schema: spec.output_schema,
      output_basename: managed.basename,
      managed_relative_path: managed.relative_path,
      file_size_bytes: file.size,
      wav_header: true,
      file_count: 1,
      reused_existing: false,
      truncated: false,
    };
    const evidenceSummary = {
      artifact_ref: evidenceRef,
      schema: spec.evidence_schema,
      job_ref: jobRef.ref,
      output_artifact_ref: outputRef,
      region_ref: regionRef,
      collision_policy: request.params.collision_policy,
      verification_status: "passed",
      truncated: false,
    };
    await writeArtifactStateStoreEnvelope({
      artifactRoot,
      envelope: createArtifactStateStoreEnvelope({
        ref: outputRef,
        schema: spec.output_schema,
        producer: {
          kind: "template",
          id: spec.id,
          pack: spec.owner_pack,
        },
        created_at: request.created_at,
        summary: outputSummary,
        payload: {
          fixture: "first_real_fixture_a2_fake",
          smoke_only: true,
          output: outputSummary,
          region: {
            region_ref: regionRef,
          },
        },
      }),
    });
    await writeArtifactStateStoreEnvelope({
      artifactRoot,
      envelope: createArtifactStateStoreEnvelope({
        ref: evidenceRef,
        schema: spec.evidence_schema,
        producer: {
          kind: "template",
          id: spec.id,
          pack: spec.owner_pack,
        },
        created_at: request.created_at,
        summary: evidenceSummary,
        payload: {
          fixture: "first_real_fixture_a2_fake",
          smoke_only: true,
          render_request: {
            format: request.params.format,
            output_policy: request.params.output_policy,
            collision_policy: request.params.collision_policy,
            sample_rate_hz: request.params.sample_rate_hz ?? null,
            bit_depth: request.params.bit_depth ?? null,
            channel_count: request.params.channel_count ?? null,
          },
          output_artifact_ref: outputRef,
          output_basename: managed.basename,
          managed_relative_path: managed.relative_path,
        },
      }),
    });
    return bridgeOkEnvelope(request, {
      summary: {
        job_ref: jobRef.ref,
        output_artifact_ref: outputRef,
        evidence_artifact_ref: evidenceRef,
        format: "wav",
        output_policy: request.params.output_policy,
        collision_policy: request.params.collision_policy,
        file_count: 1,
        reused_existing: false,
        output_basename: managed.basename,
        managed_relative_path: managed.relative_path,
        file_size_bytes: file.size,
        truncated: false,
      },
      artifacts: [
        artifactObjectRef(outputRef, spec.output_schema),
        artifactObjectRef(evidenceRef, spec.evidence_schema),
      ],
      jobs: [jobRef],
    });
  } catch (error) {
    return bridgeErrorEnvelope(request, error?.code === "EEXIST" ? "IDEMPOTENCY_CONFLICT" : "ARTIFACT_INVALID", "Fake A2 render could not write managed output or artifact evidence.", {
      blocker: error?.code === "EEXIST" ? "render_output_exists" : "a2_render_fake_write_failed",
      output_basename: managed.basename,
      message: boundedString(error?.message),
    });
  }
}

async function dispatchFakeFirstRealA2Delivery(request, { artifactRoot, spec }) {
  const outputRef = artifactRefBySchemaFromRequest(request, "render.region_wav_output.v1");
  const evidenceRef = artifactRefBySchemaFromRequest(request, "render.render_job_evidence.v1");
  if (!outputRef || !evidenceRef) {
    return bridgeErrorEnvelope(request, "ARTIFACT_NOT_FOUND", "A2 delivery report requires render output and job evidence artifact refs.", {
      blocker: "render_evidence_refs_missing",
    });
  }

  try {
    const outputEnvelope = await readArtifactEnvelopeFromRoot(artifactRoot, outputRef);
    const evidenceEnvelope = await readArtifactEnvelopeFromRoot(artifactRoot, evidenceRef);
    assertFakeA2ArtifactProducer(outputEnvelope, "template.render.render_region_wav", "render.region_wav_output.v1");
    assertFakeA2ArtifactProducer(evidenceEnvelope, "template.render.render_region_wav", "render.render_job_evidence.v1");
    const artifactId = artifactIdFromCommandId(request.id);
    const reportRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.scope,
      id: artifactId,
    });
    const outputCount = 1;
    const nonemptyOutputCount = Number(outputEnvelope.summary?.file_size_bytes ?? 0) > 0 ? 1 : 0;
    const issueCount = nonemptyOutputCount === outputCount ? 0 : 1;
    const summary = {
      artifact_ref: reportRef,
      schema: spec.schema,
      output_artifact_count: outputCount,
      job_evidence_count: 1,
      region_count: 1,
      nonempty_output_count: nonemptyOutputCount,
      report_row_count: 1,
      issue_count: issueCount,
      truncated: false,
    };
    await writeArtifactStateStoreEnvelope({
      artifactRoot,
      envelope: createArtifactStateStoreEnvelope({
        ref: reportRef,
        schema: spec.schema,
        producer: {
          kind: "template",
          id: spec.id,
          pack: spec.owner_pack,
        },
        created_at: request.created_at,
        summary,
        payload: {
          fixture: "first_real_fixture_a2_fake",
          smoke_only: true,
          consumed_artifact_refs: [outputRef, evidenceRef],
          rows: [
            {
              row: 1,
              output_basename: outputEnvelope.summary.output_basename,
              file_size_bytes: outputEnvelope.summary.file_size_bytes,
              issue_count: issueCount,
            },
          ],
        },
      }),
    });
    return bridgeOkEnvelope(request, {
      summary,
      artifacts: [artifactObjectRef(reportRef, spec.schema)],
    });
  } catch (error) {
    return bridgeErrorEnvelope(request, "ARTIFACT_INVALID", "Fake A2 delivery report could not read render evidence or write report artifact.", {
      blocker: "a2_delivery_report_fake_write_failed",
      message: boundedString(error?.message),
    });
  }
}

function fakeA1Summary(spec, artifactRef, request) {
  if (spec.schema === "analysis.loop_candidates.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      candidate_count: 1,
      analyzed_seconds: 4,
      truncated: false,
    };
  }
  if (spec.schema === "analysis.loop_click_risk.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      measured_candidate_count: 1,
      risk_fact_count: 1,
      truncated: false,
    };
  }
  if (spec.schema === "analysis.loop_qa_report.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      candidate_count: 1,
      risk_fact_count: 1,
      report_row_count: 1,
      truncated: false,
    };
  }
  return {
    artifact_ref: artifactRef,
    schema: spec.schema,
    evidence_family_count: 4,
    report_row_count: 4,
    marker_count: 1,
    region_count: 1,
    metadata_field_count: 1,
    tempo_marker_count: 1,
    project_fingerprint: `fake-${request.id.slice(-6)}`,
    truncated: false,
  };
}

function fakeA1Payload(spec, request) {
  const artifactRefs = Array.isArray(request.refs)
    ? request.refs.filter((ref) => ref.kind === "artifact").map((ref) => ref.ref)
    : [];
  const itemRefs = Array.isArray(request.refs)
    ? request.refs.filter((ref) => ref.kind === "item").map((ref) => ref.ref)
    : [];
  return {
    fixture: "first_real_fixture_a1_fake",
    smoke_only: true,
    template_id: spec.id,
    operation: spec.operation,
    item_refs: itemRefs,
    consumed_artifact_refs: artifactRefs,
    readback_required: true,
  };
}

function bridgeOkEnvelope(request, result) {
  const completedAt = new Date().toISOString();
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: request.id,
    ok: true,
    completed_at: completedAt,
    bridge: {
      owner: request.bridge.expected_owner,
      generation: request.bridge.expected_generation,
    },
    queue: {
      state: "done",
      started_at: completedAt,
      completed_at: completedAt,
    },
    result: {
      summary: result.summary ?? {},
      refs: [],
      artifacts: result.artifacts ?? [],
      jobs: result.jobs ?? [],
      last_result: {
        updated: false,
        refs: [],
        truncated: false,
      },
    },
    undo: {
      mode: request.undo.mode,
      opened: false,
      closed: false,
      label: request.undo.label ?? null,
    },
    verification: {
      mode: request.verification.mode,
      status: "passed",
      checks: request.verification.checks ?? [],
    },
    budget: {
      max_response_bytes: request.budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
    idempotency: {
      key: request.idempotency_key ?? null,
      replayed: false,
    },
  };
  envelope.budget.response_bytes = encodedBytes(envelope);
  validateFoundationBridgeResult(envelope);
  return envelope;
}

function bridgeErrorEnvelope(request, code, message, details) {
  const completedAt = new Date().toISOString();
  const requestId = typeof request?.id === "string" ? request.id : "cmd_invalid";
  const budget = request?.budget ?? { max_response_bytes: 65_536 };
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: requestId,
    ok: false,
    completed_at: completedAt,
    bridge: {
      owner: request?.bridge?.expected_owner ?? "openreaper-live-smoke",
      generation: request?.bridge?.expected_generation ?? 1,
    },
    queue: {
      state: "failed",
      started_at: completedAt,
      completed_at: completedAt,
    },
    error: {
      code,
      message,
      recoverable: true,
      details,
    },
    undo: {
      mode: request?.undo?.mode ?? "none",
      opened: false,
      closed: false,
      label: request?.undo?.label ?? null,
    },
    verification: {
      mode: request?.verification?.mode ?? "none",
      status: "skipped",
      checks: request?.verification?.checks ?? [],
    },
    budget: {
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
    idempotency: {
      key: request?.idempotency_key ?? null,
      replayed: false,
    },
  };
  envelope.budget.response_bytes = encodedBytes(envelope);
  validateFoundationBridgeResult(envelope);
  return envelope;
}

function firstBlocker(executions) {
  for (const execution of executions) {
    const blocker = execution.error?.details?.blocker;
    if (typeof blocker === "string" && blocker) return blocker;
    if (execution.skipped && execution.reason) return execution.reason;
  }
  return null;
}

function boundedDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const bounded = {};
  for (const [key, value] of Object.entries(details).slice(0, 12)) {
    bounded[key] = typeof value === "string" ? boundedString(value, 240) : value;
  }
  return bounded;
}

function compactSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const compact = {};
  for (const [key, value] of Object.entries(summary)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      compact[key] = typeof value === "string" ? boundedString(value, 240) : value;
    }
  }
  return compact;
}

function objectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function managedRenderOutputForRequest(request) {
  const key = typeof request?.idempotency_key === "string" ? request.idempotency_key : request?.id ?? "cmd_unknown";
  const suffix = key.replace(/^template:/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "unknown";
  const basename = `openreaper_a2_${suffix}.wav`;
  return {
    basename,
    relative_path: basename,
  };
}

function fakeWavFileBytes() {
  const dataSize = 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function artifactRefBySchemaFromRequest(request, schema) {
  if (!Array.isArray(request?.refs)) return null;
  const match = request.refs.find((ref) => ref?.kind === "artifact" && ref?.summary?.schema === schema);
  return typeof match?.ref === "string" ? match.ref : null;
}

async function readArtifactEnvelopeFromRoot(artifactRoot, ref) {
  const artifactPath = artifactPathFromRef(artifactRoot, ref);
  return JSON.parse(await readFile(artifactPath, "utf8"));
}

function assertFakeA2ArtifactProducer(envelope, producerId, schema) {
  if (
    envelope?.contract !== "artifact.state_store.v1" ||
    envelope?.schema !== schema ||
    envelope?.owner_pack !== "render" ||
    envelope?.producer?.kind !== "template" ||
    envelope?.producer?.id !== producerId ||
    envelope?.producer?.pack !== "render"
  ) {
    throw new Error(`expected render-owned ${schema} from ${producerId}`);
  }
}

function isPlainObjectForReport(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pruneNullValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  );
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function boundedString(value, maxLength = 240) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 3)}...`;
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

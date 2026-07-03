import { stat } from "node:fs/promises";
import {
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
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
const OPT_IN_FLAG = "--live";
const FIRST_REAL_A1_FLAG = "--first-real-a1";
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
  const artifactRootBlocker = await firstRealA1ArtifactRootBlocker(fixtureInputs.artifact_root);
  if (artifactRootBlocker) {
    console.log(JSON.stringify({
      ...baseReport,
      ok: false,
      skipped: false,
      ...artifactRootBlocker,
      live_pass_claimed: false,
    }));
    process.exit(2);
  }

  const fakeExecutor = {
    config: {
      contract: "first_real_fixture_a1.fake_executor.v1",
      kind: "fake_artifact_writer",
      spawned_reaper: false,
    },
    async dispatch(request) {
      return dispatchFakeFirstRealA1(request, { artifactRoot: fixtureInputs.artifact_root });
    },
  };
  const fakeRuntime = createLiveRuntimeForRoute(route, fakeExecutor, fakeExecutor.config);
  const contextBase = liveContextBase();
  const fakeReport = await runFirstRealA1Smoke({
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

if (route.name === "first-real-a1") {
  const blocker = await firstRealA1ConfiguredBlocker({
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
const routeReport = route.name === "first-real-a1"
  ? await runFirstRealA1Smoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      artifactRoot: fixtureInputs.artifact_root,
    })
  : await runWave1ASmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      templateIds: route.templateIds,
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
      passReason: "first_real_fixture_a1_live_readback_passed",
      failReason: "first_real_fixture_a1_live_readback_failed",
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

async function runWave1ASmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase, templateIds }) {
  const exampleInputsById = exampleInputs(liveRuntime, fixtureInputsForRun, templateIds);
  const exampleRefsById = exampleRefs(fixtureInputsForRun);
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
    reason: ok ? "wave1a_live_read_handlers_passed" : firstBlocker(executions) ?? "wave1a_live_read_handlers_failed",
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

function exampleInputs(liveRuntime, fixtureInputsForRun, templateIds) {
  const menu = liveRuntime.list_templates({
    ids: templateIds,
    fields: ["examples"],
  });
  const inputs = Object.fromEntries(
    menu.items.map((item) => [item.id, cloneJson(item.examples?.[0]?.input ?? {})]),
  );
  if (fixtureInputsForRun.track_ref) {
    inputs["template.tracks.resolve_track_ref"] = { track_ref: fixtureInputsForRun.track_ref };
  }
  if (fixtureInputsForRun.item_ref) {
    inputs["template.items.resolve_item_ref"] = { ref: fixtureInputsForRun.item_ref };
  }
  return inputs;
}

function exampleRefs(fixtureInputsForRun) {
  return {
    "template.items.read_item_summary": {
      item_ref: itemObjectRefFromFixture(fixtureInputsForRun.item_ref),
    },
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

function itemObjectRefFromFixture(itemRef) {
  const parsed = parseItemFixtureRef(itemRef) ?? parseItemFixtureRef("selected:0");
  return createObjectRef("item", parsed.identity, { ref: parsed.ref });
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

function normalizeProjectFixtureRef(projectRef) {
  const token = String(projectRef ?? "").trim();
  if (token === "" || token === "current" || token === "project:current") return token ? "project:current" : null;
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
      jobs: [],
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

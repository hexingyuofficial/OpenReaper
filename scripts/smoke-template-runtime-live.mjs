import {
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  createObjectRef,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
  createLiveBridgeExecutorFromEnv,
} from "../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const OPT_IN_ENV = "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE";
const OPT_IN_FLAG = "--live";
const OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER";
const GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION";
const SESSION_ENV = "OPENREAPER_LIVE_BRIDGE_SESSION_ID";
const TRACK_REF_ENV = "OPENREAPER_LIVE_SMOKE_TRACK_REF";
const ITEM_REF_ENV = "OPENREAPER_LIVE_SMOKE_ITEM_REF";

const optedIn = process.env[OPT_IN_ENV] === "1" || process.argv.includes(OPT_IN_FLAG);
const LIVE_SMOKE_TEMPLATE_IDS = CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS;
const runtime = createCallTemplateRuntime();
const fixtureInputs = liveSmokeFixtureInputs(process.env);
const baseReport = {
  gate: "template-runtime-live",
  contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
  accepted_catalog: runtime.accepted_catalog,
  opt_in_env: OPT_IN_ENV,
  opt_in_flag: OPT_IN_FLAG,
  opted_in: optedIn,
  spawned_reaper: false,
  wave: "wave1a-read-handlers",
  allowed_template_ids: LIVE_SMOKE_TEMPLATE_IDS,
  fixture_inputs: fixtureInputs.report,
};

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
    live_executor_env: LIVE_BRIDGE_EXECUTOR_ENV,
    message: "Opt-in live smoke entered the gate, but no explicit live bridge executor transport was configured.",
  }));
  process.exit(2);
}

const liveRuntime = createCallTemplateRuntime({
  live: {
    opted_in: true,
    executor: executorConfig.executor,
    executor_config: executorConfig.config,
    allowed_template_ids: LIVE_SMOKE_TEMPLATE_IDS,
    opt_in_env: OPT_IN_ENV,
    opt_in_flag: OPT_IN_FLAG,
  },
  evidenceLimit: LIVE_SMOKE_TEMPLATE_IDS.length,
});
const exampleInputsById = exampleInputs(liveRuntime, fixtureInputs);
const exampleRefsById = exampleRefs(fixtureInputs);
const contextBase = liveContextBase();
const executions = [];

for (const [index, id] of LIVE_SMOKE_TEMPLATE_IDS.entries()) {
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
const reason = ok ? "wave1a_live_read_handlers_passed" : firstBlocker(executions) ?? "wave1a_live_read_handlers_failed";

console.log(JSON.stringify({
  ...baseReport,
  ok,
  skipped: false,
  reason,
  live_executor: executorConfig.config,
  context: {
    session_id: contextBase.session_id,
    expected_owner: contextBase.expected_owner,
    expected_generation: contextBase.expected_generation,
  },
  attempted_template_ids: LIVE_SMOKE_TEMPLATE_IDS,
  executions,
  evidence: liveRuntime.evidence(),
}));
process.exit(ok ? 0 : 2);

function exampleInputs(liveRuntime, fixtureInputsForRun) {
  const menu = liveRuntime.list_templates({
    ids: LIVE_SMOKE_TEMPLATE_IDS,
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

function itemObjectRefFromFixture(itemRef) {
  const parsed = parseItemFixtureRef(itemRef) ?? parseItemFixtureRef("selected:0");
  return createObjectRef("item", parsed.identity, { ref: parsed.ref });
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

function liveContextBase() {
  return {
    session_id: nonEmpty(process.env[SESSION_ENV]) ?? `openreaper-live-smoke-${process.pid}`,
    expected_owner: nonEmpty(process.env[OWNER_ENV]) ?? "openreaper-live-smoke",
    expected_generation: positiveInteger(process.env[GENERATION_ENV], 1),
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
    last_result_updated: Boolean(lastResult.updated),
    budget: {
      response_bytes: response?.budget?.response_bytes ?? null,
      bridge_response_bytes: response?.budget?.bridge_response_bytes ?? null,
      truncated: Boolean(response?.budget?.truncated),
    },
  };
}

function firstBlocker(executions) {
  for (const execution of executions) {
    const blocker = execution.error?.details?.blocker;
    if (typeof blocker === "string" && blocker) return blocker;
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

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

const optedIn = process.env[OPT_IN_ENV] === "1" || process.argv.includes(OPT_IN_FLAG);
const LIVE_SMOKE_TEMPLATE_IDS = CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS;
const runtime = createCallTemplateRuntime();
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
const exampleInputsById = exampleInputs(liveRuntime);
const exampleRefsById = exampleRefs();
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

function exampleInputs(liveRuntime) {
  const menu = liveRuntime.list_templates({
    ids: LIVE_SMOKE_TEMPLATE_IDS,
    fields: ["examples"],
  });
  return Object.fromEntries(
    menu.items.map((item) => [item.id, cloneJson(item.examples?.[0]?.input ?? {})]),
  );
}

function exampleRefs() {
  return {
    "template.items.read_item_summary": {
      item_ref: createObjectRef("item", { scheme: "selected", value: "0" }, { ref: "item:selected:0" }),
    },
  };
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

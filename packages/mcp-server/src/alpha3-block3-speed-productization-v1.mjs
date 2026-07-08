import {
  ALPHA3_C4_HARD_STOP_DOMAINS,
  ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
  planAlpha3C4Execution,
  planAlpha3C4ProductFlow,
} from "./alpha3-c4-orchestration-policy-v1.mjs";
import {
  ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
  createAlpha3C5OfficialMacroDiscoveryItems,
  planAlpha3C5GenericControlMacro,
} from "./alpha3-c5-generic-control-macros-v1.mjs";

export const ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_CONTRACT = "alpha3.block3.speed_productization.v1";

export const ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_CONTRACT,
  mode: "static_product_speed_gate",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates", "list_recipes"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  source_contracts: {
    orchestration_policy: ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
    generic_control_macros: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
  },
  gates: [
    "reversible task authorization prompts reduce by at least 3x",
    "batch readback chatter reduces by at least 3x",
    "independent read setup can run as safe parallel read phases",
    "generic controls stay official plan-only macros until live write evidence exists",
    "destructive/export/hardware/privacy domains remain hard-stop confirmations",
  ],
  exclusions: [
    "no sixth MCP tool",
    "no public call_recipe",
    "no hidden executor",
    "no raw Lua/action/shell/UI bypass",
    "no alias execution expansion",
    "no broad live write support claim",
  ],
  summary_function: "summarizeAlpha3Block3SpeedProductization",
});

const DEFAULT_TRACK_FIELD_VALUES = Object.freeze({
  volume: 0.78,
  pan: -0.12,
  mute: false,
});

const DEFAULT_PARALLEL_READ_CALLS = deepFreeze([
  { id: "template.project.read_summary" },
  { id: "template.transport.read_state" },
  { id: "template.project.list_markers_regions" },
]);

const DEFAULT_HARD_STOP_CALLS = deepFreeze([
  { id: "template.items.delete_item" },
  { id: "template.render.render_selected_item" },
  { id: "template.routing.set_track_hardware_output" },
]);

export function summarizeAlpha3Block3SpeedProductization(request = {}) {
  const genericControlFlow = planGenericControlSpeedFlow(request.generic_control_flow);
  const safeParallelReadFlow = planSafeParallelReadFlow(request.safe_parallel_reads);
  const safetyBoundary = planSafetyBoundaryProbe();
  const macroTruth = summarizeC5MacroTruth();
  const failures = hardGateFailures({
    genericControlFlow,
    safeParallelReadFlow,
    safetyBoundary,
    macroTruth,
  });

  return deepFreeze({
    contract: ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_CONTRACT,
    mode: "static_speed_and_friction_gate",
    ok: failures.length === 0,
    tool_surface: ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_DISCOVERY_SUMMARY.tool_surface,
    source_contracts: ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_DISCOVERY_SUMMARY.source_contracts,
    generic_control_flow: genericControlFlow,
    safe_parallel_read_flow: safeParallelReadFlow,
    safety_boundary: safetyBoundary,
    macro_truth: macroTruth,
    hard_gate: {
      accepted: failures.length === 0,
      thresholds: {
        min_prompt_reduction_factor: 3,
        min_readback_reduction_factor: 3,
        min_safe_read_phase_reduction_factor: 3,
        max_task_authorization_prompts_per_reversible_task: 1,
      },
      failures,
    },
    execution: {
      live_reaper: false,
      safe_write: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_lua_action_shell_or_ui: false,
      alias_execution: false,
      direct_reaper_write: false,
      low_level_mutation_calls_reduced: false,
      low_level_mutation_policy: "C5 generic controls still emit accepted child call_template writes; Block3 reduces user prompts, readback chatter, and read setup phases, not serial write evidence.",
    },
    customer_flow: {
      status: failures.length === 0 ? "static_ready_no_live_claim" : "needs_repair",
      promise: "One task authorization covers ordinary reversible control work inside its risk-domain boundary; success wording waits for concise batch readback.",
      remaining_live_gate: "Real live write speed evidence still needs a bounded live/safe-write window.",
    },
    trial_officer: {
      verdict: failures.length === 0 ? "accept_block3_static_speed_gate" : "needs_block3_repair",
      p0_p1_findings: failures,
      notes: [
        "The flow is faster for the user because repeated confirmations collapse to one task authorization.",
        "Readback is faster because per-field verification collapses to per-target batch readback.",
        "The flow is honest about serial child mutation calls and does not claim direct live execution.",
      ],
    },
  });
}

function planGenericControlSpeedFlow(request = {}) {
  const trackCount = boundedInteger(request?.track_count, 8, 1, 32);
  const fields = isPlainObject(request?.fields)
    ? { ...DEFAULT_TRACK_FIELD_VALUES, ...cloneJson(request.fields) }
    : { ...DEFAULT_TRACK_FIELD_VALUES };
  const fieldNames = Object.keys(fields);
  const macroPlans = [];

  for (let index = 0; index < trackCount; index += 1) {
    const track_ref = `track:guid:{BLOCK3-${String(index + 1).padStart(2, "0")}}`;
    macroPlans.push(planAlpha3C5GenericControlMacro("macro.set_track_controls", {
      fields,
      input: { fields },
      refs: { track_ref },
    }));
  }

  const childRequests = macroPlans.flatMap((plan) => plan.requests).map(callTemplateShape);
  const productFlow = planAlpha3C4ProductFlow({
    task: {
      id: "block3.generic_control_track_pass",
      label: `Set ${fieldNames.length} controls on ${trackCount} tracks`,
      intent: "fast reversible generic controls",
    },
    authorization: {
      granted: true,
      task_id: "block3-generic-controls-authorized-task",
      allowed_risk_domains: ["write_project_reversible"],
    },
    calls: childRequests,
    post_execution_mutations: childRequests,
  });

  const baselinePromptCount = childRequests.length;
  const block3PromptCount = 1;
  const baselineReadbackCount = childRequests.length;
  const block3ReadbackCount = productFlow.batch_readback.requests.length;
  const promptReductionFactor = ratio(baselinePromptCount, block3PromptCount);
  const readbackReductionFactor = ratio(baselineReadbackCount, block3ReadbackCount);

  return deepFreeze({
    id: "block3.generic_control_track_pass",
    ok: macroPlans.every((plan) => plan.ok) && productFlow.ok,
    macro_id: "macro.set_track_controls",
    target_count: trackCount,
    fields: fieldNames,
    macro_plan_count: macroPlans.length,
    child_mutation_request_count: childRequests.length,
    c4_product_flow: {
      contract: productFlow.contract,
      ok: productFlow.ok,
      authorization_prompt: productFlow.authorization_prompt,
      execution_schedule_summary: productFlow.execution_schedule.summary,
      batch_readback_coverage: productFlow.batch_readback.coverage,
      recovery_plan: productFlow.recovery_plan,
    },
    round_trip_model: {
      basis: "user_prompt_and_readback_chatter_static_model",
      baseline: {
        repeated_confirmation_prompts: baselinePromptCount,
        per_field_readback_calls: baselineReadbackCount,
      },
      block3: {
        task_authorization_prompts: block3PromptCount,
        repeated_confirmation_prompts_after_authorization: 0,
        batch_readback_calls: block3ReadbackCount,
        serial_child_mutation_calls: childRequests.length,
      },
      prompt_reduction_factor: promptReductionFactor,
      readback_reduction_factor: readbackReductionFactor,
      meets_3x_target: promptReductionFactor >= 3 && readbackReductionFactor >= 3,
    },
    safety: {
      risk_domain: "write_project_reversible",
      task_authorization_boundary: "ask once for the reversible task, then stop again at hard-stop domains",
      success_wording_requires_batch_readback: productFlow.recovery_plan.success_wording_allowed === true,
    },
  });
}

function planSafeParallelReadFlow(request = {}) {
  const calls = Array.isArray(request?.calls) && request.calls.length > 0
    ? request.calls.map(callTemplateShape)
    : DEFAULT_PARALLEL_READ_CALLS.map(callTemplateShape);
  const plan = planAlpha3C4Execution({ calls });
  const phaseCount = Math.max(1, plan.execution_schedule.summary.phase_count);
  const phaseReductionFactor = ratio(calls.length, phaseCount);

  return deepFreeze({
    id: "block3.safe_parallel_observe",
    ok: plan.ok && plan.safe_parallel_reads.enabled && phaseReductionFactor >= 3,
    call_count: calls.length,
    c4_execution: {
      contract: plan.contract,
      ok: plan.ok,
      safe_parallel_reads: plan.safe_parallel_reads,
      execution_schedule_summary: plan.execution_schedule.summary,
    },
    round_trip_model: {
      basis: "independent_read_phase_static_model",
      baseline_serial_read_phases: calls.length,
      block3_parallel_read_phases: phaseCount,
      safe_read_phase_reduction_factor: phaseReductionFactor,
      meets_3x_target: phaseReductionFactor >= 3,
    },
  });
}

function planSafetyBoundaryProbe() {
  const plan = planAlpha3C4Execution({
    authorization: {
      granted: true,
      task_id: "block3-too-broad-boundary-probe",
      allowed_risk_domains: [
        "safe_write",
        "write_project_reversible",
        "destructive_delete",
        "render_or_export",
        "hardware_io",
        "privacy_sensitive",
        "paid_or_licensed_download",
      ],
    },
    calls: DEFAULT_HARD_STOP_CALLS.map(callTemplateShape),
  });
  const hardStopDecisions = plan.calls.map((call) => call.decision);

  return deepFreeze({
    id: "block3.hard_stop_boundary_probe",
    ok: hardStopDecisions.every((decision) => decision === "requires_user_confirmation"),
    hard_stop_domains: ALPHA3_C4_HARD_STOP_DOMAINS,
    attempted_calls: DEFAULT_HARD_STOP_CALLS.map((call) => call.id),
    decisions: hardStopDecisions,
    confirmation_count: plan.authorized_fast_execution.needs_confirmation_count,
    allowed_risk_domains_after_normalization: plan.authorization.allowed_risk_domains,
  });
}

function summarizeC5MacroTruth() {
  const entries = createAlpha3C5OfficialMacroDiscoveryItems();
  const runtimeBound = entries.filter((entry) => entry.support_status === "plan_only_runtime_bound");
  return deepFreeze({
    id: "block3.c5_macro_truth",
    ok: runtimeBound.length > 0 && runtimeBound.every((entry) => entry.live_runnable_now === false),
    official_macro_count: entries.length,
    runtime_bound_plan_only_count: runtimeBound.length,
    live_runnable_now_count: entries.filter((entry) => entry.live_runnable_now === true).length,
    support_statuses: unique(entries.map((entry) => entry.support_status)),
    rule: "Official generic controls are discoverable and callable through call_template as plan-only macro entries; live write execution needs separate evidence.",
  });
}

function hardGateFailures({ genericControlFlow, safeParallelReadFlow, safetyBoundary, macroTruth }) {
  const failures = [];
  if (!genericControlFlow.ok) failures.push(failure("generic_control_flow_not_ok", "Generic control macro plus C4 product flow did not plan cleanly."));
  if (!genericControlFlow.round_trip_model.meets_3x_target) failures.push(failure("generic_control_speed_under_3x", "Generic controls did not reduce prompts and readback chatter by at least 3x."));
  if (!safeParallelReadFlow.ok) failures.push(failure("safe_parallel_read_flow_not_ok", "Safe parallel read flow did not meet the 3x phase gate."));
  if (!safetyBoundary.ok) failures.push(failure("hard_stop_boundary_failed", "A hard-stop domain did not require explicit confirmation."));
  if (!macroTruth.ok) failures.push(failure("macro_truth_overclaims_live", "C5 generic controls must not be marked live-runnable while they only return plan envelopes."));
  return deepFreeze(failures);
}

function failure(code, message) {
  return deepFreeze({
    code,
    severity: "P1",
    message,
  });
}

function callTemplateShape(request) {
  return {
    id: typeof request?.id === "string" ? request.id : null,
    input: isPlainObject(request?.input) ? cloneJson(request.input) : {},
    refs: isPlainObject(request?.refs) ? cloneJson(request.refs) : {},
  };
}

function boundedInteger(value, fallback, min, max) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function ratio(before, after) {
  if (before <= 0) return 1;
  if (after <= 0) return Number.POSITIVE_INFINITY;
  return Number((before / after).toFixed(2));
}

function unique(values) {
  return [...new Set(values)];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";

export const ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT = "alpha3.c4.orchestration_policy.v1";
export const ALPHA3_C4_BATCH_READBACK_CONTRACT = "alpha3.c4.batch_readback.v1";
export const ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT = "alpha3.c4.safe_parallel_execution.v1";
export const ALPHA3_C4_PRODUCT_FLOW_CONTRACT = "alpha3.c4.product_flow.v1";
export const ALPHA3_C4_RECOVERY_PLAN_CONTRACT = "alpha3.c4.recovery_plan.v1";

export const ALPHA3_C4_EXECUTION_DECISIONS = deepFreeze([
  "parallel_read",
  "serial_read",
  "run_without_prompt",
  "requires_task_authorization",
  "requires_user_confirmation",
  "blocked",
]);

export const ALPHA3_C4_RISK_DOMAINS = deepFreeze([
  "read",
  "safe_write",
  "write_project_reversible",
  "fx_parameter_control",
  "render_or_export",
  "destructive_delete",
  "hardware_io",
  "privacy_sensitive",
  "paid_or_licensed_download",
]);

export const ALPHA3_C4_HARD_STOP_DOMAINS = deepFreeze([
  "render_or_export",
  "destructive_delete",
  "hardware_io",
  "privacy_sensitive",
  "paid_or_licensed_download",
]);

export const ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
  mode: "agent_side_plan_only",
  tool_surface: {
    added_tools: 0,
    execution_tools: ["call_template", "get_state"],
    discovery_tools: ["list_templates", "list_recipes"],
  },
  decision_values: ALPHA3_C4_EXECUTION_DECISIONS,
  risk_domains: ALPHA3_C4_RISK_DOMAINS,
  hard_stop_domains: ALPHA3_C4_HARD_STOP_DOMAINS,
  prompt_policy: "ask_once_per_task_and_risk_domain_then_execute_until_boundary",
  safe_parallel_reads: {
    contract: ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT,
    rule: "Independent read-risk call_template reads may run concurrently. Writes, jobs, hard-stop domains, and dependency-linked reads stay serial.",
    schedule_field: "execution_schedule",
  },
  authorized_fast_execution: {
    rule: "Task authorization may suppress repeated prompts only inside reversible allowed risk domains.",
    flow_planner_function: "planAlpha3C4ProductFlow",
  },
  batch_readback: {
    contract: ALPHA3_C4_BATCH_READBACK_CONTRACT,
    mode: "batch_after_mutation_group",
    evidence_required: ["request_id", "undo_evidence", "canonical_refs", "readback_status", "typed_blockers"],
    planner_function: "planAlpha3C4BatchReadback",
  },
  recovery: {
    contract: ALPHA3_C4_RECOVERY_PLAN_CONTRACT,
    rule: "If readback is pending, partial, blocked, or mismatched, stop success wording and give one beginner-readable recovery step.",
  },
  planner_call_shape: {
    function: "planAlpha3C4Execution",
    input: {
      calls: [{ id: "template.project.read_summary" }],
      authorization: {
        granted: true,
        task_id: "task-id",
        allowed_risk_domains: ["safe_write", "write_project_reversible", "fx_parameter_control"],
      },
    },
  },
});

const TASK_AUTHORIZATION_DEFAULT_ALLOWED_DOMAINS = Object.freeze([
  "read",
  "safe_write",
  "write_project_reversible",
  "fx_parameter_control",
]);

const RISK_DOMAIN_USER_LABELS = deepFreeze({
  read: "reading the project",
  safe_write: "safe session setup",
  write_project_reversible: "reversible project edits",
  fx_parameter_control: "plugin parameter changes",
  render_or_export: "rendering or exporting files",
  destructive_delete: "deleting project content",
  hardware_io: "hardware input or output changes",
  privacy_sensitive: "privacy-sensitive scans",
  paid_or_licensed_download: "paid or licensed downloads",
});

const DEFAULT_HARD_STOP_USER_LABELS = deepFreeze([
  "deleting content",
  "rendering or exporting files",
  "hardware input or output changes",
  "privacy-sensitive scans",
  "paid downloads",
  "unclear irreversible actions",
]);

const CONTROLLED_TEMPLATE_ID_HINTS = Object.freeze({
  destructive_delete: [
    /^template\.items\.delete_/,
    /^template\.tracks\.delete_/,
    /^template\.project\.(?:delete|remove)_/,
  ],
  hardware_io: [
    /^template\.routing\.(?:list_available_audio_outputs|list_track_hardware_outputs|set_track_hardware_output|remove_track_hardware_output)/,
  ],
  render_or_export: [
    /^template\.render\.(?:render_|output_|set_render_format|set_mp3_|set_ogg_|set_flac_|set_aiff_)/,
  ],
});

export function createAlpha3C4OrchestrationPlanner(options = {}) {
  const catalog = options.catalog ?? createAlpha3C4AcceptedCatalog();
  return Object.freeze({
    contract: ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
    plan(request = {}) {
      return planAlpha3C4Execution(request, { catalog });
    },
  });
}

export function planAlpha3C4Execution(request = {}, options = {}) {
  const catalog = options.catalog ?? createAlpha3C4AcceptedCatalog();
  const calls = normalizeCalls(request.calls);
  const authorization = normalizeTaskAuthorization(request.authorization);
  const plannedCalls = calls.map((call, index) => planCall({
    call,
    index,
    catalog,
    authorization,
  }));
  const parallelReadGroups = buildSafeParallelReadGroups(plannedCalls);
  const readbackPlan = buildBatchReadbackPlan(plannedCalls);

  return deepFreeze({
    contract: ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
    ok: plannedCalls.every((call) => call.decision !== "blocked"),
    mode: "agent_side_plan_only",
    tool_surface: {
      added_tools: 0,
      execution_tools: ["call_template", "get_state"],
      discovery_tools: ["list_templates", "list_recipes"],
    },
    authorization: {
      granted: authorization.granted,
      task_id: authorization.task_id,
      allowed_risk_domains: authorization.allowed_risk_domains,
      hard_stop_domains: ALPHA3_C4_HARD_STOP_DOMAINS,
      prompt_policy: "ask_once_per_task_and_risk_domain_then_execute_until_boundary",
    },
    calls: plannedCalls,
    safe_parallel_reads: {
      contract: ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT,
      enabled: parallelReadGroups.some((group) => group.call_indexes.length > 1),
      groups: parallelReadGroups,
      rule: "Only independent read-risk call_template reads may run concurrently. Writes, jobs, hard-stop domains, and dependency-linked reads stay serial.",
    },
    authorized_fast_execution: {
      enabled: authorization.granted,
      rule: "Task authorization may suppress repeated prompts only inside allowed reversible risk domains. Hard-stop domains still require explicit user confirmation.",
      reusable_without_prompt_count: plannedCalls.filter((call) => call.decision === "run_without_prompt").length,
      needs_authorization_count: plannedCalls.filter((call) => call.decision === "requires_task_authorization").length,
      needs_confirmation_count: plannedCalls.filter((call) => call.decision === "requires_user_confirmation").length,
    },
    execution_schedule: buildSafeExecutionSchedule(plannedCalls),
    batch_readback: readbackPlan,
  });
}

export function planAlpha3C4BatchReadback(request = {}, options = {}) {
  const catalog = options.catalog ?? createAlpha3C4AcceptedCatalog();
  const mutations = normalizeMutations(request.mutations ?? request.calls);
  const planned = mutations.map((mutation, index) => planReadbackForMutation({
    mutation,
    index,
    catalog,
  }));
  const requests = dedupeReadbackRequests(planned.flatMap((entry) => entry.requests));
  const blockers = planned.flatMap((entry) => entry.blockers);

  return deepFreeze({
    contract: ALPHA3_C4_BATCH_READBACK_CONTRACT,
    ok: blockers.length === 0,
    mode: "plan_only_call_template_readback",
    tool_surface: {
      added_tools: 0,
      readback_tool: "call_template",
      artifact_tool: "get_state",
    },
    requests,
    blockers,
    coverage: {
      mutation_count: mutations.length,
      readback_request_count: requests.length,
      blocked_count: blockers.length,
      status: blockers.length === 0 ? "covered" : requests.length > 0 ? "partial" : "blocked",
    },
    policy: "Execute readback requests after the mutation group, compare requested deltas against readback, and report mismatch as typed blockers.",
  });
}

export function planAlpha3C4ProductFlow(request = {}, options = {}) {
  const catalog = options.catalog ?? createAlpha3C4AcceptedCatalog();
  const execution = planAlpha3C4Execution(request, { catalog });
  const mutations = normalizeMutations(request.mutations ?? request.post_execution_mutations);
  const readback = mutations.length > 0
    ? planAlpha3C4BatchReadback({ mutations }, { catalog })
    : null;
  const prompt = buildProductAuthorizationPrompt(execution);
  const flowSteps = buildProductFlowSteps({ execution, prompt, readback, mutations });
  const batchReadback = readback ?? pendingBatchReadback(execution);
  const recoveryPlan = buildRecoveryPlan({ execution, readback: batchReadback });

  return deepFreeze({
    contract: ALPHA3_C4_PRODUCT_FLOW_CONTRACT,
    ok: execution.ok && (readback?.ok ?? true),
    mode: "plan_only_agent_product_flow",
    tool_surface: {
      added_tools: 0,
      discovery_tools: ["list_templates", "list_recipes"],
      execution_tool: "call_template",
      artifact_tool: "get_state",
    },
    task: normalizeProductTask(request.task),
    authorization_prompt: prompt,
    execution_schedule: execution.execution_schedule,
    batch_readback: batchReadback,
    recovery_plan: recoveryPlan,
    flow_steps: flowSteps,
    report_policy: "Report one concise checkpoint after execution and batch readback; claim success only when recovery_plan.success_wording_allowed is true.",
  });
}

function createAlpha3C4AcceptedCatalog() {
  return createTemplateCatalog({
    templates: [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
      ...createTemplateCatalogP1Templates(),
    ],
  });
}

function planCall({ call, index, catalog, authorization }) {
  const descriptor = typeof call.id === "string" ? catalog.get(call.id) : null;
  if (!descriptor) {
    return deepFreeze({
      index,
      id: typeof call.id === "string" ? call.id : null,
      ok: false,
      decision: "blocked",
      reason: "template_not_in_accepted_runtime_catalog",
      risk_domain: null,
      can_parallelize: false,
      requires_user_prompt: true,
      readback_required: false,
    });
  }

  const riskDomain = riskDomainForDescriptor(descriptor);
  const hasDependency = hasDeclaredDependency(call);
  const readOnly = riskDomain === "read";
  const hardStop = ALPHA3_C4_HARD_STOP_DOMAINS.includes(riskDomain);
  const allowedByTask = authorization.granted && authorization.allowed_risk_domains.includes(riskDomain);
  const canParallelize = readOnly && !hasDependency && descriptor.bridge?.operation_family !== "run_job";
  const readbackRequired = descriptor.risk !== "read" || descriptor.expectedDelta?.kind === "mutation";
  const decision = decideCall({
    readOnly,
    hardStop,
    allowedByTask,
    canParallelize,
    hasDependency,
  });

  return deepFreeze({
    index,
    id: descriptor.id,
    ok: decision !== "blocked",
    title: descriptor.title,
    pack: descriptor.pack,
    risk: descriptor.risk,
    risk_domain: riskDomain,
    operation_family: descriptor.bridge?.operation_family ?? null,
    decision,
    can_parallelize: canParallelize,
    depends_on: normalizedDependsOn(call),
    call_template: normalizedCallTemplateRequest(call),
    requires_user_prompt: decision === "requires_task_authorization" || decision === "requires_user_confirmation",
    readback_required: readbackRequired,
    readback_mode: readbackRequired ? "batch_after_mutation_group" : "none",
    safety_note: safetyNoteForDecision({ decision, riskDomain }),
  });
}

function decideCall({ readOnly, hardStop, allowedByTask, canParallelize, hasDependency }) {
  if (readOnly) return canParallelize ? "parallel_read" : "serial_read";
  if (hardStop) return "requires_user_confirmation";
  if (allowedByTask) return "run_without_prompt";
  if (hasDependency) return "requires_task_authorization";
  return "requires_task_authorization";
}

function buildSafeParallelReadGroups(plannedCalls) {
  const groups = [];
  let current = [];
  for (const call of plannedCalls) {
    if (call.decision === "parallel_read") {
      current.push(call.index);
      continue;
    }
    if (current.length > 0) {
      groups.push(readGroup(current, plannedCalls));
      current = [];
    }
  }
  if (current.length > 0) groups.push(readGroup(current, plannedCalls));
  return groups;
}

function buildSafeExecutionSchedule(plannedCalls) {
  const phases = [];
  let currentParallel = [];
  for (const call of plannedCalls) {
    if (call.decision === "parallel_read") {
      currentParallel.push(call);
      continue;
    }
    flushParallelPhase(phases, currentParallel);
    currentParallel = [];
    phases.push(schedulePhaseForCall(call));
  }
  flushParallelPhase(phases, currentParallel);
  return deepFreeze({
    contract: ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT,
    mode: "plan_only_call_template_schedule",
    tool_surface: {
      added_tools: 0,
      execution_tool: "call_template",
      artifact_tool: "get_state",
    },
    phases,
    summary: summarizeSchedulePhases(phases),
    rule: "Execute parallel_read phases concurrently only when the caller can preserve per-call request/response evidence; all writes, prompts, hard stops, blockers, and dependency-linked reads stay serial.",
  });
}

function flushParallelPhase(phases, calls) {
  if (calls.length === 0) return;
  phases.push(deepFreeze({
    kind: calls.length > 1 ? "parallel_read_group" : "serial_read",
    execution: calls.length > 1 ? "parallel" : "serial",
    call_indexes: calls.map((call) => call.index),
    template_ids: calls.map((call) => call.id),
    requests: calls.map((call) => call.call_template),
    stop_before: false,
    evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
  }));
}

function schedulePhaseForCall(call) {
  const base = {
    call_indexes: [call.index],
    template_ids: call.id ? [call.id] : [],
    requests: call.call_template ? [call.call_template] : [],
    evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
  };
  if (call.decision === "serial_read") {
    return deepFreeze({
      kind: "serial_read",
      execution: "serial",
      ...base,
      stop_before: false,
      reason: "dependency_linked_or_job_shaped_read",
    });
  }
  if (call.decision === "run_without_prompt") {
    return deepFreeze({
      kind: "authorized_mutation",
      execution: "serial",
      ...base,
      stop_before: false,
      reason: "inside_task_authorization",
    });
  }
  if (call.decision === "requires_task_authorization") {
    return deepFreeze({
      kind: "authorization_gate",
      execution: "stop_for_task_authorization",
      ...base,
      stop_before: true,
      reason: "missing_task_authorization",
    });
  }
  if (call.decision === "requires_user_confirmation") {
    return deepFreeze({
      kind: "hard_stop_confirmation",
      execution: "stop_for_user_confirmation",
      ...base,
      stop_before: true,
      reason: call.risk_domain,
    });
  }
  return deepFreeze({
    kind: "blocked",
    execution: "blocked",
    ...base,
    stop_before: true,
    reason: call.reason ?? "blocked_before_execution",
  });
}

function summarizeSchedulePhases(phases) {
  return deepFreeze({
    phase_count: phases.length,
    parallel_phase_count: phases.filter((phase) => phase.execution === "parallel").length,
    serial_phase_count: phases.filter((phase) => phase.execution === "serial").length,
    stop_phase_count: phases.filter((phase) => phase.stop_before).length,
    request_count: phases.reduce((total, phase) => total + phase.requests.length, 0),
  });
}

function readGroup(indexes, plannedCalls) {
  return deepFreeze({
    call_indexes: indexes,
    template_ids: indexes.map((index) => plannedCalls[index]?.id ?? null).filter(Boolean),
    execution: indexes.length > 1 ? "parallel" : "serial",
  });
}

function buildBatchReadbackPlan(plannedCalls) {
  const mutationCalls = plannedCalls.filter((call) => call.readback_required);
  return deepFreeze({
    contract: ALPHA3_C4_BATCH_READBACK_CONTRACT,
    required: mutationCalls.length > 0,
    mode: mutationCalls.length > 0 ? "batch_after_mutation_group" : "none",
    call_indexes: mutationCalls.map((call) => call.index),
    template_ids: mutationCalls.map((call) => call.id),
    evidence_required: mutationCalls.length > 0
      ? ["request_id", "undo_evidence", "canonical_refs", "readback_status", "typed_blockers"]
      : [],
    policy: mutationCalls.length > 0
      ? "Run concise batch readback after the mutation group, verify requested deltas, update project index/artifacts later when available, and report mismatches as typed blockers."
      : "No mutation readback needed.",
  });
}

function buildProductAuthorizationPrompt(execution) {
  const neededDomains = unique(
    execution.calls
      .filter((call) => call.decision === "requires_task_authorization")
      .map((call) => call.risk_domain)
      .filter(Boolean),
  );
  const hardStopDomains = unique(
    execution.calls
      .filter((call) => call.decision === "requires_user_confirmation")
      .map((call) => call.risk_domain)
      .filter(Boolean),
  );
  const blockedCalls = execution.calls.filter((call) => call.decision === "blocked");
  const reusableCount = execution.authorized_fast_execution.reusable_without_prompt_count;

  if (blockedCalls.length > 0) {
    return deepFreeze({
      needed: true,
      kind: "blocked_before_authorization",
      message: "Some requested actions are unavailable in the accepted catalog; fix those before asking the user for task authorization.",
      allowed_risk_domains: [],
      allowed_risk_labels: [],
      hard_stop_domains: hardStopDomains,
      hard_stop_labels: riskDomainUserLabels(hardStopDomains),
      blocked_template_ids: blockedCalls.map((call) => call.id),
      one_prompt_only: false,
    });
  }

  if (neededDomains.length > 0) {
    return deepFreeze({
      needed: true,
      kind: "task_authorization",
      message: authorizationMessage(neededDomains, hardStopDomains),
      allowed_risk_domains: neededDomains,
      allowed_risk_labels: riskDomainUserLabels(neededDomains),
      hard_stop_domains: hardStopDomains,
      hard_stop_labels: riskDomainUserLabels(hardStopDomains),
      one_prompt_only: true,
    });
  }

  if (hardStopDomains.length > 0) {
    return deepFreeze({
      needed: true,
      kind: "hard_stop_confirmation",
      message: `Stop for explicit confirmation before ${joinHumanList(riskDomainUserLabels(hardStopDomains))}.`,
      allowed_risk_domains: [],
      allowed_risk_labels: [],
      hard_stop_domains: hardStopDomains,
      hard_stop_labels: riskDomainUserLabels(hardStopDomains),
      one_prompt_only: false,
    });
  }

  return deepFreeze({
    needed: false,
    kind: reusableCount > 0 ? "already_authorized" : "read_only_or_no_prompt",
    message: reusableCount > 0
      ? "Task authorization is already present; proceed without repeated prompts inside the recorded risk-domain boundary."
      : "No user prompt is needed for this read-only or no-op plan.",
    allowed_risk_domains: execution.authorization.allowed_risk_domains.filter((domain) => domain !== "read"),
    allowed_risk_labels: riskDomainUserLabels(execution.authorization.allowed_risk_domains.filter((domain) => domain !== "read")),
    hard_stop_domains: [],
    hard_stop_labels: [],
    one_prompt_only: reusableCount > 0,
  });
}

function buildProductFlowSteps({ execution, prompt, readback, mutations }) {
  const steps = [];
  steps.push(flowStep("discover", "Use list_templates/list_recipes only for compact discovery; expand exact ids only when needed."));
  if (prompt.needed) {
    steps.push(flowStep("authorize", prompt.message, {
      prompt_kind: prompt.kind,
      allowed_risk_domains: prompt.allowed_risk_domains,
      allowed_risk_labels: prompt.allowed_risk_labels,
      hard_stop_domains: prompt.hard_stop_domains,
      hard_stop_labels: prompt.hard_stop_labels,
    }));
  }
  steps.push(flowStep("execute", "Follow execution_schedule phases; run only parallel_read groups concurrently and keep all writes serial."));
  if (execution.batch_readback.required || mutations.length > 0) {
    steps.push(flowStep("batch_readback", readback
      ? "Run the planned readback requests after the mutation group and compare requested deltas with concise evidence."
      : "Collect mutation result refs during execution, then call planAlpha3C4BatchReadback before reporting success."));
  }
  steps.push(flowStep("report", "Give one concise user checkpoint with changed objects, readback status, blockers, and next recovery step if needed."));
  return deepFreeze(steps);
}

function pendingBatchReadback(execution) {
  const mutationCalls = execution.calls.filter((call) => call.readback_required);
  return deepFreeze({
    contract: ALPHA3_C4_BATCH_READBACK_CONTRACT,
    status: execution.batch_readback.required ? "pending_mutation_refs" : "not_required",
    required: execution.batch_readback.required,
    expected_mutation_call_indexes: execution.batch_readback.call_indexes,
    expected_template_ids: execution.batch_readback.template_ids,
    expected_result_refs: mutationCalls.map(expectedResultRefsForCall),
    next_step: execution.batch_readback.required
      ? "After execution, collect mutation input refs and result_refs, then call planAlpha3C4BatchReadback."
      : "No mutation readback needed.",
  });
}

function buildRecoveryPlan({ execution, readback }) {
  const blockedExecution = execution.calls.filter((call) => call.decision === "blocked");
  const hardStops = execution.calls.filter((call) => call.decision === "requires_user_confirmation");
  const readbackStatus = readback.coverage?.status ?? readback.status ?? "unknown";
  const readbackBlockers = Array.isArray(readback.blockers) ? readback.blockers : [];
  const actions = [];

  if (blockedExecution.length > 0) {
    actions.push(recoveryAction({
      id: "fix_unavailable_templates",
      severity: "block_success",
      user_message: "Some requested actions are not available yet.",
      next_step: "Stop before execution, name the unavailable action, and choose another supported workflow or wait for the missing capability.",
      evidence: { template_ids: blockedExecution.map((call) => call.id) },
    }));
  }

  if (hardStops.length > 0) {
    actions.push(recoveryAction({
      id: "confirm_hard_stop",
      severity: "needs_user_decision",
      user_message: "This task reaches a real risk boundary.",
      next_step: `Ask for explicit confirmation before ${joinHumanList(riskDomainUserLabels(unique(hardStops.map((call) => call.risk_domain).filter(Boolean))))}.`,
      evidence: { risk_domains: unique(hardStops.map((call) => call.risk_domain).filter(Boolean)) },
    }));
  }

  if (readbackStatus === "pending_mutation_refs") {
    actions.push(recoveryAction({
      id: "collect_mutation_refs",
      severity: "block_success",
      user_message: "The change ran or is about to run, but readback still needs the exact changed objects.",
      next_step: "Collect each mutation's input refs and result refs, then plan batch readback before claiming success.",
      evidence: {
        expected_template_ids: readback.expected_template_ids ?? [],
        expected_result_refs: readback.expected_result_refs ?? [],
      },
    }));
  }

  if (readbackStatus === "partial" || readbackStatus === "blocked") {
    actions.push(recoveryAction({
      id: "repair_readback_coverage",
      severity: "block_success",
      user_message: "I could not verify every change yet.",
      next_step: "Run the available readback requests, report the unverified targets, and ask for a narrower target or refreshed refs before further edits.",
      evidence: {
        status: readbackStatus,
        blockers: readbackBlockers.map((blocker) => ({
          code: blocker.code,
          message: blocker.message,
          mutation_template_id: blocker.mutation_template_id,
        })),
      },
    }));
  }

  return deepFreeze({
    contract: ALPHA3_C4_RECOVERY_PLAN_CONTRACT,
    status: actions.length === 0 ? "clear" : "needs_recovery",
    success_wording_allowed: actions.length === 0,
    actions,
    report_rule: actions.length === 0
      ? "Success wording is allowed after concise readback."
      : "Do not claim success until recovery actions are handled or explicitly deferred.",
  });
}

function expectedResultRefsForCall(call) {
  return deepFreeze({
    call_index: call.index,
    template_id: call.id,
    expected_ref_kinds: expectedRefKindsForRiskDomain(call.risk_domain, call.id),
  });
}

function expectedRefKindsForRiskDomain(riskDomain, templateId) {
  if (/\.tracks\./.test(templateId)) return ["track_ref"];
  if (/\.items\./.test(templateId)) return ["item_ref"];
  if (/\.fx\./.test(templateId)) return ["fx_ref", "track_ref_or_take_ref"];
  if (/\.routing\./.test(templateId)) return ["track_ref"];
  if (/\.project\.create_marker/.test(templateId)) return ["marker_ref"];
  if (/\.project\.create_region/.test(templateId)) return ["region_ref"];
  if (riskDomain === "safe_write") return ["transport_or_project_state_ref_if_returned"];
  return ["canonical_target_ref"];
}

function recoveryAction({ id, severity, user_message, next_step, evidence }) {
  return deepFreeze({
    id,
    severity,
    user_message,
    next_step,
    evidence,
  });
}

function flowStep(id, instruction, extra = {}) {
  return deepFreeze({
    id,
    instruction,
    ...extra,
  });
}

function authorizationMessage(neededDomains, hardStopDomains) {
  const allowed = joinHumanList(riskDomainUserLabels(neededDomains));
  const hardStops = hardStopDomains.length > 0
    ? ` I will still stop for ${joinHumanList(riskDomainUserLabels(hardStopDomains))}.`
    : ` I will still stop for ${joinHumanList(DEFAULT_HARD_STOP_USER_LABELS)}.`;
  return `Allow this task to make ${allowed} without repeated prompts; I will batch-read back changes before reporting success.${hardStops}`;
}

function riskDomainUserLabels(domains) {
  return domains.map((domain) => RISK_DOMAIN_USER_LABELS[domain] ?? domain);
}

function normalizeProductTask(task) {
  if (!isPlainObject(task)) return {};
  return pruneUndefined({
    id: typeof task.id === "string" ? task.id.trim() : undefined,
    label: typeof task.label === "string" ? task.label.trim() : undefined,
    intent: typeof task.intent === "string" ? task.intent.trim() : undefined,
  });
}

function planReadbackForMutation({ mutation, index, catalog }) {
  const descriptor = typeof mutation.id === "string" ? catalog.get(mutation.id) : null;
  if (!descriptor) {
    return readbackPlanEntry({
      index,
      id: mutation.id,
      requests: [],
      blockers: [readbackBlocker(index, mutation.id, "READBACK_TEMPLATE_UNKNOWN", "Mutation template is not in the accepted runtime catalog.")],
    });
  }
  if (descriptor.risk === "read" || descriptor.expectedDelta?.kind !== "mutation") {
    return readbackPlanEntry({ index, id: descriptor.id, requests: [], blockers: [] });
  }

  const entities = Array.isArray(descriptor.expectedDelta?.entities) ? descriptor.expectedDelta.entities : [];
  const requests = [];
  const blockers = [];

  for (const entity of entities) {
    const kind = typeof entity?.entity_kind === "string" ? entity.entity_kind : "";
    const planned = readbackRequestForEntity({ descriptor, mutation, index, kind });
    if (planned.request) requests.push(planned.request);
    if (planned.blocker) blockers.push(planned.blocker);
  }

  if (entities.length === 0) {
    blockers.push(readbackBlocker(index, descriptor.id, "READBACK_DELTA_UNDECLARED", "Mutation descriptor has no expectedDelta entities to map."));
  }

  return readbackPlanEntry({
    index,
    id: descriptor.id,
    requests: dedupeReadbackRequests(requests),
    blockers,
  });
}

function readbackRequestForEntity({ descriptor, mutation, index, kind }) {
  if (kind === "track") {
    const trackRef = findRef(mutation, "track");
    if (!trackRef) {
      return { blocker: readbackBlocker(index, descriptor.id, "READBACK_TARGET_REF_MISSING", "Track readback needs a track ref from mutation input or output.") };
    }
    return {
      request: readbackRequest(index, descriptor.id, "track_mixer_readback", {
        id: "template.tracks.read_mixer_controls",
        input: { include_selected: true, limit: 50 },
        refs: { track_ref: trackRef },
      }),
    };
  }

  if (kind === "item" || kind === "take") {
    const itemRef = findRef(mutation, "item");
    if (!itemRef) {
      return { blocker: readbackBlocker(index, descriptor.id, "READBACK_TARGET_REF_MISSING", "Item/take readback needs an item ref from mutation input or output.") };
    }
    return {
      request: readbackRequest(index, descriptor.id, "item_summary_readback", {
        id: "template.items.read_item_summary",
        input: { include_take_summary: true },
        refs: { item_ref: itemRef },
      }),
    };
  }

  if (kind === "time_selection" || kind === "transport") {
    return {
      request: readbackRequest(index, descriptor.id, "transport_state_readback", {
        id: "template.transport.read_state",
        input: {},
        refs: {},
      }),
    };
  }

  if (kind === "marker" || kind === "region") {
    return {
      request: readbackRequest(index, descriptor.id, "project_marker_region_readback", {
        id: "template.project.list_markers_regions",
        input: {
          include_markers: kind === "marker",
          include_regions: kind === "region",
          limit: 100,
        },
        refs: {},
      }),
    };
  }

  if (kind === "fx_param") {
    const fxRef = findRef(mutation, "fx");
    if (!fxRef) {
      return { blocker: readbackBlocker(index, descriptor.id, "READBACK_TARGET_REF_MISSING", "FX parameter readback needs an fx ref from mutation input or output.") };
    }
    const input = isPlainObject(mutation.input) ? mutation.input : {};
    const param_index = Number.isInteger(input.param_index) ? input.param_index : null;
    if (param_index === null) {
      return { blocker: readbackBlocker(index, descriptor.id, "READBACK_INPUT_MISSING", "FX parameter readback needs the original param_index.") };
    }
    return {
      request: readbackRequest(index, descriptor.id, "fx_parameter_readback", {
        id: "template.fx.read_fx_parameter",
        input: pruneUndefined({
          param_index,
          param_ident: typeof input.param_ident === "string" ? input.param_ident : undefined,
        }),
        refs: pruneUndefined({
          fx_ref: fxRef,
          track_ref: findRef(mutation, "track"),
          take_ref: findRef(mutation, "take"),
        }),
      }),
    };
  }

  if (kind === "fx") {
    const fxRef = findRef(mutation, "fx");
    if (!fxRef) {
      return { blocker: readbackBlocker(index, descriptor.id, "READBACK_TARGET_REF_MISSING", "FX readback needs an fx ref from mutation input or output.") };
    }
    return {
      request: readbackRequest(index, descriptor.id, "fx_summary_readback", {
        id: "template.fx.read_fx_summary",
        input: {},
        refs: pruneUndefined({
          fx_ref: fxRef,
          track_ref: findRef(mutation, "track"),
          take_ref: findRef(mutation, "take"),
        }),
      }),
    };
  }

  if (kind === "send" || kind === "routing") {
    const trackRef = findRef(mutation, "track");
    if (!trackRef) {
      return { blocker: readbackBlocker(index, descriptor.id, "READBACK_TARGET_REF_MISSING", "Routing readback needs the owner track ref; send ref alone is not enough.") };
    }
    return {
      request: readbackRequest(index, descriptor.id, "track_routing_readback", {
        id: "template.routing.read_track_routing",
        input: { include_receives: true, include_master_parent: true, max_routes: 100 },
        refs: { track_ref: trackRef },
      }),
    };
  }

  return {
    blocker: readbackBlocker(index, descriptor.id, "READBACK_ENTITY_UNMAPPED", `No generic batch readback mapping exists for entity kind ${kind || "unknown"}.`),
  };
}

function readbackPlanEntry({ index, id, requests, blockers }) {
  return deepFreeze({
    mutation_index: index,
    mutation_template_id: id ?? null,
    requests,
    blockers,
  });
}

function readbackRequest(mutationIndex, mutationTemplateId, purpose, request) {
  return deepFreeze({
    mutation_index: mutationIndex,
    mutation_template_id: mutationTemplateId,
    purpose,
    tool: "call_template",
    call_template: request,
    expected_evidence: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
  });
}

function readbackBlocker(mutationIndex, mutationTemplateId, code, message) {
  return deepFreeze({
    mutation_index: mutationIndex,
    mutation_template_id: mutationTemplateId ?? null,
    code,
    message,
    recoverable: true,
  });
}

function dedupeReadbackRequests(requests) {
  const seen = new Set();
  const deduped = [];
  for (const request of requests) {
    const key = JSON.stringify(request.call_template);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(request);
  }
  return deduped;
}

function riskDomainForDescriptor(descriptor) {
  const id = descriptor.id ?? "";
  if (matchesAny(id, CONTROLLED_TEMPLATE_ID_HINTS.destructive_delete)) return "destructive_delete";
  if (matchesAny(id, CONTROLLED_TEMPLATE_ID_HINTS.hardware_io)) return "hardware_io";
  if (matchesAny(id, CONTROLLED_TEMPLATE_ID_HINTS.render_or_export)) return "render_or_export";
  if (descriptor.pack === "fx" && descriptor.risk !== "read") return "fx_parameter_control";
  if (descriptor.risk === "read") return "read";
  if (descriptor.risk === "safe") return "safe_write";
  if (descriptor.risk === "write") return "write_project_reversible";
  if (descriptor.risk === "destructive") return "destructive_delete";
  return "write_project_reversible";
}

function safetyNoteForDecision({ decision, riskDomain }) {
  if (decision === "parallel_read") return "Read-only and independent; safe to run in a bounded parallel read group.";
  if (decision === "serial_read") return "Read-only but dependency-linked or job-shaped; keep serial.";
  if (decision === "run_without_prompt") return "Inside task authorization; execute and batch-read back without repeated prompts.";
  if (decision === "requires_task_authorization") return `Ask once for task authorization covering ${riskDomain}, then proceed inside that boundary.`;
  if (decision === "requires_user_confirmation") return `Hard boundary ${riskDomain}; stop for explicit user confirmation.`;
  return "Blocked before execution.";
}

function normalizeCalls(calls) {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((call) => isPlainObject(call))
    .map((call) => ({
      id: typeof call.id === "string" ? call.id.trim() : null,
      input: isPlainObject(call.input) ? clonePlainObject(call.input) : {},
      refs: normalizeRefs(call.refs),
      depends_on: normalizedDependsOn(call),
    }))
    .filter((call) => call.id);
}

function normalizedCallTemplateRequest(call) {
  return deepFreeze({
    id: call.id,
    input: isPlainObject(call.input) ? clonePlainObject(call.input) : {},
    refs: normalizeRefs(call.refs),
  });
}

function normalizeMutations(mutations) {
  if (!Array.isArray(mutations)) return [];
  return mutations
    .filter(isPlainObject)
    .map((mutation) => ({
      id: typeof mutation.id === "string" ? mutation.id.trim() : null,
      input: isPlainObject(mutation.input) ? clonePlainObject(mutation.input) : {},
      refs: normalizeRefs(mutation.refs),
      result_refs: normalizeRefs(mutation.result_refs ?? mutation.resultRefs ?? mutation.output_refs ?? mutation.outputRefs),
    }))
    .filter((mutation) => mutation.id);
}

function normalizeRefs(refs) {
  if (Array.isArray(refs)) return refs.filter((ref) => typeof ref === "string" || isPlainObject(ref));
  if (isPlainObject(refs)) return clonePlainObject(refs);
  return {};
}

function findRef(mutation, kind) {
  return findRefInContainer(mutation.result_refs, kind) ?? findRefInContainer(mutation.refs, kind);
}

function findRefInContainer(container, kind) {
  if (Array.isArray(container)) {
    return container.find((ref) => refKind(ref) === kind) ?? null;
  }
  if (!isPlainObject(container)) return null;
  const direct = container[`${kind}_ref`];
  if (direct !== undefined) return Array.isArray(direct) ? direct.find((ref) => refKind(ref) === kind) ?? direct[0] ?? null : direct;
  for (const value of Object.values(container)) {
    if (Array.isArray(value)) {
      const found = value.find((entry) => refKind(entry) === kind);
      if (found) return found;
      continue;
    }
    if (refKind(value) === kind) return value;
  }
  return null;
}

function refKind(ref) {
  if (typeof ref === "string") return ref.split(":")[0] ?? "";
  if (!isPlainObject(ref)) return "";
  if (typeof ref.kind === "string") return ref.kind;
  if (typeof ref.ref === "string") return ref.ref.split(":")[0] ?? "";
  return "";
}

function normalizeTaskAuthorization(authorization) {
  if (!isPlainObject(authorization)) {
    return {
      granted: false,
      task_id: null,
      allowed_risk_domains: ["read"],
    };
  }
  const granted = authorization.granted === true;
  const task_id = typeof authorization.task_id === "string" && authorization.task_id.trim() !== ""
    ? authorization.task_id.trim()
    : null;
  const requested = Array.isArray(authorization.allowed_risk_domains)
    ? authorization.allowed_risk_domains
    : TASK_AUTHORIZATION_DEFAULT_ALLOWED_DOMAINS;
  const allowed = requested.filter((domain) =>
    ALPHA3_C4_RISK_DOMAINS.includes(domain)
    && !ALPHA3_C4_HARD_STOP_DOMAINS.includes(domain),
  );
  return {
    granted,
    task_id,
    allowed_risk_domains: [...new Set(["read", ...allowed])],
  };
}

function hasDeclaredDependency(call) {
  return normalizedDependsOn(call).length > 0;
}

function normalizedDependsOn(call) {
  if (!isPlainObject(call)) return [];
  const value = call.depends_on ?? call.dependsOn;
  if (Array.isArray(value)) {
    return value.filter(Number.isInteger).filter((index) => index >= 0);
  }
  if (Number.isInteger(value) && value >= 0) return [value];
  return [];
}

function unique(values) {
  return [...new Set(values)];
}

function joinHumanList(values) {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function pruneUndefined(value) {
  const pruned = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null) pruned[key] = entry;
  }
  return pruned;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

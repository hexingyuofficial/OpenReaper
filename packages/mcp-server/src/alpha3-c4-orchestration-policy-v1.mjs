import {
  createAcceptedOfficialTemplateCatalog,
} from "./call-template-runtime-v1.mjs";

export const ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT = "alpha3.c4.orchestration_policy.v1";

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

const TASK_AUTHORIZATION_DEFAULT_ALLOWED_DOMAINS = Object.freeze([
  "read",
  "safe_write",
  "write_project_reversible",
  "fx_parameter_control",
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
  const catalog = options.catalog ?? createAcceptedOfficialTemplateCatalog();
  return Object.freeze({
    contract: ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
    plan(request = {}) {
      return planAlpha3C4Execution(request, { catalog });
    },
  });
}

export function planAlpha3C4Execution(request = {}, options = {}) {
  const catalog = options.catalog ?? createAcceptedOfficialTemplateCatalog();
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
    batch_readback: readbackPlan,
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
      depends_on: normalizedDependsOn(call),
    }))
    .filter((call) => call.id);
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

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

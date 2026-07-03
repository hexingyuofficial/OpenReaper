import {
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
} from "../../core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS,
} from "../../core/src/template-descriptor-v1.mjs";
import {
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
} from "../../core/src/template-catalog-v1.mjs";
import {
  TEMPLATE_CATALOG_SEED_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";
import { executeTemplate } from "../../core/src/template-execution-harness-v1.mjs";
import { createDiscoveryCatalog } from "./discovery-menu-v1.mjs";

export const CALL_TEMPLATE_RUNTIME_CONTRACT = "call_template.runtime.v1";
export const CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT = "template.runtime.evidence.v1";

export const CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE = Object.freeze({
  kind: "accepted_official_template_catalog",
  waves: Object.freeze(["wave1a", "wave2a", "wave3b"]),
});

export const CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS = deepFreeze([
  ...TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
]);

const ACCEPTED_TEMPLATE_ID_SET = new Set(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);

export const CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS = deepFreeze(
  Object.values(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS).filter((id) => !ACCEPTED_TEMPLATE_ID_SET.has(id)),
);

export const CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS = Object.freeze([
  "template.core.read_template_coverage_summary",
  "template.system.read_ext_state_value",
]);

export const CALL_TEMPLATE_RUNTIME_ALLOWED_REQUEST_FIELDS = Object.freeze([
  "id",
  "input",
  "refs",
  "context",
  "budget",
  "idempotency_key",
]);

export const CALL_TEMPLATE_RUNTIME_ERROR_CODES = Object.freeze([
  "CALL_TEMPLATE_REQUEST_INVALID",
  "CALL_TEMPLATE_DESCRIPTOR_REJECTED",
  "CALL_TEMPLATE_RAW_EXECUTION_REJECTED",
  "CALL_TEMPLATE_ID_NON_CATALOG",
  "CALL_TEMPLATE_ID_WORKFLOW_SHAPED",
  "CALL_TEMPLATE_ID_SEED_ONLY",
  "CALL_TEMPLATE_ID_HELD",
  "CALL_TEMPLATE_ID_UNKNOWN",
]);

const RUNTIME_ERROR_CODE_SET = new Set(CALL_TEMPLATE_RUNTIME_ERROR_CODES);
const ALLOWED_REQUEST_FIELD_SET = new Set(CALL_TEMPLATE_RUNTIME_ALLOWED_REQUEST_FIELDS);
const DESCRIPTOR_REQUEST_FIELD_SET = new Set([
  "descriptor",
  "raw_descriptor",
  "template",
]);
const RAW_EXECUTION_REQUEST_FIELD_SET = new Set([
  "action",
  "action_id",
  "bridge",
  "bridge_request",
  "cmd",
  "command",
  "lua",
  "operation",
  "operation_family",
  "operation_name",
  "process",
  "script",
  "script_body",
  "shell",
  "shell_command",
  "spawn",
]);
const WORKFLOW_PACK_ID_SET = new Set(TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS);
const SEED_ONLY_TEMPLATE_ID_SET = new Set(CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS);
const HELD_TEMPLATE_ID_SET = new Set(CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS);
const RAW_EXECUTION_ID_PATTERNS = Object.freeze([
  /^(?:lua|shell|sh|bash|python|node|osascript|action|raw-action|reaper|bridge):/i,
  /^(?:run_command|run_action|run_job|query_state|artifact_metadata)$/i,
  /^[0-9]{3,}$/,
  /^_[A-Z0-9_]+$/,
  /(?:^|[._:-])(?:raw_lua|lua|script|run_shell|shell_command|run_action|action_id|main_oncommand|execute_api|bridge_operation)(?:[._:-]|$)/i,
  /\b(?:reaper\.|Main_OnCommand|NamedCommandLookup|os\.execute|io\.popen)\b/i,
]);
const DEFAULT_EVIDENCE_LIMIT = 100;
const MAX_EVIDENCE_LIMIT = 1_000;

export class CallTemplateRuntimeError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CallTemplateRuntimeError";
    this.code = RUNTIME_ERROR_CODE_SET.has(code) ? code : "CALL_TEMPLATE_REQUEST_INVALID";
    this.recoverable = options.recoverable ?? true;
    if (options.details !== undefined) this.details = options.details;
    if (options.id !== undefined) this.id = options.id;
  }
}

export function createAcceptedOfficialTemplateCatalogTemplates() {
  return [
    ...createTemplateCatalogWave1aTemplates(),
    ...createTemplateCatalogWave2aTemplates(),
    ...createTemplateCatalogWave3bTemplates(),
  ];
}

export function createAcceptedOfficialTemplateCatalog() {
  return createTemplateCatalog({
    templates: createAcceptedOfficialTemplateCatalogTemplates(),
  });
}

export function createAcceptedOfficialTemplateDiscovery() {
  return createTemplateCatalogDiscovery(createAcceptedOfficialTemplateCatalog(), createDiscoveryCatalog);
}

export function createCallTemplateRuntime(options = {}) {
  const catalog = createAcceptedOfficialTemplateCatalog();
  const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
  const retainedEvidence = [];
  const evidenceLimit = normalizeEvidenceLimit(options.evidenceLimit);
  const now = typeof options.now === "function" ? options.now : () => new Date();

  async function call_template(request = {}) {
    let id = null;
    try {
      const normalized = normalizeCallTemplateRequest(request);
      id = normalized.id;
      const descriptor = resolveAcceptedCatalogDescriptor(catalog, id);
      const execution = await executeTemplate({
        descriptor,
        input: normalized.input,
        refs: normalized.refs,
        context: normalized.context,
        budget: normalized.budget,
        idempotency_key: normalized.idempotency_key,
        executor: options.executor,
      });
      retainEvidence(retainedEvidence, evidenceFromExecution(execution), evidenceLimit);
      return execution;
    } catch (error) {
      const envelope = runtimeErrorEnvelope({
        id,
        error,
        now,
        budget: safeRuntimeBudget(request?.budget),
      });
      retainEvidence(retainedEvidence, evidenceFromRuntimeError(envelope), evidenceLimit);
      return envelope;
    }
  }

  return Object.freeze({
    contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
    accepted_catalog: acceptedCatalogSummary(catalog),
    list_templates(request = {}) {
      return discovery.list_templates(request);
    },
    async call_template(request = {}) {
      return call_template(request);
    },
    evidence() {
      return cloneJson(retainedEvidence);
    },
    last_evidence() {
      return cloneJson(retainedEvidence.at(-1) ?? null);
    },
  });
}

export async function callTemplate(request = {}, options = {}) {
  return createCallTemplateRuntime(options).call_template(request);
}

export function resolveAcceptedCatalogDescriptor(catalog, id) {
  const descriptor = catalog.get(id);
  if (descriptor) return descriptor;

  if (looksLikeRawExecutionId(id)) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_RAW_EXECUTION_REJECTED",
      "call_template accepts only accepted catalog template ids, not raw execution targets.",
      {
        recoverable: true,
        details: { id: boundedString(id) },
        id,
      },
    );
  }

  const match = typeof id === "string" ? id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN) : null;
  if (!match) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_ID_NON_CATALOG",
      "Template id must use the template.<pack>.<name> catalog id shape.",
      {
        recoverable: true,
        details: { id: boundedString(id) },
        id,
      },
    );
  }

  const pack = match[1];
  if (WORKFLOW_PACK_ID_SET.has(pack)) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_ID_WORKFLOW_SHAPED",
      "Workflow-shaped ids are recipe families or tags, not callable template packs.",
      {
        recoverable: true,
        details: { pack, id: boundedString(id) },
        id,
      },
    );
  }

  if (HELD_TEMPLATE_ID_SET.has(id)) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_ID_HELD",
      "Template id is held for a later owner decision and is not runtime-callable.",
      {
        recoverable: true,
        details: { id },
        id,
      },
    );
  }

  if (SEED_ONLY_TEMPLATE_ID_SET.has(id)) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_ID_SEED_ONLY",
      "Template id is a Layer 4C seed-only fixture and is not in the accepted official runtime catalog.",
      {
        recoverable: true,
        details: { id },
        id,
      },
    );
  }

  throw new CallTemplateRuntimeError(
    "CALL_TEMPLATE_ID_UNKNOWN",
    "Template id is not present in the accepted official runtime catalog.",
    {
      recoverable: true,
      details: { id: boundedString(id) },
      id,
    },
  );
}

function normalizeCallTemplateRequest(request) {
  if (!isPlainObject(request)) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_REQUEST_INVALID",
      "call_template request must be a JSON object.",
      { recoverable: true },
    );
  }

  const keys = Object.keys(request);
  const descriptorFields = keys.filter((field) => DESCRIPTOR_REQUEST_FIELD_SET.has(field));
  if (descriptorFields.length > 0) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_DESCRIPTOR_REJECTED",
      "call_template does not accept raw descriptors or descriptor-shaped payloads.",
      {
        recoverable: true,
        details: { fields: boundedStrings(descriptorFields) },
        id: normalizePossibleId(request.id),
      },
    );
  }

  const rawExecutionFields = keys.filter((field) => RAW_EXECUTION_REQUEST_FIELD_SET.has(field));
  if (rawExecutionFields.length > 0) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_RAW_EXECUTION_REJECTED",
      "call_template does not accept raw Lua, actions, shell commands, bridge operations, or process controls.",
      {
        recoverable: true,
        details: { fields: boundedStrings(rawExecutionFields) },
        id: normalizePossibleId(request.id),
      },
    );
  }

  const unknownFields = keys.filter((field) => !ALLOWED_REQUEST_FIELD_SET.has(field));
  if (unknownFields.length > 0) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_REQUEST_INVALID",
      "call_template request contains fields outside the Layer 4D runtime shape.",
      {
        recoverable: true,
        details: {
          allowed_fields: CALL_TEMPLATE_RUNTIME_ALLOWED_REQUEST_FIELDS,
          fields: boundedStrings(unknownFields),
        },
        id: normalizePossibleId(request.id),
      },
    );
  }

  const id = normalizePossibleId(request.id);
  if (id === null) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_REQUEST_INVALID",
      "call_template requires an id string.",
      { recoverable: true },
    );
  }

  return {
    id,
    input: request.input ?? {},
    refs: request.refs ?? [],
    context: request.context,
    budget: request.budget,
    idempotency_key: request.idempotency_key,
  };
}

function runtimeErrorEnvelope({ id, error, now, budget }) {
  const normalized = normalizeRuntimeError(error);
  const envelope = {
    contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
    ok: false,
    template: {
      id: boundedString(id ?? normalized.id ?? null),
      pack: null,
      risk: null,
    },
    request: null,
    completed_at: safeNowIso(now),
    error: {
      source: "runtime",
      code: normalized.code,
      message: normalized.message,
      recoverable: normalized.recoverable,
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
    },
    budget: {
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
  };
  envelope.budget.response_bytes = encodedBytes(envelope);
  return deepFreeze(envelope);
}

function normalizeRuntimeError(error) {
  if (error instanceof CallTemplateRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      details: error.details,
      id: error.id,
    };
  }

  return {
    code: "CALL_TEMPLATE_REQUEST_INVALID",
    message: error instanceof Error ? error.message : "call_template runtime request failed.",
    recoverable: false,
  };
}

function evidenceFromExecution(execution) {
  const result = execution?.result ?? {};
  const lastResult = result.last_result ?? {};
  return deepFreeze({
    contract: CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
    template: {
      id: execution?.template?.id ?? null,
      pack: execution?.template?.pack ?? null,
      risk: execution?.template?.risk ?? null,
    },
    ok: Boolean(execution?.ok),
    error: execution?.ok
      ? null
      : {
          source: execution?.error?.source ?? null,
          code: execution?.error?.code ?? null,
        },
    request_id: execution?.request?.id ?? null,
    counts: {
      refs: Array.isArray(result.refs) ? result.refs.length : 0,
      artifacts: Array.isArray(result.artifacts) ? result.artifacts.length : 0,
      jobs: Array.isArray(result.jobs) ? result.jobs.length : 0,
      last_result_refs: Array.isArray(lastResult.refs) ? lastResult.refs.length : 0,
    },
    last_result_updated: Boolean(lastResult.updated),
    timestamps: {
      request_created_at: execution?.request?.created_at ?? null,
      completed_at: execution?.completed_at ?? null,
    },
  });
}

function evidenceFromRuntimeError(envelope) {
  return deepFreeze({
    contract: CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
    template: {
      id: envelope.template.id,
      pack: null,
      risk: null,
    },
    ok: false,
    error: {
      source: envelope.error.source,
      code: envelope.error.code,
    },
    request_id: null,
    counts: {
      refs: 0,
      artifacts: 0,
      jobs: 0,
      last_result_refs: 0,
    },
    last_result_updated: false,
    timestamps: {
      request_created_at: null,
      completed_at: envelope.completed_at,
    },
  });
}

function retainEvidence(records, record, limit) {
  records.push(record);
  while (records.length > limit) records.shift();
}

function acceptedCatalogSummary(catalog) {
  return deepFreeze({
    ...CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE,
    size: catalog.size,
  });
}

function looksLikeRawExecutionId(id) {
  return typeof id === "string" && RAW_EXECUTION_ID_PATTERNS.some((pattern) => pattern.test(id));
}

function normalizePossibleId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeEvidenceLimit(value) {
  if (value === undefined) return DEFAULT_EVIDENCE_LIMIT;
  if (!Number.isInteger(value) || value < 1) return DEFAULT_EVIDENCE_LIMIT;
  return Math.min(value, MAX_EVIDENCE_LIMIT);
}

function safeRuntimeBudget(input) {
  if (!isPlainObject(input)) return FOUNDATION_BRIDGE_DEFAULT_BUDGET;
  const budget = {
    ...FOUNDATION_BRIDGE_DEFAULT_BUDGET,
    ...input,
  };
  for (const key of ["max_response_bytes", "max_items", "max_inline_value_bytes"]) {
    if (!Number.isInteger(budget[key]) || budget[key] < 1) {
      return FOUNDATION_BRIDGE_DEFAULT_BUDGET;
    }
  }
  return budget;
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function boundedStrings(values) {
  return values.slice(0, 8).map((value) => boundedString(value, 80));
}

function boundedString(value, maxLength = 160) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 3)}...`;
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

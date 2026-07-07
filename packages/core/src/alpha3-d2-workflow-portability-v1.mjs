import {
  RECIPE_CONTRACT,
  normalizeRecipeContract,
  recipeTemplateDependencies,
} from "./recipe-contract-v1.mjs";

export const ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT = "alpha3.d2.workflow_portability.v1";
export const ALPHA3_D2_WORKFLOW_PACKET_CONTRACT = "alpha3.d2.workflow_packet.v1";

export const ALPHA3_D2_WORKFLOW_OPERATIONS = deepFreeze([
  "save",
  "scrub",
  "share",
  "install",
  "fork",
]);

export const ALPHA3_D2_PORTABILITY_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT,
  mode: "plan_only_workflow_portability",
  user_word: "workflow",
  developer_shape: "recipe-backed workflow packet",
  operations: ALPHA3_D2_WORKFLOW_OPERATIONS,
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_recipes"],
    execution_tools: ["call_template", "get_state"],
  },
  scrub_removes: [
    "local paths",
    "request ids",
    "project refs",
    "private notes",
    "secrets and tokens",
    "machine-specific assumptions",
  ],
  rule: "Save/share/install/fork plans stay metadata-only. Agents still execute workflow steps through list_recipes, call_template, and get_state.",
});

const DEFAULT_SOURCE = "local";

const SOURCE_SET = new Set([
  "official",
  "user",
  "community",
  "local",
  "partner",
  "dlc",
  "unknown",
]);

const SCRUBBABLE_KEY_SET = new Set([
  "absolute_path",
  "access_token",
  "api_key",
  "audio_device",
  "cache_path",
  "device_id",
  "file_path",
  "hardware_input",
  "hardware_output",
  "host",
  "hostname",
  "index_path",
  "license_key",
  "local_path",
  "machine",
  "machine_id",
  "password",
  "plugin_path",
  "private_note",
  "private_notes",
  "refresh_token",
  "secret",
  "secrets",
  "source_path",
  "token",
  "tokens",
  "user",
  "username",
]);

const BLOCKING_STRING_PATTERNS = Object.freeze([
  {
    code: "UNSAFE_LOCAL_PATH",
    pattern: /(?:^|[\s:="'([{,])(?:~\/|file:\/\/|[A-Za-z]:[\\/]|\/(?:Applications|Users|Volumes|opt|private|tmp|usr|var)(?:\/|$))/i,
    message: "Local machine paths must be removed or replaced before sharing or installing this workflow.",
  },
  {
    code: "REQUEST_ID_PRESENT",
    pattern: /\b(?:cmd|req|request|run)_[0-9]{8,}[A-Za-z0-9_-]*\b/i,
    message: "Runtime request ids are run-specific evidence and must not ship in workflow packets.",
  },
  {
    code: "PROJECT_REF_PRESENT",
    pattern: /\b(?:project|track|item|take):guid:\{?[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\}?/i,
    message: "Canonical project refs must be re-resolved in the destination project, not shared as fixed targets.",
  },
  {
    code: "PROJECT_REF_PRESENT",
    pattern: /\b(?:fx|send|envelope):(?:project|track|item|take):(?:guid:)?\{?[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\}?/i,
    message: "Owner-scoped project refs must be re-resolved in the destination project, not shared as fixed targets.",
  },
  {
    code: "PUBLIC_ARTIFACT_ALIAS_PRESENT",
    pattern: /\blast_result:artifact:(?:\d+|N)\b/i,
    message: "Public last-result artifact aliases are session-local and must not ship in workflow packets.",
  },
  {
    code: "ARTIFACT_REF_PRESENT",
    pattern: /\bartifact:[a-z0-9_:-]*art_[0-9]{8,}[a-z0-9_-]*\b/i,
    message: "Artifact refs are evidence pointers, not portable workflow inputs.",
  },
]);

export function planAlpha3D2WorkflowPortability(request = {}, options = {}) {
  const operation = normalizeOperation(request.operation ?? "share");
  const source = normalizeSource(request.source ?? DEFAULT_SOURCE);
  const originalScan = scanAlpha3D2PortablePayload(request);
  const scrubbedRequest = scrubAlpha3D2PortablePayload(request);
  const recipeInput = workflowRecipeFromRequest(scrubbedRequest.payload);
  const incomingPacket = workflowPacketFromRequest(scrubbedRequest.payload);
  const earlyBlockers = [];

  if (!recipeInput) {
    earlyBlockers.push(blocker(
      "WORKFLOW_RECIPE_MISSING",
      "$.recipe",
      "A workflow portability plan needs a recipe contract or workflow packet.",
    ));
  }

  let recipe = null;
  if (recipeInput) {
    try {
      recipe = normalizeRecipeContract(recipeInput);
    } catch (error) {
      earlyBlockers.push(blocker(
        "RECIPE_CONTRACT_INVALID",
        "$.recipe",
        `Recipe contract validation failed: ${error.errors?.join("; ") ?? error.message}`,
      ));
    }
  }

  if (incomingPacket) {
    earlyBlockers.push(...validateIncomingWorkflowPacket(incomingPacket));
  }

  if (!recipe) {
    return deepFreeze(basePlan({
      operation,
      source,
      ok: false,
      recipe: null,
      packet: null,
      blockers: [...earlyBlockers, ...originalScan.blockers],
      scrubActions: originalScan.scrub_actions,
      originalScan,
      packetScan: null,
    }));
  }

  const packet = createAlpha3D2WorkflowPacket({
    recipe,
    source,
    provenance: scrubbedRequest.payload.provenance,
    forked_from: scrubbedRequest.payload.forked_from,
  }, options);
  const packetScan = scanAlpha3D2PortablePayload(packet);
  const blockers = [
    ...earlyBlockers,
    ...originalScan.blockers,
    ...packetScan.blockers,
  ];
  const readiness = buildReadiness({ recipe, blockers });
  const ok = readiness[operation].ready;

  return deepFreeze(basePlan({
    operation,
    source,
    ok,
    recipe,
    packet: blockers.length === 0 && packetScan.ok ? packet : null,
    blockers,
    scrubActions: uniqueFindings([
      ...originalScan.scrub_actions,
      ...scrubbedRequest.actions,
      ...packetScan.scrub_actions,
    ]),
    originalScan,
    packetScan,
    readiness,
  }));
}

export function createAlpha3D2WorkflowPacket(request = {}, options = {}) {
  const recipe = normalizeRecipeContract(request.recipe);
  const source = normalizeSource(request.source ?? DEFAULT_SOURCE);
  const createdAt = safeNowIso(options.now);
  const templateIds = recipeTemplateDependencies(recipe);
  const packet = {
    contract: ALPHA3_D2_WORKFLOW_PACKET_CONTRACT,
    packet_kind: "workflow_recipe",
    format_version: 1,
    packet_id: `workflow_packet.${recipe.id}.${createdAt.replace(/[^0-9]/g, "")}`,
    user_word: "workflow",
    workflow: {
      id: recipe.id,
      title: recipe.title,
      summary: recipe.summary,
      pack: recipe.pack,
      risk: recipe.risk,
      lifecycle: recipe.lifecycle,
      entity_kind: recipe.entity_kind,
    },
    recipe,
    dependencies: {
      recipe_contract: RECIPE_CONTRACT,
      template_ids: templateIds,
      risk: recipe.risk,
      support_status: recipe.lifecycle,
    },
    provenance: normalizeProvenance({
      ...request.provenance,
      source,
      forked_from: request.forked_from ?? request.provenance?.forked_from,
      parent_recipe_id: request.provenance?.parent_recipe_id ?? recipe.id,
      created_at: createdAt,
    }),
    portability: {
      status: "pending_scan",
      freshness: "task_scoped_revalidate_before_write",
      refs_policy: "portable_workflows must use symbolic refs or destination re-resolution.",
    },
    safety: workflowPortabilitySafety(),
  };
  const scan = scanAlpha3D2PortablePayload(packet);
  return deepFreeze({
    ...packet,
    portability: {
      status: scan.ok ? "portable" : "blocked",
      freshness: packet.portability.freshness,
      refs_policy: packet.portability.refs_policy,
      coverage_status: scan.ok ? "share_install_fork_ready" : "blocked_by_scrub_gate",
      blockers: scan.blockers,
      scrub_actions: scan.scrub_actions,
    },
  });
}

export function validateAlpha3D2WorkflowPacket(packet) {
  const errors = [];
  if (!isPlainObject(packet)) {
    return deepFreeze({
      ok: false,
      errors: ["Workflow packet must be a JSON object."],
    });
  }
  if (packet.contract !== ALPHA3_D2_WORKFLOW_PACKET_CONTRACT) {
    errors.push(`contract must be ${ALPHA3_D2_WORKFLOW_PACKET_CONTRACT}.`);
  }
  if (packet.packet_kind !== "workflow_recipe") {
    errors.push("packet_kind must be workflow_recipe.");
  }

  let recipe = null;
  try {
    recipe = normalizeRecipeContract(packet.recipe);
  } catch (error) {
    errors.push(`recipe invalid: ${error.errors?.join("; ") ?? error.message}`);
  }

  if (recipe) {
    const expectedTemplateIds = recipeTemplateDependencies(recipe);
    if (!isPlainObject(packet.dependencies)) {
      errors.push("dependencies must be an object.");
    } else if (JSON.stringify(packet.dependencies.template_ids ?? []) !== JSON.stringify(expectedTemplateIds)) {
      errors.push("dependencies.template_ids must match recipe call_template steps.");
    }
    if (packet.workflow?.id !== recipe.id) errors.push("workflow.id must match recipe.id.");
  }

  const scan = scanAlpha3D2PortablePayload(packet);
  for (const entry of scan.blockers) errors.push(`${entry.code} at ${entry.path}`);

  return deepFreeze({
    ok: errors.length === 0,
    errors,
  });
}

export function scanAlpha3D2PortablePayload(payload) {
  const findings = [];
  walkPortablePayload(payload, [], findings);
  const blockers = uniqueFindings(findings.filter((finding) => finding.severity === "blocker"));
  const scrubActions = uniqueFindings(findings.filter((finding) => finding.severity === "scrub"));
  return deepFreeze({
    contract: ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT,
    ok: blockers.length === 0,
    blockers,
    scrub_actions: scrubActions,
    coverage: {
      scanned: true,
      blocker_count: blockers.length,
      scrub_action_count: scrubActions.length,
    },
  });
}

export function scrubAlpha3D2PortablePayload(payload) {
  const actions = [];
  const scrubbed = scrubPayload(payload, [], actions);
  return deepFreeze({
    contract: ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT,
    payload: scrubbed,
    actions: uniqueFindings(actions),
  });
}

function basePlan({
  operation,
  source,
  ok,
  recipe,
  packet,
  blockers,
  scrubActions,
  originalScan,
  packetScan,
  readiness,
}) {
  const normalizedReadiness = readiness ?? buildReadiness({ recipe, blockers });
  return {
    contract: ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT,
    ok,
    operation,
    status: ok ? "ready" : "blocked",
    mode: "plan_only_workflow_portability",
    user_word: "workflow",
    source,
    workflow: recipe
      ? {
          id: recipe.id,
          title: recipe.title,
          risk: recipe.risk,
          lifecycle: recipe.lifecycle,
        }
      : null,
    packet,
    readiness: normalizedReadiness,
    portability: {
      status: blockers.length === 0 ? "portable" : "blocked",
      blockers: uniqueFindings(blockers),
      scrub_actions: uniqueFindings(scrubActions),
      original_scan: originalScan
        ? {
            blocker_count: originalScan.blockers.length,
            scrub_action_count: originalScan.scrub_actions.length,
          }
        : null,
      packet_scan: packetScan
        ? {
            blocker_count: packetScan.blockers.length,
            scrub_action_count: packetScan.scrub_actions.length,
          }
        : null,
    },
    safety: workflowPortabilitySafety(),
    next_step: ok
      ? nextStepForOperation(operation)
      : "Resolve portability blockers or run scrub before sharing, installing, or forking.",
  };
}

function buildReadiness({ recipe, blockers }) {
  const validRecipe = Boolean(recipe);
  const portable = validRecipe && blockers.length === 0;
  return deepFreeze({
    save: {
      ready: validRecipe,
      mode: "plan_only_no_filesystem_write",
      note: "A valid workflow can be saved locally, but sharing still requires a clean scrub gate.",
    },
    scrub: {
      ready: portable,
      mode: "metadata_scrub_gate",
      note: portable
        ? "The scrubbed workflow packet has no portability blockers."
        : "Scrub removed known private envelope fields, but blocking refs/paths/evidence remain.",
    },
    share: {
      ready: portable,
      mode: "public_safe_packet",
      note: "Share only the portable workflow packet, never run-local evidence or project refs.",
    },
    install: {
      ready: portable,
      mode: "plan_only_no_install_write",
      note: "Install readiness is validated here; writing to a recipe root is a later bounded product step.",
    },
    fork: {
      ready: portable,
      mode: "plan_only_preserve_provenance",
      note: "Fork readiness preserves provenance without adding execution authority.",
    },
  });
}

function workflowPortabilitySafety() {
  return {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_lua_action_shell_or_ui: false,
    live_reaper: false,
    safe_write: false,
    install_writes_files: false,
    execution_path: ["list_recipes", "call_template", "get_state"],
  };
}

function workflowRecipeFromRequest(request) {
  if (request?.contract === RECIPE_CONTRACT) return request;
  if (isPlainObject(request?.recipe)) return request.recipe;
  if (isPlainObject(request?.packet?.recipe)) return request.packet.recipe;
  if (request?.contract === ALPHA3_D2_WORKFLOW_PACKET_CONTRACT && isPlainObject(request.recipe)) return request.recipe;
  return null;
}

function workflowPacketFromRequest(request) {
  if (request?.contract === ALPHA3_D2_WORKFLOW_PACKET_CONTRACT) {
    return {
      path: "$",
      packet: request,
    };
  }
  if (isPlainObject(request?.packet)) {
    return {
      path: "$.packet",
      packet: request.packet,
    };
  }
  return null;
}

function validateIncomingWorkflowPacket(incoming) {
  const validation = validateAlpha3D2WorkflowPacket(incoming.packet);
  if (validation.ok) return [];
  return validation.errors.map((error, index) =>
    blocker("WORKFLOW_PACKET_INVALID", `${incoming.path}.errors[${index}]`, error)
  );
}

function walkPortablePayload(value, path, findings) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walkPortablePayload(item, [...path, index], findings);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = [...path, key];
      const keyLower = key.toLowerCase();
      if (SCRUBBABLE_KEY_SET.has(keyLower)) {
        findings.push(scrubAction("REMOVE_PRIVATE_OR_LOCAL_FIELD", nestedPath, key));
        continue;
      }
      walkPortablePayload(nested, nestedPath, findings);
    }
    return;
  }
  if (typeof value !== "string") return;

  const text = value.trim();
  if (text === "" || isPortablePlaceholderRef(text)) return;
  for (const entry of BLOCKING_STRING_PATTERNS) {
    if (!entry.pattern.test(text)) continue;
    findings.push(blocker(entry.code, pathToString(path), entry.message));
  }
}

function scrubPayload(value, path, actions) {
  if (Array.isArray(value)) return value.map((item, index) => scrubPayload(item, [...path, index], actions));
  if (!isPlainObject(value)) return cloneJson(value);

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    const keyLower = key.toLowerCase();
    const nestedPath = [...path, key];
    if (SCRUBBABLE_KEY_SET.has(keyLower)) {
      actions.push(scrubAction("REMOVE_PRIVATE_OR_LOCAL_FIELD", nestedPath, key));
      continue;
    }
    output[key] = scrubPayload(nested, nestedPath, actions);
  }
  return output;
}

function normalizeOperation(operation) {
  if (typeof operation !== "string") return "share";
  const normalized = operation.trim().toLowerCase();
  return ALPHA3_D2_WORKFLOW_OPERATIONS.includes(normalized) ? normalized : "share";
}

function normalizeSource(source) {
  if (typeof source !== "string") return DEFAULT_SOURCE;
  const normalized = source.trim().toLowerCase();
  return SOURCE_SET.has(normalized) ? normalized : "unknown";
}

function normalizeProvenance(input = {}) {
  const provenance = isPlainObject(input) ? input : {};
  return {
    source: normalizeSource(provenance.source ?? DEFAULT_SOURCE),
    parent_recipe_id: safeString(provenance.parent_recipe_id),
    parent_packet_id: safeString(provenance.parent_packet_id),
    forked_from: safeString(provenance.forked_from),
    created_by: "openreaper",
    created_at: safeString(provenance.created_at),
  };
}

function nextStepForOperation(operation) {
  if (operation === "save") return "Keep this local packet or run scrub before public sharing.";
  if (operation === "scrub") return "Use the scrubbed packet for share/install/fork planning.";
  if (operation === "share") return "Share the workflow packet; the destination should validate before install.";
  if (operation === "install") return "Proceed to the later bounded installer step that writes into an approved recipe root.";
  if (operation === "fork") return "Create a new workflow id and preserve provenance in the fork packet.";
  return "Continue workflow portability planning.";
}

function isPortablePlaceholderRef(text) {
  return /^(?:project|track|item|take|fx|send|envelope):[a-z0-9_:-]*\{[A-Z][A-Z0-9_-]*\}$/.test(text);
}

function blocker(code, path, message) {
  return {
    severity: "blocker",
    code,
    path: typeof path === "string" ? path : pathToString(path),
    message,
    recoverable: true,
  };
}

function scrubAction(code, path, key) {
  return {
    severity: "scrub",
    code,
    path: pathToString(path),
    key,
    action: "remove_field",
    message: `${key} is removed before a workflow packet can be shared or installed.`,
  };
}

function uniqueFindings(findings) {
  const seen = new Set();
  const output = [];
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.code}:${finding.path}:${finding.key ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(finding);
  }
  return output;
}

function pathToString(path) {
  if (!Array.isArray(path) || path.length === 0) return "$";
  let output = "$";
  for (const part of path) {
    output += typeof part === "number" ? `[${part}]` : `.${part}`;
  }
  return output;
}

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeNowIso(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

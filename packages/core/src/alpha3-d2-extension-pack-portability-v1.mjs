export const ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT = "alpha3.d2.extension_pack_manifest.v1";
export const ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT = "alpha3.d2.extension_pack_packet.v1";
export const ALPHA3_D2_EXTENSION_PACK_PORTABILITY_CONTRACT = "alpha3.d2.extension_pack_portability.v1";

export const ALPHA3_D2_EXTENSION_PACK_OPERATIONS = deepFreeze([
  "save",
  "scrub",
  "share",
  "install",
  "fork",
]);

export const ALPHA3_D2_EXTENSION_PACK_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D2_EXTENSION_PACK_PORTABILITY_CONTRACT,
  mode: "plan_only_extension_pack_portability",
  user_word: "pack",
  developer_shape: "extension pack manifest packet",
  operations: ALPHA3_D2_EXTENSION_PACK_OPERATIONS,
  tool_surface: {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    execution_tools: ["list_templates", "list_recipes", "call_template", "get_state"],
  },
  package_scope: {
    aliases: "package-scoped exact aliases only",
    global_alias_promotion: "not in this D2.3 portability gate",
  },
  rule: "Extension pack metadata never grants execution power. Runtime execution must resolve against accepted OpenReaper templates, macros, recipes, and safety policy.",
});

const DEFAULT_SOURCE = "local";

const SOURCE_SET = new Set(["official", "partner", "dlc", "local", "unknown"]);
const PACK_KIND_SET = new Set([
  "plugin_control",
  "sound_library",
  "media_library",
  "search",
  "workflow_bundle",
  "domain_capability",
]);
const CAPABILITY_KIND_SET = new Set([
  "macro_descriptor",
  "workflow_definition",
  "semantic_parameter_map",
  "plugin_control",
  "sound_library_search",
  "media_search",
  "import_action",
  "readback_contract",
  "validation_metadata",
]);
const PERMISSION_SET = new Set([
  "project_read",
  "project_write_reversible",
  "fx_parameter_control",
  "media_library_read",
  "media_preview",
  "media_import",
  "local_index_read",
  "local_index_write",
  "microphone_or_voice_query",
  "cloud_search",
  "download",
  "export_or_overwrite",
  "hardware_io",
  "privacy_sensitive_scan",
]);
const SUPPORT_STATUS_SET = new Set([
  "declared",
  "schema_validated",
  "fake_smoked",
  "runtime_bound",
  "trial_reviewed",
  "live_smoked",
  "supported",
  "deprecated",
  "blocked",
]);
const EVIDENCE_RANK = Object.freeze({
  declared: 0,
  schema_validated: 1,
  fake_smoked: 2,
  runtime_bound: 3,
  trial_reviewed: 4,
  live_smoked: 5,
  supported: 6,
});
const REQUIRED_MANIFEST_FIELDS = Object.freeze([
  "pack_id",
  "namespace",
  "display_name",
  "kind",
  "owner",
  "source",
  "version",
  "openreaper_compatibility",
  "support_status",
  "risk_classes",
  "permissions",
  "dependencies",
  "contributed_capabilities",
  "aliases",
  "evidence",
  "privacy",
  "scrub_policy",
  "cache_policy",
  "changelog",
  "deprecation_policy",
]);
const REQUIRED_CAPABILITY_FIELDS = Object.freeze([
  "capability_id",
  "kind",
  "user_label",
  "task_intents",
  "input_schema",
  "output_schema",
  "risk_policy",
  "permissions",
  "required_templates",
  "required_handlers",
  "required_plugins",
  "required_services",
  "required_indexes",
  "readback_contract",
  "evidence",
  "support_status",
  "typed_blockers",
]);
const SOUND_LIBRARY_RESULT_FIELDS = Object.freeze([
  "candidate_ref",
  "label",
  "score",
  "duration",
  "source",
  "license",
  "provenance",
  "preview_status",
  "coverage_status",
]);
const SCRUBBABLE_KEY_SET = new Set([
  "absolute_path",
  "access_token",
  "api_key",
  "cache_path",
  "device_id",
  "file_path",
  "generated_cache",
  "generated_cache_rows",
  "host",
  "hostname",
  "index_path",
  "index_rows",
  "license_key",
  "local_assets",
  "local_path",
  "machine",
  "machine_id",
  "password",
  "plugin_path",
  "privacy_index_rows",
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
const PRIVACY_ROW_KEYS = new Set(["index_rows", "privacy_index_rows"]);
const GENERATED_CACHE_KEYS = new Set(["generated_cache", "generated_cache_rows"]);
const BLOCKING_STRING_PATTERNS = Object.freeze([
  {
    code: "UNSAFE_LOCAL_PATH",
    pattern: /(?:^|[\s:="'([{,])(?:~\/|file:\/\/|[A-Za-z]:[\\/]|\/(?:Applications|Users|Volumes|opt|private|tmp|usr|var)(?:\/|$))/i,
    message: "Local machine paths must be removed or replaced before sharing or installing this pack.",
  },
  {
    code: "REQUEST_ID_PRESENT",
    pattern: /\b(?:cmd|req|request|run)_[0-9]{8,}[A-Za-z0-9_-]*\b/i,
    message: "Runtime request ids are run-specific evidence and must not ship in extension pack packets.",
  },
  {
    code: "PROJECT_REF_PRESENT",
    pattern: /\b(?:project|track|item|take|fx|send|envelope):(?:guid:)?\{?[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\}?/i,
    message: "Project refs must be re-resolved in the destination project, not shared as fixed pack targets.",
  },
  {
    code: "PUBLIC_ARTIFACT_ALIAS_PRESENT",
    pattern: /\blast_result:artifact:(?:\d+|N)\b/i,
    message: "Public last-result artifact aliases are session-local and must not ship in extension pack packets.",
  },
]);
const FORBIDDEN_EXECUTION_KEY_PATTERNS = Object.freeze([
  /(?:^|[._-])(?:raw_lua|lua_script|shell|shell_command|run_shell|raw_action|action_id|ui_automation)(?:[._-]|$)/i,
  /(?:^|[._-])(?:create_tool|register_tool|call_recipe|recipe_executor|hidden_executor)(?:[._-]|$)/i,
  new RegExp([
    ["raw", "Lua"].join(""),
    ["lua", "Script"].join(""),
    ["run", "Shell"].join(""),
    ["raw", "Action"].join(""),
    ["action", "Id"].join(""),
    ["ui", "Automation"].join(""),
    ["create", "Tool"].join(""),
    ["register", "Tool"].join(""),
    ["call", "Recipe"].join(""),
    ["recipe", "Executor"].join(""),
    ["hidden", "Executor"].join(""),
  ].join("|"), "i"),
]);
const RAW_REAPER_BYPASS_PATTERN = new RegExp([
  ["Main", "OnCommand"].join("_"),
  ["Named", "CommandLookup"].join(""),
  ["os", "execute"].join("\\."),
  ["io", "popen"].join("\\."),
  "osascript",
].join("|"), "i");
const TOOL_SURFACE_BYPASS_PATTERN = new RegExp([
  ["create", "Tool"].join(""),
  ["register", "Tool"].join(""),
  ["call", "recipe"].join("_"),
  ["hidden", "recipe", "executor"].join(" "),
].join("|"), "i");
const FORBIDDEN_EXECUTION_STRING_PATTERNS = Object.freeze([
  /(?:^|[\s._:-])(?:raw_lua|lua_script|shell_command|run_shell|raw_action|action_id|ui_automation|create_tool|register_tool|call_recipe|recipe_executor|hidden_executor)(?:$|[\s._:-])/i,
  RAW_REAPER_BYPASS_PATTERN,
  TOOL_SURFACE_BYPASS_PATTERN,
]);

export function planAlpha3D2ExtensionPackPortability(request = {}, options = {}) {
  const operation = normalizeOperation(request.operation ?? "share");
  const source = normalizeSource(request.source ?? DEFAULT_SOURCE);
  const originalScan = scanAlpha3D2ExtensionPackPortablePayload(request);
  const scrubbedRequest = scrubAlpha3D2ExtensionPackPortablePayload(request);
  const manifestInput = extensionManifestFromRequest(scrubbedRequest.payload);
  const incomingPacket = extensionPacketFromRequest(scrubbedRequest.payload);
  const earlyBlockers = [];

  if (!manifestInput) {
    earlyBlockers.push(blocker(
      "EXTENSION_PACK_MANIFEST_MISSING",
      "$.manifest",
      "Extension pack portability needs an extension pack manifest or packet.",
    ));
  }

  let manifest = null;
  if (manifestInput) {
    const manifestValidation = validateAlpha3D2ExtensionPackManifest(manifestInput);
    if (manifestValidation.ok) {
      manifest = manifestValidation.manifest;
    } else {
      earlyBlockers.push(...manifestValidation.blockers);
    }
  }

  if (incomingPacket) {
    const validation = validateAlpha3D2ExtensionPackPacket(incomingPacket.packet);
    if (!validation.ok) {
      earlyBlockers.push(...validation.errors.map((error, index) =>
        blocker("EXTENSION_PACK_PACKET_INVALID", `${incomingPacket.path}.errors[${index}]`, error)
      ));
    }
  }

  if (!manifest) {
    return deepFreeze(basePlan({
      operation,
      source,
      ok: false,
      manifest: null,
      packet: null,
      blockers: [...earlyBlockers, ...originalScan.blockers],
      scrubActions: originalScan.scrub_actions,
      originalScan,
      packetScan: null,
    }));
  }

  const packet = createAlpha3D2ExtensionPackPacket({
    manifest,
    source,
    provenance: scrubbedRequest.payload.provenance,
    forked_from: scrubbedRequest.payload.forked_from,
  }, options);
  const packetScan = scanAlpha3D2ExtensionPackPortablePayload(packet);
  const blockers = [
    ...earlyBlockers,
    ...originalScan.blockers,
    ...packetScan.blockers,
  ];
  const readiness = buildReadiness({ manifest, blockers });
  const ok = readiness[operation].ready;

  return deepFreeze(basePlan({
    operation,
    source,
    ok,
    manifest,
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

export function createAlpha3D2ExtensionPackPacket(request = {}, options = {}) {
  const validation = validateAlpha3D2ExtensionPackManifest(request.manifest);
  if (!validation.ok) {
    const error = new Error(`Extension pack manifest validation failed: ${validation.blockers.map((entry) => entry.message).join("; ")}`);
    error.blockers = validation.blockers;
    throw error;
  }
  const manifest = validation.manifest;
  const source = normalizeSource(request.source ?? manifest.source ?? DEFAULT_SOURCE);
  const createdAt = safeNowIso(options.now);
  const requiredTemplates = requiredTemplatesForManifest(manifest);
  const packet = {
    contract: ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT,
    packet_kind: "extension_pack",
    format_version: 1,
    packet_id: `extension_pack_packet.${manifest.namespace}.${createdAt.replace(/[^0-9]/g, "")}`,
    user_word: "pack",
    pack: packSummary(manifest),
    manifest,
    dependencies: {
      required_templates: requiredTemplates,
      required_handlers: uniqueStrings([
        ...(manifest.dependencies.handlers ?? []),
        ...manifest.contributed_capabilities.flatMap((capability) => capability.required_handlers ?? []),
      ]),
      required_plugins: uniqueObjects([
        ...(manifest.dependencies.plugins ?? []),
        ...manifest.contributed_capabilities.flatMap((capability) => capability.required_plugins ?? []),
      ]),
      required_services: uniqueStrings([
        ...(manifest.dependencies.services ?? []),
        ...manifest.contributed_capabilities.flatMap((capability) => capability.required_services ?? []),
      ]),
      required_indexes: uniqueStrings([
        ...(manifest.dependencies.indexes ?? []),
        ...manifest.contributed_capabilities.flatMap((capability) => capability.required_indexes ?? []),
      ]),
    },
    capabilities: manifest.contributed_capabilities.map(capabilitySummary),
    aliases: manifest.aliases.map((alias) => ({
      alias: alias.alias,
      target: alias.target,
      scope: alias.scope ?? "package",
      exact_match: alias.exact_match !== false,
    })),
    provenance: normalizeProvenance({
      ...request.provenance,
      source,
      parent_pack_id: request.provenance?.parent_pack_id ?? manifest.pack_id,
      parent_packet_id: request.provenance?.parent_packet_id,
      forked_from: request.forked_from ?? request.provenance?.forked_from,
      created_at: createdAt,
    }),
    portability: {
      status: "pending_scan",
      freshness: "validate_manifest_before_install",
      refs_policy: "extension_packs must keep aliases package-scoped and resolve runtime execution through OpenReaper catalog truth.",
    },
    safety: extensionPackSafety(),
  };
  const scan = scanAlpha3D2ExtensionPackPortablePayload(packet);
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

export function validateAlpha3D2ExtensionPackManifest(manifest) {
  const blockers = [];
  if (!isPlainObject(manifest)) {
    return deepFreeze({
      contract: ALPHA3_D2_EXTENSION_PACK_PORTABILITY_CONTRACT,
      ok: false,
      manifest: null,
      blockers: [blocker("MANIFEST_NOT_OBJECT", "$", "Extension pack manifest must be a JSON object.")],
    });
  }

  if (manifest.contract !== ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT) {
    blockers.push(blocker("MANIFEST_CONTRACT_INVALID", "$.contract", `Manifest contract must be ${ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT}.`));
  }
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest)) blockers.push(blocker("MANIFEST_FIELD_REQUIRED", `$.${field}`, `Manifest requires ${field}.`));
  }
  validateNamespaceAndPackId(manifest, blockers);
  validateStringField(manifest.display_name, "$.display_name", 1, 80, blockers);
  if (!PACK_KIND_SET.has(manifest.kind)) blockers.push(blocker("PACK_KIND_INVALID", "$.kind", `Unsupported extension pack kind: ${String(manifest.kind)}.`));
  validateStringField(manifest.owner, "$.owner", 1, 120, blockers);
  if (!SOURCE_SET.has(manifest.source)) blockers.push(blocker("PACK_SOURCE_INVALID", "$.source", `Unsupported extension pack source: ${String(manifest.source)}.`));
  validateStringField(manifest.version, "$.version", 1, 40, blockers);
  validateObjectField(manifest.openreaper_compatibility, "$.openreaper_compatibility", blockers);
  if (!SUPPORT_STATUS_SET.has(manifest.support_status)) {
    blockers.push(blocker("SUPPORT_STATUS_INVALID", "$.support_status", `Unsupported support status: ${String(manifest.support_status)}.`));
  }
  validateStringArray(manifest.risk_classes, "$.risk_classes", blockers, { allowEmpty: false });
  validatePermissions(manifest.permissions, "$.permissions", blockers, null);
  validateDependencies(manifest.dependencies, blockers);
  validateEvidenceForSupport({
    supportStatus: manifest.support_status,
    evidence: manifest.evidence,
    path: "$.evidence",
    blockers,
  });
  validateObjectField(manifest.privacy, "$.privacy", blockers);
  validateObjectField(manifest.scrub_policy, "$.scrub_policy", blockers);
  validateObjectField(manifest.cache_policy, "$.cache_policy", blockers);
  if (!Array.isArray(manifest.changelog)) blockers.push(blocker("CHANGELOG_INVALID", "$.changelog", "Manifest changelog must be an array."));
  validateObjectField(manifest.deprecation_policy, "$.deprecation_policy", blockers);

  const capabilityIds = validateCapabilities(manifest, blockers);
  validateAliases(manifest, capabilityIds, blockers);
  validateNoForbiddenExecutionSurface(manifest, blockers);

  return deepFreeze({
    contract: ALPHA3_D2_EXTENSION_PACK_PORTABILITY_CONTRACT,
    ok: blockers.length === 0,
    manifest: blockers.length === 0 ? deepFreeze(cloneJson(manifest)) : null,
    blockers: uniqueFindings(blockers),
  });
}

export function validateAlpha3D2ExtensionPackPacket(packet) {
  const errors = [];
  if (!isPlainObject(packet)) {
    return deepFreeze({
      ok: false,
      errors: ["Extension pack packet must be a JSON object."],
    });
  }
  if (packet.contract !== ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT) {
    errors.push(`contract must be ${ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT}.`);
  }
  if (packet.packet_kind !== "extension_pack") errors.push("packet_kind must be extension_pack.");

  const manifestValidation = validateAlpha3D2ExtensionPackManifest(packet.manifest);
  if (!manifestValidation.ok) {
    for (const entry of manifestValidation.blockers) errors.push(`${entry.code} at ${entry.path}`);
  } else {
    const manifest = manifestValidation.manifest;
    if (packet.pack?.namespace !== manifest.namespace) errors.push("pack.namespace must match manifest.namespace.");
    if (packet.pack?.pack_id !== manifest.pack_id) errors.push("pack.pack_id must match manifest.pack_id.");
    const expectedTemplates = requiredTemplatesForManifest(manifest);
    if (JSON.stringify(packet.dependencies?.required_templates ?? []) !== JSON.stringify(expectedTemplates)) {
      errors.push("dependencies.required_templates must match manifest dependencies and capabilities.");
    }
  }

  const scan = scanAlpha3D2ExtensionPackPortablePayload(packet);
  for (const entry of scan.blockers) errors.push(`${entry.code} at ${entry.path}`);
  return deepFreeze({
    ok: errors.length === 0,
    errors,
  });
}

export function scanAlpha3D2ExtensionPackPortablePayload(payload) {
  const findings = [];
  walkPortablePayload(payload, [], findings);
  const blockers = uniqueFindings(findings.filter((finding) => finding.severity === "blocker"));
  const scrubActions = uniqueFindings(findings.filter((finding) => finding.severity === "scrub"));
  return deepFreeze({
    contract: ALPHA3_D2_EXTENSION_PACK_PORTABILITY_CONTRACT,
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

export function scrubAlpha3D2ExtensionPackPortablePayload(payload) {
  const actions = [];
  const scrubbed = scrubPayload(payload, [], actions);
  return deepFreeze({
    contract: ALPHA3_D2_EXTENSION_PACK_PORTABILITY_CONTRACT,
    payload: scrubbed,
    actions: uniqueFindings(actions),
  });
}

function basePlan({
  operation,
  source,
  ok,
  manifest,
  packet,
  blockers,
  scrubActions,
  originalScan,
  packetScan,
  readiness,
}) {
  const normalizedReadiness = readiness ?? buildReadiness({ manifest, blockers });
  return {
    contract: ALPHA3_D2_EXTENSION_PACK_PORTABILITY_CONTRACT,
    ok,
    operation,
    status: ok ? "ready" : "blocked",
    mode: "plan_only_extension_pack_portability",
    user_word: "pack",
    source,
    pack: manifest ? packSummary(manifest) : null,
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
    safety: extensionPackSafety(),
    next_step: ok
      ? nextStepForOperation(operation)
      : "Resolve manifest or scrub blockers before sharing, installing, or forking this pack.",
  };
}

function buildReadiness({ manifest, blockers }) {
  const validManifest = Boolean(manifest);
  const portable = validManifest && blockers.length === 0;
  return deepFreeze({
    save: {
      ready: portable,
      mode: "public_safe_extension_pack_packet",
      note: "Pack saves write a portable packet, not executable product entries.",
    },
    scrub: {
      ready: portable,
      mode: "metadata_scrub_gate",
      note: portable
        ? "The scrubbed extension pack packet has no portability blockers."
        : "Scrub removed known private fields, but blocking paths, licenses, aliases, or execution surfaces remain.",
    },
    share: {
      ready: portable,
      mode: "public_safe_extension_pack_packet",
      note: "Share only the portable extension pack packet, never local caches, private indexes, or licensed assets.",
    },
    install: {
      ready: portable,
      mode: "manifest_install_ready_no_execution_enable",
      note: "Install readiness validates metadata. Installing does not expose executable entries or global aliases.",
    },
    fork: {
      ready: portable,
      mode: "preserve_provenance_package_scope",
      note: "Fork readiness preserves provenance and keeps aliases under the new package namespace.",
    },
  });
}

function extensionPackSafety() {
  return {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_lua_action_shell_or_ui: false,
    live_reaper: false,
    safe_write: false,
    executable_entries_exposed: false,
    package_scoped_aliases_only: true,
    execution_path: ["list_templates", "list_recipes", "call_template", "get_state"],
  };
}

function validateNamespaceAndPackId(manifest, blockers) {
  if (!isNamespace(manifest.namespace)) {
    blockers.push(blocker("NAMESPACE_INVALID", "$.namespace", "Namespace must be lower_snake or dotted lower_snake."));
  }
  if (!isNonEmptyString(manifest.pack_id) || manifest.pack_id !== `extension_pack.${manifest.namespace}`) {
    blockers.push(blocker("PACK_ID_INVALID", "$.pack_id", "pack_id must equal extension_pack.<namespace>."));
  }
}

function validateDependencies(dependencies, blockers) {
  if (!isPlainObject(dependencies)) {
    blockers.push(blocker("DEPENDENCIES_INVALID", "$.dependencies", "Manifest dependencies must be an object."));
    return;
  }
  for (const field of ["templates", "handlers", "services", "indexes"]) {
    validateStringArray(dependencies[field] ?? [], `$.dependencies.${field}`, blockers);
  }
  if (!Array.isArray(dependencies.plugins ?? [])) {
    blockers.push(blocker("DEPENDENCY_PLUGINS_INVALID", "$.dependencies.plugins", "dependencies.plugins must be an array."));
  }
  if (!Array.isArray(dependencies.assets ?? [])) {
    blockers.push(blocker("DEPENDENCY_ASSETS_INVALID", "$.dependencies.assets", "dependencies.assets must be an array when present."));
  } else {
    for (const [index, asset] of dependencies.assets.entries()) {
      if (isPlainObject(asset) && asset.redistributable === false) {
        blockers.push(blocker("LICENSE_NOT_SHAREABLE", `$.dependencies.assets[${index}]`, "Non-redistributable licensed assets must not ship in an extension pack packet."));
      }
    }
  }
  for (const [index, templateId] of (dependencies.templates ?? []).entries()) {
    if (!isTemplateId(templateId)) {
      blockers.push(blocker("REQUIRED_TEMPLATE_ID_INVALID", `$.dependencies.templates[${index}]`, "Required template ids must be template.<pack>.<name>."));
    }
  }
}

function validateCapabilities(manifest, blockers) {
  const capabilities = manifest.contributed_capabilities;
  const capabilityIds = new Set();
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    blockers.push(blocker("CAPABILITIES_REQUIRED", "$.contributed_capabilities", "Extension packs must declare at least one capability contract."));
    return capabilityIds;
  }

  for (const [index, capability] of capabilities.entries()) {
    const path = `$.contributed_capabilities[${index}]`;
    if (!isPlainObject(capability)) {
      blockers.push(blocker("CAPABILITY_NOT_OBJECT", path, "Capability entries must be objects."));
      continue;
    }
    for (const field of REQUIRED_CAPABILITY_FIELDS) {
      if (!(field in capability)) blockers.push(blocker("CAPABILITY_FIELD_REQUIRED", `${path}.${field}`, `Capability requires ${field}.`));
    }
    if (!isCapabilityId(capability.capability_id, manifest.namespace)) {
      blockers.push(blocker("CAPABILITY_ID_INVALID", `${path}.capability_id`, "Capability id must be capability.<namespace>.<lower_snake>."));
    } else if (capabilityIds.has(capability.capability_id)) {
      blockers.push(blocker("CAPABILITY_ID_DUPLICATE", `${path}.capability_id`, `Duplicate capability id: ${capability.capability_id}.`));
    } else {
      capabilityIds.add(capability.capability_id);
    }
    if (!CAPABILITY_KIND_SET.has(capability.kind)) {
      blockers.push(blocker("CAPABILITY_KIND_INVALID", `${path}.kind`, `Unsupported capability kind: ${String(capability.kind)}.`));
    }
    validateStringField(capability.user_label, `${path}.user_label`, 1, 80, blockers);
    validateStringArray(capability.task_intents, `${path}.task_intents`, blockers, { allowEmpty: false });
    validateObjectField(capability.input_schema, `${path}.input_schema`, blockers);
    validateObjectField(capability.output_schema, `${path}.output_schema`, blockers);
    validateObjectField(capability.risk_policy, `${path}.risk_policy`, blockers);
    validatePermissions(capability.permissions, `${path}.permissions`, blockers, new Set(manifest.permissions ?? []));
    for (const field of ["required_templates", "required_handlers", "required_services", "required_indexes", "typed_blockers"]) {
      validateStringArray(capability[field], `${path}.${field}`, blockers);
    }
    if (!Array.isArray(capability.required_plugins)) {
      blockers.push(blocker("CAPABILITY_REQUIRED_PLUGINS_INVALID", `${path}.required_plugins`, "required_plugins must be an array."));
    }
    validateObjectField(capability.readback_contract, `${path}.readback_contract`, blockers);
    validateEvidenceForSupport({
      supportStatus: capability.support_status,
      evidence: capability.evidence,
      path: `${path}.evidence`,
      blockers,
    });
    for (const [templateIndex, templateId] of (capability.required_templates ?? []).entries()) {
      if (!isTemplateId(templateId)) {
        blockers.push(blocker("REQUIRED_TEMPLATE_ID_INVALID", `${path}.required_templates[${templateIndex}]`, "Required template ids must be template.<pack>.<name>."));
      }
    }
    validateSpecialCapability(manifest, capability, path, blockers);
  }

  return capabilityIds;
}

function validateSpecialCapability(manifest, capability, path, blockers) {
  if (capability.kind === "sound_library_search" || manifest.kind === "sound_library") {
    const required = new Set(capability.output_schema?.required ?? []);
    for (const field of SOUND_LIBRARY_RESULT_FIELDS) {
      if (!required.has(field)) {
        blockers.push(blocker("SOUND_LIBRARY_RESULT_FIELD_REQUIRED", `${path}.output_schema.required`, `Sound-library search output must include ${field}.`));
      }
    }
    if (!(capability.permissions ?? []).includes("media_library_read")) {
      blockers.push(blocker("SOUND_LIBRARY_PERMISSION_REQUIRED", `${path}.permissions`, "Sound-library search needs media_library_read permission."));
    }
  }

  if (capability.kind === "plugin_control" || manifest.kind === "plugin_control") {
    if (!Array.isArray(capability.required_plugins) || capability.required_plugins.length === 0) {
      blockers.push(blocker("PLUGIN_IDENTITY_REQUIRED", `${path}.required_plugins`, "Plugin-control packs must declare required plugin identity."));
    }
    if (!isPlainObject(capability.semantic_parameter_map) || !Array.isArray(capability.semantic_parameter_map.parameters) || capability.semantic_parameter_map.parameters.length === 0) {
      blockers.push(blocker("SEMANTIC_PARAMETER_MAP_REQUIRED", `${path}.semantic_parameter_map`, "Plugin-control packs must declare a semantic parameter map with parameters."));
    }
    if (!(capability.permissions ?? []).includes("fx_parameter_control")) {
      blockers.push(blocker("PLUGIN_CONTROL_PERMISSION_REQUIRED", `${path}.permissions`, "Plugin-control packs need fx_parameter_control permission."));
    }
  }
}

function validateAliases(manifest, capabilityIds, blockers) {
  if (!Array.isArray(manifest.aliases)) {
    blockers.push(blocker("ALIASES_INVALID", "$.aliases", "Manifest aliases must be an array."));
    return;
  }
  const seen = new Set();
  for (const [index, alias] of manifest.aliases.entries()) {
    const path = `$.aliases[${index}]`;
    if (!isPlainObject(alias)) {
      blockers.push(blocker("ALIAS_NOT_OBJECT", path, "Alias entries must be objects."));
      continue;
    }
    if (!isNonEmptyString(alias.alias) || !alias.alias.startsWith(`${manifest.namespace}.`) || !isNamespacedAlias(alias.alias)) {
      blockers.push(blocker("ALIAS_NOT_PACKAGE_SCOPED", `${path}.alias`, "Aliases must be exact package-scoped aliases: <namespace>.<alias>."));
    }
    if (alias.scope === "global" || alias.global === true) {
      blockers.push(blocker("GLOBAL_ALIAS_NOT_ALLOWED", path, "Global aliases are reserved for a separate official promotion window."));
    }
    if (alias.exact_match === false || alias.fuzzy === true) {
      blockers.push(blocker("ALIAS_MUST_BE_EXACT", path, "Extension pack aliases must be exact match only."));
    }
    if (isNonEmptyString(alias.alias) && seen.has(alias.alias)) {
      blockers.push(blocker("ALIAS_DUPLICATE", `${path}.alias`, `Duplicate alias: ${alias.alias}.`));
    }
    seen.add(alias.alias);
    if (!capabilityIds.has(alias.target)) {
      blockers.push(blocker("ALIAS_TARGET_INVALID", `${path}.target`, "Alias target must reference a declared capability id."));
    }
  }
}

function validateEvidenceForSupport({ supportStatus, evidence, path, blockers }) {
  if (!SUPPORT_STATUS_SET.has(supportStatus)) {
    blockers.push(blocker("SUPPORT_STATUS_INVALID", path.replace(/\.evidence$/, ".support_status"), `Unsupported support status: ${String(supportStatus)}.`));
    return;
  }
  if (!Array.isArray(evidence)) {
    blockers.push(blocker("EVIDENCE_INVALID", path, "Evidence must be an array."));
    return;
  }
  const supportRank = EVIDENCE_RANK[supportStatus] ?? 0;
  const maxEvidenceRank = Math.max(
    0,
    ...evidence.map((entry) => EVIDENCE_RANK[entry?.tier] ?? -1),
  );
  if (supportRank > maxEvidenceRank) {
    blockers.push(blocker("SUPPORT_STATUS_UNPROVEN", path, `Support status ${supportStatus} needs matching evidence tier.`));
  }
}

function validateNoForbiddenExecutionSurface(value, blockers) {
  const findings = [];
  walkForbiddenExecutionSurface(value, [], findings);
  blockers.push(...findings);
}

function walkForbiddenExecutionSurface(value, path, findings) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walkForbiddenExecutionSurface(item, [...path, index], findings);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = [...path, key];
      for (const pattern of FORBIDDEN_EXECUTION_KEY_PATTERNS) {
        if (pattern.test(key)) {
          findings.push(blocker("FORBIDDEN_EXECUTION_SURFACE", pathToString(nestedPath), "Extension packs must not declare raw execution, new tools, public call_recipe, or hidden executors."));
        }
      }
      walkForbiddenExecutionSurface(nested, nestedPath, findings);
    }
    return;
  }
  if (typeof value !== "string") return;
  for (const pattern of FORBIDDEN_EXECUTION_STRING_PATTERNS) {
    if (pattern.test(value)) {
      findings.push(blocker("FORBIDDEN_EXECUTION_SURFACE", pathToString(path), "Extension packs must not declare raw execution, new tools, public call_recipe, or hidden executors."));
    }
  }
}

function walkPortablePayload(value, path, findings) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walkPortablePayload(item, [...path, index], findings);
    return;
  }
  if (isPlainObject(value)) {
    if (value.redistributable === false) {
      findings.push(blocker("LICENSE_NOT_SHAREABLE", pathToString(path), "Non-redistributable licensed assets must not ship in extension pack packets."));
    }
    for (const [key, nested] of Object.entries(value)) {
      const keyLower = key.toLowerCase();
      const nestedPath = [...path, key];
      if (PRIVACY_ROW_KEYS.has(keyLower) && Array.isArray(nested) && nested.length > 0) {
        findings.push(blocker("PRIVACY_INDEX_ROWS_PRESENT", pathToString(nestedPath), "Privacy-sensitive index rows must be removed before sharing or installing this pack."));
      }
      if (GENERATED_CACHE_KEYS.has(keyLower) && Array.isArray(nested) && nested.length > 0) {
        findings.push(scrubAction("REMOVE_GENERATED_CACHE", nestedPath, key));
        continue;
      }
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
  if (text === "") return;
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
    if (GENERATED_CACHE_KEYS.has(keyLower) && Array.isArray(nested) && nested.length > 0) {
      actions.push(scrubAction("REMOVE_GENERATED_CACHE", nestedPath, key));
      output[key] = [];
      continue;
    }
    if (SCRUBBABLE_KEY_SET.has(keyLower)) {
      actions.push(scrubAction("REMOVE_PRIVATE_OR_LOCAL_FIELD", nestedPath, key));
      continue;
    }
    output[key] = scrubPayload(nested, nestedPath, actions);
  }
  return output;
}

function extensionManifestFromRequest(request) {
  if (request?.contract === ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT) return request;
  if (isPlainObject(request?.manifest)) return request.manifest;
  if (isPlainObject(request?.packet?.manifest)) return request.packet.manifest;
  if (request?.contract === ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT && isPlainObject(request.manifest)) return request.manifest;
  return null;
}

function extensionPacketFromRequest(request) {
  if (request?.contract === ALPHA3_D2_EXTENSION_PACK_PACKET_CONTRACT) {
    return { path: "$", packet: request };
  }
  if (isPlainObject(request?.packet)) {
    return { path: "$.packet", packet: request.packet };
  }
  return null;
}

function requiredTemplatesForManifest(manifest) {
  return deepFreeze(uniqueStrings([
    ...(manifest.dependencies?.templates ?? []),
    ...(manifest.contributed_capabilities ?? []).flatMap((capability) => capability.required_templates ?? []),
  ]).sort());
}

function packSummary(manifest) {
  return {
    pack_id: manifest.pack_id,
    namespace: manifest.namespace,
    display_name: manifest.display_name,
    kind: manifest.kind,
    source: manifest.source,
    version: manifest.version,
    support_status: manifest.support_status,
    permissions: [...manifest.permissions].sort(),
    capability_count: manifest.contributed_capabilities.length,
    alias_count: manifest.aliases.length,
  };
}

function capabilitySummary(capability) {
  return {
    capability_id: capability.capability_id,
    kind: capability.kind,
    user_label: capability.user_label,
    task_intents: capability.task_intents,
    permissions: capability.permissions,
    required_templates: capability.required_templates,
    support_status: capability.support_status,
    typed_blockers: capability.typed_blockers,
  };
}

function nextStepForOperation(operation) {
  if (operation === "install") return "Inspect or enable the installed pack only after dependency and permission review.";
  if (operation === "fork") return "Install the forked pack only after the user approves the new namespace.";
  if (operation === "share") return "Send the extension pack packet; the receiver should validate before installing.";
  if (operation === "scrub") return "Use this scrubbed extension pack packet for share/install/fork.";
  return "Keep or share the saved extension pack packet.";
}

function normalizeOperation(operation) {
  if (typeof operation !== "string") return "share";
  const normalized = operation.trim().toLowerCase();
  return ALPHA3_D2_EXTENSION_PACK_OPERATIONS.includes(normalized) ? normalized : "share";
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
    parent_pack_id: safeString(provenance.parent_pack_id),
    parent_packet_id: safeString(provenance.parent_packet_id),
    forked_from: safeString(provenance.forked_from),
    created_by: "openreaper",
    created_at: safeString(provenance.created_at),
  };
}

function validatePermissions(permissions, path, blockers, allowedSet) {
  validateStringArray(permissions, path, blockers);
  if (!Array.isArray(permissions)) return;
  for (const [index, permission] of permissions.entries()) {
    if (!PERMISSION_SET.has(permission)) {
      blockers.push(blocker("PERMISSION_INVALID", `${path}[${index}]`, `Unsupported permission: ${String(permission)}.`));
    }
    if (allowedSet && !allowedSet.has(permission)) {
      blockers.push(blocker("CAPABILITY_PERMISSION_UNDECLARED", `${path}[${index}]`, `Capability permission ${permission} is not declared by the pack.`));
    }
  }
}

function validateStringArray(value, path, blockers, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    blockers.push(blocker("ARRAY_REQUIRED", path, `${path} must be an array.`));
    return;
  }
  if (!allowEmpty && value.length === 0) {
    blockers.push(blocker("ARRAY_EMPTY", path, `${path} must not be empty.`));
  }
  for (const [index, entry] of value.entries()) {
    if (!isNonEmptyString(entry)) {
      blockers.push(blocker("ARRAY_ITEM_INVALID", `${path}[${index}]`, "Array entries must be non-empty strings."));
    }
  }
}

function validateObjectField(value, path, blockers) {
  if (!isPlainObject(value)) blockers.push(blocker("OBJECT_REQUIRED", path, `${path} must be an object.`));
}

function validateStringField(value, path, min, max, blockers) {
  if (!isNonEmptyString(value)) {
    blockers.push(blocker("STRING_REQUIRED", path, `${path} must be a non-empty string.`));
    return;
  }
  if (value.length < min || value.length > max) {
    blockers.push(blocker("STRING_BOUNDS", path, `${path} must be between ${min} and ${max} characters.`));
  }
}

function isNamespace(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(value);
}

function isNamespacedAlias(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value);
}

function isCapabilityId(value, namespace) {
  return typeof value === "string"
    && value.startsWith(`capability.${namespace}.`)
    && /^capability\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value);
}

function isTemplateId(value) {
  return typeof value === "string" && /^template\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(value);
}

function blocker(code, pathValue, message) {
  return {
    severity: "blocker",
    code,
    path: pathValue,
    message,
    recoverable: true,
  };
}

function scrubAction(code, path, key) {
  return {
    severity: "scrub",
    code,
    path: pathToString(path),
    message: `Remove private or machine-local field ${key}.`,
    recoverable: true,
  };
}

function pathToString(path) {
  if (path.length === 0) return "$";
  return `$${path.map((part) => typeof part === "number" ? `[${part}]` : `.${part}`).join("")}`;
}

function safeNowIso(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function safeString(value) {
  return typeof value === "string" ? value : null;
}

function uniqueFindings(findings) {
  const seen = new Set();
  const output = [];
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.code}:${finding.path}:${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(finding);
  }
  return output;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(isNonEmptyString))];
}

function uniqueObjects(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

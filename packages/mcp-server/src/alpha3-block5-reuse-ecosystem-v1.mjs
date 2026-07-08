import path from "node:path";
import {
  ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT,
} from "../../core/src/alpha3-d2-extension-pack-portability-v1.mjs";
import {
  ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT,
  ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_DISCOVERY_SUMMARY,
  ALPHA3_D2_EXTENSION_PACK_PROMOTION_CONTRACT,
  ALPHA3_D2_EXTENSION_PACK_PROMOTION_OPERATIONS,
  forkAlpha3D2ExtensionPack,
  installAlpha3D2ExtensionPack,
  loadAlpha3D2ExtensionPackRegistry,
  planAlpha3D2ExtensionPackPromotion,
  saveAlpha3D2ExtensionPack,
  scrubAlpha3D2ExtensionPack,
  shareAlpha3D2ExtensionPack,
} from "../../core/src/alpha3-d2-extension-pack-entrypoints-v1.mjs";
import {
  ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT,
  ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY,
  forkAlpha3D2Workflow,
  installAlpha3D2Workflow,
  saveAlpha3D2Workflow,
  scrubAlpha3D2Workflow,
  shareAlpha3D2Workflow,
} from "../../core/src/alpha3-d2-workflow-entrypoints-v1.mjs";

export const ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT = "alpha3.block5.reuse_ecosystem.v1";

export const ALPHA3_BLOCK5_REUSE_ECOSYSTEM_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT,
  mode: "static_workflow_pack_reuse_gate",
  user_words: {
    workflow: "workflow",
    pack: "pack",
  },
  tool_surface: {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    execution_tools: ["list_templates", "list_recipes", "call_template", "get_state"],
  },
  source_contracts: {
    workflow_entrypoints: ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT,
    extension_pack_entrypoints: ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT,
    extension_pack_promotion: ALPHA3_D2_EXTENSION_PACK_PROMOTION_CONTRACT,
  },
  gates: [
    "workflow save/scrub/share/fork/install works through local file entrypoints",
    "extension pack save/scrub/share/fork/install records manifests without enabling executable entries",
    "plugin-control and sound-library pack interfaces validate package-scoped aliases and dependencies",
    "enable/update/disable/global-alias/uninstall stay evidence-gated plan-only promotion envelopes",
    "no new MCP tool, public call_recipe, hidden executor, raw bypass, or broad live support claim",
  ],
  summary_function: "summarizeAlpha3Block5ReuseEcosystem",
  gate_function: "runAlpha3Block5ReuseEcosystemGate",
});

export function summarizeAlpha3Block5ReuseEcosystem() {
  return deepFreeze({
    contract: ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT,
    mode: "static_product_surface_summary",
    status: "ready_for_local_entrypoint_gate",
    customer_ready_scope: "static_reuse_entrypoints_no_live_claim",
    workflow: {
      entrypoints: ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY,
      operations: ["save", "scrub", "share", "fork", "install"],
      execution_rule: "Agents still run workflows by reading list_recipes and stepping call_template/get_state.",
    },
    extension_pack: {
      entrypoints: ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_DISCOVERY_SUMMARY,
      operations: ["save", "scrub", "share", "fork", "install"],
      promotion_operations: ALPHA3_D2_EXTENSION_PACK_PROMOTION_OPERATIONS,
      promotion_scope: "plan_only_readiness_envelopes",
    },
    safety: {
      added_tools: 0,
      public_call_recipe: false,
      hidden_executor: false,
      raw_lua_action_shell_or_ui: false,
      live_reaper: false,
      safe_write: false,
      executable_entries_exposed: false,
      global_alias_execution: false,
    },
    next_gate: "Run runAlpha3Block5ReuseEcosystemGate in a temp/local product workspace and keep promotion effects plan-only.",
  });
}

export function runAlpha3Block5ReuseEcosystemGate(request = {}, options = {}) {
  const root = isNonEmptyString(request.root) ? path.resolve(request.root) : null;
  const clock = {
    now: typeof options.now === "function" ? options.now : () => new Date("2026-07-08T02:30:00.000Z"),
  };
  const setupBlockers = [];
  if (!root) setupBlockers.push(blocker("ROOT_REQUIRED", "$.root", "Block5 gate needs a temporary or approved local root."));
  if (!isPlainObject(request.recipe)) setupBlockers.push(blocker("RECIPE_REQUIRED", "$.recipe", "Block5 workflow gate needs a recipe object."));

  const workflow = setupBlockers.length === 0
    ? runWorkflowReuseGate({ root, recipe: request.recipe, clock })
    : blockedFlow("workflow_reuse", setupBlockers);
  const extensionPack = setupBlockers.length === 0
    ? runExtensionPackReuseGate({
        root,
        manifest: request.manifest ?? createAlpha3Block5VitalFixtureManifest(),
        soundLibraryManifest: request.sound_library_manifest ?? request.soundLibraryManifest ?? createAlpha3Block5SoundLibraryFixtureManifest(),
        clock,
      })
    : blockedFlow("extension_pack_reuse", setupBlockers);

  const failures = hardGateFailures({ setupBlockers, workflow, extensionPack });
  return deepFreeze({
    contract: ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT,
    mode: "static_local_workflow_pack_reuse_gate",
    ok: failures.length === 0,
    root,
    tool_surface: ALPHA3_BLOCK5_REUSE_ECOSYSTEM_DISCOVERY_SUMMARY.tool_surface,
    workflow,
    extension_pack: extensionPack,
    hard_gate: {
      accepted: failures.length === 0,
      failures,
      thresholds: {
        workflow_required_operations: ["save", "scrub", "share", "fork", "install"],
        extension_pack_required_operations: ["save", "scrub", "share", "fork", "install"],
        promotion_registry_mutations_allowed: 0,
        executable_entries_exposed_allowed: false,
      },
    },
    execution: {
      live_reaper: false,
      safe_write: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_lua_action_shell_or_ui: false,
      alias_execution: false,
      global_alias_execution: false,
    },
    customer_flow: {
      status: failures.length === 0 ? "static_ready_no_live_claim" : "needs_repair",
      promise: "A user can save/share/install/fork a workflow, and developers can package/install/fork extension packs without granting execution power.",
      bounded_followup: "Actual extension-pack enable/update/uninstall/global alias mutation remains a later evidence window.",
    },
    trial_officer: {
      verdict: failures.length === 0 ? "accept_block5_static_reuse_gate" : "needs_block5_repair",
      p0_p1_findings: failures,
    },
  });
}

function runWorkflowReuseGate({ root, recipe, clock }) {
  const workflowRoot = path.join(root, "workflow");
  const saved = saveAlpha3D2Workflow({
    recipe,
    source: "official",
    output_directory: path.join(workflowRoot, "save"),
  }, clock);
  const scrubbed = scrubAlpha3D2Workflow({
    recipe,
    source: "official",
    output_directory: path.join(workflowRoot, "scrub"),
  }, clock);
  const shared = shareAlpha3D2Workflow({
    recipe,
    source: "official",
    output_directory: path.join(workflowRoot, "share"),
  }, clock);
  const forked = forkAlpha3D2Workflow({
    packet: shared.packet,
    output_directory: path.join(workflowRoot, "fork"),
    new_id: "recipe.project.fast_observation_bundle_block5_variant",
    title: "Fast observation bundle Block5 variant",
    summary: "Block5 local fork fixture for workflow reuse.",
  }, clock);
  const installed = installAlpha3D2Workflow({
    packet: forked.packet,
    recipe_root: path.join(root, "recipes", "user"),
  }, clock);
  const operations = { save: saved, scrub: scrubbed, share: shared, fork: forked, install: installed };
  const blockers = Object.values(operations).flatMap((result) => result.blockers ?? []);

  return deepFreeze({
    id: "block5.workflow_reuse",
    ok: Object.values(operations).every((result) => result.ok === true) && installed.verification?.ok === true,
    contract: ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT,
    operations: summarizeOperations(operations),
    installed_workflow: installed.workflow ?? installed.installed_recipe ?? null,
    verification: installed.verification ?? null,
    blockers: uniqueBlockers(blockers),
    safety: combineSafety(operations),
  });
}

function runExtensionPackReuseGate({ root, manifest, soundLibraryManifest, clock }) {
  const packRoot = path.join(root, "extension-packs");
  const packRootBeforePromotion = null;
  const extensionRoot = path.join(root, "extension-pack");
  const saved = saveAlpha3D2ExtensionPack({
    manifest,
    source: manifest.source ?? "partner",
    output_directory: path.join(extensionRoot, "save"),
  }, clock);
  const scrubbed = scrubAlpha3D2ExtensionPack({
    manifest,
    source: manifest.source ?? "partner",
    output_directory: path.join(extensionRoot, "scrub"),
  }, clock);
  const shared = shareAlpha3D2ExtensionPack({
    manifest,
    source: manifest.source ?? "partner",
    output_directory: path.join(extensionRoot, "share"),
  }, clock);
  const forked = forkAlpha3D2ExtensionPack({
    packet: shared.packet,
    output_directory: path.join(extensionRoot, "fork"),
    new_namespace: "block5_vital_fork",
    display_name: "Block5 Vital Fork",
    source: "local",
  }, clock);
  const installed = installAlpha3D2ExtensionPack({
    packet: shared.packet,
    pack_root: packRoot,
  }, clock);
  const soundShared = shareAlpha3D2ExtensionPack({
    manifest: soundLibraryManifest,
    source: soundLibraryManifest.source ?? "partner",
    output_directory: path.join(extensionRoot, "sound-share"),
  }, clock);
  const soundForked = forkAlpha3D2ExtensionPack({
    packet: soundShared.packet,
    output_directory: path.join(extensionRoot, "sound-fork"),
    new_namespace: "block5_sound_pack",
    display_name: "Block5 Sound Pack",
    source: "local",
  }, clock);

  const evidence = acceptedPromotionEvidence();
  const enableBlocked = planAlpha3D2ExtensionPackPromotion({
    operation: "enable",
    packet: shared.packet,
    pack_root: packRoot,
  }, clock);
  const enableReady = planAlpha3D2ExtensionPackPromotion({
    operation: "enable",
    packet: shared.packet,
    pack_root: packRoot,
    promotion_evidence: evidence,
  }, clock);
  const disableReady = planAlpha3D2ExtensionPackPromotion({
    operation: "disable",
    packet: shared.packet,
    pack_root: packRoot,
  }, clock);
  const updateReady = planAlpha3D2ExtensionPackPromotion({
    operation: "update",
    packet: shared.packet,
    pack_root: packRoot,
    promotion_evidence: evidence,
  }, clock);
  const uninstallBlocked = planAlpha3D2ExtensionPackPromotion({
    operation: "uninstall",
    packet: shared.packet,
    pack_root: packRoot,
  }, clock);
  const globalAliasBlocked = planAlpha3D2ExtensionPackPromotion({
    operation: "promote-global-alias",
    packet: shared.packet,
    pack_root: packRoot,
    promotion_evidence: {
      ...evidence,
      control_tower_approved: true,
    },
  }, clock);
  const registryAfterPlans = loadAlpha3D2ExtensionPackRegistry(packRoot);
  const operations = { save: saved, scrub: scrubbed, share: shared, fork: forked, install: installed };
  const promotion = { enableBlocked, enableReady, disableReady, updateReady, uninstallBlocked, globalAliasBlocked };
  const blockers = [
    ...Object.values(operations).flatMap((result) => result.blockers ?? []),
    ...[soundShared, soundForked].flatMap((result) => result.blockers ?? []),
  ];

  return deepFreeze({
    id: "block5.extension_pack_reuse",
    ok: Object.values(operations).every((result) => result.ok === true)
      && soundShared.ok === true
      && soundForked.ok === true
      && installed.verification?.ok === true
      && enableBlocked.ok === false
      && enableReady.ok === true
      && disableReady.ok === true
      && updateReady.ok === true
      && uninstallBlocked.ok === false
      && globalAliasBlocked.ok === false
      && registryAfterPlans.executable_entries_exposed === false
      && registryAfterPlans.packs.every((pack) => pack.enabled === false),
    contract: ALPHA3_D2_EXTENSION_PACK_ENTRYPOINTS_CONTRACT,
    operations: summarizeOperations(operations),
    sound_library_fit: {
      share_ok: soundShared.ok,
      fork_ok: soundForked.ok,
      namespace: soundForked.packet?.manifest?.namespace ?? null,
      capabilities: soundForked.packet?.manifest?.contributed_capabilities?.map((capability) => capability.kind) ?? [],
    },
    promotion: summarizePromotion(promotion),
    registry_after_plan_only_promotions: {
      contract: registryAfterPlans.contract,
      pack_count: registryAfterPlans.packs.length,
      enabled_count: registryAfterPlans.packs.filter((pack) => pack.enabled === true).length,
      executable_entries_exposed: registryAfterPlans.executable_entries_exposed,
      pack_root_before_promotion: packRootBeforePromotion,
    },
    blockers: uniqueBlockers(blockers),
    safety: combineSafety(operations),
  });
}

export function createAlpha3Block5VitalFixtureManifest() {
  return deepFreeze({
    contract: ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT,
    pack_id: "extension_pack.block5_vital_for_reaper",
    namespace: "block5_vital_for_reaper",
    display_name: "Block5 Vital for REAPER",
    kind: "plugin_control",
    owner: "OpenReaper Labs",
    source: "partner",
    version: "0.1.0",
    openreaper_compatibility: { min_alpha: "alpha3" },
    support_status: "schema_validated",
    risk_classes: ["write"],
    permissions: ["project_read", "fx_parameter_control"],
    dependencies: {
      templates: ["template.fx.set_parameter"],
      handlers: [],
      plugins: [{ name: "Vital", vendor: "Vital Audio" }],
      services: [],
      indexes: [],
      assets: [],
    },
    contributed_capabilities: [
      {
        capability_id: "capability.block5_vital_for_reaper.set_macro",
        kind: "plugin_control",
        user_label: "Set Vital macro",
        task_intents: ["control_vital", "plugin_parameter_control"],
        input_schema: { type: "object", required: ["fx_ref", "macro", "value"] },
        output_schema: { type: "object", required: ["readback"] },
        risk_policy: { risk: "write", authorization_domain: "fx_parameter_control" },
        permissions: ["fx_parameter_control"],
        required_templates: ["template.fx.set_parameter"],
        required_handlers: [],
        required_plugins: [{ name: "Vital", vendor: "Vital Audio" }],
        required_services: [],
        required_indexes: [],
        readback_contract: { summary: "Read back the owner-scoped FX parameter value after setting it." },
        evidence: [{ tier: "schema_validated" }],
        support_status: "schema_validated",
        typed_blockers: ["PLUGIN_NOT_FOUND", "FX_OWNER_MISMATCH", "PARAMETER_IDENTITY_UNSUPPORTED"],
        semantic_parameter_map: {
          parameters: [{ id: "macro_1", label: "Macro 1", safe_range: [0, 1] }],
        },
      },
    ],
    aliases: [
      {
        alias: "block5_vital_for_reaper.set_macro",
        target: "capability.block5_vital_for_reaper.set_macro",
        scope: "package",
        exact_match: true,
      },
    ],
    evidence: [{ tier: "schema_validated" }],
    privacy: { local_only: true },
    scrub_policy: { remove: ["local_path", "private_notes", "generated_cache_rows"] },
    cache_policy: { generated: false },
    changelog: [],
    deprecation_policy: { policy: "none" },
  });
}

export function createAlpha3Block5SoundLibraryFixtureManifest() {
  return deepFreeze({
    contract: ALPHA3_D2_EXTENSION_PACK_MANIFEST_CONTRACT,
    pack_id: "extension_pack.block5_sound_search_lab",
    namespace: "block5_sound_search_lab",
    display_name: "Block5 Sound Search Lab",
    kind: "sound_library",
    owner: "OpenReaper Labs",
    source: "partner",
    version: "0.1.0",
    openreaper_compatibility: { min_alpha: "alpha3" },
    support_status: "schema_validated",
    risk_classes: ["read", "write"],
    permissions: ["media_library_read", "media_preview", "media_import", "local_index_read"],
    dependencies: {
      templates: ["template.media.insert_media_file"],
      handlers: [],
      plugins: [],
      services: [],
      indexes: ["block5_sound_search_lab.local_index"],
      assets: [],
    },
    contributed_capabilities: [
      {
        capability_id: "capability.block5_sound_search_lab.search",
        kind: "sound_library_search",
        user_label: "Search sound library",
        task_intents: ["semantic_sound_search", "audio_similarity_search", "transient_shape_search"],
        input_schema: {
          type: "object",
          properties: {
            text_query: { type: "string" },
            audio_ref: { type: "string" },
            transient_shape: { type: "object" },
          },
        },
        output_schema: {
          type: "object",
          required: [
            "candidate_ref",
            "label",
            "score",
            "duration",
            "source",
            "license",
            "provenance",
            "preview_status",
            "coverage_status",
          ],
        },
        risk_policy: { risk: "read", import_requires: "media_import" },
        permissions: ["media_library_read", "media_preview", "local_index_read"],
        required_templates: [],
        required_handlers: [],
        required_plugins: [],
        required_services: [],
        required_indexes: ["block5_sound_search_lab.local_index"],
        readback_contract: { summary: "Return portable candidate refs and require explicit media_import before insertion." },
        evidence: [{ tier: "schema_validated" }],
        support_status: "schema_validated",
        typed_blockers: ["INDEX_NOT_AVAILABLE", "LICENSE_NOT_SHAREABLE", "IMPORT_REQUIRES_AUTHORIZATION"],
      },
      {
        capability_id: "capability.block5_sound_search_lab.import_candidate",
        kind: "import_action",
        user_label: "Import selected sound",
        task_intents: ["import_sound_candidate", "add_sample_to_project"],
        input_schema: { type: "object", required: ["candidate_ref", "destination_track_ref"] },
        output_schema: {
          type: "object",
          required: [
            "item_ref",
            "readback",
            "candidate_ref",
            "label",
            "score",
            "duration",
            "source",
            "license",
            "provenance",
            "preview_status",
            "coverage_status",
          ],
        },
        risk_policy: { risk: "write", authorization_domain: "media_import" },
        permissions: ["media_library_read", "media_import"],
        required_templates: ["template.media.insert_media_file"],
        required_handlers: [],
        required_plugins: [],
        required_services: [],
        required_indexes: ["block5_sound_search_lab.local_index"],
        readback_contract: { summary: "Read back the inserted media item and its source provenance." },
        evidence: [{ tier: "schema_validated" }],
        support_status: "schema_validated",
        typed_blockers: ["MEDIA_IMPORT_AUTH_REQUIRED", "LICENSE_NOT_SHAREABLE", "SOURCE_UNAVAILABLE"],
      },
    ],
    aliases: [
      {
        alias: "block5_sound_search_lab.search",
        target: "capability.block5_sound_search_lab.search",
        scope: "package",
        exact_match: true,
      },
    ],
    evidence: [{ tier: "schema_validated" }],
    privacy: { local_only: true, allows_voice_query: false },
    scrub_policy: { remove: ["local_path", "private_notes", "generated_cache_rows", "licensed_assets"] },
    cache_policy: { generated: true, share_generated_cache: false },
    changelog: [],
    deprecation_policy: { policy: "none" },
  });
}

function summarizeOperations(operations) {
  return deepFreeze(Object.fromEntries(Object.entries(operations).map(([operation, result]) => [
    operation,
    {
      ok: result.ok === true,
      status: result.status,
      blockers: (result.blockers ?? []).map((entry) => entry.code),
      filesystem_write: result.safety?.filesystem_write === true,
      install_writes_files: result.safety?.install_writes_files === true,
      executable_entries_exposed: result.safety?.executable_entries_exposed === true,
      public_call_recipe: result.safety?.public_call_recipe === true,
      hidden_executor: result.safety?.hidden_executor === true,
    },
  ])));
}

function summarizePromotion(promotion) {
  return deepFreeze({
    enable_without_evidence_blocked: promotion.enableBlocked.ok === false
      && blockerCodes(promotion.enableBlocked).includes("PROMOTION_EVIDENCE_REQUIRED"),
    enable_with_evidence_ready: promotion.enableReady.ok === true,
    disable_ready: promotion.disableReady.ok === true,
    update_with_evidence_ready: promotion.updateReady.ok === true,
    uninstall_plan_only_blocked: promotion.uninstallBlocked.ok === false
      && blockerCodes(promotion.uninstallBlocked).includes("UNINSTALL_REQUIRES_BOUNDED_USER_WINDOW"),
    global_alias_plan_only_blocked: promotion.globalAliasBlocked.ok === false
      && blockerCodes(promotion.globalAliasBlocked).includes("GLOBAL_ALIAS_EXECUTION_NOT_ENABLED"),
    statuses: Object.fromEntries(Object.entries(promotion).map(([key, result]) => [key, result.status])),
    planned_effects: Object.fromEntries(Object.entries(promotion).map(([key, result]) => [key, result.planned_effect])),
  });
}

function combineSafety(operations) {
  const values = Object.values(operations);
  return deepFreeze({
    added_tools: 0,
    public_call_recipe: values.some((result) => result.safety?.public_call_recipe === true),
    hidden_executor: values.some((result) => result.safety?.hidden_executor === true),
    raw_lua_action_shell_or_ui: values.some((result) => result.safety?.raw_lua_action_shell_or_ui === true),
    live_reaper: values.some((result) => result.safety?.live_reaper === true),
    safe_write: values.some((result) => result.safety?.safe_write === true),
    executable_entries_exposed: values.some((result) => result.safety?.executable_entries_exposed === true),
    filesystem_write: values.some((result) => result.safety?.filesystem_write === true),
    install_writes_files: values.some((result) => result.safety?.install_writes_files === true),
  });
}

function hardGateFailures({ setupBlockers, workflow, extensionPack }) {
  const failures = [];
  for (const setupBlocker of setupBlockers) failures.push(failure(setupBlocker.code, setupBlocker.message));
  if (!workflow.ok) failures.push(failure("WORKFLOW_REUSE_GATE_FAILED", "Workflow save/scrub/share/fork/install did not all pass."));
  if (!extensionPack.ok) failures.push(failure("EXTENSION_PACK_REUSE_GATE_FAILED", "Extension pack share/fork/install/promotion readiness did not pass."));
  if (workflow.safety?.public_call_recipe || extensionPack.safety?.public_call_recipe) failures.push(failure("PUBLIC_CALL_RECIPE_ADDED", "Block5 must not add public call_recipe."));
  if (workflow.safety?.hidden_executor || extensionPack.safety?.hidden_executor) failures.push(failure("HIDDEN_EXECUTOR_ADDED", "Block5 must not add hidden executors."));
  if (extensionPack.registry_after_plan_only_promotions?.enabled_count > 0) failures.push(failure("PACK_PROMOTION_MUTATED_REGISTRY", "Plan-only promotion must not enable installed packs."));
  if (extensionPack.registry_after_plan_only_promotions?.executable_entries_exposed === true) failures.push(failure("EXECUTABLE_PACK_ENTRIES_EXPOSED", "Extension pack install/promotion must not expose executable entries in Block5."));
  return deepFreeze(failures);
}

function blockedFlow(id, blockers) {
  return deepFreeze({
    id,
    ok: false,
    blockers,
    safety: {},
  });
}

function acceptedPromotionEvidence() {
  return {
    tier: "live_smoked",
    evidence_refs: ["evidence:block5-extension-pack-promotion-static-fixture"],
    reviewed_by: "trial_officer",
  };
}

function failure(code, message) {
  return deepFreeze({
    code,
    severity: "P1",
    message,
  });
}

function blocker(code, pathValue, message) {
  return deepFreeze({
    code,
    path: pathValue,
    message,
    recoverable: true,
  });
}

function blockerCodes(result) {
  return (result.blockers ?? []).map((entry) => entry.code);
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  const deduped = [];
  for (const entry of blockers) {
    const key = `${entry.code}:${entry.path}:${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
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

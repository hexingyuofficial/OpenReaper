import {
  createAlpha3_2AExactMacroExpansion,
} from "./alpha3-2a-agent-context-macro-guide-v1.mjs";
import {
  ALPHA3_3_B1_DEPRECATED_ALIASES,
  ALPHA3_3_B1_FINAL_TARGET_IDS,
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
  alpha3_3B1ExecutorSourceId,
  canonicalizeAlpha3_3B1MacroExecutionEnvelope,
  isAlpha3_3B1VisibleExecutableMacroId,
} from "./alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
  createAlpha3_3B1bItemsAnalyzeExactManual,
} from "./alpha3-3-b1b-items-analyze-v1.mjs";

export const ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT = "alpha3.3.agent_context_macro_guide.v1";
export const ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION = "1.0.0";
export const ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT = "alpha3.3.agent_context_macro_guide.requested_expansions.v1";

const MENU_ROWS = deepFreeze(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.map((id) => compactMenuRow(id)));

export function createAlpha3_3B1AgentContextMacroGuide({
  requested_ids = [],
  missing_ids = [],
  recommended_macro_ids = [],
} = {}) {
  const requestedIds = stringArray(requested_ids);
  const missingIds = stringArray(missing_ids);
  const recommendedIds = stringArray(recommended_macro_ids)
    .filter((id) => isAlpha3_3B1VisibleExecutableMacroId(id))
    .slice(0, 3);
  const expansions = requestedIds
    .map((id) => createAlpha3_3B1ExactMacroExpansion(id))
    .filter(Boolean);
  const unresolvedIds = [...new Set([
    ...missingIds,
    ...requestedIds.filter((id) => !expansions.some((entry) => entry.id === id)),
  ])];

  return deepFreeze({
    contract: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
    version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
    phase: "Alpha3.3-B1b",
    tool_surface: {
      count: 5,
      tools: ["ping", "get_state", "list_templates", "list_recipes", "call_template"],
      macro_tool: "call_template",
      adds_public_tool: false,
    },
    macro_menu: {
      compact: true,
      flat: true,
      final_target_count: ALPHA3_3_B1_FINAL_TARGET_IDS.length,
      visible_executable_count: ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length,
      macro_ids: ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
      rows: MENU_ROWS,
      exact_manual_request: { tool: "list_templates", ids: ["macro.project.inspect"] },
    },
    recommended_macro_ids: recommendedIds,
    requested_expansions: {
      contract: ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT,
      version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      mode: requestedIds.length > 0 ? "ids" : "none",
      requested_ids: requestedIds,
      items: expansions,
      missing_ids: unresolvedIds,
    },
    compatibility: {
      visible_in_menu: false,
      aliases: ALPHA3_3_B1_DEPRECATED_ALIASES,
    },
    direct_template_fallback: {
      allowed: true,
      trigger: "only_when_no_visible_macro_covers_the_task",
      discovery_tool: "list_templates",
      request_shape: { surface: "catalog", query: "one bounded capability phrase", limit: 25 },
      typed_gap_reasons: [
        "macro_missing_for_task",
        "macro_task_out_of_scope",
        "macro_target_ambiguous_or_unavailable",
        "macro_domain_not_accepted",
        "macro_budget_prefers_atomic_template",
      ],
      routing: "Use exact or filtered Template discovery only after recording one typed fallback reason; do not add a new tool, raw SQL, or call_recipe.",
    },
    safety_boundary: {
      hidden_recipe_executor: false,
      raw_sql: false,
      raw_lua: false,
      raw_reaper_action: false,
      shell_or_process: false,
      ui_automation: false,
      hardware_or_device_io: false,
      sqlite_write_authority: false,
    },
  });
}

export function attachAlpha3_3B1AgentContextProductMetadata(response) {
  if (!isPlainObject(response)) return response;
  const requestedIds = response.mode === "ids" && Array.isArray(response.applied?.ids)
    ? response.applied.ids
    : [];
  const missingIds = Array.isArray(response.missing_ids) ? response.missing_ids : [];
  return deepFreeze({
    ...response,
    product_surface: {
      ...(isPlainObject(response.product_surface) ? response.product_surface : {}),
      agent_context_macro_guide: createAlpha3_3B1AgentContextMacroGuide({
        requested_ids: requestedIds,
        missing_ids: missingIds,
      }),
    },
  });
}

export function createAlpha3_3B1ExactMacroExpansion(id) {
  if (!isAlpha3_3B1VisibleExecutableMacroId(id)) return null;
  if (id === ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID) {
    const expansion = createAlpha3_3B1bItemsAnalyzeExactManual();
    return deepFreeze({
      ...expansion,
      contract: ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT,
      guide_contract: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
      guide_version: ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      implementation_status: "executable_registered_program",
      runnable: true,
    });
  }
  const sourceId = alpha3_3B1ExecutorSourceId(id);
  const historical = createAlpha3_2AExactMacroExpansion(sourceId);
  if (!historical) return null;

  const canonical = canonicalizeAlpha3_3B1MacroExecutionEnvelope(historical, id);
  delete canonical.guide_tier;
  canonical.id = id;
  canonical.contract = ALPHA3_3_B1_REQUESTED_EXPANSIONS_CONTRACT;
  canonical.guide_contract = ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT;
  canonical.guide_version = ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_VERSION;
  canonical.implementation_status = "executable_registered_program";
  canonical.runnable = true;
  canonical.action_manual = stripTierFields(canonical.action_manual);

  if (id === "macro.midi.apply") {
    canonical.action_manual.input_shape = {
      mode: "create_clips only in Alpha3.3-B1a; omitted defaults to create_clips. Other modes return MIDI_APPLY_MODE_UNSUPPORTED without mutation.",
      ...canonical.action_manual.input_shape,
    };
    canonical.action_manual.when_to_use = [
      "Use mode=create_clips to create one bounded PPQ-backed MIDI clip with verified item, take, count, and exact note-list readback.",
    ];
    canonical.action_manual.when_not_to_use = [
      "Do not request existing-note edits, CC edits, musical-time batches, or other macro.midi.apply modes before their runtime slices are accepted.",
    ];
  }
  if (id === "macro.fx.apply_chain") {
    canonical.action_manual.when_to_use = [
      "Use the Alpha3.3-B1a accepted ReaComp chain task; broader installed-FX chain search and application remain held.",
    ];
  }
  if (id === "macro.fx.set_controls") {
    canonical.action_manual.when_to_use = [
      "Adjust accepted semantic controls on an existing supported FX; Alpha3.3-B1a evidence remains bounded to the accepted ReaComp mapping.",
    ];
  }

  return deepFreeze(canonical);
}

function compactMenuRow(id) {
  const expansion = createAlpha3_3B1ExactMacroExpansion(id);
  const manual = expansion?.action_manual ?? {};
  return {
    id,
    purpose: firstText(manual.when_to_use) ?? id,
    risk: riskFor(id),
    implementation_status: "executable",
    expand: { tool: "list_templates", ids: [id] },
  };
}

function riskFor(id) {
  if (id === "macro.project.inspect" || id === "macro.project.query" || id === ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID) return "read";
  if (id === "macro.project.delete_targets") return "destructive";
  return "write";
}

function stripTierFields(value) {
  if (Array.isArray(value)) return value.map(stripTierFields);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["guide_tier", "primary_macro_ids", "primary_spine", "secondary_menu"].includes(key))
    .map(([key, entry]) => [key, stripTierFields(entry)]));
}

function firstText(value) {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

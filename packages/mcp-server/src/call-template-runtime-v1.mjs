import { constants as FS_CONSTANTS } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
} from "../../core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS,
} from "../../core/src/template-descriptor-v1.mjs";
import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  TEMPLATE_CATALOG_SEED_TEMPLATE_IDS,
  TEMPLATE_CATALOG_ALPHA3_C3_TEMPLATE_IDS,
  TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
  TEMPLATE_CATALOG_P1_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
  createTemplateCatalogAlpha3C3Templates,
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";
import { executeTemplate } from "../../core/src/template-execution-harness-v1.mjs";
import {
  MACRO_EXECUTION_CONTRACT,
  validateMacroExecutionEnvelope,
} from "./macro-runtime-contract-v1.mjs";
import {
  ALPHA3_2_5_B_PROJECT_INDEX_RUNTIME_CAPABILITY,
  ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY,
  executeAlpha3_2_5BProjectUnderstandingMacro,
  isAlpha3_2_5BProjectUnderstandingMacroId,
} from "./alpha3-2-5-b-project-understanding-v1.mjs";
import {
  TEMPLATE_SUMMARY_FIELDS,
  createDiscoveryCatalog,
} from "./discovery-menu-v1.mjs";
import {
  ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY,
} from "./alpha3-c4-orchestration-policy-v1.mjs";
import {
  ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_DISCOVERY_SUMMARY,
  summarizeAlpha3Block3SpeedProductization,
} from "./alpha3-block3-speed-productization-v1.mjs";
import {
  ALPHA3_BLOCK5_REUSE_ECOSYSTEM_DISCOVERY_SUMMARY,
  summarizeAlpha3Block5ReuseEcosystem,
} from "./alpha3-block5-reuse-ecosystem-v1.mjs";
import {
  ALPHA3_BLOCK2_STARTUP_READINESS_DISCOVERY_SUMMARY,
  summarizeAlpha3Block2StartupReadiness,
} from "./alpha3-block2-startup-readiness-v1.mjs";
import {
  ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY,
  ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
  ALPHA3_2D_INTERNAL_LEGACY_QUERY_IDS,
  createAlpha3C3OfficialQueryMacroDiscoveryItems,
  createAlpha3C3ProjectIndexQueryRuntimeEnvelope,
  createAlpha3_2DGenericProjectQueryDiscoveryItems,
  isAlpha3C3OfficialQueryMacroId,
  planAlpha3C3ProjectIndexQueryMacro,
} from "./alpha3-c3-project-index-query-v1.mjs";
import {
  ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
  ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS,
} from "./alpha3-2d-project-index-runtime-v1.mjs";
import {
  ALPHA3_L3_PROJECT_INDEX_USER_FLOW_DISCOVERY_SUMMARY,
  summarizeAlpha3L3ProjectIndexUserFlow,
} from "./alpha3-l3-project-index-user-flow-v1.mjs";
import {
  ALPHA3_C5_GENERIC_CONTROL_DISCOVERY_SUMMARY,
  ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
  createAlpha3C5OfficialMacroDiscoveryItems,
  isAlpha3_2_5CLegacyControlMacroId,
  isAlpha3_2_5CWithdrawnControlMacroId,
  isAlpha3C5OfficialMacroId,
  targetKindForAlpha3_2_5CLegacyControlMacro,
} from "./alpha3-c5-generic-control-macros-v1.mjs";
import {
  executeAlpha3_2_5CControlMacro,
  ALPHA3_2_5_C_CONTROL_EXECUTOR_CAPABILITY,
  ALPHA3_2_5_C_CONTROL_REGISTRY,
  ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY,
  ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY,
  isAlpha3_2_5CExecutableControlMacroId,
} from "./alpha3-2-5-c-control-runtime-v1.mjs";
import {
  ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
  ALPHA3_2_5_D_MIDI_MACRO_REGISTRY,
  createAlpha3_2_5DMidiMacroDiscoveryItem,
  executeAlpha3_2_5DMidiMacro,
  isAlpha3_2_5DMidiMacroId,
} from "./alpha3-2-5-d-midi-macro-v1.mjs";
import {
  ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
  ALPHA3_2_5_D_NATIVE_FX_REGISTRY,
  createAlpha3_2_5DNativeFxMacroDiscoveryItems,
  executeAlpha3_2_5DNativeFxMacro,
  isAlpha3_2_5DNativeFxMacroId,
} from "./alpha3-2-5-d-fx-macro-v1.mjs";
import {
  ALPHA3_L4_MACRO_EXECUTION_CONVENIENCE_DISCOVERY_SUMMARY,
  summarizeAlpha3L4MacroExecutionConvenience,
} from "./alpha3-l4-macro-execution-convenience-v1.mjs";
import {
  ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
  ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY,
  createAlpha3E1OfficialMacroDiscoveryItems,
  createAlpha3E1StockPluginRuntimeEnvelope,
  isAlpha3E1OfficialMacroId,
  planAlpha3E1StockPluginMacro,
  summarizeAlpha3E1StockPluginLiveEvidenceMatrix,
} from "./alpha3-e1-stock-plugin-fluency-v1.mjs";
import {
  ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_DISCOVERY_SUMMARY,
  summarizeAlpha3Block6StockPluginProductGate,
} from "./alpha3-block6-stock-plugin-product-gate-v1.mjs";
import {
  ALPHA3_D1_STARTUP_HEALTH_DISCOVERY_SUMMARY,
  summarizeAlpha3D1StartupHealth,
} from "./alpha3-d1-startup-health-v1.mjs";
import {
  ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY,
  summarizeAlpha3D1StartupAssistant,
  ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY,
  summarizeAlpha3D1StartupWrapper,
} from "./alpha3-d1-startup-assistant-v1.mjs";
import {
  OPENREAPER_AGENT_STARTUP_GUIDANCE_SUMMARY,
  createOpenReaperAgentStartupGuidance,
} from "./openreaper-agent-startup-guidance-v1.mjs";
import {
  ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
  createAlpha3_2EProjectInspectMacroDiscoveryItems,
} from "./alpha3-2e-small-macro-spine-v1.mjs";
import {
  ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
  createAlpha3_2EProjectDeleteTargetsMacroDiscoveryItems,
  createAlpha3_2EProjectDeleteTargetsMacroRuntimeEnvelope,
  isAlpha3_2EProjectDeleteTargetsMacroId,
  planAlpha3_2EProjectDeleteTargetsMacro,
} from "./alpha3-2e-project-delete-targets-v1.mjs";
import {
  ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
  createAlpha3_2EProjectLayoutMacroDiscoveryItems,
  createAlpha3_2EProjectLayoutMacroRuntimeEnvelope,
  isAlpha3_2EProjectLayoutMacroId,
  planAlpha3_2EProjectLayoutMacro,
} from "./alpha3-2e-project-layout-v1.mjs";
import {
  ALPHA3_2E_ROUTING_APPLY_MACRO_ID,
  createAlpha3_2ERoutingApplyMacroDiscoveryItems,
  createAlpha3_2ERoutingApplyMacroRuntimeEnvelope,
  isAlpha3_2ERoutingApplyMacroId,
  planAlpha3_2ERoutingApplyMacro,
} from "./alpha3-2e-routing-apply-v1.mjs";
import {
  ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
  createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems,
  createAlpha3_2EMediaPlaceAssetsMacroRuntimeEnvelope,
  isAlpha3_2EMediaPlaceAssetsMacroId,
  planAlpha3_2EMediaPlaceAssetsMacro,
} from "./alpha3-2e-media-place-assets-v1.mjs";
import {
  ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY,
  ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
  createAlpha3_2ERenderTargetsMacroDiscoveryItems,
  executeAlpha3_2_5CRenderTargetsMacro,
  isAlpha3_2ERenderTargetsMacroId,
} from "./alpha3-2e-render-targets-v1.mjs";
import {
  ALPHA3_2_5_C_FILE_MACRO_REGISTRY,
  ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
  createAlpha3_2C3DProjectFileMacroDiscoveryItems,
  executeAlpha3_2_5CProjectFileMacro,
  isAlpha3_2C3DProjectFileMacroId,
} from "./alpha3-2c3d-project-file-macro-v1.mjs";
import {
  ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY,
  executeAlpha3_2_5CProjectWriteMacro,
  isAlpha3_2_5CProjectWriteMacroId,
} from "./alpha3-2-5-c-project-write-runtime-v1.mjs";
import {
  ALPHA3_2_5_E_FALLBACK_GAP_REASONS,
  ALPHA3_2_5_E_MACRO_FIRST_ROUTING_CONTRACT,
  ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
  ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
  alpha3_2AContractOnlyBlockerForId,
  createAlpha3_2AContractMacroDiscoveryItems,
  isAlpha3_2AContractOnlyMacroId,
} from "./alpha3-2a-agent-context-macro-guide-v1.mjs";
import {
  ALPHA3_3_B1_FINAL_TARGET_IDS,
  adaptAlpha3_3B1CanonicalExecutionRequest,
  alpha3_3B1DeprecatedAlias,
  alpha3_3B1ExecutorSourceId,
  canonicalizeAlpha3_3B1MacroDiscoveryItem,
  canonicalizeAlpha3_3B1MacroExecutionEnvelope,
  isAlpha3_3B1DeprecatedAlias,
  isAlpha3_3B1InternalDraftMacroId,
} from "./alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  createAlpha3_3B1AgentContextMacroGuide,
} from "./alpha3-3-b1-agent-context-macro-guide-v1.mjs";
import {
  ALPHA3_3_B1B_ITEMS_ANALYZE_REGISTRY,
  createAlpha3_3B1bItemsAnalyzeDiscoveryItems,
  executeAlpha3_3B1bItemsAnalyzeMacro,
  isAlpha3_3B1bItemsAnalyzeMacroId,
} from "./alpha3-3-b1b-items-analyze-v1.mjs";
import {
  ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY,
  createAlpha3_3B1cItemsApplyDiscoveryItems,
  executeAlpha3_3B1cItemsApplyMacro,
  isAlpha3_3B1cItemsApplyMacroId,
} from "./alpha3-3-b1c-items-apply-v1.mjs";
import {
  ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY,
  createAlpha3_3B1dAutomationApplyDiscoveryItems,
  executeAlpha3_3B1dAutomationApplyMacro,
  isAlpha3_3B1dAutomationApplyMacroId,
} from "./alpha3-3-b1d-automation-apply-v1.mjs";

export const CALL_TEMPLATE_RUNTIME_CONTRACT = "call_template.runtime.v1";
export const CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT = "template.runtime.evidence.v1";
export const CALL_TEMPLATE_RUNTIME_PRODUCT_SURFACE_CONTRACT = "alpha2.product_action_surface.v1";

const CALL_TEMPLATE_RUNTIME_PRODUCT_SURFACE_EXPANDED_DETAIL_FIELDS = deepFreeze([
  "agent_startup_guidance_snapshot",
  "speed_productization_snapshot",
  "reuse_ecosystem_snapshot",
  "startup_readiness_snapshot",
  "project_index_user_flow_snapshot",
  "macro_execution_convenience_snapshot",
  "stock_plugin_live_evidence",
  "stock_plugin_product_gate_snapshot",
  "startup_health_snapshot",
  "startup_assistant_snapshot",
  "startup_wrapper_snapshot",
]);

export const CALL_TEMPLATE_RUNTIME_PRODUCT_ACTION_ITEM_FIELDS = deepFreeze([
  "template_id",
  "action_name",
  "beginner_label",
  "user_action_category",
  "current_status",
  "user_message",
  "next_step",
  "safety_note",
  "common_phrases",
  "required_input",
  "required_refs",
  "output_refs",
  "needs_confirmation",
  "fixture_requirements",
  "example_input",
]);

export const CALL_TEMPLATE_RUNTIME_PRODUCT_STATUS_VALUES = deepFreeze([
  "available_now",
  "needs_live",
  "needs_ref",
  "needs_confirmation",
  "bug_known",
  "blocked",
]);

export const CALL_TEMPLATE_RUNTIME_PRODUCT_LABEL_VALUES = deepFreeze([
  "Ready now",
  "Ready after input",
  "Start or reconnect OpenReaper",
  "Select or resolve an object first",
  "Ask before changing the project",
  "Known bug",
  "Not available in this runtime",
]);

export const CALL_TEMPLATE_RUNTIME_PRODUCT_ACTION_CATEGORY_VALUES = deepFreeze([
  "read",
  "safe_write",
  "write",
  "destructive",
  "render_or_job",
]);

export const CALL_TEMPLATE_RUNTIME_PRODUCT_WORKFLOW_RHYTHM = deepFreeze({
  id: "discover_observe_confirm_execute_readback_v1",
  default_readiness_recipe: "recipe.project.inspect_current_fixture_readiness",
  steps: [
    {
      id: "discover",
      tool: "list_templates",
      goal: "Show only actions visible in the current executable surface.",
    },
    {
      id: "observe",
      tool: "call_template",
      goal: "Read project state and collect canonical refs before mutation.",
    },
    {
      id: "target",
      tool: "list_templates",
      goal: "Choose one action and verify required_input and required_refs.",
    },
    {
      id: "confirm",
      tool: "user_confirmation",
      goal: "Ask before write, destructive, render, or ambiguous actions.",
    },
    {
      id: "execute_one",
      tool: "call_template",
      goal: "Run one template call only, never a hidden recipe executor.",
    },
    {
      id: "readback",
      tool: "call_template",
      goal: "Report request id, refs, undo/readback evidence, and typed blockers.",
    },
  ],
  stop_rules: [
    "Stop after the same typed blocker repeats twice.",
    "Stop before raw Lua, raw action execution, shell, public call_recipe, or hidden recipe execution.",
    "Stop before broad support claims outside the current evidence-bound setup.",
  ],
});

export const CALL_TEMPLATE_RUNTIME_PRODUCT_STARTUP_PREFLIGHT = deepFreeze([
  {
    id: "manual_session_visible",
    check: "Confirm REAPER is open and the manual session path, owner, and generation are known.",
    pass_signal: "The session announces the expected transport directory, owner, and generation.",
    on_fail: "Ask the user to start or paste the session line; do not run live actions.",
  },
  {
    id: "runtime_surface_visible",
    check: "Call list_templates with surface executable and confirm product_surface is present.",
    pass_signal: "product_surface.contract is alpha2.product_action_surface.v1.",
    on_fail: "Stop and report runtime surface mismatch before attempting call_template.",
  },
  {
    id: "project_observed",
    check: "Use the readiness recipe steps to read compact project, track, item, and mixer state.",
    pass_signal: "Observation returns canonical refs or typed blockers.",
    on_fail: "Keep the session read-only and explain the fixture blocker.",
  },
  {
    id: "write_target_confirmed",
    check: "Before mutation, confirm one exact target, one action, and expected readback.",
    pass_signal: "User has approved the single action and target refs are canonical.",
    on_fail: "Ask one clarifying question or stop; do not guess.",
  },
]);

export const CALL_TEMPLATE_RUNTIME_PRODUCT_BLOCKER_GUIDANCE = deepFreeze([
  {
    blocker: "live_executor_not_configured_or_not_in_allowed_group",
    user_message: "This action is known in the catalog but is not enabled in the current executable surface.",
    next_step: "Use catalog/backlog wording or configure the bounded graduated runtime before running it.",
  },
  {
    blocker: "required_ref_missing",
    user_message: "The action needs a canonical object ref first.",
    next_step: "Run the matching resolver/list/readiness step, then pass the returned ref in refs.",
  },
  {
    blocker: "same_typed_blocker_repeated",
    user_message: "The same blocker repeated twice.",
    next_step: "Stop the workflow and report the blocker instead of retrying blindly.",
  },
  {
    blocker: "raw_execution_rejected",
    user_message: "Raw Lua/action/shell execution is outside the product surface.",
    next_step: "Use an accepted template or explain that the request is unsupported.",
  },
  {
    blocker: "write_requires_confirmation",
    user_message: "This action changes the REAPER project.",
    next_step: "Ask for explicit approval, then run one template call with undo/readback evidence.",
  },
]);

export const CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE = Object.freeze({
  kind: "accepted_official_template_catalog",
  waves: Object.freeze(["wave1a", "wave2a", "wave3b", "critical_fill", "p1", "alpha3_c3"]),
});

export const CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS = deepFreeze([
  ...TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_P1_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_ALPHA3_C3_TEMPLATE_IDS,
]);

const ACCEPTED_TEMPLATE_ID_SET = new Set(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);

export const CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS = deepFreeze([
  "template.project.read_summary",
  "template.transport.read_state",
  "template.core.read_openreaper_status",
  "template.system.read_runtime_environment",
  "template.system.read_resource_paths",
]);

export const CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS = deepFreeze([
  "template.core.read_template_catalog_summary",
  "template.core.read_last_result",
  "template.system.check_api_symbols",
  "template.project.read_metadata",
  "template.project.list_markers_regions",
  "template.project.read_tempo_map",
  "template.tracks.resolve_track_ref",
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
]);

export const CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS = deepFreeze([
  "template.actions.resolve_named_command",
  "template.actions.read_action_metadata",
  "template.actions.read_action_toggle_state",
  "template.actions.read_action_shortcuts",
  "template.actions.parse_marker_action_text",
  "template.actions.search_action_commands",
  "template.midi.resolve_midi_take_ref",
  "template.midi.read_take_event_counts",
  "template.midi.list_take_notes",
  "template.midi.list_take_cc_events",
  "template.midi.list_take_text_sysex_events",
  "template.midi.read_take_grid",
  "template.media.probe_file",
  "template.media.read_take_source",
  "template.media.read_project_media_files",
]);

export const CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS = deepFreeze([
  "template.analysis.detect_loop_candidates",
  "template.analysis.measure_loop_click_risk",
  "template.analysis.create_loop_qa_report",
  "template.project.create_cleanup_report",
  "template.project.create_project_map_snapshot",
  "template.project.create_observation_bundle",
]);

export const CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS = deepFreeze([
  "template.render.render_region_wav",
  "template.render.create_delivery_report",
]);

export const CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS = deepFreeze([
  "template.items.create_layer_report",
]);

export const CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS = deepFreeze([
  "template.project.set_metadata_field",
  "template.project.create_marker",
  "template.project.create_region",
  "template.tracks.create_track",
  "template.tracks.rename_track",
  "template.tracks.set_color",
  "template.tracks.select_track",
  "template.tracks.set_mute",
  "template.tracks.set_solo",
  "template.transport.set_edit_cursor",
  "template.transport.set_time_selection",
  "template.transport.clear_time_selection",
  "template.transport.set_loop_points",
  "template.transport.clear_loop_points",
  "template.transport.set_repeat",
  "template.items.move_item",
  "template.items.trim_item",
  "template.items.set_item_fades",
  "template.items.set_take_pitch",
  "template.items.set_item_snap_offset",
  "template.midi.create_midi_item",
  "template.midi.insert_notes_batch",
  "template.midi.insert_cc_batch",
  "template.midi.insert_text_sysex_events",
]);

export const CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS = deepFreeze([
  "template.media.list_folder_media_files",
  "template.media.import_file_to_track",
  "template.media.import_file_section_to_track",
  "template.media.relink_take_source",
]);

export const CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS = deepFreeze([
  "template.items.copy_item_to_track",
  "template.items.split_item_at_time",
  "template.items.set_take_playrate",
]);

export const CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS = deepFreeze([
  "template.routing.read_track_routing",
  "template.routing.resolve_send_ref",
  "template.routing.list_track_hardware_outputs",
  "template.routing.read_project_routing_graph",
  "template.routing.list_available_audio_outputs",
]);

export const CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS = deepFreeze([
  "template.fx.resolve_fx_ref",
  "template.fx.list_track_fx_chain",
  "template.fx.list_take_fx_chain",
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.read_fx_parameter",
  "template.fx.parameter_to_envelope_mapping",
]);

export const CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS = deepFreeze([
  "template.fx.resolve_fx_ref",
  "template.fx.list_track_fx_chain",
  "template.fx.list_take_fx_chain",
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.read_fx_parameter",
  "template.fx.parameter_to_envelope_mapping",
  "template.fx.add_track_fx",
  "template.fx.add_take_fx",
  "template.fx.set_fx_bypass",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.set_fx_preset_by_name",
  "template.fx.set_fx_preset_by_index",
  "template.fx.reorder_fx",
  "template.fx.read_video_processor_code",
]);

export const CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS = deepFreeze([
  "template.routing.read_track_routing",
  "template.routing.resolve_send_ref",
  "template.routing.create_track_send",
  "template.routing.set_send_volume",
  "template.routing.set_send_pan",
  "template.routing.set_send_mute",
  "template.routing.set_send_mode",
  "template.routing.set_master_parent_send",
  "template.routing.set_track_channel_count",
  "template.routing.list_track_hardware_outputs",
  "template.routing.set_track_hardware_output",
  "template.routing.remove_track_hardware_output",
  "template.routing.read_project_routing_graph",
  "template.routing.list_available_audio_outputs",
  "template.routing.set_send_audio_channels",
  "template.routing.set_send_phase",
  "template.routing.set_send_mono",
  "template.routing.set_send_midi_channels",
  "template.routing.read_fx_pin_mapping",
  "template.automation.resolve_envelope_ref",
  "template.automation.list_project_envelopes",
  "template.automation.read_envelope_summary",
  "template.automation.read_envelope_points",
  "template.automation.evaluate_envelope_at_time",
  "template.automation.set_envelope_lane_state",
  "template.automation.insert_envelope_point",
  "template.automation.set_track_automation_mode",
  "template.automation.read_track_automation_mode",
  "template.automation.read_automation_items",
  "template.automation.set_envelope_point",
  "template.automation.insert_envelope_points_batch",
  "template.automation.delete_envelope_points",
  "template.automation.set_send_automation_mode",
  "template.automation.create_automation_item",
  "template.automation.set_automation_item_bounds",
  "template.automation.delete_automation_item",
  "template.automation.resolve_send_envelope",
  "template.automation.ensure_fx_parameter_envelope",
  "template.automation.insert_fx_parameter_envelope_points",
  "template.automation.insert_sine_wave_points",
]);

export const CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS = deepFreeze([
  "template.project.set_tempo",
  "template.project.set_bpm",
  "template.project.set_tempo_marker",
  "template.project.set_grid",
]);

export const CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS = deepFreeze([
  "template.tracks.list_tracks",
  "template.tracks.read_mixer_controls",
  "template.tracks.read_folder_structure",
  "template.tracks.set_record_arm",
  "template.tracks.set_volume",
  "template.tracks.set_pan",
  "template.tracks.set_width",
]);

export const CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS = deepFreeze([
  "template.project.read_track_item_overview",
  "template.actions.read_custom_action_metadata",
  "template.actions.read_cycle_action_metadata",
]);

export const CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS = deepFreeze([
  "template.project.delete_marker",
  "template.project.delete_region",
  "template.project.remove_marker",
  "template.project.remove_region",
  "template.project.rename_marker",
  "template.project.rename_region",
]);

export const CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS = deepFreeze([
  "template.transport.play",
  "template.transport.pause",
  "template.transport.stop_playback",
  "template.transport.set_playback_rate",
  "template.transport.start_recording",
  "template.transport.stop_recording",
  "template.transport.set_record_mode",
  "template.transport.set_punch_record_range",
  "template.transport.schedule_recording",
]);

export const CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS = deepFreeze([
  "template.items.list_selected_items",
  "template.items.list_items_on_track",
  "template.items.set_item_volume",
  "template.items.set_take_volume",
  "template.items.set_take_pan",
  "template.items.set_active_take",
  "template.items.rename_take",
  "template.items.set_loop_source",
  "template.items.set_mute",
  "template.items.set_lock",
  "template.items.set_play_all_takes",
  "template.items.set_take_start_in_source",
  "template.items.set_channel_mode",
  "template.items.set_pitch_shift_mode",
  "template.items.set_stretch_marker_fade_size",
]);

export const CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS = deepFreeze([
  "template.items.delete_item",
  "template.items.delete_items",
]);

export const CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS = deepFreeze([
  "template.items.set_no_autofades",
  "template.items.set_invert_phase",
  "template.items.choose_new_source_file",
]);

export const CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS = deepFreeze([
  "template.tracks.delete_track",
  "template.tracks.delete_tracks",
  "template.tracks.create_folder_track",
  "template.tracks.set_folder_depth",
  "template.tracks.move_track",
  "template.tracks.move_tracks",
  "template.tracks.nest_tracks_in_folder",
]);

export const CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS = deepFreeze([
  "template.midi.set_notes_batch",
  "template.midi.quantize_notes",
  "template.midi.quantize_selected_notes",
  "template.midi.set_cc_events_batch",
]);

export const CALL_TEMPLATE_RUNTIME_D21_RENDER_READ_TEMPLATE_IDS = deepFreeze([
  "template.render.read_settings",
  "template.render.resolve_bounds",
  "template.render.preview_targets",
  "template.render.read_region_matrix",
]);

export const CALL_TEMPLATE_RUNTIME_D22_RENDER_SETTINGS_WRITE_TEMPLATE_IDS = deepFreeze([
  "template.render.set_render_sample_rate",
]);

export const CALL_TEMPLATE_RUNTIME_D23_FX_DISCOVERY_READ_TEMPLATE_IDS = deepFreeze([
  "template.fx.search_installed_fx",
]);

export const CALL_TEMPLATE_RUNTIME_D27_ANALYSIS_AUDIO_TEMPLATE_IDS = deepFreeze([
  "template.analysis.measure_item_rms",
  "template.analysis.measure_item_peaks",
  "template.analysis.detect_item_silence",
  "template.analysis.detect_item_transients",
]);

export const CALL_TEMPLATE_RUNTIME_D28_SMALL_HANDLER_TEMPLATE_IDS = deepFreeze([
  "template.items.set_reverse",
  "template.project.set_snap",
  "template.fx.read_video_processor_code",
  "template.routing.track_mono_or_stereo_button",
]);

export const CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS = deepFreeze([
  "template.render.render_targets",
]);

export const CALL_TEMPLATE_RUNTIME_D29_RENDER_OUTPUT_POLICY_TEMPLATE_IDS = deepFreeze([
  "template.render.output_absolute_path",
  "template.render.output_file_metadata",
  "template.render.render_aiff",
  "template.render.render_flac",
  "template.render.render_item",
  "template.render.render_m4a",
  "template.render.render_mp3",
  "template.render.render_ogg",
  "template.render.render_opus",
  "template.render.render_region_with_track_filter",
  "template.render.render_selected_item",
  "template.render.render_selected_tracks",
  "template.render.render_track_item",
  "template.render.set_aiff_bit_depth",
  "template.render.set_flac_compression",
  "template.render.set_mp3_bitrate_or_quality",
  "template.render.set_ogg_quality_or_compression",
  "template.render.set_render_format",
  ...CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS,
]);

export const CALL_TEMPLATE_RUNTIME_D30_PROJECT_CONTAINER_TEMPLATE_IDS = deepFreeze([
  "template.project.create_project_tab",
  "template.project.create_subproject",
  "template.project.insert_subproject_item",
  "template.project.render_or_update_subproject",
]);

export const CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS = deepFreeze([
  "template.project.read_current_project_path",
  "template.project.read_dirty_state",
]);

export const CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS = deepFreeze([
  "template.project.save_current_project",
  "template.project.save_project_as",
]);

export const CALL_TEMPLATE_RUNTIME_ALPHA3_3_B1D_AUTOMATION_TEMPLATE_IDS = deepFreeze([
  "template.automation.delete_automation_item",
  "template.automation.ensure_fx_parameter_envelope",
]);

export const CALL_TEMPLATE_RUNTIME_LIVE_TEMPLATE_IDS = deepFreeze([
  ...CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
]);

const LIVE_TEMPLATE_GROUPS = Object.freeze([
  ["wave0", CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS],
  ["wave1a", CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS],
  ["read_b", CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS],
  ["first_real_a1", CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS],
  ["first_real_a2", CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS],
  ["first_real_a3", CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS],
  ["safe_write_a", CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS],
  ["e3_media_route", CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS],
  ["e4_item_route", CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS],
  ["e5_r1_routing_read", CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS],
  ["e2_fx_l1_read", CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS],
  ["e2_fx_b1_route", CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS],
  ["e5_routing_automation", CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS],
  ["d6_project_tempo", CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS],
  ["d9_tracks_mixer", CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS],
  ["d10_read_overview_actions", CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS],
  ["d11_project_marker_region", CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS],
  ["d12_transport_safe", CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS],
  ["d13_items_core", CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS],
  ["d14_items_delete", CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS],
  ["d15_items_source_phase", CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS],
  ["d16_tracks_org", CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS],
  ["d17_midi_edit", CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS],
  ["d21_render_read", CALL_TEMPLATE_RUNTIME_D21_RENDER_READ_TEMPLATE_IDS],
  ["d22_render_settings_write", CALL_TEMPLATE_RUNTIME_D22_RENDER_SETTINGS_WRITE_TEMPLATE_IDS],
  ["d23_fx_discovery_read", CALL_TEMPLATE_RUNTIME_D23_FX_DISCOVERY_READ_TEMPLATE_IDS],
  ["d27_analysis_audio", CALL_TEMPLATE_RUNTIME_D27_ANALYSIS_AUDIO_TEMPLATE_IDS],
  ["d28_small_handlers", CALL_TEMPLATE_RUNTIME_D28_SMALL_HANDLER_TEMPLATE_IDS],
  ["d31_render_targets", CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS],
  ["d29_render_output_policy", CALL_TEMPLATE_RUNTIME_D29_RENDER_OUTPUT_POLICY_TEMPLATE_IDS],
  ["d30_project_container", CALL_TEMPLATE_RUNTIME_D30_PROJECT_CONTAINER_TEMPLATE_IDS],
  ["alpha3_2c3a_project_file_read", CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS],
  ["alpha3_2c3bc_project_file_save", CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS],
]);

const CALL_TEMPLATE_RUNTIME_ALPHA3_PRODUCT_TEMPLATE_IDS = new Set([
  "template.project.create_project_map_snapshot",
  "template.project.create_observation_bundle",
  "template.automation.list_project_envelopes",
  "template.automation.delete_envelope_points",
  "template.items.set_active_take",
  ...CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
  ...CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS,
  ...CALL_TEMPLATE_RUNTIME_ALPHA3_3_B1D_AUTOMATION_TEMPLATE_IDS,
]);

export const CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS = deepFreeze(
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.filter((id) =>
    LIVE_TEMPLATE_GROUPS.some(([, ids]) => ids.includes(id)) &&
    !CALL_TEMPLATE_RUNTIME_ALPHA3_PRODUCT_TEMPLATE_IDS.has(id) &&
    id !== "template.render.render_targets",
  ),
);

export const CALL_TEMPLATE_RUNTIME_ALPHA2_HISTORICAL_EVIDENCE_TEMPLATE_IDS = deepFreeze(
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.flatMap((id) =>
    id === "template.items.set_take_volume"
      ? ["template.items.set_item_pan", id]
      : [id]
  ),
);

export const CALL_TEMPLATE_RUNTIME_ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS = deepFreeze(
  ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS.filter((id) =>
    !CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.includes(id),
  ),
);

export const CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS = deepFreeze([
  ...CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
  "template.items.set_active_take",
  ...CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
  ...CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS,
  ...CALL_TEMPLATE_RUNTIME_ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS,
  "template.automation.delete_envelope_points",
  ...CALL_TEMPLATE_RUNTIME_ALPHA3_3_B1D_AUTOMATION_TEMPLATE_IDS,
  ...CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS,
]);

// Alpha3.2-C3A reads and C3B+C3C saves have control-tower live evidence accepted on 2026-07-11.
const ROUTE_DEFINED_PENDING_LIVE_EVIDENCE_TEMPLATE_ID_SET = new Set([]);

const LIVE_EVIDENCED_TEMPLATE_ID_SET = new Set(
  LIVE_TEMPLATE_GROUPS
    .flatMap(([, ids]) => ids)
    .filter((id) => !ROUTE_DEFINED_PENDING_LIVE_EVIDENCE_TEMPLATE_ID_SET.has(id)),
);

const RUNTIME_DISCOVERY_DEFAULT_SURFACES = Object.freeze(["catalog", "executable"]);

const RUNTIME_KNOWN_TEMPLATE_BLOCKERS = Object.freeze({});

const RUNTIME_HELD_PACK_BLOCKERS = Object.freeze({
  automation: "live_promotion_held:automation",
  fx: "live_promotion_held:fx",
  routing: "live_promotion_held:routing",
});

export const CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS = deepFreeze(
  Object.values(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS).filter((id) => !ACCEPTED_TEMPLATE_ID_SET.has(id)),
);

export const CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS = Object.freeze([
  "template.core.read_template_coverage_summary",
  "template.system.read_ext_state_value",
]);

export const CALL_TEMPLATE_RUNTIME_WITHDRAWN_TEMPLATE_IDS = Object.freeze([
  "template.items.set_item_pan",
]);

export const CALL_TEMPLATE_RUNTIME_ALLOWED_REQUEST_FIELDS = Object.freeze([
  "id",
  "input",
  "refs",
  "context",
  "budget",
  "idempotency_key",
]);

export const CALL_TEMPLATE_RUNTIME_FAILURE_LAYERS = Object.freeze([
  "server_validation",
  "transport_write",
  "bridge_timeout",
  "bridge_response",
  "response_budget",
]);

export const CALL_TEMPLATE_RUNTIME_ERROR_CODES = Object.freeze([
  "CALL_TEMPLATE_REQUEST_INVALID",
  "CALL_TEMPLATE_DESCRIPTOR_REJECTED",
  "CALL_TEMPLATE_RAW_EXECUTION_REJECTED",
  "CALL_TEMPLATE_ID_NON_CATALOG",
  "CALL_TEMPLATE_ID_WORKFLOW_SHAPED",
  "CALL_TEMPLATE_ID_SEED_ONLY",
  "CALL_TEMPLATE_ID_HELD",
  "CALL_TEMPLATE_ID_REPLACED",
  "CALL_TEMPLATE_ID_WITHDRAWN",
  "CALL_TEMPLATE_ID_UNKNOWN",
  "CALL_TEMPLATE_LIVE_EXECUTOR_NOT_CONFIGURED",
  "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED",
  "CALL_TEMPLATE_PREFLIGHT_FAILED",
  "RESPONSE_TOO_LARGE",
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
const PUBLIC_MACRO_PROGRAM_REGISTRIES = Object.freeze([
  ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY,
  ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY,
  ALPHA3_2_5_C_FILE_MACRO_REGISTRY,
  ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY,
  ALPHA3_2_5_C_CONTROL_REGISTRY,
  ALPHA3_2_5_D_MIDI_MACRO_REGISTRY,
  ALPHA3_2_5_D_NATIVE_FX_REGISTRY,
  ALPHA3_3_B1B_ITEMS_ANALYZE_REGISTRY,
  ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY,
  ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY,
]);
const IN_PROCESS_MACRO_RUNTIME_CAPABILITIES = Object.freeze([
  ALPHA3_2_5_C_CONTROL_EXECUTOR_CAPABILITY,
  ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY,
]);

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
    ...createTemplateCatalogCriticalFillTemplates(),
    ...createTemplateCatalogP1Templates(),
    ...createTemplateCatalogAlpha3C3Templates(),
  ];
}

export function createAcceptedOfficialTemplateCatalog() {
  return createTemplateCatalog({
    templates: createAcceptedOfficialTemplateCatalogTemplates(),
  });
}

export function createAcceptedOfficialTemplateDiscovery() {
  const catalog = createAcceptedOfficialTemplateCatalog();
  const templates = runtimeCatalogDiscoveryTemplates(catalog, normalizeLiveRuntimeOptions());
  return runtimeTemplateDiscoveryFacade({
    catalogTemplates: templates,
    executableTemplates: templates,
    defaultSurface: "catalog",
    productSurface: { live_gate: normalizeLiveRuntimeOptions().summary },
  });
}

export function createCallTemplateRuntime(options = {}) {
  const catalog = createAcceptedOfficialTemplateCatalog();
  const retainedEvidence = [];
  const evidenceLimit = normalizeEvidenceLimit(options.evidenceLimit);
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const live = normalizeLiveRuntimeOptions(options.live);
  const projectIndexRuntime = options.projectIndexRuntime ?? null;
  const projectIndex = projectIndexRuntime?.adapter ?? options.projectIndex ?? null;
  const projectIndexArtifactReader = typeof options.projectIndexArtifactReader === "function"
    ? options.projectIndexArtifactReader
    : null;
  const catalogDiscoveryTemplates = runtimeCatalogDiscoveryTemplates(catalog, live);
  const legacyProjectIndexCompatibilityDiscovery = [];
  const macroDiscovery = (id, createItems) => {
    const readiness = runtimeMacroLiveReadiness({ id, live, projectIndexRuntime });
    return createItems({ liveRunnableNow: readiness.live_runnable_now }).map((item) => {
      const canonicalItem = canonicalizeAlpha3_3B1MacroDiscoveryItem(item, id);
      return deepFreeze({
        ...canonicalItem,
        live_runnable_now: readiness.live_runnable_now,
        known_blocker: readiness.live_runnable_now
          ? null
          : readiness.known_blocker ?? canonicalItem.known_blocker ?? "macro_fixed_dependencies_not_available",
      });
    });
  };
  const executableDiscoveryTemplates = [
    ...macroDiscovery(ALPHA3_2E_PROJECT_INSPECT_MACRO_ID, createAlpha3_2EProjectInspectMacroDiscoveryItems),
    ...macroDiscovery(ALPHA3_2D_GENERIC_PROJECT_QUERY_ID, createAlpha3_2DGenericProjectQueryDiscoveryItems),
    ...macroDiscovery(ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, createAlpha3_2EProjectDeleteTargetsMacroDiscoveryItems),
    ...macroDiscovery(ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID, createAlpha3_2EProjectLayoutMacroDiscoveryItems),
    ...macroDiscovery(ALPHA3_2C3D_PROJECT_FILE_MACRO_ID, createAlpha3_2C3DProjectFileMacroDiscoveryItems),
    ...macroDiscovery(ALPHA3_2E_ROUTING_APPLY_MACRO_ID, createAlpha3_2ERoutingApplyMacroDiscoveryItems),
    ...macroDiscovery(ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems),
    ...macroDiscovery("macro.items.analyze", createAlpha3_3B1bItemsAnalyzeDiscoveryItems),
    ...macroDiscovery("macro.items.apply", createAlpha3_3B1cItemsApplyDiscoveryItems),
    ...macroDiscovery("macro.midi.apply", (runtimeOptions) =>
      [createAlpha3_2_5DMidiMacroDiscoveryItem(runtimeOptions)]),
    ...macroDiscovery("macro.fx.apply_chain", createAlpha3_2_5DNativeFxMacroDiscoveryItems),
    ...macroDiscovery("macro.fx.set_controls", (runtimeOptions) =>
      createAlpha3E1OfficialMacroDiscoveryItems({ catalog, ...runtimeOptions })),
    ...macroDiscovery(ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID, (runtimeOptions) =>
      createAlpha3C5OfficialMacroDiscoveryItems({ catalog, ...runtimeOptions })),
    ...macroDiscovery("macro.automation.apply", createAlpha3_3B1dAutomationApplyDiscoveryItems),
    ...macroDiscovery(ALPHA3_2E_RENDER_TARGETS_MACRO_ID, createAlpha3_2ERenderTargetsMacroDiscoveryItems),
    ...createAlpha3_2AContractMacroDiscoveryItems(),
    ...legacyProjectIndexCompatibilityDiscovery,
    ...catalogDiscoveryTemplates,
  ];

  async function executeAcceptedAtomic({
    id,
    input = {},
    refs = [],
    context,
    budget,
    idempotency_key,
    observeProjectIndex = true,
    projectIndexObservationContext = null,
  }) {
    assertLiveRuntimeDispatchAllowed(live, id);
    const descriptor = resolveAcceptedCatalogDescriptor(catalog, id);
    const normalizedInput = await preflightTemplateInput(id, input, budget);
    const execution = await executeTemplate({
      descriptor,
      input: normalizedInput,
      refs,
      context,
      budget,
      idempotency_key,
      executor: live.enabled ? live.executor : options.executor,
    });
    if (!observeProjectIndex) return execution;
    return observeProjectIndexExecution({
      execution,
      id,
      projectIndexRuntime,
      projectIndexArtifactReader,
      observationInput: normalizedInput,
      observationRefs: refs,
      observationContext: projectIndexObservationContext,
    });
  }

  async function call_template(request = {}) {
    let id = null;
    try {
      const normalized = normalizeCallTemplateRequest(request);
      id = normalized.id;
      const macroAtomic = live.enabled || options.executor
        ? createMacroAtomicExecutor(executeAcceptedAtomic, normalized.context)
        : null;
      if (isAlpha3_3B1DeprecatedAlias(id)) {
        const alias = alpha3_3B1DeprecatedAlias(id, normalized.input);
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_REPLACED",
          `${id} is a hidden compatibility alias; use ${alias.replacement}.`,
          {
            recoverable: true,
            id,
            details: {
              id,
              implementation_status: "deprecated_alias",
              replacement: alias.replacement,
              replacement_input: alias.replacement_input,
              replacement_available_now: alias.replacement_available_now ?? true,
              ...(alias.blocker_code ? { blocker_code: alias.blocker_code } : {}),
              ...(alias.blocker_message ? { blocker_message: alias.blocker_message } : {}),
            },
          },
        );
      }
      if (isAlpha3_3B1InternalDraftMacroId(id)) {
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_HELD",
          `${id} is an internal Alpha3.3 draft and is not publicly callable before its executable runtime and evidence are accepted.`,
          {
            recoverable: true,
            id,
            details: {
              id,
              implementation_status: "internal_draft",
              visible: false,
            },
          },
        );
      }
      if (isAlpha3_3B1bItemsAnalyzeMacroId(id)) {
        const envelope = await executeAlpha3_3B1bItemsAnalyzeMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_3B1cItemsApplyMacroId(id)) {
        const envelope = await executeAlpha3_3B1cItemsApplyMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_3B1dAutomationApplyMacroId(id)) {
        const envelope = await executeAlpha3_3B1dAutomationApplyMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (["macro.midi.apply", "macro.fx.apply_chain", "macro.fx.set_controls"].includes(id)) {
        const adapted = adaptAlpha3_3B1CanonicalExecutionRequest(normalized);
        if (!adapted.ok) {
          throw new CallTemplateRuntimeError(
            "CALL_TEMPLATE_REQUEST_INVALID",
            adapted.message,
            {
              recoverable: true,
              id,
              details: { blocker_code: adapted.code, ...adapted.details },
            },
          );
        }
        let envelope;
        if (adapted.executor_id === ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID) {
          envelope = await executeAlpha3_2_5DMidiMacro({
            request: adapted.request,
            executeAtomic: macroAtomic,
            projectIndexRuntime,
            catalog,
            now,
          });
        } else if (adapted.executor_id === ALPHA3_2_5_D_NATIVE_FX_MACRO_ID) {
          envelope = await executeAlpha3_2_5DNativeFxMacro({
            request: adapted.request,
            executeAtomic: macroAtomic,
            projectIndexRuntime,
            catalog,
            now,
          });
        } else {
          envelope = await executeAlpha3_2_5CControlMacro({
            request: adapted.request,
            executeAtomic: macroAtomic,
            projectIndexRuntime,
            catalog,
            now,
          });
        }
        const canonicalEnvelope = canonicalizeAlpha3_3B1MacroExecutionEnvelope(envelope, id);
        retainEvidence(retainedEvidence, evidenceFromExecution(canonicalEnvelope, live.evidence), evidenceLimit);
        return canonicalEnvelope;
      }
      if (isAlpha3_2_5BProjectUnderstandingMacroId(id)) {
        const envelope = await executeAlpha3_2_5BProjectUnderstandingMacro({
          request: normalized,
          projectIndexRuntime,
          catalog,
          executeAtomic: macroAtomic,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2_5CProjectWriteMacroId(id)) {
        const envelope = await executeAlpha3_2_5CProjectWriteMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2ERenderTargetsMacroId(id)) {
        const envelope = await executeAlpha3_2_5CRenderTargetsMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          managedRenderRoot: options.managedRenderRoot,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2C3DProjectFileMacroId(id)) {
        const envelope = await executeAlpha3_2_5CProjectFileMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2AContractOnlyMacroId(id)) {
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_HELD",
          "This Alpha3.2 macro id is a contract/manual discovery entry and is not runtime-callable before its bounded implementation slice is accepted.",
          {
            recoverable: true,
            id,
            details: {
              id,
              implementation_status: "contract_only_non_runnable",
              blocker: alpha3_2AContractOnlyBlockerForId(id),
              guide_contract: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
              guide_version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
              recovery: "Expand this exact id through list_templates for its action_manual, then use only currently accepted atomic templates or compatibility macros.",
            },
          },
        );
      }
      if (ALPHA3_2D_INTERNAL_LEGACY_QUERY_IDS.includes(id)) {
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_REPLACED",
          "This legacy Project Index query macro is internal-only after Alpha3.2-D; use macro.project.query with the mapped entity.",
          {
            recoverable: true,
            id,
            details: { id, replacement: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID },
          },
        );
      }
      if (id === "macro.selected_context") {
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_REPLACED",
          "macro.selected_context is consolidated into macro.project.query with entity=selected_context.",
          {
            recoverable: true,
            id,
            details: {
              id,
              replacement: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
              replacement_input: { entity: "selected_context" },
            },
          },
        );
      }
      if (isAlpha3C3OfficialQueryMacroId(id)) {
        const plan = planAlpha3C3ProjectIndexQueryMacro(id, {
          ...normalized.input,
          refs: normalized.input?.refs ?? normalized.refs,
        }, { projectIndex, catalog });
        const envelope = createAlpha3C3ProjectIndexQueryRuntimeEnvelope({
          request: normalized,
          plan,
          projectIndex,
          catalog,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2_5CExecutableControlMacroId(id)) {
        const envelope = await executeAlpha3_2_5CControlMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          catalog,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2_5DMidiMacroId(id)) {
        const envelope = await executeAlpha3_2_5DMidiMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          catalog,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2_5DNativeFxMacroId(id)) {
        const envelope = await executeAlpha3_2_5DNativeFxMacro({
          request: normalized,
          executeAtomic: macroAtomic,
          projectIndexRuntime,
          catalog,
          now,
        });
        retainEvidence(retainedEvidence, evidenceFromExecution(envelope, live.evidence), evidenceLimit);
        return envelope;
      }
      if (isAlpha3_2_5CLegacyControlMacroId(id)) {
        const targetKind = targetKindForAlpha3_2_5CLegacyControlMacro(id);
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_REPLACED",
          `${id} is consolidated into macro.controls.set.`,
          {
            recoverable: true,
            id,
            details: {
              id,
              replacement: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
              replacement_input: {
                target_kind: targetKind,
                fields: normalized.input?.fields ?? {},
              },
            },
          },
        );
      }
      if (isAlpha3_2_5CWithdrawnControlMacroId(id)) {
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_WITHDRAWN",
          "macro.set_midi_controls is withdrawn; use macro.midi.create_clip for bounded clip creation and direct accepted Templates for uncovered MIDI edits.",
          {
            recoverable: true,
            id,
            details: {
              id,
              implementation_status: "withdrawn",
              executable_replacement: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
              future_candidates: ["macro.midi.edit_notes"],
            },
          },
        );
      }
      if (CALL_TEMPLATE_RUNTIME_WITHDRAWN_TEMPLATE_IDS.includes(id)) {
        throw new CallTemplateRuntimeError(
          "CALL_TEMPLATE_ID_WITHDRAWN",
          "template.items.set_item_pan is withdrawn because REAPER does not expose a verified Item-level pan write. For explicit Active Take pan, use macro.controls.set with target_kind=take or template.items.set_take_pan only after confirming active_take_identity; never reinterpret a multi-Take Item as Item pan.",
          {
            recoverable: true,
            id,
            details: {
              id,
              implementation_status: "withdrawn",
              reason_code: "ITEM_PAN_NOT_A_VERIFIED_REAPER_PROPERTY",
              active_take_macro: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
              active_take_macro_input: {
                target_kind: "take",
                fields: { pan: normalized.input?.pan ?? 0 },
              },
              active_take_template: "template.items.set_take_pan",
              requires: ["confirm active_take_identity", "explicit Active Take intent"],
            },
          },
        );
      }
      const observedExecution = await executeAcceptedAtomic({
        id,
        input: normalized.input,
        refs: normalized.refs,
        context: normalized.context,
        budget: normalized.budget,
        idempotency_key: normalized.idempotency_key,
      });
      retainEvidence(retainedEvidence, evidenceFromExecution(observedExecution, live.evidence), evidenceLimit);
      return observedExecution;
    } catch (error) {
      const envelope = runtimeErrorEnvelope({
        id,
        error,
        now,
        budget: safeRuntimeBudget(request?.budget),
      });
      retainEvidence(retainedEvidence, evidenceFromRuntimeError(envelope, live.evidence), evidenceLimit);
      return envelope;
    }
  }

  return Object.freeze({
    contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
    accepted_catalog: acceptedCatalogSummary(catalog),
    live_gate: live.summary,
    list_templates: runtimeTemplateDiscoveryFacade({
      catalogTemplates: catalogDiscoveryTemplates,
      executableTemplates: executableDiscoveryTemplates,
      defaultSurface: "executable",
      productSurface: { live_gate: live.summary },
    }).list_templates,
    async call_template(request = {}) {
      const response = await call_template(request);
      return enforceRuntimeResponseContract(response, request, now);
    },
    evidence() {
      return cloneJson(retainedEvidence);
    },
    last_evidence() {
      return cloneJson(retainedEvidence.at(-1) ?? null);
    },
  });
}

async function observeProjectIndexExecution({
  execution,
  id,
  projectIndexRuntime,
  projectIndexArtifactReader,
  observationInput,
  observationRefs,
  observationContext,
}) {
  if (!projectIndexRuntime || !ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS.includes(id) || execution?.ok !== true) {
    return execution;
  }
  const initialObservation = projectIndexRuntime.observeSuccessfulTemplateExecution({
    ...execution,
    project_index_observation_context: {
      input: cloneJson(observationInput ?? {}),
      refs: cloneJson(observationRefs ?? []),
      ...(isPlainObject(observationContext) ? cloneJson(observationContext) : {}),
    },
    identity: {
      ...projectIndexRuntime.identity,
      session_id: projectIndexRuntime.session_id,
    },
  });
  let observation = initialObservation;
  let artifactReadSummary = null;
  const artifactRequired = initialObservation?.blockers?.find((entry) => entry?.code === "ARTIFACT_PAYLOAD_REQUIRED");
  const artifactRef = artifactRequired?.details?.artifact_refs?.find((ref) => typeof ref === "string");
  if (artifactRef && projectIndexArtifactReader) {
    try {
      const artifactRead = await projectIndexArtifactReader({
        artifact_ref: artifactRef,
        template_id: id,
        execution,
      });
      const payload = artifactPayloadFromRead(artifactRead);
      if (payload) {
        observation = projectIndexRuntime.observeArtifactPayload({
          templateId: id,
          artifactRef,
          payload,
          validated: true,
          identity: {
            ...projectIndexRuntime.identity,
            session_id: projectIndexRuntime.session_id,
          },
        });
        artifactReadSummary = {
          ok: observation.ok === true,
          artifact_ref: artifactRef,
          view: "payload",
        };
      } else {
        artifactReadSummary = {
          ok: false,
          artifact_ref: artifactRef,
          error_code: artifactRead?.error?.code ?? "ARTIFACT_PAYLOAD_UNAVAILABLE",
        };
      }
    } catch (error) {
      artifactReadSummary = {
        ok: false,
        artifact_ref: artifactRef,
        error_code: error?.code ?? "ARTIFACT_PAYLOAD_READ_FAILED",
      };
    }
  }
  return deepFreeze({
    ...execution,
    result: {
      ...execution.result,
      ...(initialObservation !== observation
        ? { project_index_initial_observation: initialObservation }
        : {}),
      project_index_observation: observation,
      ...(artifactReadSummary ? { project_index_artifact_read: artifactReadSummary } : {}),
    },
  });
}

function artifactPayloadFromRead(value) {
  if (isPlainObject(value?.result?.artifact?.payload)) return value.result.artifact.payload;
  if (isPlainObject(value?.artifact?.payload)) return value.artifact.payload;
  if (isPlainObject(value?.payload)) return value.payload;
  return null;
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

const PROJECT_SAVE_CURRENT_TEMPLATE_ID = "template.project.save_current_project";
const PROJECT_SAVE_AS_TEMPLATE_ID = "template.project.save_project_as";
const PROJECT_SAVE_AS_MAX_PATH_BYTES = 2048;
const PROJECT_FILE_SAVE_MIN_RESPONSE_BYTES = 65_536;
const PROJECT_SAVE_AS_RESERVED_BASENAMES = new Set([
  ".ds_store",
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

async function preflightTemplateInput(id, input, budget) {
  if (id !== PROJECT_SAVE_CURRENT_TEMPLATE_ID && id !== PROJECT_SAVE_AS_TEMPLATE_ID) return input;
  assertProjectFileSaveResponseBudget(id, budget);
  if (id === PROJECT_SAVE_CURRENT_TEMPLATE_ID) return input;
  return validateProjectSaveAsTarget(input, { id });
}

function assertProjectFileSaveResponseBudget(id, budget) {
  const maxResponseBytes = isPlainObject(budget) && Number.isInteger(budget.max_response_bytes)
    ? budget.max_response_bytes
    : FOUNDATION_BRIDGE_DEFAULT_BUDGET.max_response_bytes;
  projectSaveAsPreflightAssert(
    maxResponseBytes >= PROJECT_FILE_SAVE_MIN_RESPONSE_BYTES,
    "success_envelope_budget_minimum_required",
    "Project-file saves require max_response_bytes >= 65536 so the complete bounded success envelope is conservatively proven before executor dispatch.",
    { id, max_response_bytes: maxResponseBytes, required_minimum_bytes: PROJECT_FILE_SAVE_MIN_RESPONSE_BYTES },
  );
}

export async function validateProjectSaveAsTarget(input, { id = PROJECT_SAVE_AS_TEMPLATE_ID } = {}) {
  const targetPath = input?.target_path;
  const overwrite = input?.overwrite;
  projectSaveAsPreflightAssert(typeof targetPath === "string", "target_path_type", "save_project_as target_path must be a string.", { id });
  projectSaveAsPreflightAssert(Buffer.byteLength(targetPath) > 0, "target_path_empty", "save_project_as target_path must not be empty.", { id });
  projectSaveAsPreflightAssert(Buffer.byteLength(targetPath) <= PROJECT_SAVE_AS_MAX_PATH_BYTES, "target_path_too_long", "save_project_as target_path exceeds the bounded path budget.", { id });
  projectSaveAsPreflightAssert(!/[\u0000-\u001f\u007f]/u.test(targetPath), "target_path_control_character", "save_project_as target_path contains a NUL or control character.", { id });
  projectSaveAsPreflightAssert(overwrite === true, "overwrite_true_required_for_dispatch", "save_project_as requires explicit overwrite=true authorization for the preflight-to-REAPER dispatch race; atomic overwrite=false is held for a future contract.", { id, atomic_overwrite_false: "held_future" });
  const windowsDriveAbsolute = /^[A-Za-z]:[\\/]/u.test(targetPath);
  projectSaveAsPreflightAssert(windowsDriveAbsolute || !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(targetPath), "target_path_uri", "save_project_as rejects URI and URL targets.", { id });
  projectSaveAsPreflightAssert(path.isAbsolute(targetPath), "target_path_relative", "save_project_as requires an absolute target path.", { id });
  projectSaveAsPreflightAssert(!/[\\/]$/u.test(targetPath), "target_path_directory", "save_project_as target must name a .RPP file, not a directory.", { id });

  const rawParent = path.dirname(targetPath);
  const normalizedTarget = path.normalize(targetPath);
  const parsed = path.parse(normalizedTarget);
  projectSaveAsPreflightAssert(rawParent === parsed.dir, "parent_path_not_normalized", "save_project_as requires an already-normalized parent path without dot segments or redundant separators.", { id, path: rawParent, canonical_parent: parsed.dir });
  const basename = parsed.base;
  const stem = basename.slice(0, -parsed.ext.length);
  projectSaveAsPreflightAssert(normalizedTarget !== parsed.root, "target_path_root", "save_project_as rejects filesystem-root targets.", { id });
  projectSaveAsPreflightAssert(normalizedTarget !== path.normalize(homedir()), "target_path_home", "save_project_as rejects the home directory itself as a target.", { id });
  projectSaveAsPreflightAssert(basename.length > 0 && stem.trim().length > 0 && !/^\.+$/u.test(stem), "target_basename_invalid", "save_project_as requires a non-empty safe basename.", { id });
  projectSaveAsPreflightAssert(parsed.ext.toLowerCase() === ".rpp", "target_extension_invalid", "save_project_as accepts only .RPP targets.", { id });
  projectSaveAsPreflightAssert(!PROJECT_SAVE_AS_RESERVED_BASENAMES.has(stem.toLowerCase()), "target_basename_reserved", "save_project_as rejects reserved or dangerous target names.", { id });

  const parent = parsed.dir;
  projectSaveAsPreflightAssert(parent !== parsed.root, "parent_filesystem_root_rejected", "save_project_as rejects the filesystem root as a target parent.", { id, path: parent });
  projectSaveAsPreflightAssert(parent !== path.normalize(homedir()), "parent_home_directory_rejected", "save_project_as rejects the home directory itself as a target parent.", { id, path: parent });
  await assertProjectSaveAsParentChain(parent, id);
  let parentStat;
  try {
    parentStat = await lstat(parent);
  } catch (error) {
    throw projectSaveAsFsError(error, "parent_missing", "save_project_as target parent must exist.", id, parent);
  }
  projectSaveAsPreflightAssert(!parentStat.isSymbolicLink(), "parent_symlink", "save_project_as rejects a symlink parent directory.", { id, path: parent });
  projectSaveAsPreflightAssert(parentStat.isDirectory(), "parent_not_directory", "save_project_as target parent must be a real directory.", { id, path: parent });
  try {
    await access(parent, FS_CONSTANTS.W_OK);
  } catch (error) {
    throw projectSaveAsFsError(error, "parent_not_writable", "save_project_as target parent is not writable.", id, parent);
  }
  let canonicalParent;
  try {
    canonicalParent = await realpath(parent);
  } catch (error) {
    throw projectSaveAsFsError(error, "parent_realpath_failed", "save_project_as could not resolve the target parent safely.", id, parent);
  }
  projectSaveAsPreflightAssert(canonicalParent === parent, "parent_path_not_canonical", "save_project_as rejects parent paths that resolve through aliases or symlinks.", { id, path: parent, canonical_parent: canonicalParent });

  const validatedTarget = path.join(canonicalParent, basename);
  let targetStat = null;
  try {
    targetStat = await lstat(validatedTarget);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw projectSaveAsFsError(error, "target_lstat_failed", "save_project_as could not inspect the final target safely.", id, validatedTarget);
    }
  }
  if (targetStat) {
    projectSaveAsPreflightAssert(!targetStat.isSymbolicLink(), "target_symlink", "save_project_as rejects a symlink final target.", { id, path: validatedTarget });
    projectSaveAsPreflightAssert(targetStat.isFile(), "target_not_regular_file", "save_project_as existing target must be a regular file.", { id, path: validatedTarget });
  }

  return {
    target_path: validatedTarget,
    overwrite,
  };
}

async function assertProjectSaveAsParentChain(parent, id) {
  const parsed = path.parse(parent);
  let current = parsed.root;
  for (const segment of parent.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let currentStat;
    try {
      currentStat = await lstat(current);
    } catch (error) {
      throw projectSaveAsFsError(error, "parent_chain_missing", "save_project_as target parent chain must already exist.", id, current);
    }
    projectSaveAsPreflightAssert(!currentStat.isSymbolicLink(), "parent_chain_symlink", "save_project_as rejects symlinks in the target parent chain.", { id, path: current });
    projectSaveAsPreflightAssert(currentStat.isDirectory(), "parent_chain_not_directory", "save_project_as target parent chain must contain only directories.", { id, path: current });
  }
}

function projectSaveAsPreflightAssert(condition, reason, message, details = {}) {
  if (condition) return;
  throw new CallTemplateRuntimeError("CALL_TEMPLATE_PREFLIGHT_FAILED", message, {
    recoverable: true,
    id: details.id,
    details: {
      blocker: reason,
      ...boundedProjectSaveAsDetails(details),
    },
  });
}

function projectSaveAsFsError(error, reason, message, id, targetPath) {
  return new CallTemplateRuntimeError("CALL_TEMPLATE_PREFLIGHT_FAILED", message, {
    recoverable: true,
    id,
    details: {
      blocker: reason,
      path: boundedString(targetPath, 512),
      filesystem_code: boundedString(error?.code, 80),
    },
  });
}

function boundedProjectSaveAsDetails(details) {
  const bounded = { ...details };
  delete bounded.id;
  for (const key of ["path", "canonical_parent"]) {
    if (bounded[key] !== undefined) bounded[key] = boundedString(bounded[key], 512);
  }
  return bounded;
}

function assertLiveRuntimeDispatchAllowed(live, id) {
  if (!live.opted_in) return;
  if (!live.enabled) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_LIVE_EXECUTOR_NOT_CONFIGURED",
      "Live call_template execution requires an explicitly configured live bridge executor.",
      {
        recoverable: true,
        details: {
          allowed_template_ids: live.allowed_template_ids,
          spawned_reaper: false,
        },
        id,
      },
    );
  }
  if (!live.allowedTemplateIdSet.has(id)) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED",
      "Live bridge executor is restricted to the configured small live-smoke template allowlist.",
      {
        recoverable: true,
        details: {
          id,
          allowed_template_ids: live.allowed_template_ids,
          spawned_reaper: false,
        },
        id,
      },
    );
  }
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
      ...runtimeFailureDiagnostics({
        source: "runtime",
        code: normalized.code,
        details: normalized.details,
        recoverable: normalized.recoverable,
      }),
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

function enforceRuntimeResponseContract(response, request, now) {
  const budget = safeRuntimeBudget(request?.budget);
  if (!isPlainObject(response)) {
    return compactRuntimeErrorEnvelope({
      id: normalizePossibleId(request?.id),
      code: "CALL_TEMPLATE_REQUEST_INVALID",
      message: "call_template runtime returned a non-object response.",
      recoverable: false,
      budget,
      now,
    });
  }

  if (response.contract === MACRO_EXECUTION_CONTRACT) {
    return enforceMacroExecutionResponse(response, request, budget, now);
  }

  const diagnosed = response.error
    ? {
        ...response,
        error: {
          ...response.error,
          ...runtimeFailureDiagnostics(response.error),
        },
      }
    : response;
  const candidate = withRuntimeResponseBudget(diagnosed, budget, false);
  if (candidate.budget.response_bytes <= budget.max_response_bytes) {
    return candidate;
  }

  return compactRuntimeErrorEnvelope({
    id: diagnosed.template?.id ?? normalizePossibleId(request?.id),
    code: "RESPONSE_TOO_LARGE",
    message: "call_template response exceeded max_response_bytes; retry with a compact budget or bounded fields.",
    recoverable: true,
    budget,
    now,
    details: {
      original_response_bytes: candidate.budget.response_bytes,
      max_response_bytes: budget.max_response_bytes,
    },
  });
}

function enforceMacroExecutionResponse(response, request, budget, now) {
  const candidate = cloneJson(response);
  candidate.budget.max_bytes = Math.min(
    candidate.budget.max_bytes,
    budget.max_response_bytes,
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate.budget.actual_bytes = encodedBytes(candidate);
  }
  const validation = validateMacroExecutionEnvelope(candidate);
  if (validation.valid && candidate.budget.actual_bytes <= candidate.budget.max_bytes) {
    return deepFreeze(candidate);
  }
  return compactRuntimeErrorEnvelope({
    id: response.macro?.id ?? normalizePossibleId(request?.id),
    code: candidate.budget.actual_bytes > candidate.budget.max_bytes
      ? "RESPONSE_TOO_LARGE"
      : "CALL_TEMPLATE_REQUEST_INVALID",
    message: candidate.budget.actual_bytes > candidate.budget.max_bytes
      ? "Macro response exceeded max_response_bytes; retry with a smaller limit or narrower fields."
      : "Macro runtime returned an envelope outside macro.execution.v1.",
    recoverable: true,
    budget,
    now,
    details: {
      validation_errors: validation.errors.slice(0, 8),
      response_bytes: candidate.budget.actual_bytes,
    },
  });
}

function withRuntimeResponseBudget(response, budget, truncated) {
  const candidate = {
    ...cloneJson(response),
    budget: {
      ...(isPlainObject(response.budget) ? response.budget : {}),
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: Boolean(truncated || response.budget?.truncated),
    },
  };
  candidate.budget.response_bytes = encodedBytes(candidate);
  return deepFreeze(candidate);
}

function compactRuntimeErrorEnvelope({ id, code, message, recoverable, budget, now, details }) {
  const diagnostics = runtimeFailureDiagnostics({
    source: "runtime",
    code,
    details,
    recoverable,
  });
  const full = {
    contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
    ok: false,
    template: { id: boundedString(id ?? null, 96), pack: null, risk: null },
    request: null,
    completed_at: safeNowIso(now),
    error: {
      source: "runtime",
      code,
      message: boundedString(message, 240),
      recoverable: Boolean(recoverable),
      ...(details !== undefined ? { details } : {}),
      ...diagnostics,
    },
    budget: {
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: code === "RESPONSE_TOO_LARGE",
    },
  };
  const compact = withRuntimeResponseBudget(full, budget, code === "RESPONSE_TOO_LARGE");
  if (compact.budget.response_bytes <= budget.max_response_bytes) return compact;

  const minimal = {
    contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
    ok: false,
    error: {
      source: "runtime",
      code,
      message: boundedString(message, 160),
      recoverable: Boolean(recoverable),
      failure_layer: diagnostics.failure_layer ?? null,
      recommended_next_action: compactRecommendedNextAction(code, diagnostics.failure_layer),
      copy_paste_safe_guidance: compactCopyPasteSafeGuidance(diagnostics.failure_layer),
    },
    budget: {
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: code === "RESPONSE_TOO_LARGE",
    },
  };
  return withRuntimeResponseBudget(minimal, budget, code === "RESPONSE_TOO_LARGE");
}

function compactRecommendedNextAction(code, failureLayer) {
  if (failureLayer === "response_budget" || code === "RESPONSE_TOO_LARGE") {
    return "Call call_template again with budget.max_items=10 and budget.max_inline_value_bytes=512.";
  }
  if (failureLayer === "transport_write") {
    return "Call ping, then retry call_template after the managed bridge is ready.";
  }
  if (failureLayer === "bridge_timeout") {
    return "Call ping and inspect bounded state before retrying a mutation.";
  }
  if (failureLayer === "bridge_response") {
    return "Call ping, reconnect the managed session if needed, then retry call_template.";
  }
  return "Fix the reported call_template request fields, then retry through the MCP tool.";
}

function compactCopyPasteSafeGuidance(failureLayer) {
  return `OpenReaper MCP only (${failureLayer ?? "runtime"}); no direct bridge, Lua, shell, or UI execution.`;
}

function runtimeFailureDiagnostics(error = {}) {
  const source = error.source;
  const code = error.code;
  const details = isPlainObject(error.details) ? error.details : {};
  const blocker = details.blocker;
  const failureLayer = runtimeFailureLayer({ source, code, blocker });
  const action = runtimeRecommendedNextAction({ failureLayer, code, blocker });
  return {
    failure_layer: failureLayer,
    recommended_next_action: action,
    copy_paste_safe_guidance: runtimeCopyPasteSafeGuidance({ failureLayer, code, blocker }),
  };
}

function runtimeFailureLayer({ source, code, blocker }) {
  if (code === "RESPONSE_TOO_LARGE") return "response_budget";
  if (code === "CALL_TEMPLATE_LIVE_EXECUTOR_NOT_CONFIGURED") return "transport_write";
  if (blocker === "live_bridge_request_write_failed" ||
      blocker === "live_bridge_transport_absent" ||
      blocker === "reaper_bridge_script_absent" ||
      blocker === "live_bridge_executor_not_configured") {
    return "transport_write";
  }
  if (code === "BRIDGE_TIMEOUT" || blocker === "live_bridge_handshake_failed") {
    return "bridge_timeout";
  }
  if (code === "BRIDGE_RESULT_INVALID" || blocker === "live_bridge_result_invalid" ||
      code === "BRIDGE_OWNER_MISMATCH" || code === "BRIDGE_GENERATION_MISMATCH") {
    return "bridge_response";
  }
  if ((source === "harness" || source === "runtime") &&
      (String(code).startsWith("TEMPLATE_") || String(code).startsWith("CALL_TEMPLATE_"))) {
    return "server_validation";
  }
  if (source === "stdio_context" || source === "stdio") return "server_validation";
  return null;
}

function runtimeRecommendedNextAction({ failureLayer, code, blocker }) {
  if (failureLayer === "server_validation") {
    return {
      code: "fix_request_and_retry",
      tool: "call_template",
      instruction: "Fix the reported id, input, refs, context, or budget fields, then retry call_template through the MCP tool.",
    };
  }
  if (failureLayer === "transport_write") {
    return {
      code: "check_openreaper_bridge_readiness",
      tool: "ping",
      input: {},
      then: "Retry call_template after ping reports the managed OpenReaper bridge is ready.",
    };
  }
  if (failureLayer === "bridge_timeout") {
    return {
      code: "inspect_before_retry",
      tool: "ping",
      input: {},
      then: "For a mutation, inspect bounded state before retrying; for an idempotent call, retry with the same idempotency_key only after readiness is confirmed.",
    };
  }
  if (failureLayer === "bridge_response") {
    return {
      code: "reconnect_managed_session",
      tool: "ping",
      input: {},
      then: "Retry the supported call_template only after the managed bridge reports ready; discard the malformed response.",
    };
  }
  if (failureLayer === "response_budget") {
    return {
      code: "retry_compact_response",
      tool: "call_template",
      request_patch: { budget: { max_items: 10, max_inline_value_bytes: 512 } },
      instruction: "Retry call_template with bounded fields, paging, or artifact refs instead of requesting a large inline payload.",
    };
  }
  return {
    code: "inspect_supported_runtime_status",
    tool: "ping",
    input: {},
    then: "Use only the existing OpenReaper MCP tools and retry after the reported blocker is resolved.",
  };
}

function runtimeCopyPasteSafeGuidance({ failureLayer, code, blocker }) {
  const layer = failureLayer ?? "runtime";
  return `OpenReaper MCP recovery (${layer}): use ping, get_state, list_templates, list_recipes, or call_template only; do not open transport files or use raw bridge, Lua, shell, or UI execution.`;
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

function evidenceFromExecution(execution, liveEvidence) {
  const result = execution?.result ?? {};
  const lastResult = result.last_result ?? {};
  const isMacro = execution?.contract === MACRO_EXECUTION_CONTRACT;
  return deepFreeze(pruneUndefined({
    contract: CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
    template: {
      id: isMacro ? execution?.macro?.id ?? null : execution?.template?.id ?? null,
      pack: isMacro ? null : execution?.template?.pack ?? null,
      risk: isMacro ? execution?.macro?.risk ?? null : execution?.template?.risk ?? null,
    },
    ok: Boolean(execution?.ok),
    error: execution?.ok
      ? null
      : {
          source: execution?.error?.source ?? null,
          code: execution?.error?.code ?? null,
    },
    request_id: isMacro ? execution?.request?.request_id ?? null : execution?.request?.id ?? null,
    bridge: {
      expected_owner: execution?.request?.bridge?.expected_owner ?? null,
      expected_generation: execution?.request?.bridge?.expected_generation ?? null,
      owner: execution?.bridge?.owner ?? null,
      generation: execution?.bridge?.generation ?? null,
    },
    counts: {
      refs: isMacro
        ? Array.isArray(result.canonical_refs) ? result.canonical_refs.length : 0
        : Array.isArray(result.refs) ? result.refs.length : 0,
      artifacts: isMacro
        ? Array.isArray(result.artifact_refs) ? result.artifact_refs.length : 0
        : Array.isArray(result.artifacts) ? result.artifacts.length : 0,
      jobs: Array.isArray(result.jobs) ? result.jobs.length : 0,
      last_result_refs: Array.isArray(lastResult.refs) ? lastResult.refs.length : 0,
    },
    last_result_updated: Boolean(lastResult.updated),
    timestamps: {
      request_created_at: execution?.request?.created_at ?? null,
      completed_at: isMacro ? execution?.execution?.completed_at ?? null : execution?.completed_at ?? null,
    },
    live: liveEvidence,
  }));
}

function evidenceFromRuntimeError(envelope, liveEvidence) {
  return deepFreeze(pruneUndefined({
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
    live: liveEvidence,
  }));
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

function createMacroAtomicExecutor(executeAtomic, parentContext) {
  let childIndex = 0;
  return (childRequest = {}) => {
    childIndex += 1;
    const sourceContext = isPlainObject(childRequest.context)
      ? childRequest.context
      : isPlainObject(parentContext)
        ? parentContext
        : {};
    const baseTime = new Date(sourceContext.created_at ?? Date.now()).getTime();
    const childCreatedAt = new Date(
      (Number.isFinite(baseTime) ? baseTime : Date.now()) + childIndex,
    ).toISOString();
    return executeAtomic({
      ...childRequest,
      context: {
        ...sourceContext,
        created_at: childCreatedAt,
      },
    });
  };
}

function runtimeMacroLiveReadiness({ id, live, projectIndexRuntime }) {
  if (!live.opted_in || !live.enabled) {
    return deepFreeze({
      live_runnable_now: false,
      known_blocker: "live_executor_not_configured",
    });
  }

  const executorSourceId = alpha3_3B1ExecutorSourceId(id);
  const entry = PUBLIC_MACRO_PROGRAM_REGISTRIES
    .map((registry) => registry.get(executorSourceId))
    .find(Boolean) ?? null;
  if (!entry) {
    return deepFreeze({
      live_runnable_now: false,
      known_blocker: "macro_program_not_registered",
    });
  }

  const missingTemplateIds = entry.dependencies.template_ids
    .filter((templateId) => !live.allowedTemplateIdSet.has(templateId));
  const availableRuntimeCapabilities = new Set(IN_PROCESS_MACRO_RUNTIME_CAPABILITIES);
  if (projectIndexRuntimeReady(projectIndexRuntime)) {
    availableRuntimeCapabilities.add(ALPHA3_2_5_B_PROJECT_INDEX_RUNTIME_CAPABILITY);
    availableRuntimeCapabilities.add(ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY);
  }
  const missingRuntimeCapabilities = entry.dependencies.runtime_capabilities
    .filter((capability) => !availableRuntimeCapabilities.has(capability));

  if (missingTemplateIds.length > 0 || missingRuntimeCapabilities.length > 0) {
    return deepFreeze({
      live_runnable_now: false,
      known_blocker: "macro_fixed_dependencies_not_available",
    });
  }
  return deepFreeze({ live_runnable_now: true, known_blocker: null });
}

function projectIndexRuntimeReady(runtime) {
  if (runtime?.contract !== ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT
    || runtime.ok !== true
    || !runtime.adapter
    || typeof runtime.status !== "function") return false;
  try {
    const status = runtime.status();
    return status?.contract === ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT
      && status.ok === true
      && status.lifecycle !== "closed"
      && status.lifecycle !== "stale_session";
  } catch {
    return false;
  }
}

function runtimeCatalogDiscoveryTemplates(catalog, live) {
  return catalog.list().map((descriptor) => {
    const allowedGroup = liveAllowedGroupForTemplateId(descriptor.id);
    const knownBlocker = runtimeKnownBlocker(descriptor);
    const liveRunnableNow =
      Boolean(
        knownBlocker === null
        && live.opted_in
        && live.enabled
        && live.allowedTemplateIdSet.has(descriptor.id),
      );
    return deepFreeze({
      ...descriptor,
      kind: "template",
      exists_in_catalog: true,
      live_runnable_now: liveRunnableNow,
      evidence_level: acceptedTemplateEvidenceLevel(descriptor.id),
      support_state: knownBlocker === null ? "supported" : "blocked",
      known_blocker: liveRunnableNow
        ? null
        : knownBlocker ?? "live_executor_not_configured_or_not_in_allowed_group",
      allowed_live_group: allowedGroup,
    });
  });
}

function runtimeTemplateDiscoveryFacade({ catalogTemplates, executableTemplates, defaultSurface, productSurface = {} }) {
  const templatesById = new Map([
    ...catalogTemplates,
    ...executableTemplates,
  ].map((template) => [template.id, template]));
  const catalogDiscovery = createDiscoveryCatalog({ templates: catalogTemplates });
  const executableAllDiscovery = createDiscoveryCatalog({ templates: executableTemplates });
  const executableMenuDiscovery = createDiscoveryCatalog({
    templates: executableTemplates.filter((template) => runtimeActionStatus(template) !== "blocked"
      && runtimeActionStatus(template) !== "bug_known"),
  });

  return Object.freeze({
    list_templates(request = {}) {
      const normalized = normalizeRuntimeDiscoveryRequest(request, defaultSurface);
      const discovery = discoveryForRuntimeRequest(normalized, {
        catalogDiscovery,
        executableAllDiscovery,
        executableMenuDiscovery,
      });
      return runtimeActionDiscoveryResponse(
        discovery.list_templates(runtimeCapabilityTruthRequest(normalized.request)),
        normalized.surface,
        templatesById,
        productSurface,
        normalized.request,
      );
    },
  });
}

function discoveryForRuntimeRequest(normalized, discoveries) {
  if (normalized.surface === "catalog") return discoveries.catalogDiscovery;
  return runtimeDiscoveryRequestHasIds(normalized.request)
    ? discoveries.executableAllDiscovery
    : discoveries.executableMenuDiscovery;
}

function normalizeRuntimeDiscoveryRequest(request, defaultSurface) {
  if (!isPlainObject(request)) {
    return {
      request,
      surface: defaultSurface,
    };
  }

  const surface = request.surface === undefined ? defaultSurface : request.surface;
  if (!RUNTIME_DISCOVERY_DEFAULT_SURFACES.includes(surface)) {
    throw new CallTemplateRuntimeError(
      "CALL_TEMPLATE_REQUEST_INVALID",
      "list_templates surface must be either catalog or executable.",
      {
        recoverable: true,
        details: { allowed_surfaces: RUNTIME_DISCOVERY_DEFAULT_SURFACES },
      },
    );
  }

  const { surface: _surface, ...withoutSurface } = request;
  return {
    request: withoutSurface,
    surface,
  };
}

function runtimeDiscoveryRequestHasIds(request) {
  if (!isPlainObject(request)) return false;
  if (Array.isArray(request.ids)) return request.ids.length > 0;
  return typeof request.ids === "string" && request.ids.trim() !== "";
}

function runtimeActionDiscoveryResponse(response, surface, templatesById, productSurface = {}, request = {}) {
  const attachActionMetadata = runtimeShouldAttachActionMetadata(request);
  const macroFirstRouting = runtimeMacroFirstRoutingDecision({ response, surface, request });
  return deepFreeze({
    ...response,
    product_surface: runtimeProductSurfaceMetadata(surface, productSurface, {
      detail_level: response.mode === "ids" ? "expanded" : "compact",
      requested_ids: response.mode === "ids" ? response.applied.ids : [],
      missing_ids: response.missing_ids,
    }, macroFirstRouting),
    items: response.items.map((item) => {
      if (!attachActionMetadata) return item;
      const descriptor = templatesById.get(item.id) ?? item;
      return {
        ...item,
        ...runtimeActionMetadata(descriptor),
      };
    }),
    applied: {
      ...response.applied,
      surface,
    },
  });
}

function runtimeShouldAttachActionMetadata(request) {
  if (!isPlainObject(request) || !Array.isArray(request.fields)) return true;
  return !(request.fields.length === 1 && request.fields[0] === "id");
}

function runtimeMacroFirstRoutingDecision({ response, surface, request }) {
  const ids = response.items.map((item) => item.id).filter((id) => typeof id === "string");
  const macroIds = ids.filter((id) => id.startsWith("macro.")).slice(0, ALPHA3_3_B1_FINAL_TARGET_IDS.length);
  const templateIds = ids.filter((id) => id.startsWith("template."));
  const queryPresent = isPlainObject(request) && typeof request.query === "string" && request.query.trim() !== "";
  const exactIds = response.mode === "ids";
  let route = "macro_first";
  let fallbackGap = null;

  if (macroIds.length === 0 && templateIds.length > 0) {
    route = "template_fallback";
    fallbackGap = {
      recorded: true,
      reason: ALPHA3_2_5_E_FALLBACK_GAP_REASONS[1],
      next_action: "Use the returned bounded Template ids directly or expand exact ids; do not invent a Macro or raw execution path.",
    };
  } else if (macroIds.length === 0 && templateIds.length === 0) {
    route = "no_match";
    fallbackGap = {
      recorded: true,
      reason: ALPHA3_2_5_E_FALLBACK_GAP_REASONS[0],
      next_action: surface === "catalog"
        ? "Narrow the catalog query or pack filter, then record the uncovered task if no accepted Template matches."
        : "Retry list_templates with surface=catalog and one bounded query or pack filter.",
    };
  }

  return {
    contract: ALPHA3_2_5_E_MACRO_FIRST_ROUTING_CONTRACT,
    route,
    surface,
    mode: response.mode,
    query_present: queryPresent,
    exact_ids: exactIds,
    macro_match_count: macroIds.length,
    template_match_count: templateIds.length,
    selected_macro_ids: macroIds,
    fallback_gap: fallbackGap,
    task_text_persisted: false,
  };
}

function runtimeProductSurfaceMetadata(surface, productSurface = {}, guideRequest = {}, macroFirstRouting = null) {
  const expanded = guideRequest.detail_level === "expanded";
  return {
    contract: CALL_TEMPLATE_RUNTIME_PRODUCT_SURFACE_CONTRACT,
    surface,
    detail_level: expanded ? "expanded" : "compact",
    expanded_via: "exact_ids",
    expanded_detail_fields: CALL_TEMPLATE_RUNTIME_PRODUCT_SURFACE_EXPANDED_DETAIL_FIELDS,
    agent_startup_guidance: OPENREAPER_AGENT_STARTUP_GUIDANCE_SUMMARY,
    ...(expanded ? { agent_startup_guidance_snapshot: createOpenReaperAgentStartupGuidance() } : {}),
    agent_context_macro_guide: createAlpha3_3B1AgentContextMacroGuide({
      requested_ids: guideRequest.requested_ids,
      missing_ids: guideRequest.missing_ids,
      recommended_macro_ids: macroFirstRouting?.selected_macro_ids?.slice(0, 3) ?? [],
    }),
    macro_first_routing: macroFirstRouting,
    item_schema: {
      fields: CALL_TEMPLATE_RUNTIME_PRODUCT_ACTION_ITEM_FIELDS,
      status_values: CALL_TEMPLATE_RUNTIME_PRODUCT_STATUS_VALUES,
      beginner_label_values: CALL_TEMPLATE_RUNTIME_PRODUCT_LABEL_VALUES,
      category_values: CALL_TEMPLATE_RUNTIME_PRODUCT_ACTION_CATEGORY_VALUES,
    },
    workflow_rhythm: CALL_TEMPLATE_RUNTIME_PRODUCT_WORKFLOW_RHYTHM,
    startup_preflight: CALL_TEMPLATE_RUNTIME_PRODUCT_STARTUP_PREFLIGHT,
    blocker_guidance: CALL_TEMPLATE_RUNTIME_PRODUCT_BLOCKER_GUIDANCE,
    orchestration_policy: ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY,
    speed_productization: ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_DISCOVERY_SUMMARY,
    ...(expanded ? { speed_productization_snapshot: summarizeAlpha3Block3SpeedProductization() } : {}),
    reuse_ecosystem: ALPHA3_BLOCK5_REUSE_ECOSYSTEM_DISCOVERY_SUMMARY,
    ...(expanded ? { reuse_ecosystem_snapshot: summarizeAlpha3Block5ReuseEcosystem() } : {}),
    startup_readiness: ALPHA3_BLOCK2_STARTUP_READINESS_DISCOVERY_SUMMARY,
    ...(expanded ? {
      startup_readiness_snapshot: summarizeAlpha3Block2StartupReadiness({
        health: { runtime: productSurface.live_gate },
        assistant: { runtime: productSurface.live_gate },
        wrapper: { runtime: productSurface.live_gate },
      }),
    } : {}),
    project_index_queries: ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY,
    project_index_user_flow: ALPHA3_L3_PROJECT_INDEX_USER_FLOW_DISCOVERY_SUMMARY,
    ...(expanded ? { project_index_user_flow_snapshot: summarizeAlpha3L3ProjectIndexUserFlow() } : {}),
    generic_control_macros: ALPHA3_C5_GENERIC_CONTROL_DISCOVERY_SUMMARY,
    macro_execution_convenience: ALPHA3_L4_MACRO_EXECUTION_CONVENIENCE_DISCOVERY_SUMMARY,
    ...(expanded ? { macro_execution_convenience_snapshot: summarizeAlpha3L4MacroExecutionConvenience() } : {}),
    stock_plugin_fluency: ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY,
    ...(expanded ? { stock_plugin_live_evidence: summarizeAlpha3E1StockPluginLiveEvidenceMatrix() } : {}),
    stock_plugin_product_gate: ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_DISCOVERY_SUMMARY,
    ...(expanded ? { stock_plugin_product_gate_snapshot: summarizeAlpha3Block6StockPluginProductGate() } : {}),
    startup_health: ALPHA3_D1_STARTUP_HEALTH_DISCOVERY_SUMMARY,
    ...(expanded ? {
      startup_health_snapshot: summarizeAlpha3D1StartupHealth({
        runtime: productSurface.live_gate,
      }),
    } : {}),
    startup_assistant: ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY,
    ...(expanded ? {
      startup_assistant_snapshot: summarizeAlpha3D1StartupAssistant({
        runtime: productSurface.live_gate,
      }, {
        include_openreaper_script_path: surface === "executable",
      }),
    } : {}),
    startup_wrapper: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY,
    ...(expanded ? {
      startup_wrapper_snapshot: summarizeAlpha3D1StartupWrapper({
        runtime: productSurface.live_gate,
      }),
    } : {}),
  };
}

function runtimeCapabilityTruthRequest(request) {
  if (!isPlainObject(request)) return request;
  const fields = Array.isArray(request.fields) ? request.fields : null;
  const ids = Array.isArray(request.ids) ? request.ids : [];

  if (fields === null) {
    return {
      ...request,
      fields: [...TEMPLATE_SUMMARY_FIELDS, "capability_truth"],
    };
  }

  if (ids.length > 0 && !fields.includes("capability_truth") && !fields.includes("capabilityTruth")) {
    return {
      ...request,
      fields: [...fields, "capability_truth"],
    };
  }

  return request;
}

function acceptedTemplateEvidenceLevel(id) {
  if (Object.hasOwn(RUNTIME_KNOWN_TEMPLATE_BLOCKERS, id)) return "blocked_typed";
  if (ROUTE_DEFINED_PENDING_LIVE_EVIDENCE_TEMPLATE_ID_SET.has(id)) {
    return "route_defined_pending_live_evidence";
  }
  if (LIVE_EVIDENCED_TEMPLATE_ID_SET.has(id)) return "live_smoked";
  const pack = templatePackFromId(id);
  if (Object.hasOwn(RUNTIME_HELD_PACK_BLOCKERS, pack)) return "route_defined_pending_live_promotion";
  return "runtime_bound_static_fake";
}

function liveAllowedGroupForTemplateId(id) {
  for (const [group, ids] of LIVE_TEMPLATE_GROUPS) {
    if (ids.includes(id)) return group;
  }
  return null;
}

function runtimeKnownBlocker(descriptor) {
  if (Object.hasOwn(RUNTIME_KNOWN_TEMPLATE_BLOCKERS, descriptor.id)) {
    return RUNTIME_KNOWN_TEMPLATE_BLOCKERS[descriptor.id];
  }
  if (LIVE_EVIDENCED_TEMPLATE_ID_SET.has(descriptor.id)) {
    return null;
  }
  if (Object.hasOwn(RUNTIME_HELD_PACK_BLOCKERS, descriptor.pack)) {
    return RUNTIME_HELD_PACK_BLOCKERS[descriptor.pack];
  }
  return null;
}

function runtimeActionMetadata(item) {
  const currentStatus = runtimeActionStatus(item);
  return pruneUndefined({
    template_id: item.id,
    action_kind: item.action_kind,
    macro_kind: item.macro_kind,
    menu_group: item.menu_group,
    execution_shape: item.execution_shape,
    user_label: item.user_label,
    task_intents: item.task_intents,
    support_status: item.support_status,
    action_name: runtimeActionName(item),
    beginner_label: runtimeBeginnerLabel(item, currentStatus),
    user_action_category: runtimeUserActionCategory(item),
    current_status: currentStatus,
    user_message: runtimeActionUserMessage(item, currentStatus),
    next_step: runtimeNextStep(item, currentStatus),
    safety_note: runtimeSafetyNote(item),
    common_phrases: runtimeCommonPhrases(item),
    required_input: requiredInputFields(item),
    required_refs: compactRefDeclarations(inputRefDeclarations(item).filter((ref) => ref.required === true)),
    output_refs: compactRefDeclarations(outputRefDeclarations(item)),
    needs_confirmation: runtimeActionNeedsConfirmation(item),
    fixture_requirements: runtimeFixtureRequirements(item, currentStatus),
    example_input: firstExampleInput(item),
  });
}

function runtimeActionStatus(item) {
  const blocker = typeof item.known_blocker === "string" ? item.known_blocker : null;
  if (blocker?.startsWith("known_bug:")) return "bug_known";
  if (item.support_state === "blocked") return "blocked";
  if (item.execution_shape === "registered_macro_program" && item.live_runnable_now !== true) return "needs_live";
  if (item.live_runnable_now !== true && !runtimeActionIsPlanOnlyMacro(item)) return "blocked";
  if (inputRefDeclarations(item).some((ref) => ref.required === true)) return "needs_ref";
  if (runtimeActionNeedsConfirmation(item)) return "needs_confirmation";
  return "available_now";
}

function runtimeActionIsPlanOnlyMacro(item) {
  return item.action_kind === "macro"
    && item.support_status === "plan_only_runtime_bound"
    && item.execution_shape !== "live_reaper_write";
}

function runtimeActionIsContractOnlyGuideMacro(item) {
  return item.action_kind === "macro"
    && item.execution_shape === "contract_only_non_runnable"
    && item.guide_contract === ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT;
}

function runtimeActionUserMessage(item, currentStatus) {
  if (runtimeActionIsContractOnlyGuideMacro(item)) {
    return "Contract/manual discovery entry only. It is not executable or live-runnable until its named Alpha3.2 implementation slice is accepted.";
  }
  if (item.action_kind === "macro" && currentStatus === "available_now") {
    return item.execution_shape === "registered_macro_program"
      ? "Ready to execute one registered bounded Macro program through call_template."
      : "Ready to return a plan-only macro bundle through call_template; child actions still run as accepted template calls.";
  }
  if (item.execution_shape === "registered_macro_program" && currentStatus === "needs_live") {
    return "This executable Macro needs the configured OpenReaper live route before its bounded program can run.";
  }
  if (currentStatus === "available_now") {
    return "Ready to run in the current bounded live runtime.";
  }
  if (currentStatus === "needs_ref") {
    return "Resolve the required canonical ref first, then call this template.";
  }
  if (currentStatus === "needs_confirmation") {
    return "Requires explicit user confirmation, undo coverage, and readback verification before running.";
  }
  if (currentStatus === "bug_known") {
    return "Hidden from the default executable surface until the known runtime bug is fixed.";
  }
  const blocker = typeof item.known_blocker === "string"
    ? item.known_blocker
    : "live_executor_not_configured_or_not_in_allowed_group";
  if (blocker.startsWith("live_handler_missing:tempo")) {
    return "Tempo/BPM writes are still catalog/planned capabilities; the live handler is not landed yet.";
  }
  if (blocker.startsWith("live_promotion_held:")) {
    return "This route is held from the default executable surface until a bounded live/design window accepts it.";
  }
  return "Not available in the current bounded live runtime; keep it in the internal landing backlog.";
}

function runtimeBeginnerLabel(item, currentStatus) {
  if (item.execution_shape === "registered_macro_program" && currentStatus === "available_now") return "Ready now";
  if (item.action_kind === "macro" && currentStatus === "available_now") return "Ready as macro plan";
  if (currentStatus === "available_now" && requiredInputFields(item).length > 0) return "Ready after input";
  return ({
    available_now: "Ready now",
    needs_live: "Start or reconnect OpenReaper",
    needs_ref: "Select or resolve an object first",
    needs_confirmation: "Ask before changing the project",
    bug_known: "Known bug",
    blocked: "Not available in this runtime",
  })[currentStatus] ?? "Check status";
}

function runtimeUserActionCategory(item) {
  if (item.risk === "destructive") return "destructive";
  if (item.bridge?.operation_family === "run_job") return "render_or_job";
  if (item.risk === "write") return "write";
  if (item.risk === "safe") return "safe_write";
  return "read";
}

function runtimeNextStep(item, currentStatus) {
  if (runtimeActionIsContractOnlyGuideMacro(item)) {
    return "Use list_templates exact-id expansion to read action_manual; do not call_template this id before the later bounded implementation is accepted.";
  }
  if (item.action_kind === "macro" && currentStatus === "available_now") {
    if (item.execution_shape === "registered_macro_program") {
      return "Call this Macro through call_template; it executes its bounded registered program and returns final data, evidence, and typed blockers in macro.execution.v1.";
    }
    return "Call this macro id through call_template to get child call_template requests, typed blockers, and readback requirements.";
  }
  if (item.execution_shape === "registered_macro_program" && currentStatus === "needs_live") {
    return "Start or reconnect the managed OpenReaper bridge, then call this Macro through call_template.";
  }
  if (currentStatus === "blocked") {
    return "Keep this in catalog/backlog view or configure a bounded live executor allowlist that includes this template.";
  }
  if (currentStatus === "bug_known") {
    return "Do not run this action until the known bug fix is accepted and smoke-tested.";
  }
  if (currentStatus === "needs_ref") {
    return "Run a resolver or list action first, then pass the returned canonical ref in refs.";
  }
  if (currentStatus === "needs_confirmation") {
    return "Confirm the exact target and change, then call the template with undo/readback verification.";
  }
  if (requiredInputFields(item).length > 0) {
    return "Fill required_input using the example_input shape, then call_template.";
  }
  return "Call this template directly through call_template.";
}

function runtimeSafetyNote(item) {
  if (runtimeActionIsContractOnlyGuideMacro(item)) {
    return "Discovery contract only: no call_template execution, REAPER mutation, live claim, raw action/Lua/shell/UI path, or hidden executor.";
  }
  if (item.action_kind === "macro") {
    if (item.execution_shape === "registered_macro_program") {
      return "Registered bounded Macro program: only declared audited stages may execute; no raw SQL, Lua, action, shell, UI, alias, or hidden model executor is exposed.";
    }
    return "Macro planner only: no direct REAPER mutation, no alias execution, and no hidden executor.";
  }
  if (item.risk === "destructive") return "Destructive action: use only in a disposable or explicitly approved project.";
  if (item.risk === "write") return "Changes the REAPER project: require user approval, undo evidence, and readback.";
  if (item.risk === "safe") return "Safe write: still verify the target and readback after running.";
  if (item.bridge?.operation_family === "run_job") return "Job/output action: use bounded output roots and retain evidence.";
  return "Read-only action: safe for inspection before making changes.";
}

function runtimeCommonPhrases(item) {
  const actionWords = runtimeActionName(item).replaceAll("_", " ");
  const title = typeof item.title === "string" ? item.title.trim().toLocaleLowerCase() : "";
  const pack = typeof item.pack === "string" ? item.pack.trim() : "";
  return [...new Set([
    title,
    actionWords,
    pack && actionWords ? `${pack} ${actionWords}` : "",
  ].filter(Boolean))].slice(0, 4);
}

function runtimeActionName(item) {
  const id = typeof item.id === "string" ? item.id : "";
  if (id.startsWith("macro.")) {
    return id.slice("macro.".length).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
  const [, pack = "", rawName = id] = id.match(/^template\.([^.]+)\.(.+)$/) ?? [];
  const name = rawName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const prefix = runtimeActionNamePrefix(pack);
  if (prefix === "" || name.startsWith(`${prefix}_`) || name.endsWith(`_${prefix}`)) return name;
  if (name.startsWith("set_")) return `set_${prefix}_${name.slice("set_".length)}`;
  if (name.startsWith("read_")) return `read_${prefix}_${name.slice("read_".length)}`;
  if (name.startsWith("resolve_")) return `resolve_${prefix}_${name.slice("resolve_".length)}`;
  if (name.startsWith("select_")) return `select_${prefix}_${name.slice("select_".length)}`;
  if (name.startsWith("rename_")) return `rename_${prefix}_${name.slice("rename_".length)}`;
  if (name.startsWith("delete_")) return `delete_${prefix}_${name.slice("delete_".length)}`;
  return `${prefix}_${name}`;
}

function runtimeActionNamePrefix(pack) {
  return ({
    actions: "action",
    automation: "automation",
    core: "core",
    fx: "fx",
    items: "item",
    media: "media",
    midi: "midi",
    project: "project",
    render: "render",
    routing: "routing",
    system: "system",
    tracks: "track",
    transport: "transport",
  })[pack] ?? pack;
}

function runtimeActionNeedsConfirmation(item) {
  return item.risk === "write"
    || item.risk === "destructive"
    || item.expectedDelta?.kind === "mutation"
    || item.bridge?.operation_family === "run_command"
    || item.bridge?.operation_family === "run_job";
}

function runtimeFixtureRequirements(item, currentStatus) {
  if (currentStatus === "bug_known") {
    return ["known_bug_fix_required"];
  }
  if (currentStatus === "blocked") {
    const blocker = typeof item.known_blocker === "string"
      ? item.known_blocker
      : "live_executor_or_allowed_group_required";
    return [blocker];
  }
  if (currentStatus === "needs_live") {
    return ["managed_openreaper_bridge_required"];
  }
  const requirements = [];
  for (const ref of inputRefDeclarations(item).filter((entry) => entry.required === true)) {
    requirements.push(`${ref.kind}_ref_required`);
  }
  if (runtimeActionNeedsConfirmation(item)) {
    requirements.push("explicit_confirmation_required");
    requirements.push("undo_and_readback_required");
  }
  return requirements;
}

function requiredInputFields(item) {
  const required = Array.isArray(item.inputSchema?.required) ? item.inputSchema.required : [];
  return required.filter((entry) => typeof entry === "string");
}

function compactRefDeclarations(refs) {
  return refs.map((ref) => pruneUndefined({
    name: ref.name,
    kind: ref.kind,
    required: ref.required,
    summary: ref.summary,
  }));
}

function normalizeAlpha3C5MacroRefs(id, refs) {
  if (isPlainObject(refs)) return refs;
  const refArray = Array.isArray(refs) ? refs : [];
  if (id === "macro.set_track_controls") {
    const trackRef = firstObjectRef(refArray, "track");
    return trackRef === null ? {} : { track_ref: trackRef.ref };
  }
  if (id === "macro.set_send_controls") {
    const sendRef = firstObjectRef(refArray, "send");
    const trackRef = firstObjectRef(refArray, "track");
    return pruneUndefined({
      send_ref: sendRef?.ref,
      track_ref: trackRef?.ref,
    });
  }
  if (id === "macro.set_item_controls" || id === "macro.set_take_controls") {
    const itemRef = firstObjectRef(refArray, "item");
    return itemRef === null ? {} : { item_ref: itemRef.ref };
  }
  if (id === "macro.set_midi_controls") {
    const takeRef = firstObjectRef(refArray, "take");
    return takeRef === null ? {} : { take_ref: takeRef.ref };
  }
  return {};
}

function firstObjectRef(refs, kind) {
  return refs.find((ref) => isPlainObject(ref) && ref.kind === kind && typeof ref.ref === "string") ?? null;
}

function inputRefDeclarations(item) {
  return Array.isArray(item.refs?.input) ? item.refs.input.filter(isPlainObject) : [];
}

function outputRefDeclarations(item) {
  return Array.isArray(item.refs?.output) ? item.refs.output.filter(isPlainObject) : [];
}

function firstExampleInput(item) {
  const example = Array.isArray(item.examples) ? item.examples[0] : null;
  return isPlainObject(example?.input) ? cloneJson(example.input) : {};
}

function templatePackFromId(id) {
  const match = typeof id === "string" ? id.match(/^template\.([^.]+)\./) : null;
  return match?.[1] ?? "";
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

function normalizeLiveRuntimeOptions(input) {
  if (!isPlainObject(input) || input.opted_in !== true) {
    return {
      opted_in: false,
      enabled: false,
      executor: null,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
      allowedTemplateIdSet: new Set(CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS),
      evidence: undefined,
      summary: deepFreeze({
        opted_in: false,
        executor_configured: false,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
        spawned_reaper: false,
      }),
    };
  }

  const executor = input.executor;
  const enabled = typeof executor === "function" || Boolean(executor && typeof executor.dispatch === "function");
  const allowedTemplateIds = normalizeLiveAllowedTemplateIds(input.allowed_template_ids);
  const evidence = deepFreeze(pruneUndefined({
    opted_in: true,
    executor_configured: enabled,
    allowed_template_ids: allowedTemplateIds,
    opt_in_env: boundedString(input.opt_in_env),
    opt_in_flag: boundedString(input.opt_in_flag),
    executor: boundedLiveExecutorConfig(input.executor_config ?? executor?.config),
    spawned_reaper: false,
  }));
  return {
    opted_in: true,
    enabled,
    executor,
    allowed_template_ids: allowedTemplateIds,
    allowedTemplateIdSet: new Set(allowedTemplateIds),
    evidence,
    summary: evidence,
  };
}

function normalizeLiveAllowedTemplateIds(value) {
  if (!Array.isArray(value)) return CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS;
  const allowedGroups = [
    CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D21_RENDER_READ_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D22_RENDER_SETTINGS_WRITE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D23_FX_DISCOVERY_READ_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D27_ANALYSIS_AUDIO_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D28_SMALL_HANDLER_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D29_RENDER_OUTPUT_POLICY_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_D30_PROJECT_CONTAINER_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
    CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  ];
  const allowed = new Set(allowedGroups.flatMap((group) => group));
  const uniqueIds = [...new Set(value)];
  if (uniqueIds.some((id) => !allowed.has(id))) return deepFreeze([]);
  const ids = uniqueIds.filter((id) => allowed.has(id));
  for (const group of allowedGroups) {
    if (ids.length === group.length && group.every((id, index) => id === ids[index])) {
      return group;
    }
  }
  return deepFreeze([]);
}

function boundedLiveExecutorConfig(config) {
  if (!isPlainObject(config)) return undefined;
  return cloneJson(pruneUndefined({
    contract: boundedString(config.contract),
    kind: boundedString(config.kind),
    transport_dir: boundedString(config.transport_dir, 240),
    bridge_script_path: boundedString(config.bridge_script_path, 240),
    timeout_ms: Number.isInteger(config.timeout_ms) ? config.timeout_ms : undefined,
    poll_interval_ms: Number.isInteger(config.poll_interval_ms) ? config.poll_interval_ms : undefined,
  }));
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

function pruneUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

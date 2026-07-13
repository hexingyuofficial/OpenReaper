import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  createObjectRef,
  validateFoundationBridgeResult,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  artifactIdFromCommandId,
  artifactPathFromRef,
  formatArtifactRef,
  normalizeArtifactEnvelope,
  parseArtifactRef,
} from "../packages/core/src/artifact-state-store-v1.mjs";
import {
  createArtifactStateStoreEnvelope,
  writeArtifactStateStoreEnvelope,
} from "../packages/core/src/artifact-state-store-live-helper-v1.mjs";
import {
  createGetStateArtifactRuntime,
} from "../packages/mcp-server/src/get-state-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
  createLiveBridgeExecutorFromEnv,
} from "../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const WAVE1A_OPT_IN_ENV = "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE";
const FIRST_REAL_A1_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A1_LIVE_SMOKE";
const FIRST_REAL_A2_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A2_LIVE_SMOKE";
const FIRST_REAL_A3_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A3_LIVE_SMOKE";
const SAFE_WRITE_A_OPT_IN_ENV = "OPENREAPER_SAFE_WRITE_A_LIVE_SMOKE";
const OPT_IN_FLAG = "--live";
const READ_B_FLAG = "--read-b";
const FIRST_REAL_A1_FLAG = "--first-real-a1";
const FIRST_REAL_A2_FLAG = "--first-real-a2-render";
const FIRST_REAL_A3_FLAG = "--first-real-a3-layer-report";
const SAFE_WRITE_A_FLAG = "--safe-write-a";
const E2_FX_L1_READ_ROUTE_FLAG = "--fx-read";
const E2_FX_B1_ROUTE_FLAG = "--fx-b1";
const E5_R1_ROUTING_READ_ROUTE_FLAG = "--routing-read";
const E5_ROUTING_AUTOMATION_ROUTE_FLAG = "--routing-automation";
const D6_PROJECT_TEMPO_ROUTE_FLAG = "--project-tempo";
const E3_MEDIA_ROUTE_FLAG = "--media-route";
const E4_ITEM_ROUTE_FLAG = "--item-route";
const PHASE_FLAG = "--phase";
const FIRST_REAL_A2_PHASE = "A2-render-delivery";
const FIRST_REAL_A3_PHASE = "A3-layer-report";
const FAKE_FLAG = "--fake";
const OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER";
const GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION";
const SESSION_ENV = "OPENREAPER_LIVE_BRIDGE_SESSION_ID";
const TRACK_REF_ENV = "OPENREAPER_LIVE_SMOKE_TRACK_REF";
const ITEM_REF_ENV = "OPENREAPER_LIVE_SMOKE_ITEM_REF";
const FIRST_REAL_A1_ITEM_REF_ENV = "OPENREAPER_FIRST_REAL_A_ITEM_REF";
const FIRST_REAL_A1_PROJECT_REF_ENV = "OPENREAPER_FIRST_REAL_A_PROJECT_REF";
const FIRST_REAL_A1_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const FIRST_REAL_A1_BATCH = "First-Real-Fixture-A A1";
const FIRST_REAL_A2_REGION_REF_ENV = "OPENREAPER_FIRST_REAL_A_REGION_REF";
const FIRST_REAL_A2_PROJECT_REF_ENV = "OPENREAPER_FIRST_REAL_A_PROJECT_REF";
const FIRST_REAL_A2_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const FIRST_REAL_A2_RENDER_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_RENDER_ROOT";
const FIRST_REAL_A2_BATCH = "First-Real-Fixture-A A2 Render Route";
const FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV = "OPENREAPER_FIRST_REAL_A_LAYER_EVIDENCE_REF";
const FIRST_REAL_A3_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const FIRST_REAL_A3_BATCH = "First-Real-Fixture-A A3 Layer Report Route";
const FIRST_REAL_A3_DEFAULT_LAYER_EVIDENCE_REF =
  "artifact:items:layer_evidence:art_20260704000000000_003_a3a3a3";
const READ_B_BATCH = "read-b-live-handlers";
const SAFE_WRITE_A_BATCH = "Safe-Write-A";
const E2_FX_L1_READ_ROUTE_BATCH = "E2 FX-L1 Read Route";
const E2_FX_B1_ROUTE_BATCH = "E2 FX-B1 Route";
const E5_R1_ROUTING_READ_ROUTE_BATCH = "E5-R1 Routing Read Route";
const E5_ROUTING_AUTOMATION_ROUTE_BATCH = "E5 Routing/Automation Route";
const D6_PROJECT_TEMPO_ROUTE_BATCH = "D6 Project Tempo Route";
const E3_MEDIA_ROUTE_BATCH = "E3 Media Route";
const E4_ITEM_ROUTE_BATCH = "E4 Item Route";
const SAFE_WRITE_A_PROJECT_ROOT_ENV = "OPENREAPER_SAFE_WRITE_A_PROJECT_ROOT";
const SAFE_WRITE_A_PROJECT_REF_ENV = "OPENREAPER_SAFE_WRITE_A_PROJECT_REF";
const SAFE_WRITE_A_ANCHOR_TRACK_REF_ENV = "OPENREAPER_SAFE_WRITE_A_ANCHOR_TRACK_REF";
const SAFE_WRITE_A_ITEM_REF_ENV = "OPENREAPER_SAFE_WRITE_A_ITEM_REF";
const SAFE_WRITE_A_MIDI_TRACK_REF_ENV = "OPENREAPER_SAFE_WRITE_A_MIDI_TRACK_REF";
const READ_B_ACTION_SECTION_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_SECTION";
const READ_B_ACTION_COMMAND_ID_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_COMMAND_ID";
const READ_B_ACTION_TOGGLE_COMMAND_ID_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_TOGGLE_COMMAND_ID";
const READ_B_NAMED_COMMAND_ENV = "OPENREAPER_LIVE_SMOKE_NAMED_COMMAND";
const READ_B_ACTION_SEARCH_QUERY_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_SEARCH_QUERY";
const READ_B_ACTION_SEARCH_LIMIT_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_SEARCH_LIMIT";
const READ_B_ACTION_SEARCH_DEFAULT_LIMIT = 6;
const READ_B_ACTION_SEARCH_MAX_LIMIT = 6;
const READ_B_MARKER_ACTION_TEXT_ENV = "OPENREAPER_LIVE_SMOKE_MARKER_ACTION_TEXT";
const READ_B_MIDI_TAKE_REF_ENV = "OPENREAPER_LIVE_SMOKE_MIDI_TAKE_REF";
const READ_B_AUDIO_TAKE_REF_ENV = "OPENREAPER_LIVE_SMOKE_AUDIO_TAKE_REF";
const READ_B_MEDIA_PATH_ENV = "OPENREAPER_LIVE_SMOKE_MEDIA_PATH";
const E3_MEDIA_ROUTE_OPT_IN_ENV = "OPENREAPER_E3_MEDIA_ROUTE_LIVE_SMOKE";
const E2_FX_L1_READ_ROUTE_OPT_IN_ENV = "OPENREAPER_E2_FX_L1_READ_LIVE_SMOKE";
const E2_FX_B1_ROUTE_OPT_IN_ENV = "OPENREAPER_E2_FX_B1_LIVE_SMOKE";
const E2_FX_B1_TRACK_REF_ENV = "OPENREAPER_E2_FX_TRACK_REF";
const E2_FX_B1_TAKE_REF_ENV = "OPENREAPER_E2_FX_TAKE_REF";
const E2_FX_B1_FX_REF_ENV = "OPENREAPER_E2_FX_REF";
const E2_FX_B1_PLUGIN_NAME_ENV = "OPENREAPER_E2_FX_PLUGIN_NAME";
const E2_FX_B1_SECOND_PLUGIN_NAME_ENV = "OPENREAPER_E2_FX_SECOND_PLUGIN_NAME";
const E2_FX_B1_PARAM_INDEX_ENV = "OPENREAPER_E2_FX_PARAM_INDEX";
const E2_FX_B1_PARAM_VALUE_ENV = "OPENREAPER_E2_FX_PARAM_VALUE";
const E2_FX_B1_PRESET_NAME_ENV = "OPENREAPER_E2_FX_PRESET_NAME";
const E2_FX_B1_PRESET_INDEX_ENV = "OPENREAPER_E2_FX_PRESET_INDEX";
const E2_FX_B1_VIDEO_FX_REF_ENV = "OPENREAPER_E2_FX_VIDEO_REF";
const E2_FX_B1_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const E5_R1_ROUTING_READ_OPT_IN_ENV = "OPENREAPER_E5_R1_ROUTING_READ_LIVE_SMOKE";
const E5_ROUTING_AUTOMATION_OPT_IN_ENV = "OPENREAPER_E5_ROUTING_AUTOMATION_LIVE_SMOKE";
const E5_TRACK_REF_ENV = "OPENREAPER_E5_TRACK_REF";
const E5_DESTINATION_TRACK_REF_ENV = "OPENREAPER_E5_DESTINATION_TRACK_REF";
const E5_SEND_REF_ENV = "OPENREAPER_E5_SEND_REF";
const E5_FX_REF_ENV = "OPENREAPER_E5_FX_REF";
const E5_ENVELOPE_REF_ENV = "OPENREAPER_E5_ENVELOPE_REF";
const E5_TAKE_REF_ENV = "OPENREAPER_E5_TAKE_REF";
const E5_SEND_VOLUME_ENV = "OPENREAPER_E5_SEND_VOLUME";
const E5_SEND_PAN_ENV = "OPENREAPER_E5_SEND_PAN";
const E5_POINT_VALUE_ENV = "OPENREAPER_E5_POINT_VALUE";
const D6_PROJECT_TEMPO_OPT_IN_ENV = "OPENREAPER_D6_PROJECT_TEMPO_LIVE_SMOKE";
const D6_PROJECT_TEMPO_BPM_ENV = "OPENREAPER_D6_PROJECT_TEMPO_BPM";
const D6_PROJECT_BPM_ALIAS_ENV = "OPENREAPER_D6_PROJECT_BPM_ALIAS";
const D6_PROJECT_TEMPO_MARKER_BPM_ENV = "OPENREAPER_D6_PROJECT_TEMPO_MARKER_BPM";
const D6_PROJECT_TEMPO_MARKER_POSITION_ENV = "OPENREAPER_D6_PROJECT_TEMPO_MARKER_POSITION";
const E3_MEDIA_FOLDER_ROOT_ENV = "OPENREAPER_E3_MEDIA_FOLDER_ROOT";
const E3_MEDIA_SOURCE_PATH_ENV = "OPENREAPER_E3_MEDIA_SOURCE_PATH";
const E3_MEDIA_RELINK_PATH_ENV = "OPENREAPER_E3_MEDIA_RELINK_PATH";
const E3_MEDIA_TARGET_TRACK_REF_ENV = "OPENREAPER_E3_MEDIA_TARGET_TRACK_REF";
const E3_MEDIA_TAKE_REF_ENV = "OPENREAPER_E3_MEDIA_TAKE_REF";
const E4_ITEM_ROUTE_OPT_IN_ENV = "OPENREAPER_E4_ITEM_ROUTE_LIVE_SMOKE";
const E4_ITEM_REF_ENV = "OPENREAPER_E4_ITEM_REF";
const E4_TARGET_TRACK_REF_ENV = "OPENREAPER_E4_TARGET_TRACK_REF";
const E4_ITEM_START_SECONDS_ENV = "OPENREAPER_E4_ITEM_START_SECONDS";
const E4_ITEM_LENGTH_SECONDS_ENV = "OPENREAPER_E4_ITEM_LENGTH_SECONDS";
const E4_SPLIT_POSITION_SECONDS_ENV = "OPENREAPER_E4_SPLIT_POSITION_SECONDS";
const E4_PLAYRATE_ENV = "OPENREAPER_E4_PLAYRATE";

const READ_B_OPERATIONS = Object.freeze([
  "query_state:actions.resolve_named_command",
  "query_state:actions.read_action_metadata",
  "query_state:actions.read_action_toggle_state",
  "query_state:actions.read_action_shortcuts",
  "query_state:actions.parse_marker_action_text",
  "query_state:actions.search_action_commands",
  "query_state:midi.resolve_midi_take_ref",
  "query_state:midi.read_take_event_counts",
  "query_state:midi.list_take_notes",
  "query_state:midi.list_take_cc_events",
  "query_state:midi.list_take_text_sysex_events",
  "query_state:midi.read_take_grid",
  "query_state:media.file.probe",
  "query_state:media.take_source.read",
  "query_state:media.project_files.read",
]);

const E3_MEDIA_ROUTE_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.media.list_folder_media_files",
    operation: "query_state:media.folder_media.list",
    pack: "media",
    risk: "read",
    capability: "media.folder_media.list",
    ref_group: "none",
  }),
  Object.freeze({
    id: "template.media.import_file_to_track",
    operation: "run_command:template.execute",
    pack: "media",
    risk: "write",
    capability: "media.import_file_to_track",
    ref_group: "source_track",
  }),
  Object.freeze({
    id: "template.media.import_file_section_to_track",
    operation: "run_command:template.execute",
    pack: "media",
    risk: "write",
    capability: "media.import_file_section_to_track",
    ref_group: "source_track",
  }),
  Object.freeze({
    id: "template.media.relink_take_source",
    operation: "run_command:template.execute",
    pack: "media",
    risk: "write",
    capability: "media.relink_take_source",
    ref_group: "take_relink",
  }),
]);

const E3_MEDIA_ROUTE_SPEC_BY_ID = new Map(E3_MEDIA_ROUTE_TEMPLATE_SPECS.map((spec) => [spec.id, spec]));
const E3_MEDIA_ROUTE_SPEC_BY_CAPABILITY = new Map(
  E3_MEDIA_ROUTE_TEMPLATE_SPECS
    .filter((spec) => spec.operation === "run_command:template.execute")
    .map((spec) => [spec.capability, spec]),
);

const E4_ITEM_ROUTE_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.items.copy_item_to_track",
    operation: "run_command:template.execute",
    pack: "items",
    risk: "write",
    capability: "item.copy_to_track",
    ref_group: "source_target",
    idempotent: false,
  }),
  Object.freeze({
    id: "template.items.split_item_at_time",
    operation: "run_command:template.execute",
    pack: "items",
    risk: "write",
    capability: "items.split_item_at_time",
    ref_group: "source_item",
    idempotent: false,
  }),
  Object.freeze({
    id: "template.items.set_take_playrate",
    operation: "run_command:template.execute",
    pack: "items",
    risk: "write",
    capability: "items.set_take_playrate",
    ref_group: "source_item",
    idempotent: true,
  }),
]);

const E4_ITEM_ROUTE_SPEC_BY_CAPABILITY = new Map(
  E4_ITEM_ROUTE_TEMPLATE_SPECS.map((spec) => [spec.capability, spec]),
);

const E2_FX_B1_ROUTE_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.fx.resolve_fx_ref",
    operation: "query_state:fx.resolve_ref",
    pack: "fx",
    risk: "read",
    capability: "fx.resolve_ref",
    ref_group: "track_or_take",
    phase: "primary_read",
  }),
  Object.freeze({
    id: "template.fx.list_track_fx_chain",
    operation: "query_state:fx.list_track_chain",
    pack: "fx",
    risk: "read",
    capability: "fx.list_track_chain",
    ref_group: "track",
    phase: "primary_read",
  }),
  Object.freeze({
    id: "template.fx.list_take_fx_chain",
    operation: "query_state:fx.list_take_chain",
    pack: "fx",
    risk: "read",
    capability: "fx.list_take_chain",
    ref_group: "take",
    phase: "primary_read",
  }),
  Object.freeze({
    id: "template.fx.read_fx_summary",
    operation: "query_state:fx.read_summary",
    pack: "fx",
    risk: "read",
    capability: "fx.read_summary",
    ref_group: "fx",
    phase: "primary_read",
  }),
  Object.freeze({
    id: "template.fx.list_fx_parameters",
    operation: "query_state:fx.list_parameters",
    pack: "fx",
    risk: "read",
    capability: "fx.list_parameters",
    ref_group: "fx",
    phase: "primary_read",
  }),
  Object.freeze({
    id: "template.fx.read_fx_parameter",
    operation: "query_state:fx.read_parameter",
    pack: "fx",
    risk: "read",
    capability: "fx.read_parameter",
    ref_group: "fx",
    phase: "primary_read",
  }),
  Object.freeze({
    id: "template.fx.parameter_to_envelope_mapping",
    operation: "query_state:fx.parameter_to_envelope_mapping",
    pack: "fx",
    risk: "read",
    capability: "fx.parameter_to_envelope_mapping",
    ref_group: "fx",
    phase: "primary_read",
  }),
  Object.freeze({
    id: "template.fx.add_track_fx",
    operation: "run_command:template.execute",
    pack: "fx",
    risk: "write",
    capability: "fx.add_track",
    ref_group: "track_plugin",
    phase: "primary_write",
    idempotent: false,
  }),
  Object.freeze({
    id: "template.fx.add_take_fx",
    operation: "run_command:template.execute",
    pack: "fx",
    risk: "write",
    capability: "fx.add_take",
    ref_group: "take_plugin",
    phase: "primary_write",
    idempotent: false,
  }),
  Object.freeze({
    id: "template.fx.set_fx_bypass",
    operation: "run_command:template.execute",
    pack: "fx",
    risk: "write",
    capability: "fx.set_bypass",
    ref_group: "fx",
    phase: "primary_write",
    idempotent: true,
  }),
  Object.freeze({
    id: "template.fx.set_fx_parameter_normalized",
    operation: "run_command:template.execute",
    pack: "fx",
    risk: "write",
    capability: "fx.set_parameter_normalized",
    ref_group: "fx",
    phase: "primary_write",
    idempotent: true,
  }),
  Object.freeze({
    id: "template.fx.set_fx_preset_by_name",
    operation: "run_command:template.execute",
    pack: "fx",
    risk: "write",
    capability: "fx.set_preset_by_name",
    ref_group: "fx_preset_name",
    phase: "conditional_preset",
    idempotent: true,
  }),
  Object.freeze({
    id: "template.fx.set_fx_preset_by_index",
    operation: "run_command:template.execute",
    pack: "fx",
    risk: "write",
    capability: "fx.set_preset_by_index",
    ref_group: "fx_preset_index",
    phase: "conditional_preset",
    idempotent: true,
  }),
  Object.freeze({
    id: "template.fx.reorder_fx",
    operation: "run_command:template.execute",
    pack: "fx",
    risk: "write",
    capability: "fx.reorder",
    ref_group: "fx_second_plugin",
    phase: "primary_write",
    idempotent: true,
  }),
  Object.freeze({
    id: "template.fx.read_video_processor_code",
    operation: "query_state:fx.read_video_processor_code",
    pack: "fx",
    risk: "read",
    capability: "fx.read_video_processor_code",
    ref_group: "video_fx",
    phase: "conditional_video",
    artifact: true,
  }),
]);

const E2_FX_B1_ROUTE_SPEC_BY_OPERATION = new Map(
  E2_FX_B1_ROUTE_TEMPLATE_SPECS
    .filter((spec) => spec.operation !== "run_command:template.execute")
    .map((spec) => [spec.operation, spec]),
);
const E2_FX_B1_ROUTE_SPEC_BY_CAPABILITY = new Map(
  E2_FX_B1_ROUTE_TEMPLATE_SPECS
    .filter((spec) => spec.operation === "run_command:template.execute")
    .map((spec) => [spec.capability, spec]),
);
const E2_FX_L1_READ_TEMPLATE_SPECS = Object.freeze(
  E2_FX_B1_ROUTE_TEMPLATE_SPECS.filter((spec) => CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS.includes(spec.id)),
);
const E2_FX_L1_READ_SPEC_BY_OPERATION = new Map(
  E2_FX_L1_READ_TEMPLATE_SPECS.map((spec) => [spec.operation, spec]),
);

const E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS = Object.freeze([
  routeSpec("template.routing.read_track_routing", "query_state:routing.track.read", "routing", "read", "routing.track.read", "track", "routing_read"),
  routeSpec("template.routing.resolve_send_ref", "query_state:routing.send.resolve_ref", "routing", "read", "routing.send.resolve_ref", "send_locator", "routing_read"),
  routeSpec("template.routing.create_track_send", "run_command:template.execute", "routing", "write", "routing.send.create", "track_pair", "routing_write"),
  routeSpec("template.routing.set_send_volume", "run_command:template.execute", "routing", "write", "routing.send.set_volume", "send", "routing_write", true),
  routeSpec("template.routing.set_send_pan", "run_command:template.execute", "routing", "write", "routing.send.set_pan", "send", "routing_write", true),
  routeSpec("template.routing.set_send_mute", "run_command:template.execute", "routing", "write", "routing.send.set_mute", "send", "routing_write", true),
  routeSpec("template.routing.set_send_mode", "run_command:template.execute", "routing", "write", "routing.send.set_mode", "send", "routing_write", true),
  routeSpec("template.routing.set_master_parent_send", "run_command:template.execute", "routing", "write", "routing.master_parent.set", "track", "routing_write", true),
  routeSpec("template.routing.set_track_channel_count", "run_command:template.execute", "routing", "write", "routing.track_channels.set", "track", "routing_write", true),
  routeSpec("template.routing.list_track_hardware_outputs", "query_state:routing.track_hardware_outputs.list", "routing", "read", "routing.track_hardware_outputs.list", "track", "routing_read"),
  routeSpec("template.routing.set_track_hardware_output", "run_command:template.execute", "routing", "write", "routing.track_hardware_output.set", "track", "routing_write", true),
  routeSpec("template.routing.remove_track_hardware_output", "run_command:template.execute", "routing", "write", "routing.track_hardware_output.remove", "track", "routing_write", true),
  routeSpec("template.routing.read_project_routing_graph", "query_state:routing.project_graph.read", "routing", "read", "routing.project_graph.read", "none", "routing_read"),
  routeSpec("template.routing.list_available_audio_outputs", "query_state:routing.audio_outputs.list", "routing", "read", "routing.audio_outputs.list", "none", "routing_read"),
  routeSpec("template.routing.set_send_audio_channels", "run_command:template.execute", "routing", "write", "routing.send.audio_channels.set", "send", "routing_write", true),
  routeSpec("template.routing.set_send_phase", "run_command:template.execute", "routing", "write", "routing.send.set_phase", "send", "routing_write", true),
  routeSpec("template.routing.set_send_mono", "run_command:template.execute", "routing", "write", "routing.send.set_mono", "send", "routing_write", true),
  routeSpec("template.routing.set_send_midi_channels", "run_command:template.execute", "routing", "write", "routing.send.midi_channels.set", "send", "routing_write", true),
  routeSpec("template.routing.read_fx_pin_mapping", "query_state:routing.fx_pin_mapping.read", "routing", "read", "routing.fx_pin_mapping.read", "track_fx", "routing_read"),
  routeSpec("template.automation.resolve_envelope_ref", "query_state:automation.resolve_envelope_ref", "automation", "read", "automation.resolve_envelope_ref", "automation_parent", "automation_read"),
  routeSpec("template.automation.list_project_envelopes", "query_state:automation.project_envelopes.list", "automation", "read", "automation.project_envelopes.list", "none", "automation_read"),
  routeSpec("template.automation.read_envelope_summary", "query_state:automation.read_envelope_summary", "automation", "read", "automation.read_envelope_summary", "envelope", "automation_read"),
  routeSpec("template.automation.read_envelope_points", "query_state:automation.read_envelope_points", "automation", "read", "automation.read_envelope_points", "envelope", "automation_read"),
  routeSpec("template.automation.evaluate_envelope_at_time", "query_state:automation.evaluate_envelope_at_time", "automation", "read", "automation.evaluate_envelope_at_time", "envelope", "automation_read"),
  routeSpec("template.automation.set_envelope_lane_state", "run_command:template.execute", "automation", "write", "automation.set_envelope_lane_state", "envelope", "automation_write", true),
  routeSpec("template.automation.insert_envelope_point", "run_command:template.execute", "automation", "write", "automation.insert_envelope_point", "envelope", "automation_write"),
  routeSpec("template.automation.set_track_automation_mode", "run_command:template.execute", "automation", "write", "automation.set_track_automation_mode", "track", "automation_write", true),
  routeSpec("template.automation.read_track_automation_mode", "query_state:automation.read_track_automation_mode", "automation", "read", "automation.read_track_automation_mode", "track", "automation_read"),
  routeSpec("template.automation.read_automation_items", "query_state:automation.read_automation_items", "automation", "read", "automation.read_automation_items", "envelope", "automation_read"),
  routeSpec("template.automation.set_envelope_point", "run_command:template.execute", "automation", "write", "automation.set_envelope_point", "envelope", "automation_write", true),
  routeSpec("template.automation.insert_envelope_points_batch", "run_command:template.execute", "automation", "write", "automation.insert_envelope_points_batch", "envelope", "automation_write"),
  routeSpec("template.automation.delete_envelope_points", "run_command:template.execute", "automation", "destructive", "automation.delete_envelope_points", "envelope", "automation_write"),
  routeSpec("template.automation.set_send_automation_mode", "run_command:template.execute", "automation", "write", "automation.set_send_automation_mode", "send", "automation_write", true),
  routeSpec("template.automation.create_automation_item", "run_command:template.execute", "automation", "write", "automation.create_automation_item", "envelope", "automation_write"),
  routeSpec("template.automation.set_automation_item_bounds", "run_command:template.execute", "automation", "write", "automation.set_automation_item_bounds", "envelope", "automation_write", true),
  routeSpec("template.automation.resolve_send_envelope", "query_state:automation.resolve_send_envelope", "automation", "read", "automation.resolve_send_envelope", "send", "automation_read"),
  routeSpec("template.automation.insert_fx_parameter_envelope_points", "run_command:template.execute", "automation", "write", "automation.insert_fx_parameter_envelope_points", "fx_envelope", "automation_write"),
  routeSpec("template.automation.insert_sine_wave_points", "run_command:template.execute", "automation", "write", "automation.insert_sine_wave_points", "envelope", "automation_write"),
]);

const E5_R1_ROUTING_READ_TEMPLATE_SPECS = Object.freeze(
  E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS.filter((spec) =>
    CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS.includes(spec.id),
  ),
);

const E5_ROUTING_AUTOMATION_ROUTE_SPEC_BY_OPERATION = new Map(
  E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS
    .filter((spec) => spec.operation !== "run_command:template.execute")
    .map((spec) => [spec.operation, spec]),
);
const E5_ROUTING_AUTOMATION_ROUTE_SPEC_BY_CAPABILITY = new Map(
  E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS
    .filter((spec) => spec.operation === "run_command:template.execute")
    .map((spec) => [spec.capability, spec]),
);

const D6_PROJECT_TEMPO_TEMPLATE_SPECS = Object.freeze([
  routeSpec("template.project.set_tempo", "run_command:template.execute", "project", "write", "project.set_tempo", "none", "tempo_write", true),
  routeSpec("template.project.set_bpm", "run_command:template.execute", "project", "write", "project.set_bpm", "none", "tempo_write", true),
  routeSpec("template.project.set_tempo_marker", "run_command:template.execute", "project", "write", "project.set_tempo_marker", "none", "tempo_marker_write", true),
  routeSpec("template.project.set_grid", "run_command:template.execute", "project", "write", "project.set_grid", "none", "grid_write", true),
]);

const D6_PROJECT_TEMPO_SPEC_BY_CAPABILITY = new Map(
  D6_PROJECT_TEMPO_TEMPLATE_SPECS.map((spec) => [spec.capability, spec]),
);

function routeSpec(id, operation, pack, risk, capability, refGroup, phase, idempotent = false) {
  return Object.freeze({ id, operation, pack, risk, capability, ref_group: refGroup, phase, idempotent });
}
const SUPPORTED_MEDIA_EXTENSIONS = Object.freeze([
  "wav",
  "wave",
  "aif",
  "aiff",
  "flac",
  "mp3",
  "ogg",
  "mid",
  "midi",
  "mov",
  "mp4",
]);
const MEDIA_EXTENSION_KINDS = Object.freeze({
  wav: "audio",
  wave: "audio",
  aif: "audio",
  aiff: "audio",
  flac: "audio",
  mp3: "audio",
  ogg: "audio",
  mid: "midi",
  midi: "midi",
  mov: "video",
  mp4: "video",
});

const FIRST_REAL_A1_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.analysis.detect_loop_candidates",
    operation: "run_job:analysis.detect_loop_candidates",
    owner_pack: "analysis",
    scope: "loop_candidates",
    schema: "analysis.loop_candidates.v1",
  }),
  Object.freeze({
    id: "template.analysis.measure_loop_click_risk",
    operation: "run_job:analysis.measure_loop_click_risk",
    owner_pack: "analysis",
    scope: "loop_click_risk",
    schema: "analysis.loop_click_risk.v1",
    consumes: Object.freeze(["analysis.loop_candidates.v1"]),
  }),
  Object.freeze({
    id: "template.analysis.create_loop_qa_report",
    operation: "run_job:analysis.create_loop_qa_report",
    owner_pack: "analysis",
    scope: "loop_qa_report",
    schema: "analysis.loop_qa_report.v1",
    consumes: Object.freeze(["analysis.loop_candidates.v1", "analysis.loop_click_risk.v1"]),
  }),
  Object.freeze({
    id: "template.project.create_cleanup_report",
    operation: "run_job:project.create_cleanup_report",
    owner_pack: "project",
    scope: "cleanup_report",
    schema: "project.cleanup_report.v1",
  }),
  Object.freeze({
    id: "template.project.create_project_map_snapshot",
    operation: "run_job:project.create_project_map_snapshot",
    owner_pack: "project",
    scope: "project_map_snapshot",
    schema: "project.project_map_snapshot.v1",
  }),
  Object.freeze({
    id: "template.project.create_observation_bundle",
    operation: "run_job:project.create_observation_bundle",
    owner_pack: "project",
    scope: "observation_bundle",
    schema: "project.observation_bundle.v1",
  }),
]);

const FIRST_REAL_A1_SPEC_BY_ID = new Map(FIRST_REAL_A1_TEMPLATE_SPECS.map((spec) => [spec.id, spec]));
const FIRST_REAL_A1_SPEC_BY_OPERATION = new Map(FIRST_REAL_A1_TEMPLATE_SPECS.map((spec) => [spec.operation, spec]));

const FIRST_REAL_A2_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.render.render_region_wav",
    operation: "run_job:render.region_wav",
    owner_pack: "render",
    output_scope: "region_wav_output",
    output_schema: "render.region_wav_output.v1",
    evidence_scope: "render_job_evidence",
    evidence_schema: "render.render_job_evidence.v1",
  }),
  Object.freeze({
    id: "template.render.create_delivery_report",
    operation: "run_job:render.delivery_report.create",
    owner_pack: "render",
    scope: "delivery_report",
    schema: "render.delivery_report.v1",
    consumes: Object.freeze(["render.region_wav_output.v1", "render.render_job_evidence.v1"]),
  }),
]);

const FIRST_REAL_A2_SPEC_BY_OPERATION = new Map(FIRST_REAL_A2_TEMPLATE_SPECS.map((spec) => [spec.operation, spec]));

const FIRST_REAL_A3_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    id: "template.items.create_layer_report",
    operation: "run_job:items.create_layer_report",
    owner_pack: "items",
    input_scope: "layer_evidence",
    input_schema: "items.layer_evidence.v1",
    scope: "layer_report",
    schema: "items.layer_report.v1",
  }),
]);

const FIRST_REAL_A3_SPEC_BY_OPERATION = new Map(FIRST_REAL_A3_TEMPLATE_SPECS.map((spec) => [spec.operation, spec]));

const SAFE_WRITE_A_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({ id: "template.project.set_metadata_field", pack: "project", risk: "write", capability: "project.set_metadata_field", ref_group: "none", idempotent: true }),
  Object.freeze({ id: "template.project.create_marker", pack: "project", risk: "write", capability: "project.create_marker", ref_group: "none", idempotent: false }),
  Object.freeze({ id: "template.project.create_region", pack: "project", risk: "write", capability: "project.create_region", ref_group: "none", idempotent: false }),
  Object.freeze({ id: "template.tracks.create_track", pack: "tracks", risk: "write", capability: "track.create", ref_group: "none", idempotent: false }),
  Object.freeze({ id: "template.tracks.rename_track", pack: "tracks", risk: "write", capability: "track.rename", ref_group: "created_track", idempotent: true }),
  Object.freeze({ id: "template.tracks.set_color", pack: "tracks", risk: "write", capability: "track.set_color", ref_group: "created_track", idempotent: true }),
  Object.freeze({ id: "template.tracks.select_track", pack: "tracks", risk: "write", capability: "track.select", ref_group: "created_track", idempotent: true }),
  Object.freeze({ id: "template.tracks.set_mute", pack: "tracks", risk: "write", capability: "track.set_mute", ref_group: "created_track", idempotent: true }),
  Object.freeze({ id: "template.tracks.set_solo", pack: "tracks", risk: "write", capability: "track.set_solo", ref_group: "created_track", idempotent: true }),
  Object.freeze({ id: "template.transport.set_edit_cursor", pack: "transport", risk: "safe", capability: "transport.set_edit_cursor", ref_group: "none", idempotent: true }),
  Object.freeze({ id: "template.transport.set_time_selection", pack: "transport", risk: "safe", capability: "transport.set_time_selection", ref_group: "none", idempotent: true }),
  Object.freeze({ id: "template.transport.clear_time_selection", pack: "transport", risk: "safe", capability: "transport.clear_time_selection", ref_group: "none", idempotent: true }),
  Object.freeze({ id: "template.transport.set_loop_points", pack: "transport", risk: "safe", capability: "transport.set_loop_points", ref_group: "none", idempotent: true }),
  Object.freeze({ id: "template.transport.clear_loop_points", pack: "transport", risk: "safe", capability: "transport.clear_loop_points", ref_group: "none", idempotent: true }),
  Object.freeze({ id: "template.transport.set_repeat", pack: "transport", risk: "safe", capability: "transport.set_repeat", ref_group: "none", idempotent: true }),
  Object.freeze({ id: "template.items.move_item", pack: "items", risk: "write", capability: "items.move_item", ref_group: "anchor_item", idempotent: true }),
  Object.freeze({ id: "template.items.trim_item", pack: "items", risk: "write", capability: "items.trim_item", ref_group: "anchor_item", idempotent: true }),
  Object.freeze({ id: "template.items.set_item_fades", pack: "items", risk: "write", capability: "items.set_item_fades", ref_group: "anchor_item", idempotent: true }),
  Object.freeze({ id: "template.items.set_take_pitch", pack: "items", risk: "write", capability: "items.set_take_pitch", ref_group: "anchor_item", idempotent: true }),
  Object.freeze({ id: "template.items.set_item_snap_offset", pack: "items", risk: "write", capability: "items.set_item_snap_offset", ref_group: "anchor_item", idempotent: true }),
  Object.freeze({ id: "template.midi.create_midi_item", pack: "midi", risk: "write", capability: "midi.create_midi_item", ref_group: "midi_track", idempotent: false }),
  Object.freeze({ id: "template.midi.insert_notes_batch", pack: "midi", risk: "write", capability: "midi.insert_notes_batch", ref_group: "created_midi_take", idempotent: false }),
  Object.freeze({ id: "template.midi.insert_cc_batch", pack: "midi", risk: "write", capability: "midi.insert_cc_batch", ref_group: "created_midi_take", idempotent: false }),
  Object.freeze({ id: "template.midi.insert_text_sysex_events", pack: "midi", risk: "write", capability: "midi.insert_text_sysex_events", ref_group: "created_midi_take", idempotent: false }),
]);

const SAFE_WRITE_A_SPEC_BY_CAPABILITY = new Map(
  SAFE_WRITE_A_TEMPLATE_SPECS.map((spec) => [spec.capability, spec]),
);

const runtime = createCallTemplateRuntime();
const route = selectRoute(process.argv, process.env);
const optedIn = route.fake || process.env[route.optInEnv] === "1" || process.argv.includes(OPT_IN_FLAG);
const fixtureInputs = route.fixtureInputs(process.env);
const baseReport = {
  gate: "template-runtime-live",
  contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
  accepted_catalog: runtime.accepted_catalog,
  opt_in_env: route.optInEnv,
  opt_in_flag: OPT_IN_FLAG,
  route_flag: route.routeFlag,
  opted_in: optedIn,
  mode: route.fake ? "fake" : "live",
  spawned_reaper: false,
  wave: route.wave,
  batch: route.batch,
  allowed_template_ids: route.templateIds,
  allowed_bridge_operations: route.operations,
  allowed_capabilities: route.capabilities ?? [],
  fixture_inputs: fixtureInputs.report,
};

if (route.fake) {
  const blocker = route.name === "safe-write-a"
    ? null
    : route.name === "e2-fx-l1-read-route"
    ? null
    : route.name === "e2-fx-b1-route"
    ? null
    : route.name === "e5-r1-routing-read-route"
    ? null
    : route.name === "e5-routing-automation-route"
    ? null
    : route.name === "d6-project-tempo-route"
    ? null
    : route.name === "e3-media-route"
    ? null
    : route.name === "e4-item-route"
    ? null
    : route.name === "first-real-a3-layer-report"
    ? await firstRealA3FakeBlocker(fixtureInputs)
    : route.name === "first-real-a2-render"
    ? await firstRealA2RootBlocker(fixtureInputs)
    : await firstRealA1ArtifactRootBlocker(fixtureInputs.artifact_root);
  if (blocker) {
    console.log(JSON.stringify({
      ...baseReport,
      ok: false,
      skipped: false,
      ...blocker,
      live_pass_claimed: false,
    }));
    process.exit(2);
  }

  const fakeExecutor = {
    config: {
      contract: route.name === "safe-write-a"
        ? "safe_write_a.fake_executor.v1"
        : route.name === "e2-fx-l1-read-route"
        ? "e2_fx_l1_read_route.fake_executor.v1"
        : route.name === "e2-fx-b1-route"
        ? "e2_fx_b1_route.fake_executor.v1"
        : route.name === "e5-r1-routing-read-route"
        ? "e5_r1_routing_read_route.fake_executor.v1"
        : route.name === "e5-routing-automation-route"
        ? "e5_routing_automation_route.fake_executor.v1"
        : route.name === "d6-project-tempo-route"
        ? "d6_project_tempo_route.fake_executor.v1"
        : route.name === "e3-media-route"
        ? "e3_media_route.fake_executor.v1"
        : route.name === "e4-item-route"
        ? "e4_item_route.fake_executor.v1"
        : route.name === "first-real-a3-layer-report"
        ? "first_real_fixture_a3.fake_executor.v1"
        : route.name === "first-real-a2-render"
        ? "first_real_fixture_a2.fake_executor.v1"
        : "first_real_fixture_a1.fake_executor.v1",
      kind: "fake_artifact_writer",
      spawned_reaper: false,
    },
    async dispatch(request) {
      if (route.name === "safe-write-a") {
        return dispatchFakeSafeWriteA(request);
      }
      if (route.name === "e2-fx-b1-route") {
        return dispatchFakeE2FxB1Route(request);
      }
      if (route.name === "e2-fx-l1-read-route") {
        return dispatchFakeE2FxL1ReadRoute(request);
      }
      if (route.name === "e5-r1-routing-read-route") {
        return dispatchFakeE5RoutingReadRoute(request);
      }
      if (route.name === "e5-routing-automation-route") {
        return dispatchFakeE5RoutingAutomationRoute(request);
      }
      if (route.name === "d6-project-tempo-route") {
        return dispatchFakeD6ProjectTempoRoute(request);
      }
      if (route.name === "e3-media-route") {
        return dispatchFakeE3MediaRoute(request);
      }
      if (route.name === "e4-item-route") {
        return dispatchFakeE4ItemRoute(request);
      }
      if (route.name === "first-real-a3-layer-report") {
        return dispatchFakeFirstRealA3(request, {
          artifactRoot: fixtureInputs.artifact_root,
        });
      }
      if (route.name === "first-real-a2-render") {
        return dispatchFakeFirstRealA2(request, {
          artifactRoot: fixtureInputs.artifact_root,
          renderRoot: fixtureInputs.render_root,
        });
      }
      return dispatchFakeFirstRealA1(request, { artifactRoot: fixtureInputs.artifact_root });
    },
  };
  const fakeRuntime = createLiveRuntimeForRoute(route, fakeExecutor, fakeExecutor.config);
  const contextBase = liveContextBase();
  const fakeReport = route.name === "safe-write-a"
    ? await runSafeWriteASmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "e2-fx-l1-read-route"
    ? await runE2FxL1ReadRouteSmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "e2-fx-b1-route"
    ? await runE2FxB1RouteSmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "e5-r1-routing-read-route"
    ? await runE5RoutingReadRouteSmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "e5-routing-automation-route"
    ? await runE5RoutingAutomationRouteSmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "d6-project-tempo-route"
    ? await runD6ProjectTempoRouteSmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "e3-media-route"
    ? await runE3MediaRouteSmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "e4-item-route"
    ? await runE4ItemRouteSmoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
      })
    : route.name === "first-real-a3-layer-report"
    ? await runFirstRealA3Smoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
        artifactRoot: fixtureInputs.artifact_root,
      })
    : route.name === "first-real-a2-render"
    ? await runFirstRealA2Smoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
        artifactRoot: fixtureInputs.artifact_root,
        renderRoot: fixtureInputs.render_root,
      })
    : await runFirstRealA1Smoke({
        liveRuntime: fakeRuntime,
        fixtureInputs,
        contextBase,
        artifactRoot: fixtureInputs.artifact_root,
      });
  console.log(JSON.stringify({
    ...baseReport,
    ...fakeReport,
    skipped: false,
    live_executor: fakeExecutor.config,
    context: contextSummary(contextBase),
    evidence: ["safe-write-a", "e2-fx-l1-read-route", "e2-fx-b1-route", "e5-r1-routing-read-route", "e5-routing-automation-route", "d6-project-tempo-route", "e3-media-route", "e4-item-route"].includes(route.name) ? compactRuntimeEvidence(fakeRuntime.evidence()) : fakeRuntime.evidence(),
    live_pass_claimed: false,
  }));
  process.exit(fakeReport.ok ? 0 : 2);
}

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
    blocker: executorConfig.reason,
    live_executor_env: LIVE_BRIDGE_EXECUTOR_ENV,
    message: "Opt-in live smoke entered the gate, but no explicit live bridge executor transport was configured.",
    live_pass_claimed: false,
  }));
  process.exit(2);
}

if (route.configuredBlocker) {
  const blocker = await route.configuredBlocker({
    fixtureInputs,
    executorConfig,
  });
  if (blocker) {
    console.log(JSON.stringify({
      ...baseReport,
      ok: false,
      skipped: false,
      ...blocker,
      live_executor: executorConfig.config,
      live_pass_claimed: false,
    }));
    process.exit(2);
  }
}

const liveRuntime = createLiveRuntimeForRoute(route, executorConfig.executor, executorConfig.config);
const contextBase = liveContextBase();
const routeReport = route.name === "first-real-a2-render"
  ? await runFirstRealA2Smoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      artifactRoot: fixtureInputs.artifact_root,
      renderRoot: fixtureInputs.render_root,
    })
  : route.name === "first-real-a3-layer-report"
  ? await runFirstRealA3Smoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      artifactRoot: fixtureInputs.artifact_root,
    })
  : route.name === "safe-write-a"
  ? await runSafeWriteASmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "e2-fx-l1-read-route"
  ? await runE2FxL1ReadRouteSmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "e2-fx-b1-route"
  ? await runE2FxB1RouteSmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "e5-r1-routing-read-route"
  ? await runE5RoutingReadRouteSmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "e5-routing-automation-route"
  ? await runE5RoutingAutomationRouteSmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "d6-project-tempo-route"
  ? await runD6ProjectTempoRouteSmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "e3-media-route"
  ? await runE3MediaRouteSmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "e4-item-route"
  ? await runE4ItemRouteSmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
    })
  : route.name === "first-real-a1"
  ? await runFirstRealA1Smoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      artifactRoot: fixtureInputs.artifact_root,
    })
  : await runReadOnlySmoke({
      liveRuntime,
      fixtureInputs,
      contextBase,
      route,
    });

console.log(JSON.stringify({
  ...baseReport,
  ...routeReport,
  skipped: false,
  live_executor: executorConfig.config,
  context: contextSummary(contextBase),
  evidence: ["safe-write-a", "e2-fx-l1-read-route", "e2-fx-b1-route", "e5-r1-routing-read-route", "e5-routing-automation-route", "d6-project-tempo-route"].includes(route.name) ? compactRuntimeEvidence(liveRuntime.evidence()) : liveRuntime.evidence(),
  live_pass_claimed: false,
}));
process.exit(routeReport.ok ? 0 : 2);

function selectRoute(argv, env) {
  const phaseIndex = argv.indexOf(PHASE_FLAG);
  const selectedPhase = phaseIndex >= 0 ? argv[phaseIndex + 1] : null;
  const firstRealA2Selected =
    argv.includes(FIRST_REAL_A2_FLAG) ||
    selectedPhase === FIRST_REAL_A2_PHASE ||
    env[FIRST_REAL_A2_OPT_IN_ENV] === "1";
  if (firstRealA2Selected) {
    return {
      name: "first-real-a2-render",
      wave: FIRST_REAL_A2_BATCH,
      batch: FIRST_REAL_A2_BATCH,
      routeFlag: selectedPhase === FIRST_REAL_A2_PHASE ? `${PHASE_FLAG} ${FIRST_REAL_A2_PHASE}` : FIRST_REAL_A2_FLAG,
      optInEnv: FIRST_REAL_A2_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
      operations: FIRST_REAL_A2_TEMPLATE_SPECS.map((spec) => spec.operation),
      fixtureInputs: firstRealA2FixtureInputs,
      configuredBlocker: firstRealA2ConfiguredBlocker,
      passReason: "first_real_fixture_a2_render_delivery_readback_passed",
      failReason: "first_real_fixture_a2_render_delivery_readback_failed",
    };
  }

  const firstRealA3Selected =
    argv.includes(FIRST_REAL_A3_FLAG) ||
    selectedPhase === FIRST_REAL_A3_PHASE ||
    env[FIRST_REAL_A3_OPT_IN_ENV] === "1";
  if (firstRealA3Selected) {
    return {
      name: "first-real-a3-layer-report",
      wave: FIRST_REAL_A3_BATCH,
      batch: FIRST_REAL_A3_BATCH,
      routeFlag: selectedPhase === FIRST_REAL_A3_PHASE ? `${PHASE_FLAG} ${FIRST_REAL_A3_PHASE}` : FIRST_REAL_A3_FLAG,
      optInEnv: FIRST_REAL_A3_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
      operations: FIRST_REAL_A3_TEMPLATE_SPECS.map((spec) => spec.operation),
      fixtureInputs: firstRealA3FixtureInputs,
      configuredBlocker: firstRealA3ConfiguredBlocker,
      passReason: "first_real_fixture_a3_layer_report_readback_passed",
      failReason: "first_real_fixture_a3_layer_report_readback_failed",
    };
  }

  const firstRealA1Selected = argv.includes(FIRST_REAL_A1_FLAG) || env[FIRST_REAL_A1_OPT_IN_ENV] === "1";
  if (firstRealA1Selected) {
    return {
      name: "first-real-a1",
      wave: FIRST_REAL_A1_BATCH,
      batch: FIRST_REAL_A1_BATCH,
      routeFlag: FIRST_REAL_A1_FLAG,
      optInEnv: FIRST_REAL_A1_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
      operations: FIRST_REAL_A1_TEMPLATE_SPECS.map((spec) => spec.operation),
      fixtureInputs: firstRealA1FixtureInputs,
      configuredBlocker: firstRealA1ConfiguredBlocker,
      passReason: "first_real_fixture_a1_live_readback_passed",
      failReason: "first_real_fixture_a1_live_readback_failed",
    };
  }

  const safeWriteASelected = argv.includes(SAFE_WRITE_A_FLAG) || env[SAFE_WRITE_A_OPT_IN_ENV] === "1";
  if (safeWriteASelected) {
    return {
      name: "safe-write-a",
      wave: SAFE_WRITE_A_BATCH,
      batch: SAFE_WRITE_A_BATCH,
      routeFlag: SAFE_WRITE_A_FLAG,
      optInEnv: SAFE_WRITE_A_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
      operations: ["run_command:template.execute"],
      capabilities: SAFE_WRITE_A_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: safeWriteAFixtureInputs,
      configuredBlocker: safeWriteAConfiguredBlocker,
      passReason: "safe_write_a_fake_static_readback_passed",
      failReason: "safe_write_a_fake_static_readback_failed",
    };
  }

  const e3MediaRouteSelected = argv.includes(E3_MEDIA_ROUTE_FLAG) || env[E3_MEDIA_ROUTE_OPT_IN_ENV] === "1";
  const e2FxL1ReadRouteSelected =
    argv.includes(E2_FX_L1_READ_ROUTE_FLAG) || env[E2_FX_L1_READ_ROUTE_OPT_IN_ENV] === "1";
  const e2FxB1RouteSelected = argv.includes(E2_FX_B1_ROUTE_FLAG) || env[E2_FX_B1_ROUTE_OPT_IN_ENV] === "1";
  const e5R1RoutingReadRouteSelected =
    argv.includes(E5_R1_ROUTING_READ_ROUTE_FLAG) || env[E5_R1_ROUTING_READ_OPT_IN_ENV] === "1";
  const e5RoutingAutomationRouteSelected =
    argv.includes(E5_ROUTING_AUTOMATION_ROUTE_FLAG) || env[E5_ROUTING_AUTOMATION_OPT_IN_ENV] === "1";
  const d6ProjectTempoRouteSelected =
    argv.includes(D6_PROJECT_TEMPO_ROUTE_FLAG) || env[D6_PROJECT_TEMPO_OPT_IN_ENV] === "1";
  if (e2FxL1ReadRouteSelected) {
    return {
      name: "e2-fx-l1-read-route",
      wave: E2_FX_L1_READ_ROUTE_BATCH,
      batch: E2_FX_L1_READ_ROUTE_BATCH,
      routeFlag: E2_FX_L1_READ_ROUTE_FLAG,
      optInEnv: E2_FX_L1_READ_ROUTE_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
      operations: E2_FX_L1_READ_TEMPLATE_SPECS.map((spec) => spec.operation),
      capabilities: E2_FX_L1_READ_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: e2FxB1RouteFixtureInputs,
      configuredBlocker: e2FxL1ReadRouteConfiguredBlocker,
      passReason: "e2_fx_l1_read_fake_static_readback_passed",
      failReason: "e2_fx_l1_read_fake_static_readback_failed",
    };
  }

  if (e2FxB1RouteSelected) {
    return {
      name: "e2-fx-b1-route",
      wave: E2_FX_B1_ROUTE_BATCH,
      batch: E2_FX_B1_ROUTE_BATCH,
      routeFlag: E2_FX_B1_ROUTE_FLAG,
      optInEnv: E2_FX_B1_ROUTE_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
      operations: [
        "query_state:fx.resolve_ref",
        "query_state:fx.list_track_chain",
        "query_state:fx.list_take_chain",
        "query_state:fx.read_summary",
        "query_state:fx.list_parameters",
        "query_state:fx.read_parameter",
        "query_state:fx.parameter_to_envelope_mapping",
        "query_state:fx.read_video_processor_code",
        "run_command:template.execute",
      ],
      capabilities: E2_FX_B1_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: e2FxB1RouteFixtureInputs,
      configuredBlocker: e2FxB1RouteConfiguredBlocker,
      passReason: "e2_fx_b1_route_fake_static_readback_passed",
      failReason: "e2_fx_b1_route_fake_static_readback_failed",
    };
  }

  if (e5R1RoutingReadRouteSelected) {
    return {
      name: "e5-r1-routing-read-route",
      wave: E5_R1_ROUTING_READ_ROUTE_BATCH,
      batch: E5_R1_ROUTING_READ_ROUTE_BATCH,
      routeFlag: E5_R1_ROUTING_READ_ROUTE_FLAG,
      optInEnv: E5_R1_ROUTING_READ_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
      operations: E5_R1_ROUTING_READ_TEMPLATE_SPECS.map((spec) => spec.operation),
      capabilities: E5_R1_ROUTING_READ_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: e5R1RoutingReadRouteFixtureInputs,
      configuredBlocker: e5R1RoutingReadRouteConfiguredBlocker,
      passReason: "e5_r1_routing_read_fake_static_readback_passed",
      failReason: "e5_r1_routing_read_fake_static_readback_failed",
    };
  }

  if (e5RoutingAutomationRouteSelected) {
    return {
      name: "e5-routing-automation-route",
      wave: E5_ROUTING_AUTOMATION_ROUTE_BATCH,
      batch: E5_ROUTING_AUTOMATION_ROUTE_BATCH,
      routeFlag: E5_ROUTING_AUTOMATION_ROUTE_FLAG,
      optInEnv: E5_ROUTING_AUTOMATION_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
      operations: [
        "query_state:routing.track.read",
        "query_state:routing.send.resolve_ref",
        "query_state:routing.project_graph.read",
        "query_state:routing.fx_pin_mapping.read",
        "query_state:automation.resolve_envelope_ref",
        "query_state:automation.project_envelopes.list",
        "query_state:automation.read_envelope_summary",
        "query_state:automation.read_envelope_points",
        "query_state:automation.evaluate_envelope_at_time",
        "query_state:automation.read_track_automation_mode",
        "query_state:automation.read_automation_items",
        "query_state:automation.resolve_send_envelope",
        "run_command:template.execute",
      ],
      capabilities: E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: e5RoutingAutomationRouteFixtureInputs,
      configuredBlocker: e5RoutingAutomationRouteConfiguredBlocker,
      passReason: "e5_routing_automation_route_fake_static_readback_passed",
      failReason: "e5_routing_automation_route_fake_static_readback_failed",
    };
  }

  if (d6ProjectTempoRouteSelected) {
    return {
      name: "d6-project-tempo-route",
      wave: D6_PROJECT_TEMPO_ROUTE_BATCH,
      batch: D6_PROJECT_TEMPO_ROUTE_BATCH,
      routeFlag: D6_PROJECT_TEMPO_ROUTE_FLAG,
      optInEnv: D6_PROJECT_TEMPO_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
      operations: ["run_command:template.execute"],
      capabilities: D6_PROJECT_TEMPO_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: d6ProjectTempoRouteFixtureInputs,
      configuredBlocker: null,
      passReason: "d6_project_tempo_route_fake_static_readback_passed",
      failReason: "d6_project_tempo_route_fake_static_readback_failed",
    };
  }

  if (e3MediaRouteSelected) {
    return {
      name: "e3-media-route",
      wave: E3_MEDIA_ROUTE_BATCH,
      batch: E3_MEDIA_ROUTE_BATCH,
      routeFlag: E3_MEDIA_ROUTE_FLAG,
      optInEnv: E3_MEDIA_ROUTE_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
      operations: [
        "query_state:media.folder_media.list",
        "run_command:template.execute",
      ],
      capabilities: E3_MEDIA_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: e3MediaRouteFixtureInputs,
      configuredBlocker: e3MediaRouteConfiguredBlocker,
      passReason: "e3_media_route_fake_static_readback_passed",
      failReason: "e3_media_route_fake_static_readback_failed",
    };
  }

  const e4ItemRouteSelected = argv.includes(E4_ITEM_ROUTE_FLAG) || env[E4_ITEM_ROUTE_OPT_IN_ENV] === "1";
  if (e4ItemRouteSelected) {
    return {
      name: "e4-item-route",
      wave: E4_ITEM_ROUTE_BATCH,
      batch: E4_ITEM_ROUTE_BATCH,
      routeFlag: E4_ITEM_ROUTE_FLAG,
      optInEnv: E4_ITEM_ROUTE_OPT_IN_ENV,
      fake: argv.includes(FAKE_FLAG),
      templateIds: CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
      operations: ["run_command:template.execute"],
      capabilities: E4_ITEM_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
      fixtureInputs: e4ItemRouteFixtureInputs,
      configuredBlocker: e4ItemRouteConfiguredBlocker,
      passReason: "e4_item_route_fake_static_readback_passed",
      failReason: "e4_item_route_fake_static_readback_failed",
    };
  }

  if (argv.includes(READ_B_FLAG)) {
    return {
      name: "read-b",
      wave: READ_B_BATCH,
      batch: READ_B_BATCH,
      routeFlag: READ_B_FLAG,
      optInEnv: WAVE1A_OPT_IN_ENV,
      fake: false,
      templateIds: CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
      operations: READ_B_OPERATIONS,
      fixtureInputs: readBFixtureInputs,
      configuredBlocker: readOnlyConfiguredBlocker,
      inputBuilder: readBInputs,
      refsBuilder: readBRefs,
      passReason: "read_b_live_handlers_passed",
      failReason: "read_b_live_handlers_failed",
    };
  }

  return {
    name: "wave1a",
    wave: "wave1a-read-handlers",
    batch: "wave1a-read-handlers",
    routeFlag: null,
    optInEnv: WAVE1A_OPT_IN_ENV,
    fake: false,
    templateIds: CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
    operations: [],
    fixtureInputs: liveSmokeFixtureInputs,
    inputBuilder: wave1AInputs,
    refsBuilder: wave1ARefs,
    passReason: "wave1a_live_read_handlers_passed",
    failReason: "wave1a_live_read_handlers_failed",
  };
}

function createLiveRuntimeForRoute(selectedRoute, executor, executorConfig) {
  return createCallTemplateRuntime({
    live: {
      opted_in: true,
      executor,
      executor_config: executorConfig,
      allowed_template_ids: selectedRoute.templateIds,
      opt_in_env: selectedRoute.optInEnv,
      opt_in_flag: OPT_IN_FLAG,
    },
    evidenceLimit: selectedRoute.templateIds.length,
  });
}

async function runReadOnlySmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase, route: selectedRoute }) {
  const templateIds = selectedRoute.templateIds;
  const exampleInputsById = selectedRoute.inputBuilder(liveRuntime, fixtureInputsForRun, templateIds);
  const exampleRefsById = selectedRoute.refsBuilder(fixtureInputsForRun);
  const executions = [];

  for (const [index, id] of templateIds.entries()) {
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
  return {
    ok,
    reason: ok ? selectedRoute.passReason : firstBlocker(executions) ?? selectedRoute.failReason,
    attempted_template_ids: templateIds,
    executions,
  };
}

async function runSafeWriteASmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};
  let targetTrackRef = null;
  let midiTakeRef = null;

  for (const [index, spec] of SAFE_WRITE_A_TEMPLATE_SPECS.entries()) {
    const refs = safeWriteARefs(spec, fixtureInputsForRun, { targetTrackRef, midiTakeRef });
    if (refs.blocker) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: refs.blocker,
        capability: spec.capability,
        operation: "run_command:template.execute",
      });
      continue;
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: safeWriteAInput(spec),
      refs: refs.value,
      idempotency_key: spec.idempotent ? `safe-write-a:${spec.id}` : undefined,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = "run_command:template.execute";
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.artifacts_allowed = false;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;
    execution.idempotency = {
      key_present: typeof response?.idempotency?.key === "string",
      replayed: Boolean(response?.idempotency?.replayed),
      expected: spec.idempotent ? "idempotent_mutation_keyed" : "create_or_insert_undo_evidence",
    };

    const produced = producedRefsByKind(response);
    if (response?.ok && spec.id === "template.tracks.create_track" && produced.track) {
      targetTrackRef = produced.track;
      outputRefs.created_track_ref = produced.track.ref;
    }
    if (response?.ok && spec.id === "template.midi.create_midi_item") {
      if (produced.item) outputRefs.created_midi_item_ref = produced.item.ref;
      if (produced.take) {
        midiTakeRef = produced.take;
        outputRefs.created_midi_take_ref = produced.take.ref;
      }
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "safe_write_a_fake_static_readback_passed" : firstBlocker(executions) ?? "safe_write_a_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
    expected_capabilities: SAFE_WRITE_A_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    executions,
  };
}

async function runE3MediaRouteSmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};

  for (const [index, spec] of E3_MEDIA_ROUTE_TEMPLATE_SPECS.entries()) {
    const refs = e3MediaRouteRefs(spec, fixtureInputsForRun);
    if (refs.blocker) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: refs.blocker,
        capability: spec.capability,
        operation: spec.operation,
      });
      continue;
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: e3MediaRouteInput(spec, fixtureInputsForRun),
      refs: refs.value,
      idempotency_key: spec.id === "template.media.relink_take_source" ? "e3-media-route:relink-take-source" : undefined,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.artifacts_allowed = false;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;
    execution.idempotency = {
      key_present: typeof response?.idempotency?.key === "string",
      replayed: Boolean(response?.idempotency?.replayed),
      expected: spec.id === "template.media.relink_take_source" ? "keyed_relink_readback" : "one_shot_media_route",
    };

    const produced = producedRefsByKind(response);
    if (response?.ok && spec.id === "template.media.import_file_to_track" && produced.item) {
      outputRefs.imported_item_ref = produced.item.ref;
    }
    if (response?.ok && spec.id === "template.media.import_file_section_to_track" && produced.item) {
      outputRefs.imported_section_item_ref = produced.item.ref;
    }
    if (response?.ok && spec.id === "template.media.relink_take_source" && produced.take) {
      outputRefs.relinked_take_ref = produced.take.ref;
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "e3_media_route_fake_static_readback_passed" : firstBlocker(executions) ?? "e3_media_route_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
    expected_capabilities: E3_MEDIA_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    preflight_blockers_covered: [
      "folder_root_absent",
      "media_source_unsupported",
      "media_source_absent",
      "relink_target_type_mismatch",
    ],
    executions,
  };
}

async function runE4ItemRouteSmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};

  for (const [index, spec] of E4_ITEM_ROUTE_TEMPLATE_SPECS.entries()) {
    const refs = e4ItemRouteRefs(spec, fixtureInputsForRun);
    if (refs.blocker) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: refs.blocker,
        capability: spec.capability,
        operation: spec.operation,
      });
      continue;
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: e4ItemRouteInput(spec, fixtureInputsForRun),
      refs: refs.value,
      idempotency_key: spec.id === "template.items.set_take_playrate" ? "e4-item-route:set-take-playrate" : undefined,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.artifacts_allowed = false;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;
    execution.idempotency = {
      key_present: typeof response?.idempotency?.key === "string",
      replayed: Boolean(response?.idempotency?.replayed),
      expected: spec.id === "template.items.set_take_playrate" ? "keyed_playrate_readback" : "one_shot_item_route",
    };

    const produced = producedRefsByKind(response);
    if (response?.ok && spec.id === "template.items.copy_item_to_track" && produced.item) {
      outputRefs.copied_item_ref = produced.item.ref;
    }
    if (response?.ok && spec.id === "template.items.split_item_at_time") {
      const producedItems = producedRefsByKindAll(response).item;
      if (producedItems?.[0]) outputRefs.left_item_ref = producedItems[0].ref;
      if (producedItems?.[1]) outputRefs.right_item_ref = producedItems[1].ref;
    }
    if (response?.ok && spec.id === "template.items.set_take_playrate" && produced.item) {
      outputRefs.playrate_item_ref = produced.item.ref;
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "e4_item_route_fake_static_readback_passed" : firstBlocker(executions) ?? "e4_item_route_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
    expected_capabilities: E4_ITEM_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    preflight_blockers_covered: [
      "selected_item_missing",
      "invalid_item_ref",
      "destination_track_missing",
      "split_outside_item_bounds",
      "invalid_playrate",
    ],
    loop_source_status: "held",
    executions,
  };
}

async function runE2FxB1RouteSmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};

  for (const [index, spec] of E2_FX_B1_ROUTE_TEMPLATE_SPECS.entries()) {
    const refs = e2FxB1RouteRefs(spec, fixtureInputsForRun);
    if (refs.blocker) {
      executions.push({
        id: spec.id,
        ok: spec.phase.startsWith("conditional_"),
        skipped: true,
        reason: refs.blocker,
        capability: spec.capability,
        operation: spec.operation,
        phase: spec.phase,
      });
      continue;
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: e2FxB1RouteInput(spec, fixtureInputsForRun),
      refs: refs.value,
      idempotency_key: spec.idempotent ? `e2-fx-b1:${spec.capability}` : undefined,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.phase = spec.phase;
    execution.artifacts_allowed = spec.artifact === true;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;
    execution.idempotency = {
      key_present: typeof response?.idempotency?.key === "string",
      replayed: Boolean(response?.idempotency?.replayed),
      expected: spec.idempotent ? "keyed_fx_readback" : "one_shot_fx_route",
    };

    const produced = producedRefsByKind(response);
    if (response?.ok && spec.id === "template.fx.resolve_fx_ref" && produced.fx) {
      outputRefs.resolved_fx_ref = produced.fx.ref;
    }
    if (response?.ok && spec.id === "template.fx.add_track_fx" && produced.fx) {
      outputRefs.added_track_fx_ref = produced.fx.ref;
    }
    if (response?.ok && spec.id === "template.fx.add_take_fx" && produced.fx) {
      outputRefs.added_take_fx_ref = produced.fx.ref;
    }
    const artifact = producedArtifactRef(response);
    if (response?.ok && spec.id === "template.fx.read_video_processor_code" && artifact) {
      outputRefs.video_processor_code_artifact_ref = artifact;
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "e2_fx_b1_route_fake_static_readback_passed" : firstBlocker(executions) ?? "e2_fx_b1_route_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
    expected_capabilities: E2_FX_B1_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    primary_template_ids: E2_FX_B1_ROUTE_TEMPLATE_SPECS
      .filter((spec) => spec.phase === "primary_read" || spec.phase === "primary_write")
      .map((spec) => spec.id),
    conditional_template_ids: E2_FX_B1_ROUTE_TEMPLATE_SPECS
      .filter((spec) => spec.phase.startsWith("conditional_"))
      .map((spec) => spec.id),
    preflight_blockers_covered: [
      "fx_track_ref_missing",
      "fx_take_ref_missing",
      "fx_ref_missing",
      "fx_plugin_name_missing",
      "fx_parameter_invalid",
      "fx_preset_fixture_missing",
      "video_processor_fixture_missing",
    ],
    live_support_status: "not_claimed",
    executions,
  };
}

async function runE2FxL1ReadRouteSmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};

  for (const [index, spec] of E2_FX_L1_READ_TEMPLATE_SPECS.entries()) {
    const refs = e2FxB1RouteRefs(spec, fixtureInputsForRun);
    if (refs.blocker) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: refs.blocker,
        capability: spec.capability,
        operation: spec.operation,
        phase: spec.phase,
      });
      continue;
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: e2FxB1RouteInput(spec, fixtureInputsForRun),
      refs: refs.value,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.phase = spec.phase;
    execution.artifacts_allowed = false;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;

    const produced = producedRefsByKind(response);
    if (response?.ok && spec.id === "template.fx.resolve_fx_ref" && produced.fx) {
      outputRefs.resolved_fx_ref = produced.fx.ref;
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "e2_fx_l1_read_fake_static_readback_passed" : firstBlocker(executions) ?? "e2_fx_l1_read_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
    expected_capabilities: E2_FX_L1_READ_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    preflight_blockers_covered: [
      "fx_track_ref_missing",
      "fx_take_ref_missing",
      "fx_ref_missing",
      "fx_parameter_invalid",
    ],
    write_fx_status: "held",
    preset_status: "held",
    video_processor_status: "held",
    live_support_status: "not_claimed",
    executions,
  };
}

async function runE5RoutingAutomationRouteSmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};

  for (const [index, spec] of E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS.entries()) {
    const refs = e5RoutingAutomationRouteRefs(spec, fixtureInputsForRun);
    if (refs.blocker) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: refs.blocker,
        capability: spec.capability,
        operation: spec.operation,
        phase: spec.phase,
      });
      continue;
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: e5RoutingAutomationRouteInput(spec, fixtureInputsForRun),
      refs: refs.value,
      idempotency_key: spec.idempotent ? `e5-routing-automation:${spec.capability}` : undefined,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.phase = spec.phase;
    execution.artifacts_allowed = false;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;
    execution.idempotency = {
      key_present: typeof response?.idempotency?.key === "string",
      replayed: Boolean(response?.idempotency?.replayed),
      expected: spec.idempotent ? "keyed_routing_automation_readback" : "one_shot_routing_automation_route",
    };

    const produced = producedRefsByKind(response);
    if (response?.ok && produced.send && !outputRefs.send_ref) {
      outputRefs.send_ref = produced.send.ref;
    }
    if (response?.ok && produced.envelope && !outputRefs.envelope_ref) {
      outputRefs.envelope_ref = produced.envelope.ref;
    }
    if (response?.ok && produced.track && !outputRefs.track_ref) {
      outputRefs.track_ref = produced.track.ref;
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "e5_routing_automation_route_fake_static_readback_passed" : firstBlocker(executions) ?? "e5_routing_automation_route_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
    expected_capabilities: E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    routing_template_ids: E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS
      .filter((spec) => spec.pack === "routing")
      .map((spec) => spec.id),
    automation_template_ids: E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_SPECS
      .filter((spec) => spec.pack === "automation")
      .map((spec) => spec.id),
    preflight_blockers_covered: [
      "e5_track_ref_missing",
      "e5_destination_track_ref_missing",
      "e5_send_ref_missing",
      "e5_fx_ref_missing",
      "e5_envelope_ref_missing",
      "e5_send_value_invalid",
      "e5_automation_point_value_invalid",
    ],
    live_support_status: "not_claimed",
    executions,
  };
}

async function runD6ProjectTempoRouteSmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};

  for (const [index, spec] of D6_PROJECT_TEMPO_TEMPLATE_SPECS.entries()) {
    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: d6ProjectTempoRouteInput(spec, fixtureInputsForRun),
      refs: {},
      idempotency_key: `d6-project-tempo:${spec.capability}`,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.phase = spec.phase;
    execution.artifacts_allowed = false;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;
    execution.idempotency = {
      key_present: typeof response?.idempotency?.key === "string",
      replayed: Boolean(response?.idempotency?.replayed),
      expected: "keyed_project_tempo_readback",
    };

    const produced = producedRefsByKind(response);
    if (response?.ok && produced.project && !outputRefs.project_ref) {
      outputRefs.project_ref = produced.project.ref;
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "d6_project_tempo_route_fake_static_readback_passed" : firstBlocker(executions) ?? "d6_project_tempo_route_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
    expected_capabilities: D6_PROJECT_TEMPO_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    preflight_blockers_covered: [
      "d6_bpm_invalid",
      "d6_tempo_marker_position_invalid",
    ],
    live_support_status: "not_claimed",
    executions,
  };
}

async function runE5RoutingReadRouteSmoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase }) {
  const executions = [];
  const attempted = [];
  const outputRefs = {};

  for (const [index, spec] of E5_R1_ROUTING_READ_TEMPLATE_SPECS.entries()) {
    const refs = e5RoutingAutomationRouteRefs(spec, fixtureInputsForRun);
    if (refs.blocker) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: refs.blocker,
        capability: spec.capability,
        operation: spec.operation,
        phase: spec.phase,
      });
      continue;
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: e5RoutingAutomationRouteInput(spec, fixtureInputsForRun),
      refs: refs.value,
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.capability = spec.capability;
    execution.risk = spec.risk;
    execution.phase = spec.phase;
    execution.artifacts_allowed = false;
    execution.undo = {
      mode: response?.undo?.mode ?? null,
      opened: Boolean(response?.undo?.opened),
      closed: Boolean(response?.undo?.closed),
      label: response?.undo?.label ?? null,
    };
    execution.verification_status = response?.verification?.status ?? null;

    const produced = producedRefsByKind(response);
    if (response?.ok && produced.send && !outputRefs.send_ref) {
      outputRefs.send_ref = produced.send.ref;
    }
    if (response?.ok && produced.track && !outputRefs.track_ref) {
      outputRefs.track_ref = produced.track.ref;
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) => execution.ok);
  return {
    ok,
    reason: ok ? "e5_r1_routing_read_fake_static_readback_passed" : firstBlocker(executions) ?? "e5_r1_routing_read_fake_static_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
    expected_capabilities: E5_R1_ROUTING_READ_TEMPLATE_SPECS.map((spec) => spec.capability),
    output_refs: outputRefs,
    routing_template_ids: E5_R1_ROUTING_READ_TEMPLATE_SPECS.map((spec) => spec.id),
    preflight_blockers_covered: [
      "e5_track_ref_missing",
      "e5_send_ref_missing",
    ],
    live_support_status: "not_claimed",
    executions,
  };
}

async function runFirstRealA1Smoke({ liveRuntime, fixtureInputs: fixtureInputsForRun, contextBase, artifactRoot }) {
  const stateRuntime = createGetStateArtifactRuntime({ artifactRoot });
  const executions = [];
  const artifactRefsBySchema = new Map();
  const attempted = [];

  for (const [index, spec] of FIRST_REAL_A1_TEMPLATE_SPECS.entries()) {
    const dependency = dependencyBlocker(spec, artifactRefsBySchema);
    if (dependency) {
      executions.push({
        id: spec.id,
        ok: false,
        skipped: true,
        reason: "dependency_artifact_unavailable",
        dependency,
      });
      continue;
    }

    const consumedReadbacks = [];
    for (const schema of spec.consumes ?? []) {
      const ref = artifactRefsBySchema.get(schema);
      consumedReadbacks.push(await readBackArtifact(stateRuntime, ref, schema));
    }

    attempted.push(spec.id);
    const response = await liveRuntime.call_template({
      id: spec.id,
      input: firstRealA1Input(spec),
      refs: firstRealA1Refs(spec, fixtureInputsForRun, artifactRefsBySchema),
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: index + 1,
      },
    });

    const execution = summarizeExecution(response);
    execution.operation = spec.operation;
    execution.consumed_readbacks = consumedReadbacks;

    const producedRef = producedArtifactRef(response);
    if (response?.ok && producedRef) {
      artifactRefsBySchema.set(spec.schema, producedRef);
      execution.produced_readback = await readBackArtifact(stateRuntime, producedRef, spec.schema);
    }
    executions.push(execution);
  }

  const ok = executions.every((execution) =>
    execution.ok &&
      execution.produced_readback?.summary_ok === true &&
      execution.produced_readback?.payload_ok === true &&
      (execution.consumed_readbacks ?? []).every((readback) => readback.summary_ok && readback.payload_ok),
  );

  return {
    ok,
    reason: ok ? "first_real_fixture_a1_live_readback_passed" : firstBlocker(executions) ?? "first_real_fixture_a1_live_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
    artifact_refs: Object.fromEntries([...artifactRefsBySchema.entries()].map(([schema, ref]) => [schema, ref])),
    executions,
  };
}

async function runFirstRealA2Smoke({
  liveRuntime,
  fixtureInputs: fixtureInputsForRun,
  contextBase,
  artifactRoot,
  renderRoot,
}) {
  const stateRuntime = createGetStateArtifactRuntime({ artifactRoot });
  const executions = [];
  const artifactRefsBySchema = new Map();
  const attempted = [];
  let renderJobRef = null;
  let physicalOutput = null;

  const renderSpec = FIRST_REAL_A2_TEMPLATE_SPECS[0];
  attempted.push(renderSpec.id);
  const renderResponse = await liveRuntime.call_template({
    id: renderSpec.id,
    input: firstRealA2RenderInput(),
    refs: {
      region_ref: regionObjectRefFromFixture(fixtureInputsForRun.region_ref),
    },
    context: {
      ...contextBase,
      created_at: new Date().toISOString(),
      request_sequence: 1,
    },
  });
  const renderExecution = summarizeExecution(renderResponse);
  renderExecution.operation = renderSpec.operation;

  for (const [schema, ref] of producedArtifactRefsBySchema(renderResponse)) {
    artifactRefsBySchema.set(schema, ref);
  }
  renderJobRef = producedJobRef(renderResponse);
  const outputRef = artifactRefsBySchema.get(renderSpec.output_schema);
  const evidenceRef = artifactRefsBySchema.get(renderSpec.evidence_schema);
  if (renderResponse?.ok && outputRef && evidenceRef) {
    renderExecution.produced_readbacks = [
      await readBackArtifact(stateRuntime, outputRef, renderSpec.output_schema),
      await readBackArtifact(stateRuntime, evidenceRef, renderSpec.evidence_schema),
    ];
    physicalOutput = await physicalOutputReadback({
      renderRoot,
      outputReadback: renderExecution.produced_readbacks[0],
    });
    renderExecution.physical_output = physicalOutput;
  }
  executions.push(renderExecution);

  const deliverySpec = FIRST_REAL_A2_TEMPLATE_SPECS[1];
  const dependency = firstRealA2DeliveryDependencyBlocker({
    artifactRefsBySchema,
    renderExecution,
    physicalOutput,
  });
  if (dependency) {
    executions.push({
      id: deliverySpec.id,
      ok: false,
      skipped: true,
      reason: "dependency_render_evidence_unavailable",
      dependency,
      operation: deliverySpec.operation,
    });
  } else {
    const consumedReadbacks = [
      await readBackArtifact(stateRuntime, outputRef, renderSpec.output_schema),
      await readBackArtifact(stateRuntime, evidenceRef, renderSpec.evidence_schema),
    ];
    attempted.push(deliverySpec.id);
    const deliveryResponse = await liveRuntime.call_template({
      id: deliverySpec.id,
      input: firstRealA2DeliveryInput(),
      refs: firstRealA2DeliveryRefs({
        fixtureInputs: fixtureInputsForRun,
        outputRef,
        evidenceRef,
        renderJobRef,
      }),
      context: {
        ...contextBase,
        created_at: new Date().toISOString(),
        request_sequence: 2,
      },
    });
    const deliveryExecution = summarizeExecution(deliveryResponse);
    deliveryExecution.operation = deliverySpec.operation;
    deliveryExecution.consumed_readbacks = consumedReadbacks;
    const deliveryRef = producedArtifactRef(deliveryResponse);
    if (deliveryResponse?.ok && deliveryRef) {
      artifactRefsBySchema.set(deliverySpec.schema, deliveryRef);
      deliveryExecution.produced_readback = await readBackArtifact(stateRuntime, deliveryRef, deliverySpec.schema);
    }
    executions.push(deliveryExecution);
  }

  const ok = executions.every((execution) =>
    execution.ok &&
      (execution.produced_readback === undefined ||
        (execution.produced_readback.summary_ok === true && execution.produced_readback.payload_ok === true)) &&
      (execution.produced_readbacks === undefined ||
        execution.produced_readbacks.every((readback) => readback.summary_ok === true && readback.payload_ok === true)) &&
      (execution.consumed_readbacks === undefined ||
        execution.consumed_readbacks.every((readback) => readback.summary_ok === true && readback.payload_ok === true)) &&
      (execution.physical_output === undefined || execution.physical_output.ok === true),
  );

  return {
    ok,
    reason: ok ? "first_real_fixture_a2_render_delivery_readback_passed" : firstBlocker(executions) ?? "first_real_fixture_a2_render_delivery_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
    artifact_refs: Object.fromEntries([...artifactRefsBySchema.entries()].map(([schema, ref]) => [schema, ref])),
    job_ref: renderJobRef,
    physical_output: physicalOutput,
    executions,
  };
}

async function runFirstRealA3Smoke({
  liveRuntime,
  fixtureInputs: fixtureInputsForRun,
  contextBase,
  artifactRoot,
}) {
  const stateRuntime = createGetStateArtifactRuntime({ artifactRoot });
  const spec = FIRST_REAL_A3_TEMPLATE_SPECS[0];
  const executions = [];
  const attempted = [];
  const artifactRefsBySchema = new Map([[spec.input_schema, fixtureInputsForRun.layer_evidence_ref]]);

  const consumedReadback = await readBackArtifact(stateRuntime, fixtureInputsForRun.layer_evidence_ref, spec.input_schema);
  if (!consumedReadback.summary_ok || !consumedReadback.payload_ok) {
    executions.push({
      id: spec.id,
      ok: false,
      skipped: true,
      reason: "layer_evidence_readback_failed",
      operation: spec.operation,
      consumed_readbacks: [consumedReadback],
    });
    return {
      ok: false,
      reason: "layer_evidence_readback_failed",
      attempted_template_ids: attempted,
      expected_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
      input_artifact_ref: fixtureInputsForRun.layer_evidence_ref,
      artifact_refs: Object.fromEntries([...artifactRefsBySchema.entries()].map(([schema, ref]) => [schema, ref])),
      executions,
    };
  }

  attempted.push(spec.id);
  const response = await liveRuntime.call_template({
    id: spec.id,
    input: firstRealA3Input(),
    refs: {
      layer_evidence_artifact_ref: artifactObjectRef(fixtureInputsForRun.layer_evidence_ref, spec.input_schema),
    },
    context: {
      ...contextBase,
      created_at: new Date().toISOString(),
      request_sequence: 1,
    },
  });

  const execution = summarizeExecution(response);
  execution.operation = spec.operation;
  execution.consumed_readbacks = [consumedReadback];

  const reportRef = producedArtifactRef(response);
  if (response?.ok && reportRef) {
    artifactRefsBySchema.set(spec.schema, reportRef);
    execution.produced_readback = await readBackArtifact(stateRuntime, reportRef, spec.schema);
  }
  executions.push(execution);

  const ok = executions.every((entry) =>
    entry.ok &&
      (entry.consumed_readbacks ?? []).every((readback) => readback.summary_ok && readback.payload_ok) &&
      entry.produced_readback?.summary_ok === true &&
      entry.produced_readback?.payload_ok === true,
  );

  return {
    ok,
    reason: ok ? "first_real_fixture_a3_layer_report_readback_passed" : firstBlocker(executions) ?? "first_real_fixture_a3_layer_report_readback_failed",
    attempted_template_ids: attempted,
    expected_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
    input_artifact_ref: fixtureInputsForRun.layer_evidence_ref,
    artifact_refs: Object.fromEntries([...artifactRefsBySchema.entries()].map(([schema, ref]) => [schema, ref])),
    executions,
  };
}

function dependencyBlocker(spec, artifactRefsBySchema) {
  const missing = (spec.consumes ?? []).filter((schema) => !artifactRefsBySchema.has(schema));
  return missing.length > 0 ? { missing_schemas: missing } : null;
}

function firstRealA1Input(spec) {
  if (spec.id === "template.analysis.detect_loop_candidates") {
    return {
      max_candidates: 8,
      min_loop_seconds: 1,
      max_loop_seconds: 12,
    };
  }
  if (spec.id === "template.analysis.measure_loop_click_risk") {
    return {
      boundary_window_ms: 20,
      max_candidates: 8,
    };
  }
  if (spec.id === "template.analysis.create_loop_qa_report") {
    return {
      max_report_rows: 8,
    };
  }
  if (spec.id === "template.project.create_project_map_snapshot") {
    return {
      max_tracks: 16,
      max_items_per_track: 2,
      max_selected_items: 8,
      track_cursor: 0,
      include_selected_items: true,
      include_track_items: true,
    };
  }
  if (spec.id === "template.project.create_observation_bundle") {
    return {
      max_tracks: 16,
      max_items_per_track: 1,
      max_selected_items: 8,
      track_cursor: 0,
      marker_region_limit: 32,
      tempo_marker_limit: 16,
      include_transport: true,
      include_track_items: true,
    };
  }
  return {
    max_report_rows: 32,
    marker_region_limit: 64,
    tempo_marker_limit: 32,
    include_markers: true,
    include_regions: true,
    include_metadata: true,
    include_tempo: true,
    include_project_fingerprint: true,
  };
}

function firstRealA1Refs(spec, fixtureInputsForRun, artifactRefsBySchema) {
  if (spec.id === "template.analysis.detect_loop_candidates") {
    return {
      item_ref: itemObjectRefFromFixture(fixtureInputsForRun.item_ref),
    };
  }
  if (spec.id === "template.analysis.measure_loop_click_risk") {
    return {
      item_ref: itemObjectRefFromFixture(fixtureInputsForRun.item_ref),
      candidate_artifact_ref: artifactObjectRef(
        artifactRefsBySchema.get("analysis.loop_candidates.v1"),
        "analysis.loop_candidates.v1",
      ),
    };
  }
  if (spec.id === "template.analysis.create_loop_qa_report") {
    return {
      candidate_artifact_ref: artifactObjectRef(
        artifactRefsBySchema.get("analysis.loop_candidates.v1"),
        "analysis.loop_candidates.v1",
      ),
      click_risk_artifact_ref: artifactObjectRef(
        artifactRefsBySchema.get("analysis.loop_click_risk.v1"),
        "analysis.loop_click_risk.v1",
      ),
    };
  }
  const projectRef = projectObjectRefFromFixture(fixtureInputsForRun.project_ref);
  return projectRef ? { project_ref: projectRef } : {};
}

function firstRealA2RenderInput() {
  return {
    format: "wav",
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
    sample_rate_hz: 48000,
    bit_depth: 24,
    channel_count: 2,
    include_sidecar_manifest: false,
  };
}

function firstRealA2DeliveryInput() {
  return {
    max_report_rows: 12,
    include_output_metadata: true,
    include_job_evidence: true,
    include_region_summary: true,
  };
}

function firstRealA3Input() {
  return {
    max_report_rows: 24,
    include_track_facts: true,
    include_color_facts: true,
    include_item_samples: true,
  };
}

function firstRealA2DeliveryRefs({ fixtureInputs, outputRef, evidenceRef, renderJobRef }) {
  const refs = {
    output_artifact_refs: artifactObjectRef(outputRef, "render.region_wav_output.v1"),
    render_job_evidence_ref: artifactObjectRef(evidenceRef, "render.render_job_evidence.v1"),
    region_ref: regionObjectRefFromFixture(fixtureInputs.region_ref),
  };
  if (renderJobRef) refs.job_ref = renderJobRef;
  return refs;
}

function firstRealA2DeliveryDependencyBlocker({ artifactRefsBySchema, renderExecution, physicalOutput }) {
  const missing = [
    "render.region_wav_output.v1",
    "render.render_job_evidence.v1",
  ].filter((schema) => !artifactRefsBySchema.has(schema));
  if (missing.length > 0) return { missing_schemas: missing };
  if (!renderExecution?.ok) return { render_ok: false };
  const readbacks = renderExecution.produced_readbacks ?? [];
  const failedReadback = readbacks.find((readback) => !readback.summary_ok || !readback.payload_ok);
  if (failedReadback) {
    return {
      failed_readback_schema: failedReadback.schema,
      failed_readback_error: failedReadback.error,
    };
  }
  if (!physicalOutput?.ok) {
    return {
      physical_output_ok: false,
      reason: physicalOutput?.reason ?? "physical_output_missing",
    };
  }
  return null;
}

async function readBackArtifact(stateRuntime, ref, schema) {
  const summary = await stateRuntime.get_state({
    scope: "artifact",
    artifact_ref: ref,
    view: "summary",
  });
  const payload = await stateRuntime.get_state({
    scope: "artifact",
    artifact_ref: ref,
    view: "payload",
  });
  const summaryArtifact = summary?.result?.artifact ?? {};
  const payloadArtifact = payload?.result?.artifact ?? {};
  const summaryFacts = isPlainObjectForReport(summaryArtifact.summary) ? summaryArtifact.summary : {};
  const payloadFacts = isPlainObjectForReport(payloadArtifact.payload) ? payloadArtifact.payload : {};
  return {
    ref,
    schema,
    get_state_contract: summary?.contract ?? null,
    summary_ok: Boolean(summary?.ok),
    payload_ok: Boolean(payload?.ok),
    summary_view: summaryArtifact.view ?? null,
    payload_view: payloadArtifact.view ?? null,
    summary_schema: summaryArtifact.schema ?? null,
    payload_schema: payloadArtifact.schema ?? null,
    summary_keys: objectKeys(summaryArtifact.summary),
    payload_keys: objectKeys(payloadArtifact.payload),
    facts: compactArtifactFacts(summaryFacts, payloadFacts),
    summary_response_bytes: summary?.budget?.response_bytes ?? null,
    payload_response_bytes: payload?.budget?.response_bytes ?? null,
    last_result_updated: Boolean(summary?.last_result?.updated || payload?.last_result?.updated),
    error: summary?.ok && payload?.ok
      ? null
      : {
          summary_code: summary?.error?.code ?? null,
          payload_code: payload?.error?.code ?? null,
        },
  };
}

function compactArtifactFacts(summary, payload) {
  const output = isPlainObjectForReport(payload.output) ? payload.output : payload;
  return pruneNullValues({
    artifact_ref: summary.artifact_ref,
    output_basename: summary.output_basename ?? output.output_basename,
    managed_relative_path: summary.managed_relative_path ?? output.managed_relative_path,
    file_size_bytes: summary.file_size_bytes ?? output.file_size_bytes,
    wav_header: summary.wav_header ?? output.wav_header,
    output_count: summary.output_count,
    nonempty_output_count: summary.nonempty_output_count,
    evidence_item_count: summary.evidence_item_count,
    evidence_track_count: summary.evidence_track_count,
    report_row_count: summary.report_row_count,
    issue_count: summary.issue_count,
  });
}

async function physicalOutputReadback({ renderRoot, outputReadback }) {
  const relative = outputReadback?.facts?.managed_relative_path;
  if (typeof relative !== "string" || relative.includes("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      reason: "managed_relative_path_missing",
    };
  }
  const outputPath = path.resolve(renderRoot, relative);
  const root = path.resolve(renderRoot);
  if (!isPathInside(outputPath, root)) {
    return {
      ok: false,
      reason: "managed_relative_path_escaped_root",
    };
  }
  try {
    const stats = await stat(outputPath);
    const header = await readFile(outputPath, { encoding: null });
    const wavHeader = header.length >= 12 &&
      header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WAVE";
    return {
      ok: stats.isFile() && stats.size > 0 && wavHeader,
      output_basename: path.basename(outputPath),
      managed_relative_path: relative,
      file_size_bytes: stats.size,
      wav_header: wavHeader,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "physical_output_unreadable",
      message: boundedString(error?.message),
    };
  }
}

async function firstRealA1ConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const artifactRootBlocker = await firstRealA1ArtifactRootBlocker(fixtureInputsForRun.artifact_root);
  if (artifactRootBlocker) return artifactRootBlocker;

  const transportDir = executorConfig.config?.transport_dir;
  const requestsDir = transportDir ? `${transportDir}/requests` : null;
  const resultsDir = transportDir ? `${transportDir}/results` : null;
  const missingTransport = [];
  for (const [label, path] of [
    ["transport_dir", transportDir],
    ["requests_dir", requestsDir],
    ["results_dir", resultsDir],
  ]) {
    if (!(await isDirectory(path))) missingTransport.push(label);
  }
  if (missingTransport.length > 0) {
    return {
      reason: "live_bridge_transport_absent",
      blocker: "live_bridge_transport_absent",
      message: "Configured live bridge transport directory is absent or incomplete.",
      details: {
        missing: missingTransport,
        transport_dir: boundedString(transportDir, 240),
        requests_dir: boundedString(requestsDir, 240),
        results_dir: boundedString(resultsDir, 240),
      },
    };
  }

  if (!(await isReadableFile(executorConfig.config?.bridge_script_path))) {
    return {
      reason: "reaper_bridge_script_absent",
      blocker: "reaper_bridge_script_absent",
      message: "Configured REAPER bridge script is absent; live bridge transport cannot handshake.",
      details: {
        bridge_script_path: boundedString(executorConfig.config?.bridge_script_path, 240),
      },
    };
  }
  return null;
}

async function firstRealA2ConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const rootBlocker = await firstRealA2RootBlocker(fixtureInputsForRun);
  if (rootBlocker) return rootBlocker;
  return readOnlyConfiguredBlocker({ executorConfig });
}

async function firstRealA3ConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const rootBlocker = await firstRealA3RootBlocker(fixtureInputsForRun);
  if (rootBlocker) return rootBlocker;
  const inputBlocker = await firstRealA3InputArtifactBlocker(fixtureInputsForRun);
  if (inputBlocker) return inputBlocker;
  return readOnlyConfiguredBlocker({ executorConfig });
}

async function firstRealA3FakeBlocker(fixtureInputsForRun) {
  const rootBlocker = await firstRealA3RootBlocker(fixtureInputsForRun);
  if (rootBlocker) return rootBlocker;
  if (!fixtureInputsForRun.layer_evidence_ref) {
    fixtureInputsForRun.layer_evidence_ref = FIRST_REAL_A3_DEFAULT_LAYER_EVIDENCE_REF;
    fixtureInputsForRun.report.layer_evidence_ref = FIRST_REAL_A3_DEFAULT_LAYER_EVIDENCE_REF;
  }
  const existingBlocker = await firstRealA3InputArtifactBlocker(fixtureInputsForRun, { allowMissing: true });
  if (!existingBlocker) return null;
  if (existingBlocker.reason !== "layer_evidence_artifact_absent") return existingBlocker;
  try {
    await seedFirstRealA3LayerEvidenceFixture(fixtureInputsForRun);
    return null;
  } catch (error) {
    return {
      reason: "layer_evidence_fixture_seed_failed",
      blocker: "layer_evidence_fixture_seed_failed",
      message: "First-Real-Fixture-A A3 fake smoke could not seed the typed layer evidence fixture artifact.",
      details: {
        artifact_root_env: FIRST_REAL_A3_ARTIFACT_ROOT_ENV,
        layer_evidence_ref_env: FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV,
        layer_evidence_ref: boundedString(fixtureInputsForRun.layer_evidence_ref, 240),
        message: boundedString(error?.message, 240),
      },
    };
  }
}

async function firstRealA2RootBlocker(fixtureInputsForRun) {
  const artifactBlocker = await firstRealA2DirectoryBlocker({
    value: fixtureInputsForRun.artifact_root,
    envName: FIRST_REAL_A2_ARTIFACT_ROOT_ENV,
    label: "artifact_root",
    notConfigured: "artifact_root_not_configured",
    absent: "artifact_root_absent",
  });
  if (artifactBlocker) return artifactBlocker;

  const renderBlocker = await firstRealA2DirectoryBlocker({
    value: fixtureInputsForRun.render_root,
    envName: FIRST_REAL_A2_RENDER_ROOT_ENV,
    label: "render_root",
    notConfigured: "render_root_not_configured",
    absent: "render_root_absent",
  });
  if (renderBlocker) return renderBlocker;

  for (const [label, value] of [
    ["artifact_root", fixtureInputsForRun.artifact_root],
    ["render_root", fixtureInputsForRun.render_root],
  ]) {
    const repoBlocker = firstRealA2RepoRootBlocker(label, value);
    if (repoBlocker) return repoBlocker;
  }
  return null;
}

async function firstRealA3RootBlocker(fixtureInputsForRun) {
  const artifactBlocker = await firstRealA3DirectoryBlocker({
    value: fixtureInputsForRun.artifact_root,
    envName: FIRST_REAL_A3_ARTIFACT_ROOT_ENV,
    label: "artifact_root",
    notConfigured: "artifact_root_not_configured",
    absent: "artifact_root_absent",
  });
  if (artifactBlocker) return artifactBlocker;

  const repoBlocker = firstRealA3RepoRootBlocker("artifact_root", fixtureInputsForRun.artifact_root);
  if (repoBlocker) return repoBlocker;
  return null;
}

async function firstRealA2DirectoryBlocker({ value, envName, label, notConfigured, absent }) {
  if (!value) {
    return {
      reason: notConfigured,
      blocker: notConfigured,
      message: `First-Real-Fixture-A A2 live smoke requires an explicit ${label}.`,
      details: {
        [`${label}_env`]: envName,
      },
    };
  }
  if (!path.isAbsolute(value) || value.startsWith("file://")) {
    return {
      reason: `${label}_invalid`,
      blocker: `${label}_invalid`,
      message: `Configured First-Real-Fixture-A A2 ${label} must be an absolute filesystem directory.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  if (!(await isDirectory(value))) {
    return {
      reason: absent,
      blocker: absent,
      message: `Configured First-Real-Fixture-A A2 ${label} is absent.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  return null;
}

async function firstRealA3DirectoryBlocker({ value, envName, label, notConfigured, absent }) {
  if (!value) {
    return {
      reason: notConfigured,
      blocker: notConfigured,
      message: `First-Real-Fixture-A A3 live smoke requires an explicit ${label}.`,
      details: {
        [`${label}_env`]: envName,
      },
    };
  }
  if (!path.isAbsolute(value) || value.startsWith("file://")) {
    return {
      reason: `${label}_invalid`,
      blocker: `${label}_invalid`,
      message: `Configured First-Real-Fixture-A A3 ${label} must be an absolute filesystem directory.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  if (!(await isDirectory(value))) {
    return {
      reason: absent,
      blocker: absent,
      message: `Configured First-Real-Fixture-A A3 ${label} is absent.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  return null;
}

function firstRealA2RepoRootBlocker(label, value) {
  const resolved = path.resolve(value);
  const forbiddenRoots = [
    path.resolve(new URL("..", import.meta.url).pathname),
    "/Users/Zhuanz/Documents/streetlight-reaper-mcp",
  ];
  const forbidden = forbiddenRoots.find((root) => isPathInside(resolved, root));
  if (!forbidden) return null;
  return {
    reason: `${label}_inside_repo`,
    blocker: `${label}_inside_repo`,
    message: `Configured First-Real-Fixture-A A2 ${label} must be outside the OpenReaper and old-control repos.`,
    details: {
      [label]: boundedString(resolved, 240),
      forbidden_root: boundedString(forbidden, 240),
    },
  };
}

function firstRealA3RepoRootBlocker(label, value) {
  const resolved = path.resolve(value);
  const forbiddenRoots = [
    path.resolve(new URL("..", import.meta.url).pathname),
    "/Users/Zhuanz/Documents/streetlight-reaper-mcp",
  ];
  const forbidden = forbiddenRoots.find((root) => isPathInside(resolved, root));
  if (!forbidden) return null;
  return {
    reason: `${label}_inside_repo`,
    blocker: `${label}_inside_repo`,
    message: `Configured First-Real-Fixture-A A3 ${label} must be outside the OpenReaper and old-control repos.`,
    details: {
      [label]: boundedString(resolved, 240),
      forbidden_root: boundedString(forbidden, 240),
    },
  };
}

async function firstRealA1ArtifactRootBlocker(artifactRoot) {
  if (!artifactRoot) {
    return {
      reason: "artifact_root_not_configured",
      blocker: "artifact_root_not_configured",
      message: "First-Real-Fixture-A A1 live smoke requires an explicit artifact root.",
      details: {
        artifact_root_env: FIRST_REAL_A1_ARTIFACT_ROOT_ENV,
      },
    };
  }
  if (!(await isDirectory(artifactRoot))) {
    return {
      reason: "artifact_root_absent",
      blocker: "artifact_root_absent",
      message: "Configured First-Real-Fixture-A A1 artifact root is absent.",
      details: {
        artifact_root_env: FIRST_REAL_A1_ARTIFACT_ROOT_ENV,
        artifact_root: boundedString(artifactRoot, 240),
      },
    };
  }
  return null;
}

async function firstRealA3InputArtifactBlocker(fixtureInputsForRun, options = {}) {
  const ref = fixtureInputsForRun.layer_evidence_ref;
  if (!ref) {
    return {
      reason: "layer_evidence_artifact_ref_not_configured",
      blocker: "layer_evidence_artifact_ref_not_configured",
      message: "First-Real-Fixture-A A3 live smoke requires an explicit items.layer_evidence.v1 artifact ref.",
      details: {
        layer_evidence_ref_env: FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV,
      },
    };
  }

  let parts;
  try {
    parts = parseArtifactRef(ref);
  } catch (error) {
    return {
      reason: "layer_evidence_artifact_ref_invalid",
      blocker: "layer_evidence_artifact_ref_invalid",
      message: "Configured First-Real-Fixture-A A3 layer evidence ref must be canonical.",
      details: {
        layer_evidence_ref_env: FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV,
        layer_evidence_ref: boundedString(ref, 240),
        code: error?.code ?? "PARAMS_INVALID",
      },
    };
  }

  if (parts.owner_pack !== "items" || parts.scope !== "layer_evidence") {
    return {
      reason: "layer_evidence_artifact_ref_invalid",
      blocker: "layer_evidence_artifact_ref_invalid",
      message: "Configured First-Real-Fixture-A A3 layer evidence ref must use artifact:items:layer_evidence:<id>.",
      details: {
        expected_owner_pack: "items",
        expected_scope: "layer_evidence",
        owner_pack: parts.owner_pack,
        scope: parts.scope,
      },
    };
  }

  let envelope;
  try {
    const artifactPath = artifactPathFromRef(fixtureInputsForRun.artifact_root, ref);
    envelope = normalizeArtifactEnvelope(JSON.parse(await readFile(artifactPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        reason: "layer_evidence_artifact_absent",
        blocker: "layer_evidence_artifact_absent",
        message: "Configured First-Real-Fixture-A A3 layer evidence artifact is absent.",
        details: {
          layer_evidence_ref_env: FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV,
          layer_evidence_ref: boundedString(ref, 240),
          allow_fake_seed: options.allowMissing === true,
        },
      };
    }
    return {
      reason: "layer_evidence_artifact_invalid",
      blocker: "layer_evidence_artifact_invalid",
      message: "Configured First-Real-Fixture-A A3 layer evidence artifact is invalid.",
      details: {
        layer_evidence_ref_env: FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV,
        layer_evidence_ref: boundedString(ref, 240),
        code: error?.code ?? "ARTIFACT_INVALID",
        message: boundedString(error?.message, 240),
      },
    };
  }

  if (
    envelope.schema !== "items.layer_evidence.v1" ||
    envelope.owner_pack !== "items" ||
    envelope.scope !== "layer_evidence" ||
    envelope.producer?.kind !== "template" ||
    envelope.producer?.pack !== "items"
  ) {
    return {
      reason: "layer_evidence_artifact_invalid",
      blocker: "layer_evidence_artifact_invalid",
      message: "Configured First-Real-Fixture-A A3 layer evidence artifact must be items.layer_evidence.v1 from an items template producer.",
      details: {
        expected_schema: "items.layer_evidence.v1",
        schema: boundedString(envelope.schema, 160),
        producer_kind: boundedString(envelope.producer?.kind, 80),
        producer_pack: boundedString(envelope.producer?.pack, 80),
      },
    };
  }
  return null;
}

async function seedFirstRealA3LayerEvidenceFixture(fixtureInputsForRun) {
  const ref = fixtureInputsForRun.layer_evidence_ref;
  const summary = {
    schema: "items.layer_evidence.v1",
    item_count: 2,
    track_count: 2,
    evidence_family_count: 2,
    truncated: false,
    fixture: "first_real_a3_layer_report",
  };
  const payload = {
    fixture: "first_real_a3_layer_report",
    smoke_only: true,
    evidence_families: ["items", "tracks"],
    items: [
      {
        item_ref: "item:guid:{A3-FIXTURE-ITEM-001}",
        track_ref: "track:name:Dialog",
        name: "dialog-layer-cue",
        color: "blue",
        start_seconds: 0,
        length_seconds: 1.25,
      },
      {
        item_ref: "item:guid:{A3-FIXTURE-ITEM-002}",
        track_ref: "track:name:Music",
        name: "music-layer-cue",
        color: "green",
        start_seconds: 1.5,
        length_seconds: 2,
      },
    ],
    tracks: [
      {
        track_ref: "track:name:Dialog",
        name: "Dialog",
        item_count: 1,
      },
      {
        track_ref: "track:name:Music",
        name: "Music",
        item_count: 1,
      },
    ],
  };
  await writeArtifactStateStoreEnvelope({
    artifactRoot: fixtureInputsForRun.artifact_root,
    envelope: createArtifactStateStoreEnvelope({
      ref,
      schema: "items.layer_evidence.v1",
      producer: {
        kind: "template",
        id: "template.items.fixture_layer_evidence",
        pack: "items",
      },
      created_at: "2026-07-04T00:00:00.000Z",
      summary,
      payload,
    }),
  });
}

async function isDirectory(path) {
  if (!path) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isReadableFile(path) {
  if (!path) return false;
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readOnlyConfiguredBlocker({ executorConfig }) {
  const transportDir = executorConfig.config?.transport_dir;
  const requestsDir = transportDir ? `${transportDir}/requests` : null;
  const resultsDir = transportDir ? `${transportDir}/results` : null;
  const missingTransport = [];
  for (const [label, path] of [
    ["transport_dir", transportDir],
    ["requests_dir", requestsDir],
    ["results_dir", resultsDir],
  ]) {
    if (!(await isDirectory(path))) missingTransport.push(label);
  }
  if (missingTransport.length > 0) {
    return {
      reason: "live_bridge_transport_absent",
      blocker: "live_bridge_transport_absent",
      message: "Configured live bridge transport directory is absent or incomplete.",
      details: {
        missing: missingTransport,
        transport_dir: boundedString(transportDir, 240),
        requests_dir: boundedString(requestsDir, 240),
        results_dir: boundedString(resultsDir, 240),
      },
    };
  }

  if (!(await isReadableFile(executorConfig.config?.bridge_script_path))) {
    return {
      reason: "reaper_bridge_script_absent",
      blocker: "reaper_bridge_script_absent",
      message: "Configured REAPER bridge script is absent; live bridge transport cannot handshake.",
      details: {
        bridge_script_path: boundedString(executorConfig.config?.bridge_script_path, 240),
      },
    };
  }
  return null;
}

async function safeWriteAConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const transportBlocker = await readOnlyConfiguredBlocker({ executorConfig });
  if (transportBlocker) return transportBlocker;

  const rootBlocker = await safeWriteADirectoryBlocker({
    value: fixtureInputsForRun.project_root,
    envName: SAFE_WRITE_A_PROJECT_ROOT_ENV,
    label: "project_root",
    notConfigured: "project_root_not_configured",
    absent: "project_root_absent",
  });
  if (rootBlocker) return rootBlocker;

  const repoBlocker = safeWriteARepoRootBlocker("project_root", fixtureInputsForRun.project_root);
  if (repoBlocker) return repoBlocker;

  for (const [label, value, envName] of [
    ["project_ref", fixtureInputsForRun.project_ref, SAFE_WRITE_A_PROJECT_REF_ENV],
    ["anchor_track_ref", fixtureInputsForRun.anchor_track_ref, SAFE_WRITE_A_ANCHOR_TRACK_REF_ENV],
    ["item_ref", fixtureInputsForRun.item_ref, SAFE_WRITE_A_ITEM_REF_ENV],
    ["midi_track_ref", fixtureInputsForRun.midi_track_ref, SAFE_WRITE_A_MIDI_TRACK_REF_ENV],
  ]) {
    if (!value || fixtureInputsForRun.configured?.[label] !== true) {
      return {
        reason: `${label}_not_configured`,
        blocker: `${label}_not_configured`,
        message: `Safe-Write-A live smoke requires an explicit ${label} fixture.`,
        details: {
          [`${label}_env`]: envName,
        },
      };
    }
  }

  return null;
}

async function e3MediaRouteConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const transportBlocker = await readOnlyConfiguredBlocker({ executorConfig });
  if (transportBlocker) return transportBlocker;

  const folderBlocker = await mediaDirectoryBlocker({
    value: fixtureInputsForRun.folder_root,
    envName: E3_MEDIA_FOLDER_ROOT_ENV,
    label: "folder_root",
    notConfigured: "folder_root_not_configured",
    absent: "folder_root_absent",
  });
  if (folderBlocker) return folderBlocker;

  const sourceBlocker = await mediaFileBlocker({
    value: fixtureInputsForRun.source_path,
    envName: E3_MEDIA_SOURCE_PATH_ENV,
    label: "media_source",
    notConfigured: "media_source_not_configured",
    absent: "media_source_absent",
  });
  if (sourceBlocker) return sourceBlocker;

  const relinkBlocker = await mediaFileBlocker({
    value: fixtureInputsForRun.relink_path,
    envName: E3_MEDIA_RELINK_PATH_ENV,
    label: "relink_target",
    notConfigured: "relink_target_not_configured",
    absent: "relink_target_absent",
  });
  if (relinkBlocker) return relinkBlocker;

  const sourceKind = mediaKindForPath(fixtureInputsForRun.source_path);
  const relinkKind = mediaKindForPath(fixtureInputsForRun.relink_path);
  if (sourceKind !== relinkKind) {
    return {
      reason: "relink_target_type_mismatch",
      blocker: "relink_target_type_mismatch",
      message: "E3 media route live smoke requires relink source and target media kinds to match.",
      details: {
        source_kind: sourceKind,
        relink_kind: relinkKind,
        source_path: boundedString(fixtureInputsForRun.source_path, 240),
        relink_path: boundedString(fixtureInputsForRun.relink_path, 240),
      },
    };
  }

  for (const [label, value, envName] of [
    ["target_track_ref", fixtureInputsForRun.target_track_ref, E3_MEDIA_TARGET_TRACK_REF_ENV],
    ["take_ref", fixtureInputsForRun.take_ref, E3_MEDIA_TAKE_REF_ENV],
  ]) {
    if (!value || fixtureInputsForRun.configured?.[label] !== true) {
      return {
        reason: `${label}_not_configured`,
        blocker: `${label}_not_configured`,
        message: `E3 media route live smoke requires an explicit ${label} fixture.`,
        details: {
          [`${label}_env`]: envName,
        },
      };
    }
  }

  return null;
}

async function e4ItemRouteConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const transportBlocker = await readOnlyConfiguredBlocker({ executorConfig });
  if (transportBlocker) return transportBlocker;

  if (!fixtureInputsForRun.configured?.item_ref) {
    return {
      reason: "selected_item_missing",
      blocker: "selected_item_missing",
      message: "E4 item route live smoke requires an explicit source item fixture.",
      details: {
        item_ref_env: E4_ITEM_REF_ENV,
      },
    };
  }
  if (!normalizeItemFixtureRef(fixtureInputsForRun.item_ref)) {
    return {
      reason: "invalid_item_ref",
      blocker: "invalid_item_ref",
      message: "E4 item route source item fixture is not a supported item ref.",
      details: {
        item_ref_env: E4_ITEM_REF_ENV,
        item_ref: boundedString(fixtureInputsForRun.item_ref, 160),
      },
    };
  }
  if (!fixtureInputsForRun.configured?.target_track_ref) {
    return {
      reason: "destination_track_missing",
      blocker: "destination_track_missing",
      message: "E4 item route live smoke requires an explicit destination track fixture.",
      details: {
        target_track_ref_env: E4_TARGET_TRACK_REF_ENV,
      },
    };
  }
  if (!normalizeTrackFixtureRef(fixtureInputsForRun.target_track_ref)) {
    return {
      reason: "destination_track_missing",
      blocker: "destination_track_missing",
      message: "E4 item route destination track fixture is not a supported track ref.",
      details: {
        target_track_ref_env: E4_TARGET_TRACK_REF_ENV,
        target_track_ref: boundedString(fixtureInputsForRun.target_track_ref, 160),
      },
    };
  }
  if (
    !Number.isFinite(fixtureInputsForRun.item_start_seconds)
    || !Number.isFinite(fixtureInputsForRun.item_length_seconds)
    || fixtureInputsForRun.item_length_seconds <= 0
    || !Number.isFinite(fixtureInputsForRun.split_position_seconds)
    || fixtureInputsForRun.split_position_seconds <= fixtureInputsForRun.item_start_seconds
    || fixtureInputsForRun.split_position_seconds >= fixtureInputsForRun.item_start_seconds + fixtureInputsForRun.item_length_seconds
  ) {
    return {
      reason: "split_outside_item_bounds",
      blocker: "split_outside_item_bounds",
      message: "E4 item route split position must be strictly inside the configured item bounds.",
      details: {
        item_start_seconds_env: E4_ITEM_START_SECONDS_ENV,
        item_length_seconds_env: E4_ITEM_LENGTH_SECONDS_ENV,
        split_position_seconds_env: E4_SPLIT_POSITION_SECONDS_ENV,
        item_start_seconds: fixtureInputsForRun.item_start_seconds,
        item_length_seconds: fixtureInputsForRun.item_length_seconds,
        split_position_seconds: fixtureInputsForRun.split_position_seconds,
      },
    };
  }
  if (!Number.isFinite(fixtureInputsForRun.playrate) || fixtureInputsForRun.playrate <= 0 || fixtureInputsForRun.playrate > 16) {
    return {
      reason: "invalid_playrate",
      blocker: "invalid_playrate",
      message: "E4 item route playrate must be greater than zero and no more than 16.",
      details: {
        playrate_env: E4_PLAYRATE_ENV,
        playrate: fixtureInputsForRun.playrate,
      },
    };
  }

  return null;
}

async function e2FxB1RouteConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const transportBlocker = await readOnlyConfiguredBlocker({ executorConfig });
  if (transportBlocker) return transportBlocker;

  for (const [label, configured, value, envName, normalizer] of [
    ["fx_track_ref", fixtureInputsForRun.configured?.track_ref, fixtureInputsForRun.track_ref, E2_FX_B1_TRACK_REF_ENV, normalizeTrackFixtureRef],
    ["fx_take_ref", fixtureInputsForRun.configured?.take_ref, fixtureInputsForRun.take_ref, E2_FX_B1_TAKE_REF_ENV, normalizeTakeFixtureRef],
    ["fx_ref", fixtureInputsForRun.configured?.fx_ref, fixtureInputsForRun.fx_ref, E2_FX_B1_FX_REF_ENV, normalizeFxFixtureRef],
  ]) {
    if (!configured) {
      return {
        reason: `${label}_missing`,
        blocker: `${label}_missing`,
        message: `E2 FX-B1 live smoke requires an explicit ${label} fixture.`,
        details: { [`${label}_env`]: envName },
      };
    }
    if (!normalizer(value)) {
      return {
        reason: `${label}_invalid`,
        blocker: `${label}_invalid`,
        message: `E2 FX-B1 ${label} fixture is not a supported ref.`,
        details: {
          [`${label}_env`]: envName,
          value: boundedString(value, 160),
        },
      };
    }
  }

  if (!fixtureInputsForRun.configured?.plugin_name) {
    return {
      reason: "fx_plugin_name_missing",
      blocker: "fx_plugin_name_missing",
      message: "E2 FX-B1 live smoke requires an explicit stock FX plugin name.",
      details: { plugin_name_env: E2_FX_B1_PLUGIN_NAME_ENV },
    };
  }
  if (!fixtureInputsForRun.configured?.second_plugin_name) {
    return {
      reason: "fx_second_plugin_missing",
      blocker: "fx_second_plugin_missing",
      message: "E2 FX-B1 live smoke requires a second stock FX plugin name for reorder readback.",
      details: { second_plugin_name_env: E2_FX_B1_SECOND_PLUGIN_NAME_ENV },
    };
  }
  if (!Number.isInteger(fixtureInputsForRun.param_index) || fixtureInputsForRun.param_index < 0) {
    return {
      reason: "fx_parameter_invalid",
      blocker: "fx_parameter_invalid",
      message: "E2 FX-B1 parameter index must be a non-negative integer.",
      details: { param_index_env: E2_FX_B1_PARAM_INDEX_ENV },
    };
  }
  if (!Number.isFinite(fixtureInputsForRun.param_value) || fixtureInputsForRun.param_value < 0 || fixtureInputsForRun.param_value > 1) {
    return {
      reason: "fx_parameter_invalid",
      blocker: "fx_parameter_invalid",
      message: "E2 FX-B1 normalized parameter value must be between 0 and 1.",
      details: { param_value_env: E2_FX_B1_PARAM_VALUE_ENV },
    };
  }

  return null;
}

async function e2FxL1ReadRouteConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const transportBlocker = await readOnlyConfiguredBlocker({ executorConfig });
  if (transportBlocker) return transportBlocker;

  for (const [label, configured, value, envName, normalizer] of [
    ["fx_track_ref", fixtureInputsForRun.configured?.track_ref, fixtureInputsForRun.track_ref, E2_FX_B1_TRACK_REF_ENV, normalizeTrackFixtureRef],
    ["fx_take_ref", fixtureInputsForRun.configured?.take_ref, fixtureInputsForRun.take_ref, E2_FX_B1_TAKE_REF_ENV, normalizeTakeFixtureRef],
    ["fx_ref", fixtureInputsForRun.configured?.fx_ref, fixtureInputsForRun.fx_ref, E2_FX_B1_FX_REF_ENV, normalizeFxFixtureRef],
  ]) {
    if (!configured) {
      return {
        reason: `${label}_missing`,
        blocker: `${label}_missing`,
        message: `E2 FX-L1 read live smoke requires an explicit ${label} fixture.`,
        details: { [`${label}_env`]: envName },
      };
    }
    if (!normalizer(value)) {
      return {
        reason: `${label}_invalid`,
        blocker: `${label}_invalid`,
        message: `E2 FX-L1 read ${label} fixture is not a supported ref.`,
        details: {
          [`${label}_env`]: envName,
          value: boundedString(value, 160),
        },
      };
    }
  }

  if (!Number.isInteger(fixtureInputsForRun.param_index) || fixtureInputsForRun.param_index < 0) {
    return {
      reason: "fx_parameter_invalid",
      blocker: "fx_parameter_invalid",
      message: "E2 FX-L1 read parameter index must be a non-negative integer.",
      details: { param_index_env: E2_FX_B1_PARAM_INDEX_ENV },
    };
  }

  return null;
}

async function e5R1RoutingReadRouteConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const transportBlocker = await readOnlyConfiguredBlocker({ executorConfig });
  if (transportBlocker) return transportBlocker;

  for (const [label, configured, value, envName, normalizer] of [
    ["e5_track_ref", fixtureInputsForRun.configured?.track_ref, fixtureInputsForRun.track_ref, E5_TRACK_REF_ENV, normalizeTrackFixtureRef],
    ["e5_send_ref", fixtureInputsForRun.configured?.send_ref, fixtureInputsForRun.send_ref, E5_SEND_REF_ENV, normalizeSendFixtureRef],
  ]) {
    if (!configured) {
      return {
        reason: `${label}_missing`,
        blocker: `${label}_missing`,
        message: `E5-R1 routing read live smoke requires an explicit ${label} fixture.`,
        details: { [`${label}_env`]: envName },
      };
    }
    if (!normalizer(value)) {
      return {
        reason: `${label}_invalid`,
        blocker: `${label}_invalid`,
        message: `E5-R1 routing read ${label} fixture is not a supported ref.`,
        details: {
          [`${label}_env`]: envName,
          value: boundedString(value, 160),
        },
      };
    }
  }

  return null;
}

async function e5RoutingAutomationRouteConfiguredBlocker({ fixtureInputs: fixtureInputsForRun, executorConfig }) {
  const transportBlocker = await readOnlyConfiguredBlocker({ executorConfig });
  if (transportBlocker) return transportBlocker;

  for (const [label, configured, value, envName, normalizer] of [
    ["e5_track_ref", fixtureInputsForRun.configured?.track_ref, fixtureInputsForRun.track_ref, E5_TRACK_REF_ENV, normalizeTrackFixtureRef],
    ["e5_destination_track_ref", fixtureInputsForRun.configured?.destination_track_ref, fixtureInputsForRun.destination_track_ref, E5_DESTINATION_TRACK_REF_ENV, normalizeTrackFixtureRef],
    ["e5_send_ref", fixtureInputsForRun.configured?.send_ref, fixtureInputsForRun.send_ref, E5_SEND_REF_ENV, normalizeSendFixtureRef],
    ["e5_fx_ref", fixtureInputsForRun.configured?.fx_ref, fixtureInputsForRun.fx_ref, E5_FX_REF_ENV, normalizeFxFixtureRef],
    ["e5_envelope_ref", fixtureInputsForRun.configured?.envelope_ref, fixtureInputsForRun.envelope_ref, E5_ENVELOPE_REF_ENV, normalizeEnvelopeFixtureRef],
  ]) {
    if (!configured) {
      return {
        reason: `${label}_missing`,
        blocker: `${label}_missing`,
        message: `E5 routing/automation live smoke requires an explicit ${label} fixture.`,
        details: { [`${label}_env`]: envName },
      };
    }
    if (!normalizer(value)) {
      return {
        reason: `${label}_invalid`,
        blocker: `${label}_invalid`,
        message: `E5 routing/automation ${label} fixture is not a supported ref.`,
        details: {
          [`${label}_env`]: envName,
          value: boundedString(value, 160),
        },
      };
    }
  }

  if (!Number.isFinite(fixtureInputsForRun.send_volume) || fixtureInputsForRun.send_volume < 0 || fixtureInputsForRun.send_volume > 4) {
    return {
      reason: "e5_send_value_invalid",
      blocker: "e5_send_value_invalid",
      message: "E5 routing live smoke send volume must be a finite 0..4 scalar.",
      details: { send_volume_env: E5_SEND_VOLUME_ENV },
    };
  }
  if (!Number.isFinite(fixtureInputsForRun.send_pan) || fixtureInputsForRun.send_pan < -1 || fixtureInputsForRun.send_pan > 1) {
    return {
      reason: "e5_send_value_invalid",
      blocker: "e5_send_value_invalid",
      message: "E5 routing live smoke send pan must be a finite -1..1 scalar.",
      details: { send_pan_env: E5_SEND_PAN_ENV },
    };
  }
  if (!Number.isFinite(fixtureInputsForRun.point_value) || fixtureInputsForRun.point_value < 0 || fixtureInputsForRun.point_value > 1) {
    return {
      reason: "e5_automation_point_value_invalid",
      blocker: "e5_automation_point_value_invalid",
      message: "E5 automation live smoke point value must be a finite 0..1 scalar.",
      details: { point_value_env: E5_POINT_VALUE_ENV },
    };
  }

  return null;
}

async function safeWriteADirectoryBlocker({ value, envName, label, notConfigured, absent }) {
  if (!value) {
    return {
      reason: notConfigured,
      blocker: notConfigured,
      message: `Safe-Write-A live smoke requires an explicit ${label}.`,
      details: {
        [`${label}_env`]: envName,
      },
    };
  }
  if (!path.isAbsolute(value) || value.startsWith("file://")) {
    return {
      reason: `${label}_invalid`,
      blocker: `${label}_invalid`,
      message: `Configured Safe-Write-A ${label} must be an absolute filesystem directory.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  if (!(await isDirectory(value))) {
    return {
      reason: absent,
      blocker: absent,
      message: `Configured Safe-Write-A ${label} is absent.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  return null;
}

async function mediaDirectoryBlocker({ value, envName, label, notConfigured, absent }) {
  if (!value) {
    return {
      reason: notConfigured,
      blocker: notConfigured,
      message: `E3 media route live smoke requires an explicit ${label}.`,
      details: {
        [`${label}_env`]: envName,
      },
    };
  }
  if (!path.isAbsolute(value) || value.startsWith("file://")) {
    return {
      reason: `${label}_invalid`,
      blocker: `${label}_invalid`,
      message: `Configured E3 media route ${label} must be an absolute filesystem directory.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  if (!(await isDirectory(value))) {
    return {
      reason: absent,
      blocker: absent,
      message: `Configured E3 media route ${label} is absent.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  return null;
}

async function mediaFileBlocker({ value, envName, label, notConfigured, absent }) {
  if (!value) {
    return {
      reason: notConfigured,
      blocker: notConfigured,
      message: `E3 media route live smoke requires an explicit ${label}.`,
      details: {
        [`${label}_env`]: envName,
      },
    };
  }
  if (!path.isAbsolute(value) || value.startsWith("file://")) {
    return {
      reason: `${label}_invalid`,
      blocker: `${label}_invalid`,
      message: `Configured E3 media route ${label} must be an absolute filesystem file path.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  const mediaKind = mediaKindForPath(value);
  if (!mediaKind) {
    return {
      reason: `${label}_unsupported`,
      blocker: `${label}_unsupported`,
      message: `Configured E3 media route ${label} uses an unsupported media extension.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
        extension: boundedString(path.extname(value).slice(1).toLowerCase(), 24),
        supported_extensions: [...SUPPORTED_MEDIA_EXTENSIONS],
      },
    };
  }
  if (!(await isReadableFile(value))) {
    return {
      reason: absent,
      blocker: absent,
      message: `Configured E3 media route ${label} is absent or unreadable.`,
      details: {
        [`${label}_env`]: envName,
        [label]: boundedString(value, 240),
      },
    };
  }
  return null;
}

function safeWriteARepoRootBlocker(label, value) {
  const resolved = path.resolve(value);
  const forbiddenRoots = [
    path.resolve(new URL("..", import.meta.url).pathname),
    "/Users/Zhuanz/Documents/streetlight-reaper-mcp",
  ];
  const forbidden = forbiddenRoots.find((root) => isPathInside(resolved, root));
  if (!forbidden) return null;
  return {
    reason: `${label}_inside_repo`,
    blocker: `${label}_inside_repo`,
    message: `Configured Safe-Write-A ${label} must be outside the OpenReaper and old-control repos.`,
    details: {
      [label]: boundedString(resolved, 240),
      forbidden_root: boundedString(forbidden, 240),
    },
  };
}

function catalogExampleInputs(liveRuntime, templateIds) {
  const menu = liveRuntime.list_templates({
    ids: templateIds,
    fields: ["examples"],
  });
  return Object.fromEntries(
    menu.items.map((item) => [item.id, cloneJson(item.examples?.[0]?.input ?? {})]),
  );
}

function wave1AInputs(liveRuntime, fixtureInputsForRun, templateIds) {
  const inputs = catalogExampleInputs(liveRuntime, templateIds);
  if (fixtureInputsForRun.track_ref) {
    inputs["template.tracks.resolve_track_ref"] = { track_ref: fixtureInputsForRun.track_ref };
  }
  if (fixtureInputsForRun.item_ref) {
    inputs["template.items.resolve_item_ref"] = { ref: fixtureInputsForRun.item_ref };
  }
  return inputs;
}

function wave1ARefs(fixtureInputsForRun) {
  return {
    "template.items.read_item_summary": {
      item_ref: itemObjectRefFromFixture(fixtureInputsForRun.item_ref),
    },
  };
}

function readBInputs(_liveRuntime, fixtureInputsForRun) {
  return {
    "template.actions.resolve_named_command": {
      named_command: fixtureInputsForRun.named_command,
      section: fixtureInputsForRun.action_section,
    },
    "template.actions.read_action_metadata": {
      section: fixtureInputsForRun.action_section,
      command_id: fixtureInputsForRun.action_command_id,
    },
    "template.actions.read_action_toggle_state": {
      section: fixtureInputsForRun.action_section,
      command_id: fixtureInputsForRun.action_toggle_command_id,
    },
    "template.actions.read_action_shortcuts": {
      section: fixtureInputsForRun.action_section,
      command_id: fixtureInputsForRun.action_command_id,
      max_shortcuts: 8,
    },
    "template.actions.parse_marker_action_text": {
      text: fixtureInputsForRun.marker_action_text,
      section: fixtureInputsForRun.action_section,
      resolve_tokens: true,
    },
    "template.actions.search_action_commands": {
      section: fixtureInputsForRun.action_section,
      query: fixtureInputsForRun.action_search_query,
      limit: fixtureInputsForRun.action_search_limit,
    },
    "template.midi.resolve_midi_take_ref": {
      ref: fixtureInputsForRun.midi_take_ref,
    },
    "template.midi.read_take_event_counts": {},
    "template.midi.list_take_notes": {
      limit: 16,
      include_project_time: true,
    },
    "template.midi.list_take_cc_events": {
      controller: 1,
      limit: 16,
    },
    "template.midi.list_take_text_sysex_events": {
      event_kind: "any",
      limit: 16,
    },
    "template.midi.read_take_grid": {},
    "template.media.probe_file": {
      path: fixtureInputsForRun.media_path,
      include_metadata_keys: true,
    },
    "template.media.read_take_source": {
      include_metadata_keys: true,
      include_parent_source: false,
    },
    "template.media.read_project_media_files": {
      include_offline: true,
      include_metadata_keys: false,
      max_sources: 25,
    },
  };
}

function readBRefs(fixtureInputsForRun) {
  const midiTakeRef = takeObjectRefFromFixture(fixtureInputsForRun.midi_take_ref);
  const audioTakeRef = takeObjectRefFromFixture(fixtureInputsForRun.audio_take_ref);
  return {
    "template.midi.read_take_event_counts": { take_ref: midiTakeRef },
    "template.midi.list_take_notes": { take_ref: midiTakeRef },
    "template.midi.list_take_cc_events": { take_ref: midiTakeRef },
    "template.midi.list_take_text_sysex_events": { take_ref: midiTakeRef },
    "template.midi.read_take_grid": { take_ref: midiTakeRef },
    "template.media.read_take_source": { take_ref: audioTakeRef },
  };
}

function e3MediaRouteInput(spec, fixtureInputsForRun) {
  const inputs = {
    "template.media.list_folder_media_files": {
      folder_ref: fixtureInputsForRun.folder_ref,
      media_type: "audio",
      extension_filter: ["wav", "aiff", "flac"],
      limit: 8,
      offset: 0,
    },
    "template.media.import_file_to_track": {
      position_seconds: 0,
      preserve_selection: true,
    },
    "template.media.import_file_section_to_track": {
      position_seconds: 2,
      start_percent: 0.25,
      end_percent: 0.75,
      preserve_selection: true,
    },
    "template.media.relink_take_source": {
      verify_source_type: true,
    },
  };
  return inputs[spec.id] ?? {};
}

function e3MediaRouteRefs(spec, fixtureInputsForRun) {
  if (spec.ref_group === "source_track") {
    const sourceFileRef = fileObjectRefFromPath(fixtureInputsForRun.source_path);
    const trackRef = trackObjectRefFromFixture(fixtureInputsForRun.target_track_ref);
    if (!sourceFileRef) return { blocker: "media_source_ref_unavailable" };
    if (!trackRef) return { blocker: "target_track_ref_unavailable" };
    return { value: { source_file_ref: sourceFileRef, track_ref: trackRef } };
  }
  if (spec.ref_group === "take_relink") {
    const relinkFileRef = fileObjectRefFromPath(fixtureInputsForRun.relink_path);
    const takeRef = takeObjectRefFromFixture(fixtureInputsForRun.take_ref);
    if (!relinkFileRef) return { blocker: "relink_target_ref_unavailable" };
    if (!takeRef) return { blocker: "take_ref_unavailable" };
    return { value: { take_ref: takeRef, source_file_ref: relinkFileRef } };
  }
  return { value: {} };
}

function e4ItemRouteInput(spec, fixtureInputsForRun) {
  const inputs = {
    "template.items.copy_item_to_track": {
      position_seconds: fixtureInputsForRun.copy_position_seconds,
    },
    "template.items.split_item_at_time": {
      position_seconds: fixtureInputsForRun.split_position_seconds,
    },
    "template.items.set_take_playrate": {
      playrate: fixtureInputsForRun.playrate,
      preserve_pitch: true,
    },
  };
  return inputs[spec.id] ?? {};
}

function e4ItemRouteRefs(spec, fixtureInputsForRun) {
  const itemRef = itemObjectRefFromFixture(fixtureInputsForRun.item_ref);
  if (!itemRef) return { blocker: "item_ref_unavailable" };
  if (spec.ref_group === "source_target") {
    const trackRef = trackObjectRefFromFixture(fixtureInputsForRun.target_track_ref);
    if (!trackRef) return { blocker: "target_track_ref_unavailable" };
    return { value: { source_item_ref: itemRef, target_track_ref: trackRef } };
  }
  if (spec.ref_group === "source_item") {
    return { value: { item_ref: itemRef } };
  }
  return { value: {} };
}

function e2FxB1RouteInput(spec, fixtureInputsForRun) {
  const inputs = {
    "template.fx.resolve_fx_ref": {
      owner_kind: "track",
      slot_index: 0,
    },
    "template.fx.list_track_fx_chain": {
      include_preset: true,
    },
    "template.fx.list_take_fx_chain": {
      include_preset: true,
    },
    "template.fx.read_fx_summary": {},
    "template.fx.list_fx_parameters": {
      limit: 16,
    },
    "template.fx.read_fx_parameter": {
      param_index: fixtureInputsForRun.param_index,
    },
    "template.fx.parameter_to_envelope_mapping": {
      param_index: fixtureInputsForRun.param_index,
    },
    "template.fx.add_track_fx": {
      plugin_name: fixtureInputsForRun.plugin_name,
    },
    "template.fx.add_take_fx": {
      plugin_name: fixtureInputsForRun.plugin_name,
    },
    "template.fx.set_fx_bypass": {
      enabled: false,
    },
    "template.fx.set_fx_parameter_normalized": {
      param_index: fixtureInputsForRun.param_index,
      normalized_value: fixtureInputsForRun.param_value,
      tolerance: 0.001,
    },
    "template.fx.set_fx_preset_by_name": {
      preset_name: fixtureInputsForRun.preset_name,
    },
    "template.fx.set_fx_preset_by_index": {
      preset_index: fixtureInputsForRun.preset_index,
    },
    "template.fx.reorder_fx": {
      target_index: 0,
    },
    "template.fx.read_video_processor_code": {},
  };
  return inputs[spec.id] ?? {};
}

function e2FxB1RouteRefs(spec, fixtureInputsForRun) {
  const trackRef = trackObjectRefFromFixture(fixtureInputsForRun.track_ref);
  const takeRef = takeObjectRefFromFixture(fixtureInputsForRun.take_ref);
  const fxRef = fxObjectRefFromFixture(fixtureInputsForRun.fx_ref);
  const videoFxRef = fxObjectRefFromFixture(fixtureInputsForRun.video_fx_ref);
  if (spec.ref_group === "track_or_take") {
    if (!trackRef) return { blocker: "fx_track_ref_missing" };
    return { value: { track_ref: trackRef } };
  }
  if (spec.ref_group === "track") {
    if (!trackRef) return { blocker: "fx_track_ref_missing" };
    return { value: { track_ref: trackRef } };
  }
  if (spec.ref_group === "take") {
    if (!takeRef) return { blocker: "fx_take_ref_missing" };
    return { value: { take_ref: takeRef } };
  }
  if (spec.ref_group === "track_plugin") {
    if (!trackRef) return { blocker: "fx_track_ref_missing" };
    if (!fixtureInputsForRun.plugin_name) return { blocker: "fx_plugin_name_missing" };
    return { value: { track_ref: trackRef } };
  }
  if (spec.ref_group === "take_plugin") {
    if (!takeRef) return { blocker: "fx_take_ref_missing" };
    if (!fixtureInputsForRun.plugin_name) return { blocker: "fx_plugin_name_missing" };
    return { value: { take_ref: takeRef } };
  }
  if (spec.ref_group === "fx_second_plugin") {
    if (!fxRef) return { blocker: "fx_ref_missing" };
    if (!fixtureInputsForRun.second_plugin_name) return { blocker: "fx_second_plugin_missing" };
    return { value: { fx_ref: fxRef } };
  }
  if (spec.ref_group === "fx_preset_name") {
    if (!fxRef) return { blocker: "fx_ref_missing" };
    if (!fixtureInputsForRun.preset_name) return { blocker: "fx_preset_fixture_missing" };
    return { value: { fx_ref: fxRef } };
  }
  if (spec.ref_group === "fx_preset_index") {
    if (!fxRef) return { blocker: "fx_ref_missing" };
    if (!Number.isInteger(fixtureInputsForRun.preset_index)) return { blocker: "fx_preset_fixture_missing" };
    return { value: { fx_ref: fxRef } };
  }
  if (spec.ref_group === "video_fx") {
    if (!videoFxRef) return { blocker: "video_processor_fixture_missing" };
    return { value: { fx_ref: videoFxRef } };
  }
  if (spec.ref_group === "fx") {
    if (!fxRef) return { blocker: "fx_ref_missing" };
    return { value: { fx_ref: fxRef } };
  }
  return { value: {} };
}

function e5RoutingAutomationRouteInput(spec, fixtureInputsForRun) {
  const inputs = {
    "template.routing.read_track_routing": {
      include_receives: true,
      include_master_parent: true,
      max_routes: 32,
    },
    "template.routing.resolve_send_ref": {
      send_ref: fixtureInputsForRun.send_ref,
    },
    "template.routing.create_track_send": {
      duplicate_policy: "reject_existing",
    },
    "template.routing.set_send_volume": {
      volume: fixtureInputsForRun.send_volume,
    },
    "template.routing.set_send_pan": {
      pan: fixtureInputsForRun.send_pan,
    },
    "template.routing.set_send_mute": {
      muted: false,
    },
    "template.routing.set_send_mode": {
      mode: "post_fader",
    },
    "template.routing.set_master_parent_send": {
      enabled: true,
    },
    "template.routing.set_track_channel_count": {
      channel_count: 4,
    },
    "template.routing.list_track_hardware_outputs": {
      include_disabled: true,
      max_outputs: 16,
    },
    "template.routing.set_track_hardware_output": {
      output_index: 0,
      source_channel_offset: 0,
      source_channel_count: 2,
      mix_to_mono: false,
    },
    "template.routing.remove_track_hardware_output": {
      output_index: 0,
      missing_policy: "ok",
    },
    "template.routing.read_project_routing_graph": {
      include_master_parent: true,
      max_tracks: 16,
      max_edges: 64,
    },
    "template.routing.set_send_audio_channels": {
      source_channel_offset: 0,
      source_channel_count: 2,
      destination_channel_offset: 0,
      mix_to_mono: false,
    },
    "template.routing.set_send_phase": {
      phase_inverted: false,
    },
    "template.routing.set_send_mono": {
      mono: false,
    },
    "template.routing.set_send_midi_channels": {
      source_channel: "all",
      destination_channel: "original",
    },
    "template.routing.read_fx_pin_mapping": {
      direction: "input",
      pin_index: 0,
    },
    "template.routing.list_available_audio_outputs": {
      include_unavailable: false,
      max_outputs: 32,
    },
    "template.automation.resolve_envelope_ref": {
      parent_kind: "track",
      envelope_name: "Volume",
    },
    "template.automation.list_project_envelopes": {
      parent_kinds: ["track", "take", "send", "fx"],
      only_visible: true,
      limit: 32,
    },
    "template.automation.read_envelope_points": {
      limit: 16,
    },
    "template.automation.evaluate_envelope_at_time": {
      time_seconds: 1,
    },
    "template.automation.set_envelope_lane_state": {
      active: true,
      visible: true,
      show_lane: true,
      armed: false,
    },
    "template.automation.insert_envelope_point": {
      time_seconds: 1,
      value: fixtureInputsForRun.point_value,
      shape: 0,
      tension: 0,
      selected: false,
    },
    "template.automation.set_track_automation_mode": {
      mode: "read",
    },
    "template.automation.set_envelope_point": {
      point_index: 0,
      time_seconds: 1,
      value: fixtureInputsForRun.point_value,
      shape: 0,
      tension: 0,
      selected: false,
    },
    "template.automation.insert_envelope_points_batch": {
      points: [
        { time_seconds: 1, value: fixtureInputsForRun.point_value, shape: 0, tension: 0, selected: false },
        { time_seconds: 2, value: Math.min(1, fixtureInputsForRun.point_value + 0.1), shape: 0, tension: 0, selected: false },
      ],
    },
    "template.automation.delete_envelope_points": {
      mode: "point",
      autoitem_index: -1,
      point_index: 0,
    },
    "template.automation.set_send_automation_mode": {
      mode: "use_track",
    },
    "template.automation.create_automation_item": {
      position_seconds: 1,
      length_seconds: 2,
      pool_mode: "new_empty",
    },
    "template.automation.set_automation_item_bounds": {
      automation_item_index: 0,
      position_seconds: 1,
      length_seconds: 2,
    },
    "template.automation.resolve_send_envelope": {
      envelope_type: "volume",
    },
    "template.automation.insert_fx_parameter_envelope_points": {
      param_index: 0,
      points: [
        { time_seconds: 0, value: Math.max(0, fixtureInputsForRun.point_value - 0.1), shape: 0, tension: 0 },
        { time_seconds: 1, value: fixtureInputsForRun.point_value, shape: 0, tension: 0 },
      ],
    },
    "template.automation.insert_sine_wave_points": {
      start_seconds: 0,
      end_seconds: 2,
      center_value: fixtureInputsForRun.point_value,
      amplitude: 0.1,
      cycles: 1,
      point_count: 9,
      shape: 0,
      tension: 0,
    },
  };
  return inputs[spec.id] ?? {};
}

function d6ProjectTempoRouteInput(spec, fixtureInputsForRun) {
  const inputs = {
    "template.project.set_tempo": {
      bpm: fixtureInputsForRun.tempo_bpm,
      preserve_tempo_markers: true,
    },
    "template.project.set_bpm": {
      bpm: fixtureInputsForRun.bpm_alias,
      preserve_tempo_markers: true,
    },
    "template.project.set_tempo_marker": {
      position_seconds: fixtureInputsForRun.marker_position_seconds,
      bpm: fixtureInputsForRun.marker_bpm,
      time_signature_numerator: 4,
      time_signature_denominator: 4,
    },
    "template.project.set_grid": {
      division: "1/8",
    },
  };
  return inputs[spec.id] ?? {};
}

function e5RoutingAutomationRouteRefs(spec, fixtureInputsForRun) {
  const trackRef = trackObjectRefFromFixture(fixtureInputsForRun.track_ref);
  const destinationTrackRef = trackObjectRefFromFixture(fixtureInputsForRun.destination_track_ref);
  const sendRef = sendObjectRefFromFixture(fixtureInputsForRun.send_ref);
  const fxRef = fxObjectRefFromFixture(fixtureInputsForRun.fx_ref);
  const envelopeRef = envelopeObjectRefFromFixture(fixtureInputsForRun.envelope_ref);
  const takeRef = takeObjectRefFromFixture(fixtureInputsForRun.take_ref);

  if (spec.ref_group === "none") {
    return { value: {} };
  }
  if (spec.ref_group === "track") {
    if (!trackRef) return { blocker: "e5_track_ref_missing" };
    return { value: { track_ref: trackRef } };
  }
  if (spec.ref_group === "track_pair") {
    if (!trackRef) return { blocker: "e5_track_ref_missing" };
    if (!destinationTrackRef) return { blocker: "e5_destination_track_ref_missing" };
    return { value: { source_track_ref: trackRef, destination_track_ref: destinationTrackRef } };
  }
  if (spec.ref_group === "send" || spec.ref_group === "send_locator") {
    if (!sendRef) return { blocker: "e5_send_ref_missing" };
    return spec.ref_group === "send" ? { value: { send_ref: sendRef } } : { value: {} };
  }
  if (spec.ref_group === "track_fx") {
    if (!trackRef) return { blocker: "e5_track_ref_missing" };
    if (!fxRef) return { blocker: "e5_fx_ref_missing" };
    return { value: { track_ref: trackRef, fx_ref: fxRef } };
  }
  if (spec.ref_group === "automation_parent") {
    if (!trackRef && !takeRef) return { blocker: "e5_track_ref_missing" };
    return { value: trackRef ? { track_ref: trackRef } : { take_ref: takeRef } };
  }
  if (spec.ref_group === "envelope") {
    if (!envelopeRef) return { blocker: "e5_envelope_ref_missing" };
    return { value: { envelope_ref: envelopeRef } };
  }
  if (spec.ref_group === "fx_envelope") {
    if (!fxRef) return { blocker: "e5_fx_ref_missing" };
    if (!envelopeRef) return { blocker: "e5_envelope_ref_missing" };
    return { value: { fx_ref: fxRef, envelope_ref: envelopeRef } };
  }
  return { value: {} };
}

function safeWriteAInput(spec) {
  const inputs = {
    "template.project.set_metadata_field": {
      field: "title",
      value: "OpenReaper Safe Write A",
    },
    "template.project.create_marker": {
      name: "OR_SAFE_WRITE_A_MARKER",
      position_seconds: 0.25,
    },
    "template.project.create_region": {
      name: "OR_SAFE_WRITE_A_REGION",
      start_seconds: 0.5,
      end_seconds: 1.5,
    },
    "template.tracks.create_track": {
      name: "OR_SAFE_WRITE_A_TARGET",
    },
    "template.tracks.rename_track": {
      name: "OR_SAFE_WRITE_A_RENAMED",
    },
    "template.tracks.set_color": {
      color: "#2D9CDB",
    },
    "template.tracks.select_track": {
      mode: "replace",
    },
    "template.tracks.set_mute": {
      muted: false,
    },
    "template.tracks.set_solo": {
      mode: "off",
    },
    "template.transport.set_edit_cursor": {
      position_seconds: 0.5,
      move_view: false,
      seek_playback: false,
    },
    "template.transport.set_time_selection": {
      start_seconds: 0.25,
      end_seconds: 0.75,
    },
    "template.transport.clear_time_selection": {},
    "template.transport.set_loop_points": {
      start_seconds: 0.25,
      end_seconds: 0.75,
    },
    "template.transport.clear_loop_points": {},
    "template.transport.set_repeat": {
      enabled: false,
    },
    "template.items.move_item": {
      position_seconds: 0.5,
    },
    "template.items.trim_item": {
      length_seconds: 0.75,
    },
    "template.items.set_item_fades": {
      fade_in_seconds: 0.01,
      fade_out_seconds: 0.02,
    },
    "template.items.set_take_pitch": {
      semitones: 0,
    },
    "template.items.set_item_snap_offset": {
      snap_offset_seconds: 0,
    },
    "template.midi.create_midi_item": {
      start_seconds: 0,
      end_seconds: 2,
    },
    "template.midi.insert_notes_batch": {
      position_unit: "ppq",
      sort_events: true,
      notes: [
        {
          start_ppq: 0,
          end_ppq: 240,
          pitch: 60,
          velocity: 96,
          channel: 0,
        },
      ],
    },
    "template.midi.insert_cc_batch": {
      position_unit: "ppq",
      sort_events: true,
      events: [
        {
          ppq: 0,
          channel: 0,
          controller: 1,
          value: 64,
        },
      ],
    },
    "template.midi.insert_text_sysex_events": {
      position_unit: "ppq",
      sort_events: true,
      events: [
        {
          ppq: 0,
          event_kind: "lyric",
          text: "safe-write-a",
        },
      ],
    },
  };
  return inputs[spec.id] ?? {};
}

function safeWriteARefs(spec, fixtureInputsForRun, state) {
  if (spec.ref_group === "created_track") {
    const trackRef = state.targetTrackRef ?? trackObjectRefFromFixture(fixtureInputsForRun.anchor_track_ref);
    return trackRef
      ? { value: { track_ref: trackRef } }
      : { blocker: "track_fixture_ref_unavailable" };
  }
  if (spec.ref_group === "anchor_item") {
    const itemRef = itemObjectRefFromFixture(fixtureInputsForRun.item_ref);
    return itemRef
      ? { value: { item_ref: itemRef } }
      : { blocker: "item_fixture_ref_unavailable" };
  }
  if (spec.ref_group === "midi_track") {
    const trackRef = trackObjectRefFromFixture(fixtureInputsForRun.midi_track_ref);
    return trackRef
      ? { value: { track_ref: trackRef } }
      : { blocker: "midi_track_fixture_ref_unavailable" };
  }
  if (spec.ref_group === "created_midi_take") {
    return state.midiTakeRef
      ? { value: { take_ref: state.midiTakeRef } }
      : { blocker: "midi_take_ref_unavailable" };
  }
  return { value: {} };
}

function safeWriteAFixtureInputs(env) {
  const projectRoot = nonEmpty(env[SAFE_WRITE_A_PROJECT_ROOT_ENV]);
  const rawProjectRef = nonEmpty(env[SAFE_WRITE_A_PROJECT_REF_ENV]);
  const rawAnchorTrackRef = nonEmpty(env[SAFE_WRITE_A_ANCHOR_TRACK_REF_ENV]);
  const rawItemRef = nonEmpty(env[SAFE_WRITE_A_ITEM_REF_ENV]);
  const rawMidiTrackRef = nonEmpty(env[SAFE_WRITE_A_MIDI_TRACK_REF_ENV]);
  const projectRef = normalizeProjectFixtureRef(rawProjectRef) ?? "project:current";
  const anchorTrackRef = normalizeTrackFixtureRef(rawAnchorTrackRef) ?? "track:index:0";
  const itemRef = normalizeItemFixtureRef(rawItemRef) ?? "item:selected:0";
  const midiTrackRef = normalizeTrackFixtureRef(rawMidiTrackRef) ?? "track:index:0";
  return {
    project_root: projectRoot,
    project_ref: projectRef,
    anchor_track_ref: anchorTrackRef,
    item_ref: itemRef,
    midi_track_ref: midiTrackRef,
    configured: {
      project_ref: Boolean(normalizeProjectFixtureRef(rawProjectRef)),
      anchor_track_ref: Boolean(normalizeTrackFixtureRef(rawAnchorTrackRef)),
      item_ref: Boolean(normalizeItemFixtureRef(rawItemRef)),
      midi_track_ref: Boolean(normalizeTrackFixtureRef(rawMidiTrackRef)),
    },
    report: {
      project_root_env: SAFE_WRITE_A_PROJECT_ROOT_ENV,
      project_ref_env: SAFE_WRITE_A_PROJECT_REF_ENV,
      anchor_track_ref_env: SAFE_WRITE_A_ANCHOR_TRACK_REF_ENV,
      item_ref_env: SAFE_WRITE_A_ITEM_REF_ENV,
      midi_track_ref_env: SAFE_WRITE_A_MIDI_TRACK_REF_ENV,
      project_root: boundedString(projectRoot, 240),
      project_ref: projectRef,
      anchor_track_ref: anchorTrackRef,
      item_ref: itemRef,
      midi_track_ref: midiTrackRef,
      configured: {
        project_ref: Boolean(normalizeProjectFixtureRef(rawProjectRef)),
        anchor_track_ref: Boolean(normalizeTrackFixtureRef(rawAnchorTrackRef)),
        item_ref: Boolean(normalizeItemFixtureRef(rawItemRef)),
        midi_track_ref: Boolean(normalizeTrackFixtureRef(rawMidiTrackRef)),
      },
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
    },
  };
}

function e3MediaRouteFixtureInputs(env) {
  const folderRoot = nonEmpty(env[E3_MEDIA_FOLDER_ROOT_ENV]);
  const sourcePath = nonEmpty(env[E3_MEDIA_SOURCE_PATH_ENV]) ?? "fixture-source.wav";
  const relinkPath = nonEmpty(env[E3_MEDIA_RELINK_PATH_ENV]) ?? "fixture-relink.wav";
  const rawTargetTrackRef = nonEmpty(env[E3_MEDIA_TARGET_TRACK_REF_ENV]);
  const rawTakeRef = nonEmpty(env[E3_MEDIA_TAKE_REF_ENV]);
  const targetTrackRef = normalizeTrackFixtureRef(rawTargetTrackRef) ?? "track:index:0";
  const takeRef = normalizeTakeFixtureRef(rawTakeRef) ?? "take:index:0";
  const folderRef = folderRoot ? `folder:path:${folderRoot}` : "folder:fixture-media";
  return {
    folder_root: folderRoot,
    folder_ref: folderRef,
    source_path: sourcePath,
    relink_path: relinkPath,
    target_track_ref: targetTrackRef,
    take_ref: takeRef,
    configured: {
      target_track_ref: Boolean(normalizeTrackFixtureRef(rawTargetTrackRef)),
      take_ref: Boolean(normalizeTakeFixtureRef(rawTakeRef)),
    },
    report: {
      folder_root_env: E3_MEDIA_FOLDER_ROOT_ENV,
      source_path_env: E3_MEDIA_SOURCE_PATH_ENV,
      relink_path_env: E3_MEDIA_RELINK_PATH_ENV,
      target_track_ref_env: E3_MEDIA_TARGET_TRACK_REF_ENV,
      take_ref_env: E3_MEDIA_TAKE_REF_ENV,
      folder_root: boundedString(folderRoot, 240),
      folder_ref: boundedString(folderRef, 240),
      source_path: boundedString(sourcePath, 240),
      relink_path: boundedString(relinkPath, 240),
      source_kind: mediaKindForPath(sourcePath),
      relink_kind: mediaKindForPath(relinkPath),
      target_track_ref: targetTrackRef,
      take_ref: takeRef,
      configured: {
        target_track_ref: Boolean(normalizeTrackFixtureRef(rawTargetTrackRef)),
        take_ref: Boolean(normalizeTakeFixtureRef(rawTakeRef)),
      },
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
    },
  };
}

function e4ItemRouteFixtureInputs(env) {
  const rawItemRef = nonEmpty(env[E4_ITEM_REF_ENV]);
  const rawTargetTrackRef = nonEmpty(env[E4_TARGET_TRACK_REF_ENV]);
  const itemRef = rawItemRef ?? "item:selected:0";
  const targetTrackRef = rawTargetTrackRef ?? "track:index:0";
  const itemStartSeconds = finiteNumber(env[E4_ITEM_START_SECONDS_ENV], 0);
  const itemLengthSeconds = finiteNumber(env[E4_ITEM_LENGTH_SECONDS_ENV], 4);
  const splitPositionSeconds = finiteNumber(env[E4_SPLIT_POSITION_SECONDS_ENV], 2);
  const playrate = finiteNumber(env[E4_PLAYRATE_ENV], 0.75);
  return {
    item_ref: itemRef,
    target_track_ref: targetTrackRef,
    item_start_seconds: itemStartSeconds,
    item_length_seconds: itemLengthSeconds,
    split_position_seconds: splitPositionSeconds,
    copy_position_seconds: itemStartSeconds + itemLengthSeconds + 1,
    playrate,
    configured: {
      item_ref: rawItemRef !== null,
      target_track_ref: rawTargetTrackRef !== null,
    },
    report: {
      item_ref_env: E4_ITEM_REF_ENV,
      target_track_ref_env: E4_TARGET_TRACK_REF_ENV,
      item_start_seconds_env: E4_ITEM_START_SECONDS_ENV,
      item_length_seconds_env: E4_ITEM_LENGTH_SECONDS_ENV,
      split_position_seconds_env: E4_SPLIT_POSITION_SECONDS_ENV,
      playrate_env: E4_PLAYRATE_ENV,
      item_ref: itemRef,
      target_track_ref: targetTrackRef,
      item_start_seconds: itemStartSeconds,
      item_length_seconds: itemLengthSeconds,
      split_position_seconds: splitPositionSeconds,
      copy_position_seconds: itemStartSeconds + itemLengthSeconds + 1,
      playrate,
      loop_source_status: "held",
      configured: {
        item_ref: rawItemRef !== null,
        target_track_ref: rawTargetTrackRef !== null,
      },
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
    },
  };
}

function e2FxB1RouteFixtureInputs(env) {
  const rawTrackRef = nonEmpty(env[E2_FX_B1_TRACK_REF_ENV]);
  const rawTakeRef = nonEmpty(env[E2_FX_B1_TAKE_REF_ENV]);
  const rawFxRef = nonEmpty(env[E2_FX_B1_FX_REF_ENV]);
  const rawVideoFxRef = nonEmpty(env[E2_FX_B1_VIDEO_FX_REF_ENV]);
  const rawPluginName = nonEmpty(env[E2_FX_B1_PLUGIN_NAME_ENV]);
  const rawSecondPluginName = nonEmpty(env[E2_FX_B1_SECOND_PLUGIN_NAME_ENV]);
  const rawPresetName = nonEmpty(env[E2_FX_B1_PRESET_NAME_ENV]);
  const artifactRoot = nonEmpty(env[E2_FX_B1_ARTIFACT_ROOT_ENV]);
  const trackRef = rawTrackRef ? normalizeTrackFixtureRef(rawTrackRef) ?? rawTrackRef : "track:index:0";
  const takeRef = rawTakeRef ? normalizeTakeFixtureRef(rawTakeRef) ?? rawTakeRef : "take:index:0";
  const fxRef = rawFxRef ? normalizeFxFixtureRef(rawFxRef) ?? rawFxRef : "fx:track:index:0:0";
  const videoFxRef = rawVideoFxRef ? normalizeFxFixtureRef(rawVideoFxRef) ?? rawVideoFxRef : "fx:track:index:0:0";
  const pluginName = rawPluginName ?? "ReaEQ (Cockos)";
  const secondPluginName = rawSecondPluginName ?? "ReaComp (Cockos)";
  const paramIndex = nonNegativeInteger(env[E2_FX_B1_PARAM_INDEX_ENV], 0);
  const paramValue = boundedUnitNumber(env[E2_FX_B1_PARAM_VALUE_ENV], 0.5);
  const presetIndex = nonNegativeIntegerOrNull(env[E2_FX_B1_PRESET_INDEX_ENV]);
  return {
    track_ref: trackRef,
    take_ref: takeRef,
    fx_ref: fxRef,
    video_fx_ref: videoFxRef,
    plugin_name: pluginName,
    second_plugin_name: secondPluginName,
    param_index: paramIndex,
    param_value: paramValue,
    preset_name: rawPresetName,
    preset_index: presetIndex,
    artifact_root: artifactRoot,
    configured: {
      track_ref: Boolean(rawTrackRef),
      take_ref: Boolean(rawTakeRef),
      fx_ref: Boolean(rawFxRef),
      plugin_name: Boolean(rawPluginName),
      second_plugin_name: Boolean(rawSecondPluginName),
      preset_name: Boolean(rawPresetName),
      preset_index: presetIndex !== null,
      video_fx_ref: Boolean(rawVideoFxRef),
      artifact_root: Boolean(artifactRoot),
    },
    report: {
      track_ref_env: E2_FX_B1_TRACK_REF_ENV,
      take_ref_env: E2_FX_B1_TAKE_REF_ENV,
      fx_ref_env: E2_FX_B1_FX_REF_ENV,
      plugin_name_env: E2_FX_B1_PLUGIN_NAME_ENV,
      second_plugin_name_env: E2_FX_B1_SECOND_PLUGIN_NAME_ENV,
      param_index_env: E2_FX_B1_PARAM_INDEX_ENV,
      param_value_env: E2_FX_B1_PARAM_VALUE_ENV,
      preset_name_env: E2_FX_B1_PRESET_NAME_ENV,
      preset_index_env: E2_FX_B1_PRESET_INDEX_ENV,
      video_fx_ref_env: E2_FX_B1_VIDEO_FX_REF_ENV,
      artifact_root_env: E2_FX_B1_ARTIFACT_ROOT_ENV,
      track_ref: trackRef,
      take_ref: takeRef,
      fx_ref: fxRef,
      video_fx_ref: videoFxRef,
      plugin_name: pluginName,
      second_plugin_name: secondPluginName,
      param_index: paramIndex,
      param_value: paramValue,
      preset_name: rawPresetName,
      preset_index: presetIndex,
      artifact_root: boundedString(artifactRoot, 240),
      configured: {
        track_ref: Boolean(rawTrackRef),
        take_ref: Boolean(rawTakeRef),
        fx_ref: Boolean(rawFxRef),
        plugin_name: Boolean(rawPluginName),
        second_plugin_name: Boolean(rawSecondPluginName),
        preset_name: Boolean(rawPresetName),
        preset_index: presetIndex !== null,
        video_fx_ref: Boolean(rawVideoFxRef),
        artifact_root: Boolean(artifactRoot),
      },
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
    },
  };
}

function e5RoutingAutomationRouteFixtureInputs(env) {
  const rawTrackRef = nonEmpty(env[E5_TRACK_REF_ENV]);
  const rawDestinationTrackRef = nonEmpty(env[E5_DESTINATION_TRACK_REF_ENV]);
  const rawSendRef = nonEmpty(env[E5_SEND_REF_ENV]);
  const rawFxRef = nonEmpty(env[E5_FX_REF_ENV]);
  const rawEnvelopeRef = nonEmpty(env[E5_ENVELOPE_REF_ENV]);
  const rawTakeRef = nonEmpty(env[E5_TAKE_REF_ENV]);
  const trackRef = rawTrackRef ? normalizeTrackFixtureRef(rawTrackRef) ?? rawTrackRef : "track:index:0";
  const destinationTrackRef = rawDestinationTrackRef ? normalizeTrackFixtureRef(rawDestinationTrackRef) ?? rawDestinationTrackRef : "track:index:1";
  const sendRef = rawSendRef ? normalizeSendFixtureRef(rawSendRef) ?? rawSendRef : "send:track:0:0";
  const fxRef = rawFxRef ? normalizeFxFixtureRef(rawFxRef) ?? rawFxRef : "fx:track:index:0:0";
  const envelopeRef = rawEnvelopeRef ? normalizeEnvelopeFixtureRef(rawEnvelopeRef) ?? rawEnvelopeRef : "envelope:track:volume";
  const takeRef = rawTakeRef ? normalizeTakeFixtureRef(rawTakeRef) ?? rawTakeRef : "take:index:0";
  const sendVolume = finiteNumber(env[E5_SEND_VOLUME_ENV], 1);
  const sendPan = finiteNumber(env[E5_SEND_PAN_ENV], 0);
  const pointValue = boundedUnitNumber(env[E5_POINT_VALUE_ENV], 0.75);
  return {
    track_ref: trackRef,
    destination_track_ref: destinationTrackRef,
    send_ref: sendRef,
    fx_ref: fxRef,
    envelope_ref: envelopeRef,
    take_ref: takeRef,
    send_volume: sendVolume,
    send_pan: sendPan,
    point_value: pointValue,
    configured: {
      track_ref: Boolean(rawTrackRef),
      destination_track_ref: Boolean(rawDestinationTrackRef),
      send_ref: Boolean(rawSendRef),
      fx_ref: Boolean(rawFxRef),
      envelope_ref: Boolean(rawEnvelopeRef),
      take_ref: Boolean(rawTakeRef),
      send_volume: nonEmpty(env[E5_SEND_VOLUME_ENV]) !== null,
      send_pan: nonEmpty(env[E5_SEND_PAN_ENV]) !== null,
      point_value: nonEmpty(env[E5_POINT_VALUE_ENV]) !== null,
    },
    report: {
      track_ref_env: E5_TRACK_REF_ENV,
      destination_track_ref_env: E5_DESTINATION_TRACK_REF_ENV,
      send_ref_env: E5_SEND_REF_ENV,
      fx_ref_env: E5_FX_REF_ENV,
      envelope_ref_env: E5_ENVELOPE_REF_ENV,
      take_ref_env: E5_TAKE_REF_ENV,
      send_volume_env: E5_SEND_VOLUME_ENV,
      send_pan_env: E5_SEND_PAN_ENV,
      point_value_env: E5_POINT_VALUE_ENV,
      track_ref: trackRef,
      destination_track_ref: destinationTrackRef,
      send_ref: sendRef,
      fx_ref: fxRef,
      envelope_ref: envelopeRef,
      take_ref: takeRef,
      send_volume: sendVolume,
      send_pan: sendPan,
      point_value: pointValue,
      configured: {
        track_ref: Boolean(rawTrackRef),
        destination_track_ref: Boolean(rawDestinationTrackRef),
        send_ref: Boolean(rawSendRef),
        fx_ref: Boolean(rawFxRef),
        envelope_ref: Boolean(rawEnvelopeRef),
        take_ref: Boolean(rawTakeRef),
        send_volume: nonEmpty(env[E5_SEND_VOLUME_ENV]) !== null,
        send_pan: nonEmpty(env[E5_SEND_PAN_ENV]) !== null,
        point_value: nonEmpty(env[E5_POINT_VALUE_ENV]) !== null,
      },
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
    },
  };
}

function e5R1RoutingReadRouteFixtureInputs(env) {
  const fixtureInputs = e5RoutingAutomationRouteFixtureInputs(env);
  return {
    ...fixtureInputs,
    report: {
      track_ref_env: E5_TRACK_REF_ENV,
      send_ref_env: E5_SEND_REF_ENV,
      track_ref: fixtureInputs.track_ref,
      send_ref: fixtureInputs.send_ref,
      configured: {
        track_ref: fixtureInputs.configured.track_ref,
        send_ref: fixtureInputs.configured.send_ref,
      },
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
    },
  };
}

function d6ProjectTempoRouteFixtureInputs(env) {
  const tempoBpm = finiteNumber(env[D6_PROJECT_TEMPO_BPM_ENV], 123);
  const bpmAlias = finiteNumber(env[D6_PROJECT_BPM_ALIAS_ENV], 124);
  const markerBpm = finiteNumber(env[D6_PROJECT_TEMPO_MARKER_BPM_ENV], 125);
  const markerPosition = finiteNumber(env[D6_PROJECT_TEMPO_MARKER_POSITION_ENV], 1);
  return {
    tempo_bpm: tempoBpm,
    bpm_alias: bpmAlias,
    marker_bpm: markerBpm,
    marker_position_seconds: markerPosition,
    report: {
      tempo_bpm_env: D6_PROJECT_TEMPO_BPM_ENV,
      bpm_alias_env: D6_PROJECT_BPM_ALIAS_ENV,
      marker_bpm_env: D6_PROJECT_TEMPO_MARKER_BPM_ENV,
      marker_position_env: D6_PROJECT_TEMPO_MARKER_POSITION_ENV,
      tempo_bpm: tempoBpm,
      bpm_alias: bpmAlias,
      marker_bpm: markerBpm,
      marker_position_seconds: markerPosition,
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
    },
  };
}

function liveSmokeFixtureInputs(env) {
  const trackRef = nonEmpty(env[TRACK_REF_ENV]);
  const itemRef = normalizeItemFixtureRef(nonEmpty(env[ITEM_REF_ENV])) ?? "selected:0";
  return {
    track_ref: trackRef,
    item_ref: itemRef,
    report: {
      track_ref_env: TRACK_REF_ENV,
      item_ref_env: ITEM_REF_ENV,
      track_ref: trackRef,
      item_ref: itemRef,
      applies_to_template_ids: [
        "template.tracks.resolve_track_ref",
        "template.items.resolve_item_ref",
        "template.items.read_item_summary",
      ],
    },
  };
}

function readBFixtureInputs(env) {
  const actionSection = normalizeActionSection(nonEmpty(env[READ_B_ACTION_SECTION_ENV])) ?? "main";
  const actionCommandId = positiveInteger(env[READ_B_ACTION_COMMAND_ID_ENV], 40044);
  const actionToggleCommandId = positiveInteger(env[READ_B_ACTION_TOGGLE_COMMAND_ID_ENV], 40364);
  const namedCommand = nonEmpty(env[READ_B_NAMED_COMMAND_ENV]) ?? "_OPENREAPER_READ_B_NO_SUCH_COMMAND";
  const actionSearchQuery = nonEmpty(env[READ_B_ACTION_SEARCH_QUERY_ENV]) ?? "marker";
  const actionSearchLimit = Math.min(
    positiveInteger(env[READ_B_ACTION_SEARCH_LIMIT_ENV], READ_B_ACTION_SEARCH_DEFAULT_LIMIT),
    READ_B_ACTION_SEARCH_MAX_LIMIT,
  );
  const markerActionText = nonEmpty(env[READ_B_MARKER_ACTION_TEXT_ENV]) ?? "!40044 !40364";
  const midiTakeRef = normalizeTakeFixtureRef(nonEmpty(env[READ_B_MIDI_TAKE_REF_ENV])) ?? "selected:0";
  const audioTakeRef = normalizeTakeFixtureRef(nonEmpty(env[READ_B_AUDIO_TAKE_REF_ENV])) ?? "take:index:0";
  const mediaPath = nonEmpty(env[READ_B_MEDIA_PATH_ENV]) ?? "/Users/Shared/OpenReaper/read-b-fixture/read-b-tone.wav";
  return {
    action_section: actionSection,
    action_command_id: actionCommandId,
    action_toggle_command_id: actionToggleCommandId,
    named_command: namedCommand,
    action_search_query: actionSearchQuery,
    action_search_limit: actionSearchLimit,
    marker_action_text: markerActionText,
    midi_take_ref: midiTakeRef,
    audio_take_ref: audioTakeRef,
    media_path: mediaPath,
    report: {
      action_section_env: READ_B_ACTION_SECTION_ENV,
      action_command_id_env: READ_B_ACTION_COMMAND_ID_ENV,
      action_toggle_command_id_env: READ_B_ACTION_TOGGLE_COMMAND_ID_ENV,
      named_command_env: READ_B_NAMED_COMMAND_ENV,
      action_search_query_env: READ_B_ACTION_SEARCH_QUERY_ENV,
      action_search_limit_env: READ_B_ACTION_SEARCH_LIMIT_ENV,
      marker_action_text_env: READ_B_MARKER_ACTION_TEXT_ENV,
      midi_take_ref_env: READ_B_MIDI_TAKE_REF_ENV,
      audio_take_ref_env: READ_B_AUDIO_TAKE_REF_ENV,
      media_path_env: READ_B_MEDIA_PATH_ENV,
      action_section: actionSection,
      action_command_id: actionCommandId,
      action_toggle_command_id: actionToggleCommandId,
      named_command: namedCommand,
      action_search_query: actionSearchQuery,
      action_search_limit: actionSearchLimit,
      marker_action_text: markerActionText,
      midi_take_ref: midiTakeRef,
      audio_take_ref: audioTakeRef,
      media_path: boundedString(mediaPath, 240),
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
    },
  };
}

function firstRealA1FixtureInputs(env) {
  const itemRef = normalizeItemFixtureRef(nonEmpty(env[FIRST_REAL_A1_ITEM_REF_ENV])) ?? "selected:0";
  const projectRef = normalizeProjectFixtureRef(nonEmpty(env[FIRST_REAL_A1_PROJECT_REF_ENV]));
  const artifactRoot = nonEmpty(env[FIRST_REAL_A1_ARTIFACT_ROOT_ENV]);
  return {
    item_ref: itemRef,
    project_ref: projectRef,
    artifact_root: artifactRoot,
    report: {
      item_ref_env: FIRST_REAL_A1_ITEM_REF_ENV,
      project_ref_env: FIRST_REAL_A1_PROJECT_REF_ENV,
      artifact_root_env: FIRST_REAL_A1_ARTIFACT_ROOT_ENV,
      item_ref: itemRef,
      project_ref: projectRef,
      artifact_root: boundedString(artifactRoot, 240),
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
    },
  };
}

function firstRealA2FixtureInputs(env) {
  const regionRef = normalizeRegionFixtureRef(nonEmpty(env[FIRST_REAL_A2_REGION_REF_ENV])) ?? "region:index:0";
  const projectRef = normalizeProjectFixtureRef(nonEmpty(env[FIRST_REAL_A2_PROJECT_REF_ENV]));
  const artifactRoot = nonEmpty(env[FIRST_REAL_A2_ARTIFACT_ROOT_ENV]);
  const renderRoot = nonEmpty(env[FIRST_REAL_A2_RENDER_ROOT_ENV]);
  return {
    region_ref: regionRef,
    project_ref: projectRef,
    artifact_root: artifactRoot,
    render_root: renderRoot,
    report: {
      region_ref_env: FIRST_REAL_A2_REGION_REF_ENV,
      project_ref_env: FIRST_REAL_A2_PROJECT_REF_ENV,
      artifact_root_env: FIRST_REAL_A2_ARTIFACT_ROOT_ENV,
      render_root_env: FIRST_REAL_A2_RENDER_ROOT_ENV,
      region_ref: regionRef,
      project_ref: projectRef,
      artifact_root: boundedString(artifactRoot, 240),
      render_root: boundedString(renderRoot, 240),
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
    },
  };
}

function firstRealA3FixtureInputs(env) {
  const artifactRoot = nonEmpty(env[FIRST_REAL_A3_ARTIFACT_ROOT_ENV]);
  const layerEvidenceRef = nonEmpty(env[FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV]);
  return {
    artifact_root: artifactRoot,
    layer_evidence_ref: layerEvidenceRef,
    report: {
      artifact_root_env: FIRST_REAL_A3_ARTIFACT_ROOT_ENV,
      layer_evidence_ref_env: FIRST_REAL_A3_LAYER_EVIDENCE_REF_ENV,
      artifact_root: boundedString(artifactRoot, 240),
      layer_evidence_ref: boundedString(layerEvidenceRef, 240),
      applies_to_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
    },
  };
}

function itemObjectRefFromFixture(itemRef) {
  const parsed = parseItemFixtureRef(itemRef) ?? parseItemFixtureRef("selected:0");
  return createObjectRef("item", parsed.identity, { ref: parsed.ref });
}

function trackObjectRefFromFixture(trackRef) {
  const parsed = parseTrackFixtureRef(trackRef);
  return parsed ? createObjectRef("track", parsed.identity, { ref: parsed.ref }) : null;
}

function regionObjectRefFromFixture(regionRef) {
  const parsed = parseRegionFixtureRef(regionRef) ?? parseRegionFixtureRef("region:index:0");
  return createObjectRef("region", parsed.identity, { ref: parsed.ref });
}

function takeObjectRefFromFixture(takeRef) {
  const parsed = parseTakeFixtureRef(takeRef) ?? parseTakeFixtureRef("selected:0");
  return createObjectRef("take", parsed.identity, { ref: parsed.ref });
}

function fxObjectRefFromFixture(fxRef) {
  const parsed = parseFxFixtureRef(fxRef) ?? parseFxFixtureRef("fx:track:index:0:0");
  return createObjectRef("fx", parsed.identity, { ref: parsed.ref });
}

function sendObjectRefFromFixture(sendRef) {
  const parsed = parseSendFixtureRef(sendRef);
  return parsed ? createObjectRef("send", parsed.identity, { ref: parsed.ref }) : null;
}

function envelopeObjectRefFromFixture(envelopeRef) {
  const parsed = parseEnvelopeFixtureRef(envelopeRef);
  return parsed ? createObjectRef("envelope", parsed.identity, { ref: parsed.ref }) : null;
}

function projectObjectRefFromFixture(projectRef) {
  const normalized = normalizeProjectFixtureRef(projectRef);
  if (!normalized) return null;
  return createObjectRef("project", { scheme: "current", value: "current" }, { ref: normalized });
}

function artifactObjectRef(ref, schema) {
  const parts = parseArtifactRef(ref);
  return createObjectRef("artifact", { scheme: "artifact_ref", value: ref }, {
    ref,
    summary: {
      schema,
      owner_pack: parts.owner_pack,
      scope: parts.scope,
    },
  });
}

function fileObjectRefFromPath(filePath) {
  const value = String(filePath ?? "").trim();
  if (!value) return null;
  return createObjectRef("file", { scheme: "path", value }, { ref: `file:path:${value}` });
}

function mediaKindForPath(filePath) {
  const extension = path.extname(String(filePath ?? "")).slice(1).toLowerCase();
  return MEDIA_EXTENSION_KINDS[extension] ?? null;
}

function normalizeItemFixtureRef(itemRef) {
  return parseItemFixtureRef(itemRef)?.input_ref ?? null;
}

function normalizeTrackFixtureRef(trackRef) {
  return parseTrackFixtureRef(trackRef)?.input_ref ?? null;
}

function normalizeTakeFixtureRef(takeRef) {
  return parseTakeFixtureRef(takeRef)?.input_ref ?? null;
}

function normalizeFxFixtureRef(fxRef) {
  return parseFxFixtureRef(fxRef)?.input_ref ?? null;
}

function normalizeSendFixtureRef(sendRef) {
  return parseSendFixtureRef(sendRef)?.input_ref ?? null;
}

function normalizeEnvelopeFixtureRef(envelopeRef) {
  return parseEnvelopeFixtureRef(envelopeRef)?.input_ref ?? null;
}

function normalizeRegionFixtureRef(regionRef) {
  return parseRegionFixtureRef(regionRef)?.input_ref ?? null;
}

function parseItemFixtureRef(itemRef) {
  const token = String(itemRef ?? "").trim();
  for (const scheme of ["selected", "index", "guid"]) {
    const prefix = `${scheme}:`;
    const typedPrefix = `item:${scheme}:`;
    if (token.startsWith(typedPrefix)) {
      const value = token.slice(typedPrefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: token };
    }
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: `item:${scheme}:${value}` };
    }
  }
  return null;
}

function parseTrackFixtureRef(trackRef) {
  const token = String(trackRef ?? "").trim();
  for (const scheme of ["selected", "index", "guid", "name"]) {
    const prefix = `${scheme}:`;
    const typedPrefix = `track:${scheme}:`;
    if (token.startsWith(typedPrefix)) {
      const value = token.slice(typedPrefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: token };
    }
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: `track:${scheme}:${value}` };
    }
  }
  const namedTrack = token.match(/^track:(.+)$/);
  if (namedTrack?.[1]) {
    return {
      input_ref: token,
      identity: { scheme: "name", value: namedTrack[1] },
      ref: `track:name:${namedTrack[1]}`,
    };
  }
  return null;
}

function parseRegionFixtureRef(regionRef) {
  const token = String(regionRef ?? "").trim();
  for (const scheme of ["index", "name", "guid"]) {
    const prefix = `${scheme}:`;
    const typedPrefix = `region:${scheme}:`;
    if (token.startsWith(typedPrefix)) {
      const value = token.slice(typedPrefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: token };
    }
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: `region:${scheme}:${value}` };
    }
  }
  return null;
}

function parseTakeFixtureRef(takeRef) {
  const token = String(takeRef ?? "").trim();
  for (const scheme of ["selected", "index", "guid"]) {
    const prefix = `${scheme}:`;
    const typedPrefix = `take:${scheme}:`;
    if (token.startsWith(typedPrefix)) {
      const value = token.slice(typedPrefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: token };
    }
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value) return { input_ref: token, identity: { scheme, value }, ref: `take:${scheme}:${value}` };
    }
  }
  return null;
}

function parseFxFixtureRef(fxRef) {
  const token = String(fxRef ?? "").trim();
  const typedTrack = token.match(/^fx:(track:[^:]+:.+):(\d+)$/);
  if (typedTrack?.[1] && typedTrack?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: "track_fx", value: `${typedTrack[1]}:${typedTrack[2]}` },
      ref: token,
    };
  }
  const typedTake = token.match(/^fx:(take:[^:]+:.+):(\d+)$/);
  if (typedTake?.[1] && typedTake?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: "take_fx", value: `${typedTake[1]}:${typedTake[2]}` },
      ref: token,
    };
  }
  const compactTrack = token.match(/^(track:[^:]+:.+):(\d+)$/);
  if (compactTrack?.[1] && compactTrack?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: "track_fx", value: `${compactTrack[1]}:${compactTrack[2]}` },
      ref: `fx:${compactTrack[1]}:${compactTrack[2]}`,
    };
  }
  const compactTake = token.match(/^(take:[^:]+:.+):(\d+)$/);
  if (compactTake?.[1] && compactTake?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: "take_fx", value: `${compactTake[1]}:${compactTake[2]}` },
      ref: `fx:${compactTake[1]}:${compactTake[2]}`,
    };
  }
  return null;
}

function parseSendFixtureRef(sendRef) {
  const token = String(sendRef ?? "").trim();
  const typed = token.match(/^send:([a-z][a-z0-9_]*):(.+)$/);
  if (typed?.[1] && typed?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: typed[1], value: typed[2] },
      ref: token,
    };
  }
  const compact = token.match(/^(track|receive|guid|index):(.+)$/);
  if (compact?.[1] && compact?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: compact[1], value: compact[2] },
      ref: `send:${compact[1]}:${compact[2]}`,
    };
  }
  return null;
}

function parseEnvelopeFixtureRef(envelopeRef) {
  const token = String(envelopeRef ?? "").trim();
  const typed = token.match(/^envelope:([a-z][a-z0-9_]*):(.+)$/);
  if (typed?.[1] && typed?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: typed[1], value: typed[2] },
      ref: token,
    };
  }
  const compact = token.match(/^(track|take|send|guid):(.+)$/);
  if (compact?.[1] && compact?.[2]) {
    return {
      input_ref: token,
      identity: { scheme: compact[1], value: compact[2] },
      ref: `envelope:${compact[1]}:${compact[2]}`,
    };
  }
  return null;
}

function normalizeProjectFixtureRef(projectRef) {
  const token = String(projectRef ?? "").trim();
  if (token === "" || token === "current" || token === "project:current") return token ? "project:current" : null;
  return null;
}

function normalizeActionSection(value) {
  if (["main", "midi_editor", "midi_event_list", "media_explorer", "crossfade_editor"].includes(value)) {
    return value;
  }
  return null;
}

function liveContextBase() {
  return {
    session_id: nonEmpty(process.env[SESSION_ENV]) ?? `openreaper-live-smoke-${process.pid}`,
    expected_owner: nonEmpty(process.env[OWNER_ENV]) ?? "openreaper-live-smoke",
    expected_generation: positiveInteger(process.env[GENERATION_ENV], 1),
  };
}

function contextSummary(contextBase) {
  return {
    session_id: contextBase.session_id,
    expected_owner: contextBase.expected_owner,
    expected_generation: contextBase.expected_generation,
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
    summary: compactSummary(result.summary),
    artifact_refs: Array.isArray(result.artifacts)
      ? result.artifacts.map((artifact) => artifact.ref).filter(Boolean)
      : [],
    last_result_updated: Boolean(lastResult.updated),
    budget: {
      response_bytes: response?.budget?.response_bytes ?? null,
      bridge_response_bytes: response?.budget?.bridge_response_bytes ?? null,
      truncated: Boolean(response?.budget?.truncated),
    },
  };
}

function compactRuntimeEvidence(evidence) {
  const entries = Array.isArray(evidence) ? evidence : [];
  const last = entries.at(-1);
  return {
    contract: "template.runtime.evidence.compact.v1",
    count: entries.length,
    ok_count: entries.filter((entry) => entry?.ok === true).length,
    error_codes: entries
      .filter((entry) => entry?.ok !== true)
      .map((entry) => entry?.error?.code)
      .filter(Boolean)
      .slice(0, 8),
    last: last
      ? {
          template: last.template,
          ok: last.ok,
          error: last.error,
          request_id: last.request_id,
          counts: last.counts,
          last_result_updated: last.last_result_updated,
          live: {
            opted_in: last.live?.opted_in,
            executor_configured: last.live?.executor_configured,
            opt_in_env: last.live?.opt_in_env,
            opt_in_flag: last.live?.opt_in_flag,
            spawned_reaper: last.live?.spawned_reaper,
          },
        }
      : null,
  };
}

function producedArtifactRef(response) {
  const artifacts = response?.result?.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  const ref = artifacts[0]?.ref;
  return typeof ref === "string" ? ref : null;
}

function producedArtifactRefsBySchema(response) {
  const artifacts = response?.result?.artifacts;
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((artifact) => [artifact?.summary?.schema, artifact?.ref])
    .filter(([schema, ref]) => typeof schema === "string" && typeof ref === "string");
}

function producedJobRef(response) {
  const jobs = response?.result?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  return jobs[0] ?? null;
}

function producedRefsByKind(response) {
  const refs = response?.result?.refs;
  if (!Array.isArray(refs)) return {};
  const byKind = {};
  for (const ref of refs) {
    if (ref?.kind && !byKind[ref.kind]) byKind[ref.kind] = ref;
  }
  return byKind;
}

function producedRefsByKindAll(response) {
  const refs = response?.result?.refs;
  if (!Array.isArray(refs)) return {};
  const byKind = {};
  for (const ref of refs) {
    if (!ref?.kind) continue;
    byKind[ref.kind] ??= [];
    byKind[ref.kind].push(ref);
  }
  return byKind;
}

async function dispatchFakeSafeWriteA(request) {
  const spec = SAFE_WRITE_A_SPEC_BY_CAPABILITY.get(request?.pack?.capability);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake Safe-Write-A executor accepts only the approved 24 capabilities.", {
      capability: boundedString(request?.pack?.capability, 120),
    });
  }
  if (request?.operation?.family !== "run_command" || request?.operation?.name !== "template.execute") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "Safe-Write-A requests must use run_command:template.execute.", {
      family: boundedString(request?.operation?.family, 80),
      name: boundedString(request?.operation?.name, 120),
    });
  }
  if (request?.pack?.id !== spec.pack || request?.pack?.risk !== spec.risk) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "Safe-Write-A pack/risk/capability mismatch.", {
      expected_pack: spec.pack,
      expected_risk: spec.risk,
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.artifacts?.allow !== false) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "Safe-Write-A forbids artifact writes; artifacts.allow must be false.", {
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  if (request?.undo?.mode !== "required") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "Safe-Write-A write/safe rows require undo.mode required.", {
      undo_mode: request?.undo?.mode,
    });
  }

  const refs = fakeSafeWriteARefs(request, spec);
  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: spec.risk,
      readback_status: "passed",
      undo_evidence: "required",
      idempotency_evidence: spec.idempotent ? "keyed_single_row" : "create_or_insert_undo_only",
      artifacts_allowed: false,
      bounded: true,
      smoke_only: true,
    },
    refs,
  });
}

function fakeSafeWriteARefs(request, spec) {
  if (spec.capability === "project.set_metadata_field") {
    return [createObjectRef("project", { scheme: "current", value: "current" }, { ref: "project:current" })];
  }
  if (spec.capability === "project.create_marker") {
    return [createObjectRef("marker", { scheme: "index", value: "1" }, {
      ref: "marker:index:1",
      display: { name: request.params.name ?? "OR_SAFE_WRITE_A_MARKER" },
    })];
  }
  if (spec.capability === "project.create_region") {
    return [createObjectRef("region", { scheme: "index", value: "1" }, {
      ref: "region:index:1",
      display: { name: request.params.name ?? "OR_SAFE_WRITE_A_REGION" },
    })];
  }
  if (spec.capability === "track.create") {
    return [createObjectRef("track", { scheme: "guid", value: "{SAFE-WRITE-A-TRACK}" }, {
      ref: "track:guid:{SAFE-WRITE-A-TRACK}",
      display: { name: request.params.name ?? "OR_SAFE_WRITE_A_TARGET" },
    })];
  }
  if (spec.ref_group === "created_track") {
    return request.refs.filter((ref) => ref.kind === "track").slice(0, 1);
  }
  if (spec.ref_group === "anchor_item") {
    return request.refs.filter((ref) => ref.kind === "item").slice(0, 1);
  }
  if (spec.capability === "midi.create_midi_item") {
    return [
      createObjectRef("item", { scheme: "guid", value: "{SAFE-WRITE-A-MIDI-ITEM}" }, {
        ref: "item:guid:{SAFE-WRITE-A-MIDI-ITEM}",
      }),
      createObjectRef("take", { scheme: "guid", value: "{SAFE-WRITE-A-MIDI-TAKE}" }, {
        ref: "take:guid:{SAFE-WRITE-A-MIDI-TAKE}",
      }),
    ];
  }
  if (spec.ref_group === "created_midi_take") {
    return request.refs.filter((ref) => ref.kind === "take").slice(0, 1);
  }
  return [];
}

async function dispatchFakeE3MediaRoute(request) {
  const spec = request?.operation?.family === "query_state"
    ? E3_MEDIA_ROUTE_SPEC_BY_ID.get("template.media.list_folder_media_files")
    : E3_MEDIA_ROUTE_SPEC_BY_CAPABILITY.get(request?.pack?.capability);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake E3 media route executor accepts only the approved media route capabilities.", {
      capability: boundedString(request?.pack?.capability, 120),
      operation: `${boundedString(request?.operation?.family, 80)}:${boundedString(request?.operation?.name, 120)}`,
    });
  }
  if (`${request?.operation?.family}:${request?.operation?.name}` !== spec.operation) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E3 media route request operation does not match the route spec.", {
      expected_operation: spec.operation,
      family: boundedString(request?.operation?.family, 80),
      name: boundedString(request?.operation?.name, 120),
    });
  }
  if (request?.pack?.id !== spec.pack || request?.pack?.risk !== spec.risk) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E3 media route pack/risk mismatch.", {
      expected_pack: spec.pack,
      expected_risk: spec.risk,
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.artifacts?.allow !== false) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E3 media route forbids artifact writes; artifacts.allow must be false.", {
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  if (spec.risk === "write" && request?.undo?.mode !== "required") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E3 media route write rows require undo.mode required.", {
      undo_mode: request?.undo?.mode,
    });
  }
  if (spec.risk === "read" && request?.undo?.mode !== "none") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E3 media route read rows require undo.mode none.", {
      undo_mode: request?.undo?.mode,
    });
  }

  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: spec.risk,
      readback_status: "passed",
      typed_blockers: [
        "folder_root_absent",
        "media_source_unsupported",
        "media_source_absent",
        "relink_target_type_mismatch",
      ],
      artifacts_allowed: false,
      bounded: true,
      smoke_only: true,
    },
    refs: fakeE3MediaRouteRefs(request, spec),
  });
}

function fakeE3MediaRouteRefs(request, spec) {
  if (spec.id === "template.media.list_folder_media_files") {
    return [
      createObjectRef("file", { scheme: "path", value: "fixture-source.wav" }, { ref: "file:path:fixture-source.wav" }),
      createObjectRef("file", { scheme: "path", value: "fixture-relink.wav" }, { ref: "file:path:fixture-relink.wav" }),
    ];
  }
  if (spec.id === "template.media.import_file_to_track") {
    return [
      createObjectRef("item", { scheme: "guid", value: "{E3-MEDIA-IMPORT-ITEM}" }, { ref: "item:guid:{E3-MEDIA-IMPORT-ITEM}" }),
      ...request.refs.filter((ref) => ref.kind === "file").slice(0, 1),
    ];
  }
  if (spec.id === "template.media.import_file_section_to_track") {
    return [
      createObjectRef("item", { scheme: "guid", value: "{E3-MEDIA-SECTION-ITEM}" }, { ref: "item:guid:{E3-MEDIA-SECTION-ITEM}" }),
      ...request.refs.filter((ref) => ref.kind === "file").slice(0, 1),
    ];
  }
  if (spec.id === "template.media.relink_take_source") {
    return [
      ...request.refs.filter((ref) => ref.kind === "take").slice(0, 1),
      ...request.refs.filter((ref) => ref.kind === "file").slice(0, 1),
    ];
  }
  return [];
}

async function dispatchFakeE4ItemRoute(request) {
  const spec = E4_ITEM_ROUTE_SPEC_BY_CAPABILITY.get(request?.pack?.capability);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake E4 item route executor accepts only the approved item route capabilities.", {
      capability: boundedString(request?.pack?.capability, 120),
    });
  }
  if (request?.operation?.family !== "run_command" || request?.operation?.name !== "template.execute") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E4 item route requests must use run_command:template.execute.", {
      family: boundedString(request?.operation?.family, 80),
      name: boundedString(request?.operation?.name, 120),
    });
  }
  if (request?.pack?.id !== spec.pack || request?.pack?.risk !== spec.risk) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E4 item route pack/risk mismatch.", {
      expected_pack: spec.pack,
      expected_risk: spec.risk,
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.artifacts?.allow !== false) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E4 item route forbids artifact writes; artifacts.allow must be false.", {
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  if (request?.undo?.mode !== "required") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E4 item route write rows require undo.mode required.", {
      undo_mode: request?.undo?.mode,
    });
  }

  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: spec.risk,
      readback_status: "passed",
      typed_blockers: [
        "selected_item_missing",
        "invalid_item_ref",
        "destination_track_missing",
        "split_outside_item_bounds",
        "invalid_playrate",
      ],
      artifacts_allowed: false,
      loop_source_status: "held",
      bounded: true,
      smoke_only: true,
    },
    refs: fakeE4ItemRouteRefs(request, spec),
  });
}

function fakeE4ItemRouteRefs(request, spec) {
  if (spec.id === "template.items.copy_item_to_track") {
    return [
      createObjectRef("item", { scheme: "guid", value: "{E4-ITEM-COPY}" }, { ref: "item:guid:{E4-ITEM-COPY}" }),
      ...request.refs.filter((ref) => ref.kind === "item").slice(0, 1),
      ...request.refs.filter((ref) => ref.kind === "track").slice(0, 1),
    ];
  }
  if (spec.id === "template.items.split_item_at_time") {
    return [
      createObjectRef("item", { scheme: "guid", value: "{E4-ITEM-SPLIT-LEFT}" }, { ref: "item:guid:{E4-ITEM-SPLIT-LEFT}" }),
      createObjectRef("item", { scheme: "guid", value: "{E4-ITEM-SPLIT-RIGHT}" }, { ref: "item:guid:{E4-ITEM-SPLIT-RIGHT}" }),
    ];
  }
  if (spec.id === "template.items.set_take_playrate") {
    return request.refs.filter((ref) => ref.kind === "item").slice(0, 1);
  }
  return [];
}

async function dispatchFakeE2FxB1Route(request) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = key === "run_command:template.execute"
    ? E2_FX_B1_ROUTE_SPEC_BY_CAPABILITY.get(request?.pack?.capability)
    : E2_FX_B1_ROUTE_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake E2 FX-B1 executor accepts only the approved FX-B1 route capabilities.", {
      capability: boundedString(request?.pack?.capability, 120),
      operation: boundedString(key, 160),
    });
  }
  if (key !== spec.operation) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-B1 request operation does not match the route spec.", {
      expected_operation: spec.operation,
      operation: boundedString(key, 160),
    });
  }
  if (request?.pack?.id !== spec.pack || request?.pack?.risk !== spec.risk) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-B1 pack/risk mismatch.", {
      expected_pack: spec.pack,
      expected_risk: spec.risk,
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  const expectedArtifactsAllow = spec.artifact === true;
  if (request?.artifacts?.allow !== expectedArtifactsAllow) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-B1 artifact policy mismatch.", {
      expected_artifacts_allow: expectedArtifactsAllow,
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  if (spec.risk === "write" && request?.undo?.mode !== "required") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-B1 write rows require undo.mode required.", {
      undo_mode: request?.undo?.mode,
    });
  }
  if (spec.risk === "read" && request?.undo?.mode !== "none") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-B1 read rows require undo.mode none.", {
      undo_mode: request?.undo?.mode,
    });
  }

  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: spec.risk,
      phase: spec.phase,
      readback_status: "passed",
      typed_blockers: [
        "fx_track_ref_missing",
        "fx_take_ref_missing",
        "fx_ref_missing",
        "fx_plugin_name_missing",
        "fx_parameter_invalid",
        "fx_preset_fixture_missing",
        "video_processor_fixture_missing",
      ],
      artifacts_allowed: expectedArtifactsAllow,
      bounded: true,
      smoke_only: true,
    },
    refs: fakeE2FxB1RouteRefs(request, spec),
    artifacts: fakeE2FxB1RouteArtifacts(request, spec),
  });
}

async function dispatchFakeE2FxL1ReadRoute(request) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = E2_FX_L1_READ_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake E2 FX-L1 read executor accepts only the approved FX read route operations.", {
      operation: boundedString(key, 160),
    });
  }
  if (request?.pack?.id !== spec.pack || request?.pack?.risk !== "read") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-L1 read pack/risk mismatch.", {
      expected_pack: spec.pack,
      expected_risk: "read",
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.artifacts?.allow !== false) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-L1 read route forbids artifact writes; artifacts.allow must be false.", {
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  if (request?.undo?.mode !== "none") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E2 FX-L1 read rows require undo.mode none.", {
      undo_mode: request?.undo?.mode,
    });
  }

  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: "read",
      phase: spec.phase,
      readback_status: "passed",
      typed_blockers: [
        "fx_track_ref_missing",
        "fx_take_ref_missing",
        "fx_ref_missing",
        "fx_parameter_invalid",
      ],
      artifacts_allowed: false,
      write_fx_status: "held",
      preset_status: "held",
      video_processor_status: "held",
      bounded: true,
      smoke_only: true,
    },
    refs: fakeE2FxB1RouteRefs(request, spec),
  });
}

function fakeE2FxB1RouteRefs(request, spec) {
  if (spec.id === "template.fx.resolve_fx_ref") {
    return [scopedFxObjectRefFromRequest(request, "track", 0)];
  }
  if (spec.id === "template.fx.list_track_fx_chain") {
    return [
      scopedFxObjectRefFromRequest(request, "track", 0),
      scopedFxObjectRefFromRequest(request, "track", 1),
    ];
  }
  if (spec.id === "template.fx.list_take_fx_chain") {
    return [scopedFxObjectRefFromRequest(request, "take", 0)];
  }
  if (spec.id === "template.fx.add_track_fx") {
    return [
      createObjectRef("fx", { scheme: "track", value: "added" }, {
        ref: "fx:track:added",
        display: { name: request.params.plugin_name ?? "ReaEQ (Cockos)" },
      }),
    ];
  }
  if (spec.id === "template.fx.add_take_fx") {
    return [
      createObjectRef("fx", { scheme: "take", value: "added" }, {
        ref: "fx:take:added",
        display: { name: request.params.plugin_name ?? "ReaEQ (Cockos)" },
      }),
    ];
  }
  if (spec.id === "template.fx.read_video_processor_code") {
    return request.refs.filter((ref) => ref.kind === "fx").slice(0, 1);
  }
  return request.refs.filter((ref) => ref.kind === "fx").slice(0, 1);
}

function scopedFxObjectRefFromRequest(request, ownerKind, slotIndex) {
  const owner = Array.isArray(request.refs)
    ? request.refs.find((ref) => ref.kind === ownerKind)
    : null;
  const ownerRef = owner?.ref ?? `${ownerKind}:guid:{E2-FX-${ownerKind.toUpperCase()}}`;
  return createObjectRef("fx", {
    scheme: `${ownerKind}_fx`,
    value: `${ownerRef}:${slotIndex}`,
  }, {
    ref: `fx:${ownerRef}:${slotIndex}`,
    display: { owner_ref: ownerRef, slot_index: slotIndex },
  });
}

function fakeE2FxB1RouteArtifacts(request, spec) {
  if (spec.id !== "template.fx.read_video_processor_code") return [];
  const ref = formatArtifactRef({
    owner_pack: "fx",
    scope: "video_processor_code",
    id: "art_20260704000000000_014_abc123",
  });
  return [artifactObjectRef(ref, "fx.video_processor_code.v1")];
}

async function dispatchFakeE5RoutingAutomationRoute(request) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = key === "run_command:template.execute"
    ? E5_ROUTING_AUTOMATION_ROUTE_SPEC_BY_CAPABILITY.get(request?.pack?.capability)
    : E5_ROUTING_AUTOMATION_ROUTE_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake E5 routing/automation executor accepts only the approved route capabilities.", {
      capability: boundedString(request?.pack?.capability, 120),
      operation: boundedString(key, 160),
    });
  }
  if (key !== spec.operation) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5 routing/automation request operation does not match the route spec.", {
      expected_operation: spec.operation,
      operation: boundedString(key, 160),
    });
  }
  if (request?.pack?.id !== spec.pack || request?.pack?.risk !== spec.risk) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5 routing/automation pack/risk mismatch.", {
      expected_pack: spec.pack,
      expected_risk: spec.risk,
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.artifacts?.allow !== false) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5 routing/automation route forbids artifact writes; artifacts.allow must be false.", {
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  if (spec.risk === "write" && request?.undo?.mode !== "required") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5 routing/automation write rows require undo.mode required.", {
      undo_mode: request?.undo?.mode,
    });
  }
  if (spec.risk === "read" && request?.undo?.mode !== "none") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5 routing/automation read rows require undo.mode none.", {
      undo_mode: request?.undo?.mode,
    });
  }

  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: spec.risk,
      phase: spec.phase,
      readback_status: "passed",
      typed_blockers: [
        "e5_track_ref_missing",
        "e5_destination_track_ref_missing",
        "e5_send_ref_missing",
        "e5_fx_ref_missing",
        "e5_envelope_ref_missing",
        "e5_send_value_invalid",
        "e5_automation_point_value_invalid",
      ],
      artifacts_allowed: false,
      bounded: true,
      smoke_only: true,
    },
    refs: fakeE5RoutingAutomationRouteRefs(request, spec),
  });
}

async function dispatchFakeE5RoutingReadRoute(request) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = E5_R1_ROUTING_READ_TEMPLATE_SPECS.find((candidate) => candidate.operation === key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake E5-R1 routing read executor accepts only the approved routing read operations.", {
      operation: boundedString(key, 160),
    });
  }
  if (request?.pack?.id !== "routing" || request?.pack?.risk !== "read") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5-R1 routing read pack/risk mismatch.", {
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.undo?.mode !== "none") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5-R1 routing read rows require undo.mode none.", {
      undo_mode: request?.undo?.mode,
    });
  }
  if (request?.artifacts?.allow !== false) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "E5-R1 routing read forbids artifact writes; artifacts.allow must be false.", {
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: spec.risk,
      phase: spec.phase,
      readback_status: "passed",
      typed_blockers: [
        "e5_track_ref_missing",
        "e5_send_ref_missing",
      ],
      artifacts_allowed: false,
      bounded: true,
      smoke_only: true,
    },
    refs: fakeE5RoutingAutomationRouteRefs(request, spec),
  });
}

function fakeE5RoutingAutomationRouteRefs(request, spec) {
  if (spec.capability === "routing.send.create") {
    return [
      createObjectRef("send", { scheme: "track", value: "created:0" }, { ref: "send:track:created:0" }),
      ...request.refs.filter((ref) => ref.kind === "track").slice(0, 2),
    ];
  }
  if (spec.pack === "routing" && spec.ref_group === "none") {
    return [
      createObjectRef("track", { scheme: "index", value: "0" }, { ref: "track:index:0" }),
      createObjectRef("send", { scheme: "track", value: "0:0" }, { ref: "send:track:0:0" }),
    ];
  }
  if (spec.pack === "routing" && spec.ref_group === "track") {
    return request.refs.filter((ref) => ref.kind === "track").slice(0, 1);
  }
  if (spec.pack === "routing" && spec.ref_group === "send_locator") {
    return [createObjectRef("send", { scheme: "track", value: "0:0" }, { ref: "send:track:0:0" })];
  }
  if (spec.pack === "routing") {
    return request.refs.filter((ref) => ["send", "track", "fx"].includes(ref.kind)).slice(0, 2);
  }
  if (spec.capability === "automation.resolve_envelope_ref" || spec.capability === "automation.resolve_send_envelope") {
    return [
      createObjectRef("envelope", { scheme: "track", value: "volume" }, { ref: "envelope:track:volume" }),
      ...request.refs.filter((ref) => ["track", "take", "send"].includes(ref.kind)).slice(0, 1),
    ];
  }
  if (spec.ref_group === "track") {
    return request.refs.filter((ref) => ref.kind === "track").slice(0, 1);
  }
  if (spec.ref_group === "send") {
    return request.refs.filter((ref) => ref.kind === "send").slice(0, 1);
  }
  return request.refs.filter((ref) => ref.kind === "envelope").slice(0, 1);
}

async function dispatchFakeD6ProjectTempoRoute(request) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = key === "run_command:template.execute"
    ? D6_PROJECT_TEMPO_SPEC_BY_CAPABILITY.get(request?.pack?.capability)
    : null;
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake D6 project tempo executor accepts only the approved tempo write capabilities.", {
      capability: boundedString(request?.pack?.capability, 120),
      operation: boundedString(key, 160),
    });
  }
  if (request?.pack?.id !== "project" || request?.pack?.risk !== "write") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "D6 project tempo pack/risk mismatch.", {
      actual_pack: request?.pack?.id,
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.undo?.mode !== "required") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "D6 project tempo writes require undo.mode required.", {
      undo_mode: request?.undo?.mode,
    });
  }
  if (request?.artifacts?.allow !== false) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "D6 project tempo writes forbid artifact writes; artifacts.allow must be false.", {
      artifacts_allow: request?.artifacts?.allow,
    });
  }
  return bridgeOkEnvelope(request, {
    summary: {
      capability: spec.capability,
      pack: spec.pack,
      risk: spec.risk,
      phase: spec.phase,
      project_ref: "project:current",
      bpm: request?.params?.bpm ?? 120,
      division: request?.params?.division ?? null,
      enabled: request?.params?.enabled ?? null,
      position_seconds: request?.params?.position_seconds ?? null,
      updated: true,
      readback_status: "passed",
      artifacts_allowed: false,
      bounded: true,
      smoke_only: true,
    },
    refs: [createObjectRef("project", { scheme: "current", value: "current" }, { ref: "project:current" })],
  });
}

async function dispatchFakeFirstRealA1(request, { artifactRoot }) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = FIRST_REAL_A1_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake A1 executor accepts only First-Real-Fixture-A A1 operations.", {
      operation: boundedString(key),
    });
  }
  if (request?.artifacts?.allow !== true) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "First-Real-Fixture-A A1 artifact operations require artifacts.allow true.", {
      operation: key,
    });
  }

  let artifactRef;
  try {
    const artifactId = artifactIdFromCommandId(request.id);
    artifactRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.scope,
      id: artifactId,
    });
    const summary = fakeA1Summary(spec, artifactRef, request);
    const payload = fakeA1Payload(spec, request);
    const envelope = createArtifactStateStoreEnvelope({
      ref: artifactRef,
      schema: spec.schema,
      producer: {
        kind: "template",
        id: spec.id,
        pack: spec.owner_pack,
      },
      created_at: request.created_at,
      summary,
      payload,
    });
    await writeArtifactStateStoreEnvelope({ artifactRoot, envelope });
    return bridgeOkEnvelope(request, {
      summary,
      artifacts: [artifactObjectRef(artifactRef, spec.schema)],
    });
  } catch (error) {
    return bridgeErrorEnvelope(request, "ARTIFACT_INVALID", "Fake A1 executor could not write artifact envelope.", {
      artifact_ref: artifactRef,
      message: boundedString(error?.message),
    });
  }
}

async function dispatchFakeFirstRealA2(request, { artifactRoot, renderRoot }) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = FIRST_REAL_A2_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake A2 executor accepts only First-Real-Fixture-A A2 operations.", {
      operation: boundedString(key),
    });
  }
  if (request?.artifacts?.allow !== true) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "First-Real-Fixture-A A2 operations require artifacts.allow true.", {
      operation: key,
    });
  }
  if (key === "run_job:render.region_wav") {
    return dispatchFakeFirstRealA2Render(request, { artifactRoot, renderRoot, spec });
  }
  return dispatchFakeFirstRealA2Delivery(request, { artifactRoot, spec });
}

async function dispatchFakeFirstRealA2Render(request, { artifactRoot, renderRoot, spec }) {
  if (request?.pack?.risk !== "write") {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "A2 render_region_wav must use write risk.", {
      actual_risk: request?.pack?.risk,
    });
  }
  if (request?.params?.output_policy !== "openreaper_managed_render_root") {
    return bridgeErrorEnvelope(request, "PARAMS_INVALID", "A2 render_region_wav requires the managed render root output policy.", {
      output_policy: request?.params?.output_policy,
    });
  }
  if (request?.params?.collision_policy !== "fail_if_exists") {
    return bridgeErrorEnvelope(request, "IDEMPOTENCY_CONFLICT", "Fake A2 render supports only the first-pass fail_if_exists collision policy.", {
      collision_policy: request?.params?.collision_policy,
      blocker: "reuse_idempotent_match_not_supported_in_fake",
    });
  }

  const managed = managedRenderOutputForRequest(request);
  const outputPath = path.resolve(renderRoot, managed.relative_path);
  if (!isPathInside(outputPath, path.resolve(renderRoot))) {
    return bridgeErrorEnvelope(request, "PARAMS_INVALID", "Managed render output escaped the configured render root.", {
      blocker: "managed_render_path_escape",
    });
  }

  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, fakeWavFileBytes(), { flag: "wx" });
    const file = await stat(outputPath);
    const artifactId = artifactIdFromCommandId(request.id);
    const outputRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.output_scope,
      id: artifactId,
    });
    const evidenceRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.evidence_scope,
      id: artifactId,
    });
    const jobRef = createObjectRef("job", { scheme: "job_id", value: `render.region_wav.${artifactId}` });
    const regionRef = request.refs?.find((ref) => ref.kind === "region")?.ref ?? "region:index:0";
    const outputSummary = {
      artifact_ref: outputRef,
      schema: spec.output_schema,
      output_basename: managed.basename,
      managed_relative_path: managed.relative_path,
      file_size_bytes: file.size,
      wav_header: true,
      file_count: 1,
      reused_existing: false,
      truncated: false,
    };
    const evidenceSummary = {
      artifact_ref: evidenceRef,
      schema: spec.evidence_schema,
      job_ref: jobRef.ref,
      output_artifact_ref: outputRef,
      region_ref: regionRef,
      collision_policy: request.params.collision_policy,
      verification_status: "passed",
      truncated: false,
    };
    await writeArtifactStateStoreEnvelope({
      artifactRoot,
      envelope: createArtifactStateStoreEnvelope({
        ref: outputRef,
        schema: spec.output_schema,
        producer: {
          kind: "template",
          id: spec.id,
          pack: spec.owner_pack,
        },
        created_at: request.created_at,
        summary: outputSummary,
        payload: {
          fixture: "first_real_fixture_a2_fake",
          smoke_only: true,
          output: outputSummary,
          region: {
            region_ref: regionRef,
          },
        },
      }),
    });
    await writeArtifactStateStoreEnvelope({
      artifactRoot,
      envelope: createArtifactStateStoreEnvelope({
        ref: evidenceRef,
        schema: spec.evidence_schema,
        producer: {
          kind: "template",
          id: spec.id,
          pack: spec.owner_pack,
        },
        created_at: request.created_at,
        summary: evidenceSummary,
        payload: {
          fixture: "first_real_fixture_a2_fake",
          smoke_only: true,
          render_request: {
            format: request.params.format,
            output_policy: request.params.output_policy,
            collision_policy: request.params.collision_policy,
            sample_rate_hz: request.params.sample_rate_hz ?? null,
            bit_depth: request.params.bit_depth ?? null,
            channel_count: request.params.channel_count ?? null,
          },
          output_artifact_ref: outputRef,
          output_basename: managed.basename,
          managed_relative_path: managed.relative_path,
        },
      }),
    });
    return bridgeOkEnvelope(request, {
      summary: {
        job_ref: jobRef.ref,
        output_artifact_ref: outputRef,
        evidence_artifact_ref: evidenceRef,
        format: "wav",
        output_policy: request.params.output_policy,
        collision_policy: request.params.collision_policy,
        file_count: 1,
        reused_existing: false,
        output_basename: managed.basename,
        managed_relative_path: managed.relative_path,
        file_size_bytes: file.size,
        truncated: false,
      },
      artifacts: [
        artifactObjectRef(outputRef, spec.output_schema),
        artifactObjectRef(evidenceRef, spec.evidence_schema),
      ],
      jobs: [jobRef],
    });
  } catch (error) {
    return bridgeErrorEnvelope(request, error?.code === "EEXIST" ? "IDEMPOTENCY_CONFLICT" : "ARTIFACT_INVALID", "Fake A2 render could not write managed output or artifact evidence.", {
      blocker: error?.code === "EEXIST" ? "render_output_exists" : "a2_render_fake_write_failed",
      output_basename: managed.basename,
      message: boundedString(error?.message),
    });
  }
}

async function dispatchFakeFirstRealA2Delivery(request, { artifactRoot, spec }) {
  const outputRef = artifactRefBySchemaFromRequest(request, "render.region_wav_output.v1");
  const evidenceRef = artifactRefBySchemaFromRequest(request, "render.render_job_evidence.v1");
  if (!outputRef || !evidenceRef) {
    return bridgeErrorEnvelope(request, "ARTIFACT_NOT_FOUND", "A2 delivery report requires render output and job evidence artifact refs.", {
      blocker: "render_evidence_refs_missing",
    });
  }

  try {
    const outputEnvelope = await readArtifactEnvelopeFromRoot(artifactRoot, outputRef);
    const evidenceEnvelope = await readArtifactEnvelopeFromRoot(artifactRoot, evidenceRef);
    assertFakeA2ArtifactProducer(outputEnvelope, "template.render.render_region_wav", "render.region_wav_output.v1");
    assertFakeA2ArtifactProducer(evidenceEnvelope, "template.render.render_region_wav", "render.render_job_evidence.v1");
    const artifactId = artifactIdFromCommandId(request.id);
    const reportRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.scope,
      id: artifactId,
    });
    const outputCount = 1;
    const nonemptyOutputCount = Number(outputEnvelope.summary?.file_size_bytes ?? 0) > 0 ? 1 : 0;
    const issueCount = nonemptyOutputCount === outputCount ? 0 : 1;
    const summary = {
      artifact_ref: reportRef,
      schema: spec.schema,
      output_artifact_count: outputCount,
      job_evidence_count: 1,
      region_count: 1,
      nonempty_output_count: nonemptyOutputCount,
      report_row_count: 1,
      issue_count: issueCount,
      truncated: false,
    };
    await writeArtifactStateStoreEnvelope({
      artifactRoot,
      envelope: createArtifactStateStoreEnvelope({
        ref: reportRef,
        schema: spec.schema,
        producer: {
          kind: "template",
          id: spec.id,
          pack: spec.owner_pack,
        },
        created_at: request.created_at,
        summary,
        payload: {
          fixture: "first_real_fixture_a2_fake",
          smoke_only: true,
          consumed_artifact_refs: [outputRef, evidenceRef],
          rows: [
            {
              row: 1,
              output_basename: outputEnvelope.summary.output_basename,
              file_size_bytes: outputEnvelope.summary.file_size_bytes,
              issue_count: issueCount,
            },
          ],
        },
      }),
    });
    return bridgeOkEnvelope(request, {
      summary,
      artifacts: [artifactObjectRef(reportRef, spec.schema)],
    });
  } catch (error) {
    return bridgeErrorEnvelope(request, "ARTIFACT_INVALID", "Fake A2 delivery report could not read render evidence or write report artifact.", {
      blocker: "a2_delivery_report_fake_write_failed",
      message: boundedString(error?.message),
    });
  }
}

async function dispatchFakeFirstRealA3(request, { artifactRoot }) {
  const key = `${request?.operation?.family}:${request?.operation?.name}`;
  const spec = FIRST_REAL_A3_SPEC_BY_OPERATION.get(key);
  if (!spec) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Fake A3 executor accepts only First-Real-Fixture-A A3 layer report operations.", {
      operation: boundedString(key),
    });
  }
  if (request?.artifacts?.allow !== true) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "First-Real-Fixture-A A3 layer report requires artifacts.allow true.", {
      operation: key,
    });
  }

  const layerEvidenceRef = artifactRefBySchemaFromRequest(request, spec.input_schema);
  if (!layerEvidenceRef) {
    return bridgeErrorEnvelope(request, "ARTIFACT_NOT_FOUND", "A3 layer report requires an items.layer_evidence.v1 artifact ref.", {
      blocker: "layer_evidence_ref_missing",
    });
  }

  try {
    const evidenceEnvelope = normalizeArtifactEnvelope(await readArtifactEnvelopeFromRoot(artifactRoot, layerEvidenceRef));
    assertFakeA3LayerEvidence(evidenceEnvelope);
    const artifactId = artifactIdFromCommandId(request.id);
    const reportRef = formatArtifactRef({
      owner_pack: spec.owner_pack,
      scope: spec.scope,
      id: artifactId,
    });
    const itemCount = layerEvidenceItemCount(evidenceEnvelope);
    const trackCount = layerEvidenceTrackCount(evidenceEnvelope);
    const rowCount = Math.min(positiveInteger(request?.params?.max_report_rows, 24), Math.max(itemCount, trackCount, 1), 24);
    const summary = {
      artifact_ref: reportRef,
      schema: spec.schema,
      evidence_item_count: itemCount,
      evidence_track_count: trackCount,
      report_row_count: rowCount,
      truncated: false,
    };
    await writeArtifactStateStoreEnvelope({
      artifactRoot,
      envelope: createArtifactStateStoreEnvelope({
        ref: reportRef,
        schema: spec.schema,
        producer: {
          kind: "template",
          id: spec.id,
          pack: spec.owner_pack,
        },
        created_at: request.created_at,
        summary,
        payload: {
          fixture: "first_real_fixture_a3_fake",
          smoke_only: true,
          consumed_artifact_refs: [layerEvidenceRef],
          evidence_summary: compactLayerEvidenceSummary(evidenceEnvelope.summary),
          rows: fakeA3ReportRows(evidenceEnvelope, rowCount),
        },
      }),
    });
    return bridgeOkEnvelope(request, {
      summary,
      artifacts: [artifactObjectRef(reportRef, spec.schema)],
    });
  } catch (error) {
    return bridgeErrorEnvelope(request, "ARTIFACT_INVALID", "Fake A3 layer report could not read layer evidence or write report artifact.", {
      blocker: "a3_layer_report_fake_write_failed",
      layer_evidence_ref: boundedString(layerEvidenceRef, 240),
      message: boundedString(error?.message),
    });
  }
}

function fakeA1Summary(spec, artifactRef, request) {
  if (spec.schema === "analysis.loop_candidates.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      candidate_count: 1,
      analyzed_seconds: 4,
      truncated: false,
    };
  }
  if (spec.schema === "analysis.loop_click_risk.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      measured_candidate_count: 1,
      risk_fact_count: 1,
      truncated: false,
    };
  }
  if (spec.schema === "analysis.loop_qa_report.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      candidate_count: 1,
      risk_fact_count: 1,
      report_row_count: 1,
      truncated: false,
    };
  }
  if (spec.schema === "project.project_map_snapshot.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      project_ref: "project:current",
      track_count: 8,
      item_count: 24,
      track_cursor: 0,
      returned_track_count: 8,
      selected_count: 1,
      snapshot_token: `fake-${request.id.slice(-6)}`,
      coverage_status: "complete_page",
      diff_compared: false,
      diff_changed_count: 0,
      truncated: false,
    };
  }
  if (spec.schema === "project.observation_bundle.v1") {
    return {
      artifact_ref: artifactRef,
      schema: spec.schema,
      project_ref: "project:current",
      observed_family_count: 5,
      track_count: 8,
      item_count: 24,
      marker_count: 1,
      region_count: 1,
      tempo_marker_count: 1,
      selected_count: 1,
      track_cursor: 0,
      returned_track_count: 8,
      map_truncated: false,
      transport_play_state: "stopped",
      suggested_next_step_count: 3,
    };
  }
  return {
    artifact_ref: artifactRef,
    schema: spec.schema,
    evidence_family_count: 4,
    report_row_count: 4,
    marker_count: 1,
    region_count: 1,
    metadata_field_count: 1,
    tempo_marker_count: 1,
    project_fingerprint: `fake-${request.id.slice(-6)}`,
    truncated: false,
  };
}

function fakeA1Payload(spec, request) {
  const artifactRefs = Array.isArray(request.refs)
    ? request.refs.filter((ref) => ref.kind === "artifact").map((ref) => ref.ref)
    : [];
  const itemRefs = Array.isArray(request.refs)
    ? request.refs.filter((ref) => ref.kind === "item").map((ref) => ref.ref)
    : [];
  return {
    fixture: "first_real_fixture_a1_fake",
    smoke_only: true,
    template_id: spec.id,
    operation: spec.operation,
    item_refs: itemRefs,
    consumed_artifact_refs: artifactRefs,
    readback_required: true,
  };
}

function bridgeOkEnvelope(request, result) {
  const completedAt = new Date().toISOString();
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: request.id,
    ok: true,
    completed_at: completedAt,
    bridge: {
      owner: request.bridge.expected_owner,
      generation: request.bridge.expected_generation,
    },
    queue: {
      state: "done",
      started_at: completedAt,
      completed_at: completedAt,
    },
    result: {
      summary: result.summary ?? {},
      refs: result.refs ?? [],
      artifacts: result.artifacts ?? [],
      jobs: result.jobs ?? [],
      last_result: {
        updated: false,
        refs: result.last_result_refs ?? [],
        truncated: false,
      },
    },
    undo: {
      mode: request.undo.mode,
      opened: request.undo.mode === "required",
      closed: request.undo.mode === "required",
      label: request.undo.label ?? null,
    },
    verification: {
      mode: request.verification.mode,
      status: "passed",
      checks: request.verification.checks ?? [],
    },
    budget: {
      max_response_bytes: request.budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
    idempotency: {
      key: request.idempotency_key ?? null,
      replayed: false,
    },
  };
  envelope.budget.response_bytes = encodedBytes(envelope);
  validateFoundationBridgeResult(envelope);
  return envelope;
}

function bridgeErrorEnvelope(request, code, message, details) {
  const completedAt = new Date().toISOString();
  const requestId = typeof request?.id === "string" ? request.id : "cmd_invalid";
  const budget = request?.budget ?? { max_response_bytes: 65_536 };
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: requestId,
    ok: false,
    completed_at: completedAt,
    bridge: {
      owner: request?.bridge?.expected_owner ?? "openreaper-live-smoke",
      generation: request?.bridge?.expected_generation ?? 1,
    },
    queue: {
      state: "failed",
      started_at: completedAt,
      completed_at: completedAt,
    },
    error: {
      code,
      message,
      recoverable: true,
      details,
    },
    undo: {
      mode: request?.undo?.mode ?? "none",
      opened: false,
      closed: false,
      label: request?.undo?.label ?? null,
    },
    verification: {
      mode: request?.verification?.mode ?? "none",
      status: "skipped",
      checks: request?.verification?.checks ?? [],
    },
    budget: {
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
    idempotency: {
      key: request?.idempotency_key ?? null,
      replayed: false,
    },
  };
  envelope.budget.response_bytes = encodedBytes(envelope);
  validateFoundationBridgeResult(envelope);
  return envelope;
}

function firstBlocker(executions) {
  for (const execution of executions) {
    const blocker = execution.error?.details?.blocker;
    if (typeof blocker === "string" && blocker) return blocker;
    if (execution.skipped && execution.reason) return execution.reason;
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

function compactSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const compact = {};
  for (const [key, value] of Object.entries(summary)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      compact[key] = typeof value === "string" ? boundedString(value, 240) : value;
    }
  }
  return compact;
}

function objectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function managedRenderOutputForRequest(request) {
  const key = typeof request?.idempotency_key === "string" ? request.idempotency_key : request?.id ?? "cmd_unknown";
  const suffix = key.replace(/^template:/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "unknown";
  const basename = `openreaper_a2_${suffix}.wav`;
  return {
    basename,
    relative_path: basename,
  };
}

function fakeWavFileBytes() {
  const dataSize = 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function artifactRefBySchemaFromRequest(request, schema) {
  if (!Array.isArray(request?.refs)) return null;
  const match = request.refs.find((ref) => ref?.kind === "artifact" && ref?.summary?.schema === schema);
  return typeof match?.ref === "string" ? match.ref : null;
}

async function readArtifactEnvelopeFromRoot(artifactRoot, ref) {
  const artifactPath = artifactPathFromRef(artifactRoot, ref);
  return JSON.parse(await readFile(artifactPath, "utf8"));
}

function assertFakeA2ArtifactProducer(envelope, producerId, schema) {
  if (
    envelope?.contract !== "artifact.state_store.v1" ||
    envelope?.schema !== schema ||
    envelope?.owner_pack !== "render" ||
    envelope?.producer?.kind !== "template" ||
    envelope?.producer?.id !== producerId ||
    envelope?.producer?.pack !== "render"
  ) {
    throw new Error(`expected render-owned ${schema} from ${producerId}`);
  }
}

function assertFakeA3LayerEvidence(envelope) {
  if (
    envelope?.contract !== "artifact.state_store.v1" ||
    envelope?.schema !== "items.layer_evidence.v1" ||
    envelope?.owner_pack !== "items" ||
    envelope?.scope !== "layer_evidence" ||
    envelope?.producer?.kind !== "template" ||
    envelope?.producer?.pack !== "items"
  ) {
    throw new Error("expected items.layer_evidence.v1 fixture artifact from an items template producer");
  }
}

function layerEvidenceItemCount(envelope) {
  if (Number.isInteger(envelope?.summary?.item_count) && envelope.summary.item_count >= 0) {
    return envelope.summary.item_count;
  }
  return Array.isArray(envelope?.payload?.items) ? envelope.payload.items.length : 0;
}

function layerEvidenceTrackCount(envelope) {
  if (Number.isInteger(envelope?.summary?.track_count) && envelope.summary.track_count >= 0) {
    return envelope.summary.track_count;
  }
  return Array.isArray(envelope?.payload?.tracks) ? envelope.payload.tracks.length : 0;
}

function compactLayerEvidenceSummary(summary) {
  if (!isPlainObjectForReport(summary)) return {};
  return pruneNullValues({
    schema: summary.schema,
    item_count: summary.item_count,
    track_count: summary.track_count,
    evidence_family_count: summary.evidence_family_count,
    truncated: summary.truncated,
    fixture: summary.fixture,
  });
}

function fakeA3ReportRows(envelope, rowCount) {
  const items = Array.isArray(envelope?.payload?.items) ? envelope.payload.items : [];
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const item = isPlainObjectForReport(items[index]) ? items[index] : {};
    rows.push(pruneNullValues({
      row: index + 1,
      item_ref: boundedString(item.item_ref ?? item.ref, 120),
      track_ref: boundedString(item.track_ref, 120),
      name: boundedString(item.name, 120),
      color: boundedString(item.color, 80),
    }));
  }
  return rows;
}

function isPlainObjectForReport(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pruneNullValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  );
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

function nonNegativeInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function nonNegativeIntegerOrNull(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function finiteNumber(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedUnitNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
}

function boundedString(value, maxLength = 240) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 3)}...`;
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

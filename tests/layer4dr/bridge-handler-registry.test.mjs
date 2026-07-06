import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildBridgeRouteMetadata,
  buildLiveBridgeBundle,
  handlerModuleFilesFromRegistry,
  handlerSourceRoot,
  loadBridgeHandlerRegistry,
  routeMetadataFile,
  registryRoutes,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const ROUTE_METADATA_SOURCE = readFileSync(new URL(`../../${routeMetadataFile}`, import.meta.url), "utf8");
const ROUTE_METADATA = JSON.parse(ROUTE_METADATA_SOURCE);
const REGISTRY = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const REQUIRED_ENTRY_FIELDS = Object.freeze([
  "template_id",
  "operation",
  "pack",
  "risk",
  "route",
  "handler_file",
  "handler_export",
  "artifact_policy",
  "tests",
]);
const EXTRACTED_WAVE0_HANDLERS = Object.freeze(new Map([
  ["template.project.read_summary", ["project/read_summary.lua", "read_project_summary"]],
  ["template.transport.read_state", ["transport/read_state.lua", "read_transport_state"]],
  ["template.core.read_openreaper_status", ["core/read_openreaper_status.lua", "read_openreaper_status"]],
  ["template.system.read_runtime_environment", ["system/read_runtime_environment.lua", "read_runtime_environment"]],
  ["template.system.read_resource_paths", ["system/read_resource_paths.lua", "read_resource_paths"]],
]));
const EXTRACTED_WAVE1A_HANDLERS = Object.freeze(new Map([
  ["template.core.read_template_catalog_summary", ["core/read_template_catalog_summary.lua", "read_template_catalog_summary"]],
  ["template.core.read_last_result", ["core/read_last_result.lua", "read_last_result"]],
  ["template.system.check_api_symbols", ["system/check_api_symbols.lua", "read_api_symbols"]],
  ["template.project.read_metadata", ["project/read_metadata.lua", "read_project_metadata"]],
  ["template.project.list_markers_regions", ["project/list_markers_regions.lua", "list_markers_regions"]],
  ["template.project.read_tempo_map", ["project/read_tempo_map.lua", "read_tempo_map"]],
  ["template.tracks.resolve_track_ref", ["tracks/resolve_track_ref.lua", "resolve_track_ref"]],
  ["template.items.resolve_item_ref", ["items/resolve_item_ref.lua", "resolve_item_ref"]],
  ["template.items.read_item_summary", ["items/read_item_summary.lua", "read_item_summary"]],
]));
const EXTRACTED_READ_B_HANDLERS = Object.freeze(new Map([
  ["template.actions.resolve_named_command", ["actions/resolve_named_command.lua", "resolve_named_command"]],
  ["template.actions.read_action_metadata", ["actions/read_action_metadata.lua", "read_action_metadata"]],
  ["template.actions.read_action_toggle_state", ["actions/read_action_toggle_state.lua", "read_action_toggle_state"]],
  ["template.actions.read_action_shortcuts", ["actions/read_action_shortcuts.lua", "read_action_shortcuts"]],
  ["template.actions.parse_marker_action_text", ["actions/parse_marker_action_text.lua", "parse_marker_action_text"]],
  ["template.actions.search_action_commands", ["actions/search_action_commands.lua", "search_action_commands"]],
  ["template.midi.resolve_midi_take_ref", ["midi/resolve_midi_take_ref.lua", "resolve_midi_take_ref"]],
  ["template.midi.read_take_event_counts", ["midi/read_take_event_counts.lua", "read_take_event_counts"]],
  ["template.midi.list_take_notes", ["midi/list_take_notes.lua", "list_take_notes"]],
  ["template.midi.list_take_cc_events", ["midi/list_take_cc_events.lua", "list_take_cc_events"]],
  ["template.midi.list_take_text_sysex_events", ["midi/list_take_text_sysex_events.lua", "list_take_text_sysex_events"]],
  ["template.midi.read_take_grid", ["midi/read_take_grid.lua", "read_take_grid"]],
  ["template.media.probe_file", ["media/probe_file.lua", "probe_media_file"]],
  ["template.media.read_take_source", ["media/read_take_source.lua", "read_take_source"]],
  ["template.media.read_project_media_files", ["media/read_project_media_files.lua", "read_project_media_files"]],
]));
const EXTRACTED_E3_MEDIA_HANDLERS = Object.freeze(new Map([
  ["template.media.list_folder_media_files", ["media/e3_media_route.lua", "list_folder_media_files"]],
  ["template.media.import_file_to_track", ["media/e3_media_route.lua", "import_file_to_track"]],
  ["template.media.import_file_section_to_track", ["media/e3_media_route.lua", "import_file_section_to_track"]],
  ["template.media.relink_take_source", ["media/e3_media_route.lua", "relink_take_source"]],
]));
const EXTRACTED_E4_ITEM_HANDLERS = Object.freeze(new Map([
  ["template.items.copy_item_to_track", ["items/e4_item_route.lua", "copy_item_to_track"]],
  ["template.items.split_item_at_time", ["items/e4_item_route.lua", "split_item_at_time"]],
  ["template.items.set_take_playrate", ["items/e4_item_route.lua", "set_take_playrate"]],
]));
const EXTRACTED_E5_R1_ROUTING_READ_HANDLERS = Object.freeze(new Map([
  ["template.routing.read_track_routing", ["routing/e5_r1_routing_read_route.lua", "read_track_routing"]],
  ["template.routing.resolve_send_ref", ["routing/e5_r1_routing_read_route.lua", "resolve_send_ref"]],
  ["template.routing.list_track_hardware_outputs", ["routing/e5_r1_routing_read_route.lua", "list_track_hardware_outputs"]],
  ["template.routing.read_project_routing_graph", ["routing/e5_r1_routing_read_route.lua", "read_project_routing_graph"]],
  ["template.routing.list_available_audio_outputs", ["routing/e5_r1_routing_read_route.lua", "list_available_audio_outputs"]],
]));
const EXTRACTED_E5_ROUTING_WRITE_HANDLERS = Object.freeze(new Map([
  ["template.routing.create_track_send", ["routing/e5_r1_routing_read_route.lua", "create_track_send"]],
  ["template.routing.set_send_volume", ["routing/e5_r1_routing_read_route.lua", "set_send_volume"]],
  ["template.routing.set_send_pan", ["routing/e5_r1_routing_read_route.lua", "set_send_pan"]],
  ["template.routing.set_send_mute", ["routing/e5_r1_routing_read_route.lua", "set_send_mute"]],
  ["template.routing.set_send_mode", ["routing/e5_r1_routing_read_route.lua", "set_send_mode"]],
  ["template.routing.set_master_parent_send", ["routing/e5_r1_routing_read_route.lua", "set_master_parent_send"]],
  ["template.routing.set_track_channel_count", ["routing/e5_r1_routing_read_route.lua", "set_track_channel_count"]],
  ["template.routing.set_track_hardware_output", ["routing/e5_r1_routing_read_route.lua", "set_track_hardware_output"]],
  ["template.routing.remove_track_hardware_output", ["routing/e5_r1_routing_read_route.lua", "remove_track_hardware_output"]],
  ["template.routing.set_send_audio_channels", ["routing/e5_r1_routing_read_route.lua", "set_send_audio_channels"]],
  ["template.routing.set_send_phase", ["routing/e5_r1_routing_read_route.lua", "set_send_phase"]],
  ["template.routing.set_send_mono", ["routing/e5_r1_routing_read_route.lua", "set_send_mono"]],
  ["template.routing.set_send_midi_channels", ["routing/e5_r1_routing_read_route.lua", "set_send_midi_channels"]],
]));
const EXTRACTED_E5_ROUTING_AUTOMATION_EXTRA_HANDLERS = Object.freeze(new Map([
  ["template.routing.read_fx_pin_mapping", ["routing/e5_r1_routing_read_route.lua", "read_fx_pin_mapping"]],
  ["template.automation.resolve_envelope_ref", ["routing/e5_r1_routing_read_route.lua", "resolve_envelope_ref"]],
  ["template.automation.read_envelope_summary", ["routing/e5_r1_routing_read_route.lua", "read_envelope_summary"]],
  ["template.automation.read_envelope_points", ["routing/e5_r1_routing_read_route.lua", "read_envelope_points"]],
  ["template.automation.evaluate_envelope_at_time", ["routing/e5_r1_routing_read_route.lua", "evaluate_envelope_at_time"]],
  ["template.automation.set_envelope_lane_state", ["routing/e5_r1_routing_read_route.lua", "set_envelope_lane_state"]],
  ["template.automation.insert_envelope_point", ["routing/e5_r1_routing_read_route.lua", "insert_envelope_point"]],
  ["template.automation.set_track_automation_mode", ["routing/e5_r1_routing_read_route.lua", "set_track_automation_mode"]],
  ["template.automation.read_track_automation_mode", ["routing/e5_r1_routing_read_route.lua", "read_track_automation_mode"]],
  ["template.automation.read_automation_items", ["routing/e5_r1_routing_read_route.lua", "read_automation_items"]],
  ["template.automation.set_envelope_point", ["routing/e5_r1_routing_read_route.lua", "set_envelope_point"]],
  ["template.automation.insert_envelope_points_batch", ["routing/e5_r1_routing_read_route.lua", "insert_envelope_points_batch"]],
  ["template.automation.set_send_automation_mode", ["routing/e5_r1_routing_read_route.lua", "set_send_automation_mode"]],
  ["template.automation.create_automation_item", ["routing/e5_r1_routing_read_route.lua", "create_automation_item"]],
  ["template.automation.set_automation_item_bounds", ["routing/e5_r1_routing_read_route.lua", "set_automation_item_bounds"]],
  ["template.automation.resolve_send_envelope", ["routing/e5_r1_routing_read_route.lua", "resolve_send_envelope"]],
  ["template.automation.insert_fx_parameter_envelope_points", ["routing/e5_r1_routing_read_route.lua", "insert_fx_parameter_envelope_points"]],
  ["template.automation.insert_sine_wave_points", ["routing/e5_r1_routing_read_route.lua", "insert_sine_wave_points"]],
]));
const EXTRACTED_D6_PROJECT_TEMPO_HANDLERS = Object.freeze(new Map([
  ["template.project.set_tempo", ["project/tempo_write.lua", "d6_project_set_tempo"]],
  ["template.project.set_bpm", ["project/tempo_write.lua", "d6_project_set_bpm"]],
  ["template.project.set_tempo_marker", ["project/tempo_write.lua", "d6_project_set_tempo_marker"]],
  ["template.project.set_grid", ["project/d20_project_grid_snap.lua", "d20_project_set_grid"]],
]));
const EXTRACTED_D9_TRACKS_MIXER_HANDLERS = Object.freeze(new Map([
  ["template.tracks.list_tracks", ["tracks/d9_tracks_mixer_route.lua", "list_tracks"]],
  ["template.tracks.read_mixer_controls", ["tracks/d9_tracks_mixer_route.lua", "read_mixer_controls"]],
  ["template.tracks.read_folder_structure", ["tracks/d9_tracks_mixer_route.lua", "read_folder_structure"]],
  ["template.tracks.set_record_arm", ["tracks/d9_tracks_mixer_route.lua", "set_record_arm"]],
  ["template.tracks.set_volume", ["tracks/d9_tracks_mixer_route.lua", "set_volume"]],
  ["template.tracks.set_pan", ["tracks/d9_tracks_mixer_route.lua", "set_pan"]],
  ["template.tracks.set_width", ["tracks/d9_tracks_mixer_route.lua", "set_width"]],
]));
const EXTRACTED_D10_READ_OVERVIEW_ACTIONS_HANDLERS = Object.freeze(new Map([
  ["template.project.read_track_item_overview", ["project/read_track_item_overview.lua", "read_track_item_overview"]],
  ["template.actions.read_custom_action_metadata", ["actions/read_action_metadata.lua", "read_custom_action_metadata"]],
  ["template.actions.read_cycle_action_metadata", ["actions/read_action_metadata.lua", "read_cycle_action_metadata"]],
]));
const EXTRACTED_D11_PROJECT_MARKER_REGION_HANDLERS = Object.freeze(new Map([
  ["template.project.delete_marker", ["project/d11_marker_region_mutations.lua", "d11_project_delete_marker"]],
  ["template.project.delete_region", ["project/d11_marker_region_mutations.lua", "d11_project_delete_region"]],
  ["template.project.remove_marker", ["project/d11_marker_region_mutations.lua", "d11_project_remove_marker"]],
  ["template.project.remove_region", ["project/d11_marker_region_mutations.lua", "d11_project_remove_region"]],
  ["template.project.rename_marker", ["project/d11_marker_region_mutations.lua", "d11_project_rename_marker"]],
  ["template.project.rename_region", ["project/d11_marker_region_mutations.lua", "d11_project_rename_region"]],
]));
const EXTRACTED_D12_TRANSPORT_SAFE_HANDLERS = Object.freeze(new Map([
  ["template.transport.play", ["transport/d12_transport_safe_route.lua", "d12_transport_play"]],
  ["template.transport.pause", ["transport/d12_transport_safe_route.lua", "d12_transport_pause"]],
  ["template.transport.stop_playback", ["transport/d12_transport_safe_route.lua", "d12_transport_stop_playback"]],
  ["template.transport.set_punch_record_range", ["transport/d12_transport_safe_route.lua", "d12_transport_set_punch_record_range"]],
]));
const EXTRACTED_D13_ITEMS_CORE_HANDLERS = Object.freeze(new Map([
  ["template.items.list_selected_items", ["items/d13_items_core_route.lua", "d13_items_list_selected_items"]],
  ["template.items.list_items_on_track", ["items/d13_items_core_route.lua", "d13_items_list_items_on_track"]],
  ["template.items.set_item_volume", ["items/d13_items_core_route.lua", "d13_items_set_item_volume"]],
  ["template.items.set_take_volume", ["items/d13_items_core_route.lua", "d13_items_set_take_volume"]],
  ["template.items.set_take_pan", ["items/d13_items_core_route.lua", "d13_items_set_take_pan"]],
  ["template.items.rename_take", ["items/d13_items_core_route.lua", "d13_items_rename_take"]],
  ["template.items.set_loop_source", ["items/d13_items_core_route.lua", "d13_items_set_loop_source"]],
  ["template.items.set_mute", ["items/d13_items_core_route.lua", "d13_items_set_mute"]],
  ["template.items.set_lock", ["items/d13_items_core_route.lua", "d13_items_set_lock"]],
  ["template.items.set_play_all_takes", ["items/d13_items_core_route.lua", "d13_items_set_play_all_takes"]],
  ["template.items.set_take_start_in_source", ["items/d13_items_core_route.lua", "d13_items_set_take_start_in_source"]],
  ["template.items.set_channel_mode", ["items/d13_items_core_route.lua", "d13_items_set_channel_mode"]],
  ["template.items.set_pitch_shift_mode", ["items/d13_items_core_route.lua", "d13_items_set_pitch_shift_mode"]],
  ["template.items.set_stretch_marker_fade_size", ["items/d13_items_core_route.lua", "d13_items_set_stretch_marker_fade_size"]],
]));
const EXTRACTED_D14_ITEMS_DELETE_HANDLERS = Object.freeze(new Map([
  ["template.items.delete_item", ["items/d14_items_delete_route.lua", "d14_items_delete_item"]],
  ["template.items.delete_items", ["items/d14_items_delete_route.lua", "d14_items_delete_items"]],
]));
const EXTRACTED_D15_ITEMS_SOURCE_PHASE_HANDLERS = Object.freeze(new Map([
  ["template.items.set_no_autofades", ["items/d15_items_source_phase_route.lua", "d15_items_set_no_autofades"]],
  ["template.items.set_invert_phase", ["items/d15_items_source_phase_route.lua", "d15_items_set_invert_phase"]],
  ["template.items.choose_new_source_file", ["items/d15_items_source_phase_route.lua", "d15_items_choose_new_source_file"]],
]));
const EXTRACTED_D16_TRACKS_ORG_HANDLERS = Object.freeze(new Map([
  ["template.tracks.delete_track", ["tracks/d16_tracks_org_route.lua", "d16_tracks_delete_track"]],
  ["template.tracks.delete_tracks", ["tracks/d16_tracks_org_route.lua", "d16_tracks_delete_tracks"]],
  ["template.tracks.create_folder_track", ["tracks/d16_tracks_org_route.lua", "d16_tracks_create_folder_track"]],
  ["template.tracks.set_folder_depth", ["tracks/d16_tracks_org_route.lua", "d16_tracks_set_folder_depth"]],
  ["template.tracks.move_track", ["tracks/d16_tracks_org_route.lua", "d16_tracks_move_track"]],
  ["template.tracks.move_tracks", ["tracks/d16_tracks_org_route.lua", "d16_tracks_move_tracks"]],
  ["template.tracks.nest_tracks_in_folder", ["tracks/d16_tracks_org_route.lua", "d16_tracks_nest_tracks_in_folder"]],
]));
const EXTRACTED_D17_MIDI_EDIT_HANDLERS = Object.freeze(new Map([
  ["template.midi.set_notes_batch", ["midi/d17_midi_edit_route.lua", "d17_midi_set_notes_batch"]],
  ["template.midi.quantize_notes", ["midi/d17_midi_edit_route.lua", "d17_midi_quantize_notes"]],
  ["template.midi.quantize_selected_notes", ["midi/d17_midi_edit_route.lua", "d17_midi_quantize_selected_notes"]],
  ["template.midi.set_cc_events_batch", ["midi/d17_midi_edit_route.lua", "d17_midi_set_cc_events_batch"]],
]));
const EXTRACTED_D21_RENDER_READ_HANDLERS = Object.freeze(new Map([
  ["template.render.read_settings", ["render/d21_render_read_route.lua", "read_render_settings"]],
  ["template.render.resolve_bounds", ["render/d21_render_read_route.lua", "resolve_render_bounds"]],
  ["template.render.preview_targets", ["render/d21_render_read_route.lua", "preview_render_targets"]],
  ["template.render.read_region_matrix", ["render/d21_render_read_route.lua", "read_region_render_matrix"]],
]));
const EXTRACTED_D22_RENDER_SETTINGS_WRITE_HANDLERS = Object.freeze(new Map([
  ["template.render.set_render_sample_rate", ["render/d22_render_settings_write_route.lua", "set_render_sample_rate"]],
]));
const EXTRACTED_D23_FX_DISCOVERY_READ_HANDLERS = Object.freeze(new Map([
  ["template.fx.search_installed_fx", ["fx/e2_fx_l1_read_route.lua", "search_installed_fx"]],
]));
const EXTRACTED_E2_FX_L1_READ_HANDLERS = Object.freeze(new Map([
  ["template.fx.resolve_fx_ref", ["fx/e2_fx_l1_read_route.lua", "resolve_fx_ref"]],
  ["template.fx.list_track_fx_chain", ["fx/e2_fx_l1_read_route.lua", "list_track_fx_chain"]],
  ["template.fx.list_take_fx_chain", ["fx/e2_fx_l1_read_route.lua", "list_take_fx_chain"]],
  ["template.fx.read_fx_summary", ["fx/e2_fx_l1_read_route.lua", "read_fx_summary"]],
  ["template.fx.list_fx_parameters", ["fx/e2_fx_l1_read_route.lua", "list_fx_parameters"]],
  ["template.fx.read_fx_parameter", ["fx/e2_fx_l1_read_route.lua", "read_fx_parameter"]],
  ["template.fx.parameter_to_envelope_mapping", ["fx/e2_fx_l1_read_route.lua", "parameter_to_envelope_mapping"]],
]));
const EXTRACTED_E2_FX_B1_WRITE_HANDLERS = Object.freeze(new Map([
  ["template.fx.add_track_fx", ["fx/e2_fx_l1_read_route.lua", "add_track_fx"]],
  ["template.fx.add_take_fx", ["fx/e2_fx_l1_read_route.lua", "add_take_fx"]],
  ["template.fx.set_fx_bypass", ["fx/e2_fx_l1_read_route.lua", "set_fx_bypass"]],
  ["template.fx.set_fx_parameter_normalized", ["fx/e2_fx_l1_read_route.lua", "set_fx_parameter_normalized"]],
  ["template.fx.set_fx_preset_by_name", ["fx/e2_fx_l1_read_route.lua", "set_fx_preset_by_name"]],
  ["template.fx.set_fx_preset_by_index", ["fx/e2_fx_l1_read_route.lua", "set_fx_preset_by_index"]],
  ["template.fx.reorder_fx", ["fx/e2_fx_l1_read_route.lua", "reorder_fx"]],
]));
const EXTRACTED_FIRST_REAL_A_HANDLERS = Object.freeze(new Map([
  ["template.analysis.detect_loop_candidates", ["analysis/detect_loop_candidates.lua", "detect_loop_candidates"]],
  ["template.analysis.measure_loop_click_risk", ["analysis/measure_loop_click_risk.lua", "measure_loop_click_risk"]],
  ["template.analysis.create_loop_qa_report", ["analysis/create_loop_qa_report.lua", "create_loop_qa_report"]],
  ["template.project.create_cleanup_report", ["project/create_cleanup_report.lua", "create_cleanup_report"]],
  ["template.render.render_region_wav", ["render/render_region_wav.lua", "render_region_wav"]],
  ["template.render.create_delivery_report", ["render/create_delivery_report.lua", "create_delivery_report"]],
  ["template.items.create_layer_report", ["items/create_layer_report.lua", "create_layer_report"]],
]));
const EXTRACTED_SAFE_WRITE_A_HANDLERS = Object.freeze(new Map([
  ["template.project.set_metadata_field", ["project/set_metadata_field.lua", "safe_write_project_metadata"]],
  ["template.project.create_marker", ["project/create_marker.lua", "safe_write_create_marker"]],
  ["template.project.create_region", ["project/create_region.lua", "safe_write_create_region"]],
  ["template.tracks.create_track", ["tracks/create_track.lua", "safe_write_create_track"]],
  ["template.tracks.rename_track", ["tracks/rename_track.lua", "safe_write_rename_track"]],
  ["template.tracks.set_color", ["tracks/set_color.lua", "safe_write_set_track_color"]],
  ["template.tracks.select_track", ["tracks/select_track.lua", "safe_write_select_track"]],
  ["template.tracks.set_mute", ["tracks/set_mute.lua", "safe_write_set_track_mute"]],
  ["template.tracks.set_solo", ["tracks/set_solo.lua", "safe_write_set_track_solo"]],
  ["template.transport.set_edit_cursor", ["transport/set_edit_cursor.lua", "safe_write_transport_set_edit_cursor"]],
  ["template.transport.set_time_selection", ["transport/set_time_selection.lua", "safe_write_transport_set_time_selection"]],
  ["template.transport.clear_time_selection", ["transport/clear_time_selection.lua", "safe_write_transport_clear_time_selection"]],
  ["template.transport.set_loop_points", ["transport/set_loop_points.lua", "safe_write_transport_set_loop_points"]],
  ["template.transport.clear_loop_points", ["transport/clear_loop_points.lua", "safe_write_transport_clear_loop_points"]],
  ["template.transport.set_repeat", ["transport/set_repeat.lua", "safe_write_transport_set_repeat"]],
  ["template.items.move_item", ["items/move_item.lua", "safe_write_move_item"]],
  ["template.items.trim_item", ["items/trim_item.lua", "safe_write_trim_item"]],
  ["template.items.set_item_fades", ["items/set_item_fades.lua", "safe_write_set_item_fades"]],
  ["template.items.set_take_pitch", ["items/set_take_pitch.lua", "safe_write_set_take_pitch"]],
  ["template.items.set_item_snap_offset", ["items/set_item_snap_offset.lua", "safe_write_set_item_snap_offset"]],
  ["template.midi.create_midi_item", ["midi/create_midi_item.lua", "safe_write_create_midi_item"]],
  ["template.midi.insert_notes_batch", ["midi/insert_notes_batch.lua", "safe_write_insert_notes_batch"]],
  ["template.midi.insert_cc_batch", ["midi/insert_cc_batch.lua", "safe_write_insert_cc_batch"]],
  ["template.midi.insert_text_sysex_events", ["midi/insert_text_sysex_events.lua", "safe_write_insert_text_sysex_events"]],
]));
const EXTRACTED_HANDLER_ROWS = Object.freeze(new Map([
  ...EXTRACTED_WAVE0_HANDLERS,
  ...EXTRACTED_WAVE1A_HANDLERS,
  ...EXTRACTED_D6_PROJECT_TEMPO_HANDLERS,
  ...EXTRACTED_D21_RENDER_READ_HANDLERS,
  ...EXTRACTED_D9_TRACKS_MIXER_HANDLERS,
  ...EXTRACTED_D10_READ_OVERVIEW_ACTIONS_HANDLERS,
  ...EXTRACTED_D11_PROJECT_MARKER_REGION_HANDLERS,
  ...EXTRACTED_D12_TRANSPORT_SAFE_HANDLERS,
  ...EXTRACTED_D13_ITEMS_CORE_HANDLERS,
  ...EXTRACTED_D14_ITEMS_DELETE_HANDLERS,
  ...EXTRACTED_D15_ITEMS_SOURCE_PHASE_HANDLERS,
  ...EXTRACTED_D16_TRACKS_ORG_HANDLERS,
  ...EXTRACTED_D17_MIDI_EDIT_HANDLERS,
  ...EXTRACTED_D22_RENDER_SETTINGS_WRITE_HANDLERS,
  ...EXTRACTED_READ_B_HANDLERS,
  ...EXTRACTED_E3_MEDIA_HANDLERS,
  ...EXTRACTED_E4_ITEM_HANDLERS,
  ...EXTRACTED_E5_R1_ROUTING_READ_HANDLERS,
  ...EXTRACTED_E5_ROUTING_WRITE_HANDLERS,
  ...EXTRACTED_E5_ROUTING_AUTOMATION_EXTRA_HANDLERS,
  ...EXTRACTED_E2_FX_L1_READ_HANDLERS,
  ...EXTRACTED_E2_FX_B1_WRITE_HANDLERS,
  ...EXTRACTED_D23_FX_DISCOVERY_READ_HANDLERS,
  ...EXTRACTED_FIRST_REAL_A_HANDLERS,
  ...EXTRACTED_SAFE_WRITE_A_HANDLERS,
]));

describe("Layer 4D.R bridge handler registry", () => {
  it("defines one standard registered handler entry shape", () => {
    assert.equal(REGISTRY.contract, "openreaper.bridge_handler_registry.v1");
    assert.equal(REGISTRY.entries.length, 177);
    for (const entry of REGISTRY.entries) {
      for (const field of REQUIRED_ENTRY_FIELDS) {
        assert.equal(Object.hasOwn(entry, field), true, `${entry.template_id}:${field}`);
      }
      assert.match(entry.template_id, /^template\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
      assert.match(entry.operation.family, /^(query_state|run_command|run_job|run_action|artifact_metadata)$/);
      assert.equal(typeof entry.operation.name, "string");
      assert.match(entry.artifact_policy, /^(none|metadata|write)$/);
      assert.equal(Array.isArray(entry.tests), true);
      assert.equal(entry.tests.length > 0, true);
      const extractedHandler = EXTRACTED_HANDLER_ROWS.get(entry.template_id);
      if (extractedHandler) {
        assert.deepEqual([entry.handler_file, entry.handler_export], extractedHandler, entry.template_id);
        assert.doesNotMatch(entry.handler_file, /^(?:\/|[A-Za-z]:[\\/])/, entry.template_id);
        assert.doesNotMatch(entry.handler_file, /(?:^|\/)\.\.(?:\/|$)|\\/, entry.template_id);
      } else {
        assert.equal(entry.handler_file, "legacy_monolith", entry.template_id);
        assert.equal(entry.handler_export, "legacy_monolith", entry.template_id);
      }
      if (entry.operation.name === "template.execute") {
        assert.equal(typeof entry.capability, "string", entry.template_id);
      } else {
        assert.equal(Object.hasOwn(entry, "capability"), false, entry.template_id);
      }
    }
  });

  it("matches accepted catalog descriptors and live route allowlists exactly", () => {
    const summary = validateBridgeHandlerRegistry({ cwd: ROOT.pathname });
    assert.deepEqual(summary, {
      contract: "openreaper.bridge_handler_registry.v1",
      entryCount: 177,
      legacyMonolithCount: 0,
      extractedHandlerCount: 177,
      handlerModuleCount: 77,
      routeCount: 27,
      operationCount: 72,
    });

    const catalog = createAcceptedOfficialTemplateCatalog();
    const accepted = new Set(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);
    for (const entry of REGISTRY.entries) {
      assert.equal(accepted.has(entry.template_id), true, entry.template_id);
      const descriptor = catalog.require(entry.template_id);
      assert.equal(entry.pack, descriptor.pack, entry.template_id);
      assert.equal(entry.risk, descriptor.risk, entry.template_id);
      assert.equal(entry.operation.family, descriptor.bridge.operation_family, entry.template_id);
      assert.equal(entry.operation.name, descriptor.bridge.operation_name, entry.template_id);
      if (entry.operation.name === "template.execute") {
        assert.equal(entry.capability, descriptor.bridge.capability, entry.template_id);
      }
    }

    for (const [route, spec] of Object.entries(registryRoutes)) {
      assert.deepEqual(
        REGISTRY.entries.filter((entry) => entry.route === route).map((entry) => entry.template_id),
        spec.ids,
        route,
      );
    }
  });

  it("extracts exactly the Wave 0, Wave 1A, Read-B, E3 media, E4 item, E5 routing/automation, D6 project tempo, D9 tracks mixer, D10 read overview/actions, D11 project marker/region, D12 transport safe, D13 items core, D14 items delete, D15 items source/phase, D16 tracks org, D17 MIDI edit, E2-FX read/write, First-Real-Fixture-A A1/A2/A3, and Safe-Write-A batches into deterministic handler modules", () => {
    const extractedRows = REGISTRY.entries.filter((entry) => entry.handler_file !== "legacy_monolith");
    assert.deepEqual(extractedRows.map((entry) => entry.template_id), [...EXTRACTED_HANDLER_ROWS.keys()]);
    assert.deepEqual(
      handlerModuleFilesFromRegistry(REGISTRY),
      [...new Set([...EXTRACTED_HANDLER_ROWS.values()].map(([file]) => file))],
    );

    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "wave1a-read-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_WAVE1A_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "read-b" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_READ_B_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => ["first-real-a1", "first-real-a2-render", "first-real-a3-layer-report"].includes(entry.route) && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_FIRST_REAL_A_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "e3-media-live-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_E3_MEDIA_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "e4-item-live-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_E4_ITEM_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "e5-r1-routing-read-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_E5_R1_ROUTING_READ_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "e5-routing-write-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_E5_ROUTING_WRITE_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "e5-routing-automation-extra-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_E5_ROUTING_AUTOMATION_EXTRA_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d6-project-tempo-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D6_PROJECT_TEMPO_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d9-tracks-mixer-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D9_TRACKS_MIXER_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d10-read-overview-actions-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D10_READ_OVERVIEW_ACTIONS_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d11-project-marker-region-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D11_PROJECT_MARKER_REGION_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d12-transport-safe-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D12_TRANSPORT_SAFE_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d13-items-core-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D13_ITEMS_CORE_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d14-items-delete-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D14_ITEMS_DELETE_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d15-items-source-phase-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D15_ITEMS_SOURCE_PHASE_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d16-tracks-org-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D16_TRACKS_ORG_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d17-midi-edit-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D17_MIDI_EDIT_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d21-render-read-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D21_RENDER_READ_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d22-render-settings-write-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D22_RENDER_SETTINGS_WRITE_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "d23-fx-discovery-read-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_D23_FX_DISCOVERY_READ_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "e2-fx-l1-read-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_E2_FX_L1_READ_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "e2-fx-b1-write-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_E2_FX_B1_WRITE_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "safe-write-a" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_SAFE_WRITE_A_HANDLERS.keys()],
    );

    for (const [templateId, [file, handlerExport]] of EXTRACTED_HANDLER_ROWS) {
      const moduleSource = readFileSync(new URL(`../../${handlerSourceRoot}/${file}`, import.meta.url), "utf8");
      assert.match(moduleSource, new RegExp(`\\blocal\\s+function\\s+${handlerExport}\\s*\\(`), templateId);
      assert.doesNotMatch(moduleSource, /\b(require\s*\(|dofile|loadstring|os\.execute|io\.popen)\b/, templateId);
      assert.doesNotMatch(ROUTE_SOURCE, new RegExp(`\\blocal\\s+function\\s+${handlerExport}\\s*\\(`), templateId);
    }
  });

  it("keeps Lua callable operations registered without adding raw execution surfaces", () => {
    const registeredOperationKeys = [
      ...new Set(REGISTRY.entries.map((entry) => `${entry.operation.family}:${entry.operation.name}`)),
    ].sort();
    const luaOperationKeys = [
      ...new Set(
        [...BRIDGE_SOURCE.matchAll(/\["(query_state|run_command|run_job|run_action|artifact_metadata):([^"]+)"\]\s*=/g)]
          .map((match) => `${match[1]}:${match[2]}`),
      ),
    ].sort();

    assert.deepEqual(luaOperationKeys, registeredOperationKeys);
    assert.deepEqual(
      [...new Set(REGISTRY.entries.filter((entry) => entry.operation.name === "template.execute").map((entry) => entry.capability))],
      [
        "project.set_tempo",
        "project.set_bpm",
        "project.set_tempo_marker",
        "project.set_grid",
        "track.set_record_arm",
        "track.set_volume",
        "track.set_pan",
        "track.set_width",
        "project.delete_marker",
        "project.delete_region",
        "project.remove_marker",
        "project.remove_region",
        "project.rename_marker",
        "project.rename_region",
        "transport.play",
        "transport.pause",
        "transport.stop_playback",
        "transport.set_punch_record_range",
        "items.set_item_volume",
        "items.set_take_volume",
        "items.set_take_pan",
        "items.rename_take",
        "items.set_loop_source",
        "items.set_mute",
        "items.set_lock",
        "items.set_play_all_takes",
        "items.set_take_start_in_source",
        "items.set_channel_mode",
        "items.set_pitch_shift_mode",
        "items.set_stretch_marker_fade_size",
        "items.delete_item",
        "items.delete_items",
        "items.set_no_autofades",
        "items.set_invert_phase",
        "items.choose_new_source_file",
        "track.delete",
        "tracks.delete",
        "track.create_folder",
        "track.set_folder_depth",
        "track.move",
        "tracks.move",
        "tracks.nest_in_folder",
        "midi.set_notes_batch",
        "midi.quantize_notes",
        "midi.quantize_selected_notes",
        "midi.set_cc_events_batch",
        "media.import_file_to_track",
        "media.import_file_section_to_track",
        "media.relink_take_source",
        "item.copy_to_track",
        "items.split_item_at_time",
        "items.set_take_playrate",
        "routing.send.create",
        "routing.send.set_volume",
        "routing.send.set_pan",
        "routing.send.set_mute",
        "routing.send.set_mode",
        "routing.master_parent.set",
        "routing.track_channels.set",
        "routing.track_hardware_output.set",
        "routing.track_hardware_output.remove",
        "routing.send.audio_channels.set",
        "routing.send.set_phase",
        "routing.send.set_mono",
        "routing.send.midi_channels.set",
        "automation.set_envelope_lane_state",
        "automation.insert_envelope_point",
        "automation.set_track_automation_mode",
        "automation.set_envelope_point",
        "automation.insert_envelope_points_batch",
        "automation.set_send_automation_mode",
        "automation.create_automation_item",
        "automation.set_automation_item_bounds",
        "automation.insert_fx_parameter_envelope_points",
        "automation.insert_sine_wave_points",
        "fx.add_track",
        "fx.add_take",
        "fx.set_bypass",
        "fx.set_parameter_normalized",
        "fx.set_preset_by_name",
        "fx.set_preset_by_index",
        "fx.reorder",
        "project.set_metadata_field",
        "project.create_marker",
        "project.create_region",
        "track.create",
        "track.rename",
        "track.set_color",
        "track.select",
        "track.set_mute",
        "track.set_solo",
        "transport.set_edit_cursor",
        "transport.set_time_selection",
        "transport.clear_time_selection",
        "transport.set_loop_points",
        "transport.clear_loop_points",
        "transport.set_repeat",
        "items.move_item",
        "items.trim_item",
        "items.set_item_fades",
        "items.set_take_pitch",
        "items.set_item_snap_offset",
        "midi.create_midi_item",
        "midi.insert_notes_batch",
        "midi.insert_cc_batch",
        "midi.insert_text_sysex_events",
      ],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_action|artifact_metadata):/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });

  it("keeps the generated bundle deterministic and registry-stamped", () => {
    const rebuilt = buildLiveBridgeBundle({ cwd: ROOT.pathname });
    assert.equal(rebuilt, BRIDGE_SOURCE);
    assert.match(BRIDGE_SOURCE, /Handler registry: reaper\/bridge\/registry\/BRIDGE_HANDLER_REGISTRY_V1\.json \(177 registered template handler row\(s\); 0 legacy_monolith row\(s\); 177 extracted handler row\(s\); 77 handler module file\(s\)\)\./);
    let lastIndex = BRIDGE_SOURCE.indexOf("local dispatch_request = (function()");
    assert.notEqual(lastIndex, -1);
    assert.match(BRIDGE_SOURCE, /local OPENREAPER_HANDLER_EXPORTS = \{\}/);
    assert.match(BRIDGE_SOURCE, /local OPENREAPER_HANDLER_SHARED = \{\}/);
    assert.match(BRIDGE_SOURCE, /local function __openreaper_register_handler_module\(module_name, loader\)/);
    for (const file of handlerModuleFilesFromRegistry(REGISTRY)) {
      const marker = `-- OpenReaper bridge handler module: ${handlerSourceRoot}/${file}`;
      const index = BRIDGE_SOURCE.indexOf(marker);
      assert.ok(index > lastIndex, marker);
      assert.ok(
        BRIDGE_SOURCE.indexOf(`__openreaper_register_handler_module("${file}", function()`, index) > index,
        `${file} is loaded through an isolated module function`,
      );
      lastIndex = index;
    }
    assert.ok(BRIDGE_SOURCE.indexOf("local ALLOWED_OPERATIONS = {") > lastIndex);
    assert.match(
      BRIDGE_SOURCE,
      /project\/create_cleanup_report\.lua[\s\S]*local function read_project_summary\(\.\.\.\)[\s\S]*OPENREAPER_HANDLER_EXPORTS\.read_project_summary\(\.\.\.\)/,
    );
  });

  it("keeps generated route metadata deterministic, compact, and registry-derived", () => {
    const rebuilt = buildBridgeRouteMetadata({ cwd: ROOT.pathname });
    assert.deepEqual(ROUTE_METADATA, rebuilt);
    assert.equal(ROUTE_METADATA.contract, "openreaper.bridge_route_metadata.v1");
    assert.equal(ROUTE_METADATA.generated_from, "reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json");
    assert.deepEqual(ROUTE_METADATA.registry_summary, validateBridgeHandlerRegistry({ cwd: ROOT.pathname }));
    assert.deepEqual(
      ROUTE_METADATA.routes.map((route) => route.route),
      Object.keys(registryRoutes),
    );
    for (const route of ROUTE_METADATA.routes) {
      const entries = REGISTRY.entries.filter((entry) => entry.route === route.route);
      assert.equal(route.template_count, entries.length, route.route);
      assert.deepEqual(route.template_ids, entries.map((entry) => entry.template_id), route.route);
      assert.deepEqual(route.tests, registryRoutes[route.route].tests, route.route);
      assert.equal(Object.hasOwn(route, "live_pass"), false, route.route);
      assert.equal(Object.hasOwn(route, "public_support"), false, route.route);
    }
    assert.doesNotMatch(ROUTE_METADATA_SOURCE, /LIVE_SMOKE_MATRIX|call_recipe|recipes\//);
  });

  it("keeps extracted dispatch behavior bound to the same operations and exports", () => {
    for (const [templateId, [, handlerExport]] of EXTRACTED_HANDLER_ROWS) {
      const entry = REGISTRY.entries.find((candidate) => candidate.template_id === templateId);
      const key = `${entry.operation.family}:${entry.operation.name}`;
      if (entry.operation.name === "template.execute") {
        assert.match(
          BRIDGE_SOURCE,
          new RegExp(`\\["${escapeRegExp(entry.capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handlerExport}\\b`),
          templateId,
        );
        continue;
      }
      assert.match(
        BRIDGE_SOURCE,
        new RegExp(`\\["${escapeRegExp(key)}"\\]\\s*=\\s*\\{[\\s\\S]*?pack\\s*=\\s*"${entry.pack}"[\\s\\S]*?handler\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handlerExport}\\b`),
        templateId,
      );
    }
  });
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

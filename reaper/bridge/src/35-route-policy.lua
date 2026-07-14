local SAFE_WRITE_A_CAPABILITIES = {
  ["project.set_metadata_field"] = { pack = "project", risk = "write" },
  ["project.create_marker"] = { pack = "project", risk = "write" },
  ["project.create_region"] = { pack = "project", risk = "write" },
  ["track.create"] = { pack = "tracks", risk = "write" },
  ["track.rename"] = { pack = "tracks", risk = "write" },
  ["track.set_color"] = { pack = "tracks", risk = "write" },
  ["track.select"] = { pack = "tracks", risk = "write" },
  ["track.set_mute"] = { pack = "tracks", risk = "write" },
  ["track.set_solo"] = { pack = "tracks", risk = "write" },
  ["transport.set_edit_cursor"] = { pack = "transport", risk = "safe" },
  ["transport.set_time_selection"] = { pack = "transport", risk = "safe" },
  ["transport.clear_time_selection"] = { pack = "transport", risk = "safe" },
  ["transport.set_loop_points"] = { pack = "transport", risk = "safe" },
  ["transport.clear_loop_points"] = { pack = "transport", risk = "safe" },
  ["transport.set_repeat"] = { pack = "transport", risk = "safe" },
  ["items.move_item"] = { pack = "items", risk = "write" },
  ["items.trim_item"] = { pack = "items", risk = "write" },
  ["items.set_item_fades"] = { pack = "items", risk = "write" },
  ["items.set_take_pitch"] = { pack = "items", risk = "write" },
  ["items.set_item_snap_offset"] = { pack = "items", risk = "write" },
  ["midi.create_midi_item"] = { pack = "midi", risk = "write" },
  ["midi.insert_notes_batch"] = { pack = "midi", risk = "write" },
  ["midi.insert_cc_batch"] = { pack = "midi", risk = "write" },
  ["midi.insert_text_sysex_events"] = { pack = "midi", risk = "write" },
  ["fx.delete_fx"] = { pack = "fx", risk = "destructive" },
  ["routing.remove_send"] = { pack = "routing", risk = "destructive" },
  ["items.move_item_to_track"] = { pack = "items", risk = "write" },
}

local E3_MEDIA_ROUTE_CAPABILITIES = {
  ["media.import_file_to_track"] = { pack = "media", risk = "write" },
  ["media.import_file_section_to_track"] = { pack = "media", risk = "write" },
  ["media.relink_take_source"] = { pack = "media", risk = "write" },
}

local E4_ITEM_ROUTE_CAPABILITIES = {
  ["item.copy_to_track"] = { pack = "items", risk = "write" },
  ["items.split_item_at_time"] = { pack = "items", risk = "write" },
  ["items.set_take_playrate"] = { pack = "items", risk = "write" },
}

local E5_ROUTING_WRITE_CAPABILITIES = {
  ["routing.send.create"] = { pack = "routing", risk = "write" },
  ["routing.send.set_volume"] = { pack = "routing", risk = "write" },
  ["routing.send.set_pan"] = { pack = "routing", risk = "write" },
  ["routing.send.set_mute"] = { pack = "routing", risk = "write" },
  ["routing.send.set_mode"] = { pack = "routing", risk = "write" },
  ["routing.master_parent.set"] = { pack = "routing", risk = "write" },
  ["routing.track_channels.set"] = { pack = "routing", risk = "write" },
  ["routing.track_hardware_output.set"] = { pack = "routing", risk = "write" },
  ["routing.track_hardware_output.remove"] = { pack = "routing", risk = "write" },
  ["routing.send.audio_channels.set"] = { pack = "routing", risk = "write" },
  ["routing.send.set_phase"] = { pack = "routing", risk = "write" },
  ["routing.send.set_mono"] = { pack = "routing", risk = "write" },
  ["routing.send.midi_channels.set"] = { pack = "routing", risk = "write" },
}

local E5_AUTOMATION_WRITE_CAPABILITIES = {
  ["automation.set_envelope_lane_state"] = { pack = "automation", risk = "write" },
  ["automation.insert_envelope_point"] = { pack = "automation", risk = "write" },
  ["automation.set_track_automation_mode"] = { pack = "automation", risk = "write" },
  ["automation.set_envelope_point"] = { pack = "automation", risk = "write" },
  ["automation.insert_envelope_points_batch"] = { pack = "automation", risk = "write" },
  ["automation.delete_envelope_points"] = { pack = "automation", risk = "destructive" },
  ["automation.set_send_automation_mode"] = { pack = "automation", risk = "write" },
  ["automation.create_automation_item"] = { pack = "automation", risk = "write" },
  ["automation.set_automation_item_bounds"] = { pack = "automation", risk = "write" },
  ["automation.delete_automation_item"] = { pack = "automation", risk = "destructive" },
  ["automation.ensure_fx_parameter_envelope"] = { pack = "automation", risk = "write" },
  ["automation.insert_fx_parameter_envelope_points"] = { pack = "automation", risk = "write" },
  ["automation.insert_sine_wave_points"] = { pack = "automation", risk = "write" },
}

local D6_PROJECT_TEMPO_WRITE_CAPABILITIES = {
  ["project.set_tempo"] = { pack = "project", risk = "write" },
  ["project.set_bpm"] = { pack = "project", risk = "write" },
  ["project.set_tempo_marker"] = { pack = "project", risk = "write" },
  ["project.set_grid"] = { pack = "project", risk = "write" },
}

local D9_TRACKS_MIXER_WRITE_CAPABILITIES = {
  ["track.set_record_arm"] = { pack = "tracks", risk = "write" },
  ["track.set_volume"] = { pack = "tracks", risk = "write" },
  ["track.set_pan"] = { pack = "tracks", risk = "write" },
  ["track.set_width"] = { pack = "tracks", risk = "write" },
}

local D11_PROJECT_MARKER_REGION_CAPABILITIES = {
  ["project.delete_marker"] = { pack = "project", risk = "destructive" },
  ["project.delete_region"] = { pack = "project", risk = "destructive" },
  ["project.remove_marker"] = { pack = "project", risk = "destructive" },
  ["project.remove_region"] = { pack = "project", risk = "destructive" },
  ["project.rename_marker"] = { pack = "project", risk = "write" },
  ["project.rename_region"] = { pack = "project", risk = "write" },
}

local D12_TRANSPORT_SAFE_CAPABILITIES = {
  ["transport.play"] = { pack = "transport", risk = "safe" },
  ["transport.pause"] = { pack = "transport", risk = "safe" },
  ["transport.stop_playback"] = { pack = "transport", risk = "safe" },
  ["transport.set_playback_rate"] = { pack = "transport", risk = "safe" },
  ["transport.start_recording"] = { pack = "transport", risk = "write" },
  ["transport.stop_recording"] = { pack = "transport", risk = "write" },
  ["transport.set_record_mode"] = { pack = "transport", risk = "safe" },
  ["transport.set_punch_record_range"] = { pack = "transport", risk = "safe" },
  ["transport.schedule_recording"] = { pack = "transport", risk = "write" },
}

local D13_ITEMS_CORE_WRITE_CAPABILITIES = {
  ["items.set_item_volume"] = { pack = "items", risk = "write" },
  ["items.set_take_volume"] = { pack = "items", risk = "write" },
  ["items.set_take_pan"] = { pack = "items", risk = "write" },
  ["items.set_active_take"] = { pack = "items", risk = "write" },
  ["items.rename_take"] = { pack = "items", risk = "write" },
  ["items.set_loop_source"] = { pack = "items", risk = "write" },
  ["items.set_mute"] = { pack = "items", risk = "write" },
  ["items.set_lock"] = { pack = "items", risk = "write" },
  ["items.set_play_all_takes"] = { pack = "items", risk = "write" },
  ["items.set_take_start_in_source"] = { pack = "items", risk = "write" },
  ["items.set_channel_mode"] = { pack = "items", risk = "write" },
  ["items.set_pitch_shift_mode"] = { pack = "items", risk = "write" },
  ["items.set_stretch_marker_fade_size"] = { pack = "items", risk = "write" },
}

local D14_ITEMS_DELETE_CAPABILITIES = {
  ["items.delete_item"] = { pack = "items", risk = "destructive" },
  ["items.delete_items"] = { pack = "items", risk = "destructive" },
}

local D15_ITEMS_SOURCE_PHASE_CAPABILITIES = {
  ["items.set_no_autofades"] = { pack = "items", risk = "write" },
  ["items.set_invert_phase"] = { pack = "items", risk = "write" },
  ["items.choose_new_source_file"] = { pack = "items", risk = "write" },
}

local D16_TRACKS_ORG_CAPABILITIES = {
  ["track.delete"] = { pack = "tracks", risk = "destructive" },
  ["tracks.delete"] = { pack = "tracks", risk = "destructive" },
  ["track.create_folder"] = { pack = "tracks", risk = "write" },
  ["track.set_folder_depth"] = { pack = "tracks", risk = "write" },
  ["track.move"] = { pack = "tracks", risk = "write" },
  ["tracks.move"] = { pack = "tracks", risk = "write" },
  ["tracks.nest_in_folder"] = { pack = "tracks", risk = "write" },
}

local D17_MIDI_EDIT_CAPABILITIES = {
  ["midi.set_notes_batch"] = { pack = "midi", risk = "write" },
  ["midi.quantize_notes"] = { pack = "midi", risk = "write" },
  ["midi.quantize_selected_notes"] = { pack = "midi", risk = "write" },
  ["midi.set_cc_events_batch"] = { pack = "midi", risk = "write" },
}

local D22_RENDER_SETTINGS_WRITE_CAPABILITIES = {
  ["render.sample_rate.set"] = { pack = "render", risk = "write" },
}

local D29_RENDER_SETTINGS_WRITE_CAPABILITIES = {
  ["render.format.set"] = { pack = "render", risk = "write" },
  ["render.ogg_quality.set"] = { pack = "render", risk = "write" },
  ["render.mp3_bitrate_kbps.set"] = { pack = "render", risk = "write" },
  ["render.flac_compression.set"] = { pack = "render", risk = "write" },
  ["render.aiff_bit_depth.set"] = { pack = "render", risk = "write" },
}

local D29_RENDER_JOB_OPERATIONS = {
  ["run_job:render.item"] = { pack = "render", risk = "write" },
  ["run_job:render.selected_item"] = { pack = "render", risk = "write" },
  ["run_job:render.track_item"] = { pack = "render", risk = "write" },
  ["run_job:render.selected_tracks"] = { pack = "render", risk = "write" },
  ["run_job:render.ogg"] = { pack = "render", risk = "write" },
  ["run_job:render.mp3"] = { pack = "render", risk = "write" },
  ["run_job:render.flac"] = { pack = "render", risk = "write" },
  ["run_job:render.aiff"] = { pack = "render", risk = "write" },
  ["run_job:render.m4a"] = { pack = "render", risk = "write" },
  ["run_job:render.opus"] = { pack = "render", risk = "write" },
  ["run_job:render.region_track_filter"] = { pack = "render", risk = "write" },
  ["run_job:render.targets"] = { pack = "render", risk = "write" },
}

local D30_PROJECT_CONTAINER_CAPABILITIES = {
  ["project.create_subproject"] = { pack = "project", risk = "write" },
  ["project.create_project_tab"] = { pack = "project", risk = "write" },
  ["project.insert_subproject_item"] = { pack = "project", risk = "write" },
  ["project.render_or_update_subproject"] = { pack = "project", risk = "write" },
}

local ALPHA3_2C3BC_PROJECT_FILE_SAVE_CAPABILITIES = {
  ["project.save_current_project"] = { pack = "project", risk = "write" },
  ["project.save_project_as"] = { pack = "project", risk = "write" },
}

local D28_SMALL_WRITE_CAPABILITIES = {
  ["items.set_reverse"] = { pack = "items", risk = "write" },
  ["project.set_snap"] = { pack = "project", risk = "write" },
  ["routing.track_mono_stereo.set"] = { pack = "routing", risk = "write" },
}

local E2_FX_B1_WRITE_CAPABILITIES = {
  ["fx.add_track"] = { pack = "fx", risk = "write" },
  ["fx.add_take"] = { pack = "fx", risk = "write" },
  ["fx.set_bypass"] = { pack = "fx", risk = "write" },
  ["fx.set_parameter_normalized"] = { pack = "fx", risk = "write" },
  ["fx.set_preset_by_name"] = { pack = "fx", risk = "write" },
  ["fx.set_preset_by_index"] = { pack = "fx", risk = "write" },
  ["fx.reorder"] = { pack = "fx", risk = "write" },
}

local function safe_write_a_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return SAFE_WRITE_A_CAPABILITIES[request.pack.capability]
end

local function e3_media_route_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E3_MEDIA_ROUTE_CAPABILITIES[request.pack.capability]
end

local function e4_item_route_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E4_ITEM_ROUTE_CAPABILITIES[request.pack.capability]
end

local function e5_routing_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E5_ROUTING_WRITE_CAPABILITIES[request.pack.capability]
end

local function e5_automation_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E5_AUTOMATION_WRITE_CAPABILITIES[request.pack.capability]
end

local function d6_project_tempo_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D6_PROJECT_TEMPO_WRITE_CAPABILITIES[request.pack.capability]
end

local function d9_tracks_mixer_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D9_TRACKS_MIXER_WRITE_CAPABILITIES[request.pack.capability]
end

local function d11_project_marker_region_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D11_PROJECT_MARKER_REGION_CAPABILITIES[request.pack.capability]
end

local function d12_transport_safe_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D12_TRANSPORT_SAFE_CAPABILITIES[request.pack.capability]
end

local function d13_items_core_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D13_ITEMS_CORE_WRITE_CAPABILITIES[request.pack.capability]
end

local function d14_items_delete_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D14_ITEMS_DELETE_CAPABILITIES[request.pack.capability]
end

local function d15_items_source_phase_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D15_ITEMS_SOURCE_PHASE_CAPABILITIES[request.pack.capability]
end

local function d16_tracks_org_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D16_TRACKS_ORG_CAPABILITIES[request.pack.capability]
end

local function d17_midi_edit_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D17_MIDI_EDIT_CAPABILITIES[request.pack.capability]
end

local function d22_render_settings_write_capability(request, operation_key)
  if operation_key ~= "run_command:render.sample_rate.set" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D22_RENDER_SETTINGS_WRITE_CAPABILITIES[request.pack.capability]
end

local function d29_render_settings_write_capability(request, operation_key)
  if not D29_RENDER_SETTINGS_WRITE_CAPABILITIES[operation_key:gsub("^run_command:", "")] then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D29_RENDER_SETTINGS_WRITE_CAPABILITIES[request.pack.capability]
end

local function d29_render_job_operation(request, operation_key)
  local operation = D29_RENDER_JOB_OPERATIONS[operation_key]
  if not operation or not is_object(request and request.pack) then
    return nil
  end
  return operation
end

local function d29_render_output_metadata_operation(request, operation_key)
  if operation_key ~= "artifact_metadata:render.output.absolute_path"
    and operation_key ~= "artifact_metadata:render.output_file.metadata" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return { pack = "render", risk = "read" }
end

local function d30_project_container_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" and operation_key ~= "run_job:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D30_PROJECT_CONTAINER_CAPABILITIES[request.pack.capability]
end

local function d28_small_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D28_SMALL_WRITE_CAPABILITIES[request.pack.capability]
end

local function e2_fx_b1_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E2_FX_B1_WRITE_CAPABILITIES[request.pack.capability]
end

local function alpha3_2c3bc_project_file_save_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return ALPHA3_2C3BC_PROJECT_FILE_SAVE_CAPABILITIES[request.pack.capability]
end

local function template_execute_write_capability(request, operation_key)
  return safe_write_a_capability(request, operation_key)
    or e3_media_route_capability(request, operation_key)
    or e4_item_route_capability(request, operation_key)
    or e5_routing_write_capability(request, operation_key)
    or e5_automation_write_capability(request, operation_key)
    or e2_fx_b1_write_capability(request, operation_key)
    or d6_project_tempo_write_capability(request, operation_key)
    or d9_tracks_mixer_write_capability(request, operation_key)
    or d11_project_marker_region_capability(request, operation_key)
    or d13_items_core_write_capability(request, operation_key)
    or d14_items_delete_capability(request, operation_key)
    or d15_items_source_phase_capability(request, operation_key)
    or d16_tracks_org_capability(request, operation_key)
    or d17_midi_edit_capability(request, operation_key)
    or d22_render_settings_write_capability(request, operation_key)
    or d28_small_write_capability(request, operation_key)
    or d29_render_settings_write_capability(request, operation_key)
    or d30_project_container_capability(request, operation_key)
    or alpha3_2c3bc_project_file_save_capability(request, operation_key)
end

local function required_undo_capability(request, operation_key)
  return operation_key == "run_job:render.targets" or template_execute_write_capability(request, operation_key)
end

local function open_required_undo_block(request, operation_key)
  if not required_undo_capability(request, operation_key) then
    return
  end
  if not is_object(request) or not is_object(request.undo) or request.undo.mode ~= "required" then
    return
  end
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  project = ok_project and project or 0
  local ok = call_reaper("Undo_BeginBlock2", project)
  if not ok then
    ok = call_reaper("Undo_BeginBlock")
  end
  request.__openreaper_undo_opened = ok == true
end

local function close_required_undo_block(request, operation_key)
  if not required_undo_capability(request, operation_key) then
    return
  end
  if not is_object(request) or not is_object(request.undo) or request.undo.mode ~= "required" then
    return
  end
  local label = is_string(request.undo.label) and request.undo.label or "OpenReaper Safe-Write-A"
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  project = ok_project and project or 0
  local ok = call_reaper("Undo_EndBlock2", project, label, -1)
  if not ok then
    ok = call_reaper("Undo_EndBlock", label, -1)
  end
  request.__openreaper_undo_closed = ok == true
end

local function validate_request(request)
  if not is_object(request) then
    return false, "Bridge request must be an object."
  end
  if request.contract ~= CONTRACT then
    return false, "Bridge request contract must be foundation.bridge.v1."
  end
  if not is_request_id(request.id) then
    return false, "id must be a cmd_ request id."
  end
  if not is_string(request.created_at) then
    return false, "created_at must be a non-empty string."
  end
  if not is_object(request.client) or not is_string(request.client.id) or not is_string(request.client.session_id) then
    return false, "client.id and client.session_id are required."
  end
  if not is_object(request.bridge) or not is_string(request.bridge.expected_owner) then
    return false, "bridge.expected_owner is required."
  end
  if not is_non_negative_integer(request.bridge.expected_generation) then
    return false, "bridge.expected_generation must be a non-negative integer."
  end
  if not is_object(request.operation) or not is_string(request.operation.family) or not is_string(request.operation.name) then
    return false, "operation.family and operation.name are required."
  end
  if not FIXED_FAMILIES[request.operation.family] then
    return false, "operation.family is outside foundation.bridge.v1."
  end
  local operation_key = request.operation.family .. ":" .. request.operation.name
  local artifacts_allowed_for_operation = ARTIFACT_PRODUCING_OPERATIONS[operation_key] == true
  local a2_render_operation = operation_key == "run_job:render.region_wav"
  local safe_write_a_operation = safe_write_a_capability(request, operation_key)
  local e3_media_route_operation = e3_media_route_capability(request, operation_key)
  local e4_item_route_operation = e4_item_route_capability(request, operation_key)
  local e5_routing_write_operation = e5_routing_write_capability(request, operation_key)
  local e5_automation_write_operation = e5_automation_write_capability(request, operation_key)
  local e2_fx_b1_write_operation = e2_fx_b1_write_capability(request, operation_key)
  local d6_project_tempo_write_operation = d6_project_tempo_write_capability(request, operation_key)
  local d9_tracks_mixer_write_operation = d9_tracks_mixer_write_capability(request, operation_key)
  local d11_project_marker_region_operation = d11_project_marker_region_capability(request, operation_key)
  local d12_transport_safe_operation = d12_transport_safe_capability(request, operation_key)
  local d13_items_core_write_operation = d13_items_core_write_capability(request, operation_key)
  local d14_items_delete_operation = d14_items_delete_capability(request, operation_key)
  local d15_items_source_phase_operation = d15_items_source_phase_capability(request, operation_key)
  local d16_tracks_org_operation = d16_tracks_org_capability(request, operation_key)
  local d17_midi_edit_operation = d17_midi_edit_capability(request, operation_key)
  local d22_render_settings_write_operation = d22_render_settings_write_capability(request, operation_key)
  local d28_small_write_operation = d28_small_write_capability(request, operation_key)
  local d29_render_settings_write_operation = d29_render_settings_write_capability(request, operation_key)
  local d29_render_output_metadata = d29_render_output_metadata_operation(request, operation_key)
  local d29_render_job = d29_render_job_operation(request, operation_key)
  local d30_project_container_operation = d30_project_container_capability(request, operation_key)
  local alpha3_2c3bc_project_file_save_operation = alpha3_2c3bc_project_file_save_capability(request, operation_key)
  if not is_object(request.pack) or not FIXED_PACKS[request.pack.id] or not is_string(request.pack.capability) or not is_string(request.pack.risk) then
    return false, "pack.id, pack.capability, and pack.risk are required."
  end
  if a2_render_operation then
    if request.pack.id ~= "render" or request.pack.risk ~= "write" then
      return false, "A2 render_region_wav must be the render-owned write-risk route."
    end
  elseif safe_write_a_operation then
    if request.pack.id ~= safe_write_a_operation.pack or request.pack.risk ~= safe_write_a_operation.risk then
      return false, "Safe-Write-A request pack/capability/risk mismatch."
    end
  elseif e3_media_route_operation then
    if request.pack.id ~= e3_media_route_operation.pack or request.pack.risk ~= e3_media_route_operation.risk then
      return false, "E3 media route request pack/capability/risk mismatch."
    end
  elseif e4_item_route_operation then
    if request.pack.id ~= e4_item_route_operation.pack or request.pack.risk ~= e4_item_route_operation.risk then
      return false, "E4 item route request pack/capability/risk mismatch."
    end
  elseif e5_routing_write_operation then
    if request.pack.id ~= e5_routing_write_operation.pack or request.pack.risk ~= e5_routing_write_operation.risk then
      return false, "E5 routing write request pack/capability/risk mismatch."
    end
  elseif e5_automation_write_operation then
    if request.pack.id ~= e5_automation_write_operation.pack or request.pack.risk ~= e5_automation_write_operation.risk then
      return false, "E5 automation write request pack/capability/risk mismatch."
    end
  elseif e2_fx_b1_write_operation then
    if request.pack.id ~= e2_fx_b1_write_operation.pack or request.pack.risk ~= e2_fx_b1_write_operation.risk then
      return false, "E2 FX-B1 write request pack/capability/risk mismatch."
    end
  elseif d6_project_tempo_write_operation then
    if request.pack.id ~= d6_project_tempo_write_operation.pack or request.pack.risk ~= d6_project_tempo_write_operation.risk then
      return false, "D6 project tempo write request pack/capability/risk mismatch."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.pack.id ~= d9_tracks_mixer_write_operation.pack or request.pack.risk ~= d9_tracks_mixer_write_operation.risk then
      return false, "D9 tracks mixer write request pack/capability/risk mismatch."
    end
  elseif d11_project_marker_region_operation then
    if request.pack.id ~= d11_project_marker_region_operation.pack or request.pack.risk ~= d11_project_marker_region_operation.risk then
      return false, "D11 project marker/region request pack/capability/risk mismatch."
    end
  elseif d12_transport_safe_operation then
    if request.pack.id ~= d12_transport_safe_operation.pack or request.pack.risk ~= d12_transport_safe_operation.risk then
      return false, "D12 transport safe request pack/capability/risk mismatch."
    end
  elseif d13_items_core_write_operation then
    if request.pack.id ~= d13_items_core_write_operation.pack or request.pack.risk ~= d13_items_core_write_operation.risk then
      return false, "D13 items core request pack/capability/risk mismatch."
    end
  elseif d14_items_delete_operation then
    if request.pack.id ~= d14_items_delete_operation.pack or request.pack.risk ~= d14_items_delete_operation.risk then
      return false, "D14 items delete request pack/capability/risk mismatch."
    end
  elseif d15_items_source_phase_operation then
    if request.pack.id ~= d15_items_source_phase_operation.pack or request.pack.risk ~= d15_items_source_phase_operation.risk then
      return false, "D15 items source/phase request pack/capability/risk mismatch."
    end
  elseif d16_tracks_org_operation then
    if request.pack.id ~= d16_tracks_org_operation.pack or request.pack.risk ~= d16_tracks_org_operation.risk then
      return false, "D16 tracks organization request pack/capability/risk mismatch."
    end
  elseif d17_midi_edit_operation then
    if request.pack.id ~= d17_midi_edit_operation.pack or request.pack.risk ~= d17_midi_edit_operation.risk then
      return false, "D17 MIDI edit request pack/capability/risk mismatch."
    end
  elseif d22_render_settings_write_operation then
    if request.pack.id ~= d22_render_settings_write_operation.pack or request.pack.risk ~= d22_render_settings_write_operation.risk then
      return false, "D22 render settings write request pack/capability/risk mismatch."
    end
  elseif d28_small_write_operation then
    if request.pack.id ~= d28_small_write_operation.pack or request.pack.risk ~= d28_small_write_operation.risk then
      return false, "D28 small write request pack/capability/risk mismatch."
    end
  elseif d29_render_settings_write_operation then
    if request.pack.id ~= d29_render_settings_write_operation.pack or request.pack.risk ~= d29_render_settings_write_operation.risk then
      return false, "D29 render settings write request pack/capability/risk mismatch."
    end
  elseif d29_render_output_metadata then
    if request.pack.id ~= d29_render_output_metadata.pack or request.pack.risk ~= d29_render_output_metadata.risk then
      return false, "D29 render output metadata request pack/risk mismatch."
    end
  elseif d29_render_job then
    if request.pack.id ~= d29_render_job.pack or request.pack.risk ~= d29_render_job.risk then
      return false, "D29 render job request pack/risk mismatch."
    end
  elseif d30_project_container_operation then
    if request.pack.id ~= d30_project_container_operation.pack or request.pack.risk ~= d30_project_container_operation.risk then
      return false, "D30 project container request pack/capability/risk mismatch."
    end
  elseif alpha3_2c3bc_project_file_save_operation then
    if request.pack.id ~= alpha3_2c3bc_project_file_save_operation.pack or request.pack.risk ~= alpha3_2c3bc_project_file_save_operation.risk then
      return false, "Alpha3.2-C3BC project-file save request pack/capability/risk mismatch."
    end
  elseif request.pack.risk ~= "read" then
    return false, "OpenReaper live bridge accepts read-only live-smoke requests only."
  end
  if not is_object(request.params) then
    return false, "params must be a JSON object."
  end
  if not is_json_array(request.refs) then
    return false, "refs must be a JSON array."
  end
  if not is_object(request.undo) then
    return false, "undo policy is required."
  end
  if a2_render_operation then
    if request.undo.mode ~= "required" then
      return false, "A2 render_region_wav must use undo.mode required."
    end
  elseif safe_write_a_operation then
    if request.undo.mode ~= "required" then
      return false, "Safe-Write-A write/safe requests must use undo.mode required."
    end
  elseif e3_media_route_operation then
    if request.undo.mode ~= "required" then
      return false, "E3 media route write requests must use undo.mode required."
    end
  elseif e4_item_route_operation then
    if request.undo.mode ~= "required" then
      return false, "E4 item route write requests must use undo.mode required."
    end
  elseif e5_routing_write_operation then
    if request.undo.mode ~= "required" then
      return false, "E5 routing write requests must use undo.mode required."
    end
  elseif e5_automation_write_operation then
    if request.undo.mode ~= "required" then
      return false, "E5 automation write requests must use undo.mode required."
    end
  elseif e2_fx_b1_write_operation then
    if request.undo.mode ~= "required" then
      return false, "E2 FX-B1 write requests must use undo.mode required."
    end
  elseif d6_project_tempo_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D6 project tempo write requests must use undo.mode required."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D9 tracks mixer write requests must use undo.mode required."
    end
  elseif d11_project_marker_region_operation then
    if request.undo.mode ~= "required" then
      return false, "D11 project marker/region requests must use undo.mode required."
    end
  elseif d12_transport_safe_operation then
    if request.undo.mode ~= "required" then
      return false, "D12 transport safe requests must use undo.mode required."
    end
  elseif d13_items_core_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D13 items core write requests must use undo.mode required."
    end
  elseif d14_items_delete_operation then
    if request.undo.mode ~= "required" then
      return false, "D14 items delete requests must use undo.mode required."
    end
  elseif d15_items_source_phase_operation then
    if request.undo.mode ~= "required" then
      return false, "D15 items source/phase requests must use undo.mode required."
    end
  elseif d16_tracks_org_operation then
    if request.undo.mode ~= "required" then
      return false, "D16 tracks organization requests must use undo.mode required."
    end
  elseif d17_midi_edit_operation then
    if request.undo.mode ~= "required" then
      return false, "D17 MIDI edit requests must use undo.mode required."
    end
  elseif d22_render_settings_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D22 render settings write requests must use undo.mode required."
    end
  elseif d28_small_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D28 small write requests must use undo.mode required."
    end
  elseif d29_render_settings_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D29 render settings write requests must use undo.mode required."
    end
  elseif d29_render_job then
    if request.undo.mode ~= "required" then
      return false, "D29 render job requests must use undo.mode required."
    end
  elseif d30_project_container_operation then
    if request.undo.mode ~= "required" then
      return false, "D30 project container requests must use undo.mode required."
    end
  elseif alpha3_2c3bc_project_file_save_operation then
    if request.undo.mode ~= "required" then
      return false, "Alpha3.2-C3BC project-file save requests must use undo.mode required."
    end
  elseif request.undo.mode ~= "none" then
    return false, "read-only live-smoke requests must use undo.mode none."
  end
  if not is_object(request.verification) or not is_string(request.verification.mode) then
    return false, "verification.mode is required."
  end
  if request.verification.checks ~= nil and request.verification.checks ~= JSON_NULL and not is_json_array(request.verification.checks) then
    return false, "verification.checks must be a JSON array."
  end
  if not is_object(request.artifacts) or type(request.artifacts.allow) ~= "boolean" then
    return false, "artifacts.allow must be a boolean."
  end
  if artifacts_allowed_for_operation then
    if request.artifacts.allow ~= true then
      return false, "Scoped First-Real-Fixture-A artifact handlers require artifacts.allow true."
    end
  elseif safe_write_a_operation then
    if request.artifacts.allow ~= false then
      return false, "Safe-Write-A write/safe requests must use artifacts.allow false."
    end
  elseif e3_media_route_operation then
    if request.artifacts.allow ~= false then
      return false, "E3 media route write requests must use artifacts.allow false."
    end
  elseif e4_item_route_operation then
    if request.artifacts.allow ~= false then
      return false, "E4 item route write requests must use artifacts.allow false."
    end
  elseif e5_routing_write_operation then
    if request.artifacts.allow ~= false then
      return false, "E5 routing write requests must use artifacts.allow false."
    end
  elseif e5_automation_write_operation then
    if request.artifacts.allow ~= false then
      return false, "E5 automation write requests must use artifacts.allow false."
    end
  elseif e2_fx_b1_write_operation then
    if request.artifacts.allow ~= false then
      return false, "E2 FX-B1 write requests must use artifacts.allow false."
    end
  elseif d6_project_tempo_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D6 project tempo write requests must use artifacts.allow false."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D9 tracks mixer write requests must use artifacts.allow false."
    end
  elseif d11_project_marker_region_operation then
    if request.artifacts.allow ~= false then
      return false, "D11 project marker/region requests must use artifacts.allow false."
    end
  elseif d12_transport_safe_operation then
    if request.artifacts.allow ~= false then
      return false, "D12 transport safe requests must use artifacts.allow false."
    end
  elseif d13_items_core_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D13 items core write requests must use artifacts.allow false."
    end
  elseif d14_items_delete_operation then
    if request.artifacts.allow ~= false then
      return false, "D14 items delete requests must use artifacts.allow false."
    end
  elseif d15_items_source_phase_operation then
    if request.artifacts.allow ~= false then
      return false, "D15 items source/phase requests must use artifacts.allow false."
    end
  elseif d16_tracks_org_operation then
    if request.artifacts.allow ~= false then
      return false, "D16 tracks organization requests must use artifacts.allow false."
    end
  elseif d17_midi_edit_operation then
    if request.artifacts.allow ~= false then
      return false, "D17 MIDI edit requests must use artifacts.allow false."
    end
  elseif d22_render_settings_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D22 render settings write requests must use artifacts.allow false."
    end
  elseif d28_small_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D28 small write requests must use artifacts.allow false."
    end
  elseif d29_render_settings_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D29 render settings write requests must use artifacts.allow false."
    end
  elseif d29_render_output_metadata then
    if request.artifacts.allow ~= true then
      return false, "D29 render output metadata requests must use artifacts.allow true."
    end
  elseif d30_project_container_operation then
    if request.artifacts.allow ~= false then
      return false, "D30 project container requests must use artifacts.allow false."
    end
  elseif alpha3_2c3bc_project_file_save_operation then
    if request.artifacts.allow ~= false then
      return false, "Alpha3.2-C3BC project-file save requests must use artifacts.allow false."
    end
  elseif request.artifacts.allow ~= false then
    return false, "Only scoped First-Real-Fixture-A artifact handlers may write artifacts."
  end
  local budget = request.budget
  if not is_object(budget)
    or not (is_non_negative_integer(budget.max_response_bytes) and budget.max_response_bytes > 0)
    or not (is_non_negative_integer(budget.max_items) and budget.max_items > 0)
    or not (is_non_negative_integer(budget.max_inline_value_bytes) and budget.max_inline_value_bytes > 0) then
    return false, "budget must include positive integer limits."
  end
  if not (is_non_negative_integer(request.timeout_ms) and request.timeout_ms > 0) then
    return false, "timeout_ms must be a positive integer."
  end
  if a2_render_operation then
    if not is_string(request.idempotency_key) then
      return false, "A2 render_region_wav requires an idempotency_key."
    end
  elseif safe_write_a_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "Safe-Write-A idempotency_key must be a string when present."
    end
  elseif e3_media_route_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E3 media route idempotency_key must be a string when present."
    end
  elseif e4_item_route_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E4 item route idempotency_key must be a string when present."
    end
  elseif e5_routing_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E5 routing write idempotency_key must be a string when present."
    end
  elseif e5_automation_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E5 automation write idempotency_key must be a string when present."
    end
  elseif e2_fx_b1_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E2 FX-B1 write idempotency_key must be a string when present."
    end
  elseif d6_project_tempo_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D6 project tempo write idempotency_key must be a string when present."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D9 tracks mixer write idempotency_key must be a string when present."
    end
  elseif d11_project_marker_region_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D11 project marker/region idempotency_key must be a string when present."
    end
  elseif d12_transport_safe_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D12 transport safe idempotency_key must be a string when present."
    end
  elseif d13_items_core_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D13 items core idempotency_key must be a string when present."
    end
  elseif d14_items_delete_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D14 items delete idempotency_key must be a string when present."
    end
  elseif d15_items_source_phase_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D15 items source/phase idempotency_key must be a string when present."
    end
  elseif d16_tracks_org_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D16 tracks organization idempotency_key must be a string when present."
    end
  elseif d17_midi_edit_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D17 MIDI edit idempotency_key must be a string when present."
    end
  elseif d22_render_settings_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D22 render settings write idempotency_key must be a string when present."
    end
  elseif d28_small_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D28 small write idempotency_key must be a string when present."
    end
  elseif d29_render_settings_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D29 render settings write idempotency_key must be a string when present."
    end
  elseif operation_key == "run_job:render.targets" then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL then
      return false, "D31 render targets does not accept an idempotency_key; each request has a fresh managed output identity."
    end
  elseif d29_render_job then
    if not is_string(request.idempotency_key) then
      return false, "D29 render jobs require an idempotency_key."
    end
  elseif d30_project_container_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D30 project container idempotency_key must be a string when present."
    end
  elseif alpha3_2c3bc_project_file_save_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "Alpha3.2-C3BC project-file save idempotency_key must be a string when present."
    end
  elseif request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL then
    return false, "read-only live-smoke requests must not carry idempotency_key."
  end
  return true
end

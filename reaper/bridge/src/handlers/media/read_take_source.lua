-- Extracted read-only handler: template.media.read_take_source.

local function read_take_source(request)
  local take = READ_B_MEDIA.resolve_take_for_request(request)
  if not take then
    return READ_B_MEDIA.handler_error("TAKE_NOT_FOUND", "Take source read requires a resolvable take ref.", {})
  end
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Take source could not be read.", {
      take_ref = READ_B_MEDIA.take_ref_string(take),
    })
  end
  local filename = READ_B_MEDIA.source_filename_raw(source)
  local file_ref = nil
  if filename ~= "" then
    local path, budget_error = READ_B_MEDIA.ensure_read_identity_budget(request, filename, 2)
    if not path then
      return nil, budget_error
    end
    file_ref = READ_B_MEDIA.file_ref_for_path(path)
    if not file_ref then
      return READ_B_MEDIA.handler_error("PARAMS_INVALID", "Take source filename is invalid for canonical absolute file identity.", {
        take_ref = READ_B_MEDIA.take_ref_string(take),
        path = READ_B_MEDIA.display_path(filename, 240),
        path_bytes = #filename,
      })
    end
    filename = path
  end
  local length, _ = READ_B_MEDIA.source_length(source)
  local ok_take_name, _, take_name = call_reaper("GetSetMediaItemTakeInfo_String", take, "P_NAME", "", false)
  local summary = {
    take_ref = READ_B_MEDIA.take_ref_string(take),
    file_ref = file_ref or JSON_NULL,
    source_type = READ_B_MEDIA.source_type(source),
    take_name = ok_take_name and type(take_name) == "string" and take_name or JSON_NULL,
    filename = filename,
    length_seconds = length,
    channel_count = READ_B_MEDIA.source_channels(source),
    offline = filename ~= "" and not file_exists(filename) or false,
    metadata_keys = READ_B_MEDIA.metadata_keys_for_source(source, request.params.include_metadata_keys),
  }
  if request.params.include_parent_source == true then
    local ok_parent, parent = call_reaper("GetMediaSourceParent", source)
    summary.parent_source_type = ok_parent and parent and READ_B_MEDIA.source_type(parent) or nil
  end
  return summary
end

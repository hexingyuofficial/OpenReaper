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
  local filename = READ_B_MEDIA.source_filename(source)
  local length, _ = READ_B_MEDIA.source_length(source)
  local summary = {
    take_ref = READ_B_MEDIA.take_ref_string(take),
    file_ref = filename ~= "" and READ_B_MEDIA.file_ref_for_path(filename) or JSON_NULL,
    source_type = READ_B_MEDIA.source_type(source),
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

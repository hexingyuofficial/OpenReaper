-- Extracted read-only handler: template.media.read_project_media_files.

local function read_project_media_files(request)
  local max_sources = READ_B_MEDIA.bounded_limit(request, request.params.max_sources, 25, 100)
  local include_offline = request.params.include_offline == true
  local seen = {}
  local file_refs = json_array({})
  local offline_count = 0
  local source_count = 0
  local truncated = false
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0

  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for take_index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if ok_take and take then
          local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
          if ok_source and source then
            local filename = READ_B_MEDIA.source_filename_raw(source)
            if filename ~= "" and not seen[filename] then
              seen[filename] = true
              local offline = not file_exists(filename)
              if offline then
                offline_count = offline_count + 1
              end
              if include_offline or not offline then
                source_count = source_count + 1
                if #file_refs < max_sources then
                  file_refs[#file_refs + 1] = READ_B_MEDIA.file_ref_for_path(filename)
                else
                  truncated = true
                end
              end
            end
          end
        end
      end
    end
  end

  return {
    source_count = source_count,
    file_refs = file_refs,
    offline_count = offline_count,
    truncated = truncated,
  }
end

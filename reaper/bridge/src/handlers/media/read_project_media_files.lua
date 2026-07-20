-- Extracted read-only handler: template.media.read_project_media_files.

local function read_project_media_files(request)
  local max_sources = READ_B_MEDIA.bounded_limit(request, request.params.max_sources, 25, 100)
  local include_offline = request.params.include_offline == true
  local seen = {}
  local offline_count = 0
  local candidates = json_array({})
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
            if filename ~= "" then
              -- Absolute identity validation before seen/offline/include filtering.
              local path, path_reason = READ_B_MEDIA.canonical_path(filename)
              if not path then
                return READ_B_MEDIA.handler_error("PARAMS_INVALID", "Project media source path is invalid for canonical absolute file identity.", {
                  blocker = path_reason or "invalid_path",
                  path = READ_B_MEDIA.display_path(filename, 240),
                  path_bytes = #filename,
                })
              end
              if not seen[path] then
                seen[path] = true
                local offline = not file_exists(path)
                if offline then
                  offline_count = offline_count + 1
                end
                if include_offline or not offline then
                  -- Inline budget only when a file_ref row will actually be included.
                  local budget_path, path_error = READ_B_MEDIA.ensure_identity_inline_budget(request, path)
                  if not budget_path then
                    return nil, path_error
                  end
                  local file_ref = READ_B_MEDIA.file_ref_for_path(budget_path)
                  if not file_ref then
                    return READ_B_MEDIA.handler_error("PARAMS_INVALID", "Project media source path is invalid for canonical absolute file identity.", {
                      path = READ_B_MEDIA.display_path(path, 240),
                      path_bytes = #path,
                    })
                  end
                  candidates[#candidates + 1] = file_ref
                end
              end
            end
          end
        end
      end
    end
  end

  local source_count = #candidates
  local budget = safe_budget(request)

  local function build_summary(file_refs, truncated)
    return {
      source_count = source_count,
      file_refs = file_refs,
      offline_count = offline_count,
      truncated = truncated,
    }
  end

  local function page_fits(file_refs, truncated)
    local summary = build_summary(file_refs, truncated)
    local fits, required_bytes = READ_B_MEDIA.complete_success_envelope_fits(request, summary, json_array({}), {
      undo_opened = false,
      undo_closed = false,
      verification_status = "passed",
    })
    return fits, required_bytes, summary
  end

  if source_count == 0 then
    local empty = json_array({})
    local fits, encoded_bytes, summary = page_fits(empty, false)
    if not fits then
      return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "Project media empty page cannot fit within the complete success envelope budget.", {
        blocker = "empty_page_exceeds_budget",
        required_response_bytes = encoded_bytes,
        max_response_bytes = budget.max_response_bytes,
        max_inline_value_bytes = budget.max_inline_value_bytes,
        proof = "complete_success_envelope",
      })
    end
    return summary
  end

  local file_refs = json_array({})
  local limit = math.min(max_sources, source_count)
  for index = 1, limit do
    file_refs[#file_refs + 1] = candidates[index]
  end

  while #file_refs > 0 do
    local truncated = #file_refs < source_count
    local fits = page_fits(file_refs, truncated)
    if fits then
      break
    end
    table.remove(file_refs)
  end

  if #file_refs == 0 then
    local single = json_array({ candidates[1] })
    local fits, encoded_bytes = page_fits(single, source_count > 1)
    if not fits then
      return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "One project media identity row cannot fit within the complete success envelope budget.", {
        blocker = "single_identity_row_exceeds_budget",
        required_response_bytes = encoded_bytes,
        max_response_bytes = budget.max_response_bytes,
        max_inline_value_bytes = budget.max_inline_value_bytes,
        file_ref = candidates[1],
        proof = "complete_success_envelope",
      })
    end
    file_refs = single
  end

  local truncated = #file_refs < source_count
  local fits, encoded_bytes, summary = page_fits(file_refs, truncated)
  if not fits then
    return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "Project media empty page cannot fit within the complete success envelope budget.", {
      blocker = "empty_page_exceeds_budget",
      required_response_bytes = encoded_bytes,
      max_response_bytes = budget.max_response_bytes,
      proof = "complete_success_envelope",
    })
  end
  return summary
end

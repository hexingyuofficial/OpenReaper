-- Extracted Wave 1A handler: template.system.check_api_symbols.

local CHECK_API_SYMBOLS_CORE_RUNTIME_SYMBOLS = json_array({
  "APIExists",
  "CountMediaItems",
  "CountProjectMarkers",
  "CountSelectedMediaItems",
  "CountTempoTimeSigMarkers",
  "CountTracks",
  "EnumProjectMarkers3",
  "EnumProjects",
  "GetAppVersion",
  "GetCursorPosition",
  "GetMediaItem",
  "GetMediaItemInfo_Value",
  "GetOS",
  "GetProjectLength",
  "GetProjectName",
  "GetResourcePath",
  "GetSelectedMediaItem",
  "GetTrack",
  "GetTrackGUID",
})

local CHECK_API_SYMBOLS_EXTENSION_PROBE_SYMBOLS = json_array({
  "APIExists",
  "BR_GetMediaItemGUID",
  "CF_GetSWSVersion",
  "SNM_GetIntConfigVar",
})

local function check_api_symbols_profile_defaults(profile)
  if profile == "extension_probe" then
    return CHECK_API_SYMBOLS_EXTENSION_PROBE_SYMBOLS
  end
  return CHECK_API_SYMBOLS_CORE_RUNTIME_SYMBOLS
end

local function check_api_symbols_valid_name(name)
  return is_string(name) and name:match("^[A-Za-z_][A-Za-z0-9_]*$") ~= nil
end

local function check_api_symbols_available(name)
  if not reaper then
    return false
  end
  if type(reaper.APIExists) == "function" then
    local ok, exists = pcall(reaper.APIExists, name)
    if ok and type(exists) == "boolean" then
      return exists
    end
  end
  return type(reaper[name]) == "function"
end

local function check_api_symbols_bounded_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit or budget.max_items
  if is_non_negative_integer(requested) and requested > 0 then
    limit = requested
  end
  limit = math.min(limit, budget.max_items, hard_limit or budget.max_items)
  if limit < 1 then
    return 1
  end
  return limit
end

local function read_api_symbols(request)
  local profile = is_string(request.params.profile) and request.params.profile or "core_runtime"
  local source = is_json_array(request.params.symbols) and request.params.symbols or check_api_symbols_profile_defaults(profile)
  local limit = check_api_symbols_bounded_limit(request, request.params.max_symbols, 16, 50)
  local symbols = json_array({})
  local unavailable_count = 0
  local scanned = 0

  for index = 1, #source do
    if scanned >= limit then
      break
    end
    local name = source[index]
    if type(name) == "string" then
      scanned = scanned + 1
      local valid = check_api_symbols_valid_name(name)
      local available = valid and check_api_symbols_available(name) or false
      if not available then
        unavailable_count = unavailable_count + 1
      end
      symbols[#symbols + 1] = {
        name = bounded_string(name, 120),
        available = available,
        reason = valid and nil or "invalid_symbol_name",
      }
    end
  end

  return {
    profile = profile,
    symbol_count = #symbols,
    symbols = symbols,
    unavailable_count = unavailable_count,
    truncated = #source > limit,
  }
end

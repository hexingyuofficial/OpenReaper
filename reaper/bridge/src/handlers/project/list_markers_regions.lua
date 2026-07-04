-- Extracted Wave 1A handler: template.project.list_markers_regions.

local function list_markers_regions_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function list_markers_regions_bounded_limit(request, requested, default_limit, hard_limit)
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

local function list_markers_regions_marker_ref(kind, index_number)
  local prefix = kind == "region" and "region" or "marker"
  return prefix .. ":index:" .. tostring(index_number or 0)
end

local function list_markers_regions(request)
  local project = list_markers_regions_current_project()
  local include_markers = request.params.include_markers ~= false
  local include_regions = request.params.include_regions ~= false
  local limit = list_markers_regions_bounded_limit(request, request.params.limit, 50, 50)
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total_markers = ok_count and first_number(marker_count) or 0
  local total_regions = ok_count and first_number(region_count) or 0
  local total = total_markers + total_regions
  local items = json_array({})
  local included_count = 0

  for index = 0, math.max(total - 1, -1) do
    local ok_enum, retval, is_region, pos, region_end, name, index_number, color = call_reaper("EnumProjectMarkers3", project, index)
    if ok_enum and retval then
      local kind = is_region and "region" or "marker"
      local include = (kind == "marker" and include_markers) or (kind == "region" and include_regions)
      if include then
        included_count = included_count + 1
        if #items < limit then
          local item = {
            kind = kind,
            name = bounded_string(name or "", 160),
            index = index_number or included_count,
            position_seconds = first_number(pos) or 0,
            color_native = type(color) == "number" and color or nil,
          }
          if kind == "region" then
            item.region_ref = list_markers_regions_marker_ref("region", index_number)
            item.end_seconds = first_number(region_end) or item.position_seconds
          else
            item.marker_ref = list_markers_regions_marker_ref("marker", index_number)
          end
          items[#items + 1] = item
        end
      end
    end
  end

  return {
    items = items,
    marker_count = include_markers and total_markers or 0,
    region_count = include_regions and total_regions or 0,
    truncated = included_count > #items,
  }
end

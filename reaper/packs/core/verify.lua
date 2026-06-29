-- verify.lua — structural before/after checks for mutating templates.
--
-- Slice 04 intentionally verifies only entity-count deltas. Field-level
-- checks (e.g. "D_PITCH equals params.semitones") are deferred to Slice 05.

local M = {}

function M.count_regions()
  local total = 0
  local i = 0
  while true do
    local retval, isrgn = reaper.EnumProjectMarkers3(0, i)
    if retval == 0 then break end
    if isrgn then total = total + 1 end
    i = i + 1
  end
  return total
end

function M.snapshot()
  return {
    items   = reaper.CountMediaItems(0),
    tracks  = reaper.CountTracks(0),
    regions = M.count_regions(),
  }
end

function M.diff(before, after)
  return {
    items   = after.items   - before.items,
    tracks  = after.tracks  - before.tracks,
    regions = after.regions - before.regions,
  }
end

local function entity_key(entity_kind)
  if entity_kind == "item" then return "items" end
  if entity_kind == "track" then return "tracks" end
  if entity_kind == "region" then return "regions" end
  return nil
end

function M.check(expected, changed_ids, delta, entity_kind, changed_count_override)
  if type(expected) ~= "table" then return "expected_delta must be an object" end
  if type(changed_ids) ~= "table" then changed_ids = {} end

  local changed_count = changed_count_override
  if type(changed_count) ~= "number" then changed_count = #changed_ids end
  local count = expected.count
  if count == "any" then
    if changed_count < 1 then return "changed_count=0 but expected >=1" end
  elseif type(count) == "number" then
    if changed_count ~= count then
      return ("changed_count=%d but expected=%d"):format(changed_count, count)
    end
  else
    return "expected_delta.count must be a number or 'any'"
  end

  local key = entity_key(entity_kind)
  if not key then
    return ("verify: unknown entity_kind=%s"):format(tostring(entity_kind))
  end
  local d = delta[key]
  if type(d) ~= "number" then
    return ("verify: missing delta_%s"):format(key)
  end

  local count_val = count == "any" and changed_count or count
  if expected.creates then
    if count == "any" then
      if d < count_val then
        return ("delta_%s=%d but expected >=%d (creates)"):format(key, d, count_val)
      end
    elseif d ~= count_val then
      return ("delta_%s=%d but expected +%d (creates)"):format(key, d, count_val)
    end
  elseif expected.maybeCreates then
    if d ~= 0 and d ~= count_val then
      return ("delta_%s=%d but expected 0 or +%d (maybeCreates)"):format(key, d, count_val)
    end
  elseif expected.deletes then
    if d ~= -count_val then
      return ("delta_%s=%d but expected -%d (deletes)"):format(key, d, count_val)
    end
  else
    if d ~= 0 then
      return ("delta_%s=%d but expected 0 (in-place)"):format(key, d)
    end
  end

  return nil
end

return M

-- templates/region.lua — region-scoped templates.
--
-- Handler convention matches templates/item.lua and templates/track.lua:
--   `function(params, ctx) -> { changed_ids = {...} }`
--   `params` already passed the TS Zod schema (mode-exclusivity refinement
--           + bounds checks live there; this handler reads the present
--           fields). The TS schema does NOT check the name's content beyond
--           min(1) — name-content rules (path separators, NUL, `$`) live
--           in lib/names.lua and are shared with render.lua's render-time
--           re-validation (Step 7 B1). REGION_NAME_INVALID stays Lua-only.
--   `ctx` has `refs`, `last_result`, `json`.
--
-- Errors raise via `error({ code = ..., message = ... })`. Dispatcher
-- translates into typed envelopes.
--
-- changed_ids format: `region:<name>`. UNLIKE items/tracks (which use
-- `guid:{...}`), regions have NO native GUID API in REAPER 7 —
-- AddProjectMarker2 returns an unstable integer index that renumbers on
-- any marker delete. v0.1 pins the name as the user-facing identity
-- (uniqueness enforced here at create time). LAST_RESULT.regions therefore
-- stores name-shaped strings, and refs.lua's resolve_last_result_region
-- re-scans by name. See IMPLEMENTATION_PLAN.md § Step 5 + the Step 5
-- design decisions in HANDOFF.md.

local PACK_DIR = (function()
  local src = debug.getinfo(1, "S").source
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  -- We're at packs/core/templates/region.lua; lib/ is one level up.
  local templates_dir = src:match("(.*/)") or "./"
  return templates_dir:gsub("templates/$", "")
end)()

local names = dofile(PACK_DIR .. "lib/names.lua")

local M = {}

local function raise(code, message)
  error({ code = code, message = message })
end

-- Scan the project's marker/region table for a REGION (not a plain marker)
-- with the supplied name. Returns the index when found, nil otherwise.
-- Only used here for the pre-create uniqueness check; refs.lua has its own
-- copy because resolve also needs pos/rgnend back.
local function find_region_by_name(name)
  -- EnumProjectMarkers3 yields:
  --   retval, isrgn, pos, rgnend, name, markrgnindexnumber, color
  local i = 0
  while true do
    local retval, isrgn, _, _, n = reaper.EnumProjectMarkers3(0, i)
    if retval == 0 then return nil end
    if isrgn and n == name then return i end
    i = i + 1
  end
end

-- region_create: insert a named project region.
--
-- Two modes (TS schema enforces XOR + bounds; this handler reads whichever
-- fields are present):
--   { name, start, end } — explicit bounds in project seconds.
--   { name, item_id }    — bounds = [position, position + length] of the
--                          resolved item. Per IMPLEMENTATION_PLAN.md § Step 5
--                          pitfalls: fades are within D_LENGTH so we do NOT
--                          add fade-out duration.
--
-- Name rules live in lib/names.lua (Step 7 B1 unified them; same rule set
-- runs at render time in render.lua):
--   * empty / non-string  → REGION_NAME_INVALID
--   * contains /, \, NUL, $ → REGION_NAME_INVALID (path-separator escape,
--                              libc NUL-truncation, render-pattern token)
--   * already taken       → REGION_NAME_TAKEN (no AddProjectMarker2 call —
--                            preserves the "error → no change" contract)
function M.region_create(params, ctx)
  local name_ok, name_msg = names.validate_region_name(params.name)
  if not name_ok then
    raise("REGION_NAME_INVALID", name_msg)
  end

  if find_region_by_name(params.name) then
    raise("REGION_NAME_TAKEN",
      "A region named '" .. params.name .. "' already exists")
  end

  local rstart, rend
  if params.item_id ~= nil then
    local item, code, msg = ctx.refs.resolve_item(params.item_id, ctx.last_result)
    if not item then raise(code or "ITEM_NOT_FOUND", msg or "Item not found") end
    local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
    local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
    rstart = pos
    rend   = pos + len
  else
    -- `end` is a Lua keyword, so the JSON-decoded table field is read via
    -- bracket notation. The TS Zod superRefine guarantees both `start` and
    -- `end` are present when item_id is absent and that end > start >= 0.
    rstart = params.start
    rend   = params["end"]
  end

  -- AddProjectMarker2(proj, isrgn, pos, rgnend, name, wantidx, color)
  --   wantidx = -1 → REAPER assigns. Negative return means failure.
  -- We discard the returned index because v0.1's region identity is the
  -- name (indices renumber on any marker delete).
  local idx = reaper.AddProjectMarker2(0, true, rstart, rend, params.name, -1, 0)
  if idx < 0 then
    raise("INTERNAL_ERROR",
      "AddProjectMarker2 returned " .. tostring(idx) .. " for region '"
        .. params.name .. "'")
  end

  reaper.UpdateArrange()

  return { changed_ids = { "region:" .. params.name } }
end

return M

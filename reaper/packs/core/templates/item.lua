-- templates/item.lua — item-scoped templates.
--
-- Each handler is `function(params, ctx) -> { changed_ids = {...} }`.
--   `params` has already been validated by the TS-side Zod schema; do not
--           re-validate types here. Only validate runtime-only conditions
--           (item exists, take exists, etc).
--   `ctx`    is `{ refs = refs_module, last_result = bridge_table }`.
--           Hand `last_result` to refs so Step 4's `last_result:item:N`
--           resolution lands without churn here.
--
-- Errors are raised via `error({ code = "...", message = "..." })`. The
-- dispatcher catches and translates these into proper error envelopes.
-- DO NOT `error("string")` — typed codes are part of the protocol.
--
-- The result table is `{ changed_ids = { "guid:{...}", ... } }`. The
-- dispatcher reads ONLY this field. Any other field (e.g. you sneak in a
-- descriptor) is silently dropped. See docs/RESPONSE_BUDGET.md.

local M = {}

local function raise(code, message)
  error({ code = code, message = message })
end

local function get_item_guid_ref(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, "GUID", "", false)
  if not guid or guid == "" then
    raise("INTERNAL_ERROR", "REAPER returned no GUID for the mutated item")
  end
  return "guid:" .. guid
end

-- item_pitch: set the active take's D_PITCH to `params.semitones`.
--
-- Note: pitch is a TAKE property in REAPER, not a media item property.
-- An empty MIDI item with no takes can be selected but cannot be pitched —
-- TAKE_NOT_FOUND is the correct error there.
function M.item_pitch(params, ctx)
  local item, code, msg = ctx.refs.resolve_item(params.item_id, ctx.last_result)
  if not item then raise(code or "ITEM_NOT_FOUND", msg or "Item not found") end

  local take = reaper.GetActiveTake(item)
  if not take then
    raise("TAKE_NOT_FOUND", "Item has no active take to pitch")
  end

  reaper.SetMediaItemTakeInfo_Value(take, "D_PITCH", params.semitones)
  -- Without UpdateArrange the item properties dialog will not refresh until
  -- the user clicks somewhere. Cheap and idempotent; call it.
  reaper.UpdateArrange()

  return { changed_ids = { get_item_guid_ref(item) } }
end

-- item_move: set D_POSITION; optionally reparent via MoveMediaItemToTrack.
--
-- Order matters: if we reparent first then set position, REAPER may
-- briefly show the item at the old position on the new track. If we set
-- position first then reparent, the reverse. Both are visually fine after
-- UpdateArrange; we pick reparent → position because REAPER's API docs
-- recommend MoveMediaItemToTrack first when both change.
function M.item_move(params, ctx)
  local item, code, msg = ctx.refs.resolve_item(params.item_id, ctx.last_result)
  if not item then raise(code or "ITEM_NOT_FOUND", msg or "Item not found") end

  if params.to_track_id ~= nil then
    local track, tcode, tmsg = ctx.refs.resolve_track(
      params.to_track_id, ctx.last_result
    )
    if not track then
      raise(tcode or "TRACK_NOT_FOUND", tmsg or "Target track not found")
    end
    -- MoveMediaItemToTrack returns false when source == target. That's a
    -- valid no-op under the template's idempotent contract, not an error.
    -- Skip the call rather than try to disambiguate REAPER's false return.
    if reaper.GetMediaItem_Track(item) ~= track then
      local ok_move = reaper.MoveMediaItemToTrack(item, track)
      if not ok_move then
        raise("INTERNAL_ERROR", "MoveMediaItemToTrack returned false")
      end
    end
  end

  reaper.SetMediaItemInfo_Value(item, "D_POSITION", params.position)
  reaper.UpdateArrange()

  return { changed_ids = { get_item_guid_ref(item) } }
end

-- item_rate: set the active take's D_PLAYRATE.
--
-- B_PPITCH is the "preserve pitch when changing rate" flag. We set it to
-- false (0) unconditionally so rate changes affect pitch — see the Step 4
-- pitfalls note in IMPLEMENTATION_PLAN.md. A future `item_rate_preserve`
-- template can flip the bit when there's a demand for it.
function M.item_rate(params, ctx)
  local item, code, msg = ctx.refs.resolve_item(params.item_id, ctx.last_result)
  if not item then raise(code or "ITEM_NOT_FOUND", msg or "Item not found") end

  local take = reaper.GetActiveTake(item)
  if not take then
    raise("TAKE_NOT_FOUND", "Item has no active take to rate")
  end

  reaper.SetMediaItemTakeInfo_Value(take, "B_PPITCH", 0)
  reaper.SetMediaItemTakeInfo_Value(take, "D_PLAYRATE", params.rate)
  reaper.UpdateArrange()

  return { changed_ids = { get_item_guid_ref(item) } }
end

-- item_trim: set the item's D_LENGTH; optionally set the take's
-- D_STARTOFFS (in source-media seconds, NOT project seconds — see the
-- Step 4 pitfalls).
--
-- start_offset is take-scoped, length is item-scoped: an empty MIDI item
-- with no active take still gets its length set; only the offset path
-- raises TAKE_NOT_FOUND if the take is missing AND start_offset was
-- supplied.
--
-- Resolve the active take BEFORE writing D_LENGTH when start_offset is
-- supplied: otherwise an empty-take item raises TAKE_NOT_FOUND with the
-- length already mutated, violating the "error → no change" contract.
function M.item_trim(params, ctx)
  local item, code, msg = ctx.refs.resolve_item(params.item_id, ctx.last_result)
  if not item then raise(code or "ITEM_NOT_FOUND", msg or "Item not found") end

  local take = nil
  if params.start_offset ~= nil then
    take = reaper.GetActiveTake(item)
    if not take then
      raise("TAKE_NOT_FOUND", "Item has no active take to set start_offset on")
    end
  end

  reaper.SetMediaItemInfo_Value(item, "D_LENGTH", params.length)
  if take then
    reaper.SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", params.start_offset)
  end

  reaper.UpdateArrange()

  return { changed_ids = { get_item_guid_ref(item) } }
end

-- item_duplicate: deterministic manual duplication. NOT a clipboard action.
--
-- Spec (IMPLEMENTATION_PLAN.md § Step 4 pitfalls) explicitly forbids
-- Main_OnCommand(41295) — the clipboard action leaks selection state and
-- depends on the global REAPER clipboard. Instead we:
--   AddMediaItemToTrack(target)         -- new empty item
--   AddTakeToMediaItem(item)            -- new empty take
--   SetMediaItemTake_Source(take, src)  -- point at source media
-- and copy the take/item attributes that meaningfully define "the same
-- audio playing at a chosen point": length, fades, take rate/pitch/offset,
-- preserve-pitch flag, and the take name. Color, volume envelopes, FX, and
-- locked status are NOT carried over in v0.1 — agents asking for those
-- get a new template later.
--
-- Not idempotent (each call adds an item). MVP.md locks all three params
-- required so duplication target is always explicit in the call.
function M.item_duplicate(params, ctx)
  local src_item, icode, imsg = ctx.refs.resolve_item(params.item_id, ctx.last_result)
  if not src_item then raise(icode or "ITEM_NOT_FOUND", imsg or "Source item not found") end

  local target_track, tcode, tmsg = ctx.refs.resolve_track(params.track_id, ctx.last_result)
  if not target_track then
    raise(tcode or "TRACK_NOT_FOUND", tmsg or "Target track not found")
  end

  local src_take = reaper.GetActiveTake(src_item)
  local src_source = nil
  if src_take then
    src_source = reaper.GetMediaItemTake_Source(src_take)
  end

  local new_item = reaper.AddMediaItemToTrack(target_track)
  if not new_item then
    raise("INTERNAL_ERROR", "AddMediaItemToTrack returned nil for the duplicate target")
  end

  -- Item-scoped attributes that define the duplicate's footprint on the
  -- timeline. Length first, then fades — REAPER tolerates either order but
  -- length sets the upper bound on fade length internally.
  reaper.SetMediaItemInfo_Value(new_item, "D_POSITION", params.position)
  reaper.SetMediaItemInfo_Value(new_item, "D_LENGTH",
    reaper.GetMediaItemInfo_Value(src_item, "D_LENGTH"))
  reaper.SetMediaItemInfo_Value(new_item, "D_FADEINLEN",
    reaper.GetMediaItemInfo_Value(src_item, "D_FADEINLEN"))
  reaper.SetMediaItemInfo_Value(new_item, "D_FADEOUTLEN",
    reaper.GetMediaItemInfo_Value(src_item, "D_FADEOUTLEN"))

  -- Take-scoped attributes. If the source has no active take (empty MIDI
  -- item), we still leave the duplicate empty rather than fabricate a take —
  -- that matches the source's audible content.
  if src_take and src_source then
    local new_take = reaper.AddTakeToMediaItem(new_item)
    if not new_take then
      raise("INTERNAL_ERROR", "AddTakeToMediaItem returned nil for the duplicate")
    end
    reaper.SetMediaItemTake_Source(new_take, src_source)
    reaper.SetMediaItemTakeInfo_Value(new_take, "D_STARTOFFS",
      reaper.GetMediaItemTakeInfo_Value(src_take, "D_STARTOFFS"))
    reaper.SetMediaItemTakeInfo_Value(new_take, "D_PLAYRATE",
      reaper.GetMediaItemTakeInfo_Value(src_take, "D_PLAYRATE"))
    reaper.SetMediaItemTakeInfo_Value(new_take, "D_PITCH",
      reaper.GetMediaItemTakeInfo_Value(src_take, "D_PITCH"))
    reaper.SetMediaItemTakeInfo_Value(new_take, "B_PPITCH",
      reaper.GetMediaItemTakeInfo_Value(src_take, "B_PPITCH"))
    local _, src_name = reaper.GetSetMediaItemTakeInfo_String(src_take, "P_NAME", "", false)
    if src_name and src_name ~= "" then
      reaper.GetSetMediaItemTakeInfo_String(new_take, "P_NAME", src_name, true)
    end
  end

  reaper.UpdateArrange()

  return { changed_ids = { get_item_guid_ref(new_item) } }
end

-- item_fade: three-state fade setter. First user of ctx.json.null.
--
-- Per docs/TEMPLATE_SPEC.md § Nullable Params:
--   nil               → leave the current value alone
--   ctx.json.null     → clear (set length to 0)
--   number ≥ 0        → set that length in seconds
--
-- The two fields are independent: passing only `fade_in` doesn't touch
-- D_FADEOUTLEN. Idempotent because every state produces the same final
-- value when called again with the same input.
function M.item_fade(params, ctx)
  local item, code, msg = ctx.refs.resolve_item(params.item_id, ctx.last_result)
  if not item then raise(code or "ITEM_NOT_FOUND", msg or "Item not found") end

  local function apply(value, key)
    if value == nil then return end
    if value == ctx.json.null then
      reaper.SetMediaItemInfo_Value(item, key, 0)
      return
    end
    reaper.SetMediaItemInfo_Value(item, key, value)
  end

  apply(params.fade_in,  "D_FADEINLEN")
  apply(params.fade_out, "D_FADEOUTLEN")

  reaper.UpdateArrange()

  return { changed_ids = { get_item_guid_ref(item) } }
end

return M

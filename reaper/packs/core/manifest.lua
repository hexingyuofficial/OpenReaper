-- Streetlight core pack manifest.
--
-- The bridge dofile's this and uses the returned table to dispatch
-- `kind = "template"` commands. Templates are looked up by their
-- agent-facing name (matching the registration in
-- packages/mcp-server/src/templates/index.ts).
--
-- Entry shape:
--   handler     : function(params, ctx) -> { changed_ids = {...} } or raises
--   undoable    : whether to wrap the handler in undo.with_undo
--   undo_label  : the string the user sees in REAPER's undo history
--   undo_flags  : UNDO_STATE_* bitmask passed to Undo_EndBlock2
--   entity_kind : key in `entity_buckets` — which LAST_RESULT bucket
--                 the dispatcher writes `changed_ids` into. Required.
--                 Routes `last_result:<kind>:N` resolution to the right
--                 store; without this, a `track_create` ID would silently
--                 land in `LAST_RESULT.items`.
--
-- Path resolution: manifest figures out its own directory from
-- debug.getinfo and loads sibling template files itself, so the bridge
-- does not need to know the pack's internal layout.

local PACK_DIR = (function()
  local src = debug.getinfo(1, "S").source
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  return src:match("(.*/)") or "./"
end)()

local undo = dofile(PACK_DIR .. "undo.lua")
local item_templates = dofile(PACK_DIR .. "templates/item.lua")
local track_templates = dofile(PACK_DIR .. "templates/track.lua")
local media_templates = dofile(PACK_DIR .. "templates/media.lua")
local region_templates = dofile(PACK_DIR .. "templates/region.lua")
local render_templates = dofile(PACK_DIR .. "templates/render.lua")

return {
  name = "core",
  version = "0.1.0",
  -- Single source for bridge LAST_RESULT bucket routing. Adding a new
  -- entity family should add one entry here and, only if refs are needed,
  -- register a resolver in refs.lua. `render` deliberately has a bucket
  -- but no resolver in v0.1.
  entity_buckets = {
    item   = "items",
    track  = "tracks",
    region = "regions",
    render = "renders",
    artifact = "artifacts",
  },
  templates = {
    item_pitch = {
      handler     = item_templates.item_pitch,
      undoable    = true,
      undo_label  = "Streetlight: item_pitch",
      undo_flags  = undo.UNDO_STATE_ITEMS,
      entity_kind = "item",
    },
    item_move = {
      handler     = item_templates.item_move,
      undoable    = true,
      undo_label  = "Streetlight: item_move",
      undo_flags  = undo.UNDO_STATE_ITEMS,
      entity_kind = "item",
    },
    item_rate = {
      handler     = item_templates.item_rate,
      undoable    = true,
      undo_label  = "Streetlight: item_rate",
      undo_flags  = undo.UNDO_STATE_ITEMS,
      entity_kind = "item",
    },
    item_trim = {
      handler     = item_templates.item_trim,
      undoable    = true,
      undo_label  = "Streetlight: item_trim",
      undo_flags  = undo.UNDO_STATE_ITEMS,
      entity_kind = "item",
    },
    item_duplicate = {
      handler     = item_templates.item_duplicate,
      undoable    = true,
      undo_label  = "Streetlight: item_duplicate",
      undo_flags  = undo.UNDO_STATE_ITEMS,
      entity_kind = "item",
    },
    item_fade = {
      handler     = item_templates.item_fade,
      undoable    = true,
      undo_label  = "Streetlight: item_fade",
      undo_flags  = undo.UNDO_STATE_ITEMS,
      entity_kind = "item",
    },
    media_import = {
      handler     = media_templates.media_import,
      undoable    = true,
      undo_label  = "Streetlight: media_import",
      -- media_import touches both items (the new item) and the track
      -- selection during InsertMedia. Both are restored, but the undo
      -- bitmask needs to cover ITEMS + TRACKCFG so Cmd+Z cleanly reverts
      -- the inserted item plus any incidental selection deltas REAPER
      -- chose to record.
      undo_flags  = undo.UNDO_STATE_ITEMS | undo.UNDO_STATE_TRACKCFG,
      entity_kind = "item",
    },
    track_create = {
      handler     = track_templates.track_create,
      undoable    = true,
      undo_label  = "Streetlight: track_create",
      undo_flags  = undo.UNDO_STATE_TRACKCFG,
      entity_kind = "track",
    },
    track_color = {
      handler     = track_templates.track_color,
      undoable    = true,
      undo_label  = "Streetlight: track_color",
      undo_flags  = undo.UNDO_STATE_TRACKCFG,
      entity_kind = "track",
    },
    track_rename = {
      handler     = track_templates.track_rename,
      undoable    = true,
      undo_label  = "Streetlight: track_rename",
      undo_flags  = undo.UNDO_STATE_TRACKCFG,
      entity_kind = "track",
    },
    region_create = {
      handler     = region_templates.region_create,
      undoable    = true,
      undo_label  = "Streetlight: region_create",
      -- Regions live in REAPER's project-marker table; UNDO_STATE_MISCCFG
      -- is the tightest correct bit for it. ITEMS/TRACKCFG would also
      -- restore on Cmd+Z (REAPER tolerates broader flags) but MISCCFG
      -- matches the actual mutation surface.
      undo_flags  = undo.UNDO_STATE_MISCCFG,
      entity_kind = "region",
    },
    render_region = {
      handler     = render_templates.render_region,
      -- No undo: `render_region` snapshots and restores the project's
      -- render settings inside the bridge call, so there's nothing
      -- project-side for Cmd+Z to revert. The produced WAV file lives
      -- outside the project state. See docs/RENDER_NOTES.md.
      undoable    = false,
      -- `entity_kind = "render"` routes the deferred-completion
      -- `changed_ids = { absolute_path }` into LAST_RESULT.renders. v0.1
      -- has no `last_result:render:N` resolver — the bucket exists so
      -- the dispatcher's cross-bucket clear stays exhaustive, and so a
      -- future media_import-from-render chain can land in v0.2 without
      -- a bridge structural change.
      entity_kind = "render",
      artifact = {
        kind = "external_file",
        path_shape = "absolute_wav_path",
        read_scope = false,
        updates_last_result = true,
        legacy_carve_out = true,
      },
    },
  },
}

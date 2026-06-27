# Template Specification

Templates are the safe operation layer between agents and REAPER.

Agents choose templates and provide parameters. They should not write raw Lua for normal workflows.

## Schema Source Of Truth

Each template has a single schema definition in `packages/core/src/registry.ts` written as a Zod schema. Two artifacts are derived from it automatically:

- a JSON Schema served via the `list_templates` MCP tool, so agents see what to send
- a TypeScript type for the MCP server's input validation

The Lua side does NOT re-validate types. It assumes the MCP server has already rejected bad input. Lua-side checks are limited to runtime conditions REAPER alone knows (item exists, take exists, file is writable).

Schema mismatches between TS and Lua are the most common bug class. Pin schemas in TS, derive everything else.

## Template Metadata

Every template should have:

```json
{
  "name": "item_pitch",
  "description": "Set active take pitch in semitones.",
  "mutates": true,
  "params_schema": {},
  "returns_schema": {},
  "safety": {
    "undo": true,
    "destructive": false
  }
}
```

## Naming

Use stable snake_case names:

- `item_pitch`
- `item_rate`
- `region_create`
- `render_region`

Do not rename templates casually. Agents and recipes may depend on names.

## Result Shape

Success:

```json
{
  "ok": true,
  "result": {}
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "Could not resolve item reference selected:0",
    "recoverable": true
  }
}
```

## Safety Requirements

Mutating templates must:

- validate inputs
- resolve item/track references safely
- create undo points
- update REAPER arrange view when needed
- return what changed

Templates must not:

- silently delete user work
- run arbitrary model-generated Lua
- assume SWS or ReaPack unless marked as optional dependency

## Required v0.1 Templates

- `track_create`
- `track_rename`
- `media_import`
- `item_duplicate`
- `item_move`
- `item_pitch`
- `item_rate`
- `item_fade`
- `item_trim`
- `region_create`
- `render_region`

(`item_reverse` was cut from v0.1. See `ARCHITECTURE.md` for the rationale.)

## Example: `item_pitch`

Schema (Zod, source of truth):

```ts
const ItemPitchParams = z.object({
  item_id: z.string().describe("Logical item reference, e.g. selected:0 or guid:{...}"),
  semitones: z.number().min(-24).max(24),
});

const ItemPitchResult = z.object({
  items: z.array(z.object({
    id: z.string(),
    take_name: z.string(),
    pitch_before: z.number(),
    pitch_after: z.number(),
  })),
});

registry.register({
  name: "item_pitch",
  description: "Set active take pitch in semitones.",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  params: ItemPitchParams,
  result: ItemPitchResult,
  pack: "core",
});
```

Input example:

```json
{
  "item_id": "selected:0",
  "semitones": -3
}
```

Expected behavior:

- resolve selected item
- find active take
- snapshot pitch_before
- set take pitch in semitones via `SetMediaItemTakeInfo_Value(take, "D_PITCH", semitones)`
- update arrange view via `UpdateArrange()`
- wrap the change in `Undo_BeginBlock` / `Undo_EndBlock2(0, "Streetlight: item_pitch", UNDO_STATE_ITEMS)`
- return changed item info including pitch_before and pitch_after

Notes:

- pitch belongs to the active take, not the media item itself
- missing take should return `TAKE_NOT_FOUND`
- semitone range above clamps at 24 to prevent absurd values; this is policy, not a REAPER limit

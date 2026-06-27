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

Success — the locked `call_template` envelope. **Every template returns
this shape, regardless of what it does.** Agents read post-state via
`get_state` when they need details (name, position, pitch, …); the
envelope itself carries IDs only.

```json
{
  "ok": true,
  "result": {
    "template": "item_pitch",
    "changed_count": 1,
    "changed_ids": ["guid:{1F8063CD-452B-A246-8680-82FD82095319}"],
    "truncated": false
  }
}
```

`changed_ids` is capped at 50 entries at the bridge dispatcher;
`changed_count` is the true count and `truncated` is `true` when the cap
fired. See `docs/RESPONSE_BUDGET.md § call_template` for the rationale.

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

`recoverable: true` means the agent can adjust and try again with
different params — NOT that blind auto-retry of a mutating call is
safe. See `errors.ts` `StreetlightError.recoverable` jsdoc and the
`call_template` MCP tool description for the mutating-timeout
counter-example.

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

Schema (Zod, source of truth — lives in
`packages/mcp-server/src/templates/item-pitch.ts`):

```ts
const ItemPitchParams = z.object({
  item_id: z.string().min(1).describe(
    "Logical item reference. v0.1 supports selected:N, guid:{...}, "
    + "last_result:item:N, track:Name/item:N."
  ),
  semitones: z.number().min(-24).max(24),
}).strict();

// Result is the locked call_template envelope. Same for every template;
// see "Result Shape" above.
```

Input example:

```json
{
  "name": "item_pitch",
  "params": {
    "item_id": "selected:0",
    "semitones": -3
  }
}
```

Expected behavior:

- resolve the item reference via `refs.lua`
- find the active take (no take → `TAKE_NOT_FOUND`)
- set take pitch in semitones via `SetMediaItemTakeInfo_Value(take, "D_PITCH", semitones)`
- update arrange view via `UpdateArrange()`
- the bridge dispatcher wraps the call in `Undo_BeginBlock` /
  `Undo_EndBlock2(0, "Streetlight: item_pitch", UNDO_STATE_ITEMS)` via
  `undo.with_undo` (declared in the manifest as `undoable = true`)
- return `{ changed_ids = { "guid:{...}" } }` from the Lua handler; the
  dispatcher promotes it to the locked envelope

Notes:

- pitch belongs to the active take, not the media item itself
- missing take should return `TAKE_NOT_FOUND`
- semitone range above clamps at ±24 to prevent absurd values; this is
  policy, not a REAPER limit. Out-of-range values are rejected MCP-side
  with `PARAMS_INVALID` before they reach the bridge.

## Nullable Params

Some templates take parameters where "leave alone" and "explicitly clear"
are different. `item_fade`'s `fade_in` / `fade_out` are the first
examples in v0.1:

- absent (key not in the JSON object) → leave the existing value alone
- explicit `null` → clear the fade (set length to 0)
- a number → set the fade length to that many seconds

JSON has both states. Lua does not — both `{"fade_in": null}` and `{}`
parse to a Lua table with no `fade_in` key. To preserve the distinction
across the wire, the bridge's `packs/core/lib/json.lua` mints a unique
sentinel value `json.null`:

- the **decoder** returns `json.null` (a unique table) when it sees a
  JSON `null` — not Lua `nil`, which would silently disappear from
  arrays and object keys
- the **encoder** emits `"null"` when it sees `json.null`
- in handler code, check with reference equality: `if v == json.null`

Templates that accept nullable params should:

1. Declare the field with Zod as `z.union([z.number(), z.null()]).optional()`
   (or your shape of choice — TS-side validation passes `null` through)
2. In the Lua handler, check `if params.fade_in == nil then …` for
   absent and `if params.fade_in == ctx.json.null then …` (or whatever
   reference to the sentinel is exposed via `ctx`) for explicit null
3. Document both cases in the template's TS jsdoc so agents reading
   `list_templates` know what each state means

The encoder is symmetric — Lua handlers that need to emit explicit
`null` (rare in v0.1) set the value to `json.null`. Plain Lua `nil`
inside a table still means "absent" and disappears as before.

## Reference Resolution (refs.lua)

The agent-facing reference kinds and what they mean in v0.1:

| Ref | Meaning | Step landed |
|---|---|---|
| `selected:N` | The N-th selected media item in arrange (0-indexed). | 3 |
| `guid:{...}` | An item by REAPER-assigned GUID. Stable across the project. | 3 |
| `last_result:item:N` | The N-th item from the most recent successful mutating `call_template`. Resets on bridge reload; not affected by reads (`ping`, `get_state`). | 4 |
| `track:Name/item:N` | The N-th media item on the first track whose `P_NAME` matches exactly. Duplicate track names → first match wins. | 4 |

Future v0.1 ref kinds (`last_result:region:N`, `last_result:track:N`)
parse on the TS side but the Lua resolver returns `REF_INVALID` until
the corresponding mutating templates ship (Step 5 / 6).

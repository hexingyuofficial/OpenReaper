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

Slice 04 adds one non-recoverable runtime-verification failure:

```json
{
  "ok": false,
  "error": {
    "code": "VERIFY_FAILED",
    "message": "Template 'item_pitch' produced delta inconsistent with expectedDelta. ... The mutation has been applied — call get_state to inspect actual state.",
    "recoverable": false,
    "details": {
      "expected": { "count": 1 },
      "actual": { "items": 1, "tracks": 0, "regions": 0 },
      "changed_count": 1
    }
  }
}
```

`VERIFY_FAILED` means a handler returned successfully, but the bridge's
before/after structural snapshot disagreed with that template's
`expectedDelta`. The mutation may already be in the project and undo
history. Agents must inspect state with `get_state`; they must not
blindly retry.

## Safety Requirements

Mutating templates must:

- validate inputs
- resolve item/track references safely
- create undo points
- update REAPER arrange view when needed
- return what changed
- declare `expectedDelta` unless they are an intentional deferred
  carve-out like `render_region`
- reference Lua error codes through generated constants
  (`ctx.errs.*` / `ERRS.*` from
  `reaper/packs/core/error_codes.lua`); runtime string-literal error
  codes are blocked by `scripts/error-codes.mjs`

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

## Runtime Structural Verification (Slice 04)

Every synchronous undoable mutating template declares an `expectedDelta`
descriptor in TypeScript:

```ts
type ExpectedDelta = {
  count: number | "any";
  creates?: boolean;
  maybeCreates?: boolean;
  deletes?: boolean;
  fields?: Array<{
    scope: "take" | "item" | "track";
    field: string;
    paramPath: string;
    tolerance?: number;
    optional?: boolean;
    nullable?: boolean;
  }>;
};
```

The MCP server sends this descriptor to the bridge as
`expected_delta`. The bridge snapshots item, track, and region counts
before handler execution, snapshots again after handler success, and
checks the observed structural delta before it updates `LAST_RESULT`.

Modes:

- no mode flag → in-place mutation, `changed_count` equals `count` and
  the relevant entity count does not move
- `creates:true` → positive entity-count movement
- `deletes:true` → negative entity-count movement
- `maybeCreates:true` → either zero movement or the numeric positive
  count; used narrowly for `track_create` with `reuse_existing:true`
- `count:"any"` → at least one changed id; used by `media_import`

`creates`, `maybeCreates`, and `deletes` are mutually exclusive.
`maybeCreates` cannot be paired with `count:"any"`.

Slice 06 adds field-level verification for a narrow in-place subset.
When `expectedDelta.fields` is present, the MCP server sends the
descriptor over the wire as `fields[].param_path`, and the bridge reads
back the changed entity after the structural check passes but before
`LAST_RESULT` is updated.

| Template | Scope | Field | Expected value |
|---|---|---|---|
| `item_pitch` | `take` | `D_PITCH` | `params.semitones` |
| `item_move` | `item` | `D_POSITION` | `params.position` |
| `item_rate` | `take` | `D_PLAYRATE` | `params.rate` |
| `item_fade` | `item` | `D_FADEINLEN` | `params.fade_in` when supplied; `null` coerces to `0` |
| `item_fade` | `item` | `D_FADEOUTLEN` | `params.fade_out` when supplied; `null` coerces to `0` |
| `item_trim` | `item` | `D_LENGTH` | `params.length` |
| `item_trim` | `take` | `D_STARTOFFS` | `params.start_offset` when supplied |
| `item_duplicate` | `item` | `D_POSITION` | `params.position` on the newly-created item |
| `media_import` | `item` | `D_POSITION` | `params.position` on `changed_ids[1]` (first-item verify) |
| `region_create` | `region` | `name` | `params.name` on the newly-created region |
| `region_create` | `region` | `pos` | `params.start` when supplied; tolerance `1e-6` |
| `region_create` | `region` | `rgnend` | `params.end` when supplied; tolerance `1e-6` |
| `track_create` | `track` | `P_NAME` | `params.name` on either created or reused track |
| `track_rename` | `track` | `P_NAME` | `params.name` |

Numeric checks use absolute `tolerance` when declared. String checks use
strict equality. Field verification failure returns `VERIFY_FAILED`,
`recoverable:false`, preserves the Slice 04 recovery phrase, and does
not update `LAST_RESULT`.

Slice 07 adds optional field descriptors. When a field has
`optional:true` and `params[paramPath]` is absent, the bridge skips
that field and treats it as ok. This is used by `item_trim`:
`D_LENGTH` is always verified, while `D_STARTOFFS` is verified only
when the caller supplies `start_offset`.

Slice 08 adds nullable field descriptors. `optional` and `nullable` are
orthogonal:

- `optional:true` + absent param → skip the field check.
- `nullable:true` + explicit JSON `null` → compare the REAPER field
  against `0`.
- explicit JSON `null` without `nullable:true` → field verification
  mismatch.

`item_fade` uses both flags on `D_FADEINLEN` and `D_FADEOUTLEN`:
absent leaves the fade alone and skips verification; `null` clears the
fade and verifies the field as `0`; a number verifies that numeric
length. Descriptor validation allows an all-optional `fields[]` list
only when every field is also nullable, so a template cannot accidentally
ship a pure no-op verifier.

Slice 09 starts field verification on creates-style templates.
`expectedDelta.fields[]` may coexist with `creates:true` only when
`count` is a finite positive integer. The bridge verifies the entity
named by `changed_ids[1]`; for `item_duplicate` that is the new
`guid:{...}` item returned by the handler, so the existing item-scope
reader can compare `D_POSITION` against `params.position`.

The D5 relaxation is intentionally incremental. Slice 09 covers only
numeric-count `creates:true` descriptors. Slice 10 covers numeric-count
`maybeCreates:true` descriptors. Slice 11 covers `creates:true` with
`count:"any"` as first-item verification. Slice 12 adds the `region`
field scope for `region_create`; Slice 13 combines that region scope
with mixed optional numeric bounds fields. `fields[]` still cannot
coexist with `deletes:true`.

Field verification is intentionally not global yet. `render_region`
still omits `expectedDelta` in v0.1 because it is deferred and returns
an artifact path, not a project-entity ref.

Slice 10 starts field verification on maybeCreates-style templates.
`expectedDelta.fields[]` may coexist with `maybeCreates:true` only when
`count` is a finite positive integer. `track_create` verifies the track
named by `changed_ids[1]` using the same GUID-shaped track reader that
`track_rename` uses. The create path has structural delta `+1`; the
reuse path has structural delta `0`; both paths still run field
verification. On reuse, `P_NAME == params.name` is structurally
guaranteed because the handler found the existing track by that name,
so the field check is a pipeline proof-of-life rather than a new
semantic assertion.

Slice 11 starts field verification on `creates:true` +
`count:"any"` templates. The registry allows this combination only for
creates-style descriptors; `maybeCreates:true` still requires a finite
positive numeric count. Runtime semantics are intentionally explicit:
for `count:"any"` plus `fields[]`, the bridge verifies only
`changed_ids[1]`. It does not loop over every changed id.

`media_import` uses that first-item verification contract for item
`D_POSITION ← params.position`, tolerance `1e-6`. For the common
single-item import, that is a full postcondition check. If REAPER ever
returns multiple imported items from one `media_import` call, Slice 11
only proves the first returned item landed at the requested position;
the remaining changed ids are still reported in the normal success
envelope but are not field-checked. If that field check fails, the
imported item may already exist in the project and `LAST_RESULT` is not
updated, matching the existing `VERIFY_FAILED` recovery contract.

Slice 12 starts field verification on region scope. Region changed ids
use the v0.1 name-shaped form `region:NAME`; REAPER 7 exposes no native
region GUID API, so GUID-shaped region refs remain unsupported. The
bridge's `verify.lua` uses an internal `parse_region_ref` plus
`find_region_by_name` reader that mirrors the refs.lua region-name scan
without coupling verify.lua to refs.lua.

`region_create` uses region `name ← params.name`, no tolerance,
`optional`, or `nullable`. This check is a pipeline proof-of-life:
the handler creates the region with `params.name`, then verify reads the
region by the `region:NAME` changed id and compares the name string
strictly. It proves the region changed-id shape, parser, scanner, and
field reader are live.

Slice 13 adds bounds verification for explicit-mode `region_create`.
When the caller uses `{name,start,end}`, the descriptor verifies all
three fields: `name`, `pos ← params.start`, and
`rgnend ← params.end`. The numeric checks use tolerance `1e-6`.

When the caller uses item-derived mode `{name,item_id}`, the descriptor
still includes `pos` and `rgnend`, but both fields are marked
`optional:true`. Because `params.start` and `params.end` are absent in
that mode, Slice 07's optional-absent rule skips those two field checks;
item-derived mode therefore remains name-only proof-of-life in v0.1.
Strong item-mode bounds verification would require a new
"computed expected" descriptor axis that resolves `item_id` and derives
`D_POSITION + D_LENGTH`, so it is deferred to Slice 14+ / v0.2. If
region field verification fails, the region may already exist in the
project and `LAST_RESULT` is not updated, matching the existing
`VERIFY_FAILED` recovery contract.

## Reference Resolution (refs.lua)

The agent-facing reference kinds and what they mean in v0.1:

| Ref | Meaning | Step landed |
|---|---|---|
| `selected:N` | The N-th selected media item in arrange (0-indexed). | 3 |
| `guid:{...}` | An item by REAPER-assigned GUID. Stable across the project. | 3 |
| `last_result:item:N` | The N-th item from the most recent successful mutating `call_template`. Resets on bridge reload; not affected by reads (`ping`, `get_state`). | 4 |
| `track:Name/item:N` | The N-th media item on the first track whose `P_NAME` matches exactly. Duplicate track names → first match wins. | 4 |
| `track:Name` | The first track whose `P_NAME` matches exactly. Duplicate track names → first match wins. | 4 |
| `last_result:track:N` | The N-th track from the most recent successful mutating `call_template` that produced tracks. Reads and failed verifies do not update it. | 4 |
| `region:Name` | The first project region whose name matches exactly. Region identity is name-shaped in v0.1 because REAPER 7 exposes no native region GUID API. | 5 |
| `last_result:region:N` | The N-th region from the most recent successful mutating `call_template` that produced regions. Reads and failed verifies do not update it. | 5 |

`guid:{...}` remains an item / track GUID shape only. Region GUID refs
parse on the TS side as a well-formed reference shape, but the Lua
resolver returns `REF_INVALID` for region GUIDs in v0.1; use
`region:Name` or `last_result:region:N` instead.

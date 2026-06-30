# Response Budget

Cross-cutting design constraint for every Streetlight tool that returns
collections, descriptions, or accumulated state. The goal: make it
**structurally impossible** for a single MCP response to overflow an agent's
context window.

This document is the **why** behind the limits, defaults, and shapes used in
`get_state`, `list_templates`, `list_recipes`, and `call_template`. If you
change one of those tool shapes, update this file first.

## Why "Response Budget", Not "Token Budget"

We control fields, item counts, and bytes. The LLM tokenizes downstream;
the same bytes turn into more or fewer tokens depending on the model and the
content. "Token budget" reads like we're guarding a number we don't actually
observe.

What we DO observe and gate on:

- **byte size** of the encoded JSON response
- **item count** in any list-shaped result
- **field set** included per item (defaults compact, opt in for detail)

So: response budget. It's accurate and it names what the code does.

## The Five Risk Surfaces

| Surface | Worst case | When implemented |
|---|---|---|
| `get_state scope=selection` | user selects every item in a 500-item project | v0.1 |
| `get_state scope=tracks` | 200 tracks × optional FX chains | Kernel hardening Slice 01 + Slice 02 (`include:["fx"]`) |
| `get_state scope=regions` | hundreds of timeline regions | Kernel hardening Slice 01 |
| `get_state scope=project` | project summary now; full snapshot later | Kernel hardening Slice 01 (summary only) |
| `list_templates` | 50 templates × full JSON Schema (~3 KB each) ≈ 150 KB | Step 3 |
| `list_recipes` | 30 recipes × full YAML body | Step 7 |
| `call_template` result | template mutates 500 items, returns all descriptors | Step 3 |
| `last_result` (per-session) | previous response was 40 KB, agent re-references 5×, transcript carries 200 KB | Step 3+ |

Any one of these can blow up a context window quietly. The mitigation has to be
**uniform** so we don't re-invent it per tool.

## The Five Principles

These are the rules every list-returning tool follows from v0.1 onward.

1. **Default to summary, opt into detail.** Compact form (counts + ids + names)
   is the default. Full per-item fields require explicit opt-in (`verbose:
   true`, `include: ["fx", "automation"]`, etc.). The LLM should never get a
   large payload it didn't ask for.

2. **Every list is bounded by `limit`.** No tool returns "all of them". `limit`
   has a sensible default and a hard upper clamp. Callers asking for more get
   clamped silently — the `total` field tells them what was elided.

3. **Field projection where it pays.** `fields: ["id", "name"]` lets callers
   cherry-pick. Not every tool needs this in v0.1; it's a v0.2 lever.

4. **Bridge-side byte cap, item-boundary truncation.** The Lua bridge
   tracks encoded bytes as it builds the response. When the next item would
   push past `MAX_RESPONSE_BYTES`, it stops at the previous item boundary and
   returns `truncated: true`. **Never split JSON mid-token** — that would
   produce malformed JSON. If even the first item exceeds the cap, return the
   error code `RESPONSE_TOO_LARGE`.

5. **Every paginated response carries metadata.** Minimum v0.1 envelope per
   list:

   ```json
   {
     "total":          200,
     "returned":       50,
     "truncated":      true,
     "response_bytes": 18432
   }
   ```

   `estimated_bytes_if_all` is deferred — interesting but not load-bearing for
   v0.1.

## Why v0.1 Is Backstop-Only, Not Full Pagination

A full pagination system would include opaque cursors, stable snapshot
semantics, `fields` projection on every endpoint, and per-call `max_bytes`
overrides. We chose **not to build all of that in v0.1** for three reasons:

1. **No cursor stability promise can be honest.** REAPER state changes
   under our feet — the user clicks around, items move, the selection shifts.
   A "stable cursor" that silently desynchronizes is worse than no cursor.
   v0.2 can revisit this with explicit "you may see drift" semantics.

2. **`fields` adds combinatorial test surface.** Every template handler grows
   a projection layer; every schema grows optional fields. Not worth it before
   we know which fields agents actually want.

3. **`max_bytes` as a parameter invites foot-guns.** An LLM could ask for
   1 MB. We'd rather hardcode the cap in the bridge and force a real
   re-thinking if anything legitimately needs more.

So v0.1 ships **only the four things that prevent silent disasters**:

- `limit` parameter with a sensible default
- item-boundary truncation against a hardcoded byte cap
- `RESPONSE_TOO_LARGE` for the can't-even-fit-one-item case
- response shape locked so future versions can grow `fields` / `cursor`
  without breaking callers

Everything else is roadmap.

## v0.1 Locked Shapes

### `get_state` (scopes: `selection`, `tracks`, `regions`)

Input:

```json
{
  "scope": "selection",
  "limit": 50,
  "include": ["fx"]
}
```

Defaults: `scope = "selection"`, `limit = 50`, clamped to `[1, 200]`.
Bridge has the same fallback. `include` is optional; Slice 02 allows only
`["fx"]`, and only with `scope = "tracks"`.

Output:

```json
{
  "ok": true,
  "result": {
    "selection": {
      "items": [
        {
          "id": "guid:{...}",
          "name": "kick_01.wav",
          "track_name": "Drums",
          "position": 12.5,
          "length": 0.42
        }
      ],
      "total": 200,
      "returned": 50,
      "truncated": true,
      "response_bytes": 18432
    }
  }
}
```

`tracks` and `regions` use the same list envelope; the top-level result key
changes to the scope name.

`tracks.items[]` v1 descriptor:

```json
{
  "id": "guid:{...}",
  "index": 0,
  "name": "Impacts",
  "depth": 0,
  "volume": 1,
  "pan": 0,
  "mute": false,
  "solo": false,
  "recarm": false
}
```

`index` is an order/display hint, not a stable reference. Use `id` when you need
to address the track later.

Slice 02 adds an opt-in FX projection:

```json
{
  "id": "guid:{...}",
  "index": 0,
  "name": "Impacts",
  "depth": 0,
  "volume": 1,
  "pan": 0,
  "mute": false,
  "solo": false,
  "recarm": false,
  "fx": [
    {
      "index": 0,
      "name": "VST: ReaEQ (Cockos)",
      "ident": "VST: ReaEQ (Cockos)<1920167789>",
      "enabled": true,
      "preset_name": ""
    }
  ]
}
```

`fx` is present only when the caller sends
`get_state({ scope: "tracks", include: ["fx"] })`. It is deliberately
omitted by default, not returned as `[]` or `null`, because FX chains are the
expensive sub-resource. When included, tracks with no FX return `fx: []`.

`FxDescriptor.index` is a zero-based FX slot index within the track, not a
stable reference. `ident` is REAPER's `fx_ident` named-config value when
available. `name`, `ident`, and `preset_name` use `""` when REAPER cannot
provide a value; never `null`, never omitted.

The `fx` array is part of the track descriptor for response-budget purposes:
the bridge JSON-encodes the whole track descriptor, including `fx`, before
deciding whether it fits. It never truncates inside an FX chain.

Include errors are part of the public contract:

- unknown include values such as `"midi"` return `PARAMS_INVALID`;
- non-`tracks` scopes with a non-empty include return `PARAMS_INVALID`;
- `get_state(render, include:["fx"])` returns `PARAMS_INVALID`, not
  `SCOPE_NOT_IMPLEMENTED`, because include validation runs before scope
  dispatch.

`regions.items[]` v1 descriptor:

```json
{
  "name": "var_01",
  "start": 0,
  "end": 1.25
}
```

Region `name` is the v0.1 user-facing handle. REAPER's marker/region index is
unstable across deletes and is not exposed as an id.

### `get_state` (scope: `project`)

`project` returns one small summary object and does not need list truncation.

```json
{
  "ok": true,
  "result": {
    "project": {
      "bpm": 120,
      "time_sig_num": 4,
      "time_sig_den": 4,
      "sample_rate": 48000,
      "length_seconds": 12.5
    }
  }
}
```

`render` remains a reserved scope that returns `SCOPE_NOT_IMPLEMENTED` in
Slice 01 and Slice 02 when no invalid include is supplied.

Truncation is collapsed into one boolean: `truncated = true` when **either**
`returned < total` (limit hit) or the byte cap was reached. The caller can tell
which by comparing `returned` to `limit`.

Hardcoded bridge constants for v0.1:

- `MAX_RESPONSE_BYTES = 65536` (64 KiB)
- `MAX_LIMIT = 200`
- `DEFAULT_LIMIT = 50`

### `call_template` — locked shape (enforced at Step 3)

This is the most important shape to nail down before Step 3 starts.

```json
{
  "ok": true,
  "result": {
    "template":      "item_pitch",
    "changed_count": 200,
    "changed_ids":   ["guid:{...}", "guid:{...}"],
    "truncated":     true
  }
}
```

Rules:

- `changed_count` is always the **true** total of items mutated.
- `changed_ids` is capped at 50 entries. If `changed_count > 50`, the array
  contains the first 50 in mutation order and `truncated = true`.
- The result **never** contains full `ItemDescriptor` objects, even for
  single-item changes. Agents who need before/after fields call `get_state`
  with the returned ids.

Why this matters: a careless template ("apply pitch to all items on this
track") could otherwise return 500 descriptors × 200 bytes = 100 KB in one
result. The id-only contract makes the worst case ~1.5 KB regardless of how
many items the template touched.

#### `changed_ids` shape — and the one carve-out (Step 6)

Every template except `render_region` uses **project-entity refs** in
`changed_ids`:

- `"guid:{...}"` — item or track GUID
- `"region:NAME"` — region (no native GUID API in REAPER 7)
- `"track:Name"` — bare track name (rare; only when the agent fed one in)

`render_region` is the **single carve-out**. Its `changed_ids` holds
**absolute artifact paths** the agent can hand to a media-player or a
follow-up `media_import`:

```json
{
  "ok": true,
  "result": {
    "template":      "render_region",
    "changed_count": 1,
    "changed_ids":   ["/Users/.../var_01.wav"],
    "truncated":     false
  }
}
```

The deviation is deliberate: render produces nothing inside the project
that an entity-ref could point at, and we don't want to add a "render"
ref kind in v0.1. The `entity_kind = "render"` manifest entry routes the
path into `LAST_RESULT.renders` so the bridge's cross-bucket clear stays
exhaustive, but there's no `last_result:render:N` resolver in v0.1.

**Do NOT generalize this carve-out to other templates.** A future
template that "creates an MP3 from the project" would inherit it; one
that "renames a track" would not. If you're unsure, ask: is the thing my
handler produced addressable as a REAPER project entity? Yes → use the
entity ref. No → it's a render-shaped output and you need to revisit
this section before adding it.

#### `VERIFY_FAILED` details (Slice 04 + Slice 06)

Slice 04 adds structural verification metadata to mutating templates.
When the bridge detects a mismatch between a template's `expectedDelta`
and the observed item/track/region count movement, it returns
`VERIFY_FAILED` with small structured details:

```json
{
  "expected": { "count": 1 },
  "actual": { "items": 1, "tracks": 0, "regions": 0 },
  "changed_count": 1
}
```

Slice 06+ may append a compact `fields[]` array when field-level
verification fails:

```json
{
  "expected": { "count": 1, "fields": [{ "scope": "take", "field": "D_PITCH", "param_path": "semitones", "tolerance": 0.000001 }] },
  "actual": { "items": 0, "tracks": 0, "regions": 0 },
  "changed_count": 1,
  "fields": [
    { "scope": "take", "field": "D_PITCH", "expected": -3, "actual": 0, "tolerance": 0.000001, "ok": false }
  ]
}
```

v0.1 field verification is bounded to at most three fields per call.
Most templates still carry one or two field descriptors (`item_trim` in
Slice 07, `item_fade` in Slice 08, and the single-field create/reuse
templates in Slices 09-12). Slice 13 makes `region_create` the first
three-field verifier: `name`, `pos`, and `rgnend`. A region-name
mismatch adds one small string field entry; a bounds mismatch adds one
or two numeric entries. Even the theoretical all-three-field failure is
well under 1 KiB, far below `MAX_RESPONSE_BYTES = 65536`.

Slice 11 adds `media_import` with one first-item field check even though
its structural count is `"any"`, so the failure payload still contains
at most one media-import `fields[]` entry.
Nullable field descriptors do not add data to `error.details.fields[]`;
a `json.null` parameter is coerced to expected value `0` before the
normal `{scope, field, expected, actual, tolerance, ok}` detail is
built. The error message still tells agents to call `get_state` because
the mutation may already be applied.

### Empty Strings vs Missing Fields

`name` and `track_name` are required `string` on every descriptor. When the
underlying object is unnamed in REAPER, the value is `""`.

**Why not `null` or omit:**

- `""` means "the user did not assign a name to this object" — it's a real
  state, not missing data.
- A required string field keeps the Zod schema flat and lets the LLM rely on
  `descriptor.name` existing without null-checking.
- If we want to be helpful to LLMs later, we add a new field `display_name`
  (e.g., `"item @ 12.5s on Drums"`) instead of overloading `name`.

This is a deliberate v0.1 contract. Don't "fix" it without a written reason.

### `list_templates` Metadata (Slice 03)

`list_templates` returns registry metadata only; it never touches the REAPER
bridge. Slice 03 enriches every template entry with H5 descriptor fields:

```json
{
  "name": "item_pitch",
  "description": "Set the active take's pitch...",
  "pack": "core",
  "risk": "write_safe",
  "mutates": true,
  "undoable": true,
  "entity_kind": "item",
  "undo_flags": ["ITEMS"],
  "idempotent": true,
  "examples": [
    {
      "description": "Pitch the first selected item down one octave.",
      "params": { "item_id": "selected:0", "semitones": -12 }
    }
  ],
  "params_schema": {},
  "result_schema": {}
}
```

`entity_kind`, `undo_flags`, and `examples` are required on every descriptor.
`render_region` is the v0.1 non-undoable carve-out and reports
`undo_flags: []`.

Slice 04 activates `expectedDelta` for the ten undoable mutating core
templates. It remains omitted on `render_region`, which is the deferred
artifact-path carve-out and is not structurally verified in v0.1.
`reads` and `writes` remain H6 placeholders. When any optional metadata
field is absent, omit it; do not emit `null` or empty arrays to imply
semantics that are not active yet.

## Deferred To v0.2 / v0.3

These are mentioned in `docs/ROADMAP.md`. They build on the v0.1 backstop
shapes without breaking them.

- **`fields: string[]` projection** on `get_state` and `list_templates`
- **`include: string[]`** beyond Slice 02's `["fx"]` on `tracks`:
  automation envelopes, take FX, item FX, and other expensive sub-resources
- **`cursor: string`** for true pagination on long lists (when stability
  semantics can be honestly described)
- **`summary_only: true` mode** on `list_templates` / `list_recipes` (the
  default behavior becomes "summary"; this is the explicit override)
- **`estimated_bytes_if_all`** as a response hint for planning calls
- **Configurable byte caps** per tool (currently hardcoded in the bridge)

## Risk Register — What Could Still Blow Up

Things v0.1 does NOT defend against, listed so we don't get surprised:

- **`call_template` returning a giant `error.details`.** Bridge writes
  whatever the template returned. If a handler stuffs a 50 KB blob into
  `error.details`, it lands in the response. Mitigation: template review
  checklist + bridge-level cap on `details`.
- **Repeated mid-size responses accumulating in transcript.** Five
  consecutive 30 KB responses is 150 KB of conversation context. Out of
  scope for the bridge — the calling agent or harness handles this.
- **Logs / `ShowConsoleMsg` writes growing without bound.** Bridge logs go
  to REAPER's console, not over MCP. Still worth bounding eventually.
- **New `get_state` scopes shipping without re-reading this doc first.**
  Every new scope re-enters this design space. `selection` / `tracks` /
  `regions` / `project` are the Slice 01 baseline; Slice 02 adds
  track-level FX chains behind `include:["fx"]`. `render`, take FX, item FX,
  FX parameters, pagination, and projection still need fresh review.
- **A single FX-heavy track can exceed the response cap.** Slice 02 treats an
  FX chain as part of the track descriptor and refuses to split it. If the
  first requested track cannot fit, the bridge returns `RESPONSE_TOO_LARGE`
  rather than emitting malformed or partial FX JSON.

## Process Note

Whenever a new tool or new `get_state` scope is added:

1. Re-read this doc.
2. Add the surface to the table in "The Five Risk Surfaces".
3. Pick the v0.1-style backstop for it (`limit` + item-boundary truncation +
   `RESPONSE_TOO_LARGE`).
4. Document the locked shape in this file before writing handlers.

This is cheap insurance. The cost of forgetting to do this once is a 200 KB
response that quietly trashes a session.

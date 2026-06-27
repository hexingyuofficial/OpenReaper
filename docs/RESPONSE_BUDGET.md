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
| `get_state scope=tracks` | 200 tracks × FX chain metadata | v0.2 (still `SCOPE_NOT_IMPLEMENTED`) |
| `get_state scope=project` | snapshot of everything | v0.3+ |
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

### `get_state` (scope: `selection`)

Input:

```json
{
  "scope": "selection",
  "limit": 50
}
```

Defaults: `limit = 50`, clamped to `[1, 200]`. Bridge has the same fallback.

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

## Deferred To v0.2 / v0.3

These are mentioned in `docs/ROADMAP.md`. They build on the v0.1 backstop
shapes without breaking them.

- **`fields: string[]` projection** on `get_state` and `list_templates`
- **`include: string[]`** for opt-in expensive sub-resources (FX chains,
  automation envelopes, take FX)
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
- **`scope: tracks/project/render/regions` shipping without re-reading this
  doc first.** Every new scope re-enters this design space.

## Process Note

Whenever a new tool or new `get_state` scope is added:

1. Re-read this doc.
2. Add the surface to the table in "The Five Risk Surfaces".
3. Pick the v0.1-style backstop for it (`limit` + item-boundary truncation +
   `RESPONSE_TOO_LARGE`).
4. Document the locked shape in this file before writing handlers.

This is cheap insurance. The cost of forgetting to do this once is a 200 KB
response that quietly trashes a session.

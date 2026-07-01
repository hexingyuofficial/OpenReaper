# Template Authoring Guide

This is the how-to for adding a new OpenReaper template. The protocol
contract — what the wire envelopes look like, what error codes mean, how
`expectedDelta` is interpreted at runtime, the ref grammar — lives in
[`docs/TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md). **When this guide and the code
disagree, the code wins.** The lint (`npm run check:template-authoring`)
is the authoritative author-side enforcer; this document is the
walkthrough that explains *why* and *in what order*.

If you only remember three things:

1. The TS `CapabilityDefinition` is the single source of truth for
   metadata. The Lua manifest is checked against it.
2. Every mutating undoable template declares `expectedDelta`. Every
   template declares at least one positive, parseable `examples[]` entry.
3. Errors are typed string codes from `packages/core/src/errors.ts`,
   referenced through generated constants (`ctx.errs.*` / `ERRS.*`) on
   the Lua side. Never write a raw string-literal code.

## Before You Start

Read these once, in order:

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — what OpenReaper is and is
  not (5 MCP tools, locked envelope, template-not-eval).
- [`docs/TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md) — protocol contract (this
  guide intentionally does not repeat it).
- [`docs/plans/KERNEL_HARDENING_PLAN.md`](plans/KERNEL_HARDENING_PLAN.md)
  §1 NEVER-BREAK invariants I1–I10. Internalize them. Every new template
  must respect every one.
- [`docs/plans/KERNEL_HARDENING_EXECUTION.md`](plans/KERNEL_HARDENING_EXECUTION.md)
  §0 — global preconditions (build/test commands, Lua reload protocol,
  the existing contracts you must not break).

## Pre-Flight Checklist (Decide These First)

You cannot write a good template without answering these. Write them
down at the top of your slice plan or PR description:

| Question | Why it matters |
|---|---|
| `name` (snake_case) | Goes on the wire, must be unique across the registry, must match the TS file slug. |
| `entity_kind` (`item` / `track` / `region` / `render`, or new) | Routes `changed_ids` to the right `LAST_RESULT` bucket. Slice 20B allows non-core packs to reuse core kinds only; new kinds need a focused kernel slice before the domain pack ships — see "Extending to a New entity_kind". |
| `pack` (`core` or an enabled domain pack) | Tells `list_templates` consumers which capability bundle owns the template. New domain packs need their own TS registration module plus `reaper/packs/<pack>/manifest.lua`; do not park domain capabilities in `core` just to avoid pack-loading work. |
| `risk` (`read` / `write_safe` / `filesystem` / `destructive` / `unsafe_eval`) | v0.1's default policy allows `read`, `write_safe`, and `filesystem` (needed by `media_import` / `render_region`). `destructive` and `unsafe_eval` require explicit opt-in and are out of scope here. |
| `mutates` (bool) | If true, the template can change project state. |
| `undoable` (bool) | If true, the bridge wraps the handler in `undo.with_undo`. Must align with `undo_flags` and the `manifest.lua` entry. `render_region` is the only `mutates=true / undoable=false` case in v0.1 — see notes on it below. |
| `undo_flags` (subset of `["TRACKCFG","FX","ITEMS","MISCCFG","FREEZE"]`) | Bits passed to `Undo_EndBlock2`. Must be exactly what the handler actually touches. |
| `idempotent` (bool) | Documents agent expectations. Not enforced. `track_create` with `reuse_existing:false` is non-idempotent (two calls → two tracks); `item_pitch` is idempotent. |
| `expectedDelta` (required if `mutates && undoable`) | The verify contract. See [`TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md) for the descriptor schema. |
| Per-param Zod schema | Source of truth for `list_templates` JSON Schema *and* MCP-side input validation. The Lua handler trusts this — do not re-validate types in Lua. |
| `examples[]` | At least one positive, parseable call an agent can copy. **No reverse / "should fail" fixtures here** — those live in lint tests only. |
| ReaScript calls you will use | Pin them in the pre-flight. If you discover an API surprise later, redo the pre-flight before changing the handler. |
| Expected error-code surface | Every error path must use a code from `errors.ts`. If you need a new code, that is a separate slice. |

## File Map: What You Touch When Adding A Template

Adding one new template (`core` pack, existing `entity_kind`) touches
exactly these files:

```
packages/mcp-server/src/templates/<name-kebab>.ts              # NEW: Zod + defineTemplate(...)
packages/mcp-server/src/templates/index.ts                     # MODIFY: registry.register(...)
packages/mcp-server/src/tools/__tests__/<name-kebab>.test.ts   # NEW: wire-shape + PARAMS_INVALID
reaper/packs/<pack>/templates/<entity>.lua                     # MODIFY: add M.<name> handler
reaper/packs/<pack>/manifest.lua                               # MODIFY: templates.<name> entry
```

If your template's `entity_kind` requires a new bucket or a new resolver,
also touch:

```
reaper/packs/core/manifest.lua                                 # MODIFY: entity_buckets[...]
reaper/packs/core/refs.lua                                     # MODIFY (rare): new resolver
```

If your template adds a new error code (rare; budget a separate slice):

```
packages/core/src/errors.ts                                    # MODIFY: ErrorCodes.<NEW>
reaper/packs/core/error_codes.lua                              # REGENERATE via `npm run gen:error-codes`
```

You do **not** touch:

- `packages/mcp-server/src/index.ts` — the MCP tool surface is fixed at
  five tools (I1). New templates are surfaced through `call_template`
  and `list_templates` automatically by virtue of being in the registry.
- `reaper/streetlight_bridge.lua` — the dispatcher is data-driven from
  manifest. New templates need zero bridge changes.
- `packages/core/src/registry.ts` (unless you are evolving the
  `CapabilityDefinition` shape itself — that is a kernel-hardening slice,
  not a template-author slice).

## Optional Dry-Run Scaffolder

Slice 18 adds a conservative, plan-only helper:

```bash
npm run scaffold:template -- \
  --name track_color \
  --entity-kind track \
  --risk write_safe \
  --undoable true \
  --undo-flags TRACKCFG \
  --idempotent true \
  --dry-run
```

The CLI **does not write files**. It validates the descriptor, checks for
existing template slug collisions, and prints deterministic skeletons /
TODO snippets for:

- the TS definition using `defineTemplate(...)`;
- the Lua handler TODO in the existing per-entity module;
- the `manifest.lua` entry;
- the `templates/index.ts` registry import/register lines;
- the MCP-server test TODO.

It is deliberately narrow in this slice: `--pack` must be `core`;
`--entity-kind` is limited to `item`, `track`, or `region`; `--risk` is
limited to `read`, `write_safe`, or `filesystem`; `render`,
`destructive`, `unsafe_eval`, and any file-writing mode are deferred.
The output includes TODOs and is intentionally **not lint-clean** until a
human/agent fills the real schema, ReaScript calls, examples, and tests.

## Step-By-Step

### 1. Write the TS template definition

`packages/mcp-server/src/templates/<name-kebab>.ts`.

Mandatory shape (see `item-pitch.ts`, `track-create.ts` for live
examples — both are 60–80 lines, no boilerplate beyond this):

```ts
import { z } from "zod";
import { callTemplateResultSchema, defineTemplate } from "./_shared.js";

const FooBarParams = z
  .object({
    // every field gets .describe(...) — that text is what agents read in
    // `list_templates`. Treat it as user-facing documentation.
  })
  .strict();

const FooBarResult = callTemplateResultSchema("foo_bar");

export const fooBarDefinition = defineTemplate({
  name: "foo_bar",
  description: "Imperative-mood one-line summary.",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  entity_kind: "item",
  undo_flags: ["ITEMS"],
  idempotent: true,
  expectedDelta: {
    count: 1,
    // fields: [...] when you can postcondition-check a field readback.
  },
  params: FooBarParams,
  result: FooBarResult,
  examples: [
    {
      description: "Short imperative phrase: 'Trim the selected item to 1.5s.'",
      params: { /* fully-formed, must parse on FooBarParams.strict() */ },
    },
  ],
});
```

`defineTemplate(...)` is intentionally thin: it returns the exact object
you pass in and adds no defaults, schema generation, normalization, or
runtime behavior. Keep `const FooBarResult =
callTemplateResultSchema("foo_bar")` explicit; the helper does not infer or
create the locked result envelope for you.

Rules the lint enforces:

- File name (kebab) ↔ `definition.name` (snake): `foo-bar.ts ↔ foo_bar`.
- `examples[i].params` must `parse()` on `FooBarParams`. The schema is
  `.strict()`, so an example with an unknown key fails. Out-of-range
  values fail. **You may not include "should be rejected" examples** —
  if you want to document negative cases, put them in
  `scripts/__tests__/template-authoring-lint.test.mjs` as test fixtures.

Rules the registry validation in `packages/core/src/registry.ts` enforces:

- `examples` must be a non-empty array.
- `undoable=true` ⟺ `undo_flags.length > 0`.
- `expectedDelta` mode flags (`creates` / `maybeCreates` / `deletes`) are
  mutually exclusive.
- `maybeCreates` requires a numeric `count`.
- `fields[]` must be non-empty when present; field `scope` is one of
  `take`/`item`/`track`/`region`; `paramPath` is a single top-level key;
  optional-all is legal only when every field is also `nullable:true`.

Use `.describe(...)` on every Zod field. That string lands in
`list_templates` output and is what agents read to know what the param
means.

### 2. Register the template

`packages/mcp-server/src/templates/index.ts`:

```ts
import { fooBarDefinition } from "./foo-bar.js";
...
export function registerCoreTemplates(registry: CapabilityRegistry): void {
  ...
  registry.register(fooBarDefinition);
}
```

One line. The MCP tools (`call_template`, `list_templates`) are entirely
registry-driven — no per-template special-casing in the tool layer.

### 3. Write the Lua handler

Handlers live in the per-entity file:
`reaper/packs/<pack>/templates/<entity>.lua`. For the `core` pack:

- `item.lua` — anything whose `entity_kind == "item"`.
- `track.lua` — `entity_kind == "track"`.
- `region.lua` — `entity_kind == "region"`.
- `render.lua` — `entity_kind == "render"`.
- `media.lua` — `media_import` (it produces `item` changed_ids but lives
  here for module cohesion).

Handler signature (do not vary):

```lua
function M.foo_bar(params, ctx)
  -- params has already been Zod-validated TS-side. Do not re-validate types.
  -- ctx = { refs, last_result, json, errs }
  local errs = ctx.errs
  ...
  return { changed_ids = { "guid:{...}" } }
end
```

Mandatory pattern (study `item.lua` M.item_pitch ~L38 as the canonical
shortest example):

1. Resolve refs first (`ctx.refs.resolve_item(params.item_id, ctx.last_result)`).
   On failure, raise the typed code the resolver returned (fallback to
   `errs.ITEM_NOT_FOUND` / `errs.TRACK_NOT_FOUND` / etc.).
2. Validate runtime-only preconditions (the take exists, the file is
   writable, the source media exists). **Validate before any mutation.**
3. Perform the mutation through ReaScript.
4. Call `reaper.UpdateArrange()` if the change should be visible
   immediately.
5. Return `{ changed_ids = { "guid:" .. guid, ... } }`.

Errors are raised via:

```lua
local function raise(code, message)
  error({ code = code, message = message })
end
raise(errs.SOME_CODE, "Human-readable message.")
```

**Never** `error("string")`. Codes are protocol; bare strings become
`INTERNAL_ERROR` and lose information.

**Never** reference an error code as a string literal in runtime Lua
(e.g. `code = "ITEM_NOT_FOUND"`, `raise("ITEM_NOT_FOUND", ...)`,
`return nil, "ITEM_NOT_FOUND"`). Use `errs.ITEM_NOT_FOUND` /
`ctx.errs.ITEM_NOT_FOUND`. The `check:error-codes-fresh` gate enforces
this.

#### The "errors are zero-mutation" contract

The bridge cannot roll back a half-applied mutation. If your handler:

1. Does mutation A.
2. Discovers a precondition for mutation B that fails.
3. Raises an error.

Then mutation A persists. Agents will see `error` but the project has
already drifted. **Do not** structure handlers this way. Always resolve
refs, fetch handles, and check preconditions *before* you write
anything. `item_trim` is the canonical example (it fetches the take
before writing `D_LENGTH`, because writing `D_LENGTH` then discovering
`TAKE_NOT_FOUND` would leave the item shorter than the caller asked
for).

### 4. Wire the manifest

`reaper/packs/<pack>/manifest.lua`:

```lua
templates = {
  ...
  foo_bar = {
    handler     = item_templates.foo_bar,
    undoable    = true,
    undo_label  = "Streetlight: foo_bar",
    undo_flags  = undo.UNDO_STATE_ITEMS,
    entity_kind = "item",
  },
  ...
}
```

Rules the `check:manifest` gate enforces today:

- `entity_kind`, `undoable`, `undo_flags` agree with the TS
  `CapabilityDefinition`.
- `undo_flags` is single-line (the parser does not accept multi-line `|`
  expressions).

Rules it **does not** enforce yet:

- Missing handler symbols. If `handler = item_templates.foo_bar` points
  at a function that does not exist, the bridge currently catches it at
  `call_template` time as `TEMPLATE_NOT_FOUND`; a future static lint may
  catch it earlier.
- `entity_kind` membership in `entity_buckets`. The bridge performs
  runtime manifest validation; a future static lint may cover this.

Use the matching `undo.UNDO_STATE_*` constants — `manifest-alignment.mjs`
maps them to TS `["ITEMS","TRACKCFG",...]` for comparison.

### 5. Write the tests

Add `packages/mcp-server/src/tools/__tests__/<name-kebab>.test.ts`. The
existing 11 templates each have one. Cover:

- Happy-path: `call_template` produces the locked envelope shape
  (`{template,changed_count,changed_ids,truncated}`).
- `PARAMS_INVALID`: at least one bad input (wrong type, out of range,
  missing required field, unknown extra key against `.strict()`).
- If your template has multiple modes (e.g. `region_create` explicit vs
  item-derived), cover both.

The harness lives in `packages/mcp-server/src/transport/__tests__/fake-bridge.ts`
— it intercepts queue writes so you can assert wire shape without
running REAPER.

### 6. Run static gates

```bash
npm run build
npm test
npm run check:manifest
npm run check:error-codes-fresh
npm run check:template-authoring
git diff --check
```

All six must be green before commit. The order does not matter; `npm test`
is the slowest and most informative if anything breaks.

### 7. Live REAPER smoke (when warranted)

A new mutating template needs a live REAPER smoke. The smoke template
lives in `docs/CROSS_MAC_SMOKE.md` § scenarios; mirror an existing
slice's smoke script for now.

Smokes are unnecessary when:

- The slice changes only TS/docs/static-checks (Slice 03, Slice 16).
- The slice changes only a TS schema field whose runtime behavior is
  already covered by static tests.

Smokes are mandatory when:

- The slice changes any Lua file (`reaper/**`) or the bridge boot path.
- The slice changes a `manifest.lua` entry.
- The slice adds a new error code that runtime Lua uses.
- The slice adds a new wire-shape field that the bridge interprets.

When in doubt, smoke it.

## Pitfalls Catalogue

Read these before you spend an hour debugging one.

### Stale Lua chunks

Every time you change a `.lua` file, the bridge must be reloaded. Every
time you change *the bridge boot path* (e.g. how `error_codes.lua` is
loaded, the shape of `LAST_RESULT`, the `entity_buckets`, the
`DEFERRED` slot semantics) you must **fully quit and reopen REAPER** —
re-running `start_bridge.lua` alone is not enough. Stale `reaper.defer`
chains owned by an old chunk will still claim queue files and produce
ghost behavior.

Live diagnostic: the console line `bridge ready (generation N)` should
show `N = 1` after a full restart, and the `loaded error_codes (22
codes)` line should appear in the same boot. If `N > 1` or you see two
"ready" lines, you have a double-owner; restart REAPER.

The `bridge_owner` file in the queue dir (introduced in Slice 13)
catches the cross-Lua-state double-owner case automatically — when a
newer launcher overwrites the token, the older chunk restores deferred
state and self-exits before claiming new queue files. You should not
need to manage this manually.

### INTERNAL_ERROR is not for control flow

Use typed codes. `INTERNAL_ERROR` is the "I do not know what happened"
escape hatch. It is `recoverable=false` and not stored by the Slice 14
DEDUP table (so retries with the same idempotency key re-execute). If
your handler reaches a state where it raises `INTERNAL_ERROR` for a
known-shape failure, you are missing a typed code and should be
budgeting a separate slice to add one.

### Wire field naming: snake_case on the wire, camelCase in TS

The MCP server converts `expectedDelta.paramPath` (TS camelCase) into
`expected_delta.fields[].param_path` (Lua snake_case) at the
`call_template` boundary. Stay inside the convention — TS uses
camelCase, Lua/wire uses snake_case. If you add a new descriptor field,
update both `packages/mcp-server/src/tools/call-template.ts` (the wire
shaper) and `reaper/streetlight_bridge.lua` plus
`reaper/packs/core/verify.lua` (the consumer).

### `LAST_RESULT` is per-bridge-lifetime

`last_result:item:0` resolves to "the first item from the most recent
successful mutating call." It is cleared on bridge reload. Read calls
(`ping`, `get_state`, `list_templates`, `list_recipes`) and failed
verifies do **not** update `LAST_RESULT`. This is what makes
post-failure `last_result:item:0` reliably point at the *prior*
success, which agents depend on for clean retries. Do not bypass this
in a handler.

### `selected:N` is a snapshot, not a live reference

Resolved exactly once when the bridge dequeues the command. Even if
your handler mutates selection mid-execution, subsequent
`selected:N` lookups inside that same command see the original
snapshot. Multi-step recipes **must not** rely on `selected:N` across
separate commands. Use `guid:{...}` or `last_result:...:N` instead.

### `expectedDelta` is enforced — make it true

If you declare `expectedDelta: { count: 1, fields: [{...P_NAME...}] }`,
the bridge will:

1. Snapshot project counts before the handler.
2. Run the handler.
3. Snapshot project counts after.
4. Read back `P_NAME` on `changed_ids[1]`.
5. If anything disagrees → `VERIFY_FAILED`, `recoverable: false`. The
   mutation is already in the project.

Common mismatches and what they mean:

| Symptom | Cause |
|---|---|
| Structural `VERIFY_FAILED`: `{actual:{items:0,...}, expected:{count:1,creates:true}}` | Handler returned `changed_ids[1]` but did not actually move the project's item count up. Probably reused an existing item; declare `maybeCreates` instead of `creates`. |
| Field `VERIFY_FAILED`: `{field:"D_PITCH", expected:-3, actual:0}` | Handler raised before the `SetMediaItemTakeInfo_Value` call, OR the handler wrote to the wrong scope (item vs take). |
| `VERIFY_FAILED` only on the very first call | Bridge is running stale Lua; see "Stale Lua chunks". |

When something looks like a `verify.lua` bug rather than a handler bug,
remember Slice 12+ region scope rules: region changed-ids are
name-shaped (`region:NAME`), region GUID refs are unsupported in v0.1,
and the synthetic region handle exposes only `{index, pos, rgnend,
name}`.

### External outputs: JSON artifacts first, render path only for WAV render

Slice 21 adds JSON artifact refs for non-project data:
`artifact:<owner_pack>:<scope>:<id>`. New analysis/report/plan-style
templates should use that contract and read back details through
`get_state(scope:"artifact")`; do not return raw JSON objects or raw
paths in `changed_ids`.

`render_region` remains the legacy external-file carve-out. It is the
only template whose `changed_ids` are absolute WAV paths rather than refs,
and it still routes to `LAST_RESULT.renders`. It does not declare
`expectedDelta`. Its terminal envelope is computed in a deferred slot
(Slice 06+, Slice 15 made it DEDUP-eligible). If you are authoring a new
template that has tens-of-seconds latency, read the `render_region`
handler and Slice 15 plan first; copy that deferred pattern carefully —
the deferred slot is single-slot, so two long-running templates active at
once will serialize.

### Idempotency keys are caller-owned

Slice 14/15 added optional `idempotency_key` on `call_template`. The
bridge stores terminal inner envelopes (success + typed errors;
`INTERNAL_ERROR` excluded) in an in-memory FIFO cap-256 DEDUP table.
Your new template is automatically eligible unless it is a read path.
You do **not** need to call into the DEDUP table; the dispatcher
handles it. Just make sure your handler is deterministic enough that
replaying its first envelope is a safe answer to the same logical
operation.

## How `examples[]` Are Used

Three places consume `examples[]`:

1. `list_templates` returns them in metadata. Agents reading
   `list_templates` use them as canonical "this is what a valid call
   looks like" reference.
2. `npm run check:template-authoring` (Slice 16+) parses each
   `examples[i].params` against the template's own Zod schema. Anything
   that fails to parse fails the build.
3. Human readers (you, future contributors, external integrators).

Therefore the contract is: `examples[]` is positive-only. Every entry
must:

- `parse()` successfully on the template's `params` schema.
- Make sense as something an agent might actually send (no placeholder
  `"TODO"` or `"???"` values).
- Demonstrate a real, distinct usage if the template has multiple modes
  (e.g. `region_create` explicit vs item-derived: include one example
  per mode).

What `examples[]` is *not* for:

- Reverse / "should fail" fixtures. Those live in
  `scripts/__tests__/template-authoring-lint.test.mjs` as fixtures the
  lint *expects* to reject.
- Performance-stress or destruction-test cases.
- Inputs you have not actually tried.

## Extending To A New `entity_kind`

The kernel was data-driven on `entity_kind` in Slice 02 (H1 path). A new
entity kind (e.g. `midi_item`, `fx`, `envelope`, `note`, `automation`)
needs:

1. Decide the name. Use a short noun, lowercased, no plural (`item`,
   not `items`).
2. Add an `entity_buckets[<name>] = "<plural>"` entry in
   `reaper/packs/core/manifest.lua`. The plural form is the
   `LAST_RESULT` bucket key.
3. If `last_result:<name>:N` references should be resolvable, register
   a resolver in `reaper/packs/core/refs.lua`. The signature is
   `function(ref, last_result) -> (handle, code, msg)`. The `render`
   kind is the carve-out that has a bucket but no resolver (its
   `changed_ids` are absolute file paths, not refs).
4. If field verification needs to read that entity's properties (e.g.
   `expectedDelta.fields[{scope:"midi_item", ...}]`), extend
   `reaper/packs/core/verify.lua` with a new `FIELD_READERS["<name>"]`
   entry. Slice 12 added the `region` scope this way — use it as the
   template.
5. Add the new scope to the registry's `FIELD_CHECK_SCOPES` set in
   `packages/core/src/registry.ts` and to
   `scripts/manifest-alignment.mjs` if you want field-level coverage
   from day one.

This is **not** a single-slice operation. Plan it as a focused
kernel-hardening slice (analogous to Slice 12 for region scope) and
follow that slice's Architect packet shape.

## Extending To A New Pack

Slice 20B adds the first real pack contract foundation. `core` remains the
default and is always required, but a repo-local domain pack can now be
enabled explicitly through `STREETLIGHT_ENABLED_PACKS` on the MCP side and
`_G.STREETLIGHT_ENABLED_PACKS` on the REAPER side.

Minimum v1 pack shape:

1. Pick a pack id matching `^[a-z][a-z0-9_]*$`.
2. Add `packages/mcp-server/src/packs/<pack>/` with a pack-local
   registration function.
3. Enabled pack order must start with `core`:
   `core,<pack>[,<pack2>...]`.
4. Add `reaper/packs/<pack>/manifest.lua`, `templates/`, optional
   `recipes/`, and optional `docs/packs/<pack>/`.
5. Register the pack in `registerEnabledTemplates(...)`.
6. Keep template names globally unique across all enabled packs.
7. Recipe raw ids must be lower_snake_case and must not contain `:`.
   Keep recipe ids pack-qualified in user-facing metadata:
   `qualified_id = "<pack>:<id>"`.
8. In Slice 20B, non-core packs may not introduce new `entity_kind`
   buckets. Reusing `item`, `track`, `region`, or `render` should reuse
   the core bucket and must not redeclare a conflicting bucket name.
   New entity families need a separate kernel slice first.
9. Run static gates with the pack explicitly enabled:

```bash
STREETLIGHT_ENABLED_PACKS=core,<pack> npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,<pack> npm run check:template-authoring
```

For a live REAPER smoke, set this before loading the bridge:

```lua
_G.STREETLIGHT_ENABLED_PACKS = "core,<pack>"
```

Do not use `core` as a parking lot for cleanup, loop, MIDI, routing, FX,
automation, or unsafe capabilities. If a domain capability needs a pack,
create the pack boundary first or add an explicit expiry slice and
migration checklist in the slice plan.

## Forward-Looking Capability Packs (v0.2+)

These are not in scope for v0.1 template authoring. They are listed here
so you know what shapes the lint and authoring guide must eventually
accommodate. Do not start work on them under this guide:

- **MIDI**: `set_tempo`, `midi_item_create`, `midi_note_add`,
  `midi_cc_add`. Likely a new `midi_item` entity_kind and possibly a
  `note` entity_kind for note-level edits.
- **Routing**: `track_send_create`, `track_send_set_volume`. Probably
  reuses the `track` entity_kind.
- **FX**: `fx_add`, `fx_set_param`, `fx_remove`, `fx_inventory`. Likely
  a new `fx` entity_kind. Read paths (`fx_inventory`) ride on H3.
- **Automation**: `envelope_add_point`, `envelope_get_points`,
  `fx_set_mod`. New `envelope` entity_kind.
- **Render analysis**: render a temp WAV, read loudness/peak/spectrum
  metadata back. Reuses the `render` entity_kind but adds a new
  result-shape contract.

H6's full ladder (this guide started as Phase 0 — see
[`docs/plans/SLICE_16_ARCHITECT_PLAN.md`](plans/SLICE_16_ARCHITECT_PLAN.md))
is:

- Slice 17: `defineTemplate({ ... })` TS helper in
  `packages/mcp-server/src/templates/_shared.ts`. Use it for new TS
  definitions; it is an identity helper and does not generate result
  schemas or change runtime behavior.
- Slice 18: dry-run scaffolder CLI (`scripts/scaffold-template.mjs`)
  that validates the minimal descriptor and prints TS/Lua/test/manifest
  TODO skeletons without writing files.
- Slice 19: use the scaffolder workflow to land a real first example,
  `track_color`, end to end. Static gates and REAPER live smoke passed,
  so this closes the H6 basic loop.

The above capability packs are unblocked only after that ladder is
complete. Stay in scope.

## Cross-References

- Protocol contract: [`docs/TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md).
- Kernel invariants: [`docs/plans/KERNEL_HARDENING_PLAN.md`](plans/KERNEL_HARDENING_PLAN.md) §1.
- Execution discipline: [`docs/plans/KERNEL_HARDENING_EXECUTION.md`](plans/KERNEL_HARDENING_EXECUTION.md) §0.
- Response budget rules: [`docs/RESPONSE_BUDGET.md`](RESPONSE_BUDGET.md).
- Render specifics: [`docs/RENDER_NOTES.md`](RENDER_NOTES.md).
- Live smoke matrix: [`docs/CROSS_MAC_SMOKE.md`](CROSS_MAC_SMOKE.md).
- Slice 16 packet (this guide and its lint):
  [`docs/plans/SLICE_16_ARCHITECT_PLAN.md`](plans/SLICE_16_ARCHITECT_PLAN.md).

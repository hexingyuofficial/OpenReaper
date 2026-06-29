# Architect Plan Packet — Slice 04

Role: Architect packet, no code by itself. Source: revised Slice 04
plan from the Architect handoff on 2026-06-29. Scope locked by the
user: H2 minimum safe slice, structural verification only.

## Goal

Ship the first runtime verification guard for mutating templates:

- add `ExpectedDelta` v1 to TypeScript template descriptors;
- send that descriptor over the queue as `expected_delta`;
- have the Lua bridge take a before/after structural snapshot around
  synchronous mutating handlers;
- return typed `VERIFY_FAILED` when handler-reported `changed_ids`
  disagree with the observed project-count delta.

This slice deliberately verifies only entity-count structure. It does
not verify field values such as pitch, position, fade length, or render
format.

## Non-Goals

- No handler rewrites.
- No rollback on verification failure.
- No field-level verification.
- No new template or tool.
- No change to `manifest.lua`.
- No verification for `render_region`; render remains the deferred
  artifact-path carve-out and omits `expectedDelta`.

## ExpectedDelta v1

```ts
type ExpectedDelta = {
  count: number | "any";
  creates?: boolean;
  maybeCreates?: boolean;
  deletes?: boolean;
};
```

Rules:

- default mode means in-place mutation: `changed_count === count` and
  entity count delta is zero;
- `creates:true` requires positive entity-count growth;
- `deletes:true` requires negative entity-count movement;
- `maybeCreates:true` allows either no count movement or exactly the
  numeric positive delta. This is intentionally used by `track_create`
  because `reuse_existing:true` can legally return success without
  creating a new track;
- `maybeCreates:true` may not be paired with `count:"any"`;
- `creates`, `maybeCreates`, and `deletes` are mutually exclusive.

## Template Descriptors

Expected values for the v0.1 core pack:

- `item_pitch`, `item_move`, `item_rate`, `item_trim`, `item_fade`,
  `track_rename`: `{ count: 1 }`
- `item_duplicate`: `{ count: 1, creates: true }`
- `media_import`: `{ count: "any", creates: true }`
- `track_create`: `{ count: 1, maybeCreates: true }`
- `region_create`: `{ count: 1, creates: true }`
- `render_region`: no `expectedDelta`

## Error Contract

Verification failure returns a normal template error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "VERIFY_FAILED",
    "message": "Template 'item_pitch' produced delta inconsistent with expectedDelta. ... The mutation has been applied — call get_state to inspect actual state.",
    "recoverable": false,
    "details": {
      "expected": {},
      "actual": { "items": 1, "tracks": 0, "regions": 0 },
      "changed_count": 1
    }
  }
}
```

The message must keep the phrase "The mutation has been applied — call
get_state to inspect actual state." Agents must not blindly retry after
`VERIFY_FAILED`.

## Implementation Shape

TypeScript:

- `packages/core/src/registry.ts` owns `ExpectedDelta` and descriptor
  validation.
- `packages/core/src/errors.ts` adds `VERIFY_FAILED` as
  non-recoverable by default.
- `packages/core/src/queue.ts`, `packages/mcp-server/src/transport/file-queue.ts`,
  and `packages/mcp-server/src/tools/call-template.ts` pass
  `expected_delta` over the wire.
- `scripts/manifest-alignment.mjs` statically checks descriptor
  completeness and mode consistency.

Lua:

- `reaper/packs/core/verify.lua` owns `snapshot`, `diff`, and
  `check`.
- `reaper/streetlight_bridge.lua` snapshots before the handler, checks
  after successful synchronous handler return, and only then calls
  `finalize_template`.
- Deferred templates skip this path unless they declare
  `expected_delta`; v0.1 `render_region` does not.

## Acceptance Smoke

Requires a full REAPER quit/reopen before loading the current
`start_bridge.lua`, because this slice changes the bridge's main
template dispatch path.

Minimum live smoke:

1. `ping` connected on the current bridge.
2. `list_templates` shows expectedDelta for the ten undoable mutating
   templates and no expectedDelta on `render_region`.
3. `track_create` with a fresh name succeeds and creates one track.
4. `track_create` with the same name and `reuse_existing:true`
   succeeds under `maybeCreates` with no extra track.
5. `media_import` succeeds and accepts `count:"any"` creation.
6. An in-place item template still succeeds and updates LAST_RESULT.
7. A read scope after verification does not touch LAST_RESULT.
8. `render_region` still succeeds/skips verification and returns only
   its WAV artifact path.
9. A manual mismatch probe returns `VERIFY_FAILED` with
   `recoverable:false`, structured details, and the required
   get_state recovery phrase.

## Regression Notes

- Structural verification is not rollback. On `VERIFY_FAILED`, the
  mutation may already be in the project and the undo history.
- `maybeCreates` is a narrow concession for `track_create` reuse. Do
  not use it to paper over uncertain handler behavior without a
  written reason.
- Read-only scopes must still never touch `LAST_RESULT`.
- `render_region` remains the artifact-path carve-out and is not part
  of this H2 minimum slice.

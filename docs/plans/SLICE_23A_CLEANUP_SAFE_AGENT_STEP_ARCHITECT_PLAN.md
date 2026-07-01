# Slice 23A Architect Plan - Cleanup Safe Agent-Step MVP

Date: 2026-07-01

Phase: 2B, the first safe-apply slice after
[`SLICE_22_CLEANUP_PLAN_ARCHITECT_PLAN.md`](SLICE_22_CLEANUP_PLAN_ARCHITECT_PLAN.md).

Status: implemented, static-green, and REAPER live-smoked. Do not push
without an explicit user ask.

## Goal

Advance Phase 2 cleanup apply without adding a `cleanup_apply_safe`
template. Slice 23A keeps `cleanup_plan` read-only and adds a narrow,
bounded, agent-executable `safe_action` contract for duplicate track
renames. The agent reads the plan artifact, verifies freshness, and calls
existing small templates step by step.

## Locked Decisions

- D1: Use agent-step execution.
- D2: Do not add `cleanup_apply_safe` in Slice 23A.
- D3: `cleanup_safe_v1` allowlist only permits `track_rename`.
- D4: Do not add a report artifact in Slice 23A.
- D5: Do not add `PLAN_STALE`; stale-plan detection is agent-side until
  a real apply template exists.
- D6: Duplicate track rename safe actions must be deterministic and
  collision-safe:
  - sort duplicate tracks by track index;
  - preserve the first track's original name;
  - generate rename steps only for later duplicate tracks;
  - append increasing numeric suffixes;
  - skip names that collide with existing project names or earlier
    generated names;
  - if no unique name is found within the small limit, downgrade the
    suggestion to `review_only`.
- D7: Before execution, the agent reruns `cleanup_plan` and compares
  `source.fingerprint`.
- D8: Before each step, the agent checks the target track GUID still
  exists and its current name equals `expected_before.name`.
- D9: Any fingerprint or `expected_before` mismatch stops execution
  before `track_rename`; no new error code is emitted.

## Contract

`cleanup_plan` remains:

- `pack:"cleanup"`
- `risk:"filesystem"`
- `mutates:false`
- `undoable:false`
- `entity_kind:"artifact"`
- artifact ref prefix `artifact:cleanup:plan:`
- schema `openreaper.cleanup_plan.v1`
- no item/track/region `LAST_RESULT` update

Executable `safe_action` v1 shape:

```json
{
  "type": "track_rename",
  "version": 1,
  "status": "executable",
  "mode": "agent_step",
  "allowlist": "cleanup_safe_v1",
  "apply_template": "track_rename",
  "auto_apply": false,
  "requires_approval": true,
  "action_id": "act_001",
  "step_count": 2,
  "steps_truncated": false,
  "steps": [
    {
      "step_id": "step_001",
      "template": "track_rename",
      "params": {
        "track_id": "guid:{...}",
        "name": "Duplicate 2"
      },
      "expected_before": {
        "type": "track",
        "id": "guid:{...}",
        "index": 4,
        "name": "Duplicate"
      }
    }
  ]
}
```

Review-only safe action shape:

```json
{
  "type": "review_rename",
  "version": 1,
  "status": "review_only",
  "mode": "agent_step",
  "allowlist": "cleanup_safe_v1",
  "auto_apply": false,
  "requires_approval": true,
  "reason": "name_collision_limit"
}
```

Only `duplicate_track_names` may produce executable actions in Slice 23A.
Empty/unnamed tracks, region naming issues, folder observations, and state
warnings remain review-only or have no `safe_action`.

## Non-Goals

- No `cleanup_apply_safe`.
- No `cleanup_apply_destructive`.
- No deletion.
- No new MCP tool.
- No report artifact.
- No `PLAN_STALE` error code.
- No routing or FX repair.
- No delivery closure.
- No audio analysis, MIDI, loop, render, media import, item edits, or
  track creation as executable cleanup actions.
- No cleanup code in `core`.

## Agent Execution Recipe

1. Call `cleanup_plan`.
2. Read the payload with `get_state(scope:"artifact", view:"payload")`.
3. Extract executable actions where:
   - `status:"executable"`;
   - `mode:"agent_step"`;
   - `allowlist:"cleanup_safe_v1"`;
   - every step has `template:"track_rename"`.
4. Rerun `cleanup_plan` and compare `payload.source.fingerprint`.
5. Before each step, read `get_state(tracks)` and verify the target GUID
   and name match `expected_before`.
6. Call `track_rename` with exactly the step params and a stable
   idempotency key.
7. Stop on the first mismatch or typed error. Do not silently continue.

Undo remains one normal `track_rename` undo block per step.

## Static Gates

All static gates passed on 2026-07-01:

- `npm test` -> 412/412
- `npm run build` -> clean
- `npm run check:error-codes-fresh` -> 24 codes fresh
- `npm run check:manifest` -> 12 templates across 1 pack
- `STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:manifest` -> 13
  templates across 2 packs
- `STREETLIGHT_ENABLED_PACKS=core,cleanup,pack_contract_fixture npm run check:manifest`
  -> 15 templates across 3 packs
- `npm run check:template-authoring` -> 12 templates
- `STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:template-authoring`
  -> 13 templates
- `STREETLIGHT_ENABLED_PACKS=core,cleanup,pack_contract_fixture npm run check:template-authoring`
  -> 15 templates
- `git diff --check` -> clean

## Live Smoke

Use [`docs/smokes/cleanup_plan.md`](../smokes/cleanup_plan.md). The smoke
must prove plan readback, executable duplicate-track rename safe actions,
freshness comparison, per-step `expected_before`, successful
agent-step `track_rename`, stale guard stop-before-mutation, locked
artifact envelope, and clean queue teardown.

2026-07-01 live smoke passed on REAPER `7.71/macOS-arm64` with bridge
`core,cleanup`.

- Stamp: `s23-1782901902009`
- Fixture duplicate: `S23 Duplicate s23-1782901902009`
- Collision fixture: `S23 Duplicate s23-1782901902009 2`
- Anchor track: `guid:{5F5AB7EA-03AD-1645-8137-C82E6CE0ACD3}`
- Artifact refs:
  `artifact:cleanup:plan:art_20260701103149486_014_a52fde`,
  `artifact:cleanup:plan:art_20260701103151338_017_d9a0c1`,
  `artifact:cleanup:plan:art_20260701103154639_023_8aee00`,
  `artifact:cleanup:plan:art_20260701103155879_025_3497cb`,
  `artifact:cleanup:plan:art_20260701103159395_031_db1864`, and
  `artifact:cleanup:plan:art_20260701103201659_035_c2eb62`
- Initial fingerprint:
  `tracks=7;regions=3;project=33.500000;hash=1e63536f`
- Generated collision-safe names:
  `S23 Duplicate s23-1782901902009 3` and
  `S23 Duplicate s23-1782901902009 4`

The smoke proved: locked artifact envelope, summary/payload readback,
deterministic repeated payloads, read-only planning, LAST_RESULT
isolation, `PARAMS_INVALID` for `max_suggestions:51`, agent-side
freshness comparison, per-step `expected_before`, two successful
agent-step `track_rename` calls, post-apply duplicate resolution, stale
guard stop-before-mutation, no `PLAN_STALE`, and clean queue teardown.

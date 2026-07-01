# Cleanup Plan Smoke

Slice 23A live smoke verifies the opt-in `cleanup` pack, its read-only
`cleanup_plan` artifact producer, and the narrow agent-step safe action
contract for duplicate track renames. It does not add
`cleanup_apply_safe`, destructive cleanup, delivery, analysis, routing
repair, FX repair, or MIDI.

## Setup

1. Start from any disposable REAPER project.
2. Fully quit and reopen REAPER.
3. Load the bridge with the cleanup pack enabled:

   ```lua
   _G.STREETLIGHT_ENABLED_PACKS = "core,cleanup"
   dofile("/Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/streetlight_bridge.lua")
   ```

4. Confirm the ready line includes both `loaded pack 'cleanup'` and
   `cleanup_plan`.
5. Run the MCP client with `STREETLIGHT_ENABLED_PACKS=core,cleanup`.
6. Confirm the queue starts clean:

   ```sh
   QUEUE_DIR="${STREETLIGHT_QUEUE_DIR:-$HOME/Library/Application Support/Streetlight/queue}"
   find "$QUEUE_DIR"/pending "$QUEUE_DIR"/running "$QUEUE_DIR"/done -maxdepth 1 -type f -name '*.json' -print
   ```

   This should print nothing.

## Scripted Dirty Fixture

Use MCP calls to seed deterministic state instead of relying on a
pre-baked `.RPP`:

1. `track_create` three times with the exact same non-empty name, such as
   `S23 Duplicate <stamp>`. This creates a duplicate-name case with two
   executable `track_rename` steps.
2. Optional collision fixture: `track_create` once with
   `S23 Duplicate <stamp> 2`. A correct plan must then skip that suffix
   and use the next available suffix for the first renamed duplicate.
3. `track_create` once with `S23 Empty <stamp>`. Newly-created tracks are
   empty, so this creates the empty-track case.
4. `region_create` three times with one letter-only family and mixed
   separators/case, such as `szz_01`, `szz 2`, and `SZZ-03`, using
   non-overlapping short bounds. This creates the inconsistent-region
   family case.
5. `track_create` once with `name:"S23 Cleanup Anchor <stamp>"` and
   `reuse_existing:true`. Record this GUID; it is the `LAST_RESULT`
   anchor used after artifact creation.

Optional manual enrichment: before running the plan, set mute, solo, or
recarm on any disposable track to trigger `state_warning`, or create a
folder-depth shape to trigger `folder_depth_observation`. The required
acceptance does not depend on these optional categories.

## Smoke

1. `ping` should return `bridge:"connected"`.
2. `list_templates` should include `cleanup_plan` with:
   - `pack:"cleanup"`;
   - `risk:"filesystem"`;
   - `mutates:false`;
   - `undoable:false`;
   - `entity_kind:"artifact"`;
   - `artifact.scope:"plan"`;
   - `artifact.ref_prefix:"artifact:cleanup:plan:"`;
   - `artifact.schema:"openreaper.cleanup_plan.v1"`;
   - `artifact.updates_last_result:false`.
3. Snapshot `get_state(project)`, `get_state(tracks)`, and
   `get_state(regions)` after the anchor track is created.
4. Call:

   ```json
   {
     "name": "cleanup_plan",
     "params": {
       "max_suggestions": 25
     }
   }
   ```

5. Expect the locked envelope only:

   ```json
   {
     "template": "cleanup_plan",
     "changed_count": 1,
     "changed_ids": ["artifact:cleanup:plan:art_..."],
     "truncated": false
   }
   ```

   The envelope must not include `artifact`, `payload`, `summary`,
   `suggestions`, `plan`, or `path`.

6. `get_state(scope:"artifact", view:"summary")` should return wrapper
   metadata and summary counts, without `payload`.
7. `get_state(scope:"artifact", view:"payload")` should return:
   - wrapper metadata for the same ref;
   - `schema:"openreaper.cleanup_plan.v1"`;
   - `payload.inputs.max_suggestions == 25`;
   - deterministic `payload.source.fingerprint`;
   - bounded `payload.suggestions`;
   - `target_count` on each suggestion and `targets_truncated:true` when
     a preview omits targets;
   - for duplicate track names, `safe_action.status:"executable"`,
     `mode:"agent_step"`, `allowlist:"cleanup_safe_v1"`,
     `apply_template:"track_rename"`, and bounded `steps`;
   - each executable step has `template:"track_rename"`,
     `params.track_id` as a track GUID, a deterministic collision-safe
     `params.name`, and `expected_before` with the same target GUID and
     current name;
   - the first duplicate track by index keeps the original name; only
     later duplicate tracks receive generated suffix names;
   - empty-track, region-name, folder-depth, and state-warning
     suggestions are absent `safe_action` or `safe_action.status` is
     `review_only`;
   - `payload.deferred` naming the intentionally-deferred apply,
     destructive, routing, FX, analysis, and delivery capabilities;
   - `response_bytes <= 65536`.
8. Run `cleanup_plan` a second time with the same params and read the
   second payload. The two refs should differ; normalized content should
   match after ignoring only wrapper `ref`, `id`, `created_at`, and
   file path.
9. Re-snapshot `project`, `tracks`, and `regions`; compare to the
   post-anchor snapshot. `cleanup_plan` must not mutate project state.
10. `track_rename last_result:track:0` should still hit the anchor
    track, proving plan artifacts did not pollute project `LAST_RESULT`.
11. `cleanup_plan` with `max_suggestions:51` should return
    `PARAMS_INVALID` before bridge execution.
12. Agent-step safe apply:
    - run `cleanup_plan` again and read its payload;
    - compare the new `payload.source.fingerprint` to the original
      fingerprint;
    - for each executable duplicate-name step, read `get_state(tracks)`
      and confirm the target track GUID still exists and its current name
      equals `expected_before.name`;
    - call `track_rename` with exactly the step params, using a stable
      idempotency key such as
      `s23-<stamp>-<action_id>-<step_id>`;
    - stop on the first fingerprint mismatch, `expected_before` mismatch,
      or typed error. Do not call `track_rename` after a mismatch.
13. Re-run `cleanup_plan` and read the payload. The original duplicate
    suggestion should be gone or reduced according to remaining duplicate
    state; no deletion, routing, FX, delivery, audio-analysis, render,
    import, item edit, or track-create action should appear as executable.
14. Stale guard:
    - create a fresh plan;
    - manually or through `track_rename` change one planned target's name;
    - before applying the old plan, compare either the fresh fingerprint
      or the step `expected_before`;
    - expect the agent to stop without calling `track_rename`. Slice 23A
      has no `PLAN_STALE` error code because there is no apply template.
15. Queue cleanup should end with no `pending/`, `running/`, or `done/`
    JSON files. Artifact JSON files under `artifacts/v1` may remain for
    TTL cleanup.

# Cleanup Plan Smoke

Slice 22 live smoke verifies the opt-in `cleanup` pack and its read-only
`cleanup_plan` artifact producer. It does not claim cleanup apply,
destructive cleanup, delivery, analysis, routing repair, FX repair, or
MIDI.

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

1. `track_create` twice with the exact same non-empty name, such as
   `S22 Duplicate <stamp>`. This creates the duplicate-name case.
2. `track_create` once with `S22 Empty <stamp>`. Newly-created tracks are
   empty, so this creates the empty-track case.
3. `region_create` three times with one letter-only family and mixed
   separators/case, such as `szz_01`, `szz 2`, and `SZZ-03`, using
   non-overlapping short bounds. This creates the inconsistent-region
   family case.
4. `track_create` once with `name:"S22 Cleanup Anchor <stamp>"` and
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
12. Queue cleanup should end with no `pending/`, `running/`, or `done/`
    JSON files. Artifact JSON files under `artifacts/v1` may remain for
    TTL cleanup.

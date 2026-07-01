# Analysis Contract Smoke

This smoke verifies the analysis pack with a real REAPER bridge. Slice 25
covers loudness / peaks / silence; Slice 26 adds explicit opt-in
transient candidates; Slice 27 adds explicit opt-in loop candidate
intervals.

## Preconditions

Fully quit and reopen REAPER, then load:

```lua
_G.STREETLIGHT_ENABLED_PACKS = "core,analysis"
dofile("/Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/streetlight_bridge.lua")
```

The ready line should include `item_audio_analyze`, and should show 26
error codes.

## Recipe

1. `ping`; confirm `bridge:"connected"`.
2. `list_templates`; assert `item_audio_analyze` has `pack:"analysis"`,
   `entity_kind:"artifact"`, and JSON artifact metadata:
   `artifact:analysis:analysis:` /
   `openreaper.analysis.item_audio.v1`.
3. Generate a short WAV under `/tmp` with silence + tone, or import an
   equivalent known file.
4. Create a fresh track, import the WAV, and select the imported item.
5. Call:

   ```json
   {
     "name": "item_audio_analyze",
     "params": { "item_id": "selected:0" }
   }
   ```

6. Expect the locked envelope only, with one changed id shaped
   `artifact:analysis:analysis:<id>`.
7. Read summary:

   ```json
   {
     "scope": "artifact",
     "artifact_ref": "<ref>",
     "view": "summary"
   }
   ```

   Expected: finite `rms_dbfs` / `peak_dbfs`, `computed_features`
   contains `loudness`, `peaks`, `silence`, and `response_bytes` is
   under the cap.
8. Read payload. Expected: `loudness`, `peaks`, and `silence` objects;
   silence `segments` is an array, `segment_count <= 200`, and
   warnings state RMS-not-LUFS and sample-peak-not-true-peak.
9. LAST_RESULT isolation: create/rename a track so
   `last_result:track:0` is live, call `item_audio_analyze`, then
   `track_rename last_result:track:0` successfully.
10. Transient regression: generate or import a short WAV with 4-6 obvious
    hits, then call:

    ```json
    {
      "name": "item_audio_analyze",
      "params": {
        "item_id": "selected:0",
        "features": ["transients"]
      }
    }
    ```

    Expected: locked envelope with one artifact ref; summary
    `computed_features:["transients"]`; transient count around the known
    hit count; `transients_truncated:false`; payload events carry
    item-local `time`, `project_time`, `peak_linear`, `peak_dbfs`, and
    `score_db`. Threshold metadata must expose the actual
    `threshold_dbfs` and the floor `transient_threshold_floor_dbfs=-60`
    separately.
11. Loop-candidate regression: call with
    `features:["loop_candidates"]`. Expected: locked envelope with one
    artifact ref; summary `computed_features:["loop_candidates"]`;
    payload includes bounded `loop_candidates.candidates` with score
    `0..1`, item-local `start/end/duration`, 0-based transient indices,
    stable `reason` strings, and `warnings`; payload does **not** expose
    `transients` unless `transients` was also requested. Zero candidates
    is not an error, but should include a warning.
12. Combined transient+loop regression: call with
    `features:["transients","loop_candidates"]`; payload includes both
    `transients.events` and `loop_candidates.candidates`, and candidate
    transient indices refer into the events array.
13. All-feature regression: call with
    `["loudness","peaks","silence","transients","loop_candidates"]`;
    old Slice 25 fields remain sane, transients remain bounded, and
    loop candidates remain bounded.
14. Negative: source unavailable. If a stable offline-media setup is not
    practical, use an item with no active take. Expected typed error:
    `AUDIO_SOURCE_OFFLINE`.
15. Regression: `get_state(scope:"analysis")` remains invalid or
    unimplemented; use `scope:"artifact"` only.
16. Queue ends clean: `pending=0`, `running=0`, `done=0`.

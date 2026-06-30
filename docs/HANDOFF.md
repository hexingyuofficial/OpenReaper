# Handoff — 2026-06-30 (Kernel Slice 13 ✅ live-smoked; region_create bounds verify)

Short, dense. Read this first. Long-form log is in `docs/PROGRESS.md`.

## Where the project is

- Path: `/Users/Zhuanz/Documents/streetlight-reaper-mcp`, git repo on
  branch `main`. Recent pushed checkpoints: `baa13bd` Kernel Slice
  01, `e93d39e` Kernel Slice 02, `4e80839` Kernel Slice 03,
  `d3f8fe7` Kernel Slice 04, `5ba6318` Kernel Slice 05, and
  `9f56ce0` Kernel Slice 06, `9244be3` Kernel Slice 07,
  `c923df9` Kernel Slice 08, `bf15daa` Kernel Slice 09,
  `2babc5c` Kernel Slice 10, `f66b2db` Kernel Slice 11, and
  `6e4a02f` Kernel Slice 12. Slice 13 is code-done locally and
  live-smoked on REAPER 7.71/macOS-arm64. H2 field-level verification now covers
  `region_create` explicit bounds: `name`, `pos`, and `rgnend`. The
  user manages versioning out-of-band — do NOT commit, branch, push, or
  reset without an explicit ask.
- Slice 13 static baseline after the mid-smoke owner fix: full
  `npm test` → **293/293 green**, `npm run build` → clean,
  `npm run check:manifest` → 11 templates aligned,
  `npm run check:error-codes-fresh` → 22 codes fresh, and
  `git diff --check` → clean. Focused Slice 13 suite was **90/90
  green** before the owner fix; the bridge-structure test added one
  more static guard. The implemented contract is
  `region_create.expectedDelta = {count:1, creates:true, fields:[region
  name <- name, region pos <- start optional tolerance 1e-6, region
  rgnend <- end optional tolerance 1e-6]}`. No Lua runtime files changed:
  Slice 13 activates the `pos` / `rgnend` region readers added in
  Slice 12 and the optional-absent rule added in Slice 07. First
  REAPER smoke attempt stopped at S2b with a double-owner
  `LAST_RESULT` split (two `generation 1` ready lines; `track_create`
  succeeded in one bridge instance, `media_import last_result:track:0`
  was claimed by another). Mid-smoke blocker fix adds a file-backed
  `bridge_owner` token in the queue dir so the last launcher run is the
  only owner even across separate ReaScript Lua states. REAPER re-smoke
  `slice13-1782809548082` is green; S2b proved the owner-guard
  regression by importing media with `track_id:"last_result:track:0"`
  immediately after `track_create`.
- `docs/PUBLIC_STORY.md` is the living public narrative / launch-copy
  source. Update it whenever a capability becomes implemented and
  live-smoked. Keep future-facing claims phrased as roadmap until they
  are real.
- **Kernel hardening Slice 13 ✅ live-smoked / not committed
  (2026-06-30).** Scope from
  `docs/plans/SLICE_13_ARCHITECT_PLAN.md`:
  - `region_create.expectedDelta.fields[]` expands from one field to
    three, preserving field order `[name, pos, rgnend]`.
  - Explicit mode `{name,start,end}` verifies all three fields:
    `region.name <- params.name`, `region.pos <- params.start`, and
    `region.rgnend <- params.end`; numeric bounds use tolerance `1e-6`.
  - Item-derived mode `{name,item_id}` still verifies only `name` at
    runtime because `params.start` / `params.end` are absent and the
    bounds fields are `optional:true`. Strong item-mode bounds verify
    would require a computed-expected descriptor axis and is deferred to
    Slice 14+ / v0.2.
  - No Lua runtime files changed. `verify.lua` already exposes
    `read_region_field(handle,"pos")` and `"rgnend"` from Slice 12, and
    Slice 07 already owns optional-absent skipping.
  - Decisions locked by user: D1=a region bounds; D2=a `pos` /
    `rgnend`; D3=a tolerance `1e-6`; D4=a order `[name,pos,rgnend]`;
    D5=a document item-mode name-only trade-off; D6=a reuse Slice 12
    orphan-region contract; D7=b packet references Slice 12 baseline
    `6e4a02f`.
  - Static gates are green after the owner fix: full `npm test`
    293/293, `npm run build` clean, `npm run check:manifest` green,
    `npm run check:error-codes-fresh` green, and `git diff --check`
    clean. Focused Slice 13 suite was 90/90 before the owner guard; the
    new bridge-structure guard brings the full count up by one.
  - Reviewer pass completed with no P1/P2/P3 findings.
  - First live smoke attempt `slice13-1782808140769` passed S0/S1 and
    proved `region_create.expectedDelta.fields[]` is `[name,pos,rgnend]`
    with `render_region` still fieldless, then stopped at S2b:
    `track_create` returned `guid:{BA65F64D-85EE-E54E-8A01-7A021E91AD57}`
    but the following `media_import track_id:"last_result:track:0"`
    returned `REF_INVALID` saying no changed tracks existed. Console
    had two identical `generation 1` ready blocks, which is the
    separate-Lua-state double-owner symptom.
  - Mid-smoke blocker fix: `reaper/streetlight_bridge.lua` now writes a
    queue-dir `bridge_owner` token at startup and checks it before
    `process_one` every tick. If another launcher run has overwritten
    the token, the older state restores any deferred terminal state and
    self-exits before claiming queue files. This complements the `_G`
    generation guard, which only covers reloads inside the same Lua
    state.
  - REAPER re-smoke passed after the user's full REAPER restart and
    current bridge load. Run id: `slice13-1782809548082`; queue:
    `/Users/Zhuanz/Library/Application Support/Streetlight/queue`;
    REAPER `7.71/macOS-arm64`. User-provided console preflight showed a
    single current `bridge ready (generation 1)` and `loaded error_codes
    (22 codes)`.
  - S2 owner-guard regression passed: `track_create` returned
    `guid:{1AFDB38A-6C5E-7E49-B618-33FF483AFBA2}`, then
    `media_import track_id:"last_result:track:0"` returned item
    `guid:{CF9CC998-3614-E243-A15A-7A7F0C078627}` instead of repeating
    the prior `LAST_RESULT` split.
  - S3/S4/S5 region paths passed: explicit simple region
    `slice13-1782809548082-explicit-simple` round-tripped
    `[0,1]`; explicit nontrivial region
    `slice13-1782809548082-explicit-nontrivial` round-tripped
    `[7.13,13.71]`; item-mode
    `slice13-1782809548082-item-mode` passed with name-only verify via
    optional bounds skip.
  - S6/S8/S9/S10 raw mismatch paths returned `VERIFY_FAILED` with
    `recoverable:false`: unsupported `posX`, missing `startX` without
    optional, numeric `pos <- end` mismatch with tolerance `1e-6`, and
    structural count `2` vs actual `1` where top-level details omitted
    `fields[]`. Failed verifies left expected orphan regions but did not
    update `LAST_RESULT`.
  - S11/S12/S13/S14/S15 regressions passed: post-failure
    `track_rename` / `item_move` still hit the original entities;
    representative `item_trim`, `item_fade`, `item_duplicate`,
    `track_create` reuse, and `media_import` first-item checks passed;
    error-code probes covered `REGION_NAME_INVALID`,
    `REGION_NAME_TAKEN`, `ITEM_NOT_FOUND`, `MEDIA_NOT_FOUND`,
    `PARAMS_INVALID`, and `SCOPE_NOT_IMPLEMENTED`; `get_state(regions)`
    showed the happy and orphan region names; `render_region` produced a
    single WAV path for the simple region, with RIFF/WAVE 24-bit stereo
    header, then the temp dir was deleted.
- **Kernel hardening Slice 12 ✅ live-smoked / committed and pushed
  (2026-06-30).** Scope from
  `docs/plans/SLICE_12_ARCHITECT_PLAN.md`:
  - `region_create` keeps its locked success envelope and
    `expectedDelta={count:1,creates:true}`, but adds one field check:
    region `name` from `params.name`, with no tolerance, `optional`, or
    `nullable`.
  - This opens the `region` field scope. `verify.lua` now has an
    internal `parse_region_ref`, `find_region_by_name`, and
    `FIELD_READERS.region`. The reader returns a synthetic region handle
    `{index,pos,rgnend,name}` and supports `name`, `pos`, and `rgnend`,
    but Slice 12 declares only `name`.
  - Region identity remains name-shaped in v0.1: `changed_ids` use
    `region:NAME`. Region GUID refs remain unsupported.
  - The `name` check is a pipeline proof-of-life like Slice 10's
    `track_create` reuse path: the handler creates the region with
    `params.name`, then verify reads the region by `region:NAME` and
    compares the string. Bounds verification is deferred to Slice 13.
  - Still deferred: `region_create` `pos` / `rgnend` field descriptors
    and the `render_region` artifact-path carve-out.
  - Decisions locked by user from the Architect packet:
    D1=a `region_create`; D2=a name only; D3=a synthetic region struct;
    D4=a verify-local region scanner, do not reuse refs.lua; D5=a strict
    string equality; D6=a document the pipeline proof-of-life in
    `docs/TEMPLATE_SPEC.md`; D7=a document orphan-region side effects.
  - Static gates are green: focused suite 89/89, full `npm test`
    291/291, `npm run build` clean, `npm run check:manifest` green, and
    `npm run check:error-codes-fresh` green, and `git diff --check`
    clean.
  - Focused reviewer pass found no P1/P2 issues. The only P3 doc nit
    was stale `docs/TEMPLATE_SPEC.md` wording that still called
    `last_result:region:N` future-facing; it is fixed.
  - Live smoke passed after the user's full REAPER restart and current
    bridge load. Console evidence before the run showed
    `bridge ready (generation 1)` and `loaded error_codes (22 codes)`.
    Smoke run id: `slice12-1782804345538`; queue:
    `/Users/Zhuanz/Library/Application Support/Streetlight/queue`.
  - S0/S1: `ping` returned `bridge:"connected"` and
    `reaper_version:"7.71/macOS-arm64"`. `list_templates` had 11
    templates; `region_create.expectedDelta` was exactly
    `{count:1, creates:true, fields:[{scope:"region", field:"name",
    paramPath:"name"}]}` with no `tolerance`, `optional`, or
    `nullable`; `render_region` still omitted `expectedDelta`.
  - S2/S3: explicit region `slice12-1782804345538-explicit` and
    item-derived region `slice12-1782804345538-item` both returned ok
    with `changed_ids = ["region:<name>"]` and read back through
    `get_state regions`.
  - S4/S5: raw forced field mismatch created orphan region
    `slice12-1782804345538-raw-orphan` while expecting
    `slice12-1782804345538-raw-expected-other`; bridge returned
    `VERIFY_FAILED`, `recoverable:false`, and
    `details.fields[0] = {scope:"region", field:"name",
    expected:"slice12-1782804345538-raw-expected-other",
    actual:"slice12-1782804345538-raw-orphan", ok:false}`. A following
    `region_create item_id:"last_result:item:0"` succeeded as
    `slice12-1782804345538-lr-item-after-fail`, proving failed verify
    did not update `LAST_RESULT`. Read scopes also did not pollute
    `last_result:item:0` or `last_result:track:0`.
  - S6/S7: regression codes passed for `REGION_NAME_INVALID`,
    `REGION_NAME_TAKEN`, cross-type `REF_INVALID`, `PARAMS_INVALID`,
    and `SCOPE_NOT_IMPLEMENTED` on `get_state(render)`. H2
    representatives passed for `item_trim` optional field,
    `item_fade` nullable field, `media_import` first-item
    `D_POSITION`, `track_create` name, and `item_duplicate`
    `D_POSITION`.
  - S8: `render_region` rendered region `slice12-1782804345538-render`
    to a temp WAV path only; `/usr/bin/file` reported
    `WAVE audio, Microsoft PCM, 24 bit, stereo 48000 Hz`. Temp render
    dir was removed. Queue cleanup check ended at
    `pending=0`, `running=0`, `done=0`.
  - Committed and pushed at `6e4a02f`.
- **Kernel hardening Slice 11 ✅ live-smoked / committed and pushed
  (2026-06-30, `f66b2db`).** Scope from
  `docs/plans/SLICE_11_ARCHITECT_PLAN.md`:
  - `media_import` keeps its locked success envelope and
    `expectedDelta={count:"any",creates:true}`, but adds one field check:
    item `D_POSITION` from `params.position`, tolerance `1e-6`.
  - This is the third D5 relaxation: `expectedDelta.fields[]` may now
    coexist with `creates:true` and `count:"any"`. The semantics are
    deliberately first-item only: the bridge verifies `changed_ids[1]`
    and does not loop over every imported item.
  - No Lua runtime files changed. `verify.lua` already resolves
    `changed_ids[1]` as a GUID-shaped item ref and reads item
    `D_POSITION`; Slice 11 only lets a `count:"any"` descriptor use that
    existing path.
  - Multi-item import caveat: if REAPER returns more than one changed id,
    Slice 11 verifies the first changed item only. Remaining ids stay in
    the success envelope but are not field-checked.
  - Still deferred: `region_create` / region scope + `region:NAME` refs
    (Slice 12+), and `render_region` artifact-path carve-out.
  - Decisions locked by user from the Architect packet:
    D1=a `media_import`; D2=a first-item verify only; D3=a verify only
    `D_POSITION`; D4=a document the `count:"any"` first-item contract in
    `docs/TEMPLATE_SPEC.md`; D5=a tolerance `1e-6`; D6=a a failed
    import may leave an orphan item but must not update `LAST_RESULT`.
  - New / updated static redlines cover the D5 boundary in both
    `packages/core/src/registry.ts` and
    `scripts/manifest-alignment.mjs`; `list_templates` and
    `call_template` tests assert the `media_import` wire / metadata
    shape; Lua structure tests assert Slice 11 stays first-changed-id
    only and did not add region field verification scope.
  - Static gates are green: focused suite 82/82, full `npm test`
    284/284, `npm run build` clean, `npm run check:manifest` green,
    `npm run check:error-codes-fresh` green, and `git diff --check`
    clean.
  - Live smoke passed against REAPER `7.71/macOS-arm64`, queue
    `/Users/Zhuanz/Library/Application Support/Streetlight/queue`,
    run id `slice11-202606300552524` at
    `2026-06-30T05:52:52.495Z`.
  - `list_templates` confirmed `media_import.expectedDelta` is
    `count:"any" + creates:true + fields:[item D_POSITION <- position]`
    with tolerance `1e-6` and no `optional` / `nullable`. `region_create`
    still has no fields; `render_region` still omits `expectedDelta`.
  - Happy `media_import` inserted `/System/Library/Sounds/Ping.aiff`
    on track `guid:{543A670E-D2F5-9349-A56E-6F815A68FE74}` at
    `position:3.25`, returning item
    `guid:{3564616B-EC9C-DD48-86B8-F5746029D77E}`; descriptor field
    verification accepted `D_POSITION` within `1e-6`.
  - Forced raw mismatch imported at `position:4.5` but expected
    `12345.6789`, returned `VERIFY_FAILED`, `recoverable:false`, kept
    the "call get_state to inspect actual state" recovery phrase, and
    included `details.fields[0]` with `field:"D_POSITION"`,
    `actual:4.5`, `expected:12345.6789`.
  - `LAST_RESULT` was not polluted by that failure: after anchoring
    `LAST_RESULT` to the smoke track, `track_rename
    last_result:track:0` after the forced failure still returned
    `guid:{543A670E-D2F5-9349-A56E-6F815A68FE74}`.
  - Regressions passed: `get_state(project/tracks/regions)` works,
    `get_state(render)` returns `SCOPE_NOT_IMPLEMENTED`,
    `region_create` stayed fieldless and returned
    `region:SL11_slice11-202606300552524_region`. Queue cleanup ended
    with empty `pending/`, `running/`, and `done/`.
  - Expected REAPER project leftovers for manual undo/delete:
    smoke track `guid:{543A670E-D2F5-9349-A56E-6F815A68FE74}` named
    `SL11 Smoke slice11-202606300552524 last-result-survived`, happy
    import item `guid:{3564616B-EC9C-DD48-86B8-F5746029D77E}`, forced
    mismatch orphan item `guid:{3E6B8A15-8472-1D40-8AF6-6320008B8CB7}`
    at `4.5`, and smoke region
    `SL11_slice11-202606300552524_region`.
- **Kernel hardening Slice 10 ✅ live-smoked / committed and pushed
  (2026-06-30, `2babc5c`).** Scope from
  `docs/plans/SLICE_10_ARCHITECT_PLAN.md`:
  - `track_create` keeps its locked success envelope and
    `expectedDelta={count:1,maybeCreates:true}`, but adds one field
    check: track `P_NAME` from `params.name`. It intentionally has no
    tolerance, `optional`, or `nullable`.
  - This was the second D5 relaxation at Slice 10 time:
    `expectedDelta.fields[]` may coexist with `maybeCreates:true` only
    when `count` is a finite positive integer. Slice 11 later opens
    `creates:true` plus `count:"any"` for first-item verification.
    Static validation still rejects fields with `deletes:true` and any
    region field scope.
  - No Lua runtime code changed in this slice. `verify.lua` already
    resolves `changed_ids[1]` as a GUID-shaped track ref and reads
    track `P_NAME`; Slice 10 only lets a maybeCreates-style descriptor
    use that existing path.
  - Create and reuse paths both run field verification. The reuse path
    has `delta_tracks=0`, which Slice 04's maybeCreates structural
    rule already accepts; `P_NAME` then verifies as a pipeline
    proof-of-life because reuse finds the track by that same name.
  - Now covered by Slice 11 code-done: `media_import` /
    `count:"any"` first-item verification. Still deferred:
    `region_create` / region scope + `region:NAME` refs (Slice 12+),
    and `render_region` artifact-path carve-out.
  - Decisions locked by user from the Architect packet:
    D1=a `track_create`; D2=a allow maybeCreates only, keep
    `count:"any"` closed; D3=a verify only `P_NAME`; D4=a do not
    short-circuit reuse field verification; D5=a no tolerance for
    string field; D6=a failed create may leave an orphan track but must
    not update `LAST_RESULT`.
  - New / updated static redlines cover the D5 boundary in both
    `packages/core/src/registry.ts` and
    `scripts/manifest-alignment.mjs`; `list_templates` and
    `call_template` tests assert the `track_create` wire / metadata
    shape; Lua structure tests assert Slice 10 did not add region field
    verification scope.
  - Live smoke S0-S17 passed after full REAPER restart and current
    `start_bridge.lua` load. Console precondition showed `bridge
    starting (generation 1)`, `loaded error_codes (22 codes)`, and
    `bridge ready (generation 1)`.
  - Smoke timestamp: `20260630032823069`. Main test track:
    `guid:{5AACF036-56CF-7141-8F1D-925A1457FDB2}`.
  - `list_templates` confirmed `track_create.expectedDelta` is
    `count:1 + maybeCreates:true + fields:[track P_NAME <- name]` with
    no `tolerance`, `optional`, or `nullable`.
  - Create path verified `delta_tracks=+1` and `P_NAME`; reuse path
    verified the same GUID with `delta_tracks=0` and `P_NAME`.
  - Raw `P_NAMEX` mismatch returned `VERIFY_FAILED` with
    `details.fields[]`, `recoverable:false`; both create and reuse
    failure paths left `LAST_RESULT` unchanged.
  - Slice 06-09, `get_state`, and `render_region` regressions passed.
    The render temp dir was checked for WAV-only output and deleted;
    the queue finished clean.
  - Expected REAPER project leftovers from verify-failure side effects:
    `force-c-20260630032823069`,
    `Slice10 PP 20260630032823069`, and
    `Slice10 SM 20260630032823069`. S8 reuse mismatch created no orphan.
- **Kernel hardening Slice 09 ✅ live-smoked
  / committed and pushed (2026-06-30, `bf15daa`).**
  Scope from `docs/plans/SLICE_09_ARCHITECT_PLAN.md`. Static baseline:
  `npm test` 272/272, build clean, manifest/error-code checks green,
  and `git diff --check` clean. Reviewer pass completed with only P3
  nits, now fixed; REAPER live smoke passed on REAPER
  7.71/macOS-arm64.
  - `item_duplicate` now keeps its locked success envelope and
    `expectedDelta={count:1,creates:true}`, but adds one field check:
    item `D_POSITION` from `params.position`, tolerance `1e-6`.
  - This is the first D5 relaxation: `expectedDelta.fields[]` may
    coexist with `creates:true` only when `count` is a finite positive
    integer. Static validation still rejects `fields[]` with
    `maybeCreates:true`, `deletes:true`, and `creates:true` plus
    `count:"any"`.
  - No Lua runtime code changed in this slice. `verify.lua` already
    resolves `changed_ids[1]` as a GUID-shaped item ref and reads item
    `D_POSITION`; Slice 09 only lets a creates-style descriptor use
    that existing path.
  - Later covered by Slice 10 and Slice 11: `track_create` /
    `maybeCreates`, and `media_import` / `count:"any"` first-item
    verification. Still deferred: `region_create` / region scope +
    `region:NAME` refs (Slice 12+), and `render_region` artifact-path
    carve-out.
  - Decisions locked by user from the Architect packet:
    D1=a `item_duplicate`; D2=a creates-only, no maybeCreates;
    D3=a numeric positive count only, no `count:"any"`; D4=a verify
    only `D_POSITION`; D5=a tolerance `1e-6`.
  - New / updated static redlines cover the D5 boundary in both
    `packages/core/src/registry.ts` and
    `scripts/manifest-alignment.mjs`; `list_templates` and
    `call_template` tests assert the `item_duplicate` wire / metadata
    shape; Lua structure tests assert Slice 09 did not add region
    field verification scope.
  - Live smoke passed after full REAPER quit/reopen and current
    `start_bridge.lua` run. Console evidence supplied by the user:
    `bridge starting (generation 1)`, queue dir
    `/Users/Zhuanz/Library/Application Support/Streetlight/queue`,
    `loaded error_codes (22 codes)`, and
    `bridge ready (generation 1) — loaded error_codes (22 codes)` with
    all 11 templates. `ping` returned `connected` on
    `7.71/macOS-arm64`.
  - Smoke run id: `slice09-1782785591409`; evidence snapshot:
    `/tmp/streetlight_slice09_live_smoke_evidence.json`.
    `list_templates` showed
    `item_duplicate.expectedDelta={count:1,creates:true,fields:[item
    D_POSITION <- position, tolerance 1e-6]}` with no `optional` /
    `nullable`. `track_create`, `media_import`, and `region_create`
    still had no `fields`; `render_region` still had no
    `expectedDelta`.
  - Happy `item_duplicate` verified new item `D_POSITION`: same-track
    duplicate `guid:{F21B1BCA-29D3-B048-A690-8D97CAB24A50}` at 2.5s
    from source item `guid:{EEB0E942-456D-FD4F-AF89-C633E1882ECB}`;
    cross-track duplicate
    `guid:{FD377B79-195D-5B45-AD97-A18EA4C89CF3}` at 0s on target
    track `guid:{365AD42A-7CBA-9C4C-8E3A-705EDA1CE883}`.
  - Raw field mismatch changed the wire field to `D_POSITIONX` and
    returned `VERIFY_FAILED`, `recoverable:false`,
    `details.fields[0]={field:"D_POSITIONX", expected:7.7,
    actual:0, ok:false}` plus the Slice 04 recovery phrase. This
    intentionally leaves a real duplicate item at 7.7s on the target
    track, but `LAST_RESULT` stayed on the previous successful item:
    follow-up `item_pitch last_result:item:0 semitones:0` changed
    `guid:{FD377B79-195D-5B45-AD97-A18EA4C89CF3}`.
  - Slice 06/07/08 regressions passed (`item_pitch`, `item_move`,
    `item_trim`, `item_fade`); forced bad `param_path` and structural
    count mismatch stayed typed `VERIFY_FAILED`; `ITEM_NOT_FOUND`,
    `TRACK_NOT_FOUND`, `REGION_NAME_INVALID`, get_state include
    regressions, `render_region` WAV-only artifact carve-out, and
    `track_create` maybeCreates create/reuse stability all passed.
    Render smoke created only
    `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/streetlight_slice09_live_smoke_1782785591409/renders/slice09-r-1782785591409.wav`
    before the temp render dir was removed.
- **Kernel hardening Slice 08 ✅ live-smoked
  / committed and pushed (2026-06-30, `c923df9`).** Scope from
  `docs/plans/SLICE_08_ARCHITECT_PLAN.md`:
  - `FieldCheckDescriptor` now has optional `nullable?: boolean`.
    Registry and manifest alignment require it to be boolean when
    present and allow an all-optional `fields[]` list only when every
    field is also `nullable:true`.
  - `item_fade` now declares two field checks: item `D_FADEINLEN` from
    `params.fade_in`, and item `D_FADEOUTLEN` from `params.fade_out`.
    Both are `optional:true` and `nullable:true`.
  - `call_template` passes `nullable` through the wire descriptor while
    keeping the locked success envelope unchanged.
  - `verify.lua` still skips fields when `optional:true` and the param
    is absent. New Slice 08 behavior: when a param is explicit
    `ctx.json.null` and the descriptor has `nullable:true`, field verify
    coerces expected value to `0` before the normal readback compare.
    Explicit `json.null` without `nullable:true` becomes a field
    mismatch. `verify.check_fields()` now receives bridge handler `ctx`
    from `streetlight_bridge.lua` so it compares against the same
    `ctx.json.null` sentinel as the handler; it does not dofile/require a
    second JSON module.
  - Decisions locked by user: D1=a only `item_fade`; D2=a hardcode
    nullable null-coerce to `0`; D3=a name is `nullable` everywhere;
    D4=a all-optional fields are legal iff all-nullable; D5=a fade field
    tolerance `1e-6`.
  - Live smoke passed after full REAPER quit/reopen and current
    `start_bridge.lua` run. Console evidence: `bridge starting
    (generation 1)`, `loaded error_codes (22 codes)`, and `bridge
    ready (generation 1) — loaded error_codes (22 codes)`. `ping`
    returned `connected` on REAPER `7.71/macOS-arm64`.
  - `list_templates` showed `item_fade.expectedDelta.fields[2]`:
    item `D_FADEINLEN` from `fade_in` and item `D_FADEOUTLEN` from
    `fade_out`, both `optional:true` / `nullable:true`. `item_trim`
    stayed Slice 07-shaped: `D_STARTOFFS optional:true` and no
    `nullable`.
  - Happy nullable paths passed: `fade_in:0.25` verified fade-in and
    skipped absent fade-out; `fade_in:0.1 fade_out:0.5` verified both;
    `fade_in:null` verified `D_FADEINLEN` as `0` and skipped
    fade-out; `fade_in:null fade_out:null` verified both as `0`.
  - Regression/error paths passed: Slice 07 `item_trim` length-only;
    Slice 06 `item_pitch` and `item_move`; raw bad field returned
    `VERIFY_FAILED`, `recoverable:false`, with `details.fields[]` and
    did not pollute `LAST_RESULT`; raw `json.null` without
    `nullable:true` returned `VERIFY_FAILED`; raw all-optional absent
    fade params succeeded; raw structural mismatch still won before
    field verify and omitted `details.fields`; `item_fade selected:99`
    returned `ITEM_NOT_FOUND`; `region_create name:"bad/name"`
    returned `REGION_NAME_INVALID`; get_state include regressions and
    `render_region` artifact carve-out passed.
  - Evidence: queue
    `/Users/Zhuanz/Library/Application Support/Streetlight/queue`;
    smoke track `guid:{44E9538D-5AD6-9F45-8F0F-058785455975}`;
    items `guid:{336D3720-C74E-B44E-BC94-5D907602A734}` and
    `guid:{CA7165CD-B62E-E442-890E-44474DBB3D45}`; render artifact
    `/tmp/streetlight_slice08_live_smoke/renders/slice08_render_1782758242169.wav`
    verified as 24-bit PCM stereo 48 kHz with no `.RPP` /
    `.RPP-bak` sidecars. Full machine-readable evidence is at
    `/tmp/streetlight_slice08_live_smoke/evidence.json`.
- **Kernel hardening Slice 07 ✅ live-smoked
  / committed and pushed (2026-06-30, `9244be3`).** Scope from
  `docs/plans/SLICE_07_ARCHITECT_PLAN.md`:
  - `FieldCheckDescriptor` now has optional `optional?: boolean`.
    Registry and manifest alignment require it to be boolean when
    present and reject `fields[]` lists where every field is optional.
  - `item_trim` now declares two field checks: item `D_LENGTH` from
    `params.length`, and take `D_STARTOFFS` from
    `params.start_offset` with `optional:true`.
  - `call_template` passes `optional` through the wire descriptor while
    keeping the locked success envelope unchanged.
  - `verify.lua` skips a field only when `field.optional == true` and
    the corresponding param is absent; otherwise Slice 06 comparison
    behavior is unchanged.
  - Decisions locked by user: D1=a only `item_trim`; D2=a optional
    absent means skip/ok; D3=a name is `optional` everywhere; D4=a
    `D_STARTOFFS` tolerance `1e-6`; D5=a all-optional fields are
    statically rejected.
  - Live smoke required a full REAPER quit/reopen because `verify.lua`
    `check_fields` changed. Real bridge queue smoke passed on
    REAPER 7.71/macOS-arm64: `ping` connected; `list_templates`
    returned 11 templates and showed `item_trim` with two field checks
    (`D_STARTOFFS optional:true`); `item_trim` length-only succeeded
    with `D_LENGTH` verified and absent `start_offset` skipped;
    `item_trim` length + `start_offset` verified both item and take
    scopes.
  - Regression checks passed: Slice 06 `item_pitch` / `item_move`
    happy paths; forced field mismatch returned `VERIFY_FAILED`,
    `recoverable:false`, with `details.fields[]`; `LAST_RESULT` was
    not polluted after verify failure; raw optional-skip succeeded;
    structural mismatch still won before field verify and omitted
    `details.fields`; `ITEM_NOT_FOUND` and `REGION_NAME_INVALID`
    stayed typed; get_state regressions and `render_region` artifact
    carve-out passed. The render smoke created a WAV and cleaned its
    temp render dir.
  - First harness pass reported 12/13 only because its S2 follow-up
    tried to inspect the item through `get_state(selection)` while the
    imported item was not selected. The actual `item_trim` command had
    already returned success; rerunning S2 with the envelope /
    `check_fields` assertion passed.
  - Smoke left live REAPER project objects: a `Slice07 Live Smoke ...`
    track/item and a `slice07_live_...` region remain in the currently
    modified project for manual undo/delete. They are not repository
    state.
- **Kernel hardening Slice 06 ✅ live-smoked
  (2026-06-30).** Scope from
  `docs/plans/SLICE_06_ARCHITECT_PLAN.md`:
  - `ExpectedDelta` now has optional `fields[]` metadata with
    `{scope, field, paramPath, tolerance?}`. Registry and manifest
    alignment reject malformed fields, duplicate `(scope,field)`,
    negative tolerance, dotted param paths, and fields on create/delete
    style templates.
  - Four templates declare field checks: `item_pitch` reads back
    take `D_PITCH` from `params.semitones`; `item_move` reads item
    `D_POSITION` from `params.position`; `item_rate` reads take
    `D_PLAYRATE` from `params.rate`; `track_rename` reads track
    `P_NAME` from `params.name`.
  - `call_template` still exposes the locked success envelope. On the
    wire, field descriptors ride inside `expected_delta.fields[]` with
    `param_path` snake-case. `list_templates` shows the TS metadata as
    `paramPath`.
  - `reaper/packs/core/verify.lua` now exposes `check_fields()`. The
    bridge calls structural `verify.check()` first, then
    `verify.check_fields()`, then `finalize_template()`. Field failure
    returns typed `VERIFY_FAILED`, `recoverable:false`, appends
    `details.fields[]`, preserves the `call get_state` recovery phrase,
    and does not update `LAST_RESULT`.
  - Decisions locked by user: D1=a four-template subset; D2=a
    tolerance `1e-6`; D3=a fields nested inside `expected_delta`; D4=a
    field failure does not update `LAST_RESULT`; D5=a fields cannot
    coexist with creates/maybeCreates/deletes in Slice 06. Slice 09
    later relaxes only the `creates:true` + numeric-count case.
  - Live smoke passed on REAPER 7.71/macOS-arm64 after a full
    quit/reopen and current `start_bridge.lua` run. Console showed
    `bridge starting (generation 1)`, `loaded error_codes (22 codes)`,
    and `bridge ready (generation 1) — loaded error_codes (22 codes)`.
    `ping` returned connected. `list_templates` returned 11 templates:
    `item_pitch`, `item_move`, `item_rate`, and `track_rename` had
    `expectedDelta.fields[]`; the other templates had no `fields`, and
    `render_region` still had no `expectedDelta`.
  - Happy field-verified paths used track
    `guid:{70F9F13F-6930-6848-BAAA-C4CEEEAA3B8B}` and item
    `guid:{D6A8F3D7-6F6E-E74D-8B6B-33BD86BE1B80}`:
    `item_pitch semitones:-3`, `item_move position:5.0`,
    `item_rate rate:0.5`, and `track_rename` all returned the locked
    success envelope. Extra zero-tolerance raw probes for `D_PITCH=-3`,
    `D_POSITION=5.0`, and `D_PLAYRATE=0.5` passed, so no tolerance
    fallback was needed. The renamed track was visible in TCP / Track
    Manager as `smoke06-1782752152900-lastresult-after-fieldfail`.
  - Raw field mismatch `track_rename` with
    `expected_delta.fields[0].field="P_NAMEX"` returned
    `VERIFY_FAILED`, `recoverable:false`, kept the `call get_state`
    recovery phrase, and appended
    `details.fields[0]={scope:"track", field:"P_NAMEX",
    expected:"smoke06-1782752152900-badfield", actual:0, ok:false}`.
    A following `track_rename last_result:track:0` hit the same track
    GUID, proving field failure did not update `LAST_RESULT`.
  - Raw structural mismatch `item_pitch` with
    `expected_delta={count:1,creates:true,fields:[...]}` returned
    structural `VERIFY_FAILED` first; top-level `error.details.fields`
    was absent. Regression checks also passed: `item_fade`,
    `item_trim`, and `region_create` happy paths were unaffected
    (`region:smoke06-r-1782752152900`); `item_pitch selected:99`
    returned `ITEM_NOT_FOUND`; `region_create name:"a/b"` returned
    `REGION_NAME_INVALID`; `get_state(tracks, include:["fx"])`
    returned tracks with `fx:[]`; `get_state(render, include:["fx"])`
    returned `PARAMS_INVALID`; and bare `get_state(render)` returned
    `SCOPE_NOT_IMPLEMENTED`.
  - Smoke objects remain in the open REAPER project for manual
    undo/delete. Two setup-only smoke tracks from an early smoke-script
    selection assumption also remain; they do not affect the Slice 06
    result.
- **Kernel hardening Slice 05 ✅ live-smoked / committed and pushed
  (2026-06-30, `5ba6318`).** Scope from
  `docs/plans/SLICE_05_ARCHITECT_PLAN.md`:
  - `reaper/streetlight_bridge.lua` now dofile's
    `reaper/packs/core/error_codes.lua` at boot, validates key/value
    identity and the expected 22-code count, calls
    `refs.attach_errs(ERRS)`, injects `ctx.errs = ERRS` into every
    template handler, and logs `loaded error_codes (22 codes)` in the
    ready line for live-smoke reachability.
  - `reaper/packs/core/refs.lua` keeps the public
    `resolve_item`/`resolve_track`/`resolve_region`/`resolve` API but
    now returns generated `ERRS.*` constants instead of handwritten
    strings.
  - `reaper/packs/core/templates/{item,track,region,media,render}.lua`
    now raise `ctx.errs.*` / resolver-returned codes. Messages,
    recoverability, envelope shapes, and normal behavior are intended
    to be byte-stable.
  - `scripts/error-codes.mjs check` is stricter: it still verifies
    generated freshness and unknown codes, and now also rejects known
    Lua error-code string literals in runtime shapes
    (`code = "FOO"`, `raise("FOO")`, `raise(code or "FOO")`,
    `return nil, "FOO"`, with single-quoted forms included). It also
    validates generated-code member references (`ERRS.*`, `errs.*`,
    `ctx.errs.*`) so typos like `errs.PARAMS_INVALD` fail statically.
    The scan includes
    `reaper/streetlight_bridge.lua` plus `reaper/packs/core/**/*.lua`
    except generated `error_codes.lua`.
  - Reviewer pass caught two audit holes after the initial code drop:
    single-quoted Lua literals and misspelled generated-code member
    references. Both are now covered by tests and `check:error-codes-fresh`.
  - Decisions locked: D1 audit strictness = no runtime literal
    allowances beyond generated `error_codes.lua`; D2 one bridge
    dofile + `ctx.errs`, refs via `attach_errs`; D3 keep existing
    local `raise(code, message)` helpers, no new global raise helper.
  - Live smoke passed on REAPER 7.71/macOS-arm64 after a full REAPER
    quit/reopen and current `start_bridge.lua` run. Console showed
    both `[streetlight] loaded error_codes (22 codes)` and
    `bridge ready (generation 1) — loaded error_codes (22 codes)`.
    Focused paths returned the expected typed codes with no
    `INTERNAL_ERROR` degradation: `ITEM_NOT_FOUND` for
    `item_pitch selected:99`, `MEDIA_NOT_FOUND` for a bad import
    path, `REGION_NAME_INVALID` for `region_create name:"a/b"`,
    `REF_INVALID` for `track_rename selected:0`,
    `REGION_NOT_FOUND` for `render_region region:doesnotexist`, and
    raw-queue `VERIFY_FAILED` for a forced `track_rename`
    `expected_delta={count:1,creates:true}` mismatch. The mismatch
    returned `recoverable:false`, details
    `{actual:{items:0,regions:0,tracks:0}, changed_count:1,
    expected:{count:1,creates:true}}`, and the required
    `call get_state` recovery phrase. Happy `track_create` produced
    `guid:{AF0C65BE-0D4A-3B4D-BFE8-4A2A6622F0CD}`, and subsequent
    `track_rename last_result:track:0` before and after
    `VERIFY_FAILED` hit the same GUID, confirming normal envelope and
    `LAST_RESULT` behavior. Temporary render smoke dir was removed;
    the smoke track remains in the open REAPER project for manual
    undo/delete.
- **Kernel hardening Slice 04 ✅ live-smoked / committed and pushed
  (2026-06-29).** Scope from
  `docs/plans/SLICE_04_ARCHITECT_PLAN.md`:
  - `packages/core/src/registry.ts` now owns `ExpectedDelta` v1:
    `{ count: number | "any"; creates?; maybeCreates?; deletes? }`.
    Registry validation rejects incompatible mode combinations and
    `maybeCreates:true` with `count:"any"`.
  - Ten undoable mutating core templates now declare `expectedDelta`;
    `render_region` deliberately omits it. `track_create` uses
    `{ count: 1, maybeCreates: true }` so `reuse_existing:true`
    remains a valid no-create success path.
  - `callTemplate` passes descriptor metadata over the queue as
    `expected_delta`; `FileQueueClient` and `QueueCommand` know the
    field; tests assert the on-wire payload for every core template.
  - New `reaper/packs/core/verify.lua` snapshots
    item/track/region counts, diffs them, and checks count movement.
    `streetlight_bridge.lua` snapshots before synchronous template
    execution and checks after handler success, before
    `finalize_template` writes `LAST_RESULT`.
  - On mismatch the bridge returns typed `VERIFY_FAILED` with
    `recoverable:false`, structured `error.details`
    `{expected, actual, changed_count}`, and the required recovery
    phrase: "The mutation has been applied — call get_state to inspect
    actual state." No rollback is attempted.
  - `scripts/manifest-alignment.mjs` now also enforces the descriptor
    contract: every mutating undoable template must have
    `expectedDelta`, non-undoable templates must not, and delta modes
    must be coherent.
  - Runtime behavior is intended to be unchanged on all normal green
    paths. This slice adds guardrails for impossible deltas; it does
    not add field-level verification and does not verify deferred
    `render_region`.
  - Live smoke passed on REAPER 7.71/macOS-arm64 after the user fully
    restarted REAPER and loaded the current `start_bridge.lua`.
    Evidence: `ping` connected; `list_templates` returned 11
    templates with `track_create.expectedDelta={count:1,maybeCreates:true}`
    and no `expectedDelta` on `render_region`; `track_create`
    create+reuse both returned the same GUID
    `guid:{732FDB51-4926-3641-9BCD-B414EDC7CBBC}` with no duplicate
    track; `get_state(tracks)` between create/reuse and
    `track_rename last_result:track:0` did not pollute `LAST_RESULT`;
    `media_import` inserted
    `guid:{E2B0A51D-B0DB-A84A-9658-0C396A8C45AD}`; `item_pitch`
    in-place passed; `region_create` produced
    `region:smoke04-r1-1782743061140`; `render_region` wrote only
    `/var/folders/.../streetlight-slice04-render-1782743061140/smoke04-r1-1782743061140.wav`
    and no sidecars; a raw-queue forced mismatch
    `expected_delta={count:1,creates:true}` on `item_pitch` returned
    `VERIFY_FAILED`, `recoverable:false`, details
    `{actual:{items:0,regions:0,tracks:0}, changed_count:1,
    expected:{count:1,creates:true}}`, and the required `get_state`
    recovery phrase. A subsequent `track_rename last_result:track:0`
    still hit the same track GUID, proving `VERIFY_FAILED` did not
    update `LAST_RESULT`. Temporary render files/scripts were removed;
    the smoke objects remain in the open REAPER project for manual
    undo/delete.
- **Kernel hardening Slice 03 ✅ live-smoked / committed + pushed
  (2026-06-29).** Scope from
  `docs/plans/SLICE_03_ARCHITECT_PLAN.md`:
  - `packages/core/src/registry.ts` now requires every
    `CapabilityDefinition` to declare `entity_kind`, symbolic
    `undo_flags`, and at least one `examples[]` entry. Optional H2/H6
    placeholders (`expectedDelta`, `reads`, `writes`) exist but are
    omitted from metadata when absent and are not consumed by runtime
    code.
  - All 11 TS template descriptors now carry the new required
    metadata. `render_region` is the undoable=false edge case:
    `undo_flags: []`.
  - `list_templates` automatically returns the enriched metadata via
    registry metadata; tests lock `entity_kind`, `undo_flags`,
    `examples`, optional-placeholder omission, and the
    undoable/undo_flags invariant across all core templates.
  - New `scripts/manifest-alignment.mjs` parses the existing Lua
    `manifest.lua` (single-line `undo_flags` convention) and compares
    TS registry descriptors to Lua for `entity_kind`, `undoable`, and
    `undo_flags`. It has both a standalone CLI (`npm run
    check:manifest`) and vitest coverage.
  - New `scripts/error-codes.mjs` generates
    `reaper/packs/core/error_codes.lua` from
    `packages/core/src/errors.ts` and audits Lua error-code literals.
    The audit catches `code = "FOO"`, direct `raise("FOO", ...)`,
    fallback forms such as `raise(code or "FOO", ...)`, and resolver
    returns such as `return nil, "FOO", ...`.
  - Runtime behavior was intentionally unchanged in Slice 03: no
    bridge changes, no Lua handler changes, no `manifest.lua` changes,
    no new tools, and `error_codes.lua` was not dofile'd yet. Slice 05
    is the follow-up that activates `ERRS.*` at runtime.
  - Focused reviewer pass complete: no findings. Residual risk is the
    expected one for static regex-based checks (future Lua shape
    changes may require parser updates).
  - M0 is complete: tests/build/manifest/error-code/diff checks are
    green.
  - M1-M3 live/minimal activity smoke passed on REAPER
    7.71/macOS-arm64: `ping` returned connected; `list_templates`
    returned 11 templates and every entry had `entity_kind`,
    `undo_flags`, and `examples` (`render_region`:
    `undoable=false`, `undo_flags=[]`, `entity_kind="render"`); old
    template call `track_create name:"smoke03-meta-1782736628621"`
    returned the locked envelope with
    `changed_ids=["guid:{58A3970C-603B-9F43-BC07-7246176D70FD}"]`.
    That smoke track is left in the open REAPER project for the user
    to undo/delete.
- **Kernel hardening Slice 02 ✅ (committed + pushed at `e93d39e`).**
  See `docs/plans/SLICE_02_ARCHITECT_PLAN.md` for the packet and
  `docs/PROGRESS.md` for full S0-S10 live-smoke evidence.
- **Kernel hardening Slice 02 ✅ (2026-06-29; reviewer pass + live
  smoke complete).** Scope from
  `docs/plans/SLICE_02_ARCHITECT_PLAN.md`:
  - TS/MCP: `get_state` now accepts optional `include`, strictly
    `z.array(z.enum(["fx"]))`; non-empty include is valid only with
    `scope:"tracks"` and returns `PARAMS_INVALID` before any queue
    write otherwise. The MCP tool schema in `packages/mcp-server/src/index.ts`
    exposes and forwards the field.
  - Lua bridge: `DISPATCH.get_state` has the same include validation
    for direct-queue callers. `get_state(render, include:["fx"])`
    returns `PARAMS_INVALID`, not `SCOPE_NOT_IMPLEMENTED`; bare
    `get_state(render)` remains `SCOPE_NOT_IMPLEMENTED`.
  - Track descriptors still omit `fx` by default. With
    `include:["fx"]`, each track gets `fx: []` or an array of
    `{index,name,ident,enabled,preset_name}`. `ident` uses
    `TrackFX_GetNamedConfigParm(track, fx, "fx_ident")`; there is no
    `TrackFX_GetFXIdent`.
  - Response budget remains item-boundary: the whole track descriptor,
    including its FX chain, is encoded before the fit decision. No
    truncating inside an FX array.
  - Docs synced: `docs/RESPONSE_BUDGET.md`,
    `docs/ROADMAP.md`, `docs/PROGRESS.md`, and this handoff; the
    architect packet is parked at
    `docs/plans/SLICE_02_ARCHITECT_PLAN.md`.
  - Focused reviewer found one P2: direct-queue `include:{}` was
    accepted as an empty array. Fixed by requiring the JSON decoder's
    `__streetlight_array` marker in Lua `is_array_like()` while still
    rejecting spoofed extra keys.
  - Live smoke proof (REAPER 7.71/macOS-arm64): first attempt hit the
    expected dirty-bridge-owner issue (stale pre-Slice-02 bridge loop
    claimed queue files and ignored `include`). After a full REAPER
    quit/reopen and loading the current `start_bridge.lua`, S0-S9 all
    passed: `ping`, `project`, default `tracks` with no `fx` field,
    ReaEQ FX projection (`index=0`, name `VST: ReaEQ (Cockos)`,
    non-empty `ident`, `enabled=true`, `preset_name=""`), include
    whitelist rejection (`["fx","midi"]`), P2 regression probe
    `include:{}` → `PARAMS_INVALID` / "get_state include must be an
    array", regions+include rejection, render+include
    `PARAMS_INVALID` before `SCOPE_NOT_IMPLEMENTED`, I7 read-FX then
    `track_rename last_result:track:0`, bare `get_state(render)` →
    `SCOPE_NOT_IMPLEMENTED`, and preset readback
    `preset_name="stock - Basic 11 band"`.
  - S10 FX-heavy baseline: 80 ReaEQs on one track returned
    `total=1`, `returned=1`, `truncated=false`,
    `response_bytes=12650`, `fx_count=80`; 650 ReaEQs on the first
    track with `limit=1` returned `RESPONSE_TOO_LARGE` with message
    "Single track descriptor exceeds the 65536 byte response cap".
    Temporary tracks, scratch queue files, and `/tmp/streetlight_slice02*`
    were cleaned up.
- **Kernel hardening Slice 01 ✅ (2026-06-29, focused re-review +
  live smoke passed; committed + pushed at `baa13bd`).** Scope from
  `docs/plans/SLICE_01_ARCHITECT_PLAN.md`:
  - H1: `reaper/packs/core/manifest.lua` now exposes
    `entity_buckets`; `reaper/packs/core/lib/entity_buckets.lua`
    owns pure bucket helpers; `reaper/streetlight_bridge.lua` derives
    `ENTITY_BUCKET` / `LAST_RESULT` from it, validates template
    `entity_kind` at startup with `STREETLIGHT_STRICT_MANIFEST`
    default ON, and keeps runtime loud-log fallback to `items`.
    `reaper/packs/core/refs.lua` adds `M.RESOLVERS` +
    `M.resolve(kind, ref, last_result)` while preserving existing
    named resolvers.
  - H3 readonly: `get_state(project)` returns `{bpm,time_sig_num,
    time_sig_den,sample_rate,length_seconds}`; `get_state(tracks)`
    returns bounded track descriptors (`id`, `index`, `name`, `depth`,
    `volume`, `pan`, `mute`, `solo`, `recarm`); `get_state(regions)`
    returns bounded `{name,start,end}` descriptors. `selection` is
    unchanged; `render` remains `SCOPE_NOT_IMPLEMENTED`.
  - Deferred by design: `include`, `fields`, and `cursor` are not in
    the schema; FX is not read; no write/template behavior changes.
  - `docs/RESPONSE_BUDGET.md` now documents the new locked shapes for
    project/tracks/regions and keeps `render` / FX / pagination /
    projection deferred.
  - Live smoke proof (2026-06-29, REAPER 7.71/macOS-arm64): after a
    full REAPER quit/reopen and launcher run, `ping` returned
    connected. In a fresh project, `track_create` made smoke track
    `guid:{6EADD366-14F6-1641-AFD1-F0DA7CB84CEB}`;
    `media_import` inserted `/System/Library/Sounds/Ping.aiff` and
    produced `LAST_RESULT.items` with
    `guid:{0CA035D8-2829-724D-B6F7-0F1190C4C0D9}`. Then
    `get_state(project)`, `get_state(tracks)`, and
    `get_state(regions)` all returned ok; `item_fade` via
    `last_result:item:0` returned the same imported item GUID,
    proving readonly scopes did not touch `LAST_RESULT`;
    `get_state(render)` returned `SCOPE_NOT_IMPLEMENTED`.
- **Steps 4, 5, 6, 7 fully ✅** — see prior PROGRESS for details.
  Bridge is single-owner after `dofile` reload (generation guard
  from Step 6 mid-smoke fix #2 + Step 7 B4 startup
  stale-`RUNNING/` cleanup writing typed INTERNAL_ERROR done
  envelopes for orphans).
- **Step 7 ✅ verified live (2026-06-29).** 8-item end-to-end demo
  ran clean on REAPER 7.71/macOS-arm64 into
  `~/Desktop/streetlight-step7-resmoke-1782704645367`: 8 WAVs
  (24-bit PCM stereo 48 kHz), zero `.wav.RPP` / `.wav.RPP-bak`
  sidecars, `changed_ids` WAV-only. Focused preflight side-quest
  confirmed: a hand-touched `<wav>.RPP` triggers typed
  `OUTPUT_FILE_EXISTS` with the colliding path in the message and
  the user file untouched.
- **Step 8 Round A ✅ (2026-06-29 same window, no live REAPER needed).**
  Three v0.1 release-blockers from the six open notes closed in 4
  files:
  - `packages/mcp-server/src/tools/call-template.ts` — `RiskPolicy`
    becomes 5th defaulted param; `RISK_BLOCKED` gate inserted between
    `registry.get` and `params.safeParse` (order verified by test
    passing junk params + asserting `RISK_BLOCKED`, not
    `PARAMS_INVALID`). `defaultPolicy()` only in v0.1; env-var
    override deferred to v0.2 (locked decision #10).
  - `packages/mcp-server/src/transport/file-queue.ts` — (a)
    `pollForResult` wraps `readIfExists` so non-ENOENT errors surface
    as `INTERNAL_ERROR (recoverable: false)` instead of rejecting out
    of `client.send` (honors class JSDoc); (b) `init()` awaits a new
    `sweepDoneOrphans()` that unlinks `done/<id>.json` older than 24h
    mtime, best-effort, three-layer try/catch (readdir/stat/unlink),
    only touches `done/`, leaves subdirs and non-files alone, never
    rejects init.
  - Tests: +2 in `tools/__tests__/call-template.test.ts` (risk gate
    blocks under default policy, explicit policy lets it through);
    +1 in `transport/__tests__/file-queue.test.ts` (non-ENOENT wrap
    test rmdir+writeFile-replaces `done/` so readFile throws ENOTDIR);
    +4 in a new `FileQueueClient done/ orphan sweep` describe
    (fresh kept / old removed / subdirs untouched / unreadable done/
    still resolves init / custom threshold honored).
- **Step 8 Round B deferred to v0.2.** Linux queue-dir resolver fix
  (Lua falls through to macOS path) explicitly NOT done this cycle —
  no live Linux REAPER rig to verify. INSTALL.md env-var workaround
  remains the supported v0.1 Linux path.
- **Kernel hardening master plans are now parked in `docs/plans/`.**
  Start with `docs/plans/KERNEL_HARDENING_PLAN.md` for the contract
  and `docs/plans/KERNEL_HARDENING_EXECUTION.md` for execution notes.
  They define the H1–H7 hardening sequence and should be treated as
  Architect input, not as already-approved implementation.
- **Step 8 Round C ✅ (2026-06-29 same window, docs-only).** Three
  Round-C items closed:
  - **README sidecar wording** fixed at `README.md:85-96` — the stale
    "v0.1 cannot suppress … on every build" hedge replaced with the
    live "guarded cleanup contract" framing (preflight
    no-clobber for `.wav` / `.wav.RPP` / `.wav.RPP-bak` →
    `OUTPUT_FILE_EXISTS`, post-render `os.remove` of any auto-written
    sidecar). PROGRESS.md pointer for the config-var post-mortem.
  - **Foreground-render docs audit** — verdict: existing coverage
    (README prereq #2 + INSTALL §"Render in background" + B2 rationale
    + troubleshooting cross-ref) is complete on the current contract.
    Closed the only forward-look gap with two one-liners: a v0.2
    pointer at the end of INSTALL.md's "Render in background" section
    and a matching ROADMAP.md v0.2 entry ("foreground-render support
    via chunked-tick render loop"). NO detection code per the
    explicit B2 docs-only decision.
  - **Vitest/Vite/esbuild upgrade evaluation** — verdict: **defer
    until post-v0.1**. `npm audit` reports 5 dev-only vulns (3 mod, 1
    high, 1 crit) chained from `vitest@^2.1.0` → `vite` / `esbuild` /
    `@vitest/mocker` / `vite-node`. **Effective exposure: zero** — the
    critical (vitest UI server arbitrary file read+exec) only fires
    under `vitest --ui` (repo uses `vitest run`); the high
    (vite `server.fs.deny` bypass) requires Windows dev-server (repo
    is macOS, test-mode only); moderates all require dev-server /
    `esbuild --serve` / Windows. `npm audit --omit=dev` clean — what
    ships to users is unaffected. Fix path is a two-major jump
    (`vitest@2 → 4.1.9`, skips 3) via `npm audit fix --force`; needs a
    dedicated window for migration, not bolted onto release polish.
    Re-run when we adopt vitest UI or anything else expands the
    real-world surface.
- **Release-prep setup/launcher ✅ (2026-06-29 same window, manual gate
  passed live on this Mac).** Goal: another Mac (or this one after a
  fresh clone) should reach `bridge ready` without hand-writing a single
  absolute path.
  - **`scripts/setup.mjs`** (new, plain Node ESM — no TS build step).
    Pure exports: `buildLauncherLua`, `buildClaudeCodeConfig`,
    `buildCodexConfig`, `buildCursorConfig`, `parseRenderInBackground`,
    `defaultReaperResourcePath`, `launcherInstallPath`, `reaperIniPath`,
    `mcpServerEntryPath`. CLI wraps them with file I/O + `darwin`-only
    fail-fast, `dist/index.js` existence check, `--no-overwrite` and
    `--reaper-resource-path <p>` flags, read-only `reaper.ini` probe.
    Writes only to (a) the REAPER launcher path and (b) `setup-out/`
    in the repo — NEVER user-global MCP configs.
  - **REAPER launcher** at
    `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`.
    Tiny wrapper: AUTO-GENERATED header documenting the one-time
    `Actions → Show action list → ReaScript: Load...` registration
    (REAPER does NOT auto-discover scripts dropped into Scripts/);
    repo-absolute path baked in; guarded `io.open` so a missing/moved
    repo prints a friendly error instead of stack-tracing.
  - **MCP client config artifacts** at `setup-out/`:
    `claude-code.json` / `codex-config.toml` / `cursor.json`. Each has
    the absolute dist path baked in. User copies into their own MCP
    client config — setup never merges into user-global files (merge
    risk on Codex/Claude Desktop/Cursor configs with other servers is
    not worth the saved copy-paste).
  - **`reaper.ini` probe.** Read-only; parses the `[reaper]` section's
    `workrender` key; any non-zero → ON (bitfield-tolerant — this
    Mac's value is `8209`, a bitfield, would have falsely read OFF on
    strict `==1`). Returns `unknown` if section/key absent or input
    not a string. NEVER writes to `reaper.ini`. Step 7 B2 docs-only
    decision stays — setup just surfaces the verdict in the next-steps
    block.
  - **Tests:** 27 new in `scripts/__tests__/setup.test.mjs`, all
    pure-function (no writes to `~/Library`). Test bar: 171 → 198.
  - **Wiring:** `vitest.config.ts` `include` adds
    `scripts/**/*.test.mjs`; `package.json` adds `"setup": "node
    scripts/setup.mjs"`. `.gitignore` adds `setup-out/` so each
    clone's personalized configs never get committed.
  - **Docs flipped to setup flow:** `docs/INSTALL.md` — new "Install
    Step 2: Quick Setup" leads, old Layout A/B demoted to
    "2 (advanced). Manual REAPER Bridge install" with note about
    removing any prior `__startup.lua` dofile to avoid double-load
    noise; §3 client config gained `setup-out/` pointer.
    `docs/CROSS_MAC_SMOKE.md` — §3-5 collapsed into setup + Load... +
    Run; renumbered 1-8; baseline 171 → 198. `README.md` — first-time
    install one-liner in How To Run prereqs.
  - **Manual gate (this Mac, 2026-06-29):** `npm run setup` →
    launcher landed, three setup-out artifacts written, Render-in-
    background detected `✓ ON` (matches actual `workrender=8209`).
    REAPER `Actions → Show action list → ReaScript: Load...` →
    `start_bridge.lua` → Run → console printed
    `bridge ready (generation 1) — templates: …` — templates list
    populated, bridge alive. Cross-Mac flow is exercised end-to-end
    on this Mac; second-Mac smoke per `docs/CROSS_MAC_SMOKE.md` is
    the next gate.
- **Beginner installer round (committed at `73864f7`).** Added
  low-risk one-click wrappers:
  `install.command` for macOS, `install.cmd` + `install.ps1` for
  Windows experimental, and `scripts/install.mjs` as the shared Node
  wrapper. It delegates to the existing chain (`npm install` →
  `npm run build` → `npm run setup`) instead of duplicating setup
  logic, then opens the launcher folder and `setup-out/`. It still
  never edits user-global MCP configs, `reaper.ini`, or `reaper-kb.ini`.
  `scripts/setup.mjs` now generates Windows paths experimentally
  (`%APPDATA%\REAPER`, forward-slash Lua repo path) while keeping
  macOS as the verified v0.1 path.
- **Step 7 code shape (final):**
  - `list_templates` + `list_recipes` MCP tools.
    `js-yaml@^4.1.0` in `@streetlight/mcp-server` deps only.
    Recipe envelope schema passthrough-only (A5);
    `STREETLIGHT_RECIPES_DIR` env override (A3 re-read every call,
    no startup cache); bad YAML → `result.warnings[]` (A4).
  - `recipes/impact_variations.yaml` final: `track_create` uses
    `reuse_existing: true`; `for_each` loop sources from the bound
    `selection.selection.items[0].id` (initial-selection GUID,
    drift-proof). Trailing note + README prereq #5 require the
    agent to abort before mutating if `selection.items.length !== 1`.
  - `reaper/packs/core/lib/names.lua` (Step 7 B1) — single source of
    truth for forbidden region-name set (`/ \ NUL $`). Used by
    `region.lua` create-time AND `render.lua` post-`resolve_region`.
  - `reaper/packs/core/templates/render.lua` — 10-key
    snapshot/restore; preflight `check_no_collision` refuses
    pre-existing `<wav>` AND `<wav>.RPP` AND `<wav>.RPP-bak` with
    typed `OUTPUT_FILE_EXISTS`; `recheck` success branch deletes
    auto-generated sidecars via `os.remove` BEFORE `restore_once`,
    `os.remove` failure raises typed `INTERNAL_ERROR` (bridge's
    `tick_deferred` pcalls `recheck`, so the raise lands as a clean
    wire envelope). `changed_ids` is the WAV artifact path only.
    File-stability lifted 2 → 3 ticks (B3).
  - `reaper/streetlight_bridge.lua` — `reap_stale_running()` runs
    before "bridge ready" log (B4); generation guard already in
    place from Step 6.
- **Sidecar-suppression saga (one-paragraph post-mortem; do not
  repeat).** Three mid-smoke iterations targeted REAPER's `.wav.RPP`
  project-copy sidecar before path-B (guarded cleanup) landed.
  Round 1 snapshotted `autosaveonrender` / `autosaveonrender2` ini
  vars and zeroed via a 2-arg `set_config_var_string(name, value)` —
  silently no-op'd (wrong arity). Round 2 used the actual 3-arg
  `set_config_var_string(name, value, persist=0)` with return-value
  check — calls succeeded and reaper.ini stayed clean, but
  sidecars persisted (theory falsified: those vars aren't the
  control point). Round 3 active probe revealed that on stock
  REAPER 7.71/macOS-arm64, `reaper.set_config_var_string` is **nil
  entirely** — the setter doesn't exist on this build. Path-A
  (bit-clear via the same setter) eliminated by API surface, not by
  hypothesis. Path-B (guarded cleanup) is what's now live. The two
  workflow lessons that came out of this — "ReaScript `set_*` calls
  silently no-op on wrong arity" and "probe API presence before
  wiring a setter you've never called on this REAPER build" — are
  pinned in `[[streetlight-workflow]]` memory. Don't repeat.
- README has the "How To Run The Impact-Variations Demo" section
  with the 6-item prerequisite checklist (fresh `output_dir`,
  fresh project, Render-in-background ON, one item selected, MCP
  registered, bridge loaded). "What Should Happen" now explicitly
  spells out the sidecar-cleanup contract (output dir contains
  exactly the 8 WAVs, no `.wav.RPP` / `.wav.RPP-bak`).

## First moves for the new window

1. **Read the user's MOST RECENT message in this new window.**
   Three plausible paths:

   (a) **"Commit Slice 13."** Slice 13 is code-done, static-green,
       reviewer-pass, and REAPER live-smoked locally. Only commit/push
       if the user explicitly asks; versioning remains out-of-band.

   (b) **"Codex/reviewer found a bug in Slice 13 or earlier."** Locked
       iteration loop: confirm the bug from code → name the fix + any
       decision the user owns BEFORE editing → propose 1-2 tight
       regression notes → wait for sign-off → fix → hand back for
       re-test. Never preemptively flip ✅.

   (c) **Pivot to something else.** Abandon these first moves and
       follow the new direction.

2. **Tests + build baseline this window:** Slice 13 static baseline is
   `npm test` 293/293,
   `npm run build` clean, `npm run check:manifest` green,
   `npm run check:error-codes-fresh` green, `git diff --check`
   clean. Slice 13 REAPER smoke is green with run id
   `slice13-1782809548082` on REAPER `7.71/macOS-arm64`; queue cleanup
   after smoke had `pending=0`, `running=0`, and `done=0`. Slice 12
   REAPER smoke is green with run id `slice12-1782804345538` on REAPER
   `7.71/macOS-arm64`. Slice 11
   REAPER smoke is green with run id `slice11-202606300552524`.
   Slice 10 REAPER smoke S0-S17 is green with timestamp
   `20260630032823069`. Slice 09 static
   baseline was `npm test` 272/272, and its REAPER smoke
   `slice09-1782785591409` is green. The
   `npm run typecheck` script prints a
   `TS6310` "may not disable emit" line then exits 0 — pre-existing
   project setup, do not chase. The `[streetlight-mcp] done-sweep:
   readdir failed (EACCES…)` line in test output is the expected
   best-effort warning from the "init() resolves even when sweep
   cannot enumerate done/" case — not a failure.

3. **Git out-of-band.** Do not commit, branch, push, reset. The
   working tree is the user's; multi-window working pile is
   intentional. `style-memory-mcp/` is the
   user's separate repo (`https://github.com/hexingyuofficial/style-memory-mcp.git`)
   nested under this tree; it's in `.gitignore` and stays untouched.

4. **MCP-server reachability quick check.** `call_template
   render_region {}` returns `PARAMS_INVALID` (missing both required
   fields) — cheapest proof the user's MCP client is wired to a
   build that has render_region registered. `TEMPLATE_NOT_FOUND`
   means the client is pointed at a pre-Step-6 dist; rebuild and
   re-register.

5. **Render-in-background must stay ON** for any future render
   smoke (Step 7 B2, docs-only). OFF + a 60 s render → MCP-side
   timeout fires before bridge can return.

## Step 8 — open notes (all six resolved)

These were the carry-forward items inventoried across the Step 6 /
Step 7 windows. None blocked Step 7 ✅. Final disposition after
Round A + Round C: three closed in code (Round A), one closed in
docs (Round C #1), one evaluated and deferred post-v0.1 by
recommendation (Round C #6), one deferred to v0.2 by explicit user
decision (Round B #2).

1. ~~**Foreground render + 55 s deadline edge case.**~~ **Closed
   Round C (docs-only).** v0.1 requires Render-in-background ON per
   B2 docs; INSTALL.md "Render in background" section + README
   prereq #2 + render.lua header note cover the contract. Forward-
   look added: a v0.2 pointer at the end of INSTALL.md's section
   plus a matching ROADMAP.md v0.2 entry ("foreground-render support
   via chunked-tick render loop"). No detection code per the
   explicit B2 decision — would re-tread the `set_config_var_string`-
   is-nil trap from Step 7.
2. **Linux queue-dir mismatch.** Node's `resolveQueueDir` defaults
   to `~/.local/share/streetlight/queue` on Linux, but the Lua bridge
   falls through to macOS's `~/Library/Application Support/Streetlight/queue`
   path. INSTALL.md documents the `STREETLIGHT_QUEUE_DIR` env
   workaround. **Round B deferred to v0.2** — explicit user decision,
   no live Linux REAPER rig to verify a Lua resolver patch. Do not
   re-open without an ask.
3. ~~**Risk policy not enforced in `call-template.ts`.**~~ **Closed
   Round A.** `callTemplate` takes `policy: RiskPolicy = defaultPolicy()`
   as its 5th param; `RISK_BLOCKED` fires between `registry.get` and
   `params.safeParse` (order asserted by test). v0.1 stays on
   `defaultPolicy()`; env-var override is v0.2.
4. ~~**`file-queue.ts` `pollForResult` does not wrap non-ENOENT
   errors.**~~ **Closed Round A.** `readIfExists` call site is in a
   try/catch; non-ENOENT becomes `err(INTERNAL_ERROR, …, { recoverable: false })`
   and the pending file is best-effort cleaned. Class JSDoc contract
   ("errors never reject") now holds.
5. ~~**`done/` orphan accumulation.**~~ **Closed Round A.**
   `FileQueueClient.init()` awaits a best-effort `sweepDoneOrphans()`
   that unlinks `done/<id>.json` older than 24h. Only touches `done/`;
   `pending/` and `running/` untouched. Three-layer try/catch
   (readdir / stat / unlink); failures write `[streetlight-mcp]
   done-sweep: …` warnings to stderr and never reject init.
   `doneOrphanThresholdMs` constructor option is a test-only knob;
   env-var configuration deferred to v0.2.
6. ~~**Vitest 2 / Vite / esbuild dev advisories.**~~ **Evaluated
   Round C; deferred post-v0.1.** `npm audit` flags 5 dev-only vulns
   (3 mod, 1 high, 1 critical) chained from `vitest@^2.1.0` → vite /
   esbuild / vite-node / @vitest/mocker. **Effective real-world
   exposure: zero** — the critical (vitest UI server arbitrary file
   read+exec) only fires under `vitest --ui` (repo uses `vitest
   run`); the high (vite `server.fs.deny` bypass) requires Windows
   dev-server (repo is macOS, test-mode only); moderates all require
   dev-server / `esbuild --serve` / Windows. `npm audit --omit=dev`
   clean — what ships to users is unaffected. Fix path is a two-major
   jump (`vitest@2 → 4.1.9`, skips 3) via `npm audit fix --force`;
   needs a dedicated window for migration, not bolted onto release
   polish. Re-run when we adopt vitest UI or any other surface that
   exposes the vulns. Tracked in the release-candidate "may pull in"
   list under "First moves" (a).

## Step 8 Round A decisions (locked 2026-06-29, carry forward)

10. **Risk-policy plumbing v0.1:** `defaultPolicy()` only. NO env-var
    override (`STREETLIGHT_RISK_ALLOW=...` and similar). Zero
    `destructive`/`unsafe_eval` templates ship in v0.1 so the
    toggle is overhead; configurable policy lands in v0.2 alongside
    the first `destructive` template.
11. **`done/` sweep policy:** startup-only, 24h mtime threshold,
    best-effort. Touches only `done/`. `isFile()` short-circuits
    subdirectories and hand-dropped non-files. Three-layer try/catch.
    Sweep MUST NEVER reject `init()`.
12. **`pollForResult` non-ENOENT recovery shape:** wrapped errors
    surface as `INTERNAL_ERROR` with `recoverable: false`. Same
    "agent calls `get_state` to inspect actual state" recovery
    semantics as `BRIDGE_NOT_RUNNING` mutating-timeout — the wire
    command may or may not have applied between the bridge claiming
    it and the read failing.

## Step 7 decisions (locked, carry forward)

1. **A1 — YAML lib:** `js-yaml` in `@streetlight/mcp-server` deps
   only (not core).
2. **A2 — `list_templates` scope:** ships alongside `list_recipes`.
3. **A3 — Recipe load timing:** re-read every call, NO startup cache.
4. **A4 — `list_recipes` error contract:** bad YAML files skipped +
   stderr warn + structured entry in `result.warnings[]`. `ok:false`
   only on infrastructure failures.
5. **A5 — Recipe Zod schema strictness:** envelope-only
   (`id`, `description`, optional `inputs`/`steps`/`version` +
   `.passthrough()`). Placeholders / template-param shapes NOT
   validated.
6. **B1 — render-time region-name re-validation:** added.
   `lib/names.lua` drives both `region_create` create-time AND
   `render_region` post-resolve. Forbidden set `/ \ NUL $`.
7. **B2 — foreground render + 55 s deadline:** docs-only.
   "Render in background = ON" required per INSTALL.md + README.

## Step 7 decisions (locked, carry forward)

1. **A1 — YAML lib:** `js-yaml` in `@streetlight/mcp-server` deps
   only (not core).
2. **A2 — `list_templates` scope:** ships alongside `list_recipes`.
3. **A3 — Recipe load timing:** re-read every call, NO startup cache.
4. **A4 — `list_recipes` error contract:** bad YAML files skipped +
   stderr warn + structured entry in `result.warnings[]`. `ok:false`
   only on infrastructure failures.
5. **A5 — Recipe Zod schema strictness:** envelope-only
   (`id`, `description`, optional `inputs`/`steps`/`version` +
   `.passthrough()`). Placeholders / template-param shapes NOT
   validated.
6. **B1 — render-time region-name re-validation:** added.
   `lib/names.lua` drives both `region_create` create-time AND
   `render_region` post-resolve. Forbidden set `/ \ NUL $`.
7. **B2 — foreground render + 55 s deadline:** docs-only.
   "Render in background = ON" required per INSTALL.md + README.
   No bridge runtime check.
8. **B3 — file stability window:** 3 consecutive same-size ticks
   (~200 ms @ 10 Hz).
9. **B4 — startup stale-`RUNNING/` cleanup:** writes typed
   `INTERNAL_ERROR` done envelopes, NOT silent deletion.

**Step 7 mid-smoke decision (path-B guarded cleanup):**
v0.1 enforces the WAV-only artifact contract via preflight
no-clobber + post-render `os.remove`. Config-var suppression
(`autosaveonrender*`, `renderclosewhendone`) is OFF the table on
stock REAPER 7.71/macOS-arm64 because `set_config_var_string` is
nil. `render.lua` header note (1) records the full post-mortem.

## Step 6 decisions (still locked)

(unchanged across this round of work — see PROGRESS.md § "Step 6
code drop" + prior HANDOFF versions for full text)

1. Bridge deferred-completion is single-slot, bridge-internal.
2. `changed_ids` carve-out for `render_region` = artifact path.
3. `RENDER_PATTERN` is the literal region name, not `$region`.
4. Two deadlines: MCP 60_000 ms outer / bridge 55 s inner.
5. `output_dir` validation rules (locked + probe-first).
6. Snapshot/restore covers 10 render settings.
7. `undoable = false` for `render_region`.
8. Lua owns name-content rules for `output_dir`.
9. Bridge tick loops are generation-guarded.

## C1 dump procedure (for re-capture if a future smoke surfaces a format problem)

`RENDER_FORMAT_WAV24_HEX = "5A 58 5A 68 64 78 67 41 41 41 3D 3D"`
is verified-on-disk (Step 6 verification). **Do NOT re-prompt for a
hex dump** unless future smoke surfaces a format mismatch. Procedure
for re-capture if it ever does:

1. File → Render… set Format = WAV / 24-bit PCM, then Close (don't
   Render).
2. Actions → ReaScript: Run ReaScript → New, paste:

   ```lua
   local _, fmt = reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "", false)
   local hex = {}
   for i = 1, #fmt do hex[i] = string.format("%02X", string.byte(fmt, i)) end
   reaper.ShowConsoleMsg("RENDER_FORMAT len=" .. #fmt .. " hex:\n")
   reaper.ShowConsoleMsg(table.concat(hex, " ") .. "\n")
   ```

3. Paste the console output back. Update
   `reaper/packs/core/templates/render.lua:RENDER_FORMAT_WAV24_HEX`
   with the hex string (whitespace stripped at decode time).

## Codex-bundled-MCP / direct-client workaround

For Step 4c onward, Codex uses a direct client against
`packages/mcp-server/dist/` because its bundled `mcp__streetlight`
MCP server is a stale Step 4c snapshot. Cheapest reachability check:
`call_template render_region {}` returns `PARAMS_INVALID` (missing
both required fields), NOT `TEMPLATE_NOT_FOUND`. Same queue dir,
same Lua handlers, fresh registry. The queue is the contract; the
MCP-server identity is not.

## Known noise to ignore

- `npm run typecheck` prints a `TS6310` "may not disable emit" line
  then exits **0** because the script is `tsc -b --noEmit || tsc -b`
  and the second invocation succeeds. Pre-existing project setup.
  Do not chase this.

## Locked iteration loop (for any future bug)

The pattern this project has settled into: Claude writes code, user
runs Codex to do a real REAPER smoke + critique, Claude addresses
findings, repeat until green. Don't try to skip the Codex round
just because tests pass — TS tests don't model REAPER. Every real
bug to date surfaced only under Codex review or live REAPER:
4b same-track INTERNAL_ERROR, 4b stale items bucket, 4c
`after_count - 1` mis-pick, 4c Infinity-as-clear-fade, 4c
item_trim length-before-take-check, 5-5 TS-vs-Lua
REGION_NAME_INVALID surface, 6-1 `file_exists`-on-dir false
positive, 6-3 dofile multi-loop / split LAST_RESULT, Step 7
recipe `reuse: true` arity miss, Step 7 first/second sidecar
suppression on the wrong vars, Step 7 third sidecar suppression
on a setter that doesn't exist on this build.

When Codex finds bugs, the right response order is:

1. Confirm the bug from code (don't just trust the description).
2. Name the fix AND any decision the user owns BEFORE editing.
3. Propose 1-2 tightly-scoped regression notes for PROGRESS.md.
4. Wait for sign-off.
5. Fix.
6. Hand back for re-smoke.

The user explicitly does not want you to flip cells ✅
preemptively or to "just fix and move on."

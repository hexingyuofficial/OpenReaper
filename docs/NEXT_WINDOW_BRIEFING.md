# Next Window Briefing — 2026-07-01

Use this as the first read after a context reset. It is the current truth
after Slice 27 static implementation and REAPER live smoke.

## Snapshot

- Repo: `/Users/Zhuanz/Documents/streetlight-reaper-mcp`
- Remote: `https://github.com/hexingyuofficial/OpenReaper.git`
- Branch: `main`; latest pushed checkpoint is Slice 26:
  `b6077a6 first-real-version: slice 26 analysis transients`
- Slice 27 is implemented, static-green, and REAPER live-smoked.
  Source:
  `docs/plans/SLICE_27_ANALYSIS_LOOP_CANDIDATES_ARCHITECT_PLAN.md`.
  It adds explicit opt-in `features:["loop_candidates"]` to
  `item_audio_analyze`. Defaults remain `loudness + peaks + silence`;
  schema/ref stay `openreaper.analysis.item_audio.v1` and
  `artifact:analysis:analysis:<id>`; no `get_state(scope:"analysis")`.
  Loop-only calls may compute transients internally but must not output
  `payload.transients`; combined `features:["transients","loop_candidates"]`
  outputs both. Candidate count cap is `5`; duration bounds
  `0.25s..8.0s`; pair cap `4096`; score is heuristic, not click-risk or
  seamless guarantee. Static gates are green: build clean,
  `npm test` 431/431, error codes fresh at 26, default
  manifest/template-authoring 12 templates, `core,analysis` 13,
  all-pack 18, and `git diff --check` clean. Reviewer found no blocker.
  Live smoke passed on REAPER `7.71/macOS-arm64` with bridge
  `core,analysis`; stamp `s27-live-1782920437671`; evidence:
  `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/s27-live-1782920437671/evidence.json`.
  Loop-only ref
  `artifact:analysis:analysis:art_20260701154039166_004_45c857`
  had `candidate_count:5`, no `payload.transients`, best candidate
  `0.19737→0.847528` with score `0.839377`. Combined
  transient+loop ref
  `artifact:analysis:analysis:art_20260701154041003_007_c166ce`
  emitted both and indices pointed into transient events. All-feature
  ref `artifact:analysis:analysis:art_20260701154042231_009_2b1461`
  passed; default analysis still omits transients and loop candidates;
  LAST_RESULT preservation, source-offline `AUDIO_SOURCE_OFFLINE`, and
  clean queue all passed.
- Slice 26 is implemented, static-green, and REAPER live-smoked.
  Source: `docs/plans/SLICE_26_ANALYSIS_TRANSIENTS_ARCHITECT_PLAN.md`.
  It adds explicit opt-in `features:["transients"]` to
  `item_audio_analyze`. Defaults remain `loudness + peaks + silence`;
  schema/ref stay `openreaper.analysis.item_audio.v1` and
  `artifact:analysis:analysis:<id>`; no `get_state(scope:"analysis")`.
  Constants: `MAX_TRANSIENTS=200`, min gap `0.05s`, rise `10dB`,
  threshold floor `-60dBFS`; actual `threshold_dbfs` is distinct from
  the floor in payload limits. Static gates are green: build clean,
  `npm test` 430/430, error codes fresh at 26, default
  manifest/template-authoring 12 templates, `core,analysis` 13,
  all-pack 18, and `git diff --check` clean. Live smoke passed on
  REAPER `7.71/macOS-arm64` with bridge `core,analysis`; stamp
  `s26-live-1782918106518`; evidence file:
  `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/s26-live-1782918106518/evidence.json`.
  The 5-hit fixture produced transient times
  `0.19737, 0.499229, 0.847528, 1.195828, 1.648617`; main ref
  `artifact:analysis:analysis:art_20260701150148387_004_32fd49`;
  all-feature ref
  `artifact:analysis:analysis:art_20260701150150039_007_902d41`.
  Default analysis still omits transients; all-feature regression,
  LAST_RESULT preservation, source-offline `AUDIO_SOURCE_OFFLINE`, and
  clean queue all passed.
- Slice 19 is committed and pushed. It is static-green and live-smoked
  on REAPER `7.71/macOS-arm64`; H6's basic loop is closed.
- Slice 25 is implemented, static-green, and REAPER live-smoked. Source:
  `docs/plans/SLICE_25_ANALYSIS_CONTRACT_ARCHITECT_PLAN.md`.
  User locked S25-D1..D6: opt-in `analysis` pack; one
  `item_audio_analyze` template; only `loudness + peaks + silence`;
  artifact refs `artifact:analysis:analysis:<id>`; no
  `get_state(scope:"analysis")`; caps 120s / 200 silence segments /
  49152 bytes; RMS dBFS not LUFS; sample peak not true peak. Static
  gates currently green: build clean, `npm test` 428/428, default
  `check:manifest` 12 templates, `core,analysis check:manifest` 13,
  `core,analysis check:template-authoring` 13, and error codes fresh at
  26. Full all-pack static sweep was not rerun in the live-smoke
  window. Live smoke passed on REAPER `7.71/macOS-arm64` with bridge
  `core,analysis`; the ready output showed 26 error codes, core
  `(12 templates)`, analysis `(1 templates)`, and `item_audio_analyze`.
  Initial attempt against `core,cleanup,delivery` returned
  `TEMPLATE_NOT_FOUND`; the required reload is
  `_G.STREETLIGHT_ENABLED_PACKS = "core,analysis"` plus
  `dofile("/Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/streetlight_bridge.lua")`.
  Smoke stamp `s25-live-1782914754219`; queue ended clean. Main refs:
  `artifact:analysis:analysis:art_20260701140556948_005_4b21d8` and
  anchor-check ref
  `artifact:analysis:analysis:art_20260701140559453_009_c1f158`.
  Metrics: `rms_dbfs=-10.792`, `peak_dbfs=-6.021`, silence
  `0.385443s` across 2 bounded segments, summary/payload bytes
  `639` / `1918`, warnings for RMS-not-LUFS and
  sample-peak-not-true-peak. LAST_RESULT anchor
  `guid:{53A9DB6E-F79C-A947-9EB4-30DB6C60F4BB}` survived analysis.
  Empty/no-active-take negative returned `AUDIO_SOURCE_OFFLINE`; direct
  `get_state(scope:"analysis")` returned `PARAMS_INVALID`.
- Slice 24 is live-smoked and static-green. Source:
  `docs/plans/SLICE_24_DELIVERY_CLOSURE_ARCHITECT_PLAN.md`.
  User locked S24-D1..D10: opt-in `delivery` pack; `delivery_plan` and
  `delivery_report`; validation failures write fail report artifacts;
  missing/corrupt/oversized plan artifact reads stay typed call errors;
  WAV header sniff only; cleanup provenance optional/no dereference;
  stale mismatch conservative fail; region-name validation and
  output-dir preflight before plan artifact; no new MCP tool, no
  mastering/loudness/multi-format/upload, no `cleanup_apply_safe`, no
  destructive cleanup, no `render_region` JSON migration, and no
  delivery code in core. Live smoke runbook:
  `docs/smokes/delivery_closure.md`. Bridge used for live smoke:
  `_G.STREETLIGHT_ENABLED_PACKS = "core,cleanup,delivery"`.
  Static gates are green: `npm run build` clean, `npm test` 421/421,
  error codes fresh, manifest checks for default / `core,delivery` /
  `core,cleanup,delivery` /
  `core,cleanup,delivery,pack_contract_fixture`, template-authoring
  checks for the same pack sets, and `git diff --check` clean. REAPER
  live smoke passed on `7.71/macOS-arm64`; stamp
  `s24-live-1782906947707`; queue ended clean. Main plan/report refs:
  `artifact:delivery:plan:art_20260701115550245_006_dcdce6` and
  `artifact:delivery:report:art_20260701115552923_010_a44ee5`.
  Render wrote
  `/tmp/s24-live-1782906947707-render/s24-live-1782906947707-main.wav`
  exactly as planned, size `216736` bytes, `RIFF` / `WAVE` header,
  zero `.RPP` / `.RPP-bak`; report payload was
  `overall_status:"pass"` with all 7 checks passing. LAST_RESULT anchor
  `guid:{7228A0ED-E948-BC4D-9C44-866567FDD18D}` survived both delivery
  artifact calls. Missing-WAV and stale-project negatives wrote fail
  report artifacts
  `artifact:delivery:report:art_20260701115556554_017_510ca6` and
  `artifact:delivery:report:art_20260701115600666_023_4fa866`.
- Slice 23A is static-green and REAPER live-smoked. Source:
  `docs/plans/SLICE_23A_CLEANUP_SAFE_AGENT_STEP_ARCHITECT_PLAN.md`.
  User locked agent-step execution, no `cleanup_apply_safe`,
  `cleanup_safe_v1` allowlist limited to `track_rename`, no report
  artifact, no `PLAN_STALE`, and deterministic/collision-safe duplicate
  track rename generation. Current code extends only `cleanup_plan`
  payload safe actions: duplicate-track-name suggestions can carry
  executable bounded `track_rename` steps with `expected_before`; the
  first duplicate by index keeps the original name; later duplicates get
  increasing suffix names; collisions with existing/generated names are
  skipped; collision-limit cases become `review_only`. Agent freshness is
  rerun-plan fingerprint comparison plus per-step current-track
  `expected_before` verification. No apply template, destructive cleanup,
  deletion, routing/FX repair, delivery, audio analysis, MIDI, new MCP
  tool, report artifact, or core parking. Static gates are green:
  focused `npm test -- scripts/__tests__/lua-structure.test.mjs` 18/18,
  full `npm test` 412/412, `npm run build` clean,
  `npm run check:error-codes-fresh` 24 codes fresh, default
  `check:manifest` 12 templates across 1 pack, cleanup-enabled
  `check:manifest` 13 templates across 2 packs, cleanup+fixture
  `check:manifest` 15 templates across 3 packs, default
  `check:template-authoring` 12 templates, cleanup-enabled
  `check:template-authoring` 13 templates, cleanup+fixture
  `check:template-authoring` 15 templates, and `git diff --check`
  clean. REAPER live smoke passed on `7.71/macOS-arm64` with bridge
  `core,cleanup`; smoke stamp `s23-1782901902009`. Artifact refs included
  `artifact:cleanup:plan:art_20260701103149486_014_a52fde` and
  `artifact:cleanup:plan:art_20260701103201659_035_c2eb62`. Initial
  fingerprint:
  `tracks=7;regions=3;project=33.500000;hash=1e63536f`. Collision-safe
  generated names were `S23 Duplicate s23-1782901902009 3` and
  `S23 Duplicate s23-1782901902009 4`; both agent-step `track_rename`
  calls succeeded after fingerprint and `expected_before` checks.
  Post-apply plan no longer contained the original duplicate suggestion.
  Stale guard stopped before applying an old step after the target name
  changed; queue ended clean. Smoke tracks/regions remain in the REAPER
  project for manual undo/delete.
- Slice 22 (Phase 2A Cleanup Plan Artifact MVP) is static-green and
  live-smoked. It adds the non-core
  `cleanup` pack and one read-only template, `cleanup_plan`, enabled only
  with `STREETLIGHT_ENABLED_PACKS=core,cleanup`. `cleanup_plan` writes one
  JSON artifact `artifact:cleanup:plan:<id>` with schema
  `openreaper.cleanup_plan.v1`; it reads project/track/region state,
  produces deterministic bounded suggestions, and does not mutate REAPER
  or update item/track/region `LAST_RESULT`. Static gates are green:
  `npm test` 412/412, `npm run build` clean,
  `npm run check:error-codes-fresh` 24 codes fresh, default
  `check:manifest` 12 templates across 1 pack, cleanup-enabled
  `check:manifest` 13 templates across 2 packs, cleanup+fixture
  `check:manifest` 15 templates across 3 packs, default
  `check:template-authoring` 12 templates, cleanup-enabled
  `check:template-authoring` 13 templates, cleanup+fixture
  `check:template-authoring` 15 templates, and `git diff --check`
  clean. Reviewer follow-up is closed: suggestions have bounded target
  previews plus `target_count`, long text is UTF-8-safe truncated, the
  fingerprint is a compact deterministic hash, and the smoke runbook now
  seeds dirty state through MCP calls. Live smoke passed on REAPER
  `7.71/macOS-arm64` with bridge `core,cleanup`; stamp
  `s22-1782897185752`; anchor track GUID
  `guid:{917E8B72-F0DD-9942-B32C-A35FB51F3836}`; artifact refs
  `artifact:cleanup:plan:art_20260701091311863_012_5e8624` and
  `artifact:cleanup:plan:art_20260701091313507_015_e370d8`; normalized
  payloads matched; response bytes were 3187; project/tracks/regions did
  not change after planning; `track_rename last_result:track:0` still hit
  the anchor; queue ended clean.
- Slice 21 (Phase 1 Artifact Contract Foundation) is static-green,
  live-smoked, and commit-ready. Static gates: `npm test` 403/403,
  `npm run build` clean, `npm run check:error-codes-fresh` 24 codes
  fresh, default `check:manifest` 12 templates across 1 pack,
  fixture-enabled `check:manifest` 14 templates across 2 packs, default
  `check:template-authoring` 12 templates, fixture-enabled
  `check:template-authoring` 14 templates, and `git diff --check`
  clean. It adds JSON artifact refs
  `artifact:<owner_pack>:<scope>:<id>`, artifact root
  `<dirname(QUEUE_DIR)>/artifacts/v1`, `get_state(scope:"artifact")`
  summary/payload readback, startup TTL sweep, compact artifact metadata
  in `list_templates`, fixture template `fixture_artifact_probe`, and
  error codes `ARTIFACT_NOT_FOUND` / `ARTIFACT_INVALID`. It does not
  migrate `render_region`, which remains the legacy absolute-WAV-path
  carve-out routed to `LAST_RESULT.renders`. Reviewer follow-up is
  already closed: artifact reads require `payload`, TTL sweep uses file
  mtime, and direct queue validation rejects artifact-only params outside
  `scope:"artifact"`. Live smoke passed on REAPER
  `7.71/macOS-arm64` after fixture-enabled bridge restart. Smoke stamp
  `slice21-1782891483364`; anchor track GUID
  `guid:{C5E18394-48F2-DB4F-89D2-AD9CDFAF8A9D}`; artifact ref
  `artifact:pack_contract_fixture:probe:art_20260701073804406_003_ff08e3`.
  Artifact summary/payload reads, LAST_RESULT preservation, new artifact
  errors, direct-queue param guards, render_region legacy WAV carve-out,
  zero sidecars, and clean queue teardown all passed.
- Slice 20B (Phase 0.5 Pack Contract Foundation) is locally committed
  at `c11b114 first-real-version: slice 20b pack contract foundation`
  and not pushed. It is reviewer-passed, static-green, and live-smoked.
  Static gates: `npm test` 376/376,
  `npm run build` clean,
  `npm run check:error-codes-fresh` 22 codes fresh, default
  `npm run check:manifest` 12 templates across 1 pack,
  `STREETLIGHT_ENABLED_PACKS=core,pack_contract_fixture npm run check:manifest`
  13 templates across 2 packs, default `npm run check:template-authoring`
  12 templates, fixture-enabled `check:template-authoring` 13 templates,
  and `git diff --check` clean. Reviewer follow-up fixed two contract
  issues: non-core packs cannot introduce new entity kinds in Slice 20B,
  and recipe ids must be unambiguous lower_snake_case with duplicate
  `qualified_id`s skipped as warnings. Live smoke passed with fixture
  enabled; stamp `1782881931841`, track GUID
  `guid:{76CC9D4E-3F98-CE4E-B02A-A34C0F03D870}`.
- Post-H6 first-real-version planning now lives in
  `docs/plans/OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md`. Treat it
  as the authoritative guide for Slice 20+ scope, gates, verification,
  and phase order.
- Public name: OpenReaper. Internal code paths and bridge names still use
  Streetlight.
- Do not commit, push, reset, branch, or rewrite history unless the user
  explicitly asks. User preference (2026-06-29): local commits are okay as
  explicit save points, but avoid pushing during work hours unless the user
  explicitly makes an exception.
- Do not stage or touch the nested ignored `style-memory-mcp/` project.

## Current Slice

Slice 24 implements **Phase 2.5 Delivery Closure MVP**. It adds an
opt-in `delivery` pack with read-only JSON artifact templates:
`delivery_plan` and `delivery_report`.

What changed in the current working tree:

- New TS pack files under
  `packages/mcp-server/src/packs/delivery/`.
- New Lua pack files under `reaper/packs/delivery/`.
- Registry, manifest alignment, template-authoring lint, call-template,
  list-template, and Lua-structure tests were extended for delivery.
- Docs updated:
  `docs/plans/SLICE_24_DELIVERY_CLOSURE_ARCHITECT_PLAN.md`,
  `docs/packs/delivery/README.md`,
  `docs/smokes/delivery_closure.md`,
  `docs/HANDOFF.md`, `docs/PROGRESS.md`, and this briefing.

Enable delivery explicitly:

```sh
STREETLIGHT_ENABLED_PACKS=core,delivery npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,delivery npm run check:template-authoring
```

For REAPER live smoke, set this before loading the bridge:

```lua
_G.STREETLIGHT_ENABLED_PACKS = "core,cleanup,delivery"
```

Current state is implementation-complete, static-green, and
REAPER-smoke-green. Next action is user-directed: commit the
smoke-evidence docs on explicit ask, request the next slice packet, or
pivot.

## Previous Slice

Slice 19 implemented **H6 closure — first real template from the
scaffolder workflow**.

What landed:

- New template: `track_color`
- New file:
  `packages/mcp-server/src/templates/track-color.ts`
- Registered in:
  `packages/mcp-server/src/templates/index.ts`
- New test file:
  `packages/mcp-server/src/tools/__tests__/track-color.test.ts`
- Runtime handler added in:
  `reaper/packs/core/templates/track.lua`
- Manifest entry added in:
  `reaper/packs/core/manifest.lua`
- Verify reader added in:
  `reaper/packs/core/verify.lua`
- Metadata/list regression updated in:
  `packages/mcp-server/src/tools/__tests__/list-templates.test.ts`
- Lua structure regression updated in:
  `scripts/__tests__/lua-structure.test.mjs`

`track_color` contract:

- `entity_kind: "track"`
- `risk: "write_safe"`
- `undoable: true`
- `undo_flags: ["TRACKCFG"]`
- `idempotent: true`
- params: `{ track_id: string, color: "#RRGGBB" | null }`
- `color:null` clears custom color.
- `"#000000"` is black, not clear.
- TS schema accepts uppercase hex only to keep field verification's
  string comparison stable.

Runtime behavior:

- Resolves the track before mutation.
- Parses hex before mutation.
- Sets custom color using:
  `SetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR", ColorToNative(r,g,b) | 0x1000000)`
- Clears using `I_CUSTOMCOLOR = 0`.
- Returns the changed track GUID.

Verify behavior:

- Adds one narrow synthetic field: `I_CUSTOMCOLOR_HEX`.
- `I_CUSTOMCOLOR == 0` or missing enabled bit returns `0`.
- Enabled colors mask off `0x1000000`, use `ColorFromNative`, and return
  uppercase `#RRGGBB`.
- This is intentionally not a general transform DSL.

Static status:

- `npm test`: **357/357** green.
- `npm run build`: clean.
- `npm run check:manifest`: 12 templates aligned.
- `npm run check:error-codes-fresh`: 22 codes fresh.
- `npm run check:template-authoring`: 12 templates ok.
- `git diff --check`: clean.

Live smoke:

- Passed after a full REAPER quit/reopen and current `start_bridge.lua`
  load. Console showed generation 1, loaded error codes, and ready line
  with `track_color`.
- Smoke stamp: `1782840178741`.
- Track GUID: `guid:{016B7CED-64A7-1645-9AE2-E6E1547CA447}`.
- `track_create` created the smoke track; `track_color` succeeded for
  `#2D9CDB`, `#000000`, and `null`; `track_rename
  last_result:track:0` hit the same GUID; missing track returned typed
  `TRACK_NOT_FOUND`.
- Queue cleanup ended `pending=0`, `running=0`, `done=0`.

## Live Smoke Recipe Already Verified

Precondition:

1. Fully quit REAPER.
2. Reopen REAPER.
3. Run current `start_bridge.lua`.
4. Confirm console shows generation 1, loaded error codes, and ready line
   with `track_color` in templates.

Smoke recipe:

1. `ping` -> connected.
2. `list_templates` -> 12 templates; `track_color` has `write_safe`,
   `track`, `TRACKCFG`, `idempotent:true`, and expectedDelta field
   `track.I_CUSTOMCOLOR_HEX <- color`.
3. `track_create` `{ name:"S19 Track Color Smoke", reuse_existing:true }`.
4. `track_color` `{ track_id:"last_result:track:0", color:"#2D9CDB" }`
   -> ok, no `VERIFY_FAILED`.
5. `track_color` `{ track_id:"last_result:track:0", color:"#000000" }`
   -> ok, proves black != clear.
6. `track_color` `{ track_id:"last_result:track:0", color:null }`
   -> ok, proves clear.
7. `track_rename` `{ track_id:"last_result:track:0", name:"S19 Track Color Smoke Renamed" }`
   -> ok, proves `LAST_RESULT.tracks` still routes after `track_color`.
8. Negative: `track_color` with a missing track ref returns
   `TRACK_NOT_FOUND`, not `INTERNAL_ERROR`.

Pass criteria met:

- All successful calls return locked call_template envelope.
- `changed_count=1`, `changed_ids[0]` is the same track GUID shape.
- No `VERIFY_FAILED`.
- No stale bridge double-owner symptoms.
- Queue ends clean.

## Workflow To Continue

1. Read:
   - `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/HANDOFF.md`
   - `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/PROGRESS.md`
   - `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/TEMPLATE_AUTHORING.md`
   - `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md`
   - `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/KERNEL_HARDENING_PLAN.md`
   - `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/plans/KERNEL_HARDENING_EXECUTION.md`
2. If asked for the next work item, request or read the next architect
   packet. H6's basic loop is closed; further factory automation needs a
   larger plan.

## Rolling Slice Workflow

Use this workflow for Slice 20+ unless the user explicitly overrides it.

1. **Architect owns plans.** Codex should not invent a large slice in
   chat. When the current slice is complete, ask the user for the next
   architect packet prompt / command. The user will feed that to the
   architect agent and paste the resulting plan back here.
2. **Codex executes.** Once the user approves a packet's decisions,
   Codex implements the slice in this repo, following the packet and the
   first-real-version plan. Keep the slice within G15's complexity
   budget; split if it grows beyond one primary contract/capability.
3. **Codex pulls reviewer and smoke.** Codex is responsible for spawning
   reviewer / smoke subagents when useful. Reviewer checks code and
   contracts; smoke verifies static gates and, when runtime changed, the
   REAPER live-smoke recipe. Do not make the user manually coordinate
   those agents.
4. **User handles key decisions and final acceptance.** Ask the user only
   for contract/schema/risk/product decisions or final sign-off. Avoid
   blocking on implementation details Codex can decide from the plan and
   existing patterns.
5. **Docs move during the slice.** Update `HANDOFF.md`, `PROGRESS.md`,
   `NEXT_WINDOW_BRIEFING.md`, and the slice plan as status changes, so a
   context reset can resume without archaeology.
6. **Commit locally, do not push by default.** After code, reviewer,
   static gates, docs, and required live smoke are green, make a local
   commit only when the user asks. Do not push unless the user explicitly
   asks for push.

Keep the invariant sharp: each slice must make the kernel more reliable,
more testable, or harder to misuse, with a concrete local test and a live
REAPER smoke when runtime is affected.

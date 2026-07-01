# Next Window Briefing — 2026-07-01

Use this as the first read after a context reset. It is the current truth
after Slice 22 live smoke.

## Snapshot

- Repo: `/Users/Zhuanz/Documents/streetlight-reaper-mcp`
- Remote: `https://github.com/hexingyuofficial/OpenReaper.git`
- Branch: `main`; latest pushed checkpoint is Slice 19:
  `e54fd9c kernel-hardening: slice 19 track color template`
- Slice 19 is committed and pushed. It is static-green and live-smoked
  on REAPER `7.71/macOS-arm64`; H6's basic loop is closed.
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

Slice 22 implements **Phase 2A Cleanup Plan Artifact MVP**. It is the
first real non-core domain pack on top of the pack contract and artifact
contract foundations.

What changed in the current working tree:

- New TS cleanup pack:
  `packages/mcp-server/src/packs/cleanup/cleanup-plan.ts`
  and `packages/mcp-server/src/packs/cleanup/index.ts`.
- `packages/mcp-server/src/templates/index.ts` can register
  `cleanup` through `registerEnabledTemplates`.
- `scripts/template-authoring-lint.mjs` scans cleanup templates when the
  pack is enabled.
- New Lua cleanup pack:
  `reaper/packs/cleanup/manifest.lua` and
  `reaper/packs/cleanup/templates/cleanup.lua`.
- New docs:
  `docs/packs/cleanup/README.md`,
  `docs/smokes/cleanup_plan.md`, and
  `docs/plans/SLICE_22_CLEANUP_PLAN_ARCHITECT_PLAN.md`.
- Tests cover cleanup pack visibility, disabled-by-default behavior,
  locked envelope, manifest alignment, authoring lint, read-only Lua
  structure, bounded target previews, and compact hashed fingerprints.

Enable cleanup explicitly:

```sh
STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:template-authoring
```

For REAPER live smoke, set this before loading the bridge:

```lua
_G.STREETLIGHT_ENABLED_PACKS = "core,cleanup"
```

Current state is implementation-complete and smoke-green. Next action is
whatever the user asks next: commit Slice 22, request the next architect
packet from the external planner, or pivot.

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

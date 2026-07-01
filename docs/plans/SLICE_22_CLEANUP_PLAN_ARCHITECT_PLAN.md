# Slice 22 Architect Plan - Phase 2A Cleanup Plan Artifact MVP

Date: 2026-07-01

Phase: 2A, the first small slice of Phase 2: Cleanup Plan-First MVP from
[`OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md`](OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md).

Status: implemented, static-green, and live-smoked as Slice 22. Do not
commit or push without an explicit user ask.

## Plan Score

**9 / 10.**

This is the right first Phase 2 slice because it consumes the two freshly
landed foundations without expanding them: Slice 20B gives a non-core pack
boundary, and Slice 21 gives JSON artifact refs plus `get_state` readback.
The slice stays inside G15 by shipping exactly one read-only capability:
`cleanup_plan`.

The missing point is intentional. The exact dirty fixture file/path and
whether the real `cleanup` pack should remain explicit opt-in after the
smoke are user decisions. The implementation can proceed with the
recommended defaults below.

## Source Documents Read

This packet derives from:

- `docs/HANDOFF.md`
- `docs/PROGRESS.md`
- `docs/NEXT_WINDOW_BRIEFING.md`
- `docs/TEMPLATE_AUTHORING.md`
- `docs/TEMPLATE_SPEC.md`
- `docs/RESPONSE_BUDGET.md`
- `docs/plans/OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md`
- `docs/plans/SLICE_20B_PACK_CONTRACT_ARCHITECT_PLAN.md`
- `docs/plans/SLICE_21_ARTIFACT_CONTRACT_ARCHITECT_PLAN.md`
- `docs/plans/KERNEL_HARDENING_PLAN.md`
- `docs/plans/KERNEL_HARDENING_EXECUTION.md`

Binding references:

- Phase 2: Cleanup Plan-First MVP
- G3 Locked Mutation Envelope Stays Pure
- G5 Destructive And Cleanup Work Is Plan-First
- G7 / G7A Plan And Report Are Artifacts
- G13 No Core Parking Lot
- G15 Slice Complexity Budget
- Decision Register D3 / D8 / D12 / D15 / D17
- Appendix B Review Checklist

Current-status correction from the user prompt overrides older
`commit-ready` wording in status docs:

- Slice 20B is locally committed:
  `c11b114 first-real-version: slice 20b pack contract foundation`.
- Slice 21 is locally committed:
  `c0222c9 first-real-version: slice 21 artifact contract foundation`.
- `main...origin/main` is ahead by 2 and not pushed.
- Slice 21 is static-green and REAPER live-smoked green for artifact refs,
  `get_state` artifact summary/payload, `fixture_artifact_probe`, and the
  `render_region` legacy carve-out.

## Goal

Implement the smallest useful cleanup planning capability:

- A new non-core `cleanup` pack.
- One template, `cleanup_plan`.
- The template reads project/track/region state, writes one bounded JSON
  artifact, and returns one `artifact:cleanup:plan:<id>` ref in the locked
  `call_template` envelope.
- The project is not mutated.
- Item/track/region `LAST_RESULT` is not updated or cleared.
- The produced plan is deterministic on the same dirty fixture, ignoring
  wrapper-only artifact metadata such as `ref`, `id`, and `created_at`.

## Direct Answers

1. **Does Slice 22 implement only `cleanup_plan`?**
   Yes. This slice implements only `cleanup_plan`.
   It explicitly does **not** implement `cleanup_apply_safe`.

2. **Cleanup pack id.**
   Recommend `cleanup`.
   It is short, matches the Phase 2 vocabulary, and keeps artifact refs
   readable: `artifact:cleanup:plan:<id>`.
   Do not use `project_cleanup` unless the user wants a more verbose pack
   id before implementation starts.

3. **Minimal input params.**
   Recommend:

   ```json
   {
     "max_suggestions": 25
   }
   ```

   `max_suggestions` is optional, defaults to `25`, and is clamped by the
   schema to `1..50`.

   Do not add `mode` in Slice 22. The slice has only one mode:
   read-only safe review.

   Do not add `include` in Slice 22. `tracks`, `regions`, and `project`
   are enough for v1. `include:["fx"]` may be a future cleanup-plan
   extension, but it should not be required for this MVP and must not
   become FX/routing auto-repair.

4. **Artifact ref shape.**
   Use the Slice 21 grammar:

   ```text
   artifact:cleanup:plan:<id>
   ```

   Example:

   ```text
   artifact:cleanup:plan:art_20260701120130999_003_a1b2c3
   ```

5. **Artifact schema id.**
   Use:

   ```text
   openreaper.cleanup_plan.v1
   ```

6. **State read by `cleanup_plan`.**
   V1 reads the equivalent of current:

   - `get_state(scope:"project")`
   - `get_state(scope:"tracks")`
   - `get_state(scope:"regions")`

   Implementation can read directly through REAPER APIs inside the Lua
   template. The state families are the current public read families:
   project, tracks, and regions. The internal cleanup snapshot may add
   track-only facts needed for heuristics, especially `item_count` and
   `folder_depth_delta`; these do not require a new public `get_state`
   scope or public track descriptor field in Slice 22.

   `include:["fx"]` is not required for Slice 22.

7. **Safe v1 suggestions.**
   Allowed:

   - duplicate track names;
   - empty or unnamed tracks;
   - inconsistent region names;
   - folder/depth observations;
   - muted / solo / recarm warnings.

   Explicitly excluded:

   - audio content analysis;
   - automatic mix judgment;
   - routing repair;
   - FX repair;
   - destructive deletion;
   - automatic apply.

8. **Plan artifact summary / payload fields.**
   Summary is small and list-free:

   ```json
   {
     "title": "Cleanup plan",
     "schema": "openreaper.cleanup_plan.v1",
     "project": {
       "track_count": 8,
       "region_count": 4,
       "length_seconds": 32.5
     },
     "suggestion_count": 5,
     "warning_count": 2,
     "suggestion_counts": {
       "duplicate_track_names": 1,
       "empty_or_unnamed_tracks": 1,
       "inconsistent_region_names": 1,
       "folder_depth_observation": 1,
       "state_warning": 1
     },
     "truncated": false
   }
   ```

   Payload is bounded and schema-owned:

   ```json
   {
     "schema": "openreaper.cleanup_plan.v1",
     "inputs": {
       "max_suggestions": 25
     },
     "source": {
       "project": {
         "bpm": 120,
         "time_sig_num": 4,
         "time_sig_den": 4,
         "sample_rate": 48000,
         "length_seconds": 32.5
       },
       "track_count": 8,
       "region_count": 4,
       "fingerprint": "tracks=8;regions=4;..."
     },
     "limits": {
       "max_suggestions": 25,
       "candidate_count": 5,
       "returned_suggestions": 5,
       "truncated": false
     },
     "suggestions": [
       {
         "id": "cln_001",
         "kind": "duplicate_track_names",
         "severity": "warning",
         "title": "Duplicate track name: FX",
         "detail": "2 tracks share the exact name FX.",
         "targets": [
           { "type": "track", "id": "guid:{...}", "index": 2, "name": "FX" },
           { "type": "track", "id": "guid:{...}", "index": 5, "name": "FX" }
         ],
         "target_count": 2,
         "safe_action": {
           "type": "review_rename",
           "apply_template": "track_rename",
           "auto_apply": false
         }
       }
     ],
     "deferred": [
       "cleanup_apply_safe",
       "cleanup_apply_destructive",
       "routing_repair",
       "fx_repair",
       "audio_content_analysis",
       "delivery_closure"
     ]
   }
   ```

   The artifact wrapper still carries the standard Slice 21 fields:
   `artifact_contract`, `ref`, `id`, `scope`, `owner_pack`,
   `producer_template`, `schema`, `created_at`, `summary`, and `payload`.

9. **Deterministic / repeatable acceptance.**
   Running `cleanup_plan` twice on the same fixture should produce two
   different artifact refs, but equivalent plan content. Compare:

   - `artifact.schema`
   - `artifact.summary`, except any wrapper-only timestamp if a future
     implementation adds one;
   - `artifact.payload.inputs`
   - `artifact.payload.source.fingerprint`
   - `artifact.payload.limits`
   - `artifact.payload.suggestions`
   - `artifact.payload.deferred`

   Do not compare artifact `ref`, `id`, or `created_at`. Suggestions must
   be sorted by deterministic keys: severity rank, kind, first target
   stable id/name/index, then title. Suggestion ids are deterministic
   sequence ids (`cln_001`, `cln_002`, ...), not derived from the artifact
   id.

10. **No project mutation / no `LAST_RESULT` pollution.**
    Descriptor and manifest:

    - `risk:"filesystem"`
    - `mutates:false`
    - `undoable:false`
    - `undo_flags:[]`
    - `entity_kind:"artifact"`
    - `artifact.kind:"json"`
    - `artifact.scope:"plan"`
    - `artifact.read_scope:"artifact"`
    - `artifact.updates_last_result:false`
    - no `expectedDelta`

    The Lua handler must not call project-mutating REAPER APIs. It reads
    state, writes the JSON artifact through `ctx.artifacts:write_json(...)`,
    and returns `{ changed_ids = { ref } }`.

11. **`list_templates` / manifest alignment / authoring lint.**
    `cleanup_plan` must appear in `list_templates` only when the `cleanup`
    pack is enabled. Its metadata must expose compact artifact info:

    ```json
    {
      "artifact": {
        "kind": "json",
        "scope": "plan",
        "ref_prefix": "artifact:cleanup:plan:",
        "read_scope": "artifact",
        "updates_last_result": false,
        "schema": "openreaper.cleanup_plan.v1"
      }
    }
    ```

    Manifest alignment must compare the same artifact metadata on TS and
    Lua sides. Template authoring lint must scan the cleanup pack when
    `STREETLIGHT_ENABLED_PACKS=core,cleanup`.

12. **Fixture project or fixture pack smoke.**
    Yes. Use a real dirty fixture, not only a fake bridge test.

    Recommendation: add a small `.RPP` fixture or a machine-rerunnable
    smoke setup under a stable repo path such as
    `docs/fixtures/cleanup_dirty_minimal.RPP` plus a smoke note under
    `docs/smokes/cleanup_plan.md`.

    The fixture should include:

    - two duplicate track names;
    - at least one unnamed or empty track;
    - at least two inconsistently named regions;
    - one simple folder/depth shape;
    - one muted, soloed, or recarmed track.

    Do not use the test-only `pack_contract_fixture` as the cleanup pack.
    It may remain useful for combined-pack regression, but real cleanup
    belongs to `cleanup`.

13. **Static tests.**
    See the full list below. At minimum: descriptor schema, pack
    registration, `list_templates`, fake-bridge locked envelope, manifest
    alignment, authoring lint, Lua structure, and default disabled-pack
    behavior.

14. **REAPER live smoke.**
    Required, because Slice 22 adds runtime Lua, a Lua manifest, a new
    artifact-producing domain pack, and REAPER API reads. Exact recipe is
    below.

15. **Explicit non-goals.**
    Slice 22 does not do:

    - `cleanup_apply_safe`;
    - `cleanup_apply_destructive`;
    - deletion;
    - routing auto-repair;
    - FX auto-repair;
    - delivery closure;
    - analysis;
    - MIDI;
    - new MCP tool;
    - `call_template` success-envelope expansion;
    - temporary cleanup parking in `core`.

## Non-Goals

- No `cleanup_apply_safe`.
- No `cleanup_apply_destructive`.
- No delete template.
- No one-shot `cleanup_all`.
- No routing or FX automatic repair.
- No audio content analysis.
- No automatic mixing decisions.
- No delivery plan/report or output-file validation.
- No loop, layer, recipe, scene, OpenAudio, OpenCue, or MIDI work.
- No new MCP tool.
- No `get_state(scope:"cleanup")` or `get_state(scope:"plan")` alias.
- No public `last_result:artifact:N` or `last_result:plan:N` resolver.
- No expansion of the locked `call_template` success envelope.
- No migration of `render_region` to JSON artifacts.
- No `PUBLIC_STORY.md` overclaim. Public cleanup/delivery claims wait
  until apply and delivery are live-smoked in later phases.
- No temporary cleanup implementation in `core`.

Emergency alternative if the user explicitly forces temporary `core`
placement: the packet must name an expiry slice no later than Slice 23,
block `cleanup_apply_safe` until migration is complete, and include a
migration checklist moving TS registration, Lua manifest/templates, docs,
tests, and artifact refs to `cleanup`. This packet does **not** select
that alternative.

## Current Baseline

- Repository: `/Users/Zhuanz/Documents/streetlight-reaper-mcp`
- Branch: `main`
- HEAD: `c0222c9 first-real-version: slice 21 artifact contract foundation`
- Local branch: `main...origin/main [ahead 2]`
- Slice 20B local commit:
  `c11b114 first-real-version: slice 20b pack contract foundation`
- Slice 21 local commit:
  `c0222c9 first-real-version: slice 21 artifact contract foundation`
- Not pushed.
- Default runtime pack remains `core`.
- `pack_contract_fixture` remains disabled by default and is enabled only
  for fixture verification.
- Core template count is 12.
- Fixture-enabled template count after Slice 21 is 14 across 2 packs.
- Existing JSON artifact refs use:
  `artifact:<owner_pack>:<scope>:<id>`.
- Existing artifact readback uses:
  `get_state({ scope:"artifact", artifact_ref, view:"summary"|"payload" })`.
- JSON artifact producers do not update item/track/region `LAST_RESULT`.
- `render_region` remains the legacy absolute-WAV-path carve-out and
  still routes to `LAST_RESULT.renders`.
- Current `get_state` scopes relevant to cleanup:
  `project`, `tracks`, `regions`, and `artifact`.
- Current `tracks` descriptors include `id`, `index`, `name`, `depth`,
  `volume`, `pan`, `mute`, `solo`, and `recarm`. `fx` is opt-in only
  through `include:["fx"]` and is deferred for cleanup v1.

## Contract

### Pack Contract

Add a new repo-local static pack:

```text
cleanup
```

Recommended enablement:

- Default remains `core` only in Slice 22.
- Verification enables cleanup explicitly:
  `STREETLIGHT_ENABLED_PACKS=core,cleanup`.
- The user can later decide whether a real release should enable
  `cleanup` by default. Do not mix that distribution decision into this
  first implementation slice.

TS side:

- Add `packages/mcp-server/src/packs/cleanup/`.
- Export `CLEANUP_PACK_ID = "cleanup"`.
- Register `cleanupPlanDefinition` from the cleanup pack when enabled.
- Update static known-pack maps used by authoring lint and tests.

Lua side:

- Add `reaper/packs/cleanup/manifest.lua`.
- Add `reaper/packs/cleanup/templates/cleanup.lua`.
- Reuse core's `artifact` entity kind. Do not declare a new
  `entity_buckets` entry in the cleanup manifest.

Docs:

- Add `docs/packs/cleanup/README.md`.
- Add a fixture/smoke note, recommended
  `docs/smokes/cleanup_plan.md`.

### Template Contract

Template name:

```text
cleanup_plan
```

Descriptor:

```ts
{
  name: "cleanup_plan",
  pack: "cleanup",
  risk: "filesystem",
  mutates: false,
  undoable: false,
  entity_kind: "artifact",
  undo_flags: [],
  idempotent: false,
  artifact: {
    kind: "json",
    scope: "plan",
    ref_prefix: "artifact:cleanup:plan:",
    read_scope: "artifact",
    updates_last_result: false,
    schema: "openreaper.cleanup_plan.v1",
  },
  expectedDelta: undefined
}
```

Params:

```ts
z.object({
  max_suggestions: z.number().int().min(1).max(50).default(25),
}).strict()
```

Example:

```json
{
  "max_suggestions": 25
}
```

Success:

```json
{
  "template": "cleanup_plan",
  "changed_count": 1,
  "changed_ids": [
    "artifact:cleanup:plan:art_20260701120130999_003_a1b2c3"
  ],
  "truncated": false
}
```

Forbidden success fields:

- `artifact`
- `payload`
- `summary`
- `plan`
- `suggestions`
- `path`
- any rich project descriptors

### Artifact Schema Contract

Artifact wrapper:

- `artifact_contract`: `openreaper.artifact.v1`
- `owner_pack`: `cleanup`
- `scope`: `plan`
- `producer_template`: `cleanup_plan`
- `schema`: `openreaper.cleanup_plan.v1`

Summary:

- Schema id.
- Track/region/project counts.
- Suggestion count and warning count.
- Suggestion counts by kind.
- `truncated` boolean.

Payload:

- Schema id.
- Inputs.
- Source project summary and deterministic fingerprint.
- Limits.
- Suggestions.
- Deferred capabilities.

Keep the payload below the artifact response budget. If candidate
suggestions exceed `max_suggestions`, return the first deterministic
`max_suggestions` and set `limits.truncated:true` plus
`summary.truncated:true`. Do not rely on `get_state(scope:"artifact")`
to truncate arbitrary JSON; Slice 21 artifact reads return
`RESPONSE_TOO_LARGE` instead. Also bound each suggestion: `targets` is a
small preview, not the full affected object list; expose the complete
affected count through `target_count`, and set `targets_truncated:true`
when preview targets were omitted. Long titles/details and target names
must be truncated on UTF-8 boundaries.

### Suggestion Schema

Minimal suggestion fields:

```json
{
  "id": "cln_001",
  "kind": "duplicate_track_names",
  "severity": "info|warning",
  "title": "Duplicate track name: FX",
  "detail": "2 tracks share the exact name FX.",
  "targets": [
    {
      "type": "track",
      "id": "guid:{...}",
      "index": 2,
      "name": "FX"
    }
  ],
  "target_count": 2,
  "safe_action": {
    "type": "review_rename",
    "apply_template": "track_rename",
    "auto_apply": false
  }
}
```

Kinds allowed in Slice 22:

- `duplicate_track_names`
- `empty_or_unnamed_tracks`
- `inconsistent_region_names`
- `folder_depth_observation`
- `state_warning`

Severity:

- `warning` for duplicate names, recarm/solo/mute state, and likely
  confusing region naming.
- `info` for folder/depth observations and empty/unnamed tracks when no
  automatic safe action is selected.

Targets:

- Track targets should include stable GUID ref, current index, and name.
- Region targets should include `name`, `start`, and `end` because v0.1
  regions are name-shaped and have no native GUID ref.
- Do not include full track/region snapshots in every suggestion.
- Do not include unbounded target lists. Slice 22 uses a bounded preview
  and records the complete affected count in `target_count`.

Safe action:

- Optional.
- Must be advisory only.
- `auto_apply` is always `false`.
- If present, `apply_template` names an existing small template such as
  `track_rename` or `region_create` only as future guidance. Slice 22
  does not execute it.

### Heuristic Contract

The implementation should keep heuristics deterministic and boring:

1. Duplicate track names:
   - Exact string match on `track.name`.
   - Ignore `""` here; unnamed tracks are covered separately.
   - Sort duplicate groups by name, then first index.
2. Empty or unnamed tracks:
   - Unnamed: `name == ""` or whitespace-only after trimming.
   - Empty: `CountTrackMediaItems(track) == 0` in the internal cleanup
     snapshot.
3. Inconsistent region names:
   - Empty/whitespace names.
   - Duplicate exact names.
   - Obvious mixed prefix/index families inside one project, e.g.
     `var_01`, `var 2`, `VAR-03`, without trying to invent a perfect
     naming standard.
4. Folder/depth observations:
   - Report suspicious depth jumps, final nonzero depth, or hard-to-read
     nested sections if the direct reader can inspect `I_FOLDERDEPTH`.
   - Otherwise report simple depth distribution observations from current
     `get_state(tracks)`-style `depth`.
   - Do not propose automatic folder repair in Slice 22.
5. Muted / solo / recarm warnings:
   - Report tracks with `mute`, `solo`, or `recarm` true.
   - This is a warning, not a recommendation to clear the state.

Do not inspect audio content. Do not infer "bad mix", "wrong loudness",
"should delete", or "should reroute".

### Determinism Contract

The same project state and same params must produce equivalent plan
content:

- Stable snapshot order: REAPER track index and region timeline order.
- Stable grouping: sort groups by normalized key, then first stable
  target key.
- Stable suggestion ordering.
- Stable suggestion ids assigned after sorting.
- No wall-clock time, queue id, artifact id, absolute artifact path, or
  random value in `payload`.
- Artifact wrapper `ref`, `id`, and `created_at` may differ and are
  excluded from equivalence checks.

### Freshness Preparation

Slice 22 does not implement apply or stale-plan rejection. Still include
a minimal `source.fingerprint` so Slice 23+ can reject stale plans.

Recommended v1 fingerprint shape:

```text
tracks=<count>;regions=<count>;project=<length_seconds>;hash=<deterministic-hash>
```

The fingerprint is a compact deterministic string in v1. It is not a
cryptographic hash and it must not include unbounded full track/region
name lists or absolute project file paths.

## Files Likely Touched In Implementation

TS / registry:

- `packages/mcp-server/src/packs/cleanup/index.ts`
- `packages/mcp-server/src/packs/cleanup/cleanup-plan.ts`
- `packages/mcp-server/src/templates/index.ts`
- `packages/mcp-server/src/tools/__tests__/call-template.test.ts`
- `packages/mcp-server/src/tools/__tests__/list-templates.test.ts`
- Possibly `packages/core/src/__tests__/registry.test.ts` for artifact
  descriptor regression if not already covered generically.

Scripts:

- `scripts/template-authoring-lint.mjs`
- `scripts/__tests__/template-authoring-lint.test.mjs`
- `scripts/__tests__/manifest-alignment.test.mjs`
- `scripts/__tests__/lua-structure.test.mjs`

Lua:

- `reaper/packs/cleanup/manifest.lua`
- `reaper/packs/cleanup/templates/cleanup.lua`

Docs / smoke:

- `docs/packs/cleanup/README.md`
- `docs/smokes/cleanup_plan.md` or equivalent smoke runbook
- Optional `docs/fixtures/cleanup_dirty_minimal.RPP` or equivalent
  deterministic fixture path
- `docs/HANDOFF.md`
- `docs/PROGRESS.md`
- `docs/NEXT_WINDOW_BRIEFING.md`
- This plan file, updated only for implementation status after the slice
  is actually implemented

Do not touch:

- `packages/mcp-server/src/index.ts` except incidental text if an
  implementation already centralizes enabled pack logging there. No new
  MCP tools.
- `reaper/packs/core/manifest.lua` unless a test needs only commentary.
  Core already reserves `entity_kind:"artifact"`.
- `reaper/packs/core/refs.lua`; no artifact resolver.
- `docs/PUBLIC_STORY.md` unless the user explicitly wants a foundation
  note with no cleanup/delivery claim.

## Implementation Steps

1. Add the cleanup TS pack.
   - Create `packages/mcp-server/src/packs/cleanup/index.ts`.
   - Create `cleanup-plan.ts` with the descriptor above.
   - Use `defineTemplate(...)` and `callTemplateResultSchema("cleanup_plan")`.
   - Keep examples positive and parseable.
2. Register the cleanup pack statically.
   - Add a `CLEANUP_PACK_ID` branch to `registerEnabledTemplates(...)`.
   - Keep default `core` behavior unchanged.
   - Unknown packs still fail loudly.
3. Extend authoring lint known-pack directories.
   - Add `cleanup` to `TEMPLATE_DIRS_BY_PACK`.
   - Tests prove `STREETLIGHT_ENABLED_PACKS=core,cleanup` scans the
     cleanup template file.
4. Add Lua cleanup pack.
   - Create `reaper/packs/cleanup/manifest.lua`.
   - Create `reaper/packs/cleanup/templates/cleanup.lua`.
   - Manifest uses `entity_kind="artifact"` and JSON artifact metadata.
   - No `entity_buckets` declaration in the cleanup pack.
5. Implement read-only state collection inside `cleanup_plan`.
   - Read project summary.
   - Read tracks with id/index/name/depth/mute/solo/recarm plus internal
     `item_count` and `I_FOLDERDEPTH` delta.
   - Read regions with name/start/end.
   - Do not call project-mutating APIs.
6. Implement deterministic suggestion generation.
   - Generate candidate list.
   - Sort candidates.
   - Cap by `max_suggestions`.
   - Assign `cln_001...` after sorting.
7. Write the JSON artifact.
   - Use `ctx.artifacts:write_json`.
   - `owner_pack="cleanup"`.
   - `scope="plan"`.
   - `producer_template="cleanup_plan"`.
   - `schema="openreaper.cleanup_plan.v1"`.
   - Summary and payload follow this packet.
8. Add fake-bridge tests.
   - Params validation.
   - Locked envelope for artifact ref.
   - No rich success fields.
   - Default disabled-pack behavior.
9. Add `list_templates` tests.
   - Default core-only count unchanged.
   - `core,cleanup` includes `cleanup_plan`.
   - Metadata includes `pack:"cleanup"` and artifact descriptor.
10. Add manifest and lint tests.
    - `STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:manifest`
      passes.
    - `STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:template-authoring`
      passes.
    - Artifact metadata mismatch fails in synthetic tests.
11. Add Lua-structure tests.
    - Cleanup pack manifest exists.
    - `cleanup_plan` manifest entry has `undoable=false`,
      `entity_kind="artifact"`, and `updates_last_result=false`.
    - Handler uses `ctx.artifacts:write_json`.
    - Handler does not call known mutating APIs such as
      `InsertTrackAtIndex`, `SetMediaTrackInfo_Value`,
      `GetSetMediaTrackInfo_String(..., true)`, `DeleteTrack`,
      `DeleteProjectMarker`, `UpdateArrange`, or render commands.
12. Add fixture/smoke docs.
13. Run static gates.
14. Run REAPER live smoke with `core,cleanup`.
15. Update status docs after implementation and smoke, but do not commit
    unless the user asks.

## Static Tests

Required baseline:

```bash
npm run build
npm test
npm run check:manifest
npm run check:error-codes-fresh
npm run check:template-authoring
git diff --check
```

Cleanup-enabled gates:

```bash
STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:template-authoring
```

Optional combined regression:

```bash
STREETLIGHT_ENABLED_PACKS=core,cleanup,pack_contract_fixture npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,cleanup,pack_contract_fixture npm run check:template-authoring
```

Specific cases:

1. Pack registration:
   - default `registerEnabledTemplates()` remains core-only;
   - `["core","cleanup"]` registers `cleanup_plan`;
   - cleanup template has `pack:"cleanup"`;
   - unknown pack still throws.
2. Params schema:
   - `{}` parses with `max_suggestions=25`;
   - `max_suggestions:1` and `50` parse;
   - `0`, `51`, fractional, string, and unknown extra keys return
     `PARAMS_INVALID`.
3. Registry/artifact metadata:
   - `cleanup_plan` is `risk:"filesystem"`;
   - `mutates:false`;
   - `undoable:false`;
   - `entity_kind:"artifact"`;
   - no `expectedDelta`;
   - artifact metadata exactly matches `artifact:cleanup:plan:`.
4. `list_templates`:
   - core-only count stays 12 and cleanup is absent;
   - `core,cleanup` count is 13 and includes cleanup metadata;
   - fixture pack remains absent unless explicitly enabled;
   - artifact metadata is compact and contains no payload schema blob.
5. `call_template` fake bridge:
   - happy path returns locked envelope only;
   - `changed_count=1`;
   - `changed_ids[0]` matches `artifact:cleanup:plan:<id>`;
   - no `artifact`, `payload`, `summary`, `suggestions`, or `path` field
     appears in the success result;
   - default core-only registry returns `TEMPLATE_NOT_FOUND` before queue
     write.
6. Manifest alignment:
   - default core-only passes;
   - `core,cleanup` passes;
   - TS/Lua artifact scope mismatch fails;
   - TS/Lua artifact schema mismatch fails;
   - cleanup pack using a new non-core entity kind fails;
   - cleanup pack reusing core `artifact` passes.
7. Authoring lint:
   - cleanup pack directory is scanned when enabled;
   - cleanup example parses;
   - missing cleanup TS file or registration is caught.
8. Lua structure:
   - cleanup pack manifest can be parsed by existing static parser;
   - handler uses `ctx.artifacts:write_json`;
   - handler does not contain known project-mutating API calls;
   - no raw Lua error-code string literals are introduced.
9. Artifact read regressions:
   - existing fixture artifact get_state tests still pass;
   - missing artifact still returns `ARTIFACT_NOT_FOUND`;
   - malformed artifact ref still returns `PARAMS_INVALID`;
   - oversized payload still returns `RESPONSE_TOO_LARGE`.
10. Existing regressions:
    - `track_create` / `track_rename last_result:track:0` still works;
    - `region_create` / `render_region` legacy absolute path still works;
    - default fixture-pack visibility remains unchanged;
    - risk policy still blocks `destructive` and `unsafe_eval`;
    - no MCP tool-count drift.

## REAPER Live Smoke Recipe

Required.

Preconditions:

1. Static gates above are green.
2. Prepare or open the deterministic dirty cleanup fixture.
3. Fully quit REAPER.
4. Reopen REAPER.
5. Enable cleanup before loading the bridge:

   ```lua
   _G.STREETLIGHT_ENABLED_PACKS = "core,cleanup"
   dofile("/Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/streetlight_bridge.lua")
   ```

6. Console must show:
   - `bridge starting (generation 1)`;
   - loaded error codes;
   - loaded pack `core`;
   - loaded pack `cleanup`;
   - ready line includes `cleanup_plan`.

Smoke:

1. `ping` -> connected.
2. `list_templates`:
   - includes `cleanup_plan`;
   - `cleanup_plan.pack == "cleanup"`;
   - `cleanup_plan.risk == "filesystem"`;
   - `cleanup_plan.mutates == false`;
   - `cleanup_plan.entity_kind == "artifact"`;
   - `cleanup_plan.artifact.scope == "plan"`;
   - `cleanup_plan.artifact.schema == "openreaper.cleanup_plan.v1"`;
   - `cleanup_plan.artifact.updates_last_result == false`.
3. Snapshot pre-plan state:
   - `get_state({scope:"project"})`;
   - `get_state({scope:"tracks", limit:200})`;
   - `get_state({scope:"regions", limit:200})`.
4. Anchor `LAST_RESULT.tracks` with a harmless core mutation:

   ```json
   {
     "name": "track_create",
     "params": {
       "name": "S22 Cleanup Anchor <stamp>",
       "reuse_existing": true
     }
   }
   ```

5. Run first plan:

   ```json
   {
     "name": "cleanup_plan",
     "params": {
       "max_suggestions": 25
     }
   }
   ```

   Expect locked envelope:

   ```json
   {
     "template": "cleanup_plan",
     "changed_count": 1,
     "changed_ids": ["artifact:cleanup:plan:art_..."],
     "truncated": false
   }
   ```

6. Read summary:

   ```json
   {
     "scope": "artifact",
     "artifact_ref": "<first ref>",
     "view": "summary"
   }
   ```

   Expect:

   - `owner_pack == "cleanup"`;
   - `scope == "plan"`;
   - `producer_template == "cleanup_plan"`;
   - `schema == "openreaper.cleanup_plan.v1"`;
   - no `payload` in summary view;
   - summary counts match the dirty fixture;
   - `response_bytes <= 65536`.

7. Read payload:

   ```json
   {
     "scope": "artifact",
     "artifact_ref": "<first ref>",
     "view": "payload"
   }
   ```

   Expect:

   - `payload.schema == "openreaper.cleanup_plan.v1"`;
   - `payload.suggestions` is non-empty on the dirty fixture;
   - suggestions include the expected categories from the fixture;
   - no deletion/apply/destructive step is present;
   - `payload.deferred` names apply/destructive/delivery/analysis
     deferrals;
   - `response_bytes <= 65536`.

8. Prove `cleanup_plan` did not pollute project `LAST_RESULT`:

   ```json
   {
     "name": "track_rename",
     "params": {
       "track_id": "last_result:track:0",
       "name": "S22 Cleanup Anchor Renamed <stamp>"
     }
   }
   ```

   Expect success against the anchor track. If this returns `REF_INVALID`
   because no changed tracks exist, cleanup artifact finalization cleared
   project `LAST_RESULT` and the slice fails.

9. Snapshot post-plan state:
   - `get_state({scope:"project"})`;
   - `get_state({scope:"tracks", limit:200})`;
   - `get_state({scope:"regions", limit:200})`.

   Compare against the pre-plan state, allowing only the deliberate anchor
   rename from step 8. No track counts, region counts, mute/solo/recarm
   values, or region names should change because of `cleanup_plan`.

10. Determinism check:

    - Run `cleanup_plan` a second time with the same params.
    - Read second payload.
    - Compare first and second plan content after excluding artifact
      wrapper `ref`, `id`, and `created_at`.
    - `payload.source.fingerprint`, `payload.limits`, and
      `payload.suggestions` must be equivalent.

11. Negative max suggestions:

    ```json
    {
      "name": "cleanup_plan",
      "params": {
        "max_suggestions": 51
      }
    }
    ```

    Expect `PARAMS_INVALID` before bridge execution.

12. Default disabled-pack smoke:
    - Fully quit/reopen REAPER.
    - Load bridge without cleanup pack override.
    - MCP server default has core only.
    - `list_templates` does not include `cleanup_plan`.
    - `call_template cleanup_plan` returns `TEMPLATE_NOT_FOUND` before
      queue write.

13. Queue cleanup:
    - `pending=0`;
    - `running=0`;
    - `done=0`;
    - `bridge_owner` may remain.

Optional combined-pack smoke:

- Load `core,cleanup,pack_contract_fixture`.
- Confirm `cleanup_plan`, `fixture_track_rename`, and
  `fixture_artifact_probe` all list with correct pack ownership.
- Produce one cleanup artifact and one fixture artifact.
- Confirm both read through `get_state(scope:"artifact")` and neither
  disturbs track `LAST_RESULT`.

## Risks

- `cleanup_plan` accidentally mutates project state while trying to
  inspect emptiness, folders, or warnings.
- Artifact payload grows too large if it embeds full track/region
  snapshots or too many suggestions.
- Plan determinism is broken by wall-clock fields, unordered Lua table
  iteration, or suggestion ids derived from artifact ids.
- Cleanup is accidentally registered in `core` to avoid pack plumbing.
- TS registry sees cleanup but Lua bridge cannot load it, or vice versa.
- Authoring lint/manifest alignment maps forget the new pack and give a
  false green.
- Non-core cleanup pack accidentally declares a new entity bucket instead
  of reusing core `artifact`.
- A future apply implementation treats advisory `safe_action` as already
  approved. Slice 22 must mark every action as review-only.
- The dirty fixture is too hand-wavy to reproduce, making determinism
  untestable.
- Duplicate/empty-name heuristics overreach into aesthetic advice. Keep
  v1 factual.
- Folder/depth observations may be noisy because current public track
  descriptors expose display depth, not a full folder tree contract.

## Regression Points

- Five MCP tools only.
- `call_template` success envelope unchanged.
- `changed_ids` allowlist unchanged; cleanup uses JSON artifact refs.
- `render_region` still returns absolute WAV path and still routes to
  `LAST_RESULT.renders`.
- JSON artifact producers still do not update item/track/region
  `LAST_RESULT`.
- No public `last_result:artifact:N` resolver.
- Default core-only mode remains unchanged.
- Fixture pack remains disabled unless explicitly enabled.
- Risk policy remains unchanged; `filesystem` is allowed by default,
  `destructive` and `unsafe_eval` remain blocked by default.
- `get_state(scope:"artifact")` remains the only artifact read path.
- Artifact summary/payload reads stay response-budgeted.
- No `get_state(scope:"cleanup")`, `get_state(scope:"plan")`, or new
  read alias.
- No cleanup capability in `core`.
- No delivery claim.

## User Decisions

Recommended defaults are conservative.

- S22-D1: Pack id.
  - Recommendation: `cleanup`.
- S22-D2: Default pack enablement.
  - Recommendation: keep default `core` only; require
    `STREETLIGHT_ENABLED_PACKS=core,cleanup` for Slice 22 verification.
- S22-D3: Slice scope.
  - Recommendation: only `cleanup_plan`; no `cleanup_apply_safe`.
- S22-D4: Params.
  - Recommendation: only optional `max_suggestions` default 25, max 50;
    no `mode`; no `include`.
- S22-D5: Artifact ref and schema.
  - Recommendation:
    `artifact:cleanup:plan:<id>` and `openreaper.cleanup_plan.v1`.
- S22-D6: State reads.
  - Recommendation: project + tracks + regions only; defer FX/routing.
- S22-D7: Dirty fixture.
  - Recommendation: add a tiny deterministic dirty `.RPP` fixture or a
    machine-rerunnable smoke setup before live smoke.
- S22-D8: Public story.
  - Recommendation: do not update `PUBLIC_STORY.md` with a cleanup or
    delivery claim until apply/delivery are implemented and live-smoked.

## Reviewer Checklist

Before implementation is accepted, reviewer should confirm:

- The slice cites Phase 2 and G3/G5/G7/G7A/G13/G15.
- It ships one capability: `cleanup_plan`.
- It adds a real `cleanup` pack and does not park cleanup in `core`.
- It does not add MCP tools.
- It does not add `cleanup_apply_safe`, destructive apply, deletion,
  delivery, analysis, loop, or MIDI work.
- `cleanup_plan` is `risk:"filesystem"`, `mutates:false`,
  `undoable:false`, `entity_kind:"artifact"`, and
  `updates_last_result:false`.
- The success envelope contains only artifact refs in `changed_ids`.
- The plan artifact reads through `get_state(scope:"artifact")`.
- Summary is compact; payload is bounded and does not include full
  snapshots unnecessarily.
- Suggestions expose bounded target previews plus `target_count`; they do
  not embed unbounded target arrays.
- Suggestion ordering and ids are deterministic.
- Running the plan twice on the same fixture produces equivalent plan
  content.
- Live smoke proves project state and project `LAST_RESULT` are not
  polluted.
- `list_templates`, manifest alignment, and template-authoring lint cover
  the cleanup pack.
- Status docs are updated after implementation.

## Exit Criteria

Slice 22 is complete only when:

- `cleanup_plan` exists in the `cleanup` pack.
- The cleanup pack is explicit in TS registration, Lua manifest, docs,
  manifest alignment, and template-authoring lint.
- `cleanup_plan` produces exactly one
  `artifact:cleanup:plan:<id>` ref through the locked envelope.
- `get_state(scope:"artifact", view:"summary")` reads the plan summary.
- `get_state(scope:"artifact", view:"payload")` reads the bounded plan
  payload.
- The dirty fixture produces expected factual suggestions.
- Running twice on the same fixture produces equivalent plan content.
- `cleanup_plan` does not mutate the REAPER project.
- `cleanup_plan` does not clear or update item/track/region
  `LAST_RESULT`.
- Static gates and cleanup-enabled gates are green.
- REAPER live smoke with `core,cleanup` is green.
- No apply, destructive, delivery, analysis, MIDI, routing/FX repair,
  MCP-tool expansion, or core parking is included.

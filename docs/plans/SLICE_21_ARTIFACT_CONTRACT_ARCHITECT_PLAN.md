# Slice 21 Architect Plan - Phase 1 Artifact Contract Foundation

Date: 2026-07-01

Phase: 1 from
[`OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md`](OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md)

Status: implementation static-green and REAPER live-smoked as of
2026-07-01; commit-ready, but do not commit or push without explicit
user ask. This file remains the architect packet and acceptance guide.

## Plan Score

**9 / 10.**

Phase 1 is the correct next small step after Slice 20B because future
cleanup, loop QA, render analysis, reports, and MIDI-adjacent readback all
need the same answer to one question: how does OpenReaper create bounded,
readable, durable non-project data without polluting the locked
`call_template` envelope or parking domain code in `core`?

The missing point is intentional: this packet chooses conservative defaults,
but the user should explicitly approve the artifact ref grammar, read scope,
and TTL before implementation.

## Source Documents Read

This packet derives from:

- `docs/NEXT_WINDOW_BRIEFING.md`
- `docs/HANDOFF.md`
- `docs/PROGRESS.md`
- `docs/TEMPLATE_AUTHORING.md`
- `docs/RESPONSE_BUDGET.md`
- `docs/TEMPLATE_SPEC.md`
- `docs/plans/OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md`
- `docs/plans/SLICE_20B_PACK_CONTRACT_ARCHITECT_PLAN.md`
- `docs/plans/KERNEL_HARDENING_PLAN.md`
- `docs/plans/KERNEL_HARDENING_EXECUTION.md`

Binding references:

- Phase 1: Artifact Contract Foundation
- G3 Locked Mutation Envelope Stays Pure
- G7A Artifact Finalization Is A Kernel Contract
- G10 `unsafe_eval` Is Not A Product Path
- Response Budget rules in `docs/RESPONSE_BUDGET.md`
- G13 No Core Parking Lot
- G15 Slice Complexity Budget
- Appendix B Review Checklist

Note: the prompt says "G10 Response Budget Still Applies." In the current
first-real-version plan, G10 is the `unsafe_eval` red line. This packet
therefore treats both constraints as binding: `unsafe_eval` stays out of
product paths, and every artifact read obeys the response-budget contract.

## Goal

Define and implement the smallest shared artifact contract so future
capabilities can produce analysis, plans, and reports without inventing
one-off result shapes.

Slice 21 should make these statements true:

1. New non-render artifacts have a stable ref grammar.
2. Artifact files live under the OpenReaper state directory, not inside the
   user project.
3. Artifact-producing templates return only refs in the locked
   `call_template` envelope.
4. Artifact details are read through `get_state`, with response-budget
   enforcement.
5. Artifact producers do not update item, track, or region `LAST_RESULT`.
6. `render_region` is documented as the existing legacy external-file
   carve-out, not a pattern for future JSON artifacts.
7. A fixture artifact path proves the contract without shipping cleanup,
   loop, analysis, MIDI, marketplace, dynamic install, or unsafe execution.

## Non-Goals

- No cleanup implementation.
- No cleanup heuristics.
- No cleanup apply path.
- No loop factory.
- No loop QA algorithm.
- No audio analysis algorithm.
- No MIDI read or write.
- No marketplace.
- No dynamic pack install.
- No user-pack install UX.
- No recipe executor.
- No recipe contract expansion beyond what is strictly needed for tests.
- No unsafe artifact execution.
- No `unsafe_eval`.
- No new MCP tools.
- No changes to the five-tool surface:
  `ping`, `get_state`, `call_template`, `list_templates`,
  `list_recipes`.
- No migration of `render_region` to JSON artifacts in this slice.
- No full pagination or field-projection system for arbitrary artifact
  payloads. If a future artifact cannot fit the v1 budget, that future
  domain slice must add a scoped projection plan before shipping.

## Current Baseline

- Repository: `/Users/Zhuanz/Documents/streetlight-reaper-mcp`
- Branch: `main`
- Current local head: `c11b114 first-real-version: slice 20b pack contract foundation`
- Local branch is ahead of `origin/main` by one commit.
- Slice 20B is complete, locally committed, static-green, reviewer-fixed,
  and REAPER live-smoked.
- Default runtime pack remains `core`.
- Fixture pack `pack_contract_fixture` is disabled by default and enabled
  only through `STREETLIGHT_ENABLED_PACKS=core,pack_contract_fixture` on
  the MCP side plus `_G.STREETLIGHT_ENABLED_PACKS =
  "core,pack_contract_fixture"` on the REAPER side.
- Current core template count is 12. Fixture-enabled count is 13.
- Existing core entity kinds are `item`, `track`, `region`, and `render`.
- `render_region` currently:
  - has `risk:"filesystem"`;
  - has `mutates:true`, `undoable:false`, and no `expectedDelta`;
  - returns an absolute WAV path in `changed_ids`;
  - routes that path into `LAST_RESULT.renders`;
  - has no `last_result:render:N` resolver.
- `get_state` currently implements `project`, `selection`, `tracks`, and
  `regions`; `render` is reserved and returns `SCOPE_NOT_IMPLEMENTED`.
- `call_template` success is locked to:

  ```json
  {
    "template": "name",
    "changed_count": 1,
    "changed_ids": ["guid:{...}"],
    "truncated": false
  }
  ```

## Primary Contract

### 1. Artifact v1 Contract

An OpenReaper artifact is a persisted JSON record produced by a template
and read back through `get_state`.

Artifact v1 is for OpenReaper-owned metadata, plans, analysis summaries,
reports, and fixture probes. It is not for executable code, arbitrary user
files, plugin bundles, rendered WAVs, MIDI files, marketplace packages, or
unsafe scripts.

Recommended G7A model for Slice 21:

- Artifact-producing templates return artifact refs in `changed_ids`.
- `changed_count` counts artifact refs. One produced artifact means
  `changed_count: 1`.
- `changed_ids` remains capped at 50 by the existing envelope logic.
- The success envelope gains no new fields.
- Artifact details are stored under the OpenReaper state directory.
- Artifact details are read through `get_state({ scope:"artifact", ... })`.
- Artifact-producing templates do not update or clear item, track, or
  region `LAST_RESULT`.
- Slice 21 does not add a public `last_result:artifact:N` resolver.
- Slice 21 does not add an artifact `LAST_RESULT` chaining contract. The
  returned artifact ref is the immediate handle.

This is G7A model 2 with one explicit legacy exception: existing
`render_region` keeps its current `LAST_RESULT.renders` behavior.

Artifact JSON v1 shape:

```json
{
  "artifact_contract": "openreaper.artifact.v1",
  "ref": "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd",
  "id": "art_20260701010101999_000_ab12cd",
  "scope": "probe",
  "owner_pack": "pack_contract_fixture",
  "producer_template": "fixture_artifact_probe",
  "schema": "openreaper.fixture.probe.v1",
  "created_at": "2026-07-01T01:01:01.999Z",
  "summary": {
    "label": "S21 artifact smoke"
  },
  "payload": {
    "label": "S21 artifact smoke",
    "note": "fixture-only payload"
  }
}
```

Required fields:

- `artifact_contract`: exactly `openreaper.artifact.v1`.
- `ref`: canonical artifact ref.
- `id`: opaque id, not a path.
- `scope`: lower_snake artifact scope.
- `owner_pack`: pack id that produced the artifact.
- `producer_template`: template name that produced the artifact.
- `schema`: artifact payload schema id.
- `created_at`: ISO-8601 UTC timestamp.
- `summary`: small object safe for default readback.
- `payload`: schema-owned object. It must still be JSON, bounded, and
  response-budget checked before returning over MCP.

Optional future fields, not required in Slice 21:

- `project_fingerprint`
- `source_refs`
- `inputs_hash`
- `expires_at`
- `parent_artifact_refs`
- `apply_template`

### 2. Artifact Naming

#### Ref Grammar

Use one pack-qualified grammar for all new JSON artifacts:

```text
artifact:<owner_pack>:<scope>:<id>
```

Where:

- `owner_pack` matches the Slice 20B pack id grammar:
  `^[a-z][a-z0-9_]*$`
- `scope` matches:
  `^[a-z][a-z0-9_]*$`
- `id` matches:
  `^art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$`

Example refs:

- `artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd`
- `artifact:cleanup:plan:art_20260701010200999_000_8f10aa`
- `artifact:cleanup:report:art_20260701010300999_000_3100bc`
- `artifact:core:analysis:art_20260701010400999_000_cafe00`

Why not `analysis:<id>` / `plan:<id>` / `report:<kind>:<id>` in Slice 21:

- G7A allows "another grammar."
- Pack-qualified refs make G13 ownership visible without another lookup.
- A single grammar keeps parsing, path derivation, tests, docs, and error
  behavior smaller.
- Domain-specific aliases can be added later only if a future slice proves
  they improve usability enough to justify the extra surface.

#### Id Generation

Artifact ids should be derived from the queue command id so one bridge
command gets a stable, unique artifact id without adding a second random
source:

- command id:
  `cmd_YYYYMMDDHHMMSSmmm_NNN_xxxxxx`
- artifact id:
  `art_YYYYMMDDHHMMSSmmm_NNN_xxxxxx`

If a future template must produce more than one artifact, that future slice
must extend the id contract with an indexed suffix. Slice 21 only needs one
artifact per artifact-producing template call.

#### Scope Naming

Artifact scopes are lower_snake nouns. They describe the artifact family,
not the exact template:

- `probe`: fixture-only smoke artifacts.
- `analysis`: future audio/project analysis summaries.
- `plan`: future reviewable plans, such as cleanup plans.
- `report`: future result reports, such as cleanup or loop QA reports.

Scope collision rule:

- The tuple `(owner_pack, scope)` is the v1 ownership boundary.
- `core` reserves the generic scope names `analysis`, `plan`, and
  `report` as contract categories, but domain packs may produce refs under
  their own pack id, e.g. `artifact:cleanup:plan:<id>`.
- A non-core pack must not claim another pack id in refs or artifact JSON.
- A template's TS descriptor, Lua manifest entry, and artifact JSON must
  agree on `owner_pack` and `scope`.

#### Storage Path

Artifact files live under the OpenReaper state directory:

```text
<state_root>/artifacts/v1/<owner_pack>/<scope>/<id>.json
```

Default state root:

- Derive it from the queue directory's parent.
- If `QUEUE_DIR` is
  `~/Library/Application Support/Streetlight/queue`, then state root is
  `~/Library/Application Support/Streetlight`.
- Artifact root is therefore
  `~/Library/Application Support/Streetlight/artifacts/v1`.

Examples:

```text
~/Library/Application Support/Streetlight/artifacts/v1/pack_contract_fixture/probe/art_20260701010101999_000_ab12cd.json
~/Library/Application Support/Streetlight/artifacts/v1/cleanup/plan/art_20260701010200999_000_8f10aa.json
```

The artifact ref never contains an absolute path. The bridge builds the
path from parsed ref segments only. Ref segments must never be concatenated
from unchecked user strings.

### 3. Locked `call_template` Envelope

The locked success envelope stays pure.

Allowed artifact-producing success:

```json
{
  "template": "fixture_artifact_probe",
  "changed_count": 1,
  "changed_ids": [
    "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd"
  ],
  "truncated": false
}
```

Forbidden success shapes:

```json
{
  "template": "fixture_artifact_probe",
  "changed_count": 1,
  "changed_ids": ["artifact:..."],
  "artifact": { "payload": "..." },
  "summary": "...",
  "path": "/Users/..."
}
```

Rules:

- Handlers still return only `{ changed_ids = { ... } }`.
- If an artifact helper writes metadata, it does that before returning the
  changed id.
- The dispatcher still builds the envelope.
- Any extra handler-return fields remain ignored by the dispatcher.
- Artifact write failure is a typed error before success, not a partial
  success envelope.
- Persisted artifact producers use `risk:"filesystem"` even when
  `mutates:false` for REAPER project state.
- Artifact producers omit `expectedDelta` unless they also mutate REAPER
  project state in a future explicitly planned slice.

### 4. `changed_ids` Allowlist

After Slice 21, successful `call_template.changed_ids[]` may contain only:

1. Existing project entity refs:
   - `guid:{...}` for item or track refs.
   - `region:NAME` for region refs.
   - `track:Name` only for legacy/name-shaped track references already
     documented.
2. Existing legacy render output path:
   - An absolute WAV path from `render_region` only.
3. New JSON artifact refs:
   - `artifact:<owner_pack>:<scope>:<id>`.

Explicitly forbidden in new templates:

- Absolute JSON artifact paths in `changed_ids`.
- Relative paths in `changed_ids`.
- `file://` URLs.
- `~/...` shell-expanded paths.
- Raw artifact root paths.
- `analysis:<id>`, `plan:<id>`, or `report:<id>` aliases in Slice 21.
- `last_result:artifact:N` in returned `changed_ids`.
- Full JSON objects or descriptors in `changed_ids`.
- Any path outside the `render_region` legacy WAV carve-out.

Review rule:

- If a new template returns an absolute path and it is not `render_region`,
  the slice is wrong unless it first amends this artifact contract.

### 5. `get_state` Artifact Scope

Yes, Slice 21 should add one generic read scope:

```json
{
  "scope": "artifact",
  "artifact_ref": "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd",
  "view": "summary"
}
```

Do not add `analysis`, `plan`, or `report` as separate `get_state` scopes in
Slice 21. Those can become convenience aliases only after real domain
artifacts exist.

Minimal input shape:

- `scope`: `"artifact"`
- `artifact_ref`: required when `scope == "artifact"`
- `view`: optional; default `"summary"`
  - `"summary"` returns metadata plus the artifact's `summary`.
  - `"payload"` returns metadata plus `summary` and `payload`, if the
    encoded response fits the response budget.

`limit` remains accepted by the existing `get_state` schema but is ignored
for single-artifact reads. Do not introduce cursor/fields in Slice 21.

Minimal summary output:

```json
{
  "artifact": {
    "ref": "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd",
    "id": "art_20260701010101999_000_ab12cd",
    "scope": "probe",
    "owner_pack": "pack_contract_fixture",
    "producer_template": "fixture_artifact_probe",
    "schema": "openreaper.fixture.probe.v1",
    "created_at": "2026-07-01T01:01:01.999Z",
    "summary": {
      "label": "S21 artifact smoke"
    },
    "view": "summary",
    "truncated": false,
    "response_bytes": 512
  }
}
```

Payload output:

```json
{
  "artifact": {
    "ref": "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd",
    "id": "art_20260701010101999_000_ab12cd",
    "scope": "probe",
    "owner_pack": "pack_contract_fixture",
    "producer_template": "fixture_artifact_probe",
    "schema": "openreaper.fixture.probe.v1",
    "created_at": "2026-07-01T01:01:01.999Z",
    "summary": {
      "label": "S21 artifact smoke"
    },
    "payload": {
      "label": "S21 artifact smoke",
      "note": "fixture-only payload"
    },
    "view": "payload",
    "truncated": false,
    "response_bytes": 768
  }
}
```

Response-budget rules:

- The bridge must encode the artifact response before returning it.
- If summary view exceeds `MAX_RESPONSE_BYTES`, return
  `RESPONSE_TOO_LARGE`.
- If payload view exceeds `MAX_RESPONSE_BYTES`, return
  `RESPONSE_TOO_LARGE`; do not truncate inside arbitrary JSON.
- `truncated` is always `false` in Slice 21 artifact reads because there
  is no paging or partial projection yet. Oversize is an error.
- Future large artifacts need a separate projection/paging slice before
  they ship.

Read errors:

- Malformed `artifact_ref`: `PARAMS_INVALID`.
- Ref path does not exist, or was removed by TTL cleanup:
  `ARTIFACT_NOT_FOUND`.
- JSON cannot be decoded or required v1 fields are missing:
  `ARTIFACT_INVALID`.
- Scope exists but no artifact support was compiled in: not applicable
  after Slice 21. Do not use `SCOPE_NOT_IMPLEMENTED` for a valid
  artifact ref that simply is not found.

Read path invariant:

- `get_state(scope:"artifact")` must not touch `LAST_RESULT`.

### 6. Artifact Root Directory And Cleanup Strategy

Artifact root:

```text
<dirname(QUEUE_DIR)>/artifacts/v1
```

Default macOS path:

```text
~/Library/Application Support/Streetlight/artifacts/v1
```

Rules:

- Create the root lazily on first artifact write, or at bridge startup if
  that keeps the helper simpler.
- Never store artifacts inside the REAPER project folder.
- Never derive artifact paths from project names, region names, track
  names, or user-provided labels.
- Never execute artifact contents.
- JSON only in Slice 21.

Cleanup strategy:

- Implement a best-effort startup sweeper for artifact JSON files under
  `artifacts/v1`.
- Default TTL: 7 days by file mtime.
- Sweep only files ending in `.json` under the expected
  `owner_pack/scope/id.json` depth.
- Leave directories, non-JSON files, symlinks, and unexpected shapes alone
  with a console warning.
- Sweep failure must not stop bridge startup.
- Fresh artifacts must never be deleted during the same bridge session.
- A ref whose file was swept returns `ARTIFACT_NOT_FOUND`.

This is artifact lifecycle management, not the future cleanup pack. Do not
add project cleanup or destructive user-file cleanup in this slice.

### 7. `render_region` Carve-Out

`render_region` remains the existing legacy external-file carve-out.

Do not migrate `render_region` to JSON artifacts in Slice 21.

Required documentation change:

- Replace language that says "`render_region` is the single carve-out" with
  a more precise rule:
  - `render_region` is the only template allowed to return an absolute
    external file path in `changed_ids`.
  - JSON artifacts use `artifact:<owner_pack>:<scope>:<id>` refs instead.

Behavior to preserve:

- `render_region.changed_ids[0]` is still the absolute WAV path.
- `changed_count` remains `1` on success.
- `truncated` remains `false` for one render.
- `render_region` still does not declare `expectedDelta`.
- `render_region` still uses the deferred terminal envelope.
- `render_region` still routes to `LAST_RESULT.renders`.
- There is still no `last_result:render:N` resolver in Slice 21.
- Existing sidecar preflight and guarded cleanup behavior remains
  unchanged.

New rule:

- Future render analysis, loop QA, delivery reports, and cleanup reports
  must not copy the absolute-path carve-out. They must return artifact refs
  and use `get_state(scope:"artifact")` for JSON details.

### 8. Discovery Metadata

#### `list_templates`

Yes, `list_templates` should expose compact artifact metadata for templates
that produce artifacts.

Add an optional metadata field such as:

```json
{
  "artifact": {
    "kind": "json",
    "scope": "probe",
    "ref_prefix": "artifact:pack_contract_fixture:probe:",
    "read_scope": "artifact",
    "updates_last_result": false,
    "schema": "openreaper.fixture.probe.v1"
  }
}
```

For `render_region`, use a small legacy metadata shape if the type change
stays local:

```json
{
  "artifact": {
    "kind": "external_file",
    "path_shape": "absolute_wav_path",
    "read_scope": null,
    "updates_last_result": true,
    "legacy_carve_out": true
  }
}
```

If adding render metadata makes the implementation noisy, defer the
`render_region` metadata but still update docs and tests so the contract is
clear. The fixture JSON artifact metadata is required.

Do not include full artifact schemas or payload examples in
`list_templates`. The response-budget story for template listing is already
heavy; keep artifact discovery compact.

#### `list_recipes`

No required `list_recipes` schema change in Slice 21.

Rationale:

- Recipe artifact metadata belongs to the later recipe contract phase.
- `list_recipes` already passthrough-preserves top-level YAML fields, so a
  fixture recipe may include prose-only `artifacts_produced` if useful, but
  Slice 21 should not lock a recipe artifact schema.
- Do not add recipe execution, recipe assertions, approval gates, or
  artifact read steps in this slice.

### 9. Fixture Artifact Template And Fixture Pack

Yes, Slice 21 should use a fixture artifact producer.

Use the existing disabled-by-default `pack_contract_fixture` pack. Do not
create a cleanup, loop, analysis, MIDI, or marketplace pack in this slice.

Recommended fixture template:

```text
fixture_artifact_probe
```

Contract:

- Pack: `pack_contract_fixture`.
- Risk: `filesystem`.
- Mutates REAPER project state: `false`.
- Undoable: `false`.
- Entity kind: `artifact`, as a new core-reserved entity kind.
- Artifact metadata:
  - `kind:"json"`
  - `scope:"probe"`
  - `schema:"openreaper.fixture.probe.v1"`
  - `updates_last_result:false`
- Params:

  ```json
  {
    "label": "S21 artifact smoke"
  }
  ```

- Behavior:
  - writes one tiny JSON artifact under the artifact root;
  - returns one `artifact:pack_contract_fixture:probe:<id>` ref;
  - does not touch project state;
  - does not clear or rewrite item, track, or region `LAST_RESULT`.

The fixture exists only to prove the contract:

- pack-owned artifact producer;
- artifact ref in locked envelope;
- `get_state` readback;
- no project `LAST_RESULT` pollution;
- missing artifact typed error;
- TTL root safety.

## Files Likely Touched

Core TS:

- `packages/core/src/types.ts`
- `packages/core/src/registry.ts`
- `packages/core/src/errors.ts`
- New `packages/core/src/artifacts.ts` for ref parsing/path-safe helpers.
- `packages/core/src/index.ts`
- `packages/core/src/__tests__/artifacts.test.ts`
- `packages/core/src/__tests__/registry.test.ts`

MCP server:

- `packages/mcp-server/src/tools/get-state.ts`
- `packages/mcp-server/src/tools/__tests__/get-state.test.ts`
- `packages/mcp-server/src/tools/list-templates.ts` only if result types
  need no code change beyond registry metadata.
- `packages/mcp-server/src/tools/__tests__/list-templates.test.ts`
- `packages/mcp-server/src/tools/__tests__/call-template.test.ts` or a
  focused fixture artifact test.
- `packages/mcp-server/src/packs/pack-contract-fixture/index.ts`
- New `packages/mcp-server/src/packs/pack-contract-fixture/fixture-artifact-probe.ts`

Scripts:

- `scripts/manifest-alignment.mjs`
- `scripts/__tests__/manifest-alignment.test.mjs`
- `scripts/template-authoring-lint.mjs` if fixture file discovery needs
  adjustment.
- `scripts/__tests__/template-authoring-lint.test.mjs`
- `scripts/__tests__/lua-structure.test.mjs`

Lua:

- `reaper/streetlight_bridge.lua`
- `reaper/packs/core/manifest.lua`
- New `reaper/packs/core/lib/artifacts.lua`
- Possibly `reaper/packs/core/lib/entity_buckets.lua` if the new
  `artifact` entity kind needs core reservation.
- `reaper/packs/core/lib/pack_loader.lua` if non-core reuse of the new
  core-reserved `artifact` kind needs validation changes.
- `reaper/packs/pack_contract_fixture/manifest.lua`
- New `reaper/packs/pack_contract_fixture/templates/artifact.lua`

Docs:

- `docs/TEMPLATE_SPEC.md`
- `docs/TEMPLATE_AUTHORING.md`
- `docs/RESPONSE_BUDGET.md`
- `docs/HANDOFF.md`
- `docs/PROGRESS.md`
- `docs/NEXT_WINDOW_BRIEFING.md`
- `docs/packs/pack_contract_fixture/README.md`
- This plan file

Do not touch:

- `docs/PUBLIC_STORY.md` unless the user explicitly wants a public
  foundation note. This slice ships no user-facing creative capability.
- Any cleanup / loop / MIDI / unsafe pack.
- MCP tool count.

## Implementation Steps

1. Add TS artifact helper types.
   - Ref parser for `artifact:<owner_pack>:<scope>:<id>`.
   - Id grammar validation.
   - Path segment validation helpers.
   - Unit tests for valid and invalid refs.
2. Add artifact error codes.
   - `ARTIFACT_NOT_FOUND`.
   - `ARTIFACT_INVALID`.
   - Regenerate Lua error constants through the existing error-code flow.
3. Extend `CapabilityDefinition` / metadata with optional artifact
   descriptor.
   - Validate artifact scope grammar.
   - Validate schema id is present.
   - Validate JSON artifact producers are `risk:"filesystem"`,
     `undoable:false`, and no `expectedDelta`.
   - Add compact metadata to `list_templates`.
4. Add `artifact` as a core-reserved entity kind.
   - It exists for metadata/manifest alignment.
   - It does not create a public `last_result:artifact:N` resolver in
     Slice 21.
5. Add Lua artifact helper under `reaper/packs/core/lib/artifacts.lua`.
   - Derive state root from `QUEUE_DIR`.
   - Build artifact root.
   - Parse refs.
   - Build safe paths from parsed segments.
   - Write JSON artifact files atomically.
   - Read and validate artifact JSON.
   - Enforce response byte cap for readback.
   - Sweep old JSON artifacts at bridge startup.
6. Thread artifact context into template handlers.
   - Handler ctx gains `artifacts` helper.
   - Handler ctx gains command/template identity needed to derive id and
     owner pack.
   - Do not expose arbitrary filesystem helpers.
7. Add artifact finalization semantics to the bridge.
   - If a manifest entry declares JSON artifact output, normal envelope
     building still happens.
   - Do not clear or update item, track, or region `LAST_RESULT`.
   - Do not add `last_result:artifact:N` in Slice 21.
   - Existing non-artifact templates keep current cross-bucket clear.
   - Existing `render_region` keeps current `LAST_RESULT.renders`.
8. Add `get_state(scope:"artifact")`.
   - TS validates `artifact_ref` and `view`.
   - Lua validates the same shape defensively.
   - Summary and payload views return bounded JSON.
   - Missing/corrupt artifacts return typed errors.
   - Read path does not touch `LAST_RESULT`.
9. Extend manifest alignment.
   - TS artifact metadata and Lua manifest artifact metadata must agree.
   - Non-core packs may reuse the core-reserved `artifact` entity kind.
   - Non-core packs still may not introduce arbitrary new entity kinds.
10. Add fixture artifact template in `pack_contract_fixture`.
    - Disabled by default.
    - Fixture-enabled static tests prove registration and metadata.
11. Update docs.
    - Replace "render_region is the single carve-out" with the new
      allowlist wording.
    - Document artifact refs, root, TTL, and readback.
    - Keep non-goals explicit.
12. Run static gates.
13. Run REAPER live smoke because runtime Lua, bridge finalization,
    get_state scope, error codes, fixture manifest, and filesystem
    behavior changed.

## Static Tests

Required baseline gates:

```bash
npm run build
npm test
npm run check:manifest
npm run check:error-codes-fresh
npm run check:template-authoring
git diff --check
```

Fixture-enabled gates:

```bash
STREETLIGHT_ENABLED_PACKS=core,pack_contract_fixture npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,pack_contract_fixture npm run check:template-authoring
```

Specific test cases to add:

1. Artifact ref parser:
   - accepts `artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd`;
   - accepts future-looking `artifact:cleanup:plan:<id>`;
   - rejects missing segments;
   - rejects invalid pack ids;
   - rejects invalid scopes;
   - rejects invalid ids;
   - rejects `..`, `/`, `\`, NUL, spaces, `~`, and absolute paths.
2. Artifact path builder:
   - maps ref segments to
     `<state_root>/artifacts/v1/<owner_pack>/<scope>/<id>.json`;
   - never uses raw ref text as a path;
   - rejects path traversal shapes.
3. Registry metadata:
   - fixture artifact template exposes compact artifact metadata;
   - JSON artifact producer must be `risk:"filesystem"`;
   - JSON artifact producer must be `undoable:false`;
   - JSON artifact producer must omit `expectedDelta`;
   - malformed artifact metadata fails registry validation.
4. `list_templates`:
   - core-only default still returns 12 templates and fixture absent;
   - fixture-enabled mode returns fixture artifact metadata;
   - existing core metadata remains stable;
   - `render_region` is still filesystem/non-undoable/no expectedDelta.
5. `call_template` fake-bridge:
   - fixture artifact call returns the locked envelope;
   - `changed_count=1`;
   - `changed_ids[0]` is an artifact ref;
   - no `artifact`, `payload`, `summary`, or `path` fields appear in the
     success result.
6. `get_state` TS validation:
   - `scope:"artifact"` requires `artifact_ref`;
   - malformed artifact refs return `PARAMS_INVALID` without queue write;
   - `view` defaults to `summary`;
   - invalid `view` returns `PARAMS_INVALID`;
   - non-artifact scopes are not forced to provide `artifact_ref`.
7. `get_state` result tests:
   - summary view parses expected metadata and summary;
   - payload view parses payload;
   - bridge `ARTIFACT_NOT_FOUND` surfaces unchanged;
   - bridge `ARTIFACT_INVALID` surfaces unchanged;
   - bridge `RESPONSE_TOO_LARGE` surfaces unchanged.
8. Manifest alignment:
   - core-only passes;
   - core+fixture passes;
   - TS artifact scope mismatch vs Lua manifest fails;
   - TS schema id mismatch vs Lua manifest fails;
   - non-core pack can reuse `artifact`;
   - non-core pack still cannot invent unrelated entity kinds.
9. Lua structure:
   - bridge loads `artifacts.lua`;
   - artifact root is derived from `QUEUE_DIR` parent;
   - artifact write uses atomic temp+rename shape;
   - artifact read path does not update `LAST_RESULT`;
   - artifact finalization branch does not clear item/track/region buckets;
   - artifact startup sweep only targets `.json` under artifact root;
   - no runtime Lua string literals for new error codes.
10. Existing regressions:
    - `track_create` / `track_rename` `last_result:track:0` behavior
      still passes;
    - `region_create` -> `render_region last_result:region:0` still
      passes;
    - `render_region` absolute path envelope tests still pass;
    - idempotency replay tests still pass;
    - list-recipes pack ownership tests still pass;
    - risk policy still blocks `destructive` and `unsafe_eval`.

## REAPER Live Smoke Recipe

Required because Slice 21 changes runtime Lua, bridge finalization,
get_state scope handling, error codes, manifest metadata, and artifact
filesystem behavior.

Preconditions:

1. Run static gates first.
2. Fully quit REAPER.
3. Reopen REAPER.
4. Load the bridge with fixture pack enabled:

   ```lua
   _G.STREETLIGHT_ENABLED_PACKS = "core,pack_contract_fixture"
   dofile("/Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/streetlight_bridge.lua")
   ```

5. Console must show:
   - `bridge starting (generation 1)`
   - `loaded error_codes (...)`
   - `loaded pack 'core' v0.1.0`
   - `loaded pack 'pack_contract_fixture' v0.1.0`
   - ready line including `fixture_artifact_probe`

Smoke:

1. `ping` -> connected.
2. `list_templates` -> fixture-enabled template list includes:
   - `fixture_track_rename`;
   - `fixture_artifact_probe`;
   - `fixture_artifact_probe.pack == "pack_contract_fixture"`;
   - `fixture_artifact_probe.artifact.scope == "probe"`;
   - `fixture_artifact_probe.artifact.read_scope == "artifact"`;
   - `fixture_artifact_probe.artifact.updates_last_result == false`.
3. Create a project-state anchor:

   ```json
   {
     "name": "track_create",
     "params": {
       "name": "S21 Artifact Anchor <stamp>",
       "reuse_existing": true
     }
   }
   ```

   Expect locked envelope with one track GUID.

4. Optionally color the anchor with `track_color` to prove normal core
   mutation still works.
5. Produce a fixture artifact:

   ```json
   {
     "name": "fixture_artifact_probe",
     "params": {
       "label": "S21 artifact smoke <stamp>"
     }
   }
   ```

   Expect:

   - locked envelope only;
   - `changed_count == 1`;
   - `changed_ids[0]` matches
     `artifact:pack_contract_fixture:probe:art_...`;
   - no payload fields in the envelope.

6. Read summary:

   ```json
   {
     "scope": "artifact",
     "artifact_ref": "<ref from step 5>"
   }
   ```

   Expect:

   - `artifact.ref` equals the ref;
   - `owner_pack == "pack_contract_fixture"`;
   - `scope == "probe"`;
   - `schema == "openreaper.fixture.probe.v1"`;
   - summary includes the smoke label;
   - no `payload` in summary view;
   - `response_bytes <= 65536`.

7. Read payload:

   ```json
   {
     "scope": "artifact",
     "artifact_ref": "<ref from step 5>",
     "view": "payload"
   }
   ```

   Expect payload includes the smoke label and still fits the response
   budget.

8. Prove project `LAST_RESULT` was not polluted:

   ```json
   {
     "name": "track_rename",
     "params": {
       "track_id": "last_result:track:0",
       "name": "S21 Artifact Anchor Renamed <stamp>"
     }
   }
   ```

   Expect success against the original anchor track GUID. If this returns
   `REF_INVALID` saying no changed tracks exist, artifact finalization
   incorrectly cleared project `LAST_RESULT`.

9. Negative missing artifact:

   ```json
   {
     "scope": "artifact",
     "artifact_ref": "artifact:pack_contract_fixture:probe:art_20000101000000000_000_deadbe"
   }
   ```

   Expect `ARTIFACT_NOT_FOUND`, not `INTERNAL_ERROR`.

10. Negative malformed ref:

    ```json
    {
      "scope": "artifact",
      "artifact_ref": "../bad"
    }
    ```

    Expect `PARAMS_INVALID`, ideally before queue write on the MCP side.

11. `render_region` regression:
    - Create or reuse a small region.
    - Call `render_region` to a temp output directory.
    - Expect `changed_ids[0]` is still an absolute WAV path.
    - Confirm the WAV exists and no `.RPP` / `.RPP-bak` sidecars remain.
    - Do not expect `artifact:` ref from `render_region`.

12. Queue cleanup:
    - `pending=0`
    - `running=0`
    - `done=0`
    - `bridge_owner` may remain.

TTL smoke:

If implementation exposes no test-only TTL knob, run this as a focused
filesystem preflight before bridge startup:

1. Create a valid-looking old JSON fixture file under:

   ```text
   ~/Library/Application Support/Streetlight/artifacts/v1/pack_contract_fixture/probe/art_20000101000000000_000_deadbe.json
   ```

2. Set its mtime older than 7 days.
3. Start the bridge.
4. Confirm `get_state(scope:"artifact", artifact_ref:
   "artifact:pack_contract_fixture:probe:art_20000101000000000_000_deadbe")`
   returns `ARTIFACT_NOT_FOUND`.
5. Confirm the fresh artifact created in the main smoke still reads.

Optional default-pack smoke:

1. Full quit/reopen REAPER.
2. Load bridge without fixture pack override.
3. `list_templates` -> fixture artifact template absent.
4. `call_template fixture_artifact_probe` -> `TEMPLATE_NOT_FOUND` before
   bridge runtime.

## User Decisions

Recommended choices are conservative.

- S21-D1: G7A model.
  - Recommendation: artifact refs in `changed_ids`, no item/track/region
    `LAST_RESULT` update, no public `last_result:artifact:N` in Slice 21.
- S21-D2: Artifact ref grammar.
  - Recommendation: `artifact:<owner_pack>:<scope>:<id>`.
- S21-D3: Artifact id source.
  - Recommendation: derive `art_...` from the queue command id.
- S21-D4: Artifact root.
  - Recommendation: `<dirname(QUEUE_DIR)>/artifacts/v1`.
- S21-D5: Artifact TTL.
  - Recommendation: startup best-effort sweep of `.json` artifacts older
    than 7 days.
- S21-D6: `get_state` read shape.
  - Recommendation: one generic `scope:"artifact"` with `artifact_ref` and
    `view:"summary" | "payload"`.
- S21-D7: Artifact read projection.
  - Recommendation: no `fields` or `cursor` in Slice 21; oversize payloads
    return `RESPONSE_TOO_LARGE`.
- S21-D8: `render_region`.
  - Recommendation: preserve existing absolute-WAV-path behavior and mark it
    as the only external-file path carve-out.
- S21-D9: Discovery metadata.
  - Recommendation: add compact `artifact` metadata to `list_templates`;
    defer official `list_recipes` artifact metadata to the recipe contract
    phase.
- S21-D10: Fixture strategy.
  - Recommendation: extend disabled-by-default `pack_contract_fixture` with
    `fixture_artifact_probe`.
- S21-D11: Error codes.
  - Recommendation: add `ARTIFACT_NOT_FOUND` and `ARTIFACT_INVALID`.

## Risks

- Artifact refs accidentally encode paths, creating path traversal or
  user-folder coupling.
- Artifact-producing templates clear `LAST_RESULT` and break multi-step
  recipes that anchor an item/track/region before generating a report.
- Preserving prior project `LAST_RESULT` after an artifact-producing
  template may surprise readers who interpret `last_result` as "latest
  template of any kind." The plan intentionally scopes it as latest
  project-entity mutation for artifact producers.
- Response budget can be violated if payload view returns large arrays
  without a byte check.
- TTL sweep can delete user files if it is not constrained to artifact
  root, `.json`, and expected directory depth.
- Idempotency replay can return an artifact ref whose file was later swept.
  That read must fail as `ARTIFACT_NOT_FOUND`, not `INTERNAL_ERROR`.
- TS and Lua artifact metadata can drift, especially owner pack and scope.
- Non-core fixture reuse of `entity_kind:"artifact"` can accidentally reopen
  the Slice 20B ban on arbitrary non-core entity kinds unless validation is
  narrow.
- `render_region` regressions are easy because docs currently call it the
  single artifact-path carve-out. Tests must preserve the exact legacy
  behavior while adding JSON artifact refs.
- `list_templates` can grow too large if artifact metadata includes full
  schemas or payload examples.

## Regression Points

- Five MCP tools only. No sixth tool.
- `call_template` success envelope unchanged.
- `changed_ids` cap and `changed_count` semantics unchanged.
- Existing project refs unchanged:
  `guid:{...}`, `region:NAME`, `track:Name`.
- `render_region` still returns an absolute WAV path, not an artifact ref.
- `render_region` sidecar suppression still passes.
- `render_region` idempotency replay still returns the stored path.
- Read paths still do not touch `LAST_RESULT`.
- Artifact read path does not touch `LAST_RESULT`.
- Artifact-producing fixture does not clear existing track `LAST_RESULT`.
- Default core-only pack mode hides fixture templates.
- Fixture-enabled pack mode remains explicit and deterministic.
- `list_recipes` existing core and fixture recipe ownership remains stable.
- `unsafe_eval` remains default-off and unused.
- `destructive` risk remains blocked by default.
- Error-code freshness remains green after adding artifact codes.
- `PUBLIC_STORY.md` does not overclaim a user-facing feature.

## Reviewer Checklist For This Slice

Before implementation is accepted, reviewer should confirm:

- The slice cites Phase 1 and G3/G7A/G13/G15.
- It advances one primary contract: artifact foundation.
- It does not add cleanup, loop, analysis algorithms, MIDI, marketplace,
  dynamic install, unsafe execution, or recipe execution.
- It does not add MCP tools.
- It preserves the locked `call_template` success envelope.
- Artifact refs are path-safe and pack-qualified.
- New artifact JSON refs are not absolute paths.
- `render_region` remains the only absolute-path `changed_ids` carve-out.
- Artifact-producing templates are `risk:"filesystem"` and omit
  `expectedDelta` unless a later slice explicitly plans project mutation.
- Artifact-producing templates do not update or clear item/track/region
  `LAST_RESULT`.
- `get_state(scope:"artifact")` is bounded by response budget.
- Missing and corrupt artifacts use typed errors.
- TTL cleanup cannot delete files outside the artifact root.
- Pack ownership is explicit in artifact refs and `list_templates`
  metadata.
- Static tests cover parser, metadata, get_state, finalization, fixture,
  manifest alignment, and render regression.
- Live smoke proves readback and `LAST_RESULT` isolation.
- Status docs are updated after implementation.

## Exit Criteria

Slice 21 is complete only when:

- The artifact v1 contract is documented in `TEMPLATE_SPEC`,
  `TEMPLATE_AUTHORING`, and `RESPONSE_BUDGET`.
- A fixture artifact template can produce one JSON artifact ref through the
  locked `call_template` envelope.
- `get_state(scope:"artifact")` can read the fixture artifact summary and
  payload within the response budget.
- Missing/corrupt artifact reads return typed errors.
- Artifact-producing success does not disturb item/track/region
  `LAST_RESULT`.
- `render_region` still passes its existing absolute-WAV-path contract and
  sidecar checks.
- Default core-only mode is unchanged.
- Fixture-enabled mode is static-green.
- REAPER live smoke passes with queue cleanup.
- No cleanup, loop, analysis, MIDI, marketplace, dynamic install, unsafe
  execution, recipe executor, or MCP-tool expansion is included.

# Streetlight Progress

> **New conversation? Read `docs/HANDOFF.md` first.** It's the short
> dense version of where the project is right now, with the
> live-edge tasks and the decisions a new window needs to know.
> This file is the long-form log; HANDOFF is the briefing.

Short status log. Update at the end of every step. This file is the source of
truth for "where are we" — when the conversation context gets long, read this
first.

## Current Status

**Slice 21 ✅ live-smoked / static-green / commit-ready
(2026-07-01).** Source:
`docs/plans/SLICE_21_ARTIFACT_CONTRACT_ARCHITECT_PLAN.md`. This is
Phase 1 Artifact Contract Foundation from the first-real-version plan:
future cleanup / loop QA / analysis / reports can produce durable,
bounded non-project data without expanding the locked `call_template`
envelope or parking domain code in `core`. User locked D1-D11 to the
recommended values. Current implementation adds artifact ref helpers in
`packages/core/src/artifacts.ts`; new error codes
`ARTIFACT_NOT_FOUND` and `ARTIFACT_INVALID`; registry/list_templates
artifact metadata; `get_state(scope:"artifact", artifact_ref, view)` with
summary/payload views; Lua `reaper/packs/core/lib/artifacts.lua` for
safe path derivation, atomic JSON writes, response-budgeted readback, and
startup TTL sweep; bridge artifact context wiring and JSON-artifact
`LAST_RESULT` skip; manifest alignment for artifact metadata; and a
fixture-pack template `fixture_artifact_probe`. JSON artifact producers
return refs shaped `artifact:<owner_pack>:<scope>:<id>` in
`changed_ids`; they do not update item/track/region `LAST_RESULT`.
Artifact ids are derived from queue command ids and files live under
`<dirname(QUEUE_DIR)>/artifacts/v1`. `render_region` remains the legacy
external-file carve-out: absolute WAV path in `changed_ids`, still routed
to `LAST_RESULT.renders`, not migrated to JSON artifacts in this slice.
Static gates are green: `npm test` **403/403**, `npm run build` clean,
`npm run check:error-codes-fresh` 24 codes fresh, default
`npm run check:manifest` → 12 templates across 1 pack,
fixture-enabled `check:manifest` → 14 templates across 2 packs, default
`npm run check:template-authoring` → 12 templates,
fixture-enabled `check:template-authoring` → 14 templates, and
`git diff --check` clean. Reviewer follow-up is closed: artifact reads
require `payload` and return `ARTIFACT_INVALID` if it is missing;
startup TTL sweep uses file mtime, not artifact-id time; direct queue
calls that send `artifact_ref` / `view` on non-artifact scopes now
return `PARAMS_INVALID` before reserved-scope dispatch. Live smoke
passed on REAPER `7.71/macOS-arm64` with fixture pack enabled after a
full quit/reopen. Ready line showed 24 error codes, core 12 templates,
fixture 2 templates, and `fixture_artifact_probe`. Smoke stamp:
`slice21-1782891483364`; anchor track GUID:
`guid:{C5E18394-48F2-DB4F-89D2-AD9CDFAF8A9D}`; artifact ref:
`artifact:pack_contract_fixture:probe:art_20260701073804406_003_ff08e3`.
Summary view returned metadata + summary and no payload; payload view
returned the fixture payload; artifact creation did not pollute
`LAST_RESULT` (`track_rename last_result:track:0` still hit the anchor
track); `ARTIFACT_NOT_FOUND`, malformed-ref `PARAMS_INVALID`, and direct
queue artifact-param `PARAMS_INVALID` regressions passed. `render_region`
remained the legacy absolute WAV path carve-out and produced
`/var/folders/.../streetlight-s21-render-ml5vxC/s21_render_slice21_1782891483364.wav`
with zero `.RPP` sidecars; temp render dir was removed; queue ended
`pending=0`, `running=0`, `done=0`. Do not commit or push until the user
explicitly asks.

**Slice 20B ✅ live-smoked / locally committed at `c11b114`
(2026-07-01).** Phase 0.5 Pack Contract Foundation landed before Slice
21. It added pack-id parsing, `registerEnabledTemplates`, pack-aware MCP
startup/list_recipes/static gates, Lua `pack_loader.lua`, bridge
multi-pack loading, and the disabled-by-default `pack_contract_fixture`.
Static gates were green at 376/376 tests; live smoke passed on REAPER
`7.71/macOS-arm64` with fixture-enabled 13 templates, fixture recipe
ownership, cross-pack `LAST_RESULT.tracks` routing, typed
`TRACK_NOT_FOUND`, core-only fixture absence, and clean queue teardown.

**Kernel hardening Slice 19 ✅ live-smoked / static-green /
committed and pushed at `e54fd9c` (2026-07-01), with docs sync at
`7bbd426`.** Architect packet came from the current
conversation; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 19 is the **H6
closure slice**: use the Slice 18 scaffolder flow to land the first real
low-risk template, `track_color`. The template accepts
`{ track_id, color }` where `color` is uppercase `#RRGGBB` or `null`;
`null` clears the custom color and `#000000` remains black. Runtime uses
`SetMediaTrackInfo_Value(track, "I_CUSTOMCOLOR", ColorToNative(r,g,b) |
0x1000000)` and `0` for clear. `verify.lua` adds the narrow synthetic
track field `I_CUSTOMCOLOR_HEX`, mapping disabled/no custom color to
`0` and enabled colors back to uppercase `#RRGGBB`, so the agent-facing
API stays portable instead of exposing REAPER native color integers.
Template count is now 12. Static gates are green: full `npm test`
**357/357** (Slice 18 baseline 348/348 + 8 `track_color` fake-bridge
tests + 1 Lua-structure test), `npm run build` clean,
`npm run check:manifest` 12 templates aligned,
`npm run check:error-codes-fresh` 22 codes fresh,
`npm run check:template-authoring` 12 templates ok, and
`git diff --check` clean. REAPER live smoke passed on
`7.71/macOS-arm64` after full restart: ready line included
`track_color`, smoke stamp `1782840178741`, track GUID
`guid:{016B7CED-64A7-1645-9AE2-E6E1547CA447}`. `track_create` created
the smoke track, `track_color` verified `#2D9CDB`, `#000000`, and
`null`, `track_rename last_result:track:0` hit the same GUID, missing
track returned typed `TRACK_NOT_FOUND`, and queue cleanup ended
`pending=0`, `running=0`, `done=0`. H6's basic loop is now closed:
authoring guide -> lint -> `defineTemplate` -> dry-run scaffolder ->
real template -> static gates -> live REAPER smoke. Post-H6 execution is
now governed by
`docs/plans/OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md`; future
Slice 20+ architect packets should derive scope and verification from
that file. Rolling workflow for Slice 20+: Architect owns large plans;
Codex implements approved packets; Codex pulls reviewer and smoke
subagents; the user handles key decisions and final acceptance; docs move
with every slice so context resets can resume cleanly; local commits
happen only on explicit user ask; pushes happen only on explicit push
ask.

**Kernel hardening Slice 18 ✅ committed/pushed at `88b0edf`
(2026-06-30).** Architect packet lives at
`docs/plans/SLICE_18_ARCHITECT_PLAN.md`; Slice 18 lands **H6 Phase 2**:
a conservative dry-run template scaffolder. New
`scripts/scaffold-template.mjs` plus `npm run scaffold:template`
validate an explicit descriptor and print deterministic TS/Lua/test/
manifest/registry TODO skeletons; they do not write files. Static gates
were green: full `npm test` **348/348**, `npm run build` clean,
`npm run check:manifest` 11 templates aligned,
`npm run check:error-codes-fresh` 22 codes fresh,
`npm run check:template-authoring` 11 templates ok, and
`git diff --check` clean. Per S18-D8=a no REAPER live smoke was
required because nothing bridge-visible changed.

**Kernel hardening Slice 17 ✅ code-done / static-green / local
save-point commit `kernel-hardening: slice 17 define template helper`
(2026-06-30).** Architect packet lives at
`docs/plans/SLICE_17_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 17 lands **H6 Phase
1**: the TS-side `defineTemplate({ ... })` helper in
`packages/mcp-server/src/templates/_shared.ts`. The helper is an
identity function — it returns the exact input definition object and
does not clone, normalize, add defaults, generate result schemas, or
change runtime behavior. Only `item_pitch` and `track_rename` migrate
as low-risk pilots; both keep explicit `callTemplateResultSchema(name)`
constants. Static gates are green: full `npm test` **329/329**,
`npm run build` clean, `npm run check:manifest` 11 templates aligned,
`npm run check:error-codes-fresh` 22 codes fresh,
`npm run check:template-authoring` 11 templates ok, and
`git diff --check` clean. Per S17-D7=a no REAPER live smoke is
required because nothing bridge-visible changed.

**Kernel hardening Slice 16 ✅ code-done / static-green / locally
committed at `0996b5b` with docs-only reviewer follow-up committed at
`45e0193` (2026-06-30).** Architect packet lives at
`docs/plans/SLICE_16_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 16 lands **H6 Phase
0**: the template authoring guide (`docs/TEMPLATE_AUTHORING.md`) and a
new author-side static lint (`scripts/template-authoring-lint.mjs`,
`npm run check:template-authoring`) that enforces two contracts the
reviewer used to catch by eye — (1) every `definition.examples[i].params`
must `parse()` on the template's own Zod schema, (2) the TS file slug
(`<kebab>.ts` under `packages/mcp-server/src/templates/`) must equal
`definition.name.replace(/_/g, "-")` in both directions (no missing
file, no orphan file). Decisions locked by user: S16-D1 through S16-D7
all recommended values (`a`), with two explicit corrections: S16-C1
the new CLI runs `npm run build --silent && node
scripts/template-authoring-lint.mjs` (mirrors `check:manifest`; dist-based
CLI, vitest may import src/ helpers), and S16-C2 `examples[]` is
positive-only — no `@example-invalid` marker — and reverse fixtures live
exclusively in `scripts/__tests__/template-authoring-lint.test.mjs`.
Zero runtime change: no Lua, no bridge, no `expectedDelta` shape, no
error codes, no wire fields, no MCP tools, no new templates. `docs/TEMPLATE_SPEC.md`
gains a one-line pointer to the authoring guide; `docs/plans/KERNEL_HARDENING_PLAN.md`
and `docs/plans/KERNEL_HARDENING_EXECUTION.md` each pick up a Slice 16
note in the H6 section. Static gates are green: full `npm test`
**326/326** (Slice 15 baseline 313/313 + 13 new lint tests),
`npm run build` clean, `npm run check:manifest` 11 templates aligned,
`npm run check:error-codes-fresh` 22 codes fresh,
`npm run check:template-authoring` 11 templates ok, and
`git diff --check` clean. Per S16-D5=a no REAPER live smoke is required:
nothing the bridge can see has changed. Local commit policy unchanged:
Slice 16 is committed locally but not pushed during the work-hours
window. Reviewer Locke then caught doc accuracy issues: the risk list
invented `read_only` and omitted the already-shipped `filesystem`
risk; `check:manifest` was overstated as proving handler symbols and
`entity_buckets` membership; and the new-pack section implied bridge
pack discovery already exists. The follow-up doc fix corrects those
claims and keeps runtime untouched. Follow-up gates so far:
`npm test` 326/326, `npm run build`, `npm run check:manifest`,
`npm run check:error-codes-fresh`, `npm run check:template-authoring`,
and `git diff --check` all green; the follow-up is committed locally at
`45e0193`.

**Kernel hardening Slice 15 ✅ live-smoked / static-green /
locally committed at `39bf940` (2026-06-30).** Architect packet lives at
`docs/plans/SLICE_15_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 15 implements H4
Phase 2: `render_region` is no longer an idempotency carve-out. A
same-key retry of a completed deferred render now replays the stored
terminal inner envelope instead of kicking a second render. The
deferred slot carries `idempotency_key`; terminal `close_with(inner)`
stores successes and typed errors into the shared FIFO DEDUP table
unless the inner error is `INTERNAL_ERROR`. Replay happens before
dispatch, so it does not call the handler, re-enter `DEFERRED`,
re-open render settings, delete sidecars, or update
`LAST_RESULT.renders`. Stale-WAV semantics are explicit: replay returns
the stored path even if the file has since been deleted; a fresh render
attempt needs a fresh key. `render_region.idempotent=false` stays
unchanged because this is transport-level retry safety, not a semantic
template guarantee. Decisions locked by user: S15-D1 through S15-D9
all recommended values (`a`). Static gates are green: focused suite
**74/74**, full `npm test` **313/313**, `npm run build` clean,
`npm run check:manifest` green, `npm run check:error-codes-fresh`
green, and `git diff --check` clean. Reviewer Meitner found no
P1/P2/P3 issues. REAPER live smoke `slice15-1782819968415` passed on
`7.71/macOS-arm64` after the user's full REAPER restart and current
`start_bridge.lua` load; extra LAST_RESULT proof run:
`slice15-lastresult-1782820030902`. The smoke proved synchronous Slice
14 dedup still works, keyed `render_region` replay returns the stored
WAV path without re-rendering, typed render errors replay, same-key
`OUTPUT_FILE_EXISTS` remains locked after conflict removal while a
fresh key can render, and replay does not update `LAST_RESULT.renders`.
Queue cleanup ended `pending=0`, `running=0`, `done=0`; only
`bridge_owner` remained. Bridge-reload-clears-DEDUP was not live-run to
avoid disrupting the user's current generation-1 bridge; DEDUP remains
bridge-lifetime scoped by construction.

**Kernel hardening Slice 14 ✅ live-smoked, committed, and pushed
(2026-06-30, `56c57cb`).** Architect packet lives at
`docs/plans/SLICE_14_ARCHITECT_PLAN.md`. Slice 14 implemented H4
Phase 1 idempotency tokens for synchronous mutating templates:
optional caller-provided `call_template.idempotency_key`, bridge
in-memory FIFO DEDUP cap 256, success + typed-error replay,
`INTERNAL_ERROR` skip, replay without handler/undo/verify/LAST_RESULT
side effects, and read-path carve-out. Reviewer Averroes caught one P1
before live smoke: the public MCP server entrypoint did not expose or
forward `idempotency_key`; that is fixed and guarded by
`scripts/__tests__/mcp-index.test.mjs`. Static gates were green:
focused suite 83/83, full `npm test` 309/309, build / manifest /
error-code / diff-check clean. REAPER live smoke
`slice14-1782815129961` passed on `7.71/macOS-arm64` after the user's
full REAPER restart and current `start_bridge.lua` load; cleanup left
`pending=0`, `running=0`, `done=0` with only `bridge_owner` remaining.

**Kernel hardening Slice 13 ✅ live-smoked, committed, and pushed
(2026-06-30, `f998507`).** Architect packet lives at
`docs/plans/SLICE_13_ARCHITECT_PLAN.md`. Slice 13 expanded
`region_create.expectedDelta.fields[]` from one field to three:
`[name, pos, rgnend]`, and the mid-smoke file-backed `bridge_owner`
guard fixed double launcher ownership across separate ReaScript Lua
states. REAPER re-smoke is green on `7.71/macOS-arm64` with run id
`slice13-1782809548082`.

Mid-smoke blocker found after this code drop: first smoke attempt
`slice13-1782808140769` passed `ping` and `list_templates`, then
stopped at S2b because `track_create` returned a track GUID but the
following `media_import track_id:"last_result:track:0"` reported that
no mutating call had produced tracks. The console showed two identical
`generation 1` ready blocks, confirming a double-owner bridge split
across separate ReaScript Lua states. Fix approved by user: add a
file-backed `bridge_owner` token in the queue dir; the last launcher run
writes the token, and older states self-exit before `process_one` if
their token no longer matches. Re-smoke S2b proved that fix by running
`track_create` → `media_import track_id:"last_result:track:0"` in
sequence: track `guid:{1AFDB38A-6C5E-7E49-B618-33FF483AFBA2}` fed the
import that returned item `guid:{CF9CC998-3614-E243-A15A-7A7F0C078627}`.
The run also verified explicit region bounds `[0,1]` and
`[7.13,13.71]`, item-mode optional bounds skip, raw field mismatch
paths, no `LAST_RESULT` pollution after failed verifies, representative
Slice 07-12 regressions, error-code probes, `get_state` include/region
visibility regressions, and the `render_region` artifact carve-out.
Queue cleanup after the run was `pending=0`, `running=0`, `done=0`.

**Kernel hardening Slice 12 ✅ live-smoked, committed, and pushed
(2026-06-30, `6e4a02f`).** Architect packet lives at
`docs/plans/SLICE_12_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 12 continues H2
field-level verification by adding `region_create`, the first
`region` scope template with `expectedDelta.fields[]`.
`region_create` declares region `name ← params.name`, with no
tolerance, `optional`, or `nullable`. `verify.lua` now parses
name-shaped `region:NAME` changed ids and reads a synthetic region
handle `{index,pos,rgnend,name}`; Slice 12 declares only `name`, while
`pos` / `rgnend` bounds verification is deferred to Slice 13. The name
field is a pipeline proof-of-life, not a new bounds assertion. Decisions
locked by user: D1=a only `region_create`; D2=a name only; D3=a
synthetic region struct; D4=a verify-local region scanner, do not reuse
refs.lua; D5=a strict string equality; D6=a document the pipeline
proof-of-life in `docs/TEMPLATE_SPEC.md`; D7=a document orphan-region
side effects. Static gates are green: focused suite 89/89,
`npm test` 291/291, `npm run build` clean,
`npm run check:manifest` green, and `npm run check:error-codes-fresh`
green. Focused reviewer pass found no P1/P2; its only P3 doc nit
(`docs/TEMPLATE_SPEC.md` stale future-region-ref wording) is fixed.
REAPER live smoke passed on `7.71/macOS-arm64` after the user fully
restarted REAPER and loaded the current bridge. Smoke run id:
`slice12-1782804345538`.

**Kernel hardening Slice 11 ✅ live-smoked, committed, and pushed
(2026-06-30, `f66b2db`).** Architect packet lives at
`docs/plans/SLICE_11_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 11 continues H2
field-level verification by adding `media_import`, the first
`creates:true` + `count:"any"` template with `expectedDelta.fields[]`.
`media_import` declares item `D_POSITION ← params.position`, tolerance
`1e-6`, with no `optional` or `nullable`. D5 is now relaxed for
`creates:true` descriptors whose `count` is either a finite positive
integer or `"any"`; the `"any"` path is explicitly first-item verify
only (`changed_ids[1]`). Static validation still rejects `fields[]`
with `deletes:true`, invalid creates counts, invalid maybeCreates
counts, and any region field scope. No Lua runtime path changed: the
existing Slice 06 `verify.lua` changed-id GUID resolver and item field
reader are reused. Decisions locked by user: D1=a only `media_import`;
D2=a first-item verify only; D3=a only `D_POSITION`; D4=a document the
first-item contract in `docs/TEMPLATE_SPEC.md`; D5=a tolerance `1e-6`;
D6=a failed import may leave an orphan item but must not update
`LAST_RESULT`. Static gates are green: focused suite 82/82,
`npm test` 284/284, `npm run build` clean,
`npm run check:manifest` green, `npm run check:error-codes-fresh`
green, and `git diff --check` clean. Reviewer pass completed with no
P1/P2; two P3 nits were fixed before live smoke. REAPER live smoke
passed on REAPER 7.71/macOS-arm64 with run id
`slice11-202606300552524` after the user restarted REAPER and loaded
the current bridge.

**Kernel hardening Slice 10 ✅ live-smoked, committed, and pushed
(2026-06-30, `2babc5c`).** Architect packet lives at
`docs/plans/SLICE_10_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 10 continues H2
field-level verification by adding `track_create`, the first
`maybeCreates:true` template with `expectedDelta.fields[]`.
`track_create` declares track `P_NAME ← params.name` with no tolerance,
`optional`, or `nullable`. D5 is relaxed for `maybeCreates:true`
descriptors whose `count` is a finite positive integer; static
validation still rejects invalid maybeCreates counts, `deletes:true`,
and any region field scope. No Lua runtime path changed: the existing
Slice 06 `verify.lua` changed-id GUID resolver and track field reader
are reused. Decisions locked by user: D1=a only `track_create`; D2=a
maybeCreates-only; D3=a only `P_NAME`; D4=a reuse path still runs field
verification; D5=a no tolerance for string `P_NAME`; D6=a failed create
may leave an orphan track but must not update `LAST_RESULT`. Static
gates are green: `npm test` 278/278, `npm run build` clean,
`npm run check:manifest` green, `npm run check:error-codes-fresh`
green, and `git diff --check` clean. Reviewer pass completed with no
P1/P2 issues; the only P3 doc nits were fixed in the pre-smoke docs
sync. REAPER live smoke S0-S17 passed on REAPER 7.71/macOS-arm64 after
full restart and current `start_bridge.lua` load. Console showed
generation 1 and `loaded error_codes (22 codes)`. Timestamp:
`20260630032823069`.

**Kernel hardening Slice 09 ✅ live-smoked, committed, and pushed
(2026-06-30, `bf15daa`).** Architect packet lives at
`docs/plans/SLICE_09_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 09 continues H2
field-level verification by adding `item_duplicate`, the first
creates-style template with `expectedDelta.fields[]`. D5 is relaxed
only for `creates:true` descriptors whose `count` is a finite positive
integer; static validation still rejects `fields[]` with
`maybeCreates:true`, `deletes:true`, and `creates:true` plus
`count:"any"`. `item_duplicate` now declares item `D_POSITION ←
params.position`, tolerance `1e-6`, with no `optional` or `nullable`.
No Lua runtime path changed: the existing Slice 06 `verify.lua`
changed-id GUID resolver and item field reader are reused. Decisions
locked by user: D1=a only `item_duplicate`; D2=a creates-only, no
maybeCreates; D3=a numeric positive count only; D4=a only
`D_POSITION`; D5=a tolerance `1e-6`. Static gates are green:
`npm test` 272/272, `npm run build` clean, `npm run check:manifest`
green, `npm run check:error-codes-fresh` green, and
`git diff --check` clean. Reviewer pass completed with only P3 nits,
now fixed; REAPER live smoke passed on REAPER 7.71/macOS-arm64 after
full quit/reopen and current `start_bridge.lua` run. Console showed
generation 1 and `loaded error_codes (22 codes)`.

**Kernel hardening Slice 08 ✅ live-smoked, committed, and pushed
(2026-06-30, `c923df9`).** Architect packet lives at
`docs/plans/SLICE_08_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 08 continues H2
field-level verification by adding `item_fade`, the first nullable
field-verify template. `FieldCheckDescriptor` supports
`nullable?: boolean`; validation rejects non-boolean `nullable` values
and allows an all-optional `fields[]` list only when every field is also
nullable. Full static baseline was green: `npm test` 263/263,
`npm run build` clean, `npm run check:manifest` green,
`npm run check:error-codes-fresh` green, and `git diff --check` clean.
Reviewer pass completed, and REAPER live smoke passed on REAPER
7.71/macOS-arm64 after full quit/reopen and current `start_bridge.lua`
run. Console showed generation 1 and `loaded error_codes (22 codes)`.

**Kernel hardening Slice 07 ✅ live-smoked, committed, and pushed
(2026-06-30, `9244be3`).** Architect packet lives at
`docs/plans/SLICE_07_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 07 continues H2
field-level verification by adding `item_trim`, the first covered
template with multiple fields and mixed scopes. `FieldCheckDescriptor`
supports `optional?: boolean`; validation rejects non-boolean
`optional` values and rejects all-optional field lists. Full static
baseline was green: `npm test` 257/257, `npm run build` clean,
`npm run check:manifest` green, `npm run check:error-codes-fresh`
green, and `git diff --check` clean. Reviewer pass completed after two
P3 doc-only nits were fixed. REAPER live smoke passed on
REAPER 7.71/macOS-arm64 after a full quit/reopen and current bridge
reload.

**Kernel hardening Slice 06 ✅ live-smoked, committed, and pushed
(2026-06-30, `9f56ce0`).** Architect packet lives at
`docs/plans/SLICE_06_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 06 is the first H2
field-level verification slice: `ExpectedDelta` accepts optional
`fields[]` descriptors, four in-place templates declare one field
postcheck each (`item_pitch`, `item_move`, `item_rate`,
`track_rename`), `call_template` sends those descriptors over the
queue inside `expected_delta.fields[]`, and `verify.lua` reads back
the changed item/take/track field after structural verification but
before `LAST_RESULT` is updated. Full static baseline was green:
`npm test` 254/254, `npm run build` clean, `npm run check:manifest`
green, `npm run check:error-codes-fresh` green, and `git diff --check`
clean. REAPER live smoke passed on REAPER 7.71/macOS-arm64 with run id
`1782752152900`, including happy field-verified paths, raw field
mismatch `VERIFY_FAILED` with `details.fields[0]`, structural mismatch
priority, and error-code/get_state regressions.

**Kernel hardening Slice 05 ✅ live-smoked, committed, and pushed
(2026-06-30, `5ba6318`).** Architect packet lives at
`docs/plans/SLICE_05_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 05 closes the H5
error-code activation gap left by Slice 03: the bridge now dofile's
generated `reaper/packs/core/error_codes.lua`, validates the 22-code
table at boot, wires it into `refs.lua` via `attach_errs(ERRS)`, and
passes `ctx.errs = ERRS` to every handler. Lua bridge, refs, and
templates now use generated `ERRS.*` / `ctx.errs.*` constants instead
of string-literal error codes. `scripts/error-codes.mjs check` rejects
runtime Lua literal forms including single-quoted variants and scans
`ERRS.*` / `errs.*` / `ctx.errs.*` references for typos. Full static
baseline was green: `npm test` 248/248, `npm run build` clean,
`npm run check:manifest` green, `npm run check:error-codes-fresh`
green, and `git diff --check` clean. REAPER live smoke passed on
REAPER 7.71/macOS-arm64 after a full quit/reopen and current
`start_bridge.lua` run: focused paths returned `ITEM_NOT_FOUND`,
`MEDIA_NOT_FOUND`, `REGION_NAME_INVALID`, `REF_INVALID`,
`REGION_NOT_FOUND`, and raw-queue `VERIFY_FAILED` without any
`INTERNAL_ERROR` degradation; `VERIFY_FAILED` carried structured
`{expected, actual, changed_count}` details and did not pollute
`LAST_RESULT`.

**Kernel hardening Slice 04 ✅ live-smoked, committed, and pushed
(2026-06-29, `d3f8fe7`).** Architect packet lives at
`docs/plans/SLICE_04_ARCHITECT_PLAN.md`; source master plans remain
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 04 is the H2
minimum structural verification slice: `ExpectedDelta` v1 is now
active on the descriptor surface, `callTemplate` sends it over the
queue as `expected_delta`, the Lua bridge snapshots item/track/region
counts around successful synchronous template handlers, and mismatches
return typed `VERIFY_FAILED` with `recoverable:false`, structured
details, and the required recovery phrase telling agents to call
`get_state`. Normal green-path behavior is intended to remain
unchanged. `track_create` uses `maybeCreates` to preserve the
`reuse_existing:true` no-create success path; `render_region` omits
`expectedDelta` and remains the deferred artifact-path carve-out.
Static descriptor redlines now fail missing or incoherent
`expectedDelta` declarations. Code baseline is green: `npm test`
244/244, `npm run build` clean, `npm run check:manifest` green,
`npm run check:error-codes-fresh` green (22 codes), and
`git diff --check` clean. Live smoke passed on REAPER
7.71/macOS-arm64 after a full REAPER restart and current
`start_bridge.lua` load: `track_create` create/reuse both hit the same
track GUID, read scopes did not pollute `LAST_RESULT`, `media_import`
and in-place `item_pitch` passed structural verification,
`region_create` and `render_region` passed, and a raw-queue forced
mismatch returned typed `VERIFY_FAILED` without updating `LAST_RESULT`.

**Kernel hardening Slice 03 ✅ live-smoked, committed, and pushed
(2026-06-29, `4e80839`).** Architect packet lives at
`docs/plans/SLICE_03_ARCHITECT_PLAN.md`; the source master plans are
`docs/plans/KERNEL_HARDENING_PLAN.md` and
`docs/plans/KERNEL_HARDENING_EXECUTION.md`. Slice 03 is the H5
minimum slice: `CapabilityDefinition` now requires
`entity_kind`, symbolic `undo_flags`, and at least one `examples[]`
entry per template; optional H2/H6 placeholders
(`expectedDelta`, `reads`, `writes`) are accepted but omitted when
absent and not consumed at runtime. All 11 TS template descriptors
carry the new metadata, and `list_templates` now returns it. New
static redlines are in place: `scripts/manifest-alignment.mjs`
checks TS registry descriptors against Lua `manifest.lua` for
`entity_kind`, `undoable`, and `undo_flags`; `scripts/error-codes.mjs`
generates `reaper/packs/core/error_codes.lua` from
`packages/core/src/errors.ts` and audits Lua error-code literals
including `raise(code or "FOO", ...)` fallback forms and
`return nil, "FOO", ...` resolver returns. Runtime behavior is
intentionally unchanged: no bridge changes, no Lua handler changes, no
`manifest.lua` changes, and `error_codes.lua` was not dofile'd yet.
Slice 05 is the follow-up that activates `ERRS.*` at runtime.
M0 is green: `npm test` 237/237, `npm run build` clean, `npm run
check:manifest` green, `npm run check:error-codes-fresh` green, and
`git diff --check` clean. M1-M3 live/minimal activity smoke also
passed on REAPER 7.71/macOS-arm64: `ping` connected,
`list_templates` returned 11 enriched descriptors, and
`track_create name:"smoke03-meta-1782736628621"` returned the locked
call_template envelope.

**Kernel hardening Slice 02 ✅ live-smoked, committed, and pushed
(2026-06-29, `e93d39e`).** Architect packet lives at
`docs/plans/SLICE_02_ARCHITECT_PLAN.md`. Slice 02 adds the first H3
projection: `get_state(tracks, include:["fx"])`. Default
`get_state(tracks)` remains Slice-01-compatible and omits `fx`; the
opt-in path adds `fx: []` or
`{index,name,ident,enabled,preset_name}` descriptors per track. TS
and Lua both enforce the strict include contract: only `"fx"` is
valid, non-empty include is valid only with `scope:"tracks"`, and
`get_state(render, include:["fx"])` returns `PARAMS_INVALID` before
the reserved-scope `SCOPE_NOT_IMPLEMENTED` path. Live REAPER smoke
S0-S10 passed on REAPER 7.71/macOS-arm64 after a full quit/reopen to
clear a stale pre-Slice-02 bridge owner. S10 baseline: 80 ReaEQs on
one track fits (`response_bytes=12650`); 650 ReaEQs with `limit=1`
returns `RESPONSE_TOO_LARGE`.

**Kernel hardening Slice 01 ✅ live-smoked, committed, and pushed
(2026-06-29, `baa13bd`).** Architect packet lives at
`docs/plans/SLICE_01_ARCHITECT_PLAN.md`. Slice 01 implements H1's
data-driven entity routing plus H3's readonly `get_state(project)`,
`get_state(tracks)`, and `get_state(regions)` scopes. Code/test
baseline: `npm test` 216/216 green, `npm run build` clean. Focused
reviewer re-review passed. Live smoke passed on REAPER
7.71/macOS-arm64 after a full REAPER quit/reopen and launcher run:
`ping` connected; `track_create` made smoke track
`guid:{6EADD366-14F6-1641-AFD1-F0DA7CB84CEB}`; `media_import`
inserted `/System/Library/Sounds/Ping.aiff` and produced
`LAST_RESULT.items` with `guid:{0CA035D8-2829-724D-B6F7-0F1190C4C0D9}`;
`get_state(project)`, `get_state(tracks)`, and `get_state(regions)`
all returned ok; `item_fade` via `last_result:item:0` returned the
same imported item GUID, proving readonly scopes did not touch
`LAST_RESULT`; `get_state(render)` returned `SCOPE_NOT_IMPLEMENTED`.

**Step 7 ✅ verified live (2026-06-29).** `list_templates` +
`list_recipes` MCP tools shipped, `recipes/impact_variations.yaml`
finalized, the four Step 6 open notes resolved in code (region-name
re-validation, "Render in background" docs requirement, 3-tick file
stability window, bridge startup stale-`RUNNING/` cleanup). The
8-item end-to-end smoke ran clean on REAPER 7.71/macOS-arm64
(`~/Desktop/streetlight-step7-resmoke-1782704645367`): 8 WAVs (24-bit
PCM stereo 48 kHz), zero `.RPP` / `.RPP-bak` sidecars, `changed_ids`
WAV-only, plus the focused preflight check (touch a `.wav.RPP` →
    typed `OUTPUT_FILE_EXISTS`, user file untouched). 164/164 TS tests
    green (146 baseline + 16 Step 7 + 2 sidecar preflight),
    `npm run build` clean. Step 3 → Step 8 Round A/C is captured in
    local checkpoint `166d109`; the release-prep setup/launcher round
    landed as local checkpoint `4e44b3b`. A follow-up beginner
    installer round is in progress: macOS `install.command`, Windows
    experimental `install.cmd` / `install.ps1`, and shared
    `scripts/install.mjs` delegate to `npm install` → `npm run build`
    → `npm run setup` without changing the locked bridge/config
    boundaries. Kernel hardening Slice 01 lifts the test bar to
    216/216 (+9 over the 207 beginner-installer baseline).
Step 8 release polish closed across Round A (release-blocker code,
+7 tests → 171/171) + Round C (docs + audit evaluation) the same
window; Round B (Linux queue-dir) deferred to v0.2 by explicit user
decision. All six open notes resolved. Release-prep setup/launcher
(scripts/setup.mjs + REAPER start_bridge.lua + setup-out/ MCP config
generator) landed same window with manual REAPER Load... + Run gate
passed live (console: bridge ready generation 1); test bar 171 → 198.

**Step 6 ✅ done — 10/10 smoke prompts (6-0..6-9) verified on REAPER 7.71/macOS-arm64 (2026-06-29), 146/146 TS tests green.**

**Step 3 ✅ done — all 8 acceptance points verified on REAPER 7.71/macOS-arm64 (2026-06-27).**

Last verified on REAPER 7.71/macOS-arm64: 2026-06-27 (Steps 2 + 3). Step 3
TS side 76/76 green; bridge-side dispatcher and MCP-side Zod / registry
rejections both proven against a live REAPER session.

**Step 4a ✅ done — all 7 smoke prompts verified on REAPER 7.71/macOS-arm64 (2026-06-27).**
json.null sentinel in `packs/core/lib/json.lua`, `last_result:item:N` +
`track:Name/item:N` resolvers in `refs.lua`, `ctx.json` wired into the
template ctx. 76/76 tests pass.

**Step 4b ✅ done — 10/10 smoke prompts verified on REAPER 7.71/macOS-arm64 (2026-06-28), 108/108 TS tests green.**
Five new templates land in pack `core`: `track_create`, `track_rename`,
`item_move`, `item_rate`, `item_trim`. Two pieces of plumbing landed
ahead of them per the Codex review:

1. **Entity-typed `LAST_RESULT`** — `streetlight_bridge.lua` no longer
   slams every `changed_ids` into `LAST_RESULT.items`. Each manifest
   entry now declares `entity_kind = "item" | "track" | "region"` and
   the dispatcher routes via `ENTITY_BUCKET`. Without this, the very
   first `track_create` would have silently polluted the items bucket
   and broken `last_result:item:N` for everything after.
2. **Track refs (Lua + TS)** — `refs.lua` gains `M.resolve_track(ref,
   last_result)` covering `track:Name`, `guid:{...}`, and
   `last_result:track:N`. `packages/core/src/refs.ts` gains a sibling
   `TrackRef` + `parseTrackRef` + `formatTrackRef`. Item-resolver gives
   typed REF_INVALID when a track-shaped ref is fed in (and vice versa)
   instead of a generic "unrecognized" message.

The locked `call_template` envelope schema (shared across all templates)
was lifted out of `item-pitch.ts` into `packages/mcp-server/src/templates/_shared.ts`
as `callTemplateResultSchema(name)`. `item_pitch` was migrated to use it;
the four new templates use it from the start.

**Step 4c ✅ done — 10/10 smoke prompts verified on REAPER 7.71/macOS-arm64 (2026-06-28), 123/123 TS tests green.**
Three trickier templates land: `item_duplicate` (manual
`AddMediaItemToTrack` + `SetMediaItemTake_Source`, no clipboard action),
`item_fade` (first `json.null` user — tri-state semantics: absent /
explicit null / number), `media_import` (selection save/restore around
`InsertMedia`, new `MEDIA_NOT_FOUND` error code, new `media.lua` file).
14 new TS tests including a load-bearing on-wire null round-trip for
`item_fade`. **Codex-driven pre-smoke hardening (2026-06-28):**
`media_import` now also snapshots/restores item selection (not just
tracks) and identifies the new item via target-track GUID diff (not
`after_count - 1`); every floating-point `z.number()` in the templates
gained `.finite()` — load-bearing for `item_fade` (without it,
`fade_in: Infinity` round-trips as JSON `null` and silently clears the
fade). +1 TS test (123/123 green) for the Infinity regression.
Re-smoke 2026-06-28 (10/10 green incl. the new 4c-1b GUID-diff
acceptance + 4c-10 Infinity guard via the TS path) used a direct
client against `packages/mcp-server/dist/` because Codex's bundled
`mcp__streetlight` registry still predates Step 4c. See "Step 4c
post-smoke fixes (2026-06-28, pre-smoke)" and "Step 4c verification
(2026-06-28)" below.

**Step 5 ✅ done — 8/8 smoke prompts verified on REAPER 7.71/macOS-arm64 (2026-06-29), 131/131 TS tests green.**
One new template lands in pack `core`: `region_create`. New file
`reaper/packs/core/templates/region.lua` (mirrors the track.lua /
media.lua shape). New file
`packages/mcp-server/src/templates/region-create.ts` plus 8 vitest
cases in `region-create.test.ts`. Two-mode params via Zod superRefine:
`{ name, start, end }` OR `{ name, item_id }` (XOR, with `start >= 0`
and `end > start` enforced TS-side). Name-content rules
(`REGION_NAME_INVALID` for empty / path-separator names) live in
`region.lua` so the agent-facing surface stays a domain code matching
`REGION_NAME_TAKEN`; TS only enforces structural shape (`min(1)`, mode
XOR, finite numeric bounds). The TS/Lua split landed mid-smoke on
2026-06-29 after Codex caught 5-5 returning `PARAMS_INVALID` instead
of `REGION_NAME_INVALID` — see "Step 5 mid-smoke fix (2026-06-29)"
below for the contract amendment + the regression note for future
windows.

Region identity in v0.1 is the NAME, not REAPER's integer marker index
(unstable across deletes) — REAPER 7 has no native region GUID API.
`changed_ids` therefore returns `"region:NAME"` (not `"guid:{...}"`),
and `LAST_RESULT.regions` stores name-shaped refs. The Lua resolver
re-scans by name on `last_result:region:N`. `parseRegionRef` on the
TS side keeps accepting `guid:{...}` (well-formed shape) but the Lua
resolver returns `REF_INVALID` with the message "regions don't support
GUID refs in v0.1; use region:Name or last_result:region:N" — parser
permissive, resolver explicit.

Cross-type REF_INVALID closure (third leg). 4b only did item ↔ track;
Step 5 adds item ↔ region and track ↔ region. Feeding a region-shaped
ref into `track_rename(track_id=...)`, or a track-shaped ref into
`region_create(item_id=...)`, now returns a typed REF_INVALID naming
what the agent actually fed in instead of a generic "unrecognized".

Files touched:

- `reaper/packs/core/templates/region.lua` (new) — `M.region_create`.
  Pre-create REGION_NAME_TAKEN check (no half-mutated state on a
  duplicate name); REGION_NAME_INVALID for empty / path-separator
  names (this is the agent-facing surface — TS only checks min(1),
  not character content). Item-derived bounds:
  `[D_POSITION, D_POSITION + D_LENGTH]` — fades are within D_LENGTH so
  they're already covered (IMPLEMENTATION_PLAN.md § Step 5 pitfall).
- `reaper/packs/core/refs.lua` — `M.resolve_region(ref, last_result)`
  plus private `parse_last_result_region` / `parse_region_name` /
  `resolve_region_name` / `resolve_last_result_region`. Returns a
  synthetic `{ index, pos, rgnend, name }` handle (regions have no
  MediaItem-style native handle in REAPER 7). Three-way cross-type
  rejection added to both `M.resolve_item` and `M.resolve_track`.
- `reaper/packs/core/manifest.lua` — `region_templates = dofile(...)`
  + new `region_create` entry, `entity_kind = "region"`,
  `undo_flags = UNDO_STATE_MISCCFG` (markers/regions scope).
- `packages/mcp-server/src/templates/region-create.ts` (new) — Zod
  schema with `superRefine` mode-XOR + bounds. `.finite()` on the
  numeric fields (matches the 4c hardening pattern).
- `packages/mcp-server/src/templates/index.ts` — one register line.
- `packages/mcp-server/src/tools/__tests__/region-create.test.ts`
  (new, 8 tests): happy explicit-mode envelope (incl. name-shaped ID
  round-trip), item-mode on-wire shape, 4 PARAMS_INVALID branches
  (both modes at once, neither mode, half-explicit, end<=start),
  bridge-surfaced REGION_NAME_INVALID (path separator) and
  REGION_NAME_TAKEN (duplicate name).

Decisions locked across Step 5 (carry forward unless explicitly
revisited):

1. **Region identity = name.** changed_ids shape is `region:NAME`,
   LAST_RESULT.regions stores it verbatim, resolver re-scans by name.
   Trade-off accepted: there's no stable handle for race-prone
   rename / duplicate-name scenarios, but REAPER 7 doesn't expose
   one.
2. **GUID parses, resolves to REF_INVALID.** parseRegionRef stays
   generic; the failure surfaces at the bridge with a message naming
   the missing API rather than a silent miss.
3. **superRefine XOR for `{start,end}` vs `item_id`.** Optional
   fields + refinement, NOT a discriminated union or two templates.
   Matches `item_trim`'s style with its optional `start_offset`.
4. **start >= 0, end > start, both strict.** Half-mode (only `start`
   or only `end`) is PARAMS_INVALID; end == start is PARAMS_INVALID.
5. **`/` and `\` in name → REGION_NAME_INVALID, owned by Lua.**
   `region.lua` is the single agent-facing surface (matches
   `REGION_NAME_TAKEN`'s shape, so agents learn one place to look for
   region-name errors). TS schema deliberately does NOT pre-check
   path separators — that would surface as `PARAMS_INVALID` and steal
   the domain code. TS keeps `min(1)` + mode XOR + bounds only; the
   Lua handler also defends against empty names so schema drift
   can't reach `AddProjectMarker2`. Step 6's render-to-filename can
   rely on the bridge guard.
6. **Item-derived bounds = `[pos, pos + length]`.** Do NOT add
   fade-out duration — fades live inside D_LENGTH already.
7. **`undo.UNDO_STATE_MISCCFG` for region_create.** Tightest correct
   flag for the project-marker mutation surface.

Files NOT changed (already in place from prior steps):

- `packages/core/src/refs.ts` — `RegionRef`, `parseRegionRef`,
  `formatRegionRef`, plus refs.test.ts coverage already shipped
  before Step 5.
- `packages/core/src/errors.ts` — `REGION_NOT_FOUND`,
  `REGION_NAME_TAKEN`, `REGION_NAME_INVALID` already declared.
- `reaper/streetlight_bridge.lua` — `entity_kind = "region"` bucket
  routing already wired in Step 4b.

REAPER smoke verified — 8/8 green on REAPER 7.71/macOS-arm64
(2026-06-29). 5-1..5-7 passed in the first live pass; 5-5 surfaced a
contract bug (TS `superRefine` returned `PARAMS_INVALID`, doc said
`REGION_NAME_INVALID`) that was fixed mid-smoke and re-passed; 5-0
(the folded-in 4c-postfix-trim regression) returned `TAKE_NOT_FOUND`
with `D_LENGTH = 10` unchanged before/after, proving the
take-resolve-before-write ordering fix landed live. See "Step 5
mid-smoke fix (2026-06-29)" and "Step 5 verification (2026-06-29)"
below.

### Kernel hardening Slice 02 (2026-06-29) — track FX read projection ✅

Scope: implement `get_state(tracks, include:["fx"])` from
`docs/plans/SLICE_02_ARCHITECT_PLAN.md`. This is a readonly H3
projection only: no new write templates, no FX params, no item/take FX,
no `fields`, no `cursor`, no `get_state(render)`.

What changed:

- `packages/core/src/types.ts` — `TrackDescriptor` gains optional
  `fx?: FxDescriptor[]`; new `FxDescriptor` locks
  `{index,name,ident,enabled,preset_name}`. `fx` is absent by default
  and present only on `include:["fx"]`.
- `packages/mcp-server/src/tools/get-state.ts` — `include` schema
  added as strict `z.array(z.enum(["fx"]))`; `superRefine` rejects
  non-empty include outside `scope:"tracks"` with `PARAMS_INVALID`
  before touching the queue.
- `packages/mcp-server/src/index.ts` — MCP tool schema exposes
  `include` and forwards it; startup log moved from stale "step 7" to
  neutral `v0.1 kernel`.
- `reaper/streetlight_bridge.lua` — direct-queue callers get the same
  include contract in Lua. Unknown include values and include on
  non-tracks scopes return `PARAMS_INVALID`; this runs before the
  `render` reserved-scope branch, so
  `get_state(render, include:["fx"])` is `PARAMS_INVALID`, not
  `SCOPE_NOT_IMPLEMENTED`. Track FX metadata uses
  `TrackFX_GetCount`, `TrackFX_GetFXName`, `TrackFX_GetNamedConfigParm(...,
  "fx_ident")`, `TrackFX_GetEnabled`, and `TrackFX_GetPreset`. There is
  no `TrackFX_GetFXIdent`. API absence/call failure degrades fields to
  `""`/`false` rather than killing the read.
- `packages/mcp-server/src/tools/__tests__/get-state.test.ts` — +8
  fake-bridge tests for default/no include, empty include, FX descriptor
  parsing, unknown include rejection, non-tracks include rejection
  including render priority, and truncated tracks-with-FX parsing.
- `scripts/__tests__/lua-structure.test.mjs` — +1 structure guard that
  locks the Lua include validator and `fx_ident` API choice.
- `docs/RESPONSE_BUDGET.md` — optional track `fx` shape, include
  error-priority contract, and FX-heavy single-track
  `RESPONSE_TOO_LARGE` risk.
- `docs/ROADMAP.md` — v0.2 wording updated: Slice 02 ships only
  track-level FX include; fields/cursor/render/take FX/item FX/FX
  params/FX writes remain deferred.
- `docs/plans/SLICE_02_ARCHITECT_PLAN.md` — packet parked for future
  windows.

Verification so far:

- `npm test` → 225/225 green.
- `npm run build` → clean.
- `git diff --check` → clean.
- Focused reviewer pass complete. One P2 (`include:{}` direct-queue
  bypass) fixed in Lua `is_array_like()` + structure guard.
- Live REAPER smoke S0-S10 passed on REAPER 7.71/macOS-arm64. The
  first attempt hit the expected dirty-bridge-owner issue: a stale
  pre-Slice-02 bridge loop was still claiming queue files and ignored
  `include`. After fully quitting/reopening REAPER and loading the
  current `start_bridge.lua`, the clean run passed.

Smoke evidence:

- S0 `ping` → connected, REAPER 7.71/macOS-arm64.
- S1 `get_state(project)` → ok.
- S2 `get_state(tracks)` → ok, no `fx` field by default.
- S3 ReaEQ projection → `fx[0].index=0`, name `VST: ReaEQ (Cockos)`,
  non-empty `ident`, `enabled=true`, `preset_name=""`.
- S4 `include:["fx","midi"]` → `PARAMS_INVALID`.
- P2 regression probe direct queue `include:{}` → `PARAMS_INVALID`,
  message "get_state include must be an array".
- S5 `regions + include:["fx"]` → `PARAMS_INVALID`.
- S6 `render + include:["fx"]` → `PARAMS_INVALID`, not
  `SCOPE_NOT_IMPLEMENTED`.
- S7 read FX then `track_rename track_id:"last_result:track:0"` →
  passed, proving reads did not touch `LAST_RESULT`.
- S8 bare `get_state(render)` → `SCOPE_NOT_IMPLEMENTED`.
- S9 ReaEQ preset selected → `preset_name="stock - Basic 11 band"`.
- S10 FX-heavy baseline: 80 ReaEQs on one track returned `total=1`,
  `returned=1`, `truncated=false`, `response_bytes=12650`,
  `fx_count=80`; 650 ReaEQs on the first track with `limit=1`
  returned `RESPONSE_TOO_LARGE` with message "Single track descriptor
  exceeds the 65536 byte response cap". Temporary tracks, scratch
  queue files, and `/tmp/streetlight_slice02*` files were cleaned up.

### Kernel hardening Slice 03 (2026-06-29) — descriptor authority + static redlines ✅

Scope: implement the H5 minimum slice from
`docs/plans/SLICE_03_ARCHITECT_PLAN.md`. This is metadata and tooling
only: no runtime write behavior changes, no bridge changes, no
`manifest.lua` changes, and no Lua handler migration to `errs.FOO`
references.

What changed:

- `packages/core/src/registry.ts` — `CapabilityDefinition` now
  requires `entity_kind`, symbolic `undo_flags`, and at least one
  `examples[]` entry. It also defines optional H2/H6 placeholders
  `expectedDelta`, `reads`, and `writes`; metadata omits these when
  absent. `register()` performs development-time validation, and
  `rawDefinitions()` gives static tooling a registry snapshot without
  executing templates.
- All 11 `packages/mcp-server/src/templates/*.ts` capability
  descriptors declare the new metadata. `render_region` is locked as
  the non-undoable edge case with `undo_flags: []`.
- `packages/mcp-server/src/tools/__tests__/list-templates.test.ts`
  and `packages/core/src/__tests__/registry.test.ts` now lock the new
  metadata surface, optional-placeholder omission, example presence,
  and undoable/undo_flags invariants.
- `scripts/manifest-alignment.mjs` — parses Lua `manifest.lua` and
  compares it to the TS registry for `entity_kind`, `undoable`, and
  `undo_flags`. It supports the locked single-line `undo_flags`
  convention and fails loudly on unsupported multi-line forms. Exposed
  through `npm run check:manifest` and vitest.
- `scripts/error-codes.mjs` — generates
  `reaper/packs/core/error_codes.lua` from
  `packages/core/src/errors.ts`, checks the committed generated file
  is fresh, and audits Lua error-code literals. The audit covers
  `code = "FOO"`, `raise("FOO", ...)`, fallback forms such as
  `raise(code or "FOO", ...)`, and resolver returns such as
  `return nil, "FOO", ...`.
- `docs/RESPONSE_BUDGET.md` — `list_templates` metadata budget notes
  now include the new descriptor fields and explicitly mark
  `expectedDelta` / `reads` / `writes` as placeholders.
- `docs/ROADMAP.md` — H5 minimum slice noted; full handler-side
  error-code migration and generated factories remain deferred.

Verification so far (M0):

- `npm test` → 237/237 green.
- `npm run build` → clean.
- `npm run check:manifest` → `Streetlight manifest alignment ok (11 templates).`
- `npm run check:error-codes-fresh` → `Streetlight error codes fresh (21 codes).`
- `git diff --check` → clean.
- Focused reviewer pass → no findings. Residual risk is limited to
  the expected static-regex-check boundary; future Lua shape changes
  may need parser/audit updates.

Live/minimal activity smoke:

- M1: `ping` returned connected on REAPER 7.71/macOS-arm64.
- M2: `list_templates` returned 11 templates and every metadata
  entry includes `entity_kind`, `undo_flags`, and `examples`.
  `render_region.undoable=false` and `undo_flags=[]`.
- M3: `track_create name:"smoke03-meta-1782736628621"` returned
  `ok:true` with locked envelope `{ template:"track_create",
  changed_count:1, changed_ids:["guid:{58A3970C-603B-9F43-BC07-7246176D70FD}"],
  truncated:false }`. The smoke track is left in the open REAPER
  project for undo/delete.

### Kernel hardening Slice 04 (2026-06-29) — structural expectedDelta verification ✅

Scope: implement the H2 minimum safe slice from
`docs/plans/SLICE_04_ARCHITECT_PLAN.md`. This is structural
verification only: before/after entity-count checks, no field-level
checks, no rollback, no handler rewrites, no `manifest.lua` changes,
and no verification for deferred `render_region`.

What changed:

- `packages/core/src/registry.ts` — `ExpectedDelta` v1 is now
  `{ count: number | "any"; creates?; maybeCreates?; deletes? }`.
  Descriptor validation rejects mutually incompatible
  `creates` / `maybeCreates` / `deletes` modes and rejects
  `maybeCreates:true` with `count:"any"`.
- `packages/core/src/errors.ts` — new `VERIFY_FAILED` error code,
  non-recoverable by default.
- Ten undoable mutating descriptors now declare `expectedDelta`:
  in-place item/track templates use `{count:1}`;
  `item_duplicate` and `region_create` use `{count:1, creates:true}`;
  `media_import` uses `{count:"any", creates:true}`; and
  `track_create` uses `{count:1, maybeCreates:true}` to preserve the
  legal reuse path. `render_region` intentionally omits it.
- `packages/core/src/queue.ts`,
  `packages/mcp-server/src/transport/file-queue.ts`, and
  `packages/mcp-server/src/tools/call-template.ts` carry descriptor
  metadata over the queue as `expected_delta`.
- `reaper/packs/core/verify.lua` (new) owns structural snapshots,
  diffs, and checks for item/track/region counts. `streetlight_bridge.lua`
  snapshots before synchronous handler execution, checks after handler
  success, and only then calls `finalize_template`. A mismatch returns
  typed `VERIFY_FAILED` with `recoverable:false`, `error.details =
  {expected, actual, changed_count}`, and the required phrase:
  "The mutation has been applied — call get_state to inspect actual
  state."
- `scripts/manifest-alignment.mjs` now also validates descriptor
  completeness/coherence: every mutating undoable template must have
  `expectedDelta`, non-undoable templates must not, delta modes must
  be mutually exclusive, and `maybeCreates` requires a numeric count.
- Tests updated across registry metadata, `list_templates`,
  `call_template` on-wire payloads, manifest static checks,
  error-code generation, fake bridge error `details`, and Lua
  structure. `VERIFY_FAILED` details are surfaced without retry.

Verification:

- `npm test` → 244/244 green.
- `npm run build` → clean.
- `npm run check:manifest` → `Streetlight manifest alignment ok (11 templates).`
- `npm run check:error-codes-fresh` → `Streetlight error codes fresh (22 codes).`
- `git diff --check` → clean.
- Focused reviewer pass → no blocking findings.

Live smoke (REAPER 7.71/macOS-arm64):

- User fully quit/reopened REAPER and loaded the current
  `start_bridge.lua`.
- S0 `ping` → connected, `reaper_version="7.71/macOS-arm64"`.
- S8 `list_templates` → 11 templates. Ten undoable mutating templates
  expose `expectedDelta`; `track_create.expectedDelta` is
  `{count:1, maybeCreates:true}`; `render_region` omits it.
- S1/S1b `track_create name:"smoke04-mc-1782743061140"
  reuse_existing:true` → create then reuse both returned
  `guid:{732FDB51-4926-3641-9BCD-B414EDC7CBBC}`; `get_state(tracks)`
  confirmed only one track with that name, proving `maybeCreates`
  accepts both +1 and 0 delta paths.
- S7 read-scope regression → `get_state(tracks)` after S1b did not
  touch `LAST_RESULT`; `track_rename track_id:"last_result:track:0"`
  succeeded against the same GUID.
- S4 `media_import` into the smoke track imported
  `/System/Library/Sounds/Ping.aiff`, returned
  `guid:{E2B0A51D-B0DB-A84A-9658-0C396A8C45AD}`, and satisfied
  `{count:"any", creates:true}`.
- S2 `item_pitch` on that imported item succeeded as in-place
  `{count:1}` verification.
- S3 `region_create name:"smoke04-r1-1782743061140" item_id:<item>`
  returned `region:smoke04-r1-1782743061140`.
- S5 `render_region` on that region wrote
  `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/streetlight-slice04-render-1782743061140/smoke04-r1-1782743061140.wav`,
  returned only that WAV path in `changed_ids`, and the output dir
  contained exactly that WAV (no `.RPP` / `.RPP-bak` sidecar). The
  temporary output directory was removed after smoke.
- S6 raw-queue forced mismatch: sent `item_pitch` with deliberately
  wrong `expected_delta={count:1, creates:true}`. Bridge returned
  `VERIFY_FAILED`, `recoverable:false`, message contained "The
  mutation has been applied — call get_state to inspect actual state",
  and details were
  `{actual:{items:0,regions:0,tracks:0}, changed_count:1,
  expected:{count:1,creates:true}}`.
- S6 follow-up `track_rename track_id:"last_result:track:0"` still hit
  `guid:{732FDB51-4926-3641-9BCD-B414EDC7CBBC}`, proving
  `VERIFY_FAILED` did not finalize or update `LAST_RESULT`.
- Temporary smoke scripts and render files were removed. Smoke tracks /
  regions/items remain in the open REAPER project for manual Cmd+Z or
  deletion; they are not repository state.

### Kernel hardening Slice 15 (2026-06-30) — H4 idempotency tokens Phase 2 ✅ live-smoked/static-green

Scope from `docs/plans/SLICE_15_ARCHITECT_PLAN.md`: lift
`render_region` out of the Slice 14 carve-out so same-key retries of a
completed deferred render replay the stored terminal inner envelope.

Locked decisions:

- S15-D1=a: lift the `render_region` exclusion from `dedup_eligible`.
- S15-D2=a: replay does not update `LAST_RESULT.renders`.
- S15-D3=a: store successes and typed errors; do not store
  `INTERNAL_ERROR`.
- S15-D4=a: replay must never re-enter `DEFERRED`.
- S15-D5=a: stale-WAV semantics are accepted and documented.
- S15-D6=a: keep one shared `DEDUP` table and cap 256.
- S15-D7=a: stale `RUNNING/` sweep behavior unchanged.
- S15-D8=a: no special mid-flight same-key handling; single-slot
  serialization is enough.
- S15-D9=a: keep `render_region.idempotent=false`; DEDUP is
  transport-level retry safety.

Code shape:

- `reaper/streetlight_bridge.lua` no longer excludes `render_region`
  from `dedup_eligible(cmd)`.
- The deferred slot now stores `idempotency_key`. Terminal
  `close_with(inner)` calls `dedup_put(key, inner)` before writing the
  done envelope when the key is non-empty and the inner error is not
  `INTERNAL_ERROR`.
- Replay remains the existing pre-dispatch DEDUP path, so a replay does
  not dispatch the handler, enter `DEFERRED`, open undo, re-run H2
  verification, delete sidecars, or update `LAST_RESULT`.
- `packages/mcp-server/src/tools/call-template.ts`,
  `packages/mcp-server/src/index.ts`, fake-bridge tests, render-region
  tests, and Lua-structure tests were updated to remove the stale
  render carve-out wording and assert deferred replay behavior.
- Docs now spell out stale-WAV semantics: if the original WAV is
  deleted, same-key replay still returns the stored path. Use a fresh
  key for a fresh render.

Static verification:

- Focused suite: 74/74 green:
  `call-template.test.ts`, `render-region.test.ts`,
  `lua-structure.test.mjs`, and `mcp-index.test.mjs`.
- Full `npm test`: 313/313 green.
- `npm run build`: clean.
- `npm run check:manifest`: green, 11 templates aligned.
- `npm run check:error-codes-fresh`: green, 22 codes fresh.
- `git diff --check`: clean.

Reviewer:

- Meitner found no P1/P2/P3 issues. It specifically confirmed that
  `render_region` is no longer excluded from DEDUP, deferred terminals
  are stored after close, replay is pre-dispatch, `INTERNAL_ERROR` is
  skipped, read paths remain outside DEDUP, and
  `render_region.idempotent` remains false.

Live REAPER smoke:

- Passed on REAPER `7.71/macOS-arm64` after the user's full REAPER
  restart and current `start_bridge.lua` load. Main run id:
  `slice15-1782819968415`; extra LAST_RESULT proof:
  `slice15-lastresult-1782820030902`.
- S1 ping/list_templates passed. `ping` returned connected; MCP
  `list_templates` returned 11 templates, including `render_region`
  with `entity_kind:"render"` and `idempotent:false`.
- S2 synchronous dedup regression passed. Key
  `slice15-1782819968415-pitch-once` replayed stored `item_pitch` for
  item `guid:{9472804D-FE83-204D-A301-C3FC8ED608AF}`; a fresh probe
  proved `-6` was not pre-applied. Typed `ITEM_NOT_FOUND` replay also
  passed, and `item_rate last_result:item:0` still succeeded.
- S3 keyed `render_region` success replay passed. First render produced
  only
  `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/slice15-1782819968415/renders/slice15-1782819968415-region-a.wav`.
  Same-key replay returned the same path with unchanged size/mtime
  (`101536`, `1782819975510.6753`), proving no second render.
- S4 typed render error replay passed. Key
  `slice15-1782819968415-missing-dir` returned `OUTPUT_DIR_MISSING`
  twice, including when retry params changed to a valid directory.
- S5 `OUTPUT_FILE_EXISTS` terminal lock passed. Same key replayed the
  stored `OUTPUT_FILE_EXISTS` after conflict removal; a fresh key
  rendered successfully to
  `slice15-1782819968415-region-conflict.wav` size `72736`.
- S6 replay did not update `LAST_RESULT.renders`. Extra proof anchored
  `LAST_RESULT.tracks`, replayed keyed render with unchanged WAV mtime,
  then `track_rename last_result:track:0` succeeded. If replay had
  finalized render, cross-bucket clear would have emptied tracks.
- S7 bridge reload clears DEDUP was not run, deliberately, to avoid
  disrupting the user's active generation-1 bridge. This is accepted for
  this smoke because DEDUP remains chunk-local / bridge-lifetime scoped
  by construction and Slice 14 already covered reload-lifetime behavior.
- S8 representative regressions passed: `track_create`,
  `media_import last_result:track:0`, `get_state tracks include:["fx"]`,
  and render sidecar cleanup. No `.wav.RPP` / `.wav.RPP-bak` sidecars
  remained.
- Cleanup passed: temp roots removed; queue ended `pending=0`,
  `running=0`, `done=0`; only `bridge_owner` remained. Leftover REAPER
  project objects for manual undo/delete: track
  `slice15-1782819968415-track`
  `guid:{657F0C4F-95BE-C04B-8E4A-129AEBCBCFCD}`, item
  `guid:{9472804D-FE83-204D-A301-C3FC8ED608AF}`, regions
  `slice15-1782819968415-region-a`,
  `slice15-1782819968415-region-conflict`,
  `slice15-1782819968415-region-b`, extra proof track
  `slice15-lastresult-1782820030902-anchor-renamed`
  `guid:{4C02643F-0CC1-144F-A33D-160E5A585AFE}`, and extra proof region
  `slice15-lastresult-1782820030902-region-a`.

### Kernel hardening Slice 14 (2026-06-30) — H4 idempotency tokens Phase 1 ✅ live-smoked/static-green

Scope from `docs/plans/SLICE_14_ARCHITECT_PLAN.md`: add
caller-provided retry keys for mutating `call_template` commands.

Locked decisions:

- D1=a: do H4 Phase 1 now.
- D2=a: caller-provided keys only; no auto-keying.
- D3=a: bridge FIFO DEDUP cap is 256.
- D4=a: key length 1-128, ASCII printable only.
- D5=a: DEDUP clears on bridge reload / REAPER restart.
- D6=a: same key + different params silently replays first result.
- D7=a: read wire kinds ignore keys; public read MCP tools unchanged.
- D8=a: `INTERNAL_ERROR` terminals are not stored.
- D9=a: typed errors, including `VERIFY_FAILED`, are stored.
- D10=a: no special bridge-owner interaction.

Code shape:

- `QueueCommand` now has optional `idempotency_key`.
- `FileQueueClient.send()` accepts `idempotencyKey` and writes
  `idempotency_key` only when present.
- `call_template` validates optional `idempotency_key` before queue write
  and threads it to the queue. `render_region` with a key logs a warning
  because it remains the v0.1 carve-out.
- `streetlight_bridge.lua` owns chunk-local `DEDUP[key] = inner envelope`
  plus FIFO order. The check happens after pending->running claim and
  before dispatch. Replay writes a normal done envelope with fresh outer
  `id` / `completed_at`; it does not call the handler, open undo, re-run
  verify, or update `LAST_RESULT`.
- Successes and typed errors are stored. `INTERNAL_ERROR`, read paths,
  and `tick_deferred` are not stored/touched.

Static verification:

- Focused suite: 83/83 green.
- Full `npm test`: 309/309 green.
- `npm run build`: clean.
- `npm run check:manifest`: green, 11 templates aligned.
- `npm run check:error-codes-fresh`: green, 22 codes fresh.
- `git diff --check`: clean.

Live REAPER smoke:

- Run id: `slice14-1782815129961`; queue:
  `/Users/Zhuanz/Library/Application Support/Streetlight/queue`; REAPER:
  `7.71/macOS-arm64`. User preflight showed `bridge starting
  (generation 1)`, `loaded error_codes (22 codes)`, and `bridge ready
  (generation 1)`.
- S0/S1 passed: `ping` connected; `list_templates` returned exactly 11
  templates with no new idempotency metadata fields;
  `region_create.expectedDelta.fields[]` stayed `[name,pos,rgnend]`;
  `render_region` still had no `expectedDelta`.
- No-key baseline passed: `track_create`
  `guid:{75329121-6A9F-BB4C-AEA2-EB0ABB8EF522}` followed by
  `media_import track_id:"last_result:track:0"` producing
  `guid:{C4E22D92-4022-6644-AF9B-0EF1C7EFDFB0}`.
- Dedup happy path passed: idempotency key
  `slice14-1782815129961-pitch-once` replayed the first `item_pitch`
  inner result. A live verifier probe proved the take pitch remained
  `-3`; a deliberate `-6` probe returned `VERIFY_FAILED`, so replay did
  not double-apply.
- Typed-error replay passed: key
  `slice14-1782815129961-typed-error` returned identical
  `ITEM_NOT_FOUND` envelopes twice for an invalid item GUID.
- `LAST_RESULT` preservation passed after replay: `item_rate
  last_result:item:0` succeeded, and a no-key `track_rename
  last_result:track:0` succeeded after a replay on track
  `guid:{3BF45FDC-4DB6-FE44-941B-D9A9742969DE}`.
- Carve-outs passed: `render_region` with key
  `slice14-1782815129961-render-carveout` executed twice after deleting
  the first WAV and returned only
  `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/slice14-1782815129961/slice14-1782815129961-render-region.wav`;
  no `.RPP` / `.RPP-bak` sidecars remained. Direct-queue `ping` and
  `get_state(project)` with `idempotency_key` did not replay.
- Regression sweep passed: different keys executed independently; no-key
  behavior remained normal; representative `item_move`, `item_trim`,
  `item_fade`, `item_duplicate`, `track_create` reuse, `media_import`,
  `region_create` explicit + item-mode, error-code probes, `get_state`
  include/regression, and render artifact checks all passed.
- Cleanup passed: temp render dir was deleted; queue ended with
  `pending=0`, `running=0`, `done=0`; only `bridge_owner` remained.

### Kernel hardening Slice 13 (2026-06-30) — region_create explicit bounds field verification ✅ live-smoked / pushed `f998507`

Scope: extend Slice 12's region-scope field verification from
`name` only to `name + pos + rgnend`, without changing Lua runtime
code. This slice activates two pieces that already existed: Slice 12's
`read_region_field(handle,"pos"/"rgnend")` reader and Slice 07's
optional-absent skip rule.

What changed:

- `docs/plans/SLICE_13_ARCHITECT_PLAN.md` — Architect packet copied
  into the repo for future windows.
- `reaper/streetlight_bridge.lua` — mid-smoke blocker fix. Adds a
  queue-dir `bridge_owner` token written at startup and checked at the
  top of every tick before the existing `_G` generation guard and before
  `process_one`. This prevents two separately-started ReaScript Lua
  states from splitting `LAST_RESULT` and claiming alternating queue
  commands.
- `packages/mcp-server/src/templates/region-create.ts` —
  `region_create.expectedDelta.fields[]` expands from one field to
  three, in fixed order:
  `{scope:"region", field:"name", paramPath:"name"}`,
  `{scope:"region", field:"pos", paramPath:"start", tolerance:1e-6,
  optional:true}`, and `{scope:"region", field:"rgnend",
  paramPath:"end", tolerance:1e-6, optional:true}`.
- `packages/core/src/__tests__/registry.test.ts` — adds static coverage
  for mixed-optional region-scope bounds metadata with
  `creates:true`, plus regression checks that all-optional
  non-nullable region fields and duplicate `region:pos` descriptors are
  still rejected.
- `packages/mcp-server/src/tools/__tests__/call-template.test.ts` —
  asserts explicit-mode and item-mode `region_create` send the same
  three-field wire descriptor; runtime mode selection happens in
  `verify.lua` via optional skip.
- `packages/mcp-server/src/tools/__tests__/list-templates.test.ts` —
  asserts `list_templates` exposes the three fields in `[name,pos,rgnend]`
  order, no `nullable`, and no accidental changes to `render_region`.
- `scripts/__tests__/manifest-alignment.test.mjs` — mirrors the
  mixed-optional region bounds acceptance at CLI alignment level.
- `scripts/__tests__/lua-structure.test.mjs` — guards that
  `verify.lua` still has the Slice 12 region reader branches for
  `name`, `pos`, and `rgnend`, still does not loop over every
  `changed_id`, and still does not pull in `refs.lua` / computed
  expected logic. Also guards that `streetlight_bridge.lua` checks the
  file-backed owner token before the generation guard / `process_one`.
- `docs/TEMPLATE_SPEC.md`, `docs/RESPONSE_BUDGET.md`,
  `docs/plans/KERNEL_HARDENING_PLAN.md`, and
  `docs/plans/KERNEL_HARDENING_EXECUTION.md` document the new
  explicit-mode strong-bounds / item-mode name-only trade-off.

Decisions locked by user:

- D1=a: do Slice 13 region bounds verification.
- D2=a: use region reader fields `pos` / `rgnend`.
- D3=a: numeric tolerance `1e-6`.
- D4=a: descriptor order `[name, pos, rgnend]`.
- D5=a: explicitly document that item-mode remains name-only
  proof-of-life until a computed-expected descriptor axis exists.
- D6=a: reuse Slice 12's create + `VERIFY_FAILED` orphan-region
  contract.
- D7=b: Slice 13 packet references Slice 12 baseline `6e4a02f`; HANDOFF
  / PROGRESS are synced in this code drop.

Not changed:

- `reaper/packs/core/verify.lua` and
  `reaper/packs/core/templates/region.lua` are intentionally untouched.
  `streetlight_bridge.lua` changed only for the mid-smoke
  file-backed-owner guard; no verification, handler, or manifest logic
  changed.
- `region_create` happy envelope is unchanged:
  `{template, changed_count, changed_ids, truncated}` with
  `changed_ids:["region:<name>"]`.
- Item-derived bounds are not strongly verified. `{name,item_id}` skips
  `pos` / `rgnend` because `params.start` / `params.end` are absent and
  both fields are optional.
- `render_region` remains the permanent `expectedDelta` artifact-path
  carve-out with no structural or field verifier.

Verification so far:

- Focused registry / call-template / list-templates /
  manifest-alignment / Lua-structure tests passed: **90/90**.
- Full static gates passed after the owner fix: `npm test`
  **293/293**, `npm run build` clean, `npm run check:manifest` green,
  `npm run check:error-codes-fresh` green, and `git diff --check`
  clean. Focused Slice 13 suite was 90/90 before the owner fix; the
  extra bridge-structure guard raises the full test count by one.
- Reviewer pass completed with no P1/P2/P3 findings.
- First live smoke attempt `slice13-1782808140769` passed S0/S1 and
  confirmed the three-field `region_create` metadata plus
  `render_region` carve-out, then stopped at S2b with the double-owner
  `LAST_RESULT` split described above. No docs were flipped to ✅.
- REAPER re-smoke passed after the user's full REAPER restart and
  current bridge load. Run id: `slice13-1782809548082`; queue:
  `/Users/Zhuanz/Library/Application Support/Streetlight/queue`;
  REAPER `7.71/macOS-arm64`. User-provided console preflight showed a
  single current `bridge ready (generation 1)` and `loaded error_codes
  (22 codes)`.
- S0/S1: `ping` connected; `list_templates` returned 11 templates.
  `region_create.expectedDelta.fields[]` was exactly
  `[name,pos,rgnend]`; `pos` and `rgnend` carried `optional:true` and
  `tolerance:1e-6`; `render_region` still had no `expectedDelta`.
- S2 owner-guard regression: `track_create` returned
  `guid:{1AFDB38A-6C5E-7E49-B618-33FF483AFBA2}`, and the immediately
  following `media_import track_id:"last_result:track:0"` returned
  item `guid:{CF9CC998-3614-E243-A15A-7A7F0C078627}`. The prior
  double-owner `LAST_RESULT` split did not recur.
- S3/S4/S5: explicit simple region
  `slice13-1782809548082-explicit-simple` round-tripped `[0,1]`;
  explicit nontrivial region
  `slice13-1782809548082-explicit-nontrivial` round-tripped
  `[7.13,13.71]`; item-mode region
  `slice13-1782809548082-item-mode` passed with name-only verify via
  optional bounds skip.
- S6/S8/S9/S10: raw mismatch probes returned `VERIFY_FAILED` with
  `recoverable:false` for unsupported field `posX`, missing
  `startX` without optional, numeric `pos <- end` mismatch
  (`expected:1`, `actual:0`, `tolerance:1e-6`), and structural
  count `2` vs actual `1`. Structural mismatch took priority and did
  not include top-level `details.fields[]`.
- S11: failed verifies did not pollute `LAST_RESULT`.
  `track_rename` and `item_move` still hit the original track/item, and
  a fresh successful region
  `slice13-1782809548082-lr-region-after-fails` became the only
  `last_result:region:0` target for a render probe.
- S12/S13/S14/S15: representative `item_trim` optional,
  `item_fade` nullable, `item_duplicate`, `track_create` reuse, and
  `media_import` first-item regressions passed. Error probes covered
  `REGION_NAME_INVALID`, `REGION_NAME_TAKEN`, `ITEM_NOT_FOUND`,
  `MEDIA_NOT_FOUND`, `PARAMS_INVALID`, and `SCOPE_NOT_IMPLEMENTED`.
  `get_state(tracks, include:["fx"])` passed; render include returned
  `PARAMS_INVALID`; bare render returned `SCOPE_NOT_IMPLEMENTED`;
  `get_state(regions)` showed happy and orphan region names. Final
  `render_region` produced exactly one WAV path for
  `slice13-1782809548082-explicit-simple`; the file was RIFF/WAVE,
  stereo, 24-bit, and the temp dir was deleted.
- Queue cleanup after the run: `pending=0`, `running=0`, `done=0`.

Regression notes verified by live smoke:

- Full quit/reopen REAPER before loading the current `start_bridge.lua`.
  Slice 13 now changes `streetlight_bridge.lua` for the owner guard, and
  the current MCP server sends a three-field `region_create` manifest.
  If the console shows two ready blocks, the owner token should make the
  older owner self-exit before it can claim queue files.
- `list_templates` should show `region_create.expectedDelta.fields[]`
  as `[name, pos, rgnend]`, with `pos` and `rgnend` carrying
  `optional:true` and `tolerance:1e-6`.
- Explicit-mode `region_create {name,start,end}` should verify all
  three fields. Use both simple bounds and non-trivial bounds such as
  `start:7.13,end:13.71`.
- Item-mode `region_create {name,item_id}` should still pass by
  verifying only `name`; `pos` and `rgnend` skip via optional-absent.
- Raw mismatch paths should cover unsupported region field, paramPath
  missing without optional, numeric mismatch by field/param mismatch,
  and structural mismatch priority. Create + `VERIFY_FAILED` may leave
  orphan regions and must not update `LAST_RESULT`.

### Kernel hardening Slice 12 (2026-06-30) — region_create region-scope name field verification ✅ live-smoked / pushed `6e4a02f`

Scope: extend H2 field verification to `region_create` and add the
first `region` field scope. This is intentionally name-only: it proves
the `region:NAME` changed-id shape, parser, scanner, and reader are
live, while keeping `pos` / `rgnend` bounds verification for a later
two-mode paramPath decision.

What changed:

- `docs/plans/SLICE_12_ARCHITECT_PLAN.md` — Architect packet copied
  into the repo for future windows.
- `packages/core/src/registry.ts` — `FieldCheckDescriptor.scope` and
  `FIELD_CHECK_SCOPES` now include `"region"`. Existing D5 boundaries
  remain: `deletes:true` with fields is still rejected; `maybeCreates`
  still requires a finite positive numeric count; `creates:true` still
  accepts finite positive numeric count or `"any"`.
- `packages/mcp-server/src/templates/region-create.ts` —
  `region_create.expectedDelta` expands from `{count:1, creates:true}`
  to `{count:1, creates:true, fields:[...]}` with one descriptor:
  region `name` from `params.name`.
- `reaper/packs/core/verify.lua` — adds `parse_region_ref`,
  `find_region_by_name`, `read_region_field`, and `FIELD_READERS.region`.
  The region reader resolves name-shaped `region:NAME` refs to a
  synthetic `{index,pos,rgnend,name}` handle and supports `name`, `pos`,
  and `rgnend`; Slice 12 only declares `name`.
- `scripts/manifest-alignment.mjs` — mirrors the registry field-scope
  expansion so CLI alignment and runtime registration cannot drift.
- Tests updated:
  - registry tests accept region-scope descriptors, future numeric
    region fields with tolerance, and reject dotted paramPath /
    duplicates for region scope.
  - call-template tests assert explicit and item-mode `region_create`
    send the same region `name` field descriptor over the wire.
  - list-templates tests assert `region_create` is now the tenth covered
    field-verify template and keeps its descriptor free of `tolerance`,
    `optional`, and `nullable`.
  - manifest-alignment tests accept region scope and guard all four
    legal scopes.
  - Lua structure tests assert `verify.lua` has the region parser /
    reader, stays decoupled from `refs.lua`, and still does not loop over
    every `changed_id`.

Decisions locked by user:

- D1=a: `region_create` in Slice 12.
- D2=a: verify only region `name`.
- D3=a: synthetic region struct `{index,pos,rgnend,name}`.
- D4=a: verify-local region scanner; do not reuse `refs.lua`.
- D5=a: strict string equality.
- D6=a: document the pipeline proof-of-life in `docs/TEMPLATE_SPEC.md`.
- D7=a: document that create + `VERIFY_FAILED` may leave orphan regions.

Not changed:

- `region_create` Lua handler is unchanged; it still returns
  `changed_ids = {"region:" .. params.name}` and owns
  `REGION_NAME_INVALID` / `REGION_NAME_TAKEN`.
- `refs.lua` is unchanged. Agent-facing region refs still use v0.1
  name-shaped refs; GUID-shaped region refs remain unsupported.
- `streetlight_bridge.lua` is unchanged. The order remains structural
  check, field check, then `LAST_RESULT` finalize.
- `render_region` still omits `expectedDelta` and keeps the artifact
  path carve-out.
- Region bounds (`pos` / `rgnend`) are not declared in Slice 12.

Verification:

- Focused registry / call-template / list-templates /
  manifest-alignment / Lua-structure tests passed: **89/89**.
- Full static gates passed: `npm test` **291/291**, `npm run build`
  clean, `npm run check:manifest` green, and
  `npm run check:error-codes-fresh` green.
- `git diff --check` clean.
- Focused reviewer pass found no P1/P2. The only P3 doc nit was stale
  `docs/TEMPLATE_SPEC.md` wording that still called
  `last_result:region:N` future-facing; it is fixed.
- REAPER live smoke passed after the user fully restarted REAPER and
  loaded the current bridge. Console preflight showed generation 1,
  `loaded error_codes (22 codes)`, and the current template list.
  Smoke run id: `slice12-1782804345538`; queue:
  `/Users/Zhuanz/Library/Application Support/Streetlight/queue`.
- S0 `ping` returned `bridge:"connected"` and
  `reaper_version:"7.71/macOS-arm64"`.
- S1 `list_templates` reported 11 templates.
  `region_create.expectedDelta` was exactly
  `{count:1, creates:true, fields:[{scope:"region", field:"name",
  paramPath:"name"}]}` with no `tolerance`, `optional`, or
  `nullable`; `render_region` still had no `expectedDelta`.
- S2/S3 happy paths passed: explicit region
  `slice12-1782804345538-explicit` and item-derived region
  `slice12-1782804345538-item` returned ok with
  `changed_ids:["region:<name>"]`; `get_state regions` read both back.
- S4 forced raw field mismatch passed: raw queue created orphan region
  `slice12-1782804345538-raw-orphan` but expected
  `slice12-1782804345538-raw-expected-other`, returning
  `VERIFY_FAILED`, `recoverable:false`, and
  `details.fields[0] = {scope:"region", field:"name",
  expected:"slice12-1782804345538-raw-expected-other",
  actual:"slice12-1782804345538-raw-orphan", ok:false}`.
- S5 `LAST_RESULT` regression passed: read scopes did not pollute a
  prior `last_result:item:0`; failed verify did not update
  `LAST_RESULT`, proven by a following
  `region_create item_id:"last_result:item:0"` producing
  `slice12-1782804345538-lr-item-after-fail`; and
  `last_result:track:0` survived `get_state project` before a
  follow-up `media_import`.
- S6 regression codes passed:
  `REGION_NAME_INVALID`, `REGION_NAME_TAKEN`, cross-type
  `REF_INVALID`, `PARAMS_INVALID`, and `SCOPE_NOT_IMPLEMENTED` for
  `get_state(render)`.
- S7 prior H2 representatives passed: `item_trim` optional field,
  `item_fade` nullable field, `media_import` first-item `D_POSITION`,
  `track_create` name, and `item_duplicate` `D_POSITION`.
- S8 `render_region` carve-out passed: region
  `slice12-1782804345538-render` rendered to a temp directory with
  `changed_ids` containing only the WAV path; `/usr/bin/file` reported
  `WAVE audio, Microsoft PCM, 24 bit, stereo 48000 Hz`; the temp render
  dir was removed. Queue cleanup check ended with
  `pending=0`, `running=0`, `done=0`.

### Kernel hardening Slice 11 (2026-06-30) — media_import count:any first-item field verification ✅ live-smoked

Scope: extend H2 field verification to `media_import` and split the
D5 boundary for the first `creates:true` + `count:"any"` template. This
is deliberately not a multi-item verifier: the bridge checks only
`changed_ids[1]` and leaves any additional imported ids un-field-checked.

What changed:

- `docs/plans/SLICE_11_ARCHITECT_PLAN.md` — Architect packet copied
  into the repo for future windows.
- `packages/core/src/registry.ts` — `expectedDelta.fields[]` may now
  coexist with `creates:true` when `count` is either a finite positive
  integer or `"any"`. `maybeCreates:true` still requires a finite
  positive numeric count. The guard still rejects fields with
  `deletes:true`, invalid creates counts, invalid maybeCreates counts,
  duplicate fields, all-optional non-nullable fields, and region scope.
- `packages/mcp-server/src/templates/media-import.ts` —
  `media_import.expectedDelta` expands from
  `{count:"any", creates:true}` to
  `{count:"any", creates:true, fields:[...]}` with one descriptor:
  item `D_POSITION` from `params.position`, tolerance `1e-6`.
- `scripts/manifest-alignment.mjs` — mirrors the registry D5 boundary
  so CLI alignment and runtime registration cannot drift.
- Tests updated:
  - registry tests accept `creates:true` + `count:"any"` + fields and
    still reject invalid creates counts.
  - call-template tests assert the on-wire `media_import`
    `expected_delta` includes `creates:true`, `count:"any"`, and item
    `D_POSITION`, with no `optional` / `nullable`.
  - list-templates tests assert `media_import` is now the ninth covered
    field-verify template and keeps its descriptor free of `optional` /
    `nullable`.
  - manifest-alignment tests mirror the legal / illegal D5 matrix.
  - Lua structure tests assert Slice 11 stays first-changed-id only and
    did not add region field verification scope or region ref parsing
    to `verify.lua`.

Decisions locked by user:

- D1=a: only `media_import` in Slice 11.
- D2=a: first-item verify only (`changed_ids[1]`), not all imported
  items.
- D3=a: verify only item `D_POSITION`.
- D4=a: document the `count:"any"` first-item contract in
  `docs/TEMPLATE_SPEC.md`.
- D5=a: tolerance `1e-6`.
- D6=a: a failed field verify may leave an orphan imported item, but
  must not update `LAST_RESULT`.

Not changed:

- No Lua runtime files changed. `reaper/packs/core/verify.lua` already
  resolves `changed_ids[1]` as a GUID item ref and reads item
  `D_POSITION`, so `media_import` uses the Slice 06 path.
- `region_create` remains `{count:1, creates:true}` with no fields;
  region scope / `region:NAME` changed-id verification is deferred to
  Slice 12+.
- `render_region` still omits `expectedDelta` and keeps the artifact
  path carve-out.

Verification so far:

- Focused registry / call-template / list-templates /
  manifest-alignment / Lua-structure tests passed: **82/82**.
- Full static gates passed: `npm test` **284/284**, `npm run build`
  clean, `npm run check:manifest` green, and
  `npm run check:error-codes-fresh` green.
- `git diff --check` clean.
- REAPER live smoke passed on `7.71/macOS-arm64` after the user
  restarted REAPER and loaded the current bridge. Console precondition:
  generation 1, queue
  `/Users/Zhuanz/Library/Application Support/Streetlight/queue`,
  loaded pack `core`, loaded 22 error codes, bridge ready with all 11
  templates.
- Smoke run id / timestamp:
  `slice11-202606300552524` /
  `2026-06-30T05:52:52.495Z`.
- `ping` returned `{bridge:"connected", reaper_version:"7.71/macOS-arm64"}`.
- `list_templates` confirmed `media_import.expectedDelta` is
  `count:"any" + creates:true + fields:[item D_POSITION <- position]`
  with tolerance `1e-6`, no `optional`, no `nullable`. `region_create`
  remained `{count:1, creates:true}` with no fields, and
  `render_region` still omitted `expectedDelta`.
- Smoke setup created track
  `guid:{543A670E-D2F5-9349-A56E-6F815A68FE74}` named
  `SL11 Smoke slice11-202606300552524`, later renamed to
  `SL11 Smoke slice11-202606300552524 last-result-survived`.
- Happy `media_import` imported `/System/Library/Sounds/Ping.aiff` at
  `position:3.25`, returned item
  `guid:{3564616B-EC9C-DD48-86B8-F5746029D77E}`, `changed_count:1`,
  and the descriptor verifier accepted item `D_POSITION` from
  `params.position` within `1e-6`.
- Forced raw mismatch sent `media_import` with `position:4.5` but
  `expected_delta.fields[0].param_path:"expected_position"` where
  `expected_position=12345.6789`. It returned `VERIFY_FAILED`,
  `recoverable:false`, included the recovery phrase
  "call get_state to inspect actual state", and carried
  `details.fields[0]={scope:"item", field:"D_POSITION",
  expected:12345.6789, actual:4.5, tolerance:0.000001, ok:false}`.
  The resulting orphan import was identified as
  `guid:{3E6B8A15-8472-1D40-8AF6-6320008B8CB7}` at `4.5`.
- `LAST_RESULT` was not polluted by the forced `VERIFY_FAILED`: after
  anchoring `LAST_RESULT` to the smoke track, a post-failure
  `track_rename track_id:"last_result:track:0"` still returned
  `guid:{543A670E-D2F5-9349-A56E-6F815A68FE74}`.
- Regressions passed: `get_state(project/tracks/regions)` ok;
  `get_state(render)` returned `SCOPE_NOT_IMPLEMENTED`;
  `region_create` stayed fieldless and returned
  `region:SL11_slice11-202606300552524_region`; queue cleanup ended
  with empty `pending/`, `running/`, and `done/`.
- REAPER project leftovers for manual Cmd+Z/delete: the smoke track
  `guid:{543A670E-D2F5-9349-A56E-6F815A68FE74}`, happy import item
  `guid:{3564616B-EC9C-DD48-86B8-F5746029D77E}`, forced mismatch orphan
  item `guid:{3E6B8A15-8472-1D40-8AF6-6320008B8CB7}`, and region
  `SL11_slice11-202606300552524_region`.

### Kernel hardening Slice 10 (2026-06-30) — track_create maybeCreates field verification ✅ live-smoked

Scope: extend H2 field verification to `track_create` and split the
D5 boundary for the first maybeCreates-style template. This is the
smallest maybeCreates slice: track entity kind, GUID-shaped
`changed_ids[1]`, numeric `count:1`, track-scope `P_NAME`, string
equality, and no Lua verifier changes.

What changed:

- `docs/plans/SLICE_10_ARCHITECT_PLAN.md` — Architect packet copied
  into the repo for future windows.
- `packages/core/src/registry.ts` — `expectedDelta.fields[]` may now
  coexist with `maybeCreates:true` only when `count` is a finite
  positive integer. Slice 09's `creates:true` numeric-count rule is
  preserved. The guard still rejects fields with `deletes:true` and
  `creates:true` plus `count:"any"`. Existing field descriptor rules
  remain unchanged.
- `packages/mcp-server/src/templates/track-create.ts` —
  `track_create.expectedDelta` expands from
  `{count:1, maybeCreates:true}` to
  `{count:1, maybeCreates:true, fields:[...]}` with one descriptor:
  track `P_NAME` from `params.name`, no tolerance.
- `scripts/manifest-alignment.mjs` — mirrors the registry D5 boundary
  so CLI alignment and runtime registration cannot drift.
- Tests updated:
  - registry tests accept `maybeCreates:true` with numeric count +
    fields and reject `maybeCreates` with `count:"any"` / `count:0`.
  - call-template tests assert the on-wire `track_create`
    `expected_delta` includes `maybeCreates:true` plus track `P_NAME`
    and omits `tolerance` / `optional` / `nullable`.
  - list-templates tests assert `track_create` is now the eighth
    covered field-verify template and keeps its descriptor free of
    `tolerance` / `optional` / `nullable`.
  - manifest-alignment tests mirror the legal / illegal D5 matrix.
  - Lua structure tests assert Slice 10 did not add region field
    verification scope or region ref parsing to `verify.lua`.

Decisions locked by user:

- D1=a: only `track_create` in Slice 10.
- D2=a: relax D5 for `maybeCreates:true`, not `count:"any"`.
- D3=a: verify only track `P_NAME`.
- D4=a: reuse path still runs field verification.
- D5=a: no tolerance for string `P_NAME`.
- D6=a: a failed create-path field verify may leave an orphan track,
  but must not update `LAST_RESULT`; reuse-path failure should leave no
  orphan.

Not changed:

- No Lua runtime files changed. `reaper/packs/core/verify.lua` already
  resolves `changed_ids[1]` as a GUID track ref and reads track
  `P_NAME`, so `track_create` uses the Slice 06 path.
- `media_import` remains `{count:"any", creates:true}` with no fields
  and is deferred to Slice 11+.
- `region_create` remains `{count:1, creates:true}` with no fields;
  region scope / `region:NAME` changed-id verification is deferred to
  Slice 12+.
- `render_region` still omits `expectedDelta` and keeps the artifact
  path carve-out.

Verification so far:

- Focused registry / call-template / list-templates tests passed.
- Focused manifest-alignment / Lua-structure tests passed.
- Full static gates passed: `npm test` **278/278**, `npm run build`
  clean, `npm run check:manifest` green, and
  `npm run check:error-codes-fresh` green.
- `git diff --check` clean.
- Reviewer pass completed with no P1/P2 issues. The reviewer only found
  P3 doc-state nits (static baseline / remaining-action wording), fixed
  in the pre-smoke docs sync.
- REAPER live smoke S0-S17 passed on REAPER 7.71/macOS-arm64. Console
  precondition showed `bridge starting (generation 1)`,
  `loaded error_codes (22 codes)`, and `bridge ready (generation 1)`.
  Run timestamp: `20260630032823069`.
- `list_templates` reported 11 templates. `track_create.expectedDelta`
  was `count:1 + maybeCreates:true + fields:[track P_NAME <- name]`,
  with no `tolerance`, `optional`, or `nullable`.
- `track_create` create path passed with `delta_tracks=+1` and `P_NAME`
  verified. Reuse path passed with the same GUID, `delta_tracks=0`, and
  `P_NAME` verified.
- Raw `P_NAMEX` mismatch returned `VERIFY_FAILED` with
  `details.fields[]`, `recoverable:false` on both create and reuse
  paths. Both failure paths left `LAST_RESULT` unchanged.
- Slice 06-09 regressions, `get_state`, and `render_region` passed.
  `render_region` temp output was WAV-only and deleted; queue teardown
  was clean.
- Main test track GUID:
  `guid:{5AACF036-56CF-7141-8F1D-925A1457FDB2}`.
- Expected REAPER project leftovers from verify-failure side effects:
  `force-c-20260630032823069`,
  `Slice10 PP 20260630032823069`, and
  `Slice10 SM 20260630032823069`. S8 reuse mismatch created no orphan.

Regression notes to carry:

- D5 is still not global. Do not add fields to `media_import` or
  `region_create` without a new Architect packet.
- Create-path `VERIFY_FAILED` may leave a real orphan track while
  intentionally not updating `LAST_RESULT`; reuse-path `VERIFY_FAILED`
  should not create anything. Slice 10 live smoke verified both.

### Kernel hardening Slice 09 (2026-06-30) — item_duplicate creates field verification ✅ live-smoked / pushed `bf15daa`

Scope: extend H2 field verification to `item_duplicate` and split the
D5 boundary for the first creates-style template. This is deliberately
the smallest creates slice: item entity kind, GUID-shaped
`changed_ids[1]`, numeric `count:1`, item-scope `D_POSITION`, and no
Lua verifier changes.

What changed:

- `docs/plans/SLICE_09_ARCHITECT_PLAN.md` — Architect packet copied
  into the repo for future windows.
- `packages/core/src/registry.ts` — `expectedDelta.fields[]` may now
  coexist with `creates:true` only when `count` is a finite positive
  integer. The guard still rejects fields with `maybeCreates:true`,
  `deletes:true`, and `creates:true` plus `count:"any"`. Existing field
  descriptor rules remain unchanged: scopes are still `take` / `item` /
  `track`, duplicate `(scope,field)` pairs are rejected, `paramPath`
  stays top-level, tolerance must be finite and non-negative, and
  `optional` / `nullable` rules are unchanged.
- `packages/mcp-server/src/templates/item-duplicate.ts` —
  `item_duplicate.expectedDelta` expands from `{count:1, creates:true}`
  to `{count:1, creates:true, fields:[...]}` with one descriptor:
  item `D_POSITION` from `params.position`, tolerance `1e-6`.
- `scripts/manifest-alignment.mjs` — mirrors the registry D5 boundary
  so CLI alignment and runtime registration cannot drift.
- Tests updated:
  - registry tests accept `creates:true` with numeric count + fields and
    reject `maybeCreates`, `deletes`, `count:"any"`, and `count:0`.
  - call-template tests assert the on-wire `item_duplicate`
    `expected_delta` includes `creates:true` plus item `D_POSITION` and
    omits `optional` / `nullable`.
  - list-templates tests assert `item_duplicate` is now the seventh
    covered field-verify template and keeps its descriptor free of
    `optional` / `nullable`.
  - manifest-alignment tests mirror the legal / illegal D5 matrix.
  - Lua structure tests assert Slice 09 did not add region field
    verification scope or region ref parsing to `verify.lua`.

Decisions locked by user:

- D1=a: only `item_duplicate` in Slice 09.
- D2=a: relax D5 only for `creates:true`, not `maybeCreates:true`.
- D3=a: fields with `creates:true` require numeric positive count;
  `count:"any"` remains rejected.
- D4=a: verify only item `D_POSITION`.
- D5=a: `D_POSITION` tolerance `1e-6`.

Not changed:

- No Lua runtime files changed. `reaper/packs/core/verify.lua` already
  resolves `changed_ids[1]` as a GUID item ref and reads item
  `D_POSITION`, so `item_duplicate` uses the Slice 06 path.
- `track_create` remains `{count:1, maybeCreates:true}` with no fields
  and is deferred to Slice 10.
- `media_import` remains `{count:"any", creates:true}` with no fields
  and is deferred to Slice 11+.
- `region_create` remains `{count:1, creates:true}` with no fields;
  region scope / `region:NAME` changed-id verification is deferred to
  Slice 12+.
- `render_region` still omits `expectedDelta` and keeps the artifact
  path carve-out.

Verification so far:

- Focused registry / call-template / list-templates tests passed.
- Focused manifest-alignment / Lua-structure tests passed.
- Full static gates passed: `npm test` **272/272**, `npm run build`
  clean, `npm run check:manifest` green,
  `npm run check:error-codes-fresh` green, and `git diff --check`
  clean.
- Reviewer pass completed: no P1/P2. P3 nits fixed by recording
  `git diff --check` in the Slice 09 static baseline and adding a
  manifest-alignment redline for `deletes:true + fields[]`.
- REAPER live smoke passed on REAPER 7.71/macOS-arm64 after full
  quit/reopen and current `start_bridge.lua` run. Console evidence:
  `bridge starting (generation 1)`, queue dir
  `/Users/Zhuanz/Library/Application Support/Streetlight/queue`,
  `loaded error_codes (22 codes)`, and
  `bridge ready (generation 1) — loaded error_codes (22 codes)` with
  all 11 templates. Evidence snapshot:
  `/tmp/streetlight_slice09_live_smoke_evidence.json`; run id
  `slice09-1782785591409`.

Live smoke evidence:

- S0/S1: `ping` returned `bridge:connected`,
  `reaper_version=7.71/macOS-arm64`. `list_templates` returned 11
  templates. `item_duplicate.expectedDelta` was exactly
  `{count:1,creates:true,fields:[{scope:"item",field:"D_POSITION",
  paramPath:"position",tolerance:1e-6}]}` and the field descriptor had
  no `optional` / `nullable`. `track_create`, `media_import`, and
  `region_create` still had no `fields`; `render_region` still had no
  `expectedDelta`.
- S2/S3: happy `item_duplicate` verified new-item `D_POSITION`.
  Source track `guid:{BD97197C-6669-7344-8FDF-4E34CC6DC152}`;
  source item `guid:{EEB0E942-456D-FD4F-AF89-C633E1882ECB}`;
  same-track duplicate
  `guid:{F21B1BCA-29D3-B048-A690-8D97CAB24A50}` at 2.5s; target track
  `guid:{365AD42A-7CBA-9C4C-8E3A-705EDA1CE883}`; cross-track
  duplicate `guid:{FD377B79-195D-5B45-AD97-A18EA4C89CF3}` at 0s.
- S4-S6: Slice 08/07/06 regressions passed on the cross-track
  duplicate: `item_fade fade_in:null`, `item_trim length:1.0`,
  `item_pitch semitones:-3`, and `item_move position:5.0`.
- S7/S8: raw queue field mismatch changed the descriptor field to
  `D_POSITIONX` while params kept `position:7.7`. Handler created a
  real duplicate at 7.7s on the target track, then field verification
  returned `VERIFY_FAILED`, `recoverable:false`, with
  `details.fields[0]={scope:"item",field:"D_POSITIONX",expected:7.7,
  actual:0,ok:false,tolerance:1e-6}` and the Slice 04 recovery phrase.
  `LAST_RESULT` was not polluted: follow-up
  `item_pitch last_result:item:0 semitones:0` still changed
  `guid:{FD377B79-195D-5B45-AD97-A18EA4C89CF3}`, not the S7 orphan.
- S9/S10: raw bad `param_path:"positionX"` returned
  `VERIFY_FAILED` with `details.fields[]`; raw structural mismatch
  `count:2` returned structural `VERIFY_FAILED` first and omitted
  top-level `details.fields`.
- S11/S12: error-code and get_state regressions passed:
  `selected:99` -> `ITEM_NOT_FOUND`, nonexistent target track ->
  `TRACK_NOT_FOUND`, `region_create bad/name` ->
  `REGION_NAME_INVALID`, `get_state(tracks, include:["fx"])` -> OK,
  `get_state(render, include:["fx"])` -> `PARAMS_INVALID`, and bare
  `get_state(render)` -> `SCOPE_NOT_IMPLEMENTED`.
- S13/S14: `render_region` carve-out passed. Region
  `slice09-r-1782785591409` rendered only
  `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/streetlight_slice09_live_smoke_1782785591409/renders/slice09-r-1782785591409.wav`
  (288736 bytes), with absolute WAV path in `changed_ids`, no `.RPP` /
  `.RPP-bak`, and the temp render dir removed after inspection.
  `track_create reuse_existing:true` create/reuse returned the same
  GUID `guid:{0B774446-531C-8F47-ADDA-50D98F2391BA}` and still had no
  fields metadata.

Regression notes to carry:

- D5 is only partially relaxed. Do not add fields to `track_create`,
  `media_import`, or `region_create` without a new Architect packet.
- A `VERIFY_FAILED` after a creates handler may leave a real project
  entity behind while intentionally not updating `LAST_RESULT`. Slice 09
  live smoke verified this exact side effect: the S7 orphan duplicate at
  7.7s on the target track is expected project state and is not in
  `LAST_RESULT`.

### Kernel hardening Slice 08 (2026-06-30) — item_fade nullable field verification ✅ live-smoked / pushed `c923df9`

Scope: extend the Slice 06/07 field-verification infrastructure to
`item_fade` and introduce nullable field descriptors for explicit JSON
`null` params that intentionally clear a REAPER field to zero.

What changed:

- `docs/plans/SLICE_08_ARCHITECT_PLAN.md` — Architect packet copied
  into the repo for future windows.
- `packages/core/src/registry.ts` — `FieldCheckDescriptor` adds
  `nullable?: boolean`. Validation rejects non-boolean `nullable` and
  revises the Slice 07 all-optional guard: all-optional `fields[]` is
  legal only when every field is also `nullable:true`.
- `packages/mcp-server/src/templates/item-fade.ts` — `item_fade` now
  declares two field checks: item `D_FADEINLEN` from `params.fade_in`,
  and item `D_FADEOUTLEN` from `params.fade_out`. Both fields are
  `optional:true`, `nullable:true`, and use tolerance `1e-6`.
- `packages/mcp-server/src/tools/call-template.ts` — wire mapping now
  includes `nullable` when present. The success envelope remains the
  locked `{template, changed_count, changed_ids, truncated}` shape.
- `scripts/manifest-alignment.mjs` — static descriptor checks now
  enforce boolean `nullable` and mirror the all-optional/all-nullable
  rule.
- `reaper/packs/core/verify.lua` — `check_fields()` now accepts bridge
  handler `ctx`, still skips absent optional params, and coerces
  explicit `ctx.json.null` to expected value `0` only when the field has
  `nullable:true`. Explicit `json.null` without `nullable:true` becomes
  a field mismatch.
- `reaper/streetlight_bridge.lua` — passes the same handler `ctx` into
  `verify.check_fields()` so verify compares against the exact
  `ctx.json.null` sentinel used by handlers. This avoids dofile'ing a
  second JSON module and splitting sentinel identity.

Decisions locked by user:

- D1=a: only `item_fade` in Slice 08.
- D2=a: `nullable:true` + explicit `json.null` means expected value `0`.
- D3=a: TS / wire / Lua all use the name `nullable`.
- D4=a: all-optional `fields[]` is legal iff every field is nullable.
- D5=a: `D_FADEINLEN` / `D_FADEOUTLEN` tolerance `1e-6`.

Verification so far:

- Focused registry/build tests passed.
- Focused call-template/list-templates wire tests passed.
- Focused manifest-alignment/check:manifest passed.
- Focused lua-structure/check:error-codes-fresh passed.
- Full static baseline passed: `npm run build`, `npm test` (263/263),
  `npm run check:manifest`, `npm run check:error-codes-fresh`, and
  `git diff --check`. Reviewer pass completed with no P1/P2; two P3
  doc-only status nits were fixed.
- REAPER live smoke passed on REAPER 7.71/macOS-arm64 after the user
  fully quit/reopened REAPER and ran the current launcher. Console
  showed `bridge starting (generation 1)`, `loaded error_codes
  (22 codes)`, and `bridge ready (generation 1) — loaded error_codes
  (22 codes)`.

Live smoke:

- `ping` returned `{bridge:"connected", reaper_version:"7.71/macOS-arm64"}`.
- `list_templates` returned 11 templates and showed
  `item_fade.expectedDelta.fields` with item `D_FADEINLEN ← fade_in`
  and item `D_FADEOUTLEN ← fade_out`, both `optional:true` and
  `nullable:true`. `item_trim` stayed Slice 07-shaped:
  `D_STARTOFFS optional:true` with no `nullable`.
- Happy paths passed: `item_fade fade_in:0.25` verified
  `D_FADEINLEN` and skipped absent `fade_out`;
  `fade_in:0.1 fade_out:0.5` verified both fields;
  `fade_in:null` verified `D_FADEINLEN` as `0` and skipped absent
  `fade_out`; `fade_in:null fade_out:null` verified both fields as
  `0`.
- Regressions passed: Slice 07 `item_trim` length-only still
  succeeded with absent `start_offset` skipped; Slice 06 `item_pitch`
  and `item_move` happy paths passed; `item_fade selected:99`
  returned `ITEM_NOT_FOUND`; `region_create name:"bad/name"`
  returned `REGION_NAME_INVALID`.
- Raw verifier paths passed: bad field
  `D_FADEINLEN_BAD` returned `VERIFY_FAILED`, `recoverable:false`,
  with `details.fields[]`; a following `item_move
  last_result:item:0` still hit the pre-failure item, proving
  `LAST_RESULT` was not polluted. Raw `fade_in:null` without
  `nullable:true` returned `VERIFY_FAILED` with `json.null` in field
  details. Raw absent `fade_in` / `fade_out` with optional fields
  succeeded. Raw structural mismatch (`count:2`) failed before field
  verification and omitted top-level `details.fields`.
- get_state include regression passed (`tracks include:["fx"]`
  returned track descriptors with `fx:[]`; include outside tracks
  returned `PARAMS_INVALID`), and `render_region` carve-out passed:
  changed id was only the absolute WAV path and no sidecars remained.

Live-smoke evidence:

- Queue: `/Users/Zhuanz/Library/Application Support/Streetlight/queue`.
- Smoke track: `guid:{44E9538D-5AD6-9F45-8F0F-058785455975}`.
- Smoke items:
  `guid:{336D3720-C74E-B44E-BC94-5D907602A734}` and
  `guid:{CA7165CD-B62E-E442-890E-44474DBB3D45}`.
- Render artifact:
  `/tmp/streetlight_slice08_live_smoke/renders/slice08_render_1782758242169.wav`
  (`file`: RIFF/WAVE Microsoft PCM, 24 bit, stereo, 48000 Hz), with
  no `.RPP` or `.RPP-bak` sidecars.
- Full machine-readable evidence:
  `/tmp/streetlight_slice08_live_smoke/evidence.json`.

### Kernel hardening Slice 07 (2026-06-30) — item_trim optional field verification ✅ live-smoked

Scope: extend the Slice 06 field-verification infrastructure to
`item_trim` and introduce optional field descriptors for params that are
validly absent.

What changed:

- `packages/core/src/registry.ts` — `FieldCheckDescriptor` adds
  `optional?: boolean`. Validation rejects non-boolean `optional` and
  all-optional `fields[]` lists. Metadata deep-copy behavior from Slice
  06 still applies.
- `packages/mcp-server/src/templates/item-trim.ts` — `item_trim` now
  declares two field checks: item `D_LENGTH` from `params.length`, and
  take `D_STARTOFFS` from `params.start_offset` with `optional:true`.
- `packages/mcp-server/src/tools/call-template.ts` — wire mapping now
  includes `optional` when present. The descriptor remains stable
  whether or not `start_offset` is supplied in params.
- `scripts/manifest-alignment.mjs` — static descriptor checks now
  enforce boolean `optional` and reject all-optional field lists.
- `reaper/packs/core/verify.lua` — `check_fields()` skips a field when
  `field.optional == true` and the expected param is absent. All other
  comparison behavior remains Slice 06 behavior.

Decisions locked by user:

- D1=a: only `item_trim` in Slice 07.
- D2=a: optional field with absent param is skipped and treated as ok.
- D3=a: TS / wire / Lua all use the name `optional`.
- D4=a: `D_STARTOFFS` tolerance `1e-6`.
- D5=a: reject all-optional `fields[]`.

Verification:

- Focused registry/build tests passed.
- Focused call-template/list-templates wire tests passed.
- Focused manifest-alignment/check:manifest passed.
- Focused lua-structure/check:error-codes-fresh passed.
- Full static baseline passed: `npm run build`, `npm test` (257/257),
  `npm run check:manifest`, `npm run check:error-codes-fresh`, and
  `git diff --check`.
- Reviewer pass completed. Two P3 doc-only nits were fixed before handoff:
  `docs/TEMPLATE_SPEC.md` now includes `optional?: boolean` in the
  `ExpectedDelta.fields[]` TypeScript snippet, and this section no
  longer contradicted the green static baseline.
- Live smoke passed through the real REAPER bridge queue on
  REAPER 7.71/macOS-arm64 after a full quit/reopen and current
  `start_bridge.lua` reload.

Live-smoke evidence:

- `ping` connected to REAPER 7.71/macOS-arm64.
- `list_templates` returned 11 templates; `item_trim` exposed two field
  checks, with take `D_STARTOFFS` marked `optional:true`.
- `item_trim` length-only passed on retry; live `check_fields` accepted
  item `D_LENGTH` and skipped absent optional `start_offset`.
- `item_trim` length + `start_offset` passed, verifying both item and
  take scopes.
- Slice 06 regressions passed: `item_pitch` and `item_move`.
- Forced field mismatch returned `VERIFY_FAILED`, `recoverable:false`,
  with `details.fields[]`; a follow-up proved `LAST_RESULT` was not
  polluted after verify failure.
- Raw optional-skip path passed.
- Structural mismatch still won before field verify and did not include
  `details.fields`.
- Error-code regressions passed: `ITEM_NOT_FOUND`,
  `REGION_NAME_INVALID`.
- get_state regressions passed.
- `render_region` carve-out passed; a WAV was created and the temporary
  render directory was cleaned.
- First harness pass reported 12/13 because S2 attempted to read the
  item through `get_state(selection)` while the imported item was not
  selected. The actual `item_trim` command had already returned success;
  rerunning S2 with the correct envelope / `check_fields` assertion
  passed.
- Smoke left live REAPER project objects: a `Slice07 Live Smoke ...`
  track/item and a `slice07_live_...` region remain in the currently
  modified project for manual undo/delete.

### Kernel hardening Slice 06 (2026-06-30) — field-level verification ✅ live-smoked

Scope: implement the first H2 field postcheck subset from
`docs/plans/SLICE_06_ARCHITECT_PLAN.md`. Slice 04 verified structural
count deltas; Slice 06 verifies that four in-place setters can be read
back from REAPER after handler success and before `LAST_RESULT` updates.

What changed:

- `packages/core/src/registry.ts` — `ExpectedDelta` now accepts
  optional `fields[]` descriptors with `{scope, field, paramPath,
  tolerance?}`. Validation rejects empty arrays, unknown scope, dotted
  `paramPath`, negative/non-finite tolerance, duplicate `(scope,field)`,
  and, at Slice 06 time, fields on `creates` / `maybeCreates` /
  `deletes` templates. Slice 09 later relaxes only the
  `creates:true` + numeric-count case.
- `packages/mcp-server/src/templates/{item-pitch,item-move,item-rate,track-rename}.ts`
  — four in-place templates declare one field check each:
  `D_PITCH ← semitones`, `D_POSITION ← position`,
  `D_PLAYRATE ← rate`, and `P_NAME ← name`.
- `packages/mcp-server/src/tools/call-template.ts` — converts
  metadata to bridge wire shape inside `expected_delta.fields[]`, using
  `param_path` for Lua while keeping list_templates metadata as
  `paramPath`.
- `scripts/manifest-alignment.mjs` — extends static descriptor
  validation so future templates cannot attach incoherent field checks.
- `reaper/packs/core/verify.lua` — adds `check_fields()` with fixed
  scope readers for item/take/track fields. It resolves the first
  `changed_ids` GUID, reads the field back from REAPER, and compares to
  the declared top-level param value with optional absolute tolerance.
- `reaper/streetlight_bridge.lua` — calls field verification only after
  structural verification passes and before `finalize_template`. On
  mismatch, it returns `VERIFY_FAILED`, `recoverable:false`, compact
  `details.fields[]`, and the existing `call get_state` recovery phrase;
  `LAST_RESULT` is not updated.

Decisions locked by user:

- D1=a: only `item_pitch`, `item_move`, `item_rate`, and
  `track_rename` in Slice 06.
- D2=a: numeric tolerance `1e-6`.
- D3=a: fields nested in `expected_delta`.
- D4=a: field verify failure does not update `LAST_RESULT`.
- D5=a: fields cannot coexist with creates/maybeCreates/deletes until a
  later slice; Slice 09 is that first narrow later slice for
  `creates:true` + numeric count only.

Verification so far:

- Focused registry/build tests passed while implementing.
- Focused call-template/list-templates wire tests passed.
- Focused manifest-alignment/check:manifest passed.
- Focused lua-structure and check:error-codes-fresh passed.
- `npm test` → 254/254 green, `npm run build` → clean, `npm run check:manifest` → green, `npm run check:error-codes-fresh` → green, and `git diff --check` → clean.
- Live REAPER smoke passed on REAPER 7.71/macOS-arm64 after full
  quit/reopen and current `start_bridge.lua` load. Console showed
  generation 1 and `loaded error_codes (22 codes)`.
- Smoke run id `1782752152900` used track
  `guid:{70F9F13F-6930-6848-BAAA-C4CEEEAA3B8B}` and item
  `guid:{D6A8F3D7-6F6E-E74D-8B6B-33BD86BE1B80}`. The four happy
  field-verified paths passed, and zero-tolerance raw probes confirmed
  `D_PITCH=-3`, `D_POSITION=5.0`, and `D_PLAYRATE=0.5`.
- Raw `track_rename` with bad field `P_NAMEX` returned
  `VERIFY_FAILED`, `recoverable:false`, retained the `call get_state`
  recovery phrase, appended `details.fields[0].ok=false`, and did not
  update `LAST_RESULT`.
- Raw structural mismatch still failed before fields and returned no
  top-level `error.details.fields`. Slice 05 error-code and Slice 02
  `get_state include` regressions passed.

Regression notes verified by live smoke:

- Count verify must run before field verify. A forced count mismatch
  should return Slice-04-shaped `VERIFY_FAILED` without `details.fields`.
- Field verify failure should include `details.fields[0]` and should not
  update `LAST_RESULT`.
- Four happy envelopes must keep the locked success shape.
- `render_region` and the seven non-Slice-06 templates must not gain
  `expected_delta.fields`.
- Slice 05 error-code constants must remain intact; no path should
  degrade to `INTERNAL_ERROR`.

### Kernel hardening Slice 05 (2026-06-29) — Lua error-code constants activation ✅

Scope: close the H5 follow-up from
`docs/plans/SLICE_05_ARCHITECT_PLAN.md`. Slice 03 generated
`reaper/packs/core/error_codes.lua` and added static redlines; Slice
05 makes that generated table the runtime source used by the bridge,
refs, and handlers. User-facing behavior is intended to be unchanged:
same wire codes, same messages, same recoverability, same envelope
shapes.

What changed:

- `reaper/streetlight_bridge.lua` — dofile's
  `packs/core/error_codes.lua` at boot; validates key/value identity
  and the expected 22-code count; calls `refs.attach_errs(ERRS)`;
  injects `ctx.errs = ERRS` into template handlers; replaces bridge
  internal literal codes (`PARAMS_INVALID`, `TEMPLATE_NOT_FOUND`,
  `VERIFY_FAILED`, etc.) with `ERRS.*`. The bridge ready log now
  includes `loaded error_codes (22 codes)` so live smoke can prove the
  new boot path is active.
- `reaper/packs/core/refs.lua` — exposes `M.attach_errs(errs)` and
  returns generated `ERRS.*` constants from all resolver failure
  paths while preserving the public resolver API and `(nil, code,
  message)` return convention.
- `reaper/packs/core/templates/{item,track,region,media,render}.lua`
  — handlers keep their local `raise(code, message)` helpers, but the
  code argument now comes from `ctx.errs.*` or from resolver-returned
  codes. Helpers that can raise internal errors receive `errs`
  explicitly instead of dofile'ing the generated module.
- `scripts/error-codes.mjs` — `check` still verifies generated
  freshness and unknown Lua codes, and now rejects known Lua
  string-literal error-code usage in runtime shapes:
  `code = "FOO"`, `raise("FOO")`, `raise(code or "FOO")`, and
  `return nil, "FOO"`. The scan includes
  `reaper/streetlight_bridge.lua` and `reaper/packs/core/**/*.lua`
  except the generated `error_codes.lua`.
- `scripts/__tests__/error-codes.test.mjs` and
  `scripts/__tests__/lua-structure.test.mjs` — guard the stricter
  audit, bridge boot wiring, `ctx.errs`, refs attachment, and the
  no-runtime-literals invariant.

Decisions locked:

- D1 audit strictness: no runtime literal allowances beyond generated
  `error_codes.lua`; boot failures use plain `error("...")` strings,
  not protocol error-code literals.
- D2 injection path: bridge dofile once, pass `ctx.errs` to handlers,
  and attach the same table to `refs.lua`.
- D3 handler raise helpers: keep current local helper shape; do not
  introduce a new global raise abstraction until H6 scaffold/factory
  work.

Verification so far:

- `npm run check:error-codes-fresh` → `Streetlight error codes fresh
  (22 codes).` This now means both freshness and zero forbidden
  runtime literal usage / zero unknown generated-code references.
- Focused tests: `npm test --
  scripts/__tests__/error-codes.test.mjs
  scripts/__tests__/lua-structure.test.mjs` → 15/15 green.
- Reviewer follow-up fixed two audit holes: single-quoted Lua
  error-code literals now fail the scan, and misspelled `ERRS.*` /
  `errs.*` / `ctx.errs.*` references now fail as unknown codes.
- Full static baseline: `npm test` → 248/248 green,
  `npm run build` → clean, `npm run check:manifest` → green,
  `npm run check:error-codes-fresh` → green, `git diff --check` →
  clean.
- Live REAPER smoke passed on REAPER 7.71/macOS-arm64 after full
  REAPER quit/reopen and current `start_bridge.lua` run. Console
  proof:
  `[streetlight] loaded error_codes (22 codes)` and
  `bridge ready (generation 1) — loaded error_codes (22 codes)`.
- Focused live paths all returned the expected typed codes with no
  `INTERNAL_ERROR` degradation:
  `ITEM_NOT_FOUND` (`item_pitch selected:99`),
  `MEDIA_NOT_FOUND` (`media_import path:"/no/such/file"`),
  `REGION_NAME_INVALID` (`region_create name:"a/b"`),
  `REF_INVALID` (`track_rename selected:0` cross-type),
  `REGION_NOT_FOUND` (`render_region region:doesnotexist` to an
  existing temp output dir), and raw-queue `VERIFY_FAILED` for
  `track_rename` with forced
  `expected_delta={count:1,creates:true}`.
- Raw mismatch details were
  `{actual:{items:0,regions:0,tracks:0}, changed_count:1,
  expected:{count:1,creates:true}}`, `recoverable:false`, with the
  required "mutation has been applied — call get_state" recovery
  phrase.
- Happy path: `track_create name:"smoke05-live-1782748111423"`
  returned the locked envelope
  `{template:"track_create", changed_count:1,
  changed_ids:["guid:{AF0C65BE-0D4A-3B4D-BFE8-4A2A6622F0CD}"],
  truncated:false}`. `track_rename last_result:track:0` before and
  after the forced `VERIFY_FAILED` hit the same GUID, confirming
  normal `LAST_RESULT` behavior. Temporary render smoke dir was
  removed; the smoke track remains in the open REAPER project for
  manual undo/delete.



### v0.1 progress at a glance

| | Done | Remaining |
|---|---|---|
| Steps | 0, 1, 2, 3, 4a, 4b, 4c, 5, 6, 7, 8 ✅; Kernel Slices 01-19 ✅ pushed | H6 basic loop closed |
| Tests | Slice 19: full 357/357, build / manifest / error-code / template-authoring / diff-check clean; manifest/template-authoring see 12 templates; live smoke `1782840178741` green | H6 basic loop closed |

**9 / 9 v0.1 steps shipped; kernel hardening Slice 10 is now
live-smoked, committed, and pushed.** Step 6 (render) closed
2026-06-29 after a Codex re-smoke against the post-restart single-chunk
bridge (generation 1, full 6-0..6-9 roll-up green). Step 7 (recipe
discovery + end-to-end demo) shipped 2026-06-29 in the same window:
two new MCP tools (`list_templates`, `list_recipes`), `js-yaml` added
to mcp-server-only deps, recipe envelope schema (id/description/inputs/
steps + passthrough — A5), env-overridable recipes dir
(STREETLIGHT_RECIPES_DIR), warnings array for bad YAML (A4), the four
Step 6 open notes resolved (B1 unified Lua-owned REGION_NAME_INVALID
for /, \, NUL, $; B2 "Render in background ON" docs requirement;
B3 3-tick file stability; B4 startup stale-`RUNNING/` cleanup writing
typed INTERNAL_ERROR done envelopes), and the .RPP-sidecar artifact
contract enforced via preflight no-clobber + post-render cleanup
(path-B; see the three Step 7 mid-smoke sections below for the
post-mortem on why config-var suppression was dead on stock REAPER
7.71). **Live verified on REAPER 7.71/macOS-arm64.** Step 8 release
polish closed across two rounds 2026-06-29 same window: **Round A**
(release-blocker code — open notes #3 risk-policy enforce, #4
file-queue non-ENOENT wrap, #5 done/ 24h orphan sweep) landed in 4
files + 7 new tests → 171/171, no live REAPER round-trip needed;
**Round C** (docs + audit eval — README sidecar wording fix to the
guarded-cleanup contract, foreground-render docs audit + v0.2
forward-look one-liners in INSTALL/ROADMAP, Vitest/Vite/esbuild
upgrade evaluation) docs-only. Round B (Linux queue-dir, #2)
**deferred to v0.2** per explicit user decision (no Linux REAPER rig).
All six open notes resolved (closed Round A: 3; closed Round C: 1;
evaluated and deferred post-v0.1: 1; deferred v0.2: 1). v0.1 is at
release-candidate from a Streetlight-side perspective. Release-prep
setup/launcher (`scripts/setup.mjs`, REAPER `start_bridge.lua`
launcher, `setup-out/` MCP config artifacts) landed 2026-06-29 same
window with the manual REAPER `Actions → ReaScript: Load... → Run`
gate passed live on this Mac (console: `bridge ready (generation
1) — templates: …`). Test bar 171 → 198 (+27 pure-function setup
tests). The second-Mac smoke per `docs/CROSS_MAC_SMOKE.md` is the
remaining gate before any release tag. Kernel Slice 01 was committed
and pushed at `baa13bd`; Slice 02 was committed and pushed at
`e93d39e`; Slice 03 was committed and pushed at `4e80839`; Slice 04
was committed and pushed at `d3f8fe7`; Slice 05 was committed and
pushed at `5ba6318`; Slice 06 was committed and pushed at `9f56ce0`;
Slice 07 was committed and pushed at `9244be3`; Slice 08 was committed
and pushed at `c923df9`; Slice 09 was committed and pushed at
`bf15daa`; Slice 10 was committed and pushed at `2babc5c`; Slice 11
was committed and pushed at `f66b2db`; Slice 12 was committed and
pushed at `6e4a02f`; Slice 13 was committed and pushed at `f998507`.
Slice 14 was committed and pushed at `56c57cb` after live smoke
`slice14-1782815129961`. Slice 15 is locally committed at `39bf940`
and live-smoked with run id `slice15-1782819968415`. Slice 16 is
locally committed at `0996b5b`; reviewer Locke's docs-only follow-up is
locally committed at `45e0193`; Slice 17 is static-green and saved as
local commit `kernel-hardening: slice 17 define template helper`;
Slice 17 reviewer follow-up is saved at `8f0b505`; Slice 18 is pushed
at `88b0edf`; Slice 19 is live-smoked/static-green and pushed at
`e54fd9c`.
`docs/PUBLIC_STORY.md` now tracks the public positioning, launch-copy
blocks, technical moats, demo story, and "do not overclaim yet" language
for future Bilibili / YouTube / README use.

### Next action

1. **Slice 20+ rolling workflow.** The current kernel-hardening H6
   thread has reached its documented closure point. Use
   `docs/plans/OPENREAPER_FIRST_REAL_VERSION_EXECUTION_PLAN.md` and the
   latest slice packet. Architect plans; Codex executes; Codex pulls
   reviewer/smoke; docs move with the slice; local commit only on
   explicit ask; push only on explicit push ask.
2. **Second-Mac smoke / v0.1 release tag remains available.**
   Setup/launcher reproducer is ready;
   `docs/CROSS_MAC_SMOKE.md` is still the runbook.


## What's Done

### Documentation (v0.1 specs)

- `README.md` — public-facing intro
- `docs/ARCHITECTURE.md` — 5 MCP tools, pack layout, item-reference lifecycle pinned
- `docs/KERNEL_DESIGN.md` — long-term vision and borrowed patterns
- `docs/MVP.md` — 11 required templates (item_reverse removed), success criteria
- `docs/IMPLEMENTATION_PLAN.md` — detailed 9-step build plan with acceptance + pitfalls per step. **Updated 2026-06-27**: Steps 2 / 3 / 5 now reference response-budget rules; bottom schema snippets reflect the v0.1 locked shapes for `get_state` and `call_template`.
- `docs/RENDER_NOTES.md` — render mechanics so Step 6 does not blow up
- `docs/TEMPLATE_SPEC.md` — schema-as-Zod, item_pitch example
- `docs/ROADMAP.md` — v0.2 (socket + batched calls + **response-budget API: cursor / fields / include / summary_only / per-tool byte caps**), v0.3 (plan/apply, verification)
- `docs/INSTALL.md` — manual install flow; auto-start via __startup.lua documented
- `docs/RESPONSE_BUDGET.md` — **new 2026-06-27.** Cross-cutting design constraint for every list-returning tool. Locked v0.1 shapes for `get_state` and `call_template`. Read this before adding any new tool or new `get_state` scope.

### Code — `packages/core` (Step 0)

Files: `errors.ts`, `result.ts`, `risk.ts`, `refs.ts`, `queue.ts`, `registry.ts`, `types.ts`, `index.ts`.
Tests: 36 passing in 5 files under `src/__tests__/`.

**Updated 2026-06-27 (Step 2 response-budget pass):**
- `errors.ts` — added `RESPONSE_TOO_LARGE` error code (raised by bridge when even one item exceeds the 64 KiB response cap; soft truncation is NOT an error).
- `types.ts` — added `ResponseBudgetMeta { total, returned, truncated, response_bytes }`; `SelectionState extends ResponseBudgetMeta`. Notation convention pinned in jsdoc: `name` / `track_name` are required `string`; unnamed objects → `""`, never `null`, never omitted.

### Code — `packages/mcp-server` (Step 1)

Files:

- `src/transport/file-queue.ts` — `FileQueueClient`, `resolveQueueDir`, atomic writes, geometric backoff polling, BRIDGE_NOT_RUNNING on timeout
- `src/tools/ping.ts` — `ping(client)` wrapper
- `src/index.ts` — stdio MCP server, registers `ping` + `get_state` tools (Step 2). **Updated 2026-06-27**: `get_state` MCP schema now exposes optional `limit` (1-200, Zod-validated MCP-side).
- `src/transport/__tests__/file-queue.test.ts` — 14 tests with a fake-bridge harness

### Code — `reaper/` (Step 1)

Files:

- `streetlight_bridge.lua` — defer loop at 10 Hz, FIFO queue scan, atomic done writes, ping dispatcher. **Updated 2026-06-27 (Step 2 response-budget):** `get_state` now accepts `params.limit` (defaults 50, clamped to [1, 200]), tracks encoded bytes per item, stops at the item boundary if the next item would push past `MAX_RESPONSE_BYTES = 65536`, returns `RESPONSE_TOO_LARGE` when even the first item exceeds the cap. Response includes `total / returned / truncated / response_bytes`. `MAX_RESPONSE_BYTES`, `DEFAULT_LIMIT`, `MIN_LIMIT`, `MAX_LIMIT` are intentionally NOT params in v0.1 — exposing them invites foot-guns; v0.2 may unlock per-tool caps.
- `packs/core/lib/json.lua` — minimal pure-Lua JSON encoder/decoder
- `packs/core/manifest.lua` — stub (templates registered from Step 3 onward)

### Code — Step 3 additions (2026-06-27)

Files (TS):

- `packages/core/src/queue.ts` — **hardened `makeCommandId`**: format is now
  `cmd_YYYYMMDDHHMMSSmmm_NNN_xxxxxx` (UTC time to ms + 3-digit counter +
  6-hex-digit random). Sortable prefix preserved so bridge FIFO scan
  (`table.sort` over filenames) still works. Closes the same-second
  process-restart / counter-wrap collision window that would have been
  silently dangerous once mutations started shipping. Added `CommandKind`
  comment mapping wire kinds to MCP tool names (`call_template` ↔
  `"template"` etc.) — answers the protocol-naming-drift flag in the
  codex review.
- `packages/core/src/types.ts` — `CallTemplateResult` type pinning the
  locked envelope shape.
- `packages/mcp-server/src/templates/item-pitch.ts` — Zod schemas (`strict`
  mode rejects unknown params) + `CapabilityDefinition` for `item_pitch`.
- `packages/mcp-server/src/templates/index.ts` — `registerCoreTemplates()`.
  New templates are one-liner additions here; no per-template special
  casing in the tool layer.
- `packages/mcp-server/src/tools/call-template.ts` — `callTemplate()`
  wrapper. Validates name → `TEMPLATE_NOT_FOUND`; validates params via
  the registered Zod schema → `PARAMS_INVALID`; both happen **without**
  touching the queue. Writes wire command `kind="template"`,
  `name=<template>`, `params=<validated>`. **Mutating-timeout contract**
  documented in the file's jsdoc: agents must NOT auto-retry on
  `BRIDGE_NOT_RUNNING` for mutations — re-running can double-apply.
- `packages/mcp-server/src/index.ts` — bootstraps the registry at startup
  and registers the `call_template` MCP tool. Tool description names the
  locked shape and warns against auto-retry on `BRIDGE_NOT_RUNNING`.
- `packages/mcp-server/src/tools/__tests__/call-template.test.ts` — **12
  tests**: happy path, on-wire kind/name/params, `TEMPLATE_NOT_FOUND`
  without round-trip, `PARAMS_INVALID` for out-of-range / missing /
  unknown-key / empty-name, surfaced `ITEM_NOT_FOUND` and
  `TAKE_NOT_FOUND`, truncated-envelope propagation (50 IDs but
  `changed_count=87`), `BRIDGE_NOT_RUNNING` semantics, no-auto-retry
  invariant.
- `packages/core/src/__tests__/queue.test.ts` — updated for new ID format
  (7 tests; adds explicit lexicographic-ordering test across milliseconds).

Files (Lua):

- `reaper/packs/core/refs.lua` — `resolve_item(ref, last_result)` returns
  `(item, nil)` or `(nil, code, msg)`. Step 3 implements `selected:N`
  and `guid:{...}`. `last_result:item:N` and `track:Name/item:N` parse
  on the TS side but return `REF_INVALID` from the bridge in v0.1 Step 3
  — Step 4 lights them up.
- `reaper/packs/core/undo.lua` — `with_undo(label, flags, fn)`. `pcall`
  around the body; `Undo_EndBlock2` always runs (preventing stuck undo
  state on handler errors). Exports `UNDO_STATE_*` constants.
- `reaper/packs/core/templates/item.lua` — first template module.
  `item_pitch(params, ctx)` resolves the ref, gets active take (else
  `TAKE_NOT_FOUND`), sets `D_PITCH`, calls `UpdateArrange`, returns
  `{ changed_ids = { "guid:..." } }`. Errors via `error({code,message})`
  tables — strings would lose the typed code at the dispatcher boundary.
- `reaper/packs/core/manifest.lua` — now non-empty: loads
  `templates/item.lua` and registers `item_pitch` with undo metadata.
  Resolves its own dir via `debug.getinfo`, so the bridge stays
  pack-layout-agnostic.
- `reaper/streetlight_bridge.lua` — **`DISPATCH.template` added** and
  this is where the response-budget contract is enforced. Reads ONLY
  `result_or_err.changed_ids` from the handler return; anything else
  (descriptors, debug payload) is silently dropped at the dispatcher
  boundary. Caps at 50 IDs; computes `changed_count` from the raw total;
  sets `truncated = changed_count > 50`. Updates `LAST_RESULT.items` on
  success (Step 4 reads). Translates `error({code, message})` tables
  into typed error envelopes; string-error fallbacks collapse to
  `INTERNAL_ERROR`. `undo.with_undo` wraps undoable templates so
  `Undo_EndBlock2` runs even on the error path.

### Verification status (Step 3)

- `npm run typecheck` clean
- `npm run build` clean
- `npm test` — **76 tests pass** (4 queue + 17 refs + 6 result + 5 registry + 4 risk + 14 file-queue + 11 get-state + 12 call-template; queue.test grew from 4 to 7)
- **REAPER smoke test ✅ all 8 acceptance points on REAPER 7.71/macOS-arm64 (2026-06-27):**
  1. `item_pitch selected:0 semitones:-3` returned the locked envelope
     `{ template, changed_count:1, changed_ids:["guid:{1F8063CD-...}"], truncated:false }` — **no `pitch_before` / `pitch_after` / `items` fields**, dispatcher contract held ✅
  2. Properties dialog read `Pitch adjust (semitones) = -3.000` ✅
  3. Undo History top entry: `Streetlight: item_pitch`; `Cmd+Z` reverted pitch to 0 ✅
  4. `selected:999` → `ITEM_NOT_FOUND`, message included actual selection count, `recoverable:true` ✅
  5. Bogus GUID → `ITEM_NOT_FOUND` with the bogus GUID echoed back (true TAKE_NOT_FOUND for empty-MIDI not exercised; covered by the 12 call-template unit tests) ✅
  6. `semitones: 100` → `PARAMS_INVALID` from MCP-side Zod with a
     `"semitones: Number must be less than or equal to 24"` message; bridge `pending/` / `running/` / `done/` all empty after the call ✅
  7. `does_not_exist` → `TEMPLATE_NOT_FOUND` from MCP-side registry
     (message `"No template registered with name \"does_not_exist\""` — distinct from the bridge-side phrasing); bridge queue dirs empty ✅
  8. Post-mutation `get_state(selection)` first item's GUID equalled
     `changed_ids[0]` from acceptance 1 ✅

### Step 3 acceptance — to verify in REAPER

Per the locked-shape rewrite of IMPLEMENTATION_PLAN.md Step 3:

1. With one item selected, `call_template item_pitch
   { item_id: "selected:0", semitones: -3 }` returns
   `{ ok: true, result: { template: "item_pitch", changed_count: 1,
   changed_ids: ["guid:{...}"], truncated: false } }`. **No item
   descriptor in the result.**
2. REAPER item properties dialog shows pitch -3.000.
3. `Cmd+Z` reverts; undo history reads `Streetlight: item_pitch`.
4. Empty selection → `{ ok: false, error: { code: "ITEM_NOT_FOUND",
   recoverable: true } }`; REAPER state unchanged.
5. Empty MIDI item without take → `TAKE_NOT_FOUND`.
6. `semitones: 100` → `PARAMS_INVALID` at MCP layer; bridge log shows
   no command picked up.
7. Unknown template name → `TEMPLATE_NOT_FOUND` at MCP layer; bridge
   log shows no command picked up.
8. `get_state` after mutation reflects new pitch (verify via UI or
   tooling).

#### Step-by-step REAPER smoke test recipe

The agent driving this MCP server (Claude Code, Codex, Cursor, etc.) is
the one issuing the calls below — these are the prompts you give it.

1. **Reload the bridge.** In REAPER:
   `Actions → Show action list → ReaScript: Run reaper script (EEL2, lua, py)…`,
   pick `reaper/streetlight_bridge.lua`. The console (`View → Show console`)
   should print:
   ```
   [streetlight] bridge starting
   [streetlight] loaded pack 'core' v0.1.0
   [streetlight] bridge ready — templates: item_pitch
   ```
   No `templates: item_pitch` line → manifest didn't load; stop and
   read the console for a dofile path error.

2. **Sanity-check ping** (no mutation, proves the round trip):
   > Prompt: *"Ping Streetlight."*

   Expect `{ ok: true, result: { bridge: "connected", reaper_version: "7.x" } }`.

3. **Acceptance 1 — happy path.** Drop any media file on a track,
   select exactly one item, then:
   > Prompt: *"Use Streetlight `call_template` to pitch the selected item down 3 semitones."*

   Pass: response is the locked envelope, **with no
   pitch_before / pitch_after fields**. Failure of this shape means the
   dispatcher contract leaked — stop and read `streetlight_bridge.lua`
   `DISPATCH.template`.

4. **Acceptance 2 — REAPER UI confirms.** Double-click the item →
   Properties dialog. "Pitch adjust (semitones)" should read `-3.000`.

5. **Acceptance 3 — undo label.** `Edit → Undo History`. Top entry:
   `Streetlight: item_pitch`. `Cmd+Z` reverts pitch to 0.

6. **Acceptance 4 — empty selection.** Click on empty timeline (deselect
   all), then run the same prompt as step 3. Expect `ITEM_NOT_FOUND`,
   recoverable: true. Selection still empty.

7. **Acceptance 5 — no active take.** `Insert → New MIDI item`, then
   right-click → `Take → Delete active take` until empty. Select it. Same
   prompt. Expect `TAKE_NOT_FOUND`.

8. **Acceptance 6 — out-of-range params** (Zod blocks before the bridge):
   > Prompt: *"Pitch the selected item up 100 semitones."*

   Expect `PARAMS_INVALID` mentioning `semitones`. **Bridge console
   should show no new activity** — proves MCP-side Zod rejected before
   the queue write.

9. **Acceptance 7 — unknown template** (registry blocks before bridge):
   > Prompt: *"Run Streetlight template `does_not_exist` with empty params."*

   Expect `TEMPLATE_NOT_FOUND`. Bridge console silent.

10. **Acceptance 8 — get_state reflects mutation.** Apply acceptance 1
    again (item still selected, pitch back to 0 from your undo). Then:
    > Prompt: *"Get the current selection state."*

    The returned item's GUID should match the `changed_ids[0]` you saw
    in step 3. (v0.1 `get_state` does not echo pitch — verify via the
    REAPER UI for now.)

If anything fails: copy the bridge console output and the MCP response
JSON into the next conversation. Both are needed to diagnose.

### Step 4a smoke recipe

After reloading `streetlight_bridge.lua`, walk these three prompts in
order. Each verifies one ref kind. All reversible via Cmd+Z, so feel free
to leave items in arbitrary pitch states during the run — the final
Cmd+Z chain resets everything.

Prerequisite: at least one media item on a track named `111` (or rename
your existing track), with that item selected.

1. **Acc 4a-1 — `selected:0` baseline.** Establishes the first
   `last_result.items` entry.
   > Prompt: *"Use Streetlight `call_template` to pitch the selected item up 1 semitone."*

   Pass: locked envelope, `changed_ids` has one GUID (your first
   selected item). Pitch dialog reads `+1.000`.

2. **Acc 4a-2 — `last_result:item:0` echoes the same item.** Same item
   should be pitched again, this time to −1.
   > Prompt: *"Use Streetlight `call_template` to pitch `last_result:item:0` down by 2 semitones (so semitones = -1)."*

   Pass: same GUID in `changed_ids[0]`. Pitch dialog now reads `-1.000`.
   Verifies the bridge's `LAST_RESULT.items` write/read pairing.

3. **Acc 4a-3 — `track:111/item:0` resolves by track name.** Wakes up
   the second new ref kind. Resets pitch on track 111's first item.
   > Prompt: *"Use Streetlight `call_template` to pitch `track:111/item:0` to 0 semitones."*

   Pass: locked envelope, `changed_count: 1`. The first item on track
   `111` is now at pitch 0. (If your selected item lives on track
   `111`, the same item gets pitched and the GUID matches Acc 4a-1.)

Then drive the negative paths to confirm error messages:

4. **`last_result:item:99` →** `ITEM_NOT_FOUND, "last_result:item:99 out
   of range (last_result has 1 item)"`.
5. **`track:DoesNotExist/item:0` →** `TRACK_NOT_FOUND, "No track named
   'DoesNotExist'"`.
6. **`track:111/item:99` →** `ITEM_NOT_FOUND, "track:111/item:99 out of
   range (track has N items)"`.
7. **Bridge-reload sanity:** reload `streetlight_bridge.lua` once more
   in REAPER (`LAST_RESULT` is in-memory, dies on reload). Then call
   `item_pitch last_result:item:0 …` — expect `REF_INVALID, "no mutating
   call has produced changed_ids yet this session"`.

If anything fails: copy the bridge console + the MCP response JSON.

### Step 4a verification (2026-06-27)

All 7 smoke prompts above passed against REAPER 7.71/macOS-arm64 with
one item selected on track `111`:

1. **Empty `last_result`**: `item_id: "last_result:item:0"` returned
   `REF_INVALID, "last_result:item:0 — no mutating call has produced
   changed_ids yet this session"`. Matches `refs.lua` wording byte-for-byte. ✅
2. **`selected:0` baseline**: locked envelope, `changed_ids[0]` = the
   selected item's GUID. Pitch dialog confirmed +1.000. ✅
3. **`last_result:item:0` echo**: same GUID returned, proving the
   bridge's `LAST_RESULT.items` write (Step 3) and read (Step 4a)
   line up. Pitch dialog confirmed −1.000. ✅
4. **`track:111/item:0`**: returned a real GUID for the first item on
   track `111` by REAPER's ordering. In the test session this was
   `{9A3ED3FD-…}`, **distinct** from the selected item — surfaced that
   track `111` has 5 items, only one of which was selected. Resolver
   behavior is correct. ✅
5. **`last_result:item:99`**: `ITEM_NOT_FOUND, "last_result:item:99 out
   of range (last_result has 1 item)"`. Singular vs plural pluralization
   works. ✅
6. **`track:DoesNotExist/item:0`**: `TRACK_NOT_FOUND, "No track named
   'DoesNotExist'"`. ✅
7. **`track:111/item:99`**: `ITEM_NOT_FOUND, "track:111/item:99 out of
   range (track has 5 items)"`. Plural form. ✅

No bridge console errors during any prompt. The bridge does NOT need
to be re-reloaded between 4a and 4b — 4b only adds new template handler
files (loaded once at startup via `manifest.lua`), so a single reload
at the end of 4b is enough.

### Code — Step 4b additions (2026-06-27)

Files (TS):

- `packages/core/src/refs.ts` — **adds `TrackRef`, `parseTrackRef`,
  `formatTrackRef`.** Mirrors the item/region ref machinery. The
  track-item shape (`track:Foo/item:N`) is rejected by the track parser
  (it's an item ref); the bridge's item resolver returns a typed
  REF_INVALID when a track-shaped ref is fed in, and vice versa.
- `packages/core/src/__tests__/refs.test.ts` — adds 8 `parseTrackRef`
  cases + 3 `formatTrackRef` round-trips (28 ref tests total, up from 17).
- `packages/mcp-server/src/templates/_shared.ts` — **new shared module
  for the locked `call_template` result shape.** Exposes
  `callTemplateResultSchema(name)` so each template defines its own
  literal-typed `template` field without re-stating the rest of the
  envelope. `item_pitch` migrated to use it.
- `packages/mcp-server/src/templates/track-create.ts`,
  `track-rename.ts`, `item-move.ts`, `item-rate.ts`, `item-trim.ts` —
  Zod schemas + `CapabilityDefinition` for each of the five new
  templates. Strict mode; `param` shapes match the bridge handler
  expectations 1:1.
- `packages/mcp-server/src/templates/index.ts` — one line per new
  template, six total registrations now.
- `packages/mcp-server/src/tools/__tests__/track-create.test.ts` (5),
  `track-rename.test.ts` (5), `item-move.test.ts` (4),
  `item-rate.test.ts` (3), `item-trim.test.ts` (4) — fake-bridge round
  trips per template: happy path, on-wire kind/name/params,
  PARAMS_INVALID cases, surfaced bridge errors.

Files (Lua):

- `reaper/streetlight_bridge.lua` — **entity-typed `LAST_RESULT`.**
  `local ENTITY_BUCKET = { item = "items", track = "tracks", region =
  "regions" }` and the dispatcher writes `envelope.result.changed_ids`
  into `LAST_RESULT[bucket]` based on the manifest entry's `entity_kind`.
  A missing/unknown `entity_kind` logs a WARNING and falls back to the
  items bucket. **Why this lands now:** Codex called it out as the
  rework risk for Step 4b — without entity-typed buckets the very first
  `track_create` would have silently polluted `LAST_RESULT.items`.
- `reaper/packs/core/refs.lua` — adds `M.resolve_track(ref, last_result)`
  with `track:Name`, `guid:{...}`, and `last_result:track:N` parsers.
  `M.resolve_item` now gives a typed REF_INVALID with a useful message
  when a track-shaped ref is supplied. `last_result:track:N` is wired;
  `last_result:region:N` still parses and returns "not implemented in
  v0.1" (Step 5 lights it up).
- `reaper/packs/core/manifest.lua` — `entity_kind` is **required** on
  every entry now. Six entries: 4 items (`item_pitch`, `item_move`,
  `item_rate`, `item_trim`) + 2 tracks (`track_create`, `track_rename`).
  Track entries use `UNDO_STATE_TRACKCFG`; item entries use
  `UNDO_STATE_ITEMS`.
- `reaper/packs/core/templates/item.lua` — adds `M.item_move`,
  `M.item_rate`, `M.item_trim`. `item_move` resolves the optional
  `to_track_id` via `ctx.refs.resolve_track`; `item_rate` sets
  `B_PPITCH=0` explicitly so rate changes pitch (the Step 4 pitfall
  documented in IMPLEMENTATION_PLAN.md). `item_trim` only requires an
  active take if `start_offset` was supplied.
- `reaper/packs/core/templates/track.lua` — **new file.** `M.track_create`
  (with `reuse_existing` no-op-by-name semantics) and `M.track_rename`.
  Both return `changed_ids = { "guid:{TRACK-GUID}" }` so the dispatcher
  can route into `LAST_RESULT.tracks`.

### Step 4b post-smoke fixes (2026-06-28)

First Codex smoke pass surfaced two real bugs and one doc drift before the
Step 4b cell could flip to ✅. Fixed in-place; no schema or wire shape
changed.

1. **`item_move` same-track no-op crashed instead of succeeding.**
   `MoveMediaItemToTrack(item, track)` returns `false` when source ==
   target, which the handler was treating as `INTERNAL_ERROR`. That
   contradicted the template's `idempotent: true` contract. Fixed in
   `reaper/packs/core/templates/item.lua` by comparing the item's current
   track to the resolved target via `reaper.GetMediaItem_Track(item)` and
   skipping the `MoveMediaItemToTrack` call when they match. Position is
   still applied. New negative path 4b-10 below covers it.
2. **`LAST_RESULT` stale across buckets.** Dispatcher wrote
   `LAST_RESULT[bucket] = changed_ids` but never cleared the others, so
   `track_create` followed by `last_result:item:0` resolved to the
   previous mutation's item (P1 — spec says "last_result = the most
   recent mutation, period," not "the most recent per kind"). Fixed in
   `reaper/streetlight_bridge.lua DISPATCH.template` by clearing every
   bucket before writing the active one. Negative path 4b-9 already
   covered the spec; the bug was the implementation drifting from it.
3. **`item_rate` doc drift.** Acc 4b-5 originally said "item length on
   the timeline doubles." Current implementation only sets `B_PPITCH=0`
   + `D_PLAYRATE`; `D_LENGTH` is untouched by design (decision: keep the
   template single-purpose; agents that want timeline stretch call
   `item_trim` after). Rewrote Acc 4b-5 to match.

No TS code changed; both fixes live entirely in Lua. The fake-bridge
harness in `packages/mcp-server/src/transport/__tests__/fake-bridge.ts`
doesn't model `LAST_RESULT` state, so the regression coverage for #2
is the REAPER smoke (4b-9) rather than a unit test. Same for #1 (4b-10).

### Code — Step 4b docs

- `docs/INSTALL.md` — **rewritten install step 2.** The bridge dofiles
  sibling pack files relative to its own path, so copying only
  `streetlight_bridge.lua` into REAPER's Scripts folder breaks startup.
  Documented Layout A (`dofile` from repo, survives `git pull`) and
  Layout B (copy whole `reaper/` directory). Runtime-folder table now
  calls out that **the Lua bridge is macOS-first**: on Linux, you must
  export `STREETLIGHT_QUEUE_DIR` in BOTH processes. Cross-platform Lua
  path resolution deferred to v0.2 (Step 8 Round B decision; see
  HANDOFF + INSTALL.md for the v0.1 env-var workaround).

### Step 4b smoke recipe

Prereq: at least one media item on a track. **Reload
`streetlight_bridge.lua` once** before walking these — it picks up the
new manifest + LAST_RESULT routing + track resolver in one shot. Console
should print `templates: item_move, item_pitch, item_rate, item_trim,
track_create, track_rename` after the reload.

The six prompts below chain via `last_result:track:0` and the new track
refs to prove the entity-typed routing actually works end to end.

1. **Acc 4b-1 — `track_create` lands a track named `Variations`.**
   > Prompt: *"Use Streetlight `call_template` to create a track named `Variations`."*

   Pass: locked envelope, `changed_count: 1`, `changed_ids[0]` is a
   `guid:{...}` string. REAPER's TCP shows a new track called
   `Variations`. Undo history top entry: `Streetlight: track_create`.

2. **Acc 4b-2 — `track_rename` via `last_result:track:0`.** This is THE
   test that the entity-typed `LAST_RESULT` routing works — if Acc 4b-1
   had written into `LAST_RESULT.items` (the pre-Step-4b bug), this
   prompt would return `REF_INVALID`.
   > Prompt: *"Use Streetlight `call_template` to rename `last_result:track:0` to `Variations (renamed)`."*

   Pass: same GUID as Acc 4b-1 in `changed_ids`. REAPER track name now
   reads `Variations (renamed)`. Undo history: `Streetlight: track_rename`.

3. **Acc 4b-3 — `item_move` shifts a selected item to position 5.0.**
   Select any item, then:
   > Prompt: *"Use Streetlight `call_template` to move the selected item to position 5.0 seconds."*

   Pass: locked envelope, `changed_count: 1`. Item now sits at 5.000s on
   the timeline. Undo history: `Streetlight: item_move`.

4. **Acc 4b-4 — `item_move` with `to_track_id: "track:Variations (renamed)"` reparents.**
   > Prompt: *"Move `last_result:item:0` to position 0 on `track:Variations (renamed)`."*

   Pass: item visibly jumps to the `Variations (renamed)` track at
   position 0. The bridge wires the item ref via `LAST_RESULT.items` and
   the track ref via `refs.resolve_track` — both must work for the
   prompt to succeed.

5. **Acc 4b-5 — `item_rate 0.5` halves playback (and lowers pitch).**
   > Prompt: *"Set the rate of `last_result:item:0` to 0.5."*

   Pass: item's audible pitch drops about an octave when played.
   Properties dialog shows `Playback rate = 0.500`,
   `Preserve pitch when changing rate = off`. **Timeline length is
   unchanged by design** — `item_rate` only sets `B_PPITCH` + `D_PLAYRATE`;
   it does NOT touch `D_LENGTH`. To stretch the visible item to match
   the new rate, call `item_trim` explicitly afterward. (Rationale: keep
   the template's mutation surface minimal and single-purpose. A future
   `item_rate_stretch` template can bundle both if there's demand.)

6. **Acc 4b-6 — `item_trim length: 1.0, start_offset: 0.25`.**
   > Prompt: *"Trim `last_result:item:0` to 1.0 seconds long, starting 0.25 seconds into the source."*

   Pass: item length on timeline = 1.000s. Properties dialog shows
   `Length = 1.000`, `Take start offset = 0.250` (source seconds).

Negative paths to confirm:

7. **`track_rename track_id: "selected:0"` →** `REF_INVALID, "'selected:0' is an item reference; expected a track reference"`. Proves the typed cross-kind error.
8. **`track_rename track_id: "track:DoesNotExist"` →** `TRACK_NOT_FOUND`.
9. **`item_rate item_id: "last_result:item:0"` immediately after a `track_create` (no item mutation in between) →** `REF_INVALID, "last_result:item:N — no mutating call has produced changed_ids yet this session"` (because the dispatcher only updates the bucket matching the manifest's `entity_kind`, **and clears the other buckets** — added 2026-06-28 after Codex caught the stale items bucket).
10. **`item_move` to the item's current track →** locked envelope, `changed_count: 1`, no error. Proves the same-track no-op path: REAPER's `MoveMediaItemToTrack` returns false when source == target; the template treats that as a successful no-op (added 2026-06-28 after Codex caught the false INTERNAL_ERROR). Verify by running Acc 4b-4 a second time with the same `to_track_id` — the item is already on `Variations (renamed)`, the second call should still succeed.

If anything fails: copy the bridge console output and the MCP response
JSON into the next conversation.

### Code — Step 4c additions (2026-06-28)

Three trickier templates land in pack `core`, plus one new error code.
123/123 TS tests green (was 108 at Step 4b's start; 122 at first
Step 4c code drop; +1 from the Infinity regression added in the
pre-smoke hardening pass). REAPER smoke completed 2026-06-28 —
see "Step 4c verification (2026-06-28)" further down.

Files (TS):

- `packages/core/src/errors.ts` — adds `MEDIA_NOT_FOUND` for `media_import`.
  Distinct from `INTERNAL_ERROR` so agents can tell "wrong input path" from
  "bridge crashed mid-call". `defaultRecoverable` still treats it as
  recoverable (typed REF_INVALID-style error, not a crash).
- `packages/mcp-server/src/templates/item-duplicate.ts` — Zod schema
  `{ item_id, track_id, position }` all required, strict mode.
  `idempotent: false` (every call adds a new item; running twice stacks
  duplicates). MVP.md locks the required-params contract; no "default to
  same track/position" — duplication target must be explicit in the call.
- `packages/mcp-server/src/templates/item-fade.ts` — **first user of the
  `json.null` sentinel**. Both `fade_in` and `fade_out` typed as
  `z.union([z.number().min(0), z.null()]).optional()`. Tri-state docs
  pinned in the Zod `.describe()` strings and in the file's jsdoc: omit
  = leave alone, null = clear to 0, number = set length. Idempotent.
- `packages/mcp-server/src/templates/media-import.ts` — Zod schema
  `{ path, track_id, position }` all required. **Risk = `filesystem`**
  (already in the default-allowed set in `risk.ts`). Bridge does its own
  existence probe via `io.open` and surfaces `MEDIA_NOT_FOUND` before
  InsertMedia mutates anything; same code is returned when InsertMedia
  reports 0 items inserted (REAPER refused the format).
- `packages/mcp-server/src/templates/index.ts` — three new
  `registry.register(...)` lines. No per-template special-casing anywhere
  in the tool layer.
- `packages/mcp-server/src/tools/__tests__/item-duplicate.test.ts` (5),
  `item-fade.test.ts` (5), `media-import.test.ts` (4) — fake-bridge
  round trips. **Load-bearing item_fade test:** explicit `null` survives
  the JSON round trip on the wire (`expect(params).toHaveProperty("fade_in")`
  + `expect(params.fade_in).toBeNull()`); absent field stays absent
  (`expect(params).not.toHaveProperty("fade_in")`). If MCP-side validation
  ever silently dropped nulls, the tri-state collapses to bi-state and
  the Lua side can't tell "clear" from "leave alone" — these tests are
  the line of defense for that.

Files (Lua):

- `reaper/packs/core/templates/item.lua` — adds `M.item_duplicate` and
  `M.item_fade`. `item_duplicate` builds the duplicate manually:
  `AddMediaItemToTrack` → `AddTakeToMediaItem` →
  `SetMediaItemTake_Source(GetMediaItemTake_Source(src_take))`, then
  copies `D_LENGTH`, `D_FADEIN/OUTLEN`, take `D_STARTOFFS`, `D_PLAYRATE`,
  `D_PITCH`, `B_PPITCH`, and the take name. **Does NOT use
  `Main_OnCommand(41295)`** — the clipboard action mutates selection and
  depends on global clipboard state; the manual path is deterministic.
  Color, FX, envelopes, locked status are not carried in v0.1. `item_fade`
  checks each field with `value == nil` (absent), `value == ctx.json.null`
  (clear), else sets the number.
- `reaper/packs/core/templates/media.lua` — **new file.** `M.media_import`
  flow: `io.open` probe → resolve track → snapshot selection (loop over
  `CountSelectedTracks` + `GetSelectedTrack`) → `SetOnlyTrackSelected` →
  `InsertMedia(path, 0)` → restore selection → check `InsertMedia` return
  value → grab last item on target track via
  `GetTrackMediaItem(track, after_count - 1)` → set `D_POSITION`. Selection
  is restored on BOTH success and InsertMedia==0 paths. The split from
  item.lua exists because this is the first risk=`filesystem` template and
  the only one in v0.1 that does an `io.open`.
- `reaper/packs/core/manifest.lua` — three new entries, all
  `entity_kind = "item"` (returned GUID is the new/duplicated item).
  `media_import` declares `undo_flags = UNDO_STATE_ITEMS | UNDO_STATE_TRACKCFG`
  because `SetOnlyTrackSelected` records as a track-state event even
  though we restore it; Cmd+Z needs the bitmask to cover both. Bitwise `|`
  is fine — REAPER 7 ships Lua 5.4.

### Step 4c smoke recipe

Prereq: at least one media item on a track, and one accessible audio
file on disk (any short `.wav` works; the file just needs to exist).
**Reload `streetlight_bridge.lua` once** before walking these — it picks
up the new manifest entries, the new `media.lua` dofile, and the new
`item_duplicate` / `item_fade` handlers in one shot. Console should
print `templates: item_duplicate, item_fade, item_move, item_pitch,
item_rate, item_trim, media_import, track_create, track_rename` after
the reload.

Use unique track names per the Step 4b lesson — recommend
`Smoke 4c 2026-06-28` and any `(renamed)` / `(dup)` variants you need.

1. **Acc 4c-1 — `media_import` lands a new item on a target track.**
   Create a fresh track (`track_create name: "Smoke 4c 2026-06-28"`),
   then **before running the import, in REAPER manually select a
   *different* track AND any one media item on any track** (the
   selection-restore acceptance only catches a regression if there's
   actually something to restore). Then:
   > Prompt: *"Use Streetlight `call_template` to import the file at `/abs/path/to/sample.wav` onto `last_result:track:0` at position 0."*

   Pass: locked envelope, `changed_count: 1`, `changed_ids[0]` is a
   `guid:{...}` for the new item. The new item sits at 0.000s on the
   smoke track. **Both the previously-selected track AND the
   previously-selected item are still selected after the call** (most
   important behavior to eyeball — the newly imported item must NOT be
   added to the user's item selection; the contract is "restore what
   was selected before the call", agents that need the new item read it
   from `last_result:item:0`). Undo history: `Streetlight: media_import`.

1b. **Acc 4c-1b — `media_import` GUID-diff on non-empty target track.**
    Regression for the post-smoke fix: `after_count - 1` would have
    silently returned the wrong item here because `GetTrackMediaItem`
    returns items in timeline-position order, not insertion order.
    Setup: on a fresh smoke track, drop a *pre-existing* item at
    position **20s** (any short clip), then move REAPER's edit cursor
    back to **0s**. Now:
    > Prompt: *"Use Streetlight `call_template` to import the file at `/abs/path/to/sample.wav` onto `track:Smoke 4c 2026-06-28` at position 5."*

    Pass: `changed_count: 1`, `changed_ids[0]` is the **new** item's
    GUID (NOT the pre-existing 20s item's GUID). Track now has two
    items: pre-existing at 20.000s + imported at 5.000s.
    `get_state(selection)` after the call still shows the pre-existing
    item selected (from 4c-1's setup pattern, if you carry it forward),
    not the new one.

2. **Acc 4c-2 — `media_import` MEDIA_NOT_FOUND for missing path.**
   Note: by this point in the recipe 4c-1's `media_import` has already
   run, so `LAST_RESULT` has switched to the items bucket (per the
   Step 4b cross-bucket-clear). **Don't reach for `last_result:track:0`
   here** — it would `REF_INVALID` before even probing the file. Use
   the smoke track's stable handle instead: either the GUID captured
   from 4c-1's setup (`guid:{...}`) or `track:Smoke 4c 2026-06-28`.
   > Prompt: *"Use Streetlight `call_template` `media_import` with `path: "/definitely/not/a/file.wav"`, `track_id: "track:Smoke 4c 2026-06-28"`, `position: 0`."*

   Pass: `{ ok: false, error: { code: "MEDIA_NOT_FOUND", ... } }`,
   message includes the bad path. REAPER track count unchanged; no new
   item on the smoke track. Confirms the `io.open` probe runs before
   InsertMedia mutates state.

3. **Acc 4c-3 — `item_duplicate` copies the imported item.** Select
   the item that 4c-1 produced (or use `last_result:item:0`):
   > Prompt: *"Use Streetlight `call_template` to duplicate `last_result:item:0` onto `track:Smoke 4c 2026-06-28` at position 5.0."*

   Pass: locked envelope, **new** GUID (not the source's). On the smoke
   track there are now two items: the original at 0.000s and the
   duplicate at 5.000s. Both audibly play the same audio. Properties
   dialogs on the duplicate match the source's `D_LENGTH`, fades,
   `D_PLAYRATE`, take pitch.

4. **Acc 4c-4 — `item_fade` numeric (set fades).** Select the duplicate:
   > Prompt: *"Use Streetlight `call_template` to set `last_result:item:0` `fade_in: 0.25` and `fade_out: 0.5`."*

   Pass: locked envelope, `changed_count: 1`. Item visually shows a
   short fade-in ramp and a longer fade-out ramp. Properties dialog:
   `Fade in length = 0.250`, `Fade out length = 0.500`.

5. **Acc 4c-5 — `item_fade` explicit null (clear fades).** Same item:
   > Prompt: *"Use Streetlight `call_template` to clear `last_result:item:0` `fade_in` (send null) and leave `fade_out` alone."*

   The MCP agent must encode `fade_in` as JSON `null`, not omit it. Pass:
   `fade_in = 0.000` in the properties dialog; `fade_out` still
   `0.500` (untouched). **This is the json.null acceptance.** If the
   fade_in here ends up at 0.250 (unchanged), the sentinel isn't
   reaching the Lua handler — check bridge console for json.lua issues.

6. **Acc 4c-6 — `item_fade` absent leaves both alone.** Same item:
   > Prompt: *"Use Streetlight `call_template` `item_fade` on `last_result:item:0` with no fade params."*

   Pass: locked envelope, `changed_count: 1`. Properties dialog
   unchanged from after 4c-5 (`fade_in = 0`, `fade_out = 0.5`). Confirms
   that an empty params shape is valid (the template is `idempotent:
   true` even in the no-op case).

Negative paths:

7. **`item_duplicate` `position: -1`** → `PARAMS_INVALID`, message
   mentions `position`. Bridge console silent (Zod rejects before queue
   write).
8. **`item_duplicate` `track_id: "selected:0"`** (item-shaped ref) →
   `REF_INVALID`, message says "item reference; expected a track
   reference". Same typed cross-kind error path as Step 4b.
9. **`media_import` with `path: ""`** → `PARAMS_INVALID`, no bridge
   round-trip. (Zod `.min(1)`.)

10. **`item_fade` with `fade_in: Infinity`** → already covered by a
    TS regression test (`tools/__tests__/item-fade.test.ts`
    "PARAMS_INVALID: Infinity is rejected"); kept out of the REAPER
    smoke because it's purely a wire-encoding guard. Without the
    `.finite()` fix in `item-fade.ts`, Infinity would survive Zod via
    the `z.null()` branch (since `JSON.stringify(Infinity) === "null"`)
    and Lua would clear the fade. If you ever need to re-prove this in
    REAPER: send `fade_in: 1e400` from the MCP client — should come
    back `PARAMS_INVALID`, bridge console silent.

If anything fails: copy the bridge console output and the MCP response
JSON. For 4c-5 specifically: also copy the raw command file from
`$STREETLIGHT_QUEUE_DIR/pending/` if it's still there — the question is
whether `"fade_in": null` made it through the JSON serializer.

### Step 4c post-smoke fixes (2026-06-28, pre-smoke)

Codex reviewed the Step 4c code drop before the REAPER smoke run and
flagged three points the TS tests didn't model. All three got fixed in
this same session, before any REAPER smoke ran. The patched build then
went into the re-smoke pass documented under "Step 4c verification
(2026-06-28)" below — 10/10 green. Recording the pre-smoke fix
context here so a future window can tell the post-smoke fix from the
original code-done state.

**Files touched:**

- `reaper/packs/core/templates/media.lua` — item selection
  snapshot/restore + GUID-diff (fixes 1 + 2 below)
- `packages/mcp-server/src/templates/item-fade.ts` — `.finite()` on the
  `FadeField` number branch (fix 3, load-bearing)
- `packages/mcp-server/src/templates/item-move.ts`,
  `item-pitch.ts`, `media-import.ts`, `item-rate.ts`,
  `item-duplicate.ts`, `item-trim.ts` — `.finite()` on every
  floating-point `z.number()` (fix 3, defense-in-depth across the
  template surface; `.int()` sites already exclude Infinity/NaN so
  `track-create.ts index`, `get-state.ts limit`, `index.ts limit`,
  `_shared.ts changed_count` were left alone)
- `packages/mcp-server/src/tools/__tests__/item-fade.test.ts` — +1
  vitest case `"PARAMS_INVALID: Infinity is rejected"` asserting both
  the error code AND `bridge.seen.length === 0` (no wire round-trip)
- Smoke recipe above — extended 4c-1 to verify item selection
  restores, added 4c-1b for the GUID-diff regression on a non-empty
  target track, added prompt #10 cross-referencing the Infinity TS
  test

**Fix 1 — `media_import` selection restore covers items too.**
Codex flag: "media_import 只恢复 track selection, 不恢复 media item
selection". Real bug — `InsertMedia` auto-selects the newly inserted
item, deselecting any item the user had selected. The v0.1 contract
says "restores prior track selection" but the user-facing promise is
"restore selection", so we extended scope rather than narrowing the
doc.

Implementation: new `snapshot_selected_items` /
`restore_selected_items` helpers in `media.lua`, called symmetrically
with the existing track snapshot/restore around `InsertMedia`. Restore
uses `SelectAllMediaItems(0, false)` to deselect in one call, then
`SetMediaItemSelected` for each snapshot entry (guarded with
`ValidatePtr2` because items can be freed between snapshot and
restore — unlikely in v0.1 but cheap insurance). **The newly imported
item is NOT added to the restored selection** — agents that need it
read `last_result:item:0`. User signed off on this scope (B over A) in
the handoff exchange.

**Fix 2 — `media_import` identifies new item by GUID diff, not
`after_count - 1`.** Codex flag: "media_import 用 target track 的
after_count-1 当新 item, 在 fresh track 上会过, 但非空轨道上 InsertMedia
未必能保证新 item 是最后一个, 可能拿错 item". Real bug.
`GetTrackMediaItem(track, idx)` returns items in **timeline position
order**, not insertion order, so on a track with a pre-existing item
past the InsertMedia drop point (REAPER's edit cursor), the
"last index" trick returns that pre-existing item instead of the new
one. Fresh tracks don't trip it; non-empty tracks do.

Implementation: `snapshot_track_item_guids(track)` returns a set of
GUID strings for every item currently on the target track;
`find_new_items(track, before_guids)` enumerates after InsertMedia and
returns every GUID not in `before_guids`. Decisions per the handoff
sign-off:
- Selection restore (tracks + items) runs **BEFORE** the GUID-diff /
  error inspection — so a downstream error (InsertMedia==0, empty
  diff) can't leak the temporary `SetOnlyTrackSelected` to the user.
- 0 new GUIDs → `INTERNAL_ERROR` with message
  `"InsertMedia returned N but no new item GUID found on target track"`
  (distinct from the existing MEDIA_NOT_FOUND surfacing for
  `inserted == 0`).
- ≥1 new GUIDs → all of them go into `changed_ids`, each stamped to
  `params.position`. v0.1 smoke uses a plain `.wav` so the expected
  count is 1; if REAPER ever splits a multi-channel file into N items
  the locked envelope `changed_count` will be N and the agent gets the
  honest answer instead of a silent first-of-N pick.

**Fix 3 — every floating-point `z.number()` gains `.finite()`,
load-bearing for `item_fade`.** Codex flag: "新增 number schema 也还没
加 finite, Infinity -> JSON null 那个旧坑理论上还在". For most
templates this is defense-in-depth (`JSON.stringify(Infinity) ===
"null"` and `z.number()` already rejects `null` → automatic
PARAMS_INVALID). For `item_fade` it's load-bearing: `FadeField =
z.union([z.number().min(0), z.null()])` accepts `null` as the
clear-fade sentinel, so an Infinity round-tripped as `null` would
silently slip through and clear the fade instead of erroring.

Implementation: one-liner `.finite()` insertion in 7 template files
(8 sites including `item-trim`'s `start_offset`). Comment on the
`FadeField` line in `item-fade.ts` explains *why* the guard is there
(not cosmetic), pointing at the new vitest case. User signed off on
scope B (apply to all templates, no helper abstraction yet — too few
sites to justify it; revisit at Step 5+ if the count grows).

**Acceptance after Codex re-smoke:** 6 existing 4c smoke prompts +
the extended 4c-1 + new 4c-1b + 7-9 negative paths + the standing
123/123 TS test count. The Infinity guard has its own vitest case so
it doesn't bloat the REAPER smoke; the GUID-diff and selection-restore
fixes both need a real REAPER session to verify because vitest can't
model `InsertMedia` semantics.

### Step 4c verification (2026-06-28)

All 10 smoke prompts above (6 happy + 3 negative + 1 Infinity TS
guard) passed on REAPER 7.71/macOS-arm64 against the post-hardening
build (`123/123` TS green). 4c-1b — the new GUID-diff regression on a
non-empty target track — was the headline confirmation of the
hardening pass; 4c-5 (the `json.null` "clear fade_in") was the
load-bearing test for the sentinel reaching the Lua handler against
real REAPER state.

**Methodology note — Codex used a direct client, not its bundled MCP
server.** Codex's own `mcp__streetlight` MCP server was started in an
earlier Step 4b window and its registry was a snapshot of that
moment, so `call_template item_fade` against it returned
`TEMPLATE_NOT_FOUND` (item_fade didn't exist in 4b). Re-installing or
restarting Codex's bundled MCP was out of scope for the smoke run, so
Codex instead spun up a direct client against `packages/mcp-server/dist/`
that wrote to the same `$STREETLIGHT_QUEUE_DIR` the REAPER bridge was
polling. Same file-queue protocol, same Lua handlers, fresh registry.
For future windows: if Codex's bundled MCP is still stale and a
re-smoke is needed, this is the workaround — the queue is the
contract, MCP-server identity is not.

Track names used: `Smoke 4c Retest <epoch>` so stale state from
earlier sessions doesn't fall into the picture (continuation of the
Step 4b lesson). Recommend the same epoch-suffix pattern for any
future 4c regression run.

Witnessed GUIDs from the re-smoke (recorded so future debugging can
confirm the same template paths fire):

- Smoke track from 4c-1: `Smoke 4c Retest 1782656063659` (track GUID
  captured in the run log but not load-bearing here).
- Imported item from 4c-1: `guid:{33328360-3F1A-6A40-B028-4AF1EFE5C4C6}`.
- Item selected before 4c-1 (selection-restore acceptance):
  `guid:{1F8063CD-452B-A246-8680-82FD82095319}` — still the only
  selected item after `media_import` returned, and the new imported
  item was NOT added to selection. Proves both halves of Fix 1
  (snapshot/restore covers items + new item not auto-added).
- Pre-existing 20s item on the 4c-1b target track:
  `guid:{C57D8290-3E9B-BE44-96ED-7714B7A320D5}`. New import returned
  `guid:{5E0D39BB-E087-B147-BDBB-881E099E1EB7}` — different GUID,
  proves the GUID-diff path identifies the actual new item instead of
  the position-sorted "last" item that `after_count - 1` would have
  picked.
- Duplicate from 4c-3: `guid:{EA4EFD39-A317-6744-9116-3F82449017A0}`
  (distinct from the 4c-1 source's GUID; confirms `item_duplicate`
  builds a fresh item rather than aliasing the source).

Per-prompt acceptance:

1. **4c-1 `media_import` happy path**: locked envelope, new item
   landed at position 0 on the smoke track. ✅
2. **4c-1 selection restore**: pre-selected item still selected, new
   imported item NOT in selection. ✅ (Fix 1 confirmed in the wild.)
3. **4c-2 `MEDIA_NOT_FOUND` for missing path**: typed error, message
   includes the bad path, REAPER track/item counts unchanged.
   Codex used the stable smoke-track GUID for `track_id` per the
   updated 4c-2 wording (avoiding the `last_result:track:0` stale-
   bucket trap). ✅
4. **4c-1b GUID-diff regression**: 20s pre-existing item left alone,
   new item returned with its own GUID. ✅ (Fix 2 confirmed in the
   wild — this acceptance did not exist before the hardening pass.)
5. **4c-3 `item_duplicate`**: distinct duplicate GUID, source not
   modified. ✅
6. **4c-4 `item_fade` numeric**: both fades set as requested. ✅
7. **4c-5 `item_fade fade_in: null`**: command accepted, item GUID
   returned, fade_in cleared on the Lua side. ✅ — this is the first
   real-REAPER verification of the `json.null` sentinel since Step 4a
   landed it.
8. **4c-6 `item_fade` absent**: locked envelope, both fades untouched
   from 4c-5's state. ✅
9. **4c-7 negative position**: `PARAMS_INVALID`, no queue write. ✅
10. **4c-8 `track_id: "selected:0"`** (cross-kind ref): `REF_INVALID`
    with typed message naming both the offered ref and the expected
    kind. ✅
11. **4c-9 empty path**: `PARAMS_INVALID`, no queue write. ✅
12. **4c-10 `fade_in: Infinity`** (TS-only via direct client):
    `PARAMS_INVALID`, message `"fade_in: Number must be finite"`,
    no queue round-trip. ✅ — Fix 3's `.finite()` guard confirmed
    against the actual MCP path, not just the vitest harness.

Step 5 can now start.

### Step 4c post-verification fixes (2026-06-28, pre-Step-5)

Two Lua-only correctness fixes Codex flagged after the 4c re-smoke
landed. TS surface unchanged; no new templates. Doc-sync only beyond
that.

1. **`item_trim` no longer mutates `D_LENGTH` before checking the
   active take.** Previous order was `SetMediaItemInfo_Value(item,
   D_LENGTH, params.length)` then, if `params.start_offset ~= nil`,
   `GetActiveTake(item)` → `TAKE_NOT_FOUND` if missing. That left
   length already changed when the typed error came back, violating
   the "error → no change" expectation. New order:
   `params.start_offset ~= nil` resolves the take first and raises
   `TAKE_NOT_FOUND` before any write; only after the take is in hand
   do `D_LENGTH` and `D_STARTOFFS` get written. `params.start_offset
   == nil` path is unchanged (length-only mutation, empty-take items
   stay legal). File: `reaper/packs/core/templates/item.lua`
   `M.item_trim`.
2. **`resolve_last_result_track` returns `TRACK_NOT_FOUND` for
   out-of-range index.** Was returning `ITEM_NOT_FOUND`, which made
   the typed-error story diverge from `resolve_item`'s sibling code
   path. The track-resolver is the entry point for `last_result:track:N`
   on track-shaped refs (e.g. `track_rename track_id="last_result:track:0"`),
   so the wrong code surface-leaked to agents debugging stale
   last_result. File: `reaper/packs/core/refs.lua`
   `resolve_last_result_track` (the inner-scope helper above
   `M.resolve_track`).

Doc-sync done alongside:

- `docs/IMPLEMENTATION_PLAN.md` § Step 4 Lua-JSON-null bullet: was
  "fade-in/out `null` = leave unchanged". Replaced with the tri-state
  shipped by 4c (absent → leave, `null` → clear, number → set) so
  the plan and `HANDOFF.md` agree.
- `docs/HANDOFF.md` "Where the project is" first bullet: was
  "project is NOT a git repo". The working tree IS a git repo on
  branch `main` (commits `8ac30b9` → `ac6bd02` document the prior
  steps). Updated to flag that the user manages versioning out-of-band
  without claiming the repo doesn't exist.

No new TS tests — the item_trim ordering bug is not reachable via the
vitest fake-bridge (the fake bridge doesn't model `GetActiveTake`); it
needs a real REAPER smoke against an empty-take item with `start_offset`
in the call. Recommend a one-prompt regression in the Step 5 smoke
batch: `item_trim item_id="selected:0" length=1 start_offset=0.1` on a
single empty-take MIDI item — expect `TAKE_NOT_FOUND` AND
`D_LENGTH` unchanged from its pre-call value. The `resolve_last_result_track`
fix is observable via any track-typed last_result call with a
deliberately out-of-range index: expect `TRACK_NOT_FOUND` not
`ITEM_NOT_FOUND`.

Build + tests after the fixes: 123/123 TS green, `npm run build`
clean (re-verified before this entry was written).

**Live REAPER partial regression (2026-06-28, Codex via
`mcp__streetlight`).** Bridge restarted, fresh registry. Confirmed
on REAPER 7.71/macOS-arm64:

- ✅ `resolve_last_result_track` fix surface-tested: after a
  successful `track_create` populated `LAST_RESULT.tracks`,
  `track_rename(track_id="last_result:track:999", ...)` returned
  typed `TRACK_NOT_FOUND` (not `ITEM_NOT_FOUND`). The temp track
  `__codex_regression_track_20260628` was Cmd+Z-undoable — undo
  block intact, no leaked side effects.
- ⏸ `item_trim` empty-take case NOT live-confirmed this pass: the
  selection at smoke time was a normal media item, so the
  `start_offset` path didn't hit the `TAKE_NOT_FOUND` branch. The
  one-prompt regression above is now an **opener** for the Step 5
  smoke batch — run it before the region-create prompts so a
  passing 4c-postfix-trim is on the same smoke ledger as Step 5.

### Step 5 smoke recipe (verified 2026-06-29)

Eight prompts in order. Codex runs against the patched
`packages/mcp-server/dist/` (the bundled `mcp__streetlight` registry
will be a Step 4c snapshot and won't know about `region_create`) —
same workaround as the Step 4c re-smoke methodology note.

Use a unique track-name suffix for the run (e.g.
`Region Smoke 2026-06-28`) to keep prior sessions out of the picture.
Region-name collisions are the actual point of test 5-5, so don't
reuse `var_01` from a prior session unless that prior session was
cleaned up first.

**Setup (manual, in REAPER, before sending any prompt):**

- Create one empty-take MIDI item on a new track and select it (for
  5-0). Quickest: Insert > New MIDI item, then delete its only take
  via the take menu, leaving an item with no active take. Confirm
  `GetActiveTake` returns nil by selecting it and inspecting via the
  item properties dialog (no take listed).
- After 5-0, before 5-1, select a regular audio item (any media item
  with an active take) to make 5-2's "item_id=selected:0" mode valid.

**Prompts:**

- **5-0 (4c-postfix-trim opener).**
  `call_template item_trim {"item_id":"selected:0","length":1,"start_offset":0.1}`
  against the empty-take MIDI item. **Expect** typed
  `TAKE_NOT_FOUND` AND the item's `D_LENGTH` unchanged from its
  pre-call value (confirm in the item properties dialog). This
  proves the 4c post-verification ordering fix landed live.
- **5-1 (happy explicit).**
  `call_template region_create {"name":"var_01","start":0,"end":2}`.
  Expect ok=true, `changed_ids=["region:var_01"]`, one new region
  visible in REAPER's timeline ruler spanning 0s → 2s. Cmd+Z removes
  it cleanly. Re-do (Cmd+Shift+Z) brings it back so subsequent
  prompts have a region to chain off; or simply re-issue 5-1 after
  the undo and verify the timeline.
- **5-2 (happy item-derived).**
  `call_template region_create {"name":"var_02","item_id":"selected:0"}`
  against the regular audio item from setup. Expect ok=true,
  `changed_ids=["region:var_02"]`, region bounds equal to the item's
  `[D_POSITION, D_POSITION + D_LENGTH]` (no fade-out padding). Verify
  by reading the item's position/length out of REAPER and comparing
  to the region in the timeline ruler.
- **5-3 (last_result:item:0 round-trip).** Run an item mutation
  first — `call_template item_move {"item_id":"selected:0","position":5}` —
  then immediately
  `call_template region_create {"name":"var_03","item_id":"last_result:item:0"}`.
  Expect ok=true, region bounds derived from the just-moved item
  (`[5, 5 + length]`). Proves `LAST_RESULT.items` survives the
  `region_create` call's own LAST_RESULT bucket update — the
  cross-bucket clear that Step 4b shipped should NOT touch the items
  bucket until AFTER this template reads it.
- **5-4 (duplicate name → REGION_NAME_TAKEN).** Repeat 5-1's call
  verbatim. Expect ok=false, error code `REGION_NAME_TAKEN`, NO new
  marker visible in the timeline (the first 5-1's region is still
  there, alone).
- **5-5 (invalid name → REGION_NAME_INVALID).**
  `call_template region_create {"name":"bad/name","start":0,"end":1}`.
  Expect ok=false, error code `REGION_NAME_INVALID`. The TS schema
  does NOT pre-check path separators (would have surfaced as
  `PARAMS_INVALID` and stolen the domain code); `region.lua` is the
  single agent-facing source for both empty-name and path-separator
  rejection, symmetric with `REGION_NAME_TAKEN`.
- **5-6 (cross-type REF_INVALID — track ref into item slot).**
  `call_template region_create {"name":"var_06","item_id":"track:Region Smoke 2026-06-28"}`
  (substitute the actual run-tag track name). Expect ok=false,
  `REF_INVALID` with a message containing "track reference" and
  "expected an item reference". Proves the 3-way cross-type triangle
  closes — Step 5's contribution to the 4b → 5 cross-type story.
- **5-7 (cross-type REF_INVALID — region ref into item slot).**
  Re-run 5-1 first if 5-1's region was undone; then
  `call_template region_create {"name":"var_07","item_id":"last_result:region:0"}`.
  Expect ok=false, `REF_INVALID` with a message containing "region
  reference" and "expected an item reference". This is the third
  leg's `last_result:region:N`-shape rejection — the message must
  name "region", not "unrecognized" or "not implemented in v0.1".

**5-8 (region:Name resolver round-trip): DEFERRED to Step 6 smoke.**
`render_region(region_id="region:var_01")` will be the first real
consumer of `M.resolve_region`. Not worth a debug `region_get`
template now.

**Acceptance roll-up:**

- All 8 prompts return their expected ok / error_code.
- Timeline view at end of run: regions `var_01`, `var_02`, `var_03`
  visible; no `var_06`/`var_07` marker (REF_INVALID path is "error →
  no change" — verify in the timeline, not just the response).
- Cmd+Z on each `region_create` removes its region cleanly (test on
  5-3's region — the most recent — and walk back to 5-1).
- For 5-0: `D_LENGTH` of the empty-take MIDI item unchanged after
  the TAKE_NOT_FOUND. Re-confirm in the item properties dialog.

Methodology continuation (carried from Step 4c re-smoke): direct
client against `packages/mcp-server/dist/` writing into the same
`$STREETLIGHT_QUEUE_DIR` the REAPER bridge polls. Confirm
`mcp__streetlight ping` returns the patched-build's pack version
before proceeding (Step 5 bumps neither pack name nor version, so
the version string will still read `0.1.0` — but the manifest's
template list should now include `region_create`; `call_template
region_create {...invalid params...}` returning PARAMS_INVALID
instead of TEMPLATE_NOT_FOUND is the cheapest reachability check).

### Step 5 mid-smoke fix (2026-06-29) — REGION_NAME_INVALID surface

Codex live-smoke 5-1 through 5-7 went green except 5-5. The 5-5 prompt
(`region_create {"name":"bad/name", start, end}`) returned
`PARAMS_INVALID` instead of the documented `REGION_NAME_INVALID`. Root
cause: `region-create.ts` had a Zod `superRefine` block that flagged
path separators with a custom Zod issue, but ALL Zod failures collapse
to `PARAMS_INVALID` at the `call_template` envelope — there's no way
for a Zod refinement to surface a domain-specific code. The locked
decision #5 wording "Rejected at the TS layer (superRefine) AND at the
Lua layer (defense in depth)" was internally inconsistent: the two
layers would surface different error codes, defeating the symmetry.

**Fix landed:** path-separator check removed from
`region-create.ts:superRefine`. `region.lua`'s existing
`REGION_NAME_INVALID` raise is now the single agent-facing surface for
both empty names and path-separator names. TS schema keeps only
structural checks (`min(1)`, mode XOR, finite bounds). Decision #5 +
the 5-5 narration above were rewritten accordingly.

**TS test updated:** `region-create.test.ts` flipped its
path-separator case from "TS rejects pre-bridge with PARAMS_INVALID"
to "bridge returns REGION_NAME_INVALID, envelope round-trips with the
domain code" — matches the REGION_NAME_TAKEN test's shape. Count is
still 8; `npm test` still 131/131 green, `npm run build` clean.

**Regression note for future windows:** do NOT re-add a path-separator
pre-check to TS. The agent-facing contract is "name-content rules
surface as `REGION_NAME_INVALID` from the bridge, matching
`REGION_NAME_TAKEN`". A defense-in-depth TS pre-check would steal the
domain code and force agents to parse the message to tell the cases
apart.

### Step 5 verification (2026-06-29)

All 8 smoke prompts above passed on REAPER 7.71/macOS-arm64.

- **5-0 (4c-postfix-trim regression)** — empty-take MIDI item with
  `D_LENGTH = 10` was selected, then `call_template item_trim
  {"item_id":"selected:0","length":1,"start_offset":0.1}`. Bridge
  returned `TAKE_NOT_FOUND` with message *"Item has no active take
  to set start_offset on"*; `D_LENGTH` was `10` before and `10` after
  (`unchanged = true`). This is the live confirmation of the 2026-06-28
  Lua correctness fix that landed alongside the Step 5 code drop —
  `item_trim` now resolves the active take BEFORE writing `D_LENGTH`
  when `start_offset` is supplied, so a missing take aborts cleanly
  instead of leaving the item half-mutated.
- **5-1..5-4, 5-6, 5-7** — first live pass on 2026-06-29 returned the
  expected `ok`/`error_code` for each prompt per the recipe; visible
  regions `var_01`, `var_02`, `var_03` landed in the REAPER timeline,
  `var_06`/`var_07` did not (REF_INVALID is "error → no change").
- **5-5** — first pass returned `PARAMS_INVALID` instead of
  `REGION_NAME_INVALID`. Contract bug, fixed in "Step 5 mid-smoke fix
  (2026-06-29)" above; re-smoke against the rebuilt `dist/` returned
  `REGION_NAME_INVALID` as documented.
- **5-8** — deliberately deferred to Step 6's `render_region` smoke.
  When Step 6 lands, the first prompt should resolve a
  `region:Name`-shaped ref end-to-end through `M.resolve_region`,
  which closes the third leg of the cross-type ref story.

Step 5 closed. Step 6 can now start.

### Code — Step 6 additions (2026-06-29) — code-done, REAPER-pending

`render_region` lands as the first (and only) consumer of the bridge's
new single-slot deferred-completion protocol. TS surface is fully tested
(15 new vitest cases, 146/146 green); REAPER live smoke is the gate.

**Bridge infrastructure** (`reaper/streetlight_bridge.lua`):

- `LAST_RESULT.renders = {}` + `ENTITY_BUCKET.render = "renders"`.
  `entity_kind = "render"` routes the new template's `changed_ids`
  (artifact paths) into the bucket. v0.1 has NO `last_result:render:N`
  resolver — the bucket exists so the cross-bucket clear stays
  exhaustive and v0.2 can wire a render→media_import chain without
  bridge structural change.
- `finalize_template(template_name, entity_kind, raw_changed)` extracted
  from the old inline path so the sync dispatch and the deferred-tick
  finalize share one place to enforce the locked envelope + the
  LAST_RESULT bucket write.
- `DEFERRED` slot + `tick_deferred()`. Single-slot continuation: handler
  returns `{ deferred = true, recheck = fn, on_timeout = fn,
  on_terminal = fn, deadline = abs_time }`; bridge stashes the slot,
  leaves `running/<id>.json` in place, skips claiming new pending
  commands until `tick_deferred` resolves the slot via `recheck → ok`
  / `recheck → raise` / `deadline hit → on_timeout → raise`. `close_with`
  unconditionally calls `on_terminal` so render settings are restored
  on every exit path. The continuation is BRIDGE-INTERNAL — agents only
  see the normal `Result<CallTemplateResult>` envelope, never a
  "rendering" sentinel.
- `process_one()` gated on `DEFERRED`: if set, ticks the slot and
  returns without claiming new pending.

**`reaper/packs/core/templates/render.lua`** (new):

- `M.render_region(params, ctx)`. Pre-flight before snapshotting settings:
  resolve region → validate `output_dir` (file_exists test for
  not-a-directory; probe-write then `EnumerateFiles`/`EnumerateSubdirectories`
  to distinguish missing vs not-writable) → collision-check the expected
  path → cache the WAV-24 format blob.
- 10-key snapshot/restore covering `RENDER_BOUNDSFLAG`, `RENDER_STARTPOS`,
  `RENDER_ENDPOS`, `RENDER_SRATE`, `RENDER_CHANNELS`, `RENDER_TAILFLAG`,
  `RENDER_ADDTOPROJ`, `RENDER_FILE`, `RENDER_PATTERN`, `RENDER_FORMAT`.
  (8 from the original RENDER_NOTES table + STARTPOS/ENDPOS we add for the
  custom-time bounds.)
- Render settings applied under `pcall`; failure restores and surfaces
  `INTERNAL_ERROR`. Then `Main_OnCommand(42230, 0)`. Then return the
  deferred sentinel. The recheck closure uses two-consecutive-same-size
  stability (100 ms window at 10 Hz). The `restore_once` flag enforces
  exactly-once restore across recheck-success / on_timeout / on_terminal.
- `RENDER_INTERNAL_DEADLINE_S = 55`. Sits 5 s under the MCP-side
  `RENDER_REGION_TIMEOUT_MS = 60_000` so `RENDER_TIMEOUT` surfaces with
  its typed code before the file-queue trips `BRIDGE_NOT_RUNNING`.
- `RENDER_FORMAT_WAV24_HEX` is a TBD placeholder. `get_render_format_blob()`
  decodes hex→bytes lazily on first render so the bridge boots cleanly
  while the constant is empty; calling `render_region` before the constant
  is filled raises a directive `INTERNAL_ERROR`.

**Manifest** (`reaper/packs/core/manifest.lua`): `render_templates =
dofile(...)`; `render_region` entry with `undoable = false` (snapshot/restore
is the project-state contract; nothing to undo project-side),
`entity_kind = "render"`.

**TS surface** (`packages/`):

- `packages/core/src/registry.ts` — `CapabilityDefinition.timeoutMs?:
  number`. Optional per-template wire timeout.
- `packages/mcp-server/src/tools/call-template.ts` — resolution order is
  now `explicit arg → def.timeoutMs → DEFAULT_CALL_TEMPLATE_TIMEOUT_MS`
  (5 s). The explicit-arg path stays so the existing `call-template.test.ts`
  cases that pass 80/100 ms timeouts keep working unchanged.
- `packages/mcp-server/src/templates/render-region.ts` (new) — Zod schema
  `{ region_id: string.min(1), output_dir: string.min(1) }`, strict mode.
  No `superRefine` (per the Step 5 decision #5 pattern — name-content and
  domain rules live in Lua so the agent-facing code is the domain code, not
  `PARAMS_INVALID`). `risk: "filesystem"`. `undoable: false`.
  `idempotent: false` (same params + same region content → same WAV bytes,
  but the second call returns `OUTPUT_FILE_EXISTS` because v0.1 refuses to
  overwrite). `timeoutMs: 60_000`.
- `packages/mcp-server/src/templates/index.ts` — one register line.
- `packages/core/src/types.ts` + `docs/RESPONSE_BUDGET.md` — `changed_ids`
  doc updated to call out the `render_region` carve-out: every other
  template uses project-entity refs (`guid:{...}` / `region:NAME` /
  `track:Name`); only `render_region` carries absolute artifact paths.
  Don't generalize.
- `packages/mcp-server/src/tools/__tests__/render-region.test.ts` (new,
  15 tests): happy-path artifact-path envelope round-trip, on-wire cmd
  shape, 5 `PARAMS_INVALID` branches (missing region_id / missing
  output_dir / empty either / strict extra field), 7 bridge-surfaced
  domain errors (`OUTPUT_DIR_MISSING`, `OUTPUT_DIR_NOT_WRITABLE`,
  `OUTPUT_FILE_EXISTS`, `REGION_NOT_FOUND`, `REF_INVALID` cross-type,
  `RENDER_TIMEOUT`, `RENDER_FILE_EMPTY`), and the `timeoutMs = 60_000`
  definition assertion.

**Locked deviations from RENDER_NOTES.md** (recorded as the 2026-06-29
amendment header in that file):

1. Snapshot/restore covers TEN keys, not the eight in the original table
   (STARTPOS + ENDPOS join because of BOUNDSFLAG=0 custom time).
2. `RENDER_PATTERN` is the literal region name, not `"$region"`. We
   already have the resolved name; `$region` expansion under
   `BOUNDSFLAG=0` is not guaranteed.
3. Two deadlines: MCP-side 60 s wire (`RENDER_REGION_TIMEOUT_MS`) +
   bridge-internal 55 s deadline (`RENDER_INTERNAL_DEADLINE_S`). The 5 s
   gap is load-bearing — `RENDER_TIMEOUT` lands before
   `BRIDGE_NOT_RUNNING` would.

**Regression notes** (carry across windows):

1. **Bridge deferred-completion is single-slot.** `v0.1`'s only consumer
   is `render_region` (the demo's terminal step). Second pending command
   waits its turn while a slot is active. Do not "fix" this into a queue
   without a written reason — the contract is `process_one` skips
   pending claims while `DEFERRED` is set, and `tick_deferred` owns the
   tick. A vitest invariant could be added in v0.2 if multi-slot lands.
2. **`changed_ids` for `render_region` is an artifact path, not an
   entity ref.** Every other template stays with `guid:{...}` /
   `region:NAME` / `track:Name`. Do NOT copy the artifact-path shape
   into another template. The TS `CallTemplateResult` doc + the
   `docs/RESPONSE_BUDGET.md` § `call_template` carve-out both call this
   out; the next writer who adds a "render-MP3" or "export-stems"
   template should re-read that section before deciding.
3. **`RENDER_PATTERN` is the literal region name, not the `$region`
   token.** Smoke 6-4 specifically asserts filename =
   `<region_name>.wav`. If a future maintainer "fixes" this back to
   `$region`, the smoke catches it — but it's also flagged in
   `templates/render.lua` header and in RENDER_NOTES.md to avoid the
   round trip.

**TS test count is now 146/146 green; `npm run build` clean.**

### Step 6 smoke recipe (verified 2026-06-29)

The user runs Codex. Direct client against fresh
`packages/mcp-server/dist/` for the same reason the Step 4c / Step 5
re-smokes did — Codex's bundled `mcp__streetlight` MCP registry predates
`render_region` and would return `TEMPLATE_NOT_FOUND` against it. Cheap
reachability check: `call_template render_region {}` should return
`PARAMS_INVALID` (missing region_id / output_dir), NOT
`TEMPLATE_NOT_FOUND`.

**Prerequisites:**

- `reaper/packs/core/templates/render.lua` has `RENDER_FORMAT_WAV24_HEX`
  filled in (run the C1 dump procedure in HANDOFF.md → hand-paste hex).
- A scratch output directory exists, e.g.
  `/Users/Zhuanz/Desktop/streetlight-smoke/`, empty. The recipe will write
  `var_01.wav`, `var_06.wav`, etc. **Use an absolute path in the prompt
  — Lua's `io.open` does NOT expand `~`, so `~/Desktop/streetlight-smoke`
  reaches the bridge verbatim and `validate_output_dir` reports
  `OUTPUT_DIR_MISSING`. This is intentional v0.1 (decision held 2026-06-29
  while fixing 6-1 `validate_output_dir`): cross-platform `~` semantics
  are out of scope; the prompt is responsible for absolute paths.**
- A REAPER project with one item selected on a named track. The Step 7
  demo uses 8 items; for the Step 6 smoke we only need 1 to drive a
  `region_create` + `render_region` pair.
- The user notes their REAPER `File → Render…` dialog settings BEFORE
  starting (format, sample rate, channels, file pattern, file path) so
  6-2 can assert no leak.

**Prompts:**

| # | Prompt | Expect |
|---|---|---|
| 6-0 | Reachability: `call_template render_region {}` against fresh `dist/` | `PARAMS_INVALID` (missing both required fields). NOT `TEMPLATE_NOT_FOUND`. |
| 6-1 | (Absorbs deferred 5-8.) `call_template region_create {"name":"var_01","item_id":"selected:0"}`, then `call_template render_region {"region_id":"region:var_01","output_dir":"/Users/Zhuanz/Desktop/streetlight-smoke"}` | `ok`. `changed_ids = ["/.../var_01.wav"]`, `changed_count = 1`, `truncated = false`. `var_01.wav` exists on disk, plays back the source item. This proves `M.resolve_region("region:var_01")` works end-to-end. |
| 6-2 | After 6-1, open REAPER's `File → Render…` dialog manually | Render Format / sample rate / channels / Directory / File name pattern are EXACTLY what the user noted before the smoke. Settings restored exactly-once. The user-noted dialog state in `BOUNDSFLAG` and `STARTPOS/ENDPOS` is back too (which is why we snapshot 10 keys, not 8). |
| 6-3 | `call_template render_region {"region_id":"last_result:region:0","output_dir":"/Users/Zhuanz/Desktop/streetlight-smoke-chain"}` after another `region_create` | `ok` with the new path in `changed_ids`. Proves `LAST_RESULT.regions` round-trip is the same after a render in between. |
| 6-4 | Inspect the written file path from 6-1 / 6-3 | Filename is literally `<region_name>.wav` (no `$region` token slipped in). |
| 6-5 | `call_template render_region {"region_id":"region:var_01","output_dir":"/Users/Zhuanz/Desktop/streetlight-smoke"}` AGAIN, same params as 6-1 | `OUTPUT_FILE_EXISTS`. The file from 6-1 is untouched. Render settings: still restored. |
| 6-6 | `call_template render_region {"region_id":"region:var_01","output_dir":"/path/that/does/not/exist"}` | `OUTPUT_DIR_MISSING`. Bridge did NOT touch render settings (the user can confirm by re-opening `File → Render…`). |
| 6-7 | `call_template render_region {"region_id":"region:var_01","output_dir":"/dev/null/nope"}` (or any directory the REAPER process can't write to) | `OUTPUT_DIR_NOT_WRITABLE`. Render settings untouched. |
| 6-8 | `call_template render_region {"region_id":"region:does_not_exist","output_dir":"/Users/Zhuanz/Desktop/streetlight-smoke"}` | `REGION_NOT_FOUND`. Render settings untouched. |
| 6-9 | Cross-type: `call_template render_region {"region_id":"selected:0","output_dir":"/Users/Zhuanz/Desktop/streetlight-smoke"}` (item ref in region slot) | `REF_INVALID` with a message naming the cross-type (`'selected:0' is an item reference; expected a region reference`). Render settings untouched. |

**Acceptance roll-up (after all of 6-0..6-9 pass):**

- One render writes one WAV to disk, < 30 s on typical hardware.
- Render dialog state is bit-identical to the user's pre-smoke snapshot
  after every successful AND every failed render call.
- Pre-flight errors (`OUTPUT_DIR_MISSING`, `OUTPUT_DIR_NOT_WRITABLE`,
  `OUTPUT_FILE_EXISTS`, `REGION_NOT_FOUND`, `REF_INVALID`) ALL surface
  without touching render settings.
- The deferred-completion machinery is invisible to the agent — every
  call returns either `{ok: true, result: ...}` or `{ok: false,
  error: ...}` with no `state: "rendering"` intermediate state ever
  visible.
- 5-8 (the deferred `region:Name` resolver coverage) is closed by 6-1.

**If Codex finds bugs:** follow the locked iteration loop — confirm from
code, name the fix + decision the user owns BEFORE editing, propose 1-2
regression notes for PROGRESS, wait for sign-off, fix, re-smoke. Do NOT
preemptively flip the Step 6 cell to ✅.

### Step 6 mid-smoke fix (2026-06-29) — `validate_output_dir` probe-first

Codex first live-smoke pass: 6-0 (reachability) ✅, REAPER selection ✅,
`region_create` ✅ (built `region:var_01_codex6_1782667429538`), and the
error-path prompts 6-6 / 6-7 / 6-8 / 6-9 all returned the documented
typed errors. **6-1 (happy render) failed**: the prompt passed
`output_dir = /Users/Zhuanz/Desktop/streetlight-smoke` (a real, writable
directory) and got back `{code: "OUTPUT_DIR_NOT_WRITABLE", message:
"output_dir is a regular file, not a directory: …"}`.

Root cause: `render.lua:validate_output_dir` short-circuited on
`reaper.file_exists(output_dir)` and assumed a `true` return meant
"regular file, not directory." It does not — live REAPER's
`file_exists` returns true for directories too. The function never
reached the probe-write branch on a real writable directory, so any
happy-path render hit the false-positive `OUTPUT_DIR_NOT_WRITABLE`.
TS vitest fakes the bridge envelope and can't catch this.

**Fix landed:** `validate_output_dir` reordered to probe-write first
(unique per-attempt probe name `.streetlight_probe_<time_precise>_<n>`,
up to 5 attempts, each pre-checked with `file_exists` so we never
truncate a user file even on a collision). Only after all probe
attempts are exhausted do we classify: if `file_exists(output_dir)` or
`dir_appears_to_exist(output_dir)` returns true → `OUTPUT_DIR_NOT_WRITABLE`,
else `OUTPUT_DIR_MISSING`. The locked decisions stay intact
(decision #5 from Step 6: regular file → `OUTPUT_DIR_NOT_WRITABLE`;
probe fail on existing dir → `OUTPUT_DIR_NOT_WRITABLE`; missing →
`OUTPUT_DIR_MISSING`) — only the *path* into those buckets changed.
The message wording for "regular file" was merged into the shared
"could not write probe file (regular file, permissions, or other)"
since probe-first can't distinguish those two without a separate stat.

**Regression notes for re-smoke (carry forward):**

1. An existing writable directory must pass `validate_output_dir` and
   allow 6-1 happy render. (Was the broken case.)
2. An existing regular file used as `output_dir` must still return
   `OUTPUT_DIR_NOT_WRITABLE`. The new message is the shared
   "Could not write probe file …" but the code is preserved.
3. A missing path must still return `OUTPUT_DIR_MISSING`. 6-6 covers it.
4. A user file that happens to be named
   `.streetlight_probe_<digits>_<digit>` inside `output_dir` must NOT
   be truncated or deleted by the probe. (Cold edge case — the probe
   name is unique-per-call via `reaper.time_precise()` so a real
   collision is vanishingly rare, but the `file_exists`-before-open
   guard makes it safe even if it happens.)

**Companion doc change:** the Step 6 smoke recipe above now writes
absolute `/Users/Zhuanz/Desktop/streetlight-smoke[-chain]` instead of
`~/Desktop/...`. Lua's `io.open` does NOT expand `~`, so a tilde path
would reach the bridge verbatim and surface `OUTPUT_DIR_MISSING`
(masking unrelated failures). Cross-platform `~` semantics are
deliberately out of scope for v0.1 — the prompt is responsible for
absolute paths.

**Open notes deferred out of this fix (next-round decisions):**

- **render-time region-name validation.** `region_create` rejects `/`
  and `\` (Step 5 decision #5, Lua-only surface), but
  `M.resolve_region` does not re-validate, and a user can hand-build
  a region in REAPER with a bad name (`/`, `\`, NUL, `$`, etc.). On
  `render_region`, that name flows straight into
  `<output_dir>/<region_name>.wav`. `docs/RENDER_NOTES.md:169` already
  promises NUL → `REGION_NAME_INVALID`. The right place for the extra
  check is `render.lua` after `resolve_region` returns (path-character
  rules belong with the consumer that needs them, not with
  `resolve_region`), but this crosses the Step 5 decision #5 "Lua
  owns name-content rules" boundary in a non-trivial way (now two
  Lua sites raise `REGION_NAME_INVALID`). Defer to a dedicated
  decision next round; smoke recipe currently does not exercise this
  path.
- **Foreground render + 55 s internal deadline.** When REAPER's
  "Render in background" preference is OFF, `Main_OnCommand(42230, 0)`
  blocks the main thread until the render completes, so the
  bridge-internal 55 s deadline never gets a chance to fire before
  the MCP-side 60 s outer wire timeout trips `BRIDGE_NOT_RUNNING`.
  The 5 s gap (Step 6 decision #4) is only load-bearing when the
  render returns reasonably fast. For Step 6 smoke this is fine (1-item
  region renders in well under a second); for Step 7's 8-item demo
  some renders may take longer and the contract could flip from
  `RENDER_TIMEOUT` to `BRIDGE_NOT_RUNNING` if any single render
  exceeds 60 s. Revisit at Step 7: either require background-render
  on for v0.1, or defer the render via a chunked tick.
- **100 ms file-stability window.** `recheck` confirms render-done
  after two consecutive ticks return the same positive size (at the
  10 Hz defer rate, that's a 100 ms stability window). Fine for
  small WAVs on fast disks; for large multi-minute renders on slow
  disks a brief pause mid-write could be misread as "done." Revisit
  at Step 7 (likely lift to ~500 ms-1 s, or require N consecutive
  stable samples).

### Step 6 mid-smoke fix #2 (2026-06-29) — bridge `dofile` multi-loop / generation guard

Codex re-smoke after the `validate_output_dir` fix landed: 6-0 ✅, 6-1 ✅
(happy render writes
`/Users/Zhuanz/Desktop/streetlight-smoke/var_01_codex6_1782668605967.wav`,
size 39 MB), 6-5 ✅ (`OUTPUT_FILE_EXISTS`), 6-6 ✅
(`OUTPUT_DIR_MISSING`), 6-7 ✅ (`OUTPUT_DIR_NOT_WRITABLE` with the new
probe message), 6-8 ✅ (`REGION_NOT_FOUND`), 6-9 ✅ (`REF_INVALID`
cross-type). **6-3 (`last_result:region:0` round-trip) failed**:
`region_create` returned ok with `changed_ids =
["region:var_02_codex6_1782668605967"]`, but the immediately following
`render_region {"region_id":"last_result:region:0",...}` returned
`REF_INVALID: "last_result:region:0 — no mutating call has produced
changed regions yet this session"`. Codex repeated the minimal probe
three times — same failure each time.

**Root cause:** every `dofile("…/streetlight_bridge.lua")` builds a
fresh chunk with its OWN locals: `LAST_RESULT`, `DEFERRED`, `DISPATCH`,
`process_one`, `oldest_pending`, `tick`. The previous chunk's `tick`
was already enrolled in `reaper.defer` and REAPER has no API to cancel
an in-flight defer chain — so each reload **adds** a ghost tick loop
on top of the prior one. After two-or-more reloads (here: hex fill, then
the `validate_output_dir` fix) several tick loops are concurrently
scanning `PENDING/`. Each `os.rename` (claim) is atomic, so each pending
command goes to exactly one chunk; but **the LAST_RESULT it writes is
private to that chunk**. 6-3 is the only Step 6 prompt that depends on
LAST_RESULT carrying over between two commands, so it's the only one
that exposes the split — `region_create` landed in chunk A which wrote
`A.LAST_RESULT.regions`, then `render_region` landed in chunk B whose
`B.LAST_RESULT.regions` was still empty. Self-contained refs
(`region:var_01`, `selected:0`, `region:does_not_exist`) resolve the
same in any chunk, which is why 6-1 / 6-5 / 6-8 / 6-9 stayed green and
hid the bug.

TS vitest can't reach this — vitest fakes the bridge envelope and never
exercises a real `reaper.defer` chain, much less two of them in the same
process.

**Fix landed:** `reaper/streetlight_bridge.lua` got a process-global
generation counter on `_G.STREETLIGHT_BRIDGE_GENERATION`. Each chunk
post-increments it on load (`_G.STREETLIGHT_BRIDGE_GENERATION =
(_G.STREETLIGHT_BRIDGE_GENERATION or 0) + 1`) and stashes its own value
in a `local MY_GENERATION`. `tick` checks `MY_GENERATION ==
_G.STREETLIGHT_BRIDGE_GENERATION` at the top of every cycle; on
mismatch it (a) pcalls the current `DEFERRED.on_terminal` once if a
slot is live, so a snapshotted render-dialog state is restored on
best-effort, (b) clears `DEFERRED` locally, (c) logs the self-exit, and
(d) returns WITHOUT re-enrolling in `reaper.defer` — the chain dies of
natural causes one tick later. We do NOT write a done envelope for the
abandoned slot: the new chunk has a fresh `LAST_RESULT` and writing the
old chunk's result would poison the new session's state. The orphaned
`running/<id>.json` stays on disk; the agent-side MCP timeout will
return `BRIDGE_NOT_RUNNING` for that command, which is the right
contract (we did not actually finish the work). Stale-running cleanup
at bridge startup is deferred to Step 7.

The startup `log` line now reports the generation: `[streetlight]
bridge starting (generation N)` and `[streetlight] bridge ready
(generation N) — templates: …`. Codex / the user can read the console
to confirm the chunk count.

**ONE-TIME RESTART NEEDED:** this is the FIRST chunk with the guard.
Older chunks already in `reaper.defer` were loaded by a version of the
bridge that does not check `_G.STREETLIGHT_BRIDGE_GENERATION` at all,
so they will not self-exit when the new chunk loads — `dofile`'ing the
new bridge into a REAPER that still has old ghost chunks would leave
the same split-LAST_RESULT bug. **Quit REAPER fully → reopen REAPER →
`dofile("…/streetlight_bridge.lua")` exactly once**. From that point
onward any subsequent reload is single-owner because the new chunk's
generation increment kills all prior generation-aware chunks within
one defer tick (~100 ms).

**Regression notes for re-smoke (carry forward):**

1. Bridge console log shows `bridge starting (generation N)` /
   `bridge ready (generation N)` on every `dofile`. N must increase by
   exactly 1 per `dofile` (`dofile` once after restart → N=1;
   `dofile` again → N=2 and the N=1 chunk logs
   `bridge generation 1 self-exiting (current is 2)`).
2. Re-smoke 6-3 (chain): `region_create` → immediately
   `render_region last_result:region:0` returns `ok` with the new
   artifact path in `changed_ids`. This is the head-on regression for
   this fix.
3. Full Step 6 roll-up 6-0..6-9 must pass under the post-restart
   single-chunk bridge.
4. **Step 6 live smoke caught repeated `dofile` leaving multiple
   bridge loops, causing `LAST_RESULT` session state to split;
   generation guard makes reload single-owner after the one-time
   REAPER restart.** (verbatim per the user request, for the audit
   trail next window will read).

**Open notes deferred out of this fix:**

- **Stale `RUNNING/` cleanup on bridge startup.** When an older chunk
  self-exits while holding a `DEFERRED` slot (or when REAPER is
  force-quit mid-render in a future session), the
  `running/<id>.json` file is left orphaned. The MCP-side timeout
  produces `BRIDGE_NOT_RUNNING` for that command, which is correct
  but noisy. Step 7 should scan `RUNNING/` at bridge startup and
  either (a) write a `done/<id>.json` with `INTERNAL_ERROR /
  "Bridge restarted while this command was running"`, or (b) silently
  `os.remove` the orphan and let the agent re-issue. Not in scope for
  Step 6.

### Step 6 verification (2026-06-29)

All 10 smoke prompts (6-0..6-9) passed on REAPER 7.71/macOS-arm64
against the post-restart single-chunk bridge. One-time REAPER full
restart landed before the run; the bridge console reported `bridge
starting (generation 1)` and `bridge ready (generation 1) — templates:
…`, confirming the generation-guard fix from this window's mid-smoke
fix #2 is now the single-owner gate.

- **6-0 reachability** — `call_template render_region {}` returned
  `PARAMS_INVALID` (missing both required fields) against the fresh
  `packages/mcp-server/dist/`, NOT `TEMPLATE_NOT_FOUND`. Bundled
  Codex MCP would have returned the latter (Step 4c snapshot); direct
  client against the patched build was the workaround. ✅
- **6-1 happy render** — after `region_create` produced
  `region:var_01_codex6_…`, `render_region` returned ok with the
  artifact path in `changed_ids` and the file landed on disk under
  `/Users/Zhuanz/Desktop/streetlight-smoke/`. Live confirmation that
  the probe-write-first `validate_output_dir` (mid-smoke fix #1) lets
  the happy-path render through. ✅
- **6-2 render dialog restore** — manual inspection of REAPER's
  `File → Render…` dialog after 6-1 + 6-3 found NO `streetlight-smoke`
  / `var_*` residue in Directory or File name pattern; sample rate /
  channels / bounds flag / start+end positions all matched the
  pre-smoke snapshot. 10-key snapshot/restore holds under
  `BOUNDSFLAG = 0` custom time. Exactly-once restore guard confirmed
  by the absence of any leaked state across both successful renders
  and the deliberate-error paths (6-5..6-9). ✅
- **6-3 chain (head-on for generation-guard fix)** — `region_create`
  → immediately `render_region {"region_id":"last_result:region:0",
  "output_dir":"/Users/Zhuanz/Desktop/streetlight-smoke-chain"}`
  returned ok with `changed_ids =
  ["/Users/Zhuanz/Desktop/streetlight-smoke-chain/var_02_codex6_1782670085842.wav"]`.
  This is the live regression for mid-smoke fix #2: prior to the
  generation guard, `region_create` would write
  `chunk_A.LAST_RESULT.regions` while `render_region` ran in
  `chunk_B` whose `LAST_RESULT.regions` was still empty, producing
  `REF_INVALID`. Post-restart single-owner bridge resolves
  `last_result:region:0` correctly. ✅
- **6-4 literal filename pattern** — written file from 6-1 / 6-3
  named literally `<region_name>.wav`; `$region` token did not slip
  in (Step 6 decision #3 holds against `BOUNDSFLAG = 0`). ✅
- **6-5 `OUTPUT_FILE_EXISTS`** — re-running 6-1 with identical params
  surfaced the typed error with the file from 6-1 untouched. Render
  settings still bit-restored. ✅
- **6-6 `OUTPUT_DIR_MISSING`** — `/path/that/does/not/exist` surfaced
  the typed error before any render settings touch. ✅
- **6-7 `OUTPUT_DIR_NOT_WRITABLE`** — non-writable target surfaced
  the typed error with the new shared probe-failure message ("Could
  not write probe file (regular file, permissions, or other)").
  Confirms probe-write-first path (mid-smoke fix #1) still
  classifies non-writable existing dirs correctly without false
  positives on writable ones. ✅
- **6-8 `REGION_NOT_FOUND`** — `region:does_not_exist` surfaced the
  typed error before any render settings touch. ✅
- **6-9 `REF_INVALID` cross-type** — item-shaped `selected:0` fed
  into the region slot surfaced the typed error naming both the
  offered ref and the expected kind. ✅

**WAV24 format pit fix verified end-to-end.** This window's
`RENDER_FORMAT_WAV24_HEX = "5A 58 5A 68 64 78 67 41 41 41 3D 3D"`
(ASCII `ZXZhdxgAAA==`) produced files that Codex inspected on disk:
`file` reports `"WAVE audio, Microsoft PCM, 24 bit, stereo 48000 Hz"`,
`afinfo` reports `"lpcm 24-bit little-endian signed integer"` (source
bit depth I24). The earlier blob (`ZXZhdyAAAA==`) wrote a file but
with the wrong bit depth; current value is the correct one and is
LOCKED — do NOT re-prompt for a hex dump unless a future smoke
surfaces a format mismatch.

**Open notes carried forward to Step 7** (see HANDOFF.md "Open notes"
for the full text): render-time region-name re-validation (NUL / `$`
hand-built bad names flowing into filename), foreground-render + 55 s
internal deadline (contract flips from `RENDER_TIMEOUT` to
`BRIDGE_NOT_RUNNING` if any single render exceeds 60 s under
foreground-render mode), 100 ms file-stability window (aggressive for
multi-minute renders on slow disks), stale `RUNNING/` cleanup on
bridge startup (orphaned `running/<id>.json` produces correct-but-
noisy `BRIDGE_NOT_RUNNING`). All four surface first in Step 7's
8-item render loop and need decisions early.

Step 6 closed. Step 7 can now start.

### Code — Step 7 additions (2026-06-29) — code-done, REAPER-pending

Step 7 scope per HANDOFF + MVP: `list_recipes` MCP tool + finalized
8-item recipe + README demo prose + the four Step 6 carry-over open
notes. `list_templates` joined the cut because the MVP "Required MCP
Tools" list includes it but no prior step had actually wired it — same
PR as `list_recipes` so the demo README doesn't have to explain a
missing sibling. NO COMMITS this window per the project's git-out-of-band
workflow; Codex picks up the working tree as-is for the 8-item smoke.

**Headline files:**

- `packages/mcp-server/src/tools/list-templates.ts` (new) — thin wrap
  over `registry.list()`. No bridge round-trip; returns ok-wrapped
  `{ templates: CapabilityMetadata[] }`. Wired in `index.ts` with a
  description that nails the "does NOT touch the bridge" property so
  agents don't bake retry logic around it.
- `packages/mcp-server/src/tools/__tests__/list-templates.test.ts`
  (new) — 4 tests: empty registry, full-pack metadata shape,
  JSON.stringify round-trip (catches accidental function leakage),
  registration order preservation.
- `packages/mcp-server/src/tools/list-recipes.ts` (new) — async
  loader. Per decision A3, **re-reads every call** (no startup cache).
  Per decision A4, bad YAML files surface in `result.warnings[]` AND
  log to stderr; the tool only returns `ok:false` if listing
  infrastructure itself breaks (e.g. EACCES on the dir). Per decision
  A5, Zod schema validates ONLY top-level envelope
  (`id`, `description`, optional `inputs`/`steps`/`version`) with
  `.passthrough()` for everything else — placeholders / template-
  param shapes are NOT validated here because recipes are
  agent-readable docs, not server-executed.
- `packages/mcp-server/src/tools/__tests__/list-recipes.test.ts`
  (new) — 10 tests: env override, empty dir, missing dir surfaces as
  warning (not ok:false), happy path with all envelope fields,
  passthrough preserves unknown top-level fields, malformed YAML
  skipped + warning, missing-`id` schema warning, non-YAML files
  ignored, re-reads on every call (NOT cached), sorted filename order.
- `recipes/impact_variations.yaml` — stripped `format: wav` from the
  `render_region` step (Step 6 locked the schema to strict
  `{ region_id, output_dir }` — `format` would PARAMS_INVALID before
  reaching the bridge). Added inline comment in the recipe explaining
  the strict-schema rule for future editors.
- `reaper/packs/core/lib/names.lua` (new) — single source of truth
  for region name-content rules per B1. Rejects `/`, `\`, NUL (`%z`),
  `$`. Both `region_create` (create-time guard) and `render_region`
  (post-resolve_region re-validation) call it. Rationale baked into
  the file header: path-escape, libc NUL-truncation, RENDER_PATTERN
  `$token` expansion.
- `reaper/packs/core/templates/region.lua` — `region_create` now
  delegates name validation to `lib/names.lua`. Same `REGION_NAME_INVALID`
  surface; expanded character set (was `/ \`, now `/ \ NUL $`).
- `reaper/packs/core/templates/render.lua` — two changes. (1) After
  `ctx.refs.resolve_region` returns, re-validates `region.name` via
  the same `lib/names.lua` helper, raising `REGION_NAME_INVALID` if
  a hand-built bad-name region in REAPER's UI ever feeds in (B1).
  (2) File-stability window lifted from 2 → 3 consecutive same-size
  ticks (~200 ms wall-clock @ 10 Hz; was ~100 ms). Counter `stable_ticks`
  resets when size changes or disappears (B3).
- `reaper/streetlight_bridge.lua` — startup adds `reap_stale_running()`
  before the "bridge ready" log (B4). Scans `running/*.json`, writes a
  typed `INTERNAL_ERROR / "Bridge restarted while this command was
  running"` done envelope for each orphan, then removes the running
  file. NOT silent deletion — agents waiting on a render get a
  definitive answer instead of waiting for the MCP-side 60 s
  BRIDGE_NOT_RUNNING. Race window with self-exiting older chunks
  analyzed in the function header: generation guard runs at the TOP of
  the prior chunk's next tick so the prior chunk never re-writes
  running/<id>.json after the reload — cleanup wins uncontested.
- `packages/mcp-server/src/templates/region-create.ts` — `describe`
  string updated to enumerate the full forbidden set (`/, \, NUL, $`)
  + note the render-time re-validation, so `list_templates` consumers
  see both halves of the rule.
- `packages/mcp-server/src/tools/__tests__/region-create.test.ts` —
  message-string update + new test asserting `$` and NUL flow through
  the same `REGION_NAME_INVALID` round trip via fake bridge.
- `packages/mcp-server/src/tools/__tests__/render-region.test.ts` —
  new test pinning the render-side `REGION_NAME_INVALID` round trip
  (hand-built bad-name region fed straight to `render_region`).
- `packages/mcp-server/src/index.ts` — wires the two new tools, bumps
  the startup log step number.
- `packages/mcp-server/package.json` — adds `js-yaml: ^4.1.0` (dep) +
  `@types/js-yaml` (devDep). `@streetlight/core` is unchanged — YAML
  is mcp-server-scoped per A1. **Justification** (per the
  IMPLEMENTATION_PLAN Step 8 "dependencies need justification" rule):
  recipes are human + agent readable; YAML's comment support and
  multi-line readability make it the right format for an
  agent-readable workflow guide that a sound designer can also edit
  by hand. The alternatives (hand-written YAML subset parser, or
  converting to JSON) both lose those affordances for a save of one
  small dep.
- `docs/INSTALL.md` — new "REAPER Preferences Required For v0.1"
  section spelling out "Render in background = ON" (B2). Decision note
  in-line: no startup runtime check because REAPER 7 exposes no
  reliable native API for the `workrender` config bit without SWS,
  and a fragile heuristic is worse than a docs requirement. Console
  sanity-check block updated to include the new `startup-cleanup`
  log line. Troubleshooting "Render Fails" updated with the
  background-render gotcha and the absolute-path / name-content rules.
- `README.md` — new "How To Run The Impact-Variations Demo" section
  with a 6-item prerequisite checklist (fresh output_dir, fresh
  project to avoid `REGION_NAME_TAKEN` / `OUTPUT_FILE_EXISTS`,
  Render-in-background ON, etc.), the exact agent prompt, expected
  outcome (8 items + 8 regions + 8 WAVs), and a recoverable-errors
  cheatsheet pointing back at the prerequisites that caused them.

**Decisions resolved this window** (all signed by user before code):

- **A1 — YAML lib:** `js-yaml@^4.1.0` to `@streetlight/mcp-server` deps
  only; NOT to `@streetlight/core`. Justification above.
- **A2 — `list_templates` scope:** ship alongside `list_recipes` in
  the same PR. Avoids the README having to explain a missing sibling.
- **A3 — Recipe load timing:** re-read recipes/*.yaml on every
  `list_recipes` call; NO startup cache. One file in v0.1, cost is
  negligible, eliminates an "edited the YAML, didn't restart, why's it
  stale" class of bugs.
- **A4 — `list_recipes` error contract:** bad YAML is SKIPPED with a
  stderr warn AND a structured entry in `result.warnings[]`. The tool
  only returns `ok:false` for infrastructure failures (e.g. EACCES on
  the dir). Single bad recipe never blocks the whole listing.
- **A5 — Recipe schema strictness:** envelope-only Zod
  (`id`, `description`, optional `inputs`/`steps`/`version` +
  `.passthrough()`). Placeholders and template-param shapes are NOT
  validated server-side — recipes are agent-readable docs.
- **B1 — render-time region-name re-validation:** added. Same Lua
  helper (`lib/names.lua`) drives BOTH `region_create` (create-time)
  AND `render_region` (post-resolve). Forbidden set extended from
  `/ \` to `/ \ NUL $`. `$` rejected because RENDER_PATTERN would
  expand `$region` / `$project` / `$track` tokens in the name. NUL
  rejected because libc-backed file APIs truncate at the first NUL,
  silently changing the destination path. Single Lua-owned source of
  truth preserves Step 5 decision #5 ("Lua owns name-content rules").
- **B2 — foreground render / 55 s deadline interplay:** chosen the
  docs-only path. INSTALL.md + README require "Render in background"
  ON; no startup runtime check (no reliable native API without SWS,
  and a fragile heuristic is the failure mode B2 was about avoiding).
- **B3 — file stability window:** 2 → 3 consecutive same-size ticks
  (~100 ms → ~200 ms @ 10 Hz). Demo's small WAVs on fast disks pay
  one extra tick of latency; large multi-minute renders on slow disks
  get the safety margin.
- **B4 — startup stale-`RUNNING/` cleanup:** added per the spec —
  write a typed `INTERNAL_ERROR` done envelope for each orphan, then
  `os.remove` the running file. NOT silent deletion — agents waiting
  on a render get a typed terminal answer instead of the MCP-side
  60 s BRIDGE_NOT_RUNNING.

**Verification this window** (TS-only; REAPER smoke is Codex's gate):

- `npm run build` clean (no TypeScript errors, all packages emit).
- `npm test` 162/162 green (was 146 at Step 6 close; +4
  list_templates, +10 list_recipes, +2 region/render REGION_NAME_INVALID
  expansion).
- Build artifacts at `packages/mcp-server/dist/` are the ones Codex's
  direct-client harness loads — the bundled `mcp__streetlight` MCP
  server is still the Step 4c snapshot (workaround documented in
  HANDOFF.md). Cheapest reachability check still
  `call_template render_region {}` → PARAMS_INVALID.

**What Step 7 deliberately did NOT do** (carried by MVP-locked scope):

- No recipe executor / orchestrator — the agent reads `list_recipes`
  output and issues one `call_template` per step itself. The YAML
  comment at the top of `impact_variations.yaml` says so explicitly.
- No `plan` / `apply` (v0.3).
- No batched / multi-call template execution (v0.2).
- No INI / fragile heuristic for the "Render in background" check
  (B2 explicit decision).

**Open items for Step 8** (final disposition after Round A + C):

- ~~Foreground-render + 55 s internal deadline edge case.~~ **Closed
  Round C (docs-only).** v0.1 requires Render-in-background ON per
  B2; INSTALL.md + README + render.lua header cover the contract.
  Round C added a v0.2 forward-look at the end of INSTALL.md's
  "Render in background" section + a matching ROADMAP.md v0.2 entry
  ("foreground-render support via chunked-tick render loop"). No
  detection code per the explicit B2 docs-only decision.
- Linux queue-dir mismatch (Lua falls through to the macOS path).
  **Round B deferred to v0.2** — env-var workaround in INSTALL.md is
  the supported v0.1 path; no live Linux REAPER rig to verify a Lua
  resolver change.
- ~~**Risk policy not enforced in `call-template.ts`**~~ **— closed
  Round A.** `callTemplate` now takes a defaulted `RiskPolicy` 5th
  param and emits `RISK_BLOCKED` between `registry.get` and
  `params.safeParse`. v0.1 stays on `defaultPolicy()` (env-var override
  defers to v0.2).
- ~~**`file-queue.ts` `pollForResult` does not wrap non-ENOENT
  errors**~~ **— closed Round A.** `readIfExists` call site wrapped;
  non-ENOENT becomes `INTERNAL_ERROR` (recoverable: false), pending
  file cleaned best-effort. Class JSDoc contract honored.
- ~~**`done/` orphan accumulation**~~ **— closed Round A.** Best-effort
  startup sweep in `init()` unlinks `done/<id>.json` older than 24h.
  Only touches `done/`; subdirs / non-files left alone; sweep failure
  never rejects init.
- ~~**Vitest 2 / Vite / esbuild dev advisories**~~ **— evaluated Round
  C, deferred post-v0.1.** 5 dev-only vulns (3 mod, 1 high, 1 crit)
  but effective real-world exposure is zero in current usage:
  critical needs `vitest --ui` (repo uses `vitest run`); high needs
  Windows dev-server; moderates all need dev-server / `esbuild
  --serve` / Windows. `npm audit --omit=dev` clean — what ships to
  users is unaffected. Fix is a two-major jump (`vitest@2 → 4.1.9`,
  skips 3); best in a dedicated session post-release.

### Step 7 pre-smoke recipe fixes (2026-06-29 same window)

Codex pre-smoke review on the 2026-06-29 code drop caught two recipe-
level issues in `recipes/impact_variations.yaml` before any REAPER
round-trip ran. Both fixed in this window with no test/build regression
(162/162 green, `tsc -b` clean):

1. **`reuse: true` → `reuse_existing: true`** (hard bug). The
   `track_create` step at the top of `steps:` passed `reuse: true`,
   but the template's Zod params (`packages/mcp-server/src/templates/track-create.ts:35`)
   declare `reuse_existing` on a `.strict()` object. The 8-item smoke
   would have failed at step 2 with `PARAMS_INVALID`, never reaching
   the `for_each` loop. Single-word rename, zero decision.
2. **`item_id: "selected:0"` → `"{{ selection.selection.items[0].id }}"`**
   (drift hardening). The recipe's first step
   `get_state {scope: selection}` already binds the result as
   `selection`, but the `for_each` loop's `item_duplicate` step then
   ignored the binding and re-resolved `"selected:0"` against REAPER's
   live selection on every iteration — fragile if any earlier step in
   the loop nudged selection. Switched to the bound GUID so every
   duplicate sources from the initial selection snapshot. Companion
   note added to the recipe's trailing comment block and README
   prerequisite #5: the agent MUST abort before any mutating call if
   `selection.selection.items.length !== 1`.

`recipes/impact_variations.yaml` is the only file with content
changes from these two; `README.md` got the prereq-#5 wording bump.
No commits.

### Step 7 mid-smoke fix — `.RPP` sidecar suppression (2026-06-29 same window)

First Codex Step 7 live smoke ran the core 8-item chain successfully:
`list_templates` / `list_recipes` / `get_state(selection)` clean,
`track_create` ok, all 8 variations walked `item_duplicate` →
`item_pitch` → `item_rate` → `item_fade` / `item_trim` → `region_create`
→ `render_region`, 8 WAVs landed in `~/Desktop/streetlight-step7-smoke`,
`file` / `afinfo` confirmed 24-bit PCM stereo 48000 Hz and var_08's
0.5 s trim shape. **Not flipped to ✅** because the output dir also
contained 8 `var_NN.wav.RPP` project-copy sidecars — a contract
violation (`render_region`'s artifact contract is exactly one WAV
per region, returned as the only entry in `changed_ids`).

**Root cause.** Codex on the Codex side traced this to REAPER's
`autosaveonrender` / `autosaveonrender2` reaper.ini config vars; the
user's `autosaveonrender2=1` was triggering REAPER's "save project
copy on render" behavior, which dumps a `<output>.RPP` next to every
rendered file. These are ini-level vars, read/written through
`reaper.get_config_var_string` / `reaper.set_config_var_string`, not
`GetSetProjectInfo*` — so they sat outside the existing 10-key
project-info snapshot in `render.lua` and were never suppressed.
Official ReaScript docs confirm: `RENDER_SETTINGS` /
`RENDER_ADDTOPROJ` do not gate this checkbox.

**Fix (one file, `reaper/packs/core/templates/render.lua`).**
Snapshot grew from 10 project-info keys to 10 + 2 ini config vars:

- `snapshot_render_settings()` now also captures
  `autosaveonrender` and `autosaveonrender2` via a small
  `get_config_var_string_or_nil(name)` helper. When
  `get_config_var_string` returns `retval=false` (var doesn't exist
  on this REAPER build) the snapshot stores nil for that key.
- The pcall-guarded apply block sets each to `"0"` only when the
  snapshot captured non-nil — a REAPER that doesn't expose the var
  can't have the .RPP-sidecar bug either, so silent-skip is correct.
- `restore_render_settings(s)` writes back via
  `reaper.set_config_var_string(name, s.value)` under the same
  nil-skip rule. Restore runs in the existing exactly-once
  `restore_once` / `on_terminal` teardown — symmetric with the 10
  project-info keys, no new lifecycle.
- Header note (1) updated: "TEN keys" → "TEN project-info keys +
  TWO reaper.ini autosave-on-render config vars."

No TS surface touched. `npm test` still 162/162 green; `npm run build`
still clean. The TS fake bridge cannot model `set_config_var_string`
side effects, so the regression check is live-smoke-only:

**Step 7 / Step 8 live-smoke regression check (mandatory).** After
any `render_region` invocation the output directory must contain
exactly the expected `<region_name>.wav` artifacts and ZERO
`.RPP` sidecars. Any `.wav.RPP` (or `.RPP-bak`) file means the ini-var
suppression regressed and the snapshot keys need re-auditing for new
REAPER versions. Smoke must also re-confirm `changed_ids` from
`render_region` contains the WAV artifact path only — no sidecar
paths bleeding into the carve-out.

`reaper/packs/core/templates/render.lua` is the only file with
content changes from this fix. No commits.

### Step 7 second mid-smoke fix — `set_config_var_string` arity (2026-06-29 same window)

Codex focused re-smoke (output dir `~/Desktop/streetlight-step7-resmoke-1782700436899`)
still emitted 8 `.wav.RPP` sidecars despite the first mid-smoke fix.
8 WAVs were all 24-bit PCM stereo 48 kHz, `changed_ids` was clean
WAV-only for every region, but sidecar mtimes landed 66-77 ms BEFORE
the corresponding WAVs — proof REAPER read `autosaveonrender2`
at render-init and our suppression had never actually taken effect.

**Root cause.** The first mid-smoke patch shipped
`reaper.set_config_var_string("autosaveonrender", "0")` (2-arg).
The official ReaScript signature is 3-arg:
`reaper.set_config_var_string(name, value, persist)` — see
<https://www.reaper.fm/sdk/reascript/reascripthelp.html#set_config_var_string>.
REAPER's binding rejects the wrong-arity call silently (no Lua
exception, no console message), so the apply block looked successful
but the in-memory `autosaveonrender2` stayed at `1` throughout the
render. Lesson: ReaScript API calls without return-value checks can
silently no-op when the arity is wrong; always check the boolean
return on `set_*` variants going forward.

**Fix (same file).**

- Apply block now calls `reaper.set_config_var_string(name, "0", 0)`
  (persist=0 = in-memory only; user's reaper.ini stays untouched),
  checks the return value, and raises `INTERNAL_ERROR` on a falsy
  return. We deliberately refuse to render with the sidecar still
  armed — the pcall guard around the apply block triggers the
  symmetric restore, so the user's render dialog is left as it was.
- Restore block also moved to the 3-arg `set_config_var_string(name,
  value, 0)` form, best-effort (mirrors the RENDER_* keys; any
  failure is observable through the .RPP-sidecar regression check).
- Header note (1) bumped with the arity post-mortem + link to the
  ReaScript reference page.

`npm test` 162/162 still green; `npm run build` still clean. No new
TS surface. The live-smoke regression check from the first mid-smoke
section still applies verbatim — output_dir must contain exactly the
expected `<region_name>.wav` artifacts and zero `.RPP` (or `.RPP-bak`)
sidecars after `render_region`.

`reaper/packs/core/templates/render.lua` is the only file with
content changes from this second fix. No commits.

### Step 7 third mid-smoke — `autosaveonrender*` theory falsified, probe phase (2026-06-29 same window)

Codex second focused re-smoke (output dir
`~/Desktop/streetlight-step7-resmoke-1782701420390`,
source `POP Sucker 01.ogg` 0.4449 s, fresh bridge generation 1) gave
8 WAVs (all 24-bit PCM stereo 48 kHz) with `changed_ids` clean
WAV-only AND `reaper.ini`'s `autosaveonrender=0` / `autosaveonrender2=1`
unchanged pre/post (persist=0 confirmed working) — but the output dir
**still** contained 8 `var_NN_codex7b_*.wav.RPP` sidecars.

**Theory falsified.** The second fix proved the 3-arg
`set_config_var_string(name, "0", 0)` call demonstrably succeeded:
boolean true return (no INTERNAL_ERROR raise), in-memory write
landed (persist=0 explicitly), reaper.ini untouched (still =1
post-smoke). So `autosaveonrender` / `autosaveonrender2` are NOT
the control point for the Render-dialog "save copy of project to
outfile.wav.RPP" checkbox the user has on. The existing snapshot/
restore entries for those two vars stay in `render.lua` — they're
harmless and zero-cost — but suppression no longer relies on them.

**New leading suspect: `renderclosewhendone`.** Per the
community-maintained Ultraschall config-var reference, this is a
bitfield governing the Render-dialog bottom-row checkboxes:

  - `0x1`     (1)     auto-close render windows
  - `0x10`    (16)    silently increment filenames
  - `0x8000`  (32768) save outfile.render_stats.html
  - `0x10000` (65536) save copy of project to outfile.wav.RPP   ← suspect

The user's on-disk `reaper.ini` shows `renderclosewhendone=2164`
(= `0x4 | 0x10 | 0x20 | 0x40 | 0x800`), which does NOT include
`0x10000`. But the on-disk value is not necessarily the in-memory
value if the user toggled the Render-dialog checkbox after REAPER
last persisted prefs.

**Probe phase before any further mutation.** Rather than blind-fix
on a second unverified theory, this window landed
`reaper/streetlight_probe_renderconfig.lua` — a pure-read script
the user runs through REAPER's Actions list. It dumps:

  - `autosaveonrender` / `autosaveonrender2` (sanity)
  - `renderclosewhendone` raw value + bit decode
  - `RENDER_SETTINGS`, `RENDER_ADDTOPROJ` project info
  - REAPER version
  - Highlights `0x10000` set/unset, with explicit next-step guidance

The probe modifies nothing and is safe to run in any project state.
Output gets pasted into the next handoff; the THIRD mid-smoke fix
(if needed) is decided from that data, not from another guess.

If `renderclosewhendone & 0x10000` is set in-memory, the planned fix
is: extend `render.lua` snapshot to capture `renderclosewhendone`,
mask `0x10000` off in the apply pcall (3-arg `set_config_var_string`
with persist=0 and return-value check, mirroring the second fix's
pattern), restore via the existing `restore_once`/`on_terminal`
teardown. The `autosaveonrender*` snapshot entries stay in place —
harmless and they document a falsified theory in the code itself.

If the probe shows `0x10000` NOT set, sidecar control lives
elsewhere; next step would be inline logging around `Main_OnCommand(42230)`
or a wider `renderclose*`/`save*` var sweep.

**Test environment note.** The user explicitly keeps the
Render-dialog `.wav.RPP` checkbox CHECKED — that IS the regression
test environment. Do not ask them to uncheck it as a workaround.

`reaper/streetlight_probe_renderconfig.lua` is the only file added
in this round (debug scaffolding — delete after Step 7 ✅). No
production code changed. `npm test` still 162/162, `npm run build`
still clean. No commits.

### Step 7 probe phase 1 results + active 0x4 bit probe (2026-06-29 same window)

First Codex probe run came back with three telling facts:

1. `autosaveonrender` and `autosaveonrender2` are `<not available>`
   on this REAPER build entirely — `get_config_var_string` returned
   `retval=false`. So the existing nil-skip in `render.lua` means
   the snapshot/apply/restore have been no-ops for those two vars
   on this user's REAPER all along; the previous two mid-smoke
   fixes never actually touched anything REAPER cared about. The
   theory was falsified by absence as much as by behavior.
2. `renderclosewhendone = "2164"` = `0x874` = bits
   `0x4 | 0x10 | 0x20 | 0x40 | 0x800`. The Ultraschall-documented
   sidecar bit `0x10000` is NOT set. But the user's Render-dialog
   `.wav.RPP` checkbox IS checked and live smoke confirms sidecars
   do get emitted. Two possibilities: (a) Ultraschall's bit table
   is stale for REAPER 7.71 and the actual sidecar bit moved, with
   `0x4` being the leading candidate by elimination (it's the
   user-prediction-aligned bit that's set when sidecars are
   emitted); (b) the controlling state isn't in `renderclosewhendone`
   at all, in which case the right v0.1 path is guarded cleanup of
   the post-render sidecar rather than chasing the bit.
3. `RENDER_SETTINGS = 0` and `RENDER_ADDTOPROJ = 0` — no signal
   there.

**Active 0x4 toggle probe landed.** Rather than guess between (a)
and (b), `reaper/streetlight_probe_renderconfig.lua` gained a
Phase 2 ACTIVE PROBE section (opt-in via
`RUN_ACTIVE_BIT_PROBE = true`, default on) that:

  * snapshots all 10 RENDER_* keys + `renderclosewhendone`
  * configures a 0.1 s probe render into a throwaway
    `~/Desktop/streetlight-probe-active-<ts>/` directory using
    the user's existing RENDER_FORMAT (the `.wav.RPP` write
    decision is independent of audio format)
  * masks `0x4` off `renderclosewhendone` via 3-arg
    `set_config_var_string` with persist=0 and return-value check
  * triggers `Main_OnCommand(42230, 0)` and defer-polls for the
    output WAV (5 s deadline)
  * checks whether a `.wav.RPP` (or `.wav.RPP-bak`) sidecar
    appeared, deletes both, removes the probe directory if empty
  * restores every snapshotted setting in every exit path
    (success / timeout / set failure / pcall error)
  * prints the verdict directly to the ReaScript console, plus a
    recommendation: bit-clear fix if sidecar suppressed, guarded
    cleanup fix if sidecar still emitted

**Conditional next-step fix paths (decided in advance, executed
once the active probe returns):**

  * **A. 0x4 IS the bit (probe says sidecar absent).** Third
    mid-smoke fix in `render.lua`: snapshot/restore extends to
    `renderclosewhendone`; apply block masks `(0x4 | 0x10000)` off
    via 3-arg `set_config_var_string(name, value, 0)` with
    return-value check + INTERNAL_ERROR raise on failure. We mask
    both bits to stay compatible with builds where the documented
    `0x10000` is the right one and only fail forward to the
    Ultraschall path.
  * **B. 0x4 is NOT the bit (probe says sidecar still present).**
    Switch to guarded-cleanup strategy: preflight (the existing
    `check_no_collision` site in `render.lua`) extends to refuse
    pre-existing `<expected>.RPP` / `<expected>.RPP-bak` with a
    typed `OUTPUT_FILE_EXISTS`. The recheck-success branch
    confirms+removes the auto-generated `<expected>.RPP`/`.RPP-bak`
    before returning `changed_ids`; deletion failure raises
    `INTERNAL_ERROR` so the agent never sees a half-cleaned dir.
    Both bits stay un-touched in this path — the bug is in
    REAPER's render dialog UI control, not in any settable var.

**Test environment locked.** The user keeps the Render-dialog
`.wav.RPP` checkbox CHECKED — that IS the regression test
environment, so neither fix path can rely on the user un-checking
the box.

`reaper/streetlight_probe_renderconfig.lua` is the only file with
content changes from this round (still the Step 7 ✅ delete-after
probe scaffolding). No production code changed. `npm test` still
162/162, `npm run build` still clean. No commits.

### Step 7 third mid-smoke fix — path-B guarded cleanup (2026-06-29 same window)

Codex active 0x4 probe ran and **crashed on
`set_config_var_string`** before it could even reach the test
render: `attempt to call a nil value (field 'set_config_var_string')`.
Stock REAPER 7.71/macOS-arm64 doesn't expose the setter at all,
even though the getter (`get_config_var_string`) works fine. So:

- The previous two mid-smoke fixes never actually executed any
  setter call on this build — they only avoided crashing because
  `get_config_var_string("autosaveonrender*")` ALSO returned
  `retval=false`, so the snapshot stored nil and the nil-skip
  branch took over.
- Any future REAPER build where the getter succeeded but the
  setter remained nil would have hard-crashed render.lua mid-render
  — `attempt to call a nil value` — without ever rendering anything.
- Bit-clearing on `renderclosewhendone` is also off the table for
  the same reason: same setter, same nil.
- Conclusion: config-var suppression is not viable on stock REAPER.
  Path-A (bit-clear) was eliminated by API surface, not by
  hypothesis. Path-B (guarded cleanup) is the only v0.1-viable
  approach.

**Path-B fix landed in `render.lua` (one file).**

  * **Snapshot/restore reverted to 10 RENDER_* keys.** The two
    `autosaveonrender*` entries plus the `get_config_var_string_or_nil`
    helper are gone — keeping dead nil-skip code makes the next
    contributor think suppression is wired when it isn't, and the
    fragile-on-some-build risk above is real. Header note (1)
    rewritten to record the full post-mortem.
  * **Preflight no-clobber extended.** `check_no_collision` now
    rejects pre-existing `<wav>.RPP` and `<wav>.RPP-bak` with the
    same `OUTPUT_FILE_EXISTS` code (message names the colliding
    path so the agent / user can clean up the right file). This is
    the guarantee that lets cleanup-on-success delete only files
    THIS render produced.
  * **Post-render cleanup in `recheck`.** When the WAV stabilizes
    (the existing 3-tick window), the success branch checks both
    sidecar paths and `os.remove`s them before falling through to
    `restore_once`. A delete failure raises typed `INTERNAL_ERROR`
    with the path that couldn't be removed; bridge's `tick_deferred`
    pcalls `recheck`, so the typed raise lands in the wire envelope
    as a clean error code (see `template_error_envelope` in
    `streetlight_bridge.lua`). Cleanup runs BEFORE `restore_once`
    because the sidecar is on disk at render-init time and has no
    dependency on the snapshotted RENDER_* settings.
  * **`changed_ids` unchanged.** Still WAV-only — the agent sees
    either the artifact path or a typed error code.

**Tests + build.** TS-side render-region tests grew by 2 (preflight
collision: pre-existing `.wav.RPP` → `OUTPUT_FILE_EXISTS`,
pre-existing `.wav.RPP-bak` → `OUTPUT_FILE_EXISTS`) so the typed
envelope round-trip is pinned. Cleanup-on-success itself cannot be
unit-tested without modeling REAPER's sidecar emission and is
verified by the live smoke. Total: **164/164** green
(162 baseline + 2 new); `npm run build` clean.

**Probe file retained.** `reaper/streetlight_probe_renderconfig.lua`
stays in the tree until Step 7 ✅. Phase 2 (the active 0x4 probe
that crashed) is no longer useful but is harmless dead code — the
crash itself is the artifact that documented why path-A is
unreachable. Delete the whole file once the focused re-smoke is
green.

**Lesson (carry forward).** When wiring a setter you've never
called on this REAPER build, assert the function is present
(`type(reaper.foo) == "function"`) before relying on it for a
contract-load-bearing path. Better still: do the probe-of-the-API
as the FIRST mid-smoke step, not the third. The previous two fixes
plus the static probe all assumed the setter existed because the
getter did — a 30-second `print(type(reaper.set_config_var_string))`
on a fresh REAPER would have killed the whole `autosaveonrender*`
detour on round 1.

`reaper/packs/core/templates/render.lua` is the only production
file changed in this round;
`packages/mcp-server/src/tools/__tests__/render-region.test.ts`
got 2 new test cases. No commits.

### Step 7 verification (2026-06-29)

Path-B re-smoke green on REAPER 7.71/macOS-arm64, same window as the
fix. Source item: `POP Sucker 01.ogg` (0.4449 s). Output dir:
`~/Desktop/streetlight-step7-resmoke-1782704645367`. Suffix:
`codex7c_1782704645367`. Render-dialog `.wav.RPP` checkbox kept ON —
that IS the regression environment.

Pass criteria:

1. 8/8 variations completed end-to-end.
2. Output dir contained exactly the 8 expected WAVs
   (`var_01_codex7c_…wav` .. `var_08_codex7c_…wav`) and **nothing
   else** — sidecars: `[]`, zero `.wav.RPP` / `.wav.RPP-bak`.
3. `file` / `afinfo` confirmed every WAV is 24-bit PCM stereo
   48000 Hz; `var_08` is the 0.5 s trimmed variant.
4. Each `render_region` invocation returned `changed_ids` containing
   only the corresponding WAV absolute path (`changedIdsOk=true`).
5. Focused preflight side-quest: hand-touched
   `var_01_codex7c_…wav.RPP` into a separate
   `~/Desktop/streetlight-step7-preflight-1782704645367/` dir, then
   invoked `render_region` against that path → typed
   `OUTPUT_FILE_EXISTS` with the colliding `.wav.RPP` in the message
   AND the user-touched file untouched (`fileUntouched=true`).

164/164 TS tests green pre-and-post, `npm run build` clean. No
commits. `reaper/streetlight_probe_renderconfig.lua` removed at
verification close per its lifecycle comment — the post-mortem lives
in the three preceding "Step 7 ... mid-smoke ..." sections and in
`render.lua`'s header note (1).

Step 7 ✅. Step 8 (release polish for the 6 open notes) was the next
thing on deck and closed across Round A + Round C in the same window
(see entries below); Round B (Linux queue-dir) deferred to v0.2.

### Step 8 Round A (2026-06-29) — risk gate + file-queue contract hardening

Round-A scope per the Step-8 plan locked this window: the three v0.1
release-blockers from the six open notes (#3, #4, #5). Linux queue-dir
(#2) explicitly deferred to v0.2 — INSTALL.md already covers the
env-var workaround and we have no live Linux REAPER rig to verify a
Lua resolver change against. Foreground-render (#1) and Vitest/Vite
audit (#6) belong to Round C.

**Decisions locked this round (carry forward):**

10. **Risk policy plumbing v0.1:** `defaultPolicy()` only. NO env-var
    override (e.g. `STREETLIGHT_RISK_ALLOW=...`). v0.1 ships zero
    `destructive` / `unsafe_eval` templates so the toggle is pure
    overhead; env-var configuration defers to v0.2 alongside whatever
    first `destructive` template lands. `callTemplate` takes the policy
    as a defaulted 5th parameter — `packages/mcp-server/src/index.ts`
    is unchanged, the v0.2 refactor will plumb it explicitly.
11. **`done/` orphan sweep policy:** startup-only, 24-hour mtime
    threshold, best-effort. Three-layer try/catch (readdir / stat /
    unlink) so any sweep failure logs a stderr warn and is swallowed —
    sweep must NEVER reject `init()`. Only touches `done/`; `pending/`
    and `running/` are owned by the bridge. `isFile()` short-circuit
    leaves subdirectories or hand-dropped non-files alone (defensive —
    we don't blast user folders).
12. **`pollForResult` non-ENOENT recovery shape:** wrapped errors
    surface as `INTERNAL_ERROR` with `recoverable: false`. Shares the
    same "agent must call `get_state` to inspect actual state"
    recovery semantics as the `BRIDGE_NOT_RUNNING` mutating-timeout
    case — the wire command may or may not have applied between the
    bridge claiming it and the read failing. Pending-file cleanup is
    best-effort before returning.

**Code drop (4 files, ~7 new tests, no live REAPER round-trip):**

- `packages/mcp-server/src/tools/call-template.ts` (Open Note #3):
  - Imports `RiskPolicy`, `defaultPolicy`, `allow` from `@streetlight/core`.
  - `callTemplate(client, registry, input, timeoutMs?, policy?)` —
    5th param defaults to `defaultPolicy()`.
  - `RISK_BLOCKED` check inserted between `registry.get(name)` and
    `def.params.safeParse(...)`. Order matters: a forbidden
    `destructive` template called with junk params returns
    `RISK_BLOCKED`, never `PARAMS_INVALID` (test guards this). The
    queue is not touched.
  - JSDoc updated to spell out the 5-step validation chain.
- `packages/mcp-server/src/transport/file-queue.ts` (Open Notes #4 + #5):
  - **#4** — `pollForResult` wraps the `readIfExists(donePath)` call in
    try/catch. Non-ENOENT (EACCES / EIO / ENOTDIR / …) becomes
    `err(INTERNAL_ERROR, ..., { recoverable: false })`. Pending file is
    unlinked best-effort first. Honors the class JSDoc contract
    ("errors never reject — they resolve into a Result<R>") that
    previously had a hole.
  - **#5** — `DEFAULT_DONE_ORPHAN_THRESHOLD_MS = 24 * 60 * 60 * 1000`
    constant. `FileQueueClientOptions.doneOrphanThresholdMs` is a
    test-only override (env-var configuration deferred to v0.2 with
    the risk-policy override).
  - `init()` awaits `sweepDoneOrphans()` after the three `mkdir`s.
    Each entry: stat → `isFile()` check → mtime check → unlink, all
    per-entry try/catch. Sweep-wide readdir is wrapped separately.
    Failures write `[streetlight-mcp] done-sweep: …` warnings to
    stderr and are swallowed.
- `packages/mcp-server/src/tools/__tests__/call-template.test.ts` (+2):
  - Adds a `risk policy enforcement` sub-describe.
  - **`RISK_BLOCKED under default policy, no queue write, no params parse`**
    — registers a fake `destructive` template into an isolated
    registry, calls `callTemplate` with `{ bogus: 1 }` (proves the
    gate beats `PARAMS_INVALID`), asserts `pending/` is empty after
    the call (proves no wire write).
  - **`explicit policy granting destructive lets the call through to the bridge`**
    — uses `withAllowed([read, write_safe, filesystem, destructive])`
    + fake bridge → command lands, no false lockout.
- `packages/mcp-server/src/transport/__tests__/file-queue.test.ts` (+5):
  - **`Result-wraps non-ENOENT readFile errors instead of rejecting`**
    — rmdir + writeFile-replace `done/` with a regular file, send a
    command (no fake bridge), assert
    `INTERNAL_ERROR` / `recoverable: false`, no unhandled rejection.
  - New `FileQueueClient done/ orphan sweep` describe with four
    independent-queueDir cases:
    - `removes done/<id>.json older than the threshold, keeps fresh entries`
      — uses the shipping 24h default; `utimes` to backdate old.json by
      25h.
    - `does not touch subdirectories under done/` — defensive: 48h-old
      subdir survives because `isFile()` is false.
    - `init() resolves even when sweep cannot enumerate done/` —
      `chmod 0o000` on done/ → readdir EACCES → init still resolves
      `undefined` (the stderr warn in test output is the expected
      best-effort log, not a failure). `afterEach` restores perms.
    - `custom threshold override honored` — 1 ms threshold reaps a
      100 ms-old file, proves the test knob is wired through.

**Test bar:** 164 → 171 (+7) green. `npm run build` clean.
`npm run typecheck` unchanged (TS6310 then exit 0, pre-existing setup).

**Round B (Linux queue-dir, Open Note #2) deferred to v0.2.** v0.1
remains macOS-first per existing INSTALL.md framing
("falls back to the macOS path", env-var workaround on Linux). Fixing
the Lua `get_queue_dir` resolver without a Linux REAPER rig would
ship unverified support — explicitly avoided. Re-opens when v0.2
broaches multi-platform CI.

**Round C ✅ (2026-06-29 same window, docs-only).** Three items:

- **README sidecar wording** (`README.md:85-96`) — replaced the stale
  "v0.1 cannot suppress … on every build" hedge with the live
  "guarded cleanup contract" framing: preflight no-clobber for
  `.wav` / `.wav.RPP` / `.wav.RPP-bak` → typed `OUTPUT_FILE_EXISTS`,
  post-render `os.remove` of any sidecar REAPER auto-wrote. PROGRESS
  pointer for the config-var post-mortem stays so curious readers
  can dig in.
- **Foreground-render docs audit (open note #1)** — verdict: existing
  coverage (README prereq #2 + INSTALL.md §"Render in background"
  including the B2 no-auto-detect rationale + troubleshooting
  cross-ref + render.lua header note) is complete on the current
  contract. Closed the only forward-look gap with two one-liners: a
  v0.2 pointer at the end of INSTALL.md's "Render in background"
  section, and a matching ROADMAP.md v0.2 entry
  ("foreground-render support via chunked-tick render loop") so the
  INSTALL pointer has a real anchor. No detection code per the
  explicit B2 decision — would re-tread the
  `set_config_var_string`-is-nil trap from Step 7.
- **Vitest/Vite/esbuild upgrade evaluation (open note #6)** —
  verdict: **defer until post-v0.1**. Current: `vitest@^2.1.0` pinned
  in root + both packages → resolves to 2.1.9; vite / esbuild /
  vite-node / @vitest/mocker all transitive. `npm audit`: 5 dev-only
  vulns (3 mod, 1 high, 1 critical). `npm audit --omit=dev`: clean.
  **Effective real-world exposure: zero.**
  - critical (CVSS 9.8) vitest UI server arbitrary file read+exec
    (GHSA-5xrq-8626-4rwp) — only fires under `vitest --ui`. Repo's
    `test` script is `vitest run` (one-shot, no UI server).
  - high vite `server.fs.deny` bypass on Windows alternate paths
    (GHSA-fx2h-pf6j-xcff) — requires running vite dev server on
    Windows. Repo runs vite under vitest test mode only; dev env is
    macOS.
  - moderate ×3 (esbuild dev-server CORS, vite optimized-deps path
    traversal in `.map`, launch-editor NTLMv2 disclosure) — all
    require dev-server / `esbuild --serve` / Windows. None apply.

  Fix path is `vitest@2 → vitest@4.1.9` (skips 3) via `npm audit fix
  --force`. Two-major jump; migration risk low-but-non-zero for this
  repo (vanilla `describe`/`it`/`expect`, no `vi.mock`, no snapshots,
  no UI). Recommend a dedicated post-v0.1 window for it, not glued
  to release polish — pure tooling-churn cost for zero shipped-user
  benefit. Re-evaluate if we adopt vitest UI or anything else
  expands the real-world surface.

**Step 8 ✅** — Round A code + Round C docs/eval done; Round B
deferred to v0.2 by explicit user decision. All six open notes have
final disposition. v0.1 is at release-candidate from a Streetlight-
side perspective. Optional work the user may still pull in is the
Vitest 2 → 4 major upgrade above; v0.2 scope items are tracked in
docs/ROADMAP.md.

### Release prep — setup launcher + MCP config generator (2026-06-29)

Goal of this slice: another Mac (or this one after a fresh clone)
reaches `bridge ready` without the user hand-writing a single
absolute path. NOT a tag / publish — that's a separate user decision
gated on the second-Mac smoke. The CROSS_MAC_SMOKE.md runbook lives
alongside this work.

**Decisions locked (carry forward):**

13. **Setup language:** plain Node ESM (`scripts/setup.mjs`), no TS
    build dep. Setup doesn't need the kernel types and skipping a
    build step avoids the chicken-and-egg of "setup needs to run
    before dist exists." TypeScript test files would still need
    vitest config changes; .mjs slots in via a one-line `include`
    extension.
14. **Setup writes to two places, both safe:** the REAPER launcher
    at `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`
    and `setup-out/` inside the repo. **Never** edits user-global MCP
    configs (Claude Desktop / Codex / Cursor) — those may contain
    other servers and a merge bug could break unrelated tooling. The
    cost is one copy-paste per client; the saved risk is real.
15. **REAPER launcher requires one-time `Actions → Show action list →
    ReaScript: Load...`** to register in the Action List. REAPER does
    NOT auto-discover scripts dropped into its Scripts folder (per
    ReaScript docs). The launcher's header comment + setup's
    next-steps print + INSTALL.md + CROSS_MAC_SMOKE.md all spell this
    out. v0.1 does NOT auto-edit `reaper-kb.ini` or import a
    ReaperKeyMap to skip the Load... step — too easy to clobber user
    config, deferred to v0.2 installer polish.
16. **Render-in-background detection:** read-only probe of
    `[reaper] → workrender` in `reaper.ini`. **Any non-zero → ON**
    (bitfield-tolerant; this Mac's value is `8209`, would have
    falsely read OFF on strict `==1`). `unknown` when section/key
    absent. Step 7 B2 docs-only stays — setup only surfaces the
    verdict in next-steps, never writes to `reaper.ini`.
17. **`setup-out/` is git-ignored.** Each clone generates its own
    absolute-path configs; committing them would just churn paths
    across machines. Added to `.gitignore` line 17.

**Files (5 modified, 2 created):**

- `scripts/setup.mjs` (new, ~330 lines). Pure exports:
  `buildLauncherLua`, `buildClaudeCodeConfig`, `buildCodexConfig`,
  `buildCursorConfig`, `parseRenderInBackground`,
  `defaultReaperResourcePath`, `launcherInstallPath`, `reaperIniPath`,
  `mcpServerEntryPath`. CLI wraps them with darwin-only fail-fast,
  `dist/index.js` existence check, `--no-overwrite` (refuses to
  overwrite existing launcher), `--reaper-resource-path <p>`
  (portable installs / `--reapath` users), `-h`/`--help`, best-effort
  `reaper.ini` read, full next-steps print.
- `scripts/__tests__/setup.test.mjs` (new). 27 tests, all
  pure-function — NO writes to `~/Library/Application Support/REAPER`
  in tests (the user-asked-for testability constraint). Coverage:
  launcher lua content + path validation + space-in-path handling +
  rejection of quote/backslash; client config builders (JSON / TOML
  shape + space-in-path + Cursor mirrors Claude); reaper.ini parser
  (ON/OFF/unknown/bitfield-non-zero/whitespace-tolerance + does NOT
  cross-pollute between sections like `[project]`); platform fail-
  fast; install-path joiners.
- `package.json` — adds `"setup": "node scripts/setup.mjs"`.
- `vitest.config.ts` — `include` adds `scripts/**/*.test.mjs`.
- `.gitignore` — adds `setup-out/`.
- `docs/INSTALL.md` — new "Install Step 2: Quick Setup" leads with
  `npm run setup`; old Layout A/B demoted to "2 (advanced). Manual
  REAPER Bridge install" with a note about removing any prior
  `__startup.lua` `dofile` to avoid double-load console noise
  (generation guard catches it functionally, but logs get noisy).
  §3 client config gained the `setup-out/` pointer.
- `docs/CROSS_MAC_SMOKE.md` — §3-5 collapsed into one `npm run setup`
  step + a Load... + Run step + a copy-from-setup-out step;
  renumbered 1-8; test baseline 171 → 198.
- `README.md` — first-time install one-liner above the prereqs
  checklist in "How To Run The Impact-Variations Demo".

**REAPER launcher shape (auto-generated by setup):**

```lua
-- streetlight start_bridge.lua
--
-- AUTO-GENERATED by `npm run setup` in the Streetlight repo at:
--   <abs-repo-path>
-- DO NOT EDIT BY HAND. Re-run `npm run setup` from the repo if its
-- absolute path changes. ...
-- To register this script in REAPER's Action List (one-time, per Mac):
--   Actions → Show action list → ReaScript: Load... → pick this file.
-- ...

local repo = "<abs-repo-path>"
local bridge = repo .. "/reaper/streetlight_bridge.lua"
local f = io.open(bridge, "r")
if not f then
  reaper.ShowConsoleMsg(
    "[streetlight] launcher: bridge not found at " .. bridge ..
    "\n[streetlight] re-run `npm run setup` from the repo, or check " ..
    "the repo wasn't moved/deleted.\n"
  )
  return
end
f:close()
dofile(bridge)
```

The guarded `io.open` is so a moved/deleted repo prints a friendly
console message instead of stack-tracing out of `dofile`.

**Manual gate (this Mac, 2026-06-29).** Live verified end-to-end:

1. `npm run setup` ran clean. Launcher landed at
   `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`
   with the repo's actual absolute path baked in (currently `/Users/Zhuanz/Documents/streetlight-reaper-mcp`).
2. Three `setup-out/*` files written with the absolute dist path
   (`/Users/Zhuanz/Documents/streetlight-reaper-mcp/packages/mcp-server/dist/index.js`).
3. Render-in-background detection printed `✓ ON` — matches actual
   `workrender=8209` in the user's reaper.ini (bitfield, any non-zero
   → ON path saved us from a false OFF on strict `==1`).
4. `--no-overwrite` correctly refused a second run; printed
   `(exists and --no-overwrite set); pass without --no-overwrite to refresh`.
5. REAPER → Actions → Show action list → ReaScript: Load... →
   selected `start_bridge.lua` → Run. Console printed
   `[streetlight] bridge starting (generation 1)`, queue dir line,
   `loaded pack 'core' v0.1.0`, then
   `[streetlight] bridge ready (generation 1) — templates: …` with
   the full template list. Bridge alive.

**Test bar:** 171 → 198 (+27). `npm run build` clean. `npm run
typecheck` unchanged (TS6310 then exit 0).

**What's intentionally NOT in this slice:**

- No auto-edit of `reaper-kb.ini` / ReaperKeyMap import to skip the
  Load... step (deferred to v0.2 installer polish per user
  constraint — too easy to clobber user config).
- No auto-flip of REAPER prefs (Render-in-background stays a docs
  contract per B2; setup probe is read-only).
- No merge into user-global MCP configs.
- No Windows / Linux support (v0.2 alongside the cross-platform
  queue-dir resolver).
- No changes to `streetlight_bridge.lua` or any bridge behavior —
  the launcher just `dofile`s the existing entry point.
- No `--reaper-resource-path` test against a portable install — the
  flag exists and is unit-tested, but no live verification on a
  portable REAPER setup.

**Open: the second-Mac smoke.** Per `docs/CROSS_MAC_SMOKE.md`. Once
that passes, the v0.1 release tag is a separate user decision.

### Step 4b verification (2026-06-28)

All 10 smoke prompts above passed on REAPER 7.71/macOS-arm64 after the
post-smoke fixes landed (item_move same-track no-op + LAST_RESULT
cross-bucket clear). First Codex pass on 2026-06-27 caught both bugs +
the item_rate doc drift; second pass on 2026-06-28 with the fixes in
place was 10/10 green.

Codex used unique track names to keep stale state from earlier sessions
out of the picture: `Variations Smoke 2026-06-28` and
`Variations Smoke 2026-06-28 (renamed)`. Recommend this pattern for
future smoke runs — `Variations` / `Variations (renamed)` from the
written recipe collide with whatever the previous session left behind.

Witnessed GUIDs from the run (recorded so future debugging can confirm
the same template paths fire):

- Track GUID from Acc 4b-1 / 4b-2: `guid:{AD14A8FA-260A-8A4F-A1FD-55DE7BD75E1B}`.
  Same value echoed back through `last_result:track:0` in 4b-2 — proves
  the `LAST_RESULT.tracks` write/read pairing works.
- Item GUID from Acc 4b-3 onward: `guid:{911DE70B-4DB8-3540-8ABC-27B91E35EBCB}`.
  Survived 4b-3 (position move), 4b-4 (reparent + position 0),
  4b-5 (rate), 4b-6 (trim), and 4b-10 (same-track no-op).

Acceptance highlights:

1. **4b-1 `track_create`**: locked envelope, `changed_count: 1`, new
   track visible in TCP. ✅
2. **4b-2 `track_rename last_result:track:0`**: same GUID returned —
   `LAST_RESULT.tracks` is genuinely populated by the dispatcher, not
   accidentally falling through to `items`. ✅
3. **4b-3 `item_move selected:0 -> 5.0s`**: item visibly at 5.000s. ✅
4. **4b-4 `item_move last_result:item:0 -> 0 on track:<smoke track>`**:
   item reparents and snaps to position 0. Tests both ref kinds in one
   prompt. ✅
5. **4b-5 `item_rate 0.5`**: `D_PLAYRATE = 0.500`, `B_PPITCH = off`,
   timeline length **unchanged** (per the updated 4b-5 contract). ✅
6. **4b-6 `item_trim length=1 start_offset=0.25`**: item length on
   timeline = 1.000s, `D_STARTOFFS` = 0.250 (source seconds). ✅
7. **4b-7 cross-kind REF_INVALID** (`track_rename selected:0`): typed
   error message names both the offered ref and the expected kind. ✅
8. **4b-8 `track_rename track:DoesNotExist`** → `TRACK_NOT_FOUND`. ✅
9. **4b-9 stale-bucket regression** (`item_rate last_result:item:0`
   immediately after `track_create`): `REF_INVALID, "last_result:item:N
   — no mutating call has produced changed_ids yet this session"`.
   Proves the cross-bucket clear in the dispatcher. ✅
10. **4b-10 same-track `item_move` no-op**: locked envelope, no error.
    Proves the `GetMediaItem_Track(item) ~= track` guard in
    `item_move`. ✅

Post-run `get_state(selection)` snapshot (verifies state actually
landed where the templates claimed):

```
id         = guid:{911DE70B-4DB8-3540-8ABC-27B91E35EBCB}
position   = 0
length     = 1
track_name = "Variations Smoke 2026-06-28 (renamed)"
```

`length = 1` confirms 4b-6 actually wrote `D_LENGTH`; `position = 0`
confirms 4b-4's position update survived all subsequent template calls;
`track_name` confirms both 4b-2 (rename) and 4b-4 (reparent) landed.

Step 4c can now start.

### Code — Step 2 additions

Files:

- `packages/mcp-server/src/tools/get-state.ts` — `getState(client, {scope, limit})` wrapper. **Updated 2026-06-27**: added `limit` Zod field (default 50, integer, [1, 200]); switched from `.parse()` to `.safeParse()` so bad input returns `{ok: false, error: { code: "PARAMS_INVALID" }}` instead of throwing. Function still never throws.
- `packages/mcp-server/src/index.ts` — registers `get_state` MCP tool; description now points at `docs/RESPONSE_BUDGET.md`.
- `packages/mcp-server/src/transport/__tests__/fake-bridge.ts` — shared test harness; records every command for on-wire kind/params assertions
- `packages/mcp-server/src/tools/__tests__/get-state.test.ts` — **11 tests** (was 6). New coverage: truncated/total/response_bytes metadata propagation, `RESPONSE_TOO_LARGE` surfacing, limit forwarding on the wire, PARAMS_INVALID on limit > 200 and limit < 1.

### Verification status

- `npm run typecheck` clean
- `npm run build` clean
- `npm test` — **61 tests pass** (36 core + 14 file-queue + 11 get-state)
- MCP stdio handshake smoke test passes
- ping round-tripped against REAPER 7.71/macOS-arm64 (2026-06-27)
- **Step 2 acceptance — all 5 points passed on REAPER 7.71/macOS-arm64 (2026-06-27):**
  1. Empty selection → `{ items: [], total: 0, returned: 0, truncated: false, response_bytes: 0 }` ✅
  2. 3 items on a named track → 3 entries, all GUIDs unique and non-empty, `track_name="111"`, plausible position/length ✅
  3. Item renamed to ` テスト_01` (CJK + leading space) → comes back UTF-8 clean, no mojibake; bridge correctly preserves user-input whitespace (does not silently trim) ✅
  4. Two consecutive `get_state` calls → identical GUIDs, identical position/length values ✅
  5. After `get_state`, REAPER selection / playhead / scroll unchanged (visually confirmed) ✅

## Acceptance Status By Step

| Step | Status | Notes |
|---|---|---|
| 0 — Repo skeleton + kernel types | ✅ done | 36/36 tests pass, typecheck + build clean |
| 1 — First round trip (ping) | ✅ done | 50/50 tests pass; verified on REAPER 7.71/macOS-arm64 |
| 2 — Read selection (get_state) | ✅ done | 61/61 tests pass; all 5 acceptance points verified on REAPER 7.71/macOS-arm64 (2026-06-27); response-budget backstop landed |
| 3 — First mutation (item_pitch) | ✅ done | 76/76 tests pass; all 8 acceptance points verified on REAPER 7.71/macOS-arm64 (2026-06-27); `DISPATCH.template` enforces locked shape at the bridge boundary; cmd-ID hardened; mutating-timeout no-auto-retry documented |
| 4 — Variation building blocks | ✅ done (4a + 4b + 4c) | 4a: json.null + last_result:item:N + track:Name/item:N all green on REAPER 7.71/macOS-arm64 (2026-06-27, 7/7 smoke prompts). 4b: 5 templates (`track_create`, `track_rename`, `item_move`, `item_rate`, `item_trim`) land with entity-typed LAST_RESULT routing + track-ref machinery; 108/108 TS tests green; 10/10 smoke prompts verified on REAPER 7.71/macOS-arm64 (2026-06-28) after fixing 2 Lua-side bugs Codex caught on the first pass (item_move same-track no-op, LAST_RESULT cross-bucket stale). 4c: 3 templates (`item_duplicate`, `item_fade`, `media_import`) + new `MEDIA_NOT_FOUND` error + new `templates/media.lua`; 123/123 TS tests green; 10/10 smoke prompts verified on REAPER 7.71/macOS-arm64 (2026-06-28, including the new 4c-1b GUID-diff regression + 4c-10 Infinity TS guard) after a pre-smoke Codex hardening pass (item-selection snapshot/restore, GUID-diff for new-item identification, `.finite()` on every floating-point `z.number()`). |
| 5 — Regions (region_create) | ✅ done | 131/131 TS tests green; 8/8 smoke prompts verified on REAPER 7.71/macOS-arm64 (2026-06-29) after a mid-smoke contract fix on 5-5 (path-separator name now returns REGION_NAME_INVALID from Lua, not PARAMS_INVALID from TS — the agent-facing surface is symmetric with REGION_NAME_TAKEN). 5-0 (folded-in 4c-postfix-trim regression) confirmed TAKE_NOT_FOUND with D_LENGTH unchanged. 5-8 (region:Name resolver round-trip) deliberately deferred to Step 6's `render_region`. |
| 6 — Render (render_region) | ✅ done | 146/146 TS tests green; 10/10 smoke prompts (6-0..6-9) verified on REAPER 7.71/macOS-arm64 (2026-06-29) against the post-restart single-chunk bridge (`bridge ready (generation 1)`). Two mid-smoke fixes landed during the run: (1) `validate_output_dir` rewritten probe-write-first after Codex found `reaper.file_exists` returns true for directories too (broke happy-path 6-1 with false `OUTPUT_DIR_NOT_WRITABLE`); (2) bridge generation guard (`_G.STREETLIGHT_BRIDGE_GENERATION`) added after 6-3 (chain) exposed that repeated `dofile` reloads accumulate ghost `tick` chains, each holding its own `LAST_RESULT`. WAV24 format pit fixed end-to-end: `RENDER_FORMAT_WAV24_HEX = "5A 58 5A 68 64 78 67 41 41 41 3D 3D"` produces `WAVE audio, Microsoft PCM, 24 bit, stereo 48000 Hz` confirmed by `file` and `afinfo`. 6-2 render dialog restore inspection found no `streetlight-smoke` / `var_*` residue. See "Step 6 verification (2026-06-29)". |
| 7 — Recipe discovery + end-to-end demo | ✅ done | 164/164 TS tests green (146 baseline + 16 Step 7 + 2 sidecar-preflight); 8-item end-to-end demo live-verified on REAPER 7.71/macOS-arm64 (2026-06-29) into `~/Desktop/streetlight-step7-resmoke-1782704645367`: 8 WAVs (24-bit PCM stereo 48 kHz) + zero `.wav.RPP` / `.wav.RPP-bak` sidecars + `changed_ids` WAV-only, plus a focused preflight side-quest (hand-touched `.wav.RPP` → typed `OUTPUT_FILE_EXISTS`, user file untouched). Two pre-smoke recipe fixes (`reuse: true` → `reuse_existing: true`; `selected:0` → bound `selection.selection.items[0].id`) and three mid-smoke sidecar-suppression iterations landed in the same window. Final approach is path-B guarded cleanup: stock REAPER 7.71/macOS-arm64 doesn't expose `reaper.set_config_var_string` (the active probe crashed on `attempt to call a nil value`), so `render.lua` enforces the WAV-only artifact contract via preflight no-clobber on `<wav>.RPP` / `<wav>.RPP-bak` plus post-render `os.remove` of any auto-generated sidecar (delete failure → typed INTERNAL_ERROR). See "Step 7 verification (2026-06-29)" + the three preceding "Step 7 ... mid-smoke ..." sections for the full post-mortem. |
| 8 — Cross-platform + release polish | ✅ | All six carry-forward open notes resolved: #3 risk policy enforce / #4 file-queue non-ENOENT Result wrap / #5 done/ 24h orphan sweep closed in Round A (code, +7 tests); #1 foreground-render edge closed in Round C (docs + v0.2 forward-look, no detection code per B2); #6 Vitest/Vite/esbuild advisories evaluated Round C and deferred post-v0.1 (zero real-world exposure in current usage; `npm audit --omit=dev` clean); #2 Linux queue-dir mismatch deferred v0.2 by explicit user decision (no live Linux REAPER rig). Cross-platform Windows verification deferred to v0.2 alongside the Linux resolver work. |

## Key Design Decisions (locked)

These are settled. Do not re-litigate without a written reason.

1. **5 MCP tools, fixed**: `ping`, `get_state`, `list_templates`, `list_recipes`, `call_template`.
2. **Templates over raw eval**: `unsafe_eval` exists but is dev-only, default off.
3. **File queue transport for v0.1**: zero Lua-side deps. Socket comes in v0.2.
4. **Zod is the schema source of truth**: TS types and JSON Schema both derive from one Zod schema per capability.
5. **Reference resolution lives in Lua bridge**: TS parses, Lua resolves.
6. **`last_result` is per-MCP-session in-memory state**: dies when the server process exits.
7. **Result envelope stays 2-state**: `{ok: true} | {ok: false}`. Async render is hidden inside the transport layer.
8. **Pack layout in v0.1 even with one pack**: `reaper/packs/core/` exists day one.
9. **Default risk policy allows `read` + `write_safe` + `filesystem`**: blocks `destructive` and `unsafe_eval`.
10. **`item_reverse` is NOT in v0.1**: cut for risk and ambiguity reasons.
11. **Queue is the pipeline**: the file queue itself sequences commands. No `call_template_sequence` tool until v0.2.
12. **Pure-Lua JSON in `packs/core/lib/json.lua`**: no external Lua deps. Replace with dkjson if traffic gets complex.
13. **Bridge processes one command per defer tick**: keeps REAPER's main thread responsive even under burst load.

### Locked 2026-06-27 — response budget (see docs/RESPONSE_BUDGET.md)

14. **Name is "response budget", not "token budget"**: we control bytes / item counts / field sets. Tokens are downstream of those.
15. **Five-principle pagination contract** for every list-returning tool: default to summary; bounded `limit`; field projection where it pays; **bridge-side item-boundary byte cap, never mid-JSON truncation**; metadata `{total, returned, truncated, response_bytes}` on every list response.
16. **`get_state(selection)` v0.1 backstop only**: `limit` default 50 clamp [1, 200], hardcoded `MAX_RESPONSE_BYTES = 65536`, `RESPONSE_TOO_LARGE` on can't-fit-one. **No cursor / fields / max_bytes-as-param in v0.1** — those defer to v0.2 (deliberate; "stable cursor" cannot be honestly promised when REAPER state shifts under us).
17. **`call_template` shape is locked even though Step 3 hasn't started**: always `{ template, changed_count, changed_ids[≤50], truncated }`. Never embed full descriptors, even for single-item mutations. Agents read post-state via `get_state(ids=[...])`.
18. **`name` / `track_name` stay required `string`**: unnamed → `""`. Never `null`, never omitted. `""` = "user didn't set a name" is real state. If LLM ergonomics ever demand more, add a new `display_name` field; do not overload `name`.
19. **Bridge defaults match TS defaults**: limit=50, MAX_LIMIT=200 in both Lua and TS. TS defense-in-depth clamps to avoid burning a Lua round-trip on a 10000-item request.

### Locked 2026-06-27 — Step 3 (call_template + item_pitch)

20. **Locked `call_template` shape is enforced at the BRIDGE DISPATCHER, not in individual templates.** Templates return `{ changed_ids = [...] }`; the dispatcher reads only that field and constructs `{ template, changed_count, changed_ids[≤50], truncated }`. Anything else a handler returns is silently dropped. This means a future template author cannot accidentally leak descriptors even if they want to.
21. **Wire kind `"template"` ≠ MCP tool `call_template`.** Decoupling the agent-facing surface from the internal dispatch tag means we can later add `template_dry_run`, `template_batch`, etc. without breaking the wire format. Top-of-file comment in `queue.ts` is the authoritative map.
22. **Command IDs are `cmd_YYYYMMDDHHMMSSmmm_NNN_xxxxxx`.** Time prefix (down to milliseconds) keeps bridge FIFO scan correct via `table.sort` over filenames; 6-hex random suffix covers the same-millisecond / process-restart collision window that would have been silently dangerous once mutations started.
23. **Mutating-timeout is NOT a retryable error.** `BRIDGE_NOT_RUNNING` from a mutating `call_template` may mean "did not happen" OR "happened but no response". v0.1 contract: agents call `get_state` to verify and recover, NOT auto-retry. v0.2 will add idempotency tokens.
24. **Template errors flow as `error({ code, message })` Lua tables.** String errors collapse to `INTERNAL_ERROR` at the dispatcher boundary. Typed error codes are part of the protocol — they must survive the pcall.

## Open Questions (defer until they bite)

Items that have been **promoted into a specific step** are stricken out
here and live as build-list items in that step. Anything still in this
list has no owner.

- ~~Garbage collection for orphan `done/` files when MCP server crashes mid-poll.~~ → **closed Step 8 Round A.** `FileQueueClient.init()` runs a best-effort `sweepDoneOrphans()` that unlinks `done/<id>.json` older than 24h mtime. Three-layer try/catch (readdir/stat/unlink); failures write `[streetlight-mcp] done-sweep: …` to stderr and never reject init. Only touches `done/`; subdirs/non-files left alone. `doneOrphanThresholdMs` ctor option is a test-only knob; env-var override deferred to v0.2 alongside the configurable risk policy.
- How to detect a stale bridge that started but is unresponsive (vs. one that never started). Today both look like BRIDGE_NOT_RUNNING.
- Should `recipes/*.yaml` support `{{ Jinja }}`? Recipe v1 already uses it; YAML parser + template engine choice deferred to Step 7.
- ~~Bridge-level cap on `error.details` payload size.~~ → **moved to ROADMAP v0.2**.
- ~~Mutation-retry-after-timeout (idempotency tokens).~~ → **moved to ROADMAP v0.2**. v0.1 contract documented in `tools/call-template.ts` and the `call_template` MCP tool description: agents call `get_state` to recover, never auto-retry.
- ~~Lua JSON decoder swallows `null`.~~ → **moved to IMPLEMENTATION_PLAN Step 4** (`item_fade` is the first template that needs nullable params).
- ~~TS/Lua queue-dir mismatch on Linux.~~ → **Step 8 Round B deferred to v0.2** by explicit user decision (no live Linux REAPER rig to verify a Lua resolver patch). v0.1 ships macOS-first with the `STREETLIGHT_QUEUE_DIR` env-var workaround documented in INSTALL.md.

## Running The Project Today

```bash
cd /path/to/streetlight-reaper-mcp
npm install
npm run typecheck   # both packages
npm test            # 237 tests, all passing
npm run build       # writes dist/ in both packages
npm run check:manifest
npm run check:error-codes-fresh
```

## Where Things Live

```
streetlight/
  docs/                                # all design docs (read PROGRESS.md first)
    RESPONSE_BUDGET.md                 # ← read before adding any new tool / scope
  packages/
    core/src/                          # kernel types and registry (Step 0)
      types.ts                         # descriptors + CallTemplateResult locked shape
      errors.ts                        # RESPONSE_TOO_LARGE added 2026-06-27
      queue.ts                         # hardened makeCommandId (Step 3); wire-kind↔MCP-tool map at top
    mcp-server/src/                    # MCP server + file queue (Step 1-3)
      transport/file-queue.ts
      transport/__tests__/fake-bridge.ts   # shared test harness
      tools/ping.ts
      tools/get-state.ts               # scope + limit field + safeParse for PARAMS_INVALID
      tools/call-template.ts           # Step 3 — validates against registry, no per-template special-casing
      templates/index.ts               # registerCoreTemplates(registry) — one-liner to add templates
      templates/item-pitch.ts          # Zod schemas + CapabilityDefinition for item_pitch
      index.ts                         # MCP get_state + call_template tools
  reaper/                              # Lua bridge
    streetlight_bridge.lua             # get_state + DISPATCH.template locked shape
    packs/core/
      manifest.lua                     # core template manifest + entity_buckets
      refs.lua                         # item/track/region resolvers + resolver registry
      undo.lua                         # with_undo wrapper (EndBlock guaranteed)
      templates/item.lua               # item_pitch handler
      lib/json.lua
  recipes/                             # YAML workflow recipes
  examples/                            # MCP client config examples
```

## Picking Up From Here (for the next conversation)

1. **Read `docs/RESPONSE_BUDGET.md` first.** Everything Step 4+ is bound by the shapes locked there.

2. **Kernel hardening Slice 11 is code-done, static-green,
   live-smoked, committed, and pushed at `f66b2db`.** Read
   `docs/plans/SLICE_11_ARCHITECT_PLAN.md` before touching code.
   Static baseline is green (`npm test` 284/284, build,
   `check:manifest`, `check:error-codes-fresh`, `git diff --check`).
   REAPER live smoke passed with run id `slice11-202606300552524`.
   Reviewer pass completed with no P1/P2; two P3 nits were fixed.
   Slice 10 was live-smoked and pushed at `2babc5c`.

4. **Step 3 + Step 4a contracts are still law.** `call_template`
   envelope shape is `{ template, changed_count, changed_ids, truncated }`.
   Dispatcher enforces. New templates only need to return
   `{ changed_ids = [...] }`.

5. **Entity routing contracts are locked.** Manifest `entity_kind` is
   required on every template; Slice 01 derives routing from
   `manifest.entity_buckets` with startup strict validation and keeps
   runtime loud fallback to `"items"`. `LAST_RESULT` has the four v0.1
   buckets: `items`, `tracks`, `regions`, `renders`.
   **Cross-bucket clear is also locked**: every successful mutation
   wipes the other buckets before writing its own (post-Step-4b fix).

6. **`name` / `track_name` empty-string convention is locked.** Don't change to optional/null in Step 4 schemas.

7. **Test harness pattern:** see `packages/mcp-server/src/tools/__tests__/call-template.test.ts` for how to stand up a fake bridge, register the registry, and assert on-wire kind/name/params + envelope shape. Each Step 4b template's test file follows the same pattern in ~80 lines.

## Codex review pickups (2026-06-27)

A pre-Step-4b Codex review flagged several risks. Resolved + deferred:

**Adopted in Step 4b:**

1. **`last_result` entity routing** (was the biggest one) — `LAST_RESULT`
   would have silently classified everything as items the moment Step 4b
   shipped `track_create`. Fixed via `entity_kind` on every manifest entry
   + `ENTITY_BUCKET` lookup in the dispatcher. See `streetlight_bridge.lua`.
2. **INSTALL.md misleading** — Layout A vs Layout B documented; runtime
   folder table now calls out Linux requires `STREETLIGHT_QUEUE_DIR` in
   both processes until Step 8.

**Deferred (intentional):**

3. **Cross-platform Lua queue path** — still macOS-first in
   `streetlight_bridge.lua`. Owned by Step 8 (cross-platform polish).
   INSTALL.md documents the env-var workaround for Linux.
4. **MCP-side `def.result.safeParse` on bridge replies** — nice-to-have,
   not blocking. Bridge dispatcher enforces shape at write-time; tests
   catch regressions. Revisit if a bridge-side regression slips past
   the test suite.
5. **Orphan `running/` and `done/` file GC after MCP-side timeout** —
   already on the v0.2 roadmap. Step 6 (render) will exacerbate it; if
   it becomes a problem in v0.1 manual cleanup is `rm -rf
   "$STREETLIGHT_QUEUE_DIR"/{running,done}/*`.
6. **Fake bridge doesn't model `pending → running → done` claim race** —
   acknowledged. The real "bridge claimed but client timed out" race
   isn't covered by the fake; if a bug appears there, build a more
   faithful harness then. Not blocking Step 4b.
7. **`get_state.ts` limit-clamp jsdoc vs code drift** — Zod
   `safeParse` rejects out-of-bounds rather than clamping. Behavior is
   fine; not worth a doc-only PR mid-step.

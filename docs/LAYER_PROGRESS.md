# Layer Progress

Status: append-only coordination ledger for layer construction and migration.

Use this file to record facts, not long analysis. Each layer window may update
only its own entry when its prompt explicitly authorizes it.

## Rules

- Frozen lower layers are not reopened speculatively.
- If a later layer discovers a blocker in a frozen lower layer, the later layer
  stops and reports the blocker to the control tower.
- The control tower asks the user before opening a bounded lower-layer fix
  window.
- Forward work pauses while the lower-layer fix is active.
- After the fix is accepted, the original later layer resumes from the new
  frozen commit.
- Builder windows normally do not commit. The control tower commits accepted
  layer freezes and approved architecture/process updates.
- A layer is frozen only after the control tower records the accepted commit in
  this ledger.
- The ratchet model in `docs/RATCHET_MODEL.md` governs status promotion,
  lower-layer reopen, template lifecycle, recipe lifecycle, capability
  coverage, and worker-scope rules.

## Layer 1: Tool ABI v1

Status: frozen

Accepted commit: `41ae9ce freeze: layer 1 tool abi v1`

Scope: froze the five MCP tool names and direct-call rules.

Tests: `npm test`, `npm run check:tool-abi`, `npm run check:layer -- layer1`,
`npm run build`, `git diff --check`.

Legacy migrated: no.

Known risks: no real MCP server runtime yet; this froze only the tool surface.

Next gate: Layer 1.5 Discovery / Menu Contract v1.

## Layer 1.5: Discovery / Menu Contract v1

Status: frozen

Accepted commit: `fbdd692 freeze: layer 1.5 discovery menu contract`

Scope: froze `list_templates` and `list_recipes` as compact discovery/menu
interfaces with exact expansion, field selection, filters, pagination shape,
and bounded large-catalog behavior.

Tests: `npm test`, `npm run check:tool-abi`, `npm run check:discovery-menu`,
`npm run check:layer -- layer1.5`, `npm run build`, `git diff --check`,
static discovery smoke.

Legacy migrated: no.

Known risks: future runtime catalog storage may need indexed filtering before
pagination; real MCP invocation tests wait for server registration.

Next gate: Layer 2 Foundation / Bridge ABI v1.

## Layer 2: Foundation / Bridge ABI v1

Status: frozen

Accepted commit: `9a8677f freeze: layer 2 foundation bridge abi v1`

Scope: froze the foundation/bridge ABI for template execution, including
envelopes, refs, errors, undo, verification, artifacts, budget, idempotency,
timeout, queue, bridge owner/generation, fixed operation families, bounded
last_result, health, and fake bridge contract smoke.

Tests: `npm test`, `npm run check:tool-abi`, `npm run check:discovery-menu`,
`npm run check:foundation-bridge`, `npm run check:layer -- layer2`,
`npm run build`, `git diff --check`, fake bridge smoke.

Legacy migrated: no.

Known risks: fake bridge proves ABI shape and safety rules, not live REAPER
behavior. Future layers must bind the contract to real template authoring,
bridge transport, Lua execution, artifact persistence, and permission/risk
policy.

Next gate: Layer 3 Pack Taxonomy v1.

## Layer 3: Pack Taxonomy v1

Status: frozen

Accepted commit: `7897ed1 freeze: layer 3 pack taxonomy v1`

Scope: froze the fixed 16 top-level pack taxonomy as dependency domains, not
workflow products; added taxonomy review notes, pack taxonomy checks, Layer 3
scope guard support, and Layer 3 taxonomy tests.

Tests: `npm test`, `npm run check:tool-abi`, `npm run check:discovery-menu`,
`npm run check:foundation-bridge`, `npm run check:pack-taxonomy`,
`npm run check:layer -- layer3`, `npm run build`, `git diff --check`.

Legacy migrated: no.

Known risks: taxonomy placement is frozen as ownership metadata only. No real
pack content, templates, recipes, loader behavior, or live REAPER runtime
behavior was migrated or implemented in this layer.

Next gate: Layer 4 Template Authoring ABI v1.

## Layer 4: Template Authoring ABI v1

Status: frozen.

Accepted commits:

- `f1ce637 freeze: layer 4a template descriptor contract`
- `3d74b6b freeze: layer 4b template execution harness`
- `ff1baa6 freeze: layer 4c template catalog smoke gate`
- `1af8eaa templates: add wave 1a catalog descriptors`

Scope target: freeze how templates are described, validated, implemented,
tested, smoked, and connected to the frozen foundation/bridge ABI inside the
fixed pack taxonomy.

4A scope: froze the template descriptor contract shape and static validation
rules for metadata, pack ownership, schemas, refs, artifacts, verification,
expected delta, examples, discovery summary split, full descriptor fields,
descriptor budgets, and pressure-fixture categories.

4A tests: `npm test`, `npm run check:tool-abi`,
`npm run check:discovery-menu`, `npm run check:foundation-bridge`,
`npm run check:pack-taxonomy`, `npm run check:template-authoring`,
`npm run check:layer -- layer4a`, `npm run build`, `git diff --check`.

Legacy migrated: no.

4A known risks: 4A freezes static descriptor validation only. Runtime bridge
request construction, result/error mapping, fake/live execution, catalog
exposure, and template smoke gates remained for 4B/4C.

4B scope: added the Template Execution Harness contract that consumes frozen
4A descriptors, validates template input, constructs normalized
`foundation.bridge.v1` requests, applies idempotency and undo policy, dispatches
through an injected fake bridge executor, and maps bridge results/errors into a
bounded `template.execution.v1` envelope.

4B tests: `tests/layer4b/template-execution-harness.test.mjs` covers read,
write, destructive, job, artifact, idempotent mutation, verification failure,
bridge error, input invalid, and response-too-large pressure scenarios.

4B known risks: fake bridge coverage proves harness contract behavior only. It
does not implement real `call_template`, catalog loading, live REAPER execution,
or template smoke gates.

4C scope: added the `template.catalog.v1` registry, minimal seed template
fixtures, Layer 1.5 discovery/menu adapter, duplicate-id and pack boundary
guards, and a fake execution smoke gate for catalog templates.

4C tests: `tests/layer4c/template-catalog.test.mjs` covers catalog load, all
descriptor validation, duplicate ids, workflow-shaped/non-fixed/mismatched pack
metadata rejection, recipe rejection, bounded default discovery, exact ids
field expansion, fake read/write/job/artifact/idempotent/error execution, no
live REAPER startup, no legacy migration, and no recipes.

4C known risks: seed templates are descriptor plus fake harness smoke fixtures
only. 4C does not implement real `call_template`, a live REAPER startup path,
real Lua template behavior, official recipes, user recipe authoring, or legacy
template migration.

Wave 1A template catalog scope: accepted 43 official descriptor-only templates
for `project`, `tracks`, `items`, `transport`, `analysis`, and `render`. These
are wired into the shared catalog fixture through pack-scoped descriptor files,
and `check:template-authoring` runs pack-local tests plus combined fake catalog
smoke.

Wave 1A known risks: descriptors and fake harness smoke only. No real
`call_template` runtime binding, live REAPER behavior, runtime Lua, recipes, or
user docs are implemented.

Wave 2A descriptor-only scope target: add 70 approved descriptor-only templates
for `media`, `midi`, `fx`, `routing`, `automation`, and `actions`, using only
the existing 4A descriptor contract, 4B fake execution harness, 4C catalog
patterns, and Layer 3 pack taxonomy.

Wave 2A out of scope: runtime Lua, live REAPER behavior, recipes, destructive
templates, hardware endpoint behavior, generic/action execution, user docs, new
ref kinds, and frozen ABI changes.

Next gate: Wave 2A Descriptor-Only 70-Template Pass.

## Wave 2A: Descriptor-Only 70-Template Pass

Status: accepted

Accepted commit: `ee14a64 templates: add wave 2a descriptor catalog`

Scope: implemented the 70 template ids approved in the old control-tower Wave 2
review as descriptor-only catalog entries with pack-local tests and combined
fake catalog/harness smoke.

Required coverage:

- create pack-scoped descriptor files for `media`, `midi`, `fx`, `routing`,
  `automation`, and `actions`;
- implement exactly the 70 approved Wave 2A template ids recorded in
  `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/template-candidates/wave-2-review.md`;
- wire accepted descriptors into the shared catalog fixture without changing
  frozen 4A/4B/4C surfaces;
- keep discovery compact and bounded;
- add pack-local descriptor/catalog/fake harness tests;
- extend combined catalog smoke so Wave 1A plus Wave 2A descriptors validate
  together.

Out of scope: runtime Lua, live REAPER startup, live smoke, `call_template`
runtime binding, recipes, user recipe authoring, destructive templates,
hardware endpoints, generic/action execution, new ref kinds, user docs, and
frozen ABI changes unless a concrete blocker is reported.

Product direction: Wave 2A expands the official reviewed template catalog. It
does not make templates user-authorable. The intended v1 boundary remains:
templates are closed/reviewed capabilities; users primarily author recipes.

Next gate after acceptance: Layer 4D Template Runtime Binding / Unified Live
Smoke Gate.

## Wave 3A: Critical Research-Only Scout

Status: accepted

Scope target: let `core` and `system` workers research and propose only the
smallest critical candidate set before any descriptor implementation opens.

Required coverage:

- write old-repo route reports only;
- propose a small candidate table for each pack;
- keep `core` focused on OpenReaper/catalog/last-result visibility;
- keep `system` focused on runtime environment, resource paths, and API symbol
  visibility;
- defer `ui` entirely for now;
- defer `hardware_control` entirely for now;
- keep video as non-pack work; video-related atoms stay under `media`, `fx`,
  `items`, or `render` by primary owner if needed later;
- record open questions, blocked ideas, and any Layer 4D support needs.

Out of scope: runtime Lua, live REAPER startup, live smoke, `call_template`
runtime binding, descriptor implementation, catalog wiring, tests, recipes,
user recipe authoring, destructive templates, all `ui` templates, all
`hardware_control` templates, hardware writes, hardware endpoint mutation,
arbitrary UI automation, generic action execution, video-specific product work,
new ref kinds, user docs, and frozen ABI changes unless a concrete blocker is
reported.

Accepted research reports:

- `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/agent-routing/reports/wave3a-core.md`
- `/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/agent-routing/reports/wave3a-system.md`

Approved Wave 3B ids:

- `template.core.read_openreaper_status`
- `template.core.read_template_catalog_summary`
- `template.core.read_last_result`
- `template.system.read_runtime_environment`
- `template.system.read_resource_paths`
- `template.system.check_api_symbols`

Held for later owner decision:

- `template.core.read_template_coverage_summary`
- `template.system.read_ext_state_value`

Known risks: descriptor-only Wave 3B can stage these ids, but real usefulness
depends on Layer 4D runtime binding. `ui` and `hardware_control` remain
deferred.

Next gate: Wave 3B Critical Descriptor-Only Pass.

## Wave 3B: Critical Descriptor-Only Pass

Status: accepted

Accepted commit: `204640a templates: add wave 3b descriptor catalog`

Scope target: implement only the six approved Wave 3A `core`/`system`
descriptor candidates as descriptor-only pack files with pack-local fake smoke.

Required coverage:

- create pack-scoped descriptor files for `core` and `system`;
- implement exactly the six approved Wave 3B template ids;
- keep all six templates read-only and non-destructive;
- use existing 4A descriptor, 4B fake execution harness, and 4C catalog
  patterns;
- keep compact discovery behavior and descriptor budgets intact;
- keep shared catalog entry points untouched until the control tower merge.

Out of scope: runtime Lua, live REAPER startup, live smoke, `call_template`
runtime binding, recipes, user recipe authoring, destructive templates, `ui`,
`hardware_control`, hardware endpoints, generic/action execution, new ref
kinds, and frozen ABI/taxonomy changes unless a concrete blocker is reported.

Accepted coverage: added three `core` descriptors and three `system`
descriptors, wired both pack files into the shared catalog fixture, and extended
Layer 4C catalog smoke so Wave 1A, Wave 2A, and Wave 3B validate together
without duplicate ids.

Tests: `node --test tests/layer4c/template-catalog.test.mjs
tests/template-packs/wave3b-core-templates.test.mjs
tests/template-packs/wave3b-system-templates.test.mjs`, `npm test`,
`npm run build`, `git diff --check`.

Known risks: descriptor-only and fake-smoke only. Layer 4D still needs to bind
the accepted catalog to the real `call_template` path, define runtime sources
for core/system facts, enforce concrete symbol/query caps, and add opt-in live
smoke.

Next gate after acceptance: Layer 4D Template Runtime Binding / Unified Live
Smoke Gate.

## Layer 4D: Template Runtime Binding / Live Smoke Gate

Status: accepted

Accepted commit: `971758b runtime: add layer 4d call_template binding`

Scope target: bind the accepted official template catalog to the agent-facing
`call_template` execution path without adding MCP tools or changing frozen ABI
surfaces, and add a unified opt-in live smoke gate.

Required coverage:

- resolve accepted official template ids from the catalog;
- reject unknown, blocked, and non-catalog template ids with typed errors;
- route input/ref/context validation through the Layer 4B execution harness;
- keep `call_template` as the only direct template execution entry point;
- keep discovery/menu compact and unchanged;
- run fake runtime smoke over the accepted official catalog;
- retain compact template execution evidence that can later support recipe-run
  recovery;
- provide live smoke commands or scripts that are opt-in and do not start
  REAPER by default.

Out of scope: recipes, user recipe authoring, blocked templates, runtime Lua
expansion, recipe ratchet/run state, recipe checkpoints, recipe resume,
recipe-level risk gates, broad live REAPER coverage, user docs, and frozen ABI
changes unless a concrete blocker is reported.

Accepted coverage: added `call_template.runtime.v1` module-level binding over
the accepted Wave 1A + Wave 2A + Wave 3B official catalog, rejected seed-only,
held, unknown, workflow-shaped, non-catalog, raw descriptor, raw Lua/action,
shell/process, arbitrary bridge, and arbitrary request payloads with typed
errors, routed accepted executions through the Layer 4B harness, retained
bounded `template.runtime.evidence.v1`, added fake runtime smoke over 119
accepted ids, and added an opt-in live smoke gate that skips safely by default
without starting REAPER.

Tests: `npm run check:tool-abi`, `npm run check:template-runtime`, `npm test`,
`npm run build`, `npm run check:layer -- layer4d`, `git diff --check`.

Known risks: this binds the accepted catalog to a module-level runtime path and
live-smoke gate. It does not provide full MCP server invocation coverage, real
live bridge execution, runtime Lua implementation for each descriptor, or pack
live-smoke promotion.

Next gate after acceptance: Layer 5 Recipe Contract v1.

## Layer 4D.1: Live Bridge Executor Binding / Wave 0 Canary Enablement

Status: accepted

Accepted commit: `63a9428 runtime: add layer 4d1 live bridge binding`

Scope target: add the minimal explicit live bridge executor binding needed for
the Layer 4D opt-in live gate to progress beyond
`live_bridge_executor_not_configured` toward Wave 0 runtime canary execution.

Accepted coverage:

- added an explicitly configured, non-spawning file-transport live bridge
  executor;
- kept default live smoke behavior as safe skip with `spawned_reaper:false`;
- kept opt-in with no executor as a clear blocker;
- restricted configured live execution to the five Wave 0 runtime canary ids;
- mapped configured-but-absent transport/script/handshake states into typed
  `foundation.bridge.v1` bridge errors and existing
  `template.execution.v1` / `template.runtime.evidence.v1` envelopes;
- retained request id, expected/actual bridge owner and generation, bounded
  result counts, opt-in flag/env, and `spawned_reaper:false` evidence;
- added Layer 4D.1 scope guard and focused tests.

Out of scope: REAPER process startup, full Lua runtime, all-template live
smoke, non-Wave-0 ids, recipes, template descriptors, pack taxonomy, frozen
ABI changes, raw Lua, raw actions, shell commands, and arbitrary bridge
requests.

Known risks: the binding prepares a file transport contract and blocker
classification only. Without an installed REAPER-side bridge script and active
transport loop, Wave 0 live canary remains blocked at the more specific bridge
transport/script/handshake state.

Tests: `node --test tests/layer4d1/live-bridge-executor.test.mjs`,
`npm run check:template-runtime`, `npm test`, `npm run build`,
`npm run check:layer -- layer4d1`, `git diff --check`,
`node scripts/smoke-template-runtime-live.mjs`,
`node scripts/smoke-template-runtime-live.mjs --live`, and configured missing
transport probe.

Next gate after acceptance: old-control Vision Pressure Pass before Layer 6,
plus a future REAPER-side bridge transport/script route before Wave 0 can
produce `live_pass` evidence.

## Layer 4D.2: REAPER-side Bridge Script / Wave 0 Handshake

Status: accepted

Accepted commit: `675c1f0 runtime: add layer 4d2 reaper bridge handshake`

Scope target: add the minimal manual REAPER-side file transport bridge loop
needed for the Layer 4D.1 executor to handshake with a real REAPER process for
the five Wave 0 read-only canaries.

Accepted coverage:

- added `reaper/bridge/openreaper-live-bridge.lua` as a manual
  `reaper.defer()` polling loop over `<transport>/requests/*.json`;
- writes complete `foundation.bridge.v1` result envelopes to
  `<transport>/results/<request-id>.json` through temp-file plus rename;
- supports only `project.read_summary`, `transport.read_state`,
  `openreaper.read_status`, `system.runtime_environment.read`, and
  `system.resource_paths.read`;
- returns `REQUEST_INVALID`, `OPERATION_NOT_FOUND`,
  `BRIDGE_OWNER_MISMATCH`, and `BRIDGE_GENERATION_MISMATCH` for the relevant
  handshake failures;
- keeps refs, artifacts, jobs, and last-result refs empty for the Wave 0
  success path;
- added static/fixture tests and Layer 4D.2 scope guard coverage.

Out of scope: REAPER process startup, raw Lua, raw actions, shell/process
execution, write operations, full template runtime Lua, broad live smoke,
119-template live execution, recipes, Layer 5, Layer 6, old-project live smoke
matrix updates, and frozen ABI/taxonomy/template changes.

Tests: `node --test tests/layer4d2/openreaper-live-bridge.test.mjs`,
`npm run check:template-runtime`, `npm test`, `npm run build`,
`node scripts/smoke-template-runtime-live.mjs`,
`node scripts/smoke-template-runtime-live.mjs --live`,
configured empty transport probe, `npm run check:layer -- layer4d2`, and
`git diff --check`.

Known risks: static/fixture tests prove the handshake boundary and result
shape only. No automatic Lua interpreter or REAPER process was used in this
window, so Wave 0 has not yet been promoted to live pass evidence.

Next gate after acceptance: run the manual REAPER bridge loop against a
prepared transport directory and collect old-control live-smoke evidence before
any matrix promotion. Layer 4.5A artifact/state-store contract work may proceed
in parallel if it avoids the 4D.2 bridge workspace.

## Layer 4.5A: Artifact / State Store Contract + Core Helpers

Status: accepted

Accepted commit: `00f837e core: add layer 4.5a artifact state store`

Scope target: define the artifact/state-store contract and pure core helpers
needed for large, resumable, or recipe-checkpoint data without binding runtime,
`get_state`, `call_template`, REAPER Lua, live smoke, or Layer 6.

Accepted coverage:

- added `artifact.state_store.v1` ABI documentation;
- added canonical `artifact:<owner_pack>:<scope>:<id>` parser/formatter and
  command-id-derived artifact id helper;
- validated owner packs against the frozen 16-pack taxonomy and rejected
  legacy workflow-shaped owner/scope leakage;
- added path-safe artifact-root mapping and TTL sweep policy classification
  without deleting files;
- added JSON artifact envelope validation, exact field checks, producer
  checks, summary/payload budgets, and bounded read projection semantics;
- added no-public-`last_result:artifact:N` policy helpers;
- wired `check:artifact-state-store` into `npm test` and `npm run build`;
- added Layer 4.5A scope guard coverage.

Out of scope: `reaper/bridge/**`, REAPER Lua artifact runtime,
`get_state(scope:"artifact")`, `call_template` artifact binding, live smoke,
matrix updates, MCP tool changes, Layer 6, and filesystem sweep/delete.

Tests: `npm run check:artifact-state-store`, `node --test
tests/layer4_5a/*.test.mjs`, `npm test`, `npm run build`,
`npm run check:layer -- layer4.5a`, and `git diff --check`.

Known risks: this is contract/helper-only. Runtime missing/corrupt artifact
behavior, fake store reads, `get_state` projection, REAPER-side artifact helper,
and live artifact smoke remain for later 4.5 windows.

Next gate after acceptance: decide whether to open Layer 4.5B for bounded
`get_state` artifact projection / runtime binding, or continue Vision Pressure
with Layer 4.5A evidence noted as sufficient for contract review.

## Layer 5: Recipe Contract v1

Status: frozen

Accepted commit: `3769792 recipe: add layer 5 contract`

Scope target: define the lightweight user-agent recipe run ratchet.

Accepted scope: added `recipe.contract.v1` as a workflow contract over the
Layer 4D accepted official template catalog and compact
`template.runtime.evidence.v1`; added a validator/normalizer, recipe catalog
discovery adapter, Layer 5 ABI check, layer-scope support, and contract tests.

Required coverage:

- recipe run state;
- checkpoints;
- evidence requirements over template execution evidence;
- idempotency expectations;
- resume/recovery rules;
- recipe-level risk gates.

Out of scope: user-writable recipe authoring UI/syntax beyond the contract,
new template definitions, raw Lua, raw actions, shell commands, and bypass
paths.

Tests: `npm run check:recipe-contract`, `npm test`, `npm run build`,
`npm run check:layer -- layer5`, `git diff --check`.

Known risks: Layer 5 is contract-only. It does not ship an official real recipe
catalog, user recipe authoring UI/syntax, server-side recipe executor, live
REAPER recipe smoke, or recipe-level runtime implementation. Official recipe
promotion still depends on future control-tower acceptance and relevant
template live evidence.

Next gate after acceptance: Layer 6 User Recipe Authoring v1.

## Layer 6: User Recipe Authoring v1

Status: planned

Scope target: expose the Layer 5 recipe contract as user-writable recipe rules.

Required coverage:

- users can create and edit recipes against the official template catalog;
- user recipes must reference known templates and declared refs/artifacts;
- user recipe rules can express the approved run/checkpoint/evidence/resume
  model;
- user authoring cannot define templates or bypass the template catalog.

## Template Closure / User Recipe Authoring Target

Status: planned product boundary for v1.

Target: by the time Layer 6 is accepted, ordinary users should be able to
create and edit recipes against the official template catalog without authoring
new templates.

Acceptance direction:

- `list_templates` exposes a reviewed, versioned official catalog;
- `list_recipes` exposes official and user/community recipes;
- recipe validation proves every step references known templates and declared
  refs/artifacts;
- user recipe authoring cannot define new template descriptors, raw Lua, raw
  actions, shell commands, or bypass paths;
- any future third-party template extension is treated as reviewed developer
  mode, not the default user workflow.

## Ratchet Governance

Status: planned governance model.

Record marker: `RATCHET-GOVERNANCE-V0-2026-07-03`.

Scope: `docs/RATCHET_MODEL.md` defines the internal engineering ratchet for
layers, templates, recipes, capability coverage, and worker scope. It is a
control-tower governance model, not a user-facing REAPER feature.

Near-term use: Wave/template/catalog work may continue in parallel only within
assigned routes. Status promotion to runtime/live/stable must wait for the
proper gate evidence and control-tower acceptance.

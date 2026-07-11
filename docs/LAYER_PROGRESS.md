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
bounded `template.runtime.evidence.v1`, added fake runtime smoke over the then
accepted 119 ids, and added an opt-in live smoke gate that skips safely by
default without starting REAPER.

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
all-template live execution, recipes, Layer 5, Layer 6, old-project live smoke
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

## 4D.x: Wave 1A Read-Handler Expansion

Status: accepted

Accepted commit: `1344b2d runtime: add wave1a live read handlers`

Scope target: extend the non-spawning live-smoke path from the Wave 0 canary
handlers to exactly the nine approved Wave 1A read/query templates, without
broadening to all accepted templates, writes, actions, recipes, or live matrix
promotion.

Accepted coverage:

- preserved the five Wave 0 canary ids as a separate runtime allowlist;
- added the nine Wave 1A live ids and kept the live smoke script scoped to
  those ids;
- added read-only Lua bridge handlers for template catalog summary, last
  result metadata, API symbol checks, project metadata, marker/region listing,
  tempo map, track ref resolution, item ref resolution, and item summary;
- kept REAPER startup manual and non-spawning;
- retained typed owner/generation, malformed request, unsupported operation,
  and response-budget errors;
- added `layer4dx` scope guard support and focused tests.

Out of scope: writes, action execution, raw Lua eval, shell/process behavior,
all-template live smoke, live matrix updates, recipes, Layer 4.5C artifact
helpers, and Layer 6.

Tests: `node --test tests/layer4dx/read-handler-expansion.test.mjs`,
`npm run check:template-runtime`, `node scripts/smoke-template-runtime-live.mjs`,
`node scripts/smoke-template-runtime-live.mjs --live`, `npm test`,
`npm run build`, `npm run check:layer -- layer4dx`, and `git diff --check`.

Known risks: handler coverage is static/fake until a manual REAPER opt-in
Wave 1A live evidence report is collected. `template.core.read_last_result`
currently exposes bounded live bridge metadata and does not prove rich
last-result replay semantics.

Next gate after acceptance: run a control-tower-scoped manual Wave 1A live
evidence route before any `LIVE_SMOKE_MATRIX.md` promotion, or open narrow
Layer 6 user recipe authoring.

Fixture retry update: accepted commit `4f91ca9`
(`runtime: allow wave1a live fixture refs`) adds narrow live-smoke fixture env
overrides for only the three Wave 1A track/item retry rows:

- `OPENREAPER_LIVE_SMOKE_TRACK_REF`
- `OPENREAPER_LIVE_SMOKE_ITEM_REF`

The smoke script remains Wave 1A-only, non-spawning, read-only, and limited to
the nine approved read templates. These env values apply only to
`template.tracks.resolve_track_ref`, `template.items.resolve_item_ref`, and
`template.items.read_item_summary`.

## Layer 4D.R: Bridge Handler Registry / Split v1

Status: accepted

Accepted commits:

- `c8ed1f5 runtime: add bridge handler registry gate`
- `a9614b1 runtime: extract wave0 bridge handlers`
- `648387f runtime: extract wave1a bridge handlers`
- `2063081 runtime: extract read-b bridge handlers`
- `74b3d95 runtime: extract first-real bridge handlers`
- `b576138 runtime: extract safe-write bridge handlers`
- `bcfefd3 runtime: isolate bridge handler module locals`
- `57540d4 runtime: link isolated bridge handler exports`

Scope target: add the first bridge handler registry gate so existing live
bridge handler rows are inventoried against accepted template ids, route
allowlists, descriptor pack/risk/operation fields, handler location policy,
tests, and generated bundle determinism before future handler expansion.

Accepted registry inventory:

- added `reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json` with one
  standard entry shape;
- registered the current 60 live bridge template rows without adding template
  ids, operations, routes, recipes, MCP tools, live smoke, or matrix updates;
- kept every registered row as `legacy_monolith` for this first inventory
  pass; runtime behavior remains in `reaper/bridge/src/40-route-pack-handlers.lua`;
- taught `scripts/build-live-bridge.mjs` and `check:template-runtime` to enforce
  registry parity, Lua dispatch operation drift, handler file policy, route
  allowlists, accepted catalog ids, descriptor pack/risk/artifact policy, test
  paths, and generated bundle freshness;
- added `bridge-handler-registry` scope guard support and focused 4D.R tests.

Accepted closeout batch 1:

- extracted exactly the five Wave 0 read-only rows
  (`template.project.read_summary`, `template.transport.read_state`,
  `template.core.read_openreaper_status`,
  `template.system.read_runtime_environment`, and
  `template.system.read_resource_paths`) into
  `reaper/bridge/src/handlers/**` modules;
- updated the bridge handler registry so only those five rows reference
  relative handler module paths/exports; all other registered rows remain
  `legacy_monolith`;
- updated the live bridge generator to include extracted handler modules from
  the registry in deterministic registry order while preserving the stable core
  source module order;
- kept `reaper/bridge/src/40-route-pack-handlers.lua` as the dispatch owner and
  bound the extracted rows to the same operation keys and handler export names;
- refreshed focused 4D.R tests for registry parity, handler path policy,
  generated bundle freshness, and no broad route expansion.

Accepted closeout batch 2:

- extracted exactly the nine Wave 1A read-only rows
  (`template.core.read_template_catalog_summary`,
  `template.core.read_last_result`, `template.system.check_api_symbols`,
  `template.project.read_metadata`,
  `template.project.list_markers_regions`,
  `template.project.read_tempo_map`,
  `template.tracks.resolve_track_ref`,
  `template.items.resolve_item_ref`, and
  `template.items.read_item_summary`) into
  `reaper/bridge/src/handlers/**` modules;
- updated the bridge handler registry so the five Wave 0 rows plus these nine
  Wave 1A rows are the only extracted rows, for 14 extracted rows total and 46
  remaining `legacy_monolith` rows;
- kept the existing route allowlists, operation keys, MCP tools, template ids,
  recipes, runtime capabilities, live smoke scope, and old live matrix
  untouched;
- refreshed focused 4D.R tests for exact extracted-row membership, handler path
  policy, generated bundle freshness, registry parity, and no raw execution
  surfaces.

Accepted closeout batch 3:

- extracted exactly the 15 Read-B read-only rows
  (`template.actions.resolve_named_command`,
  `template.actions.read_action_metadata`,
  `template.actions.read_action_toggle_state`,
  `template.actions.read_action_shortcuts`,
  `template.actions.parse_marker_action_text`,
  `template.actions.search_action_commands`,
  `template.midi.resolve_midi_take_ref`,
  `template.midi.read_take_event_counts`,
  `template.midi.list_take_notes`,
  `template.midi.list_take_cc_events`,
  `template.midi.list_take_text_sysex_events`,
  `template.midi.read_take_grid`, `template.media.probe_file`,
  `template.media.read_take_source`, and
  `template.media.read_project_media_files`) into
  `reaper/bridge/src/handlers/**` modules;
- updated the bridge handler registry so the five Wave 0 rows, nine Wave 1A
  rows, and 15 Read-B rows are the only extracted rows, for 29 extracted rows
  total and 31 remaining `legacy_monolith` rows;
- kept existing route allowlists, operation keys, MCP tools, template ids,
  recipes, runtime capabilities, live smoke scope, old live matrix, action
  execution, media import/relink, and MIDI write behavior untouched;
- refreshed focused 4D.R tests for exact extracted-row membership, handler path
  policy, generated bundle freshness, registry parity, and no raw execution
  surfaces.

Accepted closeout batch 4:

- extracted exactly the seven First-Real-Fixture-A A1/A2/A3 artifact/report
  rows (`template.analysis.detect_loop_candidates`,
  `template.analysis.measure_loop_click_risk`,
  `template.analysis.create_loop_qa_report`,
  `template.project.create_cleanup_report`,
  `template.render.render_region_wav`,
  `template.render.create_delivery_report`, and
  `template.items.create_layer_report`) into
  `reaper/bridge/src/handlers/**` modules;
- updated the bridge handler registry so the five Wave 0 rows, nine Wave 1A
  rows, 15 Read-B rows, and these seven First-Real-Fixture-A rows are the only
  extracted rows, for 36 extracted rows total and 24 remaining
  `legacy_monolith` rows;
- kept existing route allowlists, operation keys, MCP tools, template ids,
  recipes, runtime capabilities, live smoke scope, old live matrix, raw
  Lua/action/shell/process policy, arbitrary output paths, and A2 managed
  render-root policy untouched;
- refreshed focused 4D.R tests for exact extracted-row membership, handler path
  policy, generated bundle freshness, registry parity, and no raw execution
  surfaces.

Accepted closeout batch 5:

- extracted exactly the 24 Safe-Write-A write/safe rows
  (`template.project.set_metadata_field`,
  `template.project.create_marker`, `template.project.create_region`,
  `template.tracks.create_track`, `template.tracks.rename_track`,
  `template.tracks.set_color`, `template.tracks.select_track`,
  `template.tracks.set_mute`, `template.tracks.set_solo`,
  `template.transport.set_edit_cursor`,
  `template.transport.set_time_selection`,
  `template.transport.clear_time_selection`,
  `template.transport.set_loop_points`,
  `template.transport.clear_loop_points`,
  `template.transport.set_repeat`, `template.items.move_item`,
  `template.items.trim_item`, `template.items.set_item_fades`,
  `template.items.set_take_pitch`, `template.items.set_item_snap_offset`,
  `template.midi.create_midi_item`, `template.midi.insert_notes_batch`,
  `template.midi.insert_cc_batch`, and
  `template.midi.insert_text_sysex_events`) into
  `reaper/bridge/src/handlers/**` modules;
- updated the bridge handler registry so all 60 registered rows are extracted,
  for 60 extracted rows total and zero remaining `legacy_monolith` rows;
- kept the Safe-Write-A bridge surface as only
  `run_command:template.execute` with the existing 24 approved capabilities,
  required undo, required verification, and `artifacts.allow:false`;
- kept existing route allowlists, operation keys, MCP tools, template ids,
  recipes, runtime capabilities, live smoke scope, old live matrix, raw
  Lua/action/shell/process policy, and arbitrary output paths untouched;
- refreshed focused 4D.R tests for exact extracted-row membership,
  capability-dispatch binding, handler path policy, generated bundle
  freshness, registry parity, and no raw execution surfaces.

Tests: `npm run build:live-bridge`, `npm run check:template-runtime`,
`npm test`, `npm run build`, `npm run check:layer -- bridge-handler-registry`,
and `git diff --check`.

Known risks: this is structural bridge-handler closeout, not a new live-smoke
promotion. Static/fake coverage proves registry and generated-bundle parity.
Template-row live status remains owned by the old-control live matrix and
reviewed evidence reports.

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

Next gate after acceptance: Vision Pressure accepted `proceed_with_warnings`.
Layer 4.5B is the preferred bounded fix before artifact/report-backed
first-real-version workflow claims. Layer 4.5C remains a separate later
live/helper route.

## Layer 4.5B: get_state Artifact Projection / Runtime Binding

Status: accepted

Accepted commit: `a4e5822 runtime: add layer 4.5b artifact get_state projection`

Scope target: bind bounded artifact/report summary and payload reads through
the existing `get_state` semantics without adding MCP tools, touching
`reaper/bridge/**`, connecting live REAPER, writing Lua helpers, changing
`call_template` behavior, or opening Layer 6.

Accepted coverage:

- added `get_state.runtime.v1` artifact projection runtime/helper over
  canonical `artifact:<owner_pack>:<scope>:<id>` refs;
- validated report/artifact refs against the fixed 16 pack owners and rejected
  raw paths, traversal, `file://`, workflow-shaped owners/scopes, and malformed
  aliases before store access;
- projected `summary` and explicit `payload` views from fake artifact stores;
- mapped missing, corrupt, oversized, and budget-failing artifact reads to the
  existing typed error vocabulary;
- enforced response budgets as complete typed errors, not partial JSON;
- kept artifact reads from updating `last_result`;
- confirmed artifact-producing `call_template` results still carry refs only.

Tests: `node --test tests/layer4_5b/get-state-artifact-projection.test.mjs`,
`npm run check:artifact-state-store`, `npm run check:tool-abi`,
`npm run check:template-runtime`, `npm test`, `npm run build`, and
`git diff --check`.

Known risks: fake-store/runtime-helper coverage only. Layer 4.5B does not
prove filesystem artifact roots under live REAPER, Lua artifact helpers, live
artifact smoke, report schema contracts, or official artifact-backed recipes.

Next gate after acceptance: Layer 4.5C remains closed unless a separate
live/helper route is explicitly opened. The separate 4D.x Wave 1A read-handler
track can continue. Layer 6 may open only as narrow user recipe authoring
unless artifact-backed workflow claims are accepted separately.

## Layer 4.5C: Lua Artifact Helper + Live Artifact Smoke

Status: accepted

Accepted commit: `55f8d9b runtime: add layer 4.5c artifact smoke helper`

Scope target: add the smallest non-spawning artifact helper and opt-in smoke
gate needed to prove canonical `artifact.state_store.v1` write/readback
evidence before First-Real-Fixture-A artifact-backed claims.

Accepted coverage:

- added a narrow REAPER-side Lua artifact helper script for exactly one
  `artifact_metadata:artifact_state_store.write_canary` file-transport
  operation;
- kept the existing Wave 0/Wave 1A live bridge script and template live smoke
  allowlist unchanged;
- added a default-safe-skipped artifact live smoke runner with fake/static
  readback proof, typed configured-missing artifact-root blocker, and
  no-REAPER timeout behavior that does not claim `live_pass`;
- wrote canonical `artifact.state_store.v1` envelopes under
  `<artifact_root>/<owner_pack>/<scope>/<id>.json` using canonical
  `artifact:<owner_pack>:<scope>:<id>` refs and the existing
  `artifactPathFromRef` mapping on the Node side;
- proved `get_state(scope:"artifact")` summary and payload readback from the
  helper-written fixture in the fake/static layer;
- added Layer 4.5C scope guard support and included 4.5C tests in
  `check:artifact-state-store`.

Out of scope: First-Real-Fixture-A template handlers, render/write template
live smoke, broad accepted-catalog live smoke, `call_template` raw execution,
new MCP tools, shell/raw Lua/action bypasses, Layer 5, Layer 6, recipes, old
live matrix updates, and official recipe promotion.

Tests: `node --test tests/layer4_5c/*.test.mjs`,
`npm run check:artifact-state-store`, `npm run check:template-runtime`,
`npm test`, `npm run build`, `npm run check:layer -- layer4.5c`, and
`git diff --check`.

Known risks: accepted coverage plus the real REAPER artifact helper canary
prove the artifact helper/write/readback path, not any render, analysis,
report, critical-fill, first-real-fixture, or official recipe live pass.
Fixture-batched First-Real evidence still needs separate control-tower evidence
before matrix or recipe promotion.

Post-acceptance live canary: real REAPER artifact helper canary passed on
2026-07-04; evidence lives in the old control repo at
`docs/agent-routing/reports/live-smoke-artifact-helper-canary.md`.

Next gate after acceptance: prepare First-Real-Fixture-A v2 as a fixture batch,
then open a scoped handler expansion route for the approved first batch. Do not
promote critical-fill rows or official recipes from helper-only evidence.

## Bridge Source Split / Bundler

Status: worker window

Scope: split the accepted manual REAPER live bridge source into
`reaper/bridge/src/**` modules and add `npm run build:live-bridge` to generate
the single manually loaded `reaper/bridge/openreaper-live-bridge.lua` bundle.

Out of scope: new template ids, new bridge handlers, raw Lua/action/shell/process
execution, recipes, live smoke, live matrix updates, MCP tools, and REAPER
startup.

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

Next gate after acceptance: the Vision Pressure readout found no Layer 5
contract blocker, and Layer 4.5B now provides bounded artifact/report
`get_state` projection. Layer 6 may open only as narrow user recipe authoring
over accepted template ids, with no official promotion or north-star workflow
readiness claim.

## Layer 6: User Recipe Authoring v1

Status: accepted

Accepted commit: `e0cc616 recipe: add layer 6 user authoring`

Scope target: expose the Layer 5 recipe contract as user-writable recipe rules.

Accepted boundary: Layer 6 is narrow static recipe authoring only. It allows
strict `*.recipe.json` sources to enter the existing recipe catalog/discovery
path after Layer 5 normalization and additional source/ref/artifact checks.

Accepted coverage:

- added strict official/user/community recipe source loading with lifecycle
  policy;
- rejected duplicate recipe ids and user/community shadowing of official ids;
- reused Layer 5 normalization so steps can reference only accepted official
  template ids;
- validated minimal literal refs and `$from_step` bindings against template
  descriptor `refs.input` / `refs.output`;
- allowed artifact `get_state` reads only through declared artifact output
  labels;
- exposed merged recipe catalogs through the existing Layer 1.5
  `list_recipes` discovery shape;
- added `check:user-recipe-authoring`, Layer 6 scope guard support, and focused
  authoring tests.

Out of scope: official four-vision recipes, recipe executor, `call_recipe`,
new MCP tools, template authoring, raw Lua, raw actions, shell commands,
arbitrary bridge requests, live REAPER smoke, live matrix updates, and lower
layer contract changes.

Tests: `npm run check:user-recipe-authoring`, `npm run check:recipe-contract`,
`npm run check:tool-abi`, `npm run check:discovery-menu`, `npm test`,
`npm run build`, `npm run check:layer -- layer6`, and `git diff --check`.

Reviewer: no P0/P1/P2 findings after the acceptance fixes. Prior P1/P2 issues
around symbolic refs, literal refs, and artifact `get_state` ambiguity were
fixed before acceptance.

Known risks: discovery integration is still module-level; full MCP server
registration coverage remains future work. Community roots and symlink edge
cases can be broadened later without reopening the contract. Layer 6 does not
prove any official recipe or four-vision workflow is ready.

Next gate after acceptance: critical template/report fills from the
four-vision gap table, fixture-batched live evidence, and later Layer 7
official recipe acceptance / first real version gate.

## Critical Fill: Render / Analysis P0 Descriptors

Status: accepted

Accepted commit: `dcc6913 templates: add critical render analysis catalog`

Scope target: close the highest-priority four-vision template gaps before
Layer 7 official recipe acceptance, without adding recipes, live smoke, runtime
Lua, raw execution, workflow packs, or user docs.

Accepted coverage:

- added `template.render.render_region_wav` as one bounded managed
  region-to-WAV render job with required idempotency, undo, verification, and
  render-owned artifact/job evidence refs;
- added `template.analysis.detect_loop_candidates`,
  `template.analysis.measure_loop_click_risk`, and
  `template.analysis.create_loop_qa_report` as read-risk analysis `run_job`
  artifact producers;
- merged the four descriptors into the accepted official template catalog as
  `critical_fill`, expanding runtime and recipe accepted template ids from 119
  to 123;
- kept live smoke scoped separately: the Wave 1A live gate remains limited to
  its nine read-handler ids and does not run all accepted templates.

Out of scope: real REAPER render execution, live analysis jobs, Lua artifact
helpers, official recipes, broad live smoke, matrix updates, and Layer 7
promotion.

Known risks: descriptor/fake-smoke only. The new render and analysis templates
still need fixture-batched live smoke before any official first-real-version
recipe can claim live evidence.

## Critical Fill: R3 Report P0 Descriptors

Status: accepted

Accepted commit: `7485834 templates: add r3 report catalog descriptors`

Scope target: close the remaining P0 report-template gaps from the
four-vision pressure pass without moving recipe-authored plans into templates.

Accepted coverage:

- added `template.items.create_layer_report` as an items-owned read-risk
  `run_job` report producer for bounded item/layer evidence;
- added `template.project.create_cleanup_report` as a project-owned read-risk
  `run_job` report producer for bounded cleanup evidence;
- added `template.render.create_delivery_report` as a render-owned read-risk
  `run_job` report producer for bounded delivery evidence;
- merged the three descriptors into the accepted official template catalog as
  `critical_fill`, expanding runtime and recipe accepted template ids from 123
  to 126;
- kept all plan/checklist/decision ownership with recipes and agents.

Out of scope: official recipes, recipe execution, live REAPER smoke, Lua
artifact helpers, upload/publish actions, cleanup execution, layer assignment
decisions, and live matrix promotion.

Known risks: descriptor/fake-smoke only. The report templates still need
artifact helper/runtime evidence and fixture-batched live smoke before Layer 7
recipes can claim portable first-real-version evidence.

## Layer 7: Official Recipe Acceptance / First Real Version Gate

Status: draft packet plus no-REAPER fake-smoke accepted; R1 recipe-level live
and local clean-source portability accepted.

Accepted commits:

- `3d21fb0 recipes: add layer 7 draft packet`
- `8932817 recipes: add layer 7 fake smoke`
- `fb4b98b recipes: add r1 transcript driver`

Accepted coverage:

- added six small lifecycle-`draft` recipe atoms under
  `recipes/official/layer7/first_atoms_a/`;
- kept the atoms as draft acceptance candidates, not four giant north-star
  recipes;
- added `check:official-recipes`;
- added no-REAPER recipe fake-smoke coverage proving the six draft atoms can
  execute as composed fake recipe graphs through fake `call_template` and
  artifact `get_state` reads;
- proved fake outputs are descriptor-derived, `$from_step` bindings use only
  earlier descriptor-declared outputs, artifact reads use declared labels, and
  write/render atoms pause for risk gates;
- added the narrow R1 transcript driver for
  `recipe.project.cleanup_fingerprint_report` without adding a public
  `call_recipe`, recipe executor, REAPER startup path, live matrix update, or
  raw bypass;
- accepted recipe-level live evidence for R1 through
  `call_template(template.project.create_cleanup_report)` plus
  `get_state(scope:"artifact")` summary/payload readback;
- accepted local clean-source live portability from the `57540d4` clean
  worktree, with evidence root
  `/Users/Shared/openreaper-portability-live/layer7-r1-portability-live-20260704-222001`.

Out of scope: live matrix updates from recipe portability evidence, recipe
lifecycle promotion beyond the current draft/fake-smoke status, a public recipe
executor, a new MCP tool, template/catalog/runtime changes, remote-clone or
true new-machine portability, and official four-vision readiness claims.

Known risks: only `recipe.project.cleanup_fingerprint_report` has accepted
recipe-level live/local portability evidence. The other five Layer 7 atoms
remain draft/fake-smoked only. Remote clone/new-machine portability remains a
future stronger evidence tier unless separately added before V1 declaration.
The `recipe.items.layer_report_from_evidence` atom remains fixture-backed and
draft-only until A3-style evidence is upgraded into a recipe-level run.

Next gate: public V1 `README.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`,
and `docs/SUPPORT_MATRIX.md`, followed by final docs review and V1 declaration
under the R1-only local manual-bridge claim set.

## Template Closure / User Recipe Authoring Target

Status: accepted product boundary for v1.

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

Status: active governance model.

Record marker: `RATCHET-GOVERNANCE-V0-2026-07-03`.

Scope: `docs/RATCHET_MODEL.md` defines the internal engineering ratchet for
layers, templates, recipes, capability coverage, and worker scope. It is a
control-tower governance model, not a user-facing REAPER feature.

Near-term use: Wave/template/catalog work may continue in parallel only within
assigned routes. Status promotion to runtime/live/stable must wait for the
proper gate evidence and control-tower acceptance.

## Post-V1 Productization Control-Tower Status

Status: Alpha3.2 active; Alpha3.1 L6/L7 evidence queues deferred.

Control-tower checkpoint: 2026-07-11.

Accepted post-V1 base:

- V1 public closure docs accepted at `ad1c228 docs: publish v1 public docs`;
- Alpha2 graduated the accepted 213-template bounded live fixture matrix;
- Alpha3 Phase 3 first-product closeout is accepted with evidence-bound claims;
- Alpha3.1 installable-product work is accepted through
  `2ded9ff package: stabilize agent-assisted startup`.

Active phase:

```text
Alpha3.2 Trial Feedback Hardening
/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/agent-routing/reports/alpha3.2-trial-feedback-hardening-plan.md
```

The Alpha3.1 L6 broader C5 macro live-canary queue and L7 stock-plugin evidence
queue remain valid future evidence work, but they are deferred and must not run
in parallel as a competing active phase unless the control tower explicitly
reopens them.

Control-tower delegation authorization:

- the control tower may create subagents, worktrees, reviewers, and smoke
  windows with disjoint path ownership;
- workers do not commit and return changed files, tests, evidence, blockers,
  and known risks;
- the control tower owns acceptance, exact-path staging, and commits.

Live fixture authorization:

```text
/Users/Zhuanz/Untitled/Untitled.RPP
```

The project is authorized as a disposable project-local fixture. The control
tower and delegated smoke workers may start/stop/restart REAPER, save or
overwrite the project, create/edit/delete project objects, exercise internal
routing, place media, refresh/query SQLite state, run controls/readback, and
render outputs when required by an accepted slice. Source-media deletion,
hardware/device I/O, and raw Lua/action/shell/UI bypass product paths remain out
of scope. Live authorization is not support evidence by itself; each run needs a
fresh evidence root, changed-state report, rendered-file list, recovery posture,
and control-tower review.

Dirty-tree reconciliation accepted:

- the broad C5 MIDI note-insertion promotion is deferred because note rows,
  response budgets, lifecycle/support promotion, exact readback, and action
  manuals are not yet bounded; the original candidate patch is preserved outside
  the repo for future scoped work;
- `c672906 test: scope catalog discovery field scan` fixes an unrelated Layer 4D
  test false positive without changing runtime behavior;
- `774efd1 runtime: fix planned midi macro take refs` accepts only the narrow ref
  name correction and proves the MIDI macro remains draft/planned/blocked and
  non-executing;
- `1b3ef5d package: harden alpha installer upgrade config` accepts TOML parent/
  descendant replacement, upgrade/doctor guidance, fixtures, and package smoke.

The OpenReaper worktree is clean after these exact-path commits.

Alpha3.2-A is accepted at `759c403 product: add compact alpha3.2 macro guide`.
Alpha3.2-B1 is accepted at `434edf1 runtime: add bounded bridge liveness`.
Alpha3.2-B2 is accepted at `bb1b469 package: add managed render root`.
Next gate: Alpha3.2-B3 integrates the accepted B1 liveness probe and B2 managed
render root into bounded startup/doctor readiness, then runs the authorized live
REAPER smoke against `/Users/Zhuanz/Untitled/Untitled.RPP` with a fresh evidence
root.

### Alpha3.2-A Bounded Product-Surface Compaction Fix Window

Status: reopened_for_fix; Alpha3.2-A acceptance paused.

Control-tower decision: 2026-07-10.

The first Alpha3.2-A candidate passed its implementation tests but independent
review found a concrete acceptance blocker: after adding the required seven
primary action-manual cards, default `list_templates` measured 129,970 bytes,
with only 1,102 bytes of margin under a self-imposed 128 KiB ceiling. The
pre-existing product surface contributes 106,735 bytes, mainly from duplicated
`*_snapshot` and stock-plugin live-evidence objects. Raising the ceiling is not
an acceptable substitute for compact first-screen discovery.

The control tower opens a bounded product-surface fix window. Allowed behavior:

- default menu mode keeps compact product summaries and the complete concise
  Alpha3.2-A primary manual cards;
- heavyweight existing `*_snapshot` and stock-plugin live-evidence objects move
  to existing exact-id (`mode:"ids"`) on-demand responses;
- exact-id expansion remains the only expansion trigger; no new MCP tool,
  request field, Layer 1.5 selectable field, ABI change, or hidden executor;
- default metadata reports compact vs expanded detail level and how to use exact
  ids;
- target default `list_templates` serialized size is at most 96 KiB while
  preserving the seven required primary manuals.

Approved implementation write scope:

```text
packages/mcp-server/src/call-template-runtime-v1.mjs
tests/layer4d/call-template-runtime.test.mjs
tests/alpha3/alpha3-2a-agent-context-macro-guide.test.mjs
tests/alpha3/c3-project-index-query-macros.test.mjs
tests/alpha3/c5-generic-control-macros.test.mjs
tests/alpha3/d1-startup-health.test.mjs
tests/alpha3/e1-stock-plugin-fluency.test.mjs
```

Do not change `docs/abi/**`, discovery request fields, tool count, bridge,
installer, recipes, macro execution, lifecycle, support claims, or REAPER live
behavior. Alpha3.2-A remains paused until this fix passes independent review and
all repository gates.

Compaction fix scope amendment: the first implementation reduced default
`list_templates` from 129,970 to 80,160 bytes and passed all in-scope gates, but
full `npm test`/`build` exposed four legacy tests that still required heavyweight
snapshots from default menu mode. The user-facing preview script also silently
lost startup detail. The control tower expands the bounded fix scope only to:

```text
scripts/preview-alpha2-product-surface.mjs
tests/alpha3/block2-startup-readiness.test.mjs
tests/alpha3/block3-speed-productization.test.mjs
tests/alpha3/block5-reuse-ecosystem.test.mjs
tests/alpha3/block6-stock-plugin-product-gate.test.mjs
```

Those tests must keep their original snapshot content assertions but obtain the
detail through existing exact-id mode. The preview must preserve its prior
startup detail by using one bounded exact-id metadata read; it must not teach a
new tool or request field. No other scope is reopened.

### Alpha3.2-A Agent Context And Macro Guide Accepted

Status: accepted.

Control-tower acceptance: 2026-07-10.

Accepted implementation commit:

```text
759c4035dc8e47d24ad8faf27e13820d648aa634
product: add compact alpha3.2 macro guide
```

Accepted behavior:

- `ping`, `list_templates`, and `list_recipes` expose
  `alpha3.2.agent_context_macro_guide.v1` without adding a sixth MCP tool,
  public `call_recipe`, hidden executor, or raw Lua/action/shell/UI bypass;
- default product metadata includes complete 13-field manuals for the seven
  ordered primary macro ids: inspect, query, scoped delete, layout, routing,
  media placement, and render;
- those new primary ids plus `macro.project.file` remain
  `candidate` / `in_review` / `contract_only_non_runnable`, report
  `live_runnable_now:false`, and return `CALL_TEMPLATE_ID_HELD` rather than
  executing REAPER; accepted legacy macro dispatch remains unchanged;
- `macro.project.query` uses the approved twelve-value entity vocabulary, and
  project path/dirty/save/save-as ids remain exactly `planned_not_accepted`
  with no accepted mutation route;
- default `list_templates` is `detail_level:"compact"`; all eleven heavyweight
  snapshot/live-evidence fields are absent by default and available only through
  existing exact-id expansion;
- Layer 1.5 field selection remains authoritative: an exact request with
  `fields:["id"]` returns only `id` plus `capability_truth` in item rows;
- the product preview retains startup-health and startup-assistant detail through
  one bounded existing exact-id metadata read.

Accepted budget evidence:

```text
default runtime JSON: 80,159 bytes
default stdio text payload: 80,160 bytes
accepted ceiling: 98,304 bytes
remaining margin: 18,144 bytes
baseline: 56,925 <= 73,728 bytes
guide: 23,205 bytes
guide delta: 23,234 <= 24,576 bytes
primary manuals: 7
heavyweight fields: default 0; exact-id 11
```

The exported total ceiling is the single 98,304-byte source of truth. The
independent final reviewer first found and then verified closure of a split-
brain 128 KiB test/export constant; focused rereview returned `PASS` with no
remaining P0-P3 findings.

Control-tower gates passed:

```text
git diff --check
npm run check:alpha3-2a
npm run check:tool-abi
npm run check:discovery-menu
npm run check:template-runtime
npm run check:alpha3-c3
npm run check:alpha3-c5
npm run check:alpha3-d1
npm run check:alpha3-e1
npm run check:alpha3-block2
npm run check:alpha3-block3
npm run check:alpha3-block5
npm run check:alpha3-block6
node scripts/preview-alpha2-product-surface.mjs --limit=5
npm test
npm run build
```

No REAPER smoke ran because Alpha3.2-A changes discovery/manual/product metadata
only and makes no live-readiness or support claim. The next active gate is
Alpha3.2-B1: add bounded bridge heartbeat/liveness evidence so startup health can
distinguish an unstarted bridge action from an unresponsive bridge loop before
B2/B3 package, render-root, doctor, and live-smoke work.

### Alpha3.2-B1 Bridge Liveness Bounded Lower-Layer Fix Window

Status: reopened_for_fix; Alpha3.2-B product integration paused.

Control-tower decision: 2026-07-10.

Concrete blocker:

- the existing live executor can prove that transport directories and the bridge
  script exist, then it writes a request and waits for a result;
- when no result arrives, it reports the same
  `live_bridge_handshake_failed` / `BRIDGE_TIMEOUT` path whether the REAPER
  bridge action was never run or the deferred bridge loop started and later
  stopped responding;
- therefore B3 startup health and doctor cannot truthfully distinguish
  configuration readiness, `bridge_action_not_running`, and
  `bridge_loop_unresponsive` without reopening the frozen live-bridge transport
  implementation for a bounded internal liveness signal.

Approved lower-layer behavior:

- add one fixed internal heartbeat sidecar under the configured transport root;
- the REAPER bridge loop writes it atomically on startup and refreshes it at a
  bounded interval even when no command is waiting;
- heartbeat metadata is transport-only and bounded to contract id, active owner,
  active generation, sequence/timing fields, and loop interval; it contains no
  project state, refs, media paths, arbitrary payload, or new execution power;
- the Node live-bridge layer may read that sidecar without dispatching a template
  and classify at least: transport/config absent, bridge action not running
  (heartbeat absent), bridge loop unresponsive (heartbeat stale), bridge ready,
  owner mismatch, generation mismatch, and invalid heartbeat;
- staleness is determined from a bounded explicit threshold and filesystem
  freshness, not from an untrusted project response;
- B1 exposes only an internal liveness/probe contract for later B3 integration.
  It does not change `ping`, doctor output, product wording, support matrices, or
  default template execution in this window.

Approved implementation write scope:

```text
packages/mcp-server/src/live-bridge-executor-v1.mjs
reaper/bridge/src/10-file-transport.lua
reaper/bridge/src/90-file-transport-loop.lua
reaper/bridge/openreaper-live-bridge.lua  # generated only

tests/layer4d1/live-bridge-executor.test.mjs
tests/layer4d2/openreaper-live-bridge.test.mjs
```

Forbidden in B1:

- no edits to frozen ABI/taxonomy docs, tool registrations, discovery/menu,
  template catalog, recipe behavior, pack routes, handler registry, installer,
  render root, startup product metadata, or support wording;
- no sixth MCP tool, new Foundation Bridge operation family, public
  `call_recipe`, hidden executor, direct request-file user workflow, raw Lua/
  action/shell/UI bypass, project mutation, hardware/device I/O, or REAPER
  process spawning;
- no worker commits and no drive-by lower-layer changes outside the listed files.

Required static acceptance:

```text
git diff --check
npm run build:live-bridge
npm run check:live-bridge
node --test tests/layer4d1/live-bridge-executor.test.mjs
node --test tests/layer4d2/openreaper-live-bridge.test.mjs
npm run check:template-runtime
npm test
npm run build
```

Tests must use temporary transport fixtures to prove absent, fresh, stale,
malformed, owner-mismatch, and generation-mismatch heartbeat states without
starting REAPER. The generated bridge must remain deterministic and must refresh
heartbeat from the real deferred loop source. Independent review is required.
Live REAPER proof is deferred to B3, which must use a fresh evidence root and the
authorized `/Users/Zhuanz/Untitled/Untitled.RPP` fixture before any live startup
or doctor claim is accepted.

### Alpha3.2-B1 Bridge Liveness Accepted

Status: accepted; lower-layer implementation re-frozen at static evidence level.

Control-tower acceptance: 2026-07-10.

Accepted implementation commit:

```text
434edf1e466578c5a5ece076cfe0c546bd7051a9
runtime: add bounded bridge liveness
```

Accepted internal transport contract:

```text
heartbeat contract: openreaper.bridge_liveness.v1
probe contract: live_bridge.liveness_probe.v1
fixed sidecar: <transport-root>/openreaper-bridge-liveness-v1.json
heartbeat interval: 500 ms
default stale threshold: 2,000 ms
heartbeat read ceiling: 2,048 bytes
```

The heartbeat contains exactly contract, active owner, active generation,
sequence, refreshed Unix seconds, and interval metadata. It is written
atomically once before the deferred loop starts and refreshed independently of
request polling. It contains no project state, refs, media paths, request/result
payload, template data, or new execution authority.

The Node live-bridge layer now provides an internal read-only liveness probe and
executor method that classify:

```text
bridge_probe_input_invalid
bridge_config_absent
bridge_transport_absent
bridge_action_not_running
bridge_heartbeat_invalid
bridge_loop_unresponsive
bridge_owner_mismatch
bridge_generation_mismatch
bridge_ready
```

Accepted safety properties:

- the probe constructs only the fixed heartbeat path and does not write a
  request, call a template, or spawn REAPER;
- heartbeat reads use one FileHandle with
  `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, pre/post `fstat`, a hard `MAX+1` read
  ceiling, link/type/size/snapshot checks, and guaranteed close containment;
- symlinks, hardlinks, directories, FIFO/socket/open failures, empty/oversized
  files, read races, malformed or extra fields, and future timestamps fail
  closed as bounded non-ready results;
- expected owner/generation distinguish absent, valid, and explicitly invalid
  inputs; invalid identities cannot silently disable comparison or echo
  unbounded data;
- filesystem mtime remains the freshness source, with an explicit 1,000 ms
  future-skew tolerance; age equal to the threshold is ready and threshold plus
  one millisecond is unresponsive;
- stale state precedes identity mismatch, and owner mismatch precedes generation
  mismatch;
- ordinary dispatch is not heartbeat-gated: missing heartbeat still permits the
  existing request write and preserves `BRIDGE_TIMEOUT` plus
  `live_bridge_handshake_failed` when no result arrives;
- `foundation.bridge.v1`, the five operation families, five MCP tools, template
  allowlists, pack routes, and default execution semantics are unchanged.

Independent review initially found three P1 findings (symlink/TOCTOU/unbounded
read, future-mtime false readiness, and invalid expected-identity bypass) plus
one P2 timing/test-coverage gap. The bounded security fix closed all four;
focused rereview returned `PASS` with no remaining P0-P3 findings.

Control-tower gates passed:

```text
git diff --check
node scripts/build-live-bridge.mjs --check
node --test tests/layer4d1/live-bridge-executor.test.mjs  # 13/13
node --test tests/layer4d2/openreaper-live-bridge.test.mjs  # 7/7
npm run check:template-runtime
npm run check:tool-abi
npm run check:foundation-bridge
npm test
npm run build
```

Final control-tower logs:

```text
/tmp/openreaper-alpha32b1-r2-final-T1ZcaM
```

No REAPER ran. B1 proves only the internal static liveness contract and source/
bundle behavior. It does not prove that the real REAPER loop refreshes the
heartbeat, that startup/doctor reports are correct, or that any platform beyond
the reviewed local macOS filesystem behavior is supported.

Next gate: Alpha3.2-B2 Managed Render Root. B2 may prepare a deterministic
managed render directory and package/start environment wiring, but must not
consume the liveness probe into `ping`/doctor or make live-readiness claims;
that integration and the authorized REAPER smoke remain B3.

### Alpha3.2-B2 Managed Render Root Implementation Window

Status: in_progress; normal product slice, no lower-layer reopen required.

Control-tower decision: 2026-07-10.

Concrete product blocker:

- the accepted render handlers already consume
  `OPENREAPER_LIVE_SMOKE_RENDER_ROOT`, but the installable product does not
  create a default render directory or propagate that env through installer,
  MCP wrapper, or `openreaper-start`;
- the installed default session currently has transport and artifact roots but
  no `session/renders` directory;
- adding a default root inside `~/.openreaper/current` without bounded upgrade
  and uninstall handling would delete user render outputs during replacement or
  removal, so preservation is part of B2 rather than a later cleanup.

B2 product contract:

```text
default root: <install-root>/session/renders
installed default: ~/.openreaper/current/session/renders
existing env only: OPENREAPER_LIVE_SMOKE_RENDER_ROOT
persisted selection: <install-root>/session/managed-render-root.path
```

Required precedence:

```text
installer:
  explicit --render-root
  > prior persisted selection during reinstall/upgrade
  > <install-root>/session/renders

normal installed openreaper-start:
  explicit --render-root
  > persisted selection
  > <install-root>/session/renders

openreaper-start with explicit --session-root and no --render-root:
  <explicit-session-root>/renders

openreaper-mcp:
  explicit process env
  > persisted selection
  > <install-root>/session/renders
```

Approved tracked write scope:

```text
scripts/openreaper-alpha-package/install-openreaper.mjs
scripts/openreaper-alpha-package/openreaper-start.sh
scripts/openreaper-alpha-package/openreaper-mcp.sh
scripts/openreaper-alpha-package/uninstall-openreaper.mjs
scripts/package-openreaper-alpha.mjs
tests/alpha3/alpha3-2b-managed-render-root.test.mjs
package.json
```

Required behavior:

- fresh install creates the selected root as a real writable directory and
  stores the same absolute selection for MCP/start reuse;
- installer config for Codex, Cursor, Claude, `mcp.json`, TOML snippets, and
  Trae carries the same existing render-root env;
- installer MCP smoke, direct startup, and macOS LaunchServices startup receive
  the selected root; stale parent render env is ignored by default;
- `--render-root` is an explicit bounded override; an explicit evidence
  `--session-root` derives its own `renders` child unless render root is also
  supplied;
- root preparation rejects relative/file-URI/control-character paths,
  filesystem root, home, reserved install/session/transport/artifact overlap,
  regular files, final symlinks, and directories that fail an exclusive bounded
  write probe;
- `/tmp/...` remains usable on macOS even though it canonically aliases
  `/private/tmp`; only the final candidate component is rejected for being a
  symlink, while canonical paths are used for overlap checks;
- validation happens before destructive install-root replacement; existing
  custom directory permissions are not recursively changed;
- default-root outputs survive upgrade/reinstall. External custom roots are
  never deleted. A non-empty default root is preserved outside the install tree
  before uninstall and its recovery path is reported;
- installer/start output may name the selected render root but must not claim
  `ready_for_render`, doctor readiness, bridge readiness, render success, codec
  support, or live product support.

Forbidden/deferred:

- do not edit doctor, `ping`, stdio product metadata, B1 liveness, bridge Lua,
  render handlers/templates, recipes, ABI/taxonomy, startup-assistant metadata,
  support docs, or `macro.render.targets`;
- do not add another render-root env, MCP tool, operation family, public
  `call_recipe`, hidden executor, raw Lua/action/shell/UI bypass, or new REAPER
  process control;
- do not run REAPER or render. B3 owns liveness/doctor integration and authorized
  live evidence; 3.2-E owns render macro/product orchestration;
- workers do not commit and must stop on any need for an unlisted file.

Required fixture matrix:

```text
fresh default install
default-root upgrade with an existing output file
prior custom-root reinstall without repeating the override
explicit custom-root startup through a fake executable
explicit session-root -> session/renders
stale parent env ignored
relative/file URI/root/home/reserved overlap rejection
regular file/final symlink/unwritable root rejection
/tmp versus /private/tmp alias acceptance
non-empty default-root uninstall preservation
packaged MCP/start/installer smoke and portability scan
```

Required gates:

```text
git diff --check
node --check scripts/openreaper-alpha-package/install-openreaper.mjs
node --check scripts/openreaper-alpha-package/uninstall-openreaper.mjs
node --check scripts/package-openreaper-alpha.mjs
zsh -n scripts/openreaper-alpha-package/openreaper-start.sh
zsh -n scripts/openreaper-alpha-package/openreaper-mcp.sh
node --test tests/alpha3/alpha3-2b-managed-render-root.test.mjs
npm run check:alpha3-2b
npm run check:template-runtime
npm run check:alpha3-d1
npm run check:alpha3-block2
npm test
npm run build
```

The worker must also build the alpha package into a fresh `/tmp` output root
with package smoke enabled and without launching REAPER. Independent review is
required before B2 acceptance.

### Alpha3.2-B2 Managed Render Root Accepted

Status: accepted at package/static/fake-process evidence level.

Control-tower acceptance: 2026-07-11.

Accepted implementation commit:

```text
bb1b469a2ef4e0fea20ce2fa370fe845843dc46b
package: add managed render root
```

Accepted product contract:

```text
default root: <install-root>/session/renders
installed default: ~/.openreaper/current/session/renders
environment: OPENREAPER_LIVE_SMOKE_RENDER_ROOT
persisted selection: <install-root>/session/managed-render-root.path
```

Installer, installed MCP, direct startup, and macOS LaunchServices startup now
select, validate, prepare, persist, and propagate the same managed render root.
The accepted precedence is the B2 implementation-window contract: explicit
`--render-root` wins; reinstall reuses a valid prior persisted selection;
normal installed startup and MCP fall back to the installed default; and an
explicit `--session-root` without a render override derives its own `renders`
child.

Accepted safety and lifecycle properties:

- root text and persisted records are bounded, absolute, single-line valid UTF-8
  and reject file URIs, C0/DEL controls, filesystem root, user home, unsafe
  final symlinks/types, reserved install/session/effective transport/artifact
  overlap, and failed exclusive write probes;
- canonical overlap checks preserve `/tmp` versus `/private/tmp` usability while
  rejecting aliases of reserved roots;
- validation happens before destructive install replacement, custom directory
  permissions are not recursively changed, and missing option values fail with
  exit code 2;
- default-root outputs survive reinstall/upgrade; external custom roots are not
  deleted; non-empty default outputs are atomically preserved outside the
  install tree before uninstall and their recovery path is reported;
- LaunchServices propagation uses one stable installed-scope cooperative lock,
  bounded owner metadata and recovery snapshot, exact presence/value restore,
  signal/exit cleanup, and fail-closed retained recovery evidence when safe
  restore or ownership validation cannot complete;
- package and test fakes use bounded PID/launch/exit markers, active cleanup
  registries, owned POSIX process-group cleanup for timeout descendants, and
  TERM-to-KILL escalation before fixture roots are removed;
- installer/start output may report the selected root but does not claim doctor,
  bridge, codec, render, or live-product readiness.

Independent review found three P1 process-cleanup gaps: mutation-marker timeout
could orphan descendants, delayed fake PID creation could race fixture removal,
and package exit-marker timeout could bypass termination. After those fixes,
focused rereview found one final P1 duplicate `ENOENT` rejection channel. The
formal regressions now cover all four paths, and final independent rereview
returned `FINAL PASS` with P0-P3 all zero.

Control-tower gates passed on the accepted tree:

```text
git diff --check
node --check scripts/openreaper-alpha-package/install-openreaper.mjs
node --check scripts/openreaper-alpha-package/uninstall-openreaper.mjs
node --check scripts/package-openreaper-alpha.mjs
node --check tests/alpha3/alpha3-2b-managed-render-root.test.mjs
zsh -n scripts/openreaper-alpha-package/openreaper-start.sh
zsh -n scripts/openreaper-alpha-package/openreaper-mcp.sh
node --test --test-name-pattern='<five cleanup/readiness regressions>' \
  tests/alpha3/alpha3-2b-managed-render-root.test.mjs  # 5/5
node --test tests/alpha3/alpha3-2b-managed-render-root.test.mjs  # 37/37
npm run check:alpha3-2b
npm run check:template-runtime
npm run check:alpha3-d1
npm run check:alpha3-block2
npm test
npm run build  # isolated pass 1, B2 37/37
npm run build  # isolated pass 2, B2 37/37
```

Final control-tower evidence:

```text
/tmp/openreaper-alpha32b2-ct-acceptance-ptq9MW
```

Fresh package smoke ran with smoke enabled and without `--skip-smoke`:

```text
/tmp/openreaper-alpha32b2-accepted-package-pYH520/OpenReaper-alpha
```

The smoke passed installer upgrade/preservation, MCP/start propagation,
LaunchServices lock/restore, package portability over 252 text files, OpenReaper
MCP, and Vital Agent MCP. It reported `fake_process_reaped:true`; the deliberate
missing-exit-marker fixture preserved the original timeout while proving TERM,
KILL, process reap, and post-exit marker cleanup. Immediate and delayed process
audits after directed tests, both full builds, and package smoke were empty.

No real REAPER process or render ran. B2 proves deterministic managed-root
selection, preservation, propagation, package behavior, and fake-process
cleanup on the reviewed local macOS/POSIX paths. It does not prove live bridge,
doctor readiness, codec support, or render success.

Next gate: Alpha3.2-B3 Runtime / Doctor Live Readiness. B3 may consume the
accepted B1 liveness probe and B2 root into startup health and doctor output,
then must use a fresh evidence root and the authorized
`/Users/Zhuanz/Untitled/Untitled.RPP` fixture before any live-readiness claim is
accepted.

### Alpha3.2-B3 Runtime / Doctor Live Readiness Implementation Window

Status: in_progress; normal product integration, no lower-layer reopen required.

Control-tower decision: 2026-07-11.

Accepted dependencies:

```text
B1 liveness: 434edf1 runtime: add bounded bridge liveness
B2 render root: bb1b469 package: add managed render root
```

Concrete product blocker:

- `ping.ok:true` currently proves only that the MCP stdio server answered;
- default doctor `status:ready` currently proves package/config/MCP smoke only;
- `openreaper-start` `startup-status=ready` proves only that the REAPER process
  stayed alive and already prints a separate bridge-action wait state;
- the accepted B1 heartbeat and B2 managed root are not yet projected into
  bounded product readiness, and no installed doctor mode performs the accepted
  request/response read probe before claiming live connection.

B3 integration contract:

```text
runtime readiness contract: alpha3.2.b3.runtime_doctor_readiness.v1
bridge liveness source: accepted live_bridge.liveness_probe.v1 only
render-root source in MCP: effective OPENREAPER_LIVE_SMOKE_RENDER_ROOT
live request/response proof: call_template(template.transport.read_state)
doctor modes:
  openreaper-doctor --for live-edit
  openreaper-doctor --for render
  openreaper-doctor --for media-import
  openreaper-doctor --for project-query
optional bounded wait:
  openreaper-doctor --wait-bridge[=SECONDS]
```

Required public separation:

- MCP reachability, package/config readiness, REAPER process readiness, bridge
  heartbeat liveness, request/response proof, managed-root readiness, and task
  readiness must remain separately named facts;
- `ping` may call the accepted read-only heartbeat probe and inspect the already
  selected render root, but it must not dispatch a template, write a direct
  bridge request, start REAPER, or claim request/response proof;
- the public ping projection must be bounded and omit raw heartbeat/transport
  filesystem paths and unbounded low-level error text;
- B1 status vocabulary remains unchanged:
  `bridge_config_absent`, `bridge_transport_absent`,
  `bridge_action_not_running`, `bridge_loop_unresponsive`,
  `bridge_heartbeat_invalid`, `bridge_owner_mismatch`,
  `bridge_generation_mismatch`, `bridge_probe_input_invalid`, and
  `bridge_ready`;
- doctor may add product diagnoses such as `reaper_not_running`,
  `transport_permission_error`, and combined `owner_generation_mismatch`, but
  must preserve the underlying B1 status in structured evidence;
- expected generation is strictly parsed to a safe non-negative integer before
  calling B1; absent identity fields are omitted, not forwarded as `undefined`;
- normal installed doctor identity must match the accepted installed/start
  defaults `openreaper-alpha` / generation `1`, unless an explicit bounded test
  environment supplies another valid identity.

Required doctor behavior:

- default doctor preserves its package/config result and exit behavior while
  adding observed runtime readiness; a healthy package with no heartbeat is not
  a package failure;
- `--for` supports exactly `live-edit`, `render`, `media-import`, and
  `project-query`; invalid/missing option values fail with exit code 2;
- `--wait-bridge` is bounded to an explicit safe range, polls only MCP `ping`,
  and never runs the REAPER Action itself;
- after heartbeat status becomes `bridge_ready`, a task-mode/wait doctor runs
  the existing MCP `call_template(template.transport.read_state)` with the
  matching owner/generation and a bounded timeout before reporting live
  request/response readiness;
- task results use `ready`, `blocked`, or `degraded` and include the missing
  precondition, `failure_layer`, recoverability, next action, whether user
  action/restart is required, and a copy-paste fix when safe;
- `live-edit` requires matching heartbeat plus successful read probe;
- `render` additionally requires the effective managed root to exist as a real
  writable directory. `ready_for_render:true` means preflight only and must be
  paired with `render_execution_proven:false`,
  `codec_support_assessed:false`, and `scope:preflight_only`;
- `media-import` and `project-query` may prove the shared bridge/read preflight,
  but remain `degraded` with their task-specific source/index readiness marked
  `not_assessed` until their owning later slices provide evidence;
- render-root missing/invalid/unwritable output includes a bounded copy-paste
  directory fix and says whether MCP/REAPER restart is required;
- doctor must not silently create missing transport, artifact, or render roots
  while diagnosing them. A B3-owned read-only doctor resolver may inspect the
  B2 environment/persisted/default selection, but must not refactor or change
  accepted B2 precedence/validation.

Approved tracked write scope:

```text
packages/mcp-server/src/alpha3-2b3-runtime-doctor-readiness-v1.mjs
packages/mcp-server/src/openreaper-mcp-stdio.mjs
packages/mcp-server/src/openreaper-agent-startup-guidance-v1.mjs
scripts/openreaper-alpha-package/openreaper-doctor.sh
scripts/package-openreaper-alpha.mjs
tests/alpha3/alpha3-2b3-runtime-doctor-readiness.test.mjs
tests/alpha3/alpha3-2a-agent-context-macro-guide.test.mjs
tests/alpha3/block2-startup-readiness.test.mjs
package.json
```

The startup-guidance and existing tests are conditional: touch them only if
needed to point agents at the accepted doctor modes or to preserve actual stdio
coverage. A worker must stop and report before editing any unlisted path.

Forbidden/deferred:

- do not edit `live-bridge-executor-v1.mjs`, bridge Lua/generated bundle, the B1
  sidecar contract/status/timing, or ordinary dispatch semantics;
- do not edit B2 installer/start/MCP-wrapper/uninstaller root selection,
  persistence, preservation, or LaunchServices behavior;
- do not change Tool ABI, Foundation Bridge ABI, taxonomy, templates, handlers,
  recipes, `call_template` context ergonomics, SQLite runtime, render runtime,
  `macro.render.targets`, support matrices, or public platform claims;
- do not add a sixth MCP tool, doctor MCP tool, bridge operation family, public
  `call_recipe`, direct request-file protocol, hidden executor, raw Lua/action/
  shell/UI product bypass, `--auto-bridge`, `--restart-bridge`, or new REAPER
  process-control capability;
- do not render in B3. Render execution and codec evidence remain 3.2-E/G.

Required fake/runtime matrix:

```text
bridge config absent
transport directory or requests/results absent
transport permission failure
complete transport with no heartbeat
stale heartbeat
malformed/unsafe heartbeat
fresh owner mismatch
fresh generation mismatch
fresh matching heartbeat
valid, missing, non-directory, symlink, and unwritable render root
strict invalid expected-generation input
REAPER pid missing/dead versus alive with action absent
```

Assertions:

- `ping` leaves the requests directory empty and labels request/response proof
  `not_run`;
- package/config status does not become false merely because the bridge action
  is not running;
- task-mode doctor dispatches the read probe only after `bridge_ready`;
- fake matching-heartbeat plus fake read result can reach live-edit ready;
- render mode cannot reach ready unless both live read and root checks pass;
- query/media modes never overclaim their later task-specific gates;
- all payloads, waits, paths, error strings, and recovery lists remain bounded;
- exact five-tool MCP surface remains unchanged.

Required static/package gates:

```text
git diff --check
node --check packages/mcp-server/src/alpha3-2b3-runtime-doctor-readiness-v1.mjs
node --check packages/mcp-server/src/openreaper-mcp-stdio.mjs
zsh -n scripts/openreaper-alpha-package/openreaper-doctor.sh
node --check scripts/package-openreaper-alpha.mjs
node --test tests/alpha3/alpha3-2b3-runtime-doctor-readiness.test.mjs
node --test tests/layer4d1/live-bridge-executor.test.mjs
node --test tests/layer4d2/openreaper-live-bridge.test.mjs
node --test tests/alpha3/alpha3-2b-managed-render-root.test.mjs
node --test tests/alpha3/alpha3-2a-agent-context-macro-guide.test.mjs
node --test tests/alpha3/block2-startup-readiness.test.mjs
npm run check:tool-abi
npm run check:template-runtime
npm test
npm run build
```

A fresh alpha package must run smoke with no REAPER. Actual packaged stdio ping
and the actual packaged doctor must be exercised against no-heartbeat, stale,
fresh matching, and missing/valid render-root fixtures. Package smoke must treat
`bridge_action_not_running` as a valid observed non-ready state and leave no
fake child or probe files.

Required authorized live acceptance:

```text
project: /Users/Zhuanz/Untitled/Untitled.RPP
fresh evidence/session/render root: required
start path: packaged OpenReaper openreaper-start only
bridge action: OpenReaper: Start MCP bridge
health paths: packaged openreaper-doctor and MCP ping/call_template only
render: forbidden in B3
```

The live sequence must record the process baseline and project backup/recovery
posture, then prove:

1. before the bridge Action, managed-root readiness is true while bridge status
   is exactly `bridge_action_not_running` and live-edit/render task readiness is
   false;
2. after the existing REAPER Action, bounded polling reaches `bridge_ready` with
   matching owner/generation and heartbeat age within the accepted 2,000 ms
   threshold;
3. `call_template(template.transport.read_state)` succeeds before any request/
   response or task-ready claim;
4. doctor `--for live-edit` becomes ready and `--for render` reports
   preflight-only `ready_for_render:true` without claiming a render or codec;
5. no project mutation or render output is expected; any actual project change,
   file output, dialog, process, backup, and cleanup result is reported exactly;
6. REAPER is cleanly stopped after evidence and immediate/delayed process audits
   show no smoke-owned MCP, fake, or REAPER process.

Independent review is required before implementation acceptance and again after
live evidence. B3 remains unaccepted until static, package, reviewer, and live
gates all pass.

### Alpha3.2-B3 Runtime / Doctor Live Readiness Accepted

Status: accepted at static, package-smoke, authorized live-read, and independent
review evidence level.

Control-tower acceptance: 2026-07-11.

Accepted implementation commit:

```text
1f9a836030f0b98cd19f4bdc6b40e52e1e8d912d
runtime: add alpha3.2b3 doctor readiness
```

Accepted runtime contract:

```text
alpha3.2.b3.runtime_doctor_readiness.v1
```

The accepted implementation keeps the public MCP surface at exactly five tools
and projects the accepted B1 heartbeat plus B2 managed root through read-only
`ping` readiness. Package/config readiness, exact REAPER-process evidence,
bridge heartbeat, request/response proof, selected render-root readiness, and
task readiness remain separately named facts. `ping` does not dispatch a
template, create a direct bridge request, start REAPER, create a root, or claim
request/response proof.

Accepted doctor behavior:

- exact task modes are `live-edit`, `render`, `media-import`, and
  `project-query`; `--wait-bridge[=SECONDS]` is bounded and polls only `ping`;
- after `bridge_ready`, doctor proves the existing
  `call_template(template.transport.read_state)` request/response path before
  reporting live-edit or shared task readiness;
- render readiness additionally requires the selected managed root and remains
  strictly preflight-only with `render_execution_proven:false`,
  `codec_support_assessed:false`, and `scope:preflight_only`;
- default package/MCP command smoke is independent of a non-ready selected task
  render root; selected root failures remain render/task evidence rather than
  becoming a package failure;
- exact REAPER PID evidence is fail-closed and binds the nofollow PID record to
  bounded exact-PID `ps` state/start data, kernel-observed `lsof` executable
  identity, and the Cockos `com.cockos.reaper` / `Y3T58622SG` code-sign
  requirement;
- transport permission recovery is manual-only rather than publishing an
  unsafe pathname chmod; render recovery creates a fresh unique root beneath
  canonical system temporary storage and routes the user through the accepted
  `openreaper-start --render-root` path without mutating the rejected root;
- doctor-owned MCP clients use bounded detached POSIX process groups so normal
  completion, timeout, SIGINT, and SIGTERM clean direct children and stubborn
  descendants with TERM-to-KILL escalation and group-exit verification.

Independent review exercised timeout/orphan cleanup, render-root symlink and
TOCTOU swaps, PID reuse and argv0/basename spoofing, exact directional
transport permissions, restart truthfulness, BSD chmod incompatibility,
ancestor-symlink recovery, package/render status separation, and actual
packaged doctor behavior. The final implementation review and the final live
evidence review both returned PASS with P0-P3 all zero.

Control-tower full gates passed:

```text
git diff --check
node --check packages/mcp-server/src/alpha3-2b3-runtime-doctor-readiness-v1.mjs
node --check packages/mcp-server/src/openreaper-mcp-stdio.mjs
zsh -n scripts/openreaper-alpha-package/openreaper-doctor.sh
node --check scripts/package-openreaper-alpha.mjs
node --test tests/alpha3/alpha3-2b3-runtime-doctor-readiness.test.mjs  # 12/12
node --test tests/layer4d1/live-bridge-executor.test.mjs               # 13/13
node --test tests/layer4d2/openreaper-live-bridge.test.mjs             # 7/7
node --test tests/alpha3/alpha3-2b-managed-render-root.test.mjs        # 37/37
node --test tests/alpha3/alpha3-2a-agent-context-macro-guide.test.mjs  # 12/12
node --test tests/alpha3/block2-startup-readiness.test.mjs             # 4/4
npm run check:tool-abi
npm run check:template-runtime
npm test
npm run build
```

Control-tower gate evidence:

```text
/tmp/openreaper-alpha32b3-ct-full-20260711T032515Z
```

Fresh package smoke ran with smoke enabled and without `--skip-smoke`:

```text
/tmp/openreaper-alpha32b3-ct-package-20260711T033050Z/OpenReaper-alpha
/tmp/openreaper-alpha32b3-ct-package-20260711T033050Z.package.log
```

It passed actual packaged stdio/doctor no-heartbeat, stale, matching-read,
missing/file/symlink/unwritable/valid selected-root, live-edit independence,
render preflight, never-settling ping, external SIGTERM, stubborn grandchild,
and independent fixture-timeout cases. It reported exact tool count five, no
REAPER startup, no fake children, and no leftover fake request/result/probe
files.

Authorized live acceptance used the disposable project and a fresh evidence
root:

```text
project: /Users/Zhuanz/Untitled/Untitled.RPP
evidence: /tmp/openreaper-alpha32b3-live-20260711T033242Z
candidate: /tmp/openreaper-alpha32b3-ct-package-20260711T033050Z/OpenReaper-alpha
```

Before the Action, candidate `openreaper-start` launched PID `74665`; doctor
verified the signed Cockos REAPER identity and launch record, selected root
`render_root_ready`, exact `bridge_action_not_running`, request proof `not_run`,
and blocked live-edit/render task results. After the registered
`OpenReaper: Start MCP bridge` Action, bounded doctor polls observed matching
`openreaper-alpha` / generation `1`, heartbeat ages of 7 ms, 75 ms, and 402 ms,
`bridge_ready`, and successful live read proof. Doctor reported live-edit ready
and render `ready_for_render:true` with the accepted preflight-only negatives.
An independent actual MCP client proved `ping` left the request count unchanged
and a subsequent explicit `call_template(template.transport.read_state)`
succeeded with stopped transport state.

The candidate was not installed over the accepted installed product, so its
overall doctor status accurately remained `needs_client_config_refresh` while
`smoke.ok:true` and all live task exits were zero. This is not evidence that
current client configurations point at the candidate and is not promoted as an
installed-product claim.

The main project remained byte-identical and mtime-identical before, during,
and after the smoke:

```text
SHA256 ad67bf20622b3afb449082653564e0d7fc6d12623e306d0fac3b3ef93f478f37
```

No render or artifact output was created, and immediate plus delayed audits
found no REAPER or smoke-owned process. Real observed side effects are retained:
REAPER showed the project modified in memory, quit exposed Project
Settings/Notes and then an unsaved project before the second quit completed,
`/Users/Zhuanz/Untitled/Backups/Untitled-2026-07-11_1137.rpp-bak` was created,
and `/Users/Zhuanz/Untitled/.DS_Store` mtime changed. Request/result evidence
files remain intentionally under the fresh `/tmp` evidence root.

A separate earlier control-tower version probe accidentally launched REAPER PID
`23776` via `REAPER -version`; it was immediately interrupted with Ctrl-C, did
not load or modify the authorized project, is not contained in the B3 evidence
root, and is explicitly excluded from B3 acceptance evidence.

B3 proves bounded startup/bridge/read readiness and managed-root render
preflight on the reviewed local macOS path. It does not prove render execution,
codec support, broader startup environments, customer-ready support, or the
later media-import/project-query task-specific gates.

Next gate: Alpha3.2-C Context, Refs, Project File Templates.

### Alpha3.2-C Context, Refs, Project File Umbrella / C1 Implementation Window

Status: in_progress; C1 only. C2 and C3 remain paused pending their own bounded
lower-layer fix windows.

Control-tower decision: 2026-07-11.

Alpha3.2-C is divided into ordered, separately reviewed slices:

```text
C1  server-managed call context and request sequence
C2  repairable ref examples and TEMPLATE_REFS_INVALID guidance
C3A current project path and dirty-state read templates
C3B save-current-project template
C3C audited save-as template
C3D secondary macro.project.file binding after audited templates exist
```

This window authorizes only C1. Normal product `call_template` calls must work
without caller-authored execution context while the frozen Template Authoring
ABI harness remains strict internally. The MCP server owns bounded session
identity, `created_at`, and `request_sequence`; it allocates each sequence
synchronously before dispatch, rotates the server session before the frozen
999-sequence limit, and preserves explicit expected owner/generation checking.
Environment-provided bridge identity must be strictly validated. Direct harness
callers and lower-level tests may continue supplying explicit context.

The Layer 1 five-tool surface remains exact. C1 must not add a sixth tool,
`resolve_ref`, `make_ref`, a hidden executor, raw bridge-request access, raw Lua,
raw action, shell, or UI escape paths. It must not weaken request-id,
idempotency, owner, generation, timeout, input, ref, or result validation.

Concrete lower-layer correction approved for this window: the compact discovery
example emitted by `packages/mcp-server/src/discovery-menu-v1.mjs` may be changed
only to stop teaching callers to author server-owned context and to demonstrate
the normal omission path. The frozen discovery pagination, field-selection,
budget, menu, and detail contracts remain unchanged. No ABI or taxonomy
document change is approved.

Approved tracked write scope:

```text
packages/mcp-server/src/alpha3-2c1-call-context-v1.mjs       # optional new helper
packages/mcp-server/src/openreaper-mcp-stdio.mjs
packages/mcp-server/src/discovery-menu-v1.mjs               # bounded example-only fix
scripts/package-openreaper-alpha.mjs                        # package inclusion/smoke only
scripts/openreaper-alpha-package/**                         # only if actual package smoke needs it
tests/alpha3/alpha3-2c1-auto-context.test.mjs               # new focused tests
tests/layer4d/call-template-runtime.test.mjs                # bounded regression only
package.json                                                # test/check wiring only
```

Any need to change the core execution harness, Foundation / Bridge ABI,
Template Authoring ABI, discovery contract beyond the example correction,
bridge Lua, template descriptors/handlers, project-file behavior, refs error
shape, or architecture/process files is a blocker and must return to the
control tower. C2 and C3 implementation paths are not implicitly authorized by
this umbrella entry.

Required C1 evidence:

- omitted-context `call_template` succeeds through the actual stdio server;
- strict invalid owner/generation environment cases fail closed;
- concurrent calls receive unique request ids and sequences allocated before
  asynchronous dispatch;
- sequence 999 causes a bounded session rotation before sequence reuse;
- the chosen explicit-context compatibility behavior is tested and documented
  in code-facing discovery without making the caller own request sequence;
- package output runs an actual stdio omitted-context smoke;
- the public tool list remains exactly five and direct raw requests remain
  unavailable;
- focused tests, existing Layer 4D runtime regressions, `npm test`, package
  smoke, and `npm run build` pass.

C1 does not require REAPER because it changes server-side request construction
and discovery examples only. A later live read canary may reuse the authorized
fixture, but no live-product claim depends on it in this slice. Workers do not
commit. The control tower owns review, acceptance, ledger updates, and commits.

### Alpha3.2-C1 Server-Managed Call Context Accepted

Status: accepted.

Accepted implementation commit:

```text
c8ded67 runtime: add server-managed call context
```

Accepted contract:

```text
alpha3.2.c1.call_context.v1
```

Normal MCP stdio `call_template` calls now omit caller-authored execution
context. The product wrapper strictly resolves installed bridge owner and
generation, generates a bounded process-local session, synchronously allocates
sequence `1..999` before dispatch, rotates the session before sequence reuse,
and supplies `created_at` plus the complete strict context to the unchanged
frozen Template Authoring ABI harness. A per-sequence timestamp ratchet prevents
request-id collisions across same-millisecond or fixed-clock session rollover.

Caller context remains an optional compatibility hint only. A bounded
`client_id` may be retained; caller `session_id` is validated but not adopted;
caller `created_at` and `request_sequence` cannot replace server values; and
owner/generation conflicts fail with a typed error. Present-but-invalid
`OPENREAPER_LIVE_BRIDGE_OWNER` or `OPENREAPER_LIVE_BRIDGE_GENERATION` values
fail server initialization closed rather than falling back to defaults.

The approved discovery correction now teaches the normal omission path and
labels session, timestamp, and request sequence as server-owned. The public MCP
surface remains exactly five tools. No raw request, Lua, action, shell, UI,
`resolve_ref`, `make_ref`, recipe executor, or hidden executor surface was
added. No core harness, bridge Lua, descriptor, handler, ABI, or taxonomy file
changed.

Independent final review: PASS with P0-P3 all zero. It verified actual frozen-
harness entry, invalid-environment shutdown, installed-identity conflict
rejection, synchronous allocation, 999 rollover, fixed-clock request-id
uniqueness, bounded client/session input, exact five tools, discovery scope,
actual packaged stdio execution, fake bridge cleanup, and exact file ownership.

Control-tower gates passed:

```text
git diff --check
node --check packages/mcp-server/src/alpha3-2c1-call-context-v1.mjs
node --check packages/mcp-server/src/openreaper-mcp-stdio.mjs
npm run check:alpha3-2c1                                      # 6/6
npm run check:discovery-menu                                  # 11/11
npm run check:tool-abi                                        # exact 5
npm run check:template-runtime
npm test
npm run build
```

Control-tower gate evidence:

```text
/tmp/openreaper-alpha32c1-ct-20260711T045207Z
```

Fresh package smoke passed without `--skip-smoke` and used the packaged
`OpenReaper-alpha/bin/openreaper-mcp` plus a fake Foundation file bridge to run
`template.transport.read_state` with context omitted:

```text
/tmp/openreaper-alpha32c1-package-20260711T044253Z/OpenReaper-alpha
/tmp/openreaper-alpha32c1-package-20260711T044253Z.package.log
```

The observed request used sequence `1`, a server-managed session,
`openreaper-alpha-package-smoke` owner, and generation `1`. Package cleanup left
no fake child, request, result, or probe residue. No REAPER process was started;
C1 proves server construction, frozen-harness entry, packaged stdio transport,
and fake bridge dispatch, not live REAPER execution.

Next gate: Alpha3.2-C2 repairable refs. C2 remains paused until the control tower
opens a separate bounded lower-layer fix window. The C2 scout found that stdio
currently exposes only array refs while the harness already accepts keyed refs,
that discovery examples are declarations rather than valid object refs, and
that `TEMPLATE_REFS_INVALID` lacks expected names/shapes/examples. It also found
marker/region descriptor wording that conflicts with index-based handler truth
and a `project:current` result-normalization scheme mismatch; neither issue was
changed in C1 and each requires an explicit C2 control-tower decision.

### Alpha3.2-C2 Repairable Refs Bounded Lower-Layer Fix Window

Status: reopened_for_fix; Alpha3.2-C3 remains paused.

Control-tower decision: 2026-07-11.

Accepted dependency:

```text
C1 implementation: c8ded67 runtime: add server-managed call context
C1 acceptance ledger: 2992126 docs: accept alpha3.2c1 call context
```

Concrete product blockers:

- discovery `exampleRefs()` emits declaration notes such as `shape:track:...`
  rather than valid Foundation object-ref shapes, so copying the example fails;
- `TEMPLATE_REFS_INVALID` normally returns only bounded error strings and omits
  descriptor ref names, required/missing roles, accepted input forms, complete
  examples, and executable recovery guidance;
- the frozen harness already accepts either an object-ref array or an object
  keyed by descriptor ref name, but stdio currently exposes only the array form,
  losing role identity for multiple refs of the same kind;
- accepted marker/region descriptors claim GUID-backed identity while current
  list/create/mutation handlers produce and consume index identity;
- structured result normalization maps `project:current` to `scheme:alias` while
  Foundation tests and project handlers use `scheme:current`.

C2 contract:

```text
alpha3.2.c2.ref_guidance.v1
```

Required behavior:

- preserve the frozen ref-kind set and Foundation request shape;
- preserve every existing `details.errors` string for compatibility while
  enriching all `TEMPLATE_REFS_INVALID` paths with bounded `expected_refs`,
  `missing_refs`, `accepted_input_forms`, kind-correct complete object examples,
  replacement guidance, and a safe next action;
- examples distinguish a structurally valid shape from a live-resolved object;
  GUID/path placeholders must explicitly say which field values require
  replacement from resolver/query/template output or a real absolute path;
- discovery examples retain descriptor ref names by using the already accepted
  descriptor-keyed object form and must be copyable JSON shapes;
- stdio accepts both the existing object-ref array and the existing harness
  descriptor-keyed object form without adding tools or execution powers;
- common guidance covers project, track, item, take, fx, marker, region, and
  file. Handler-proven schemes are authoritative: project `current`, stable
  track/item/take GUID with explicit index fallback, owner-qualified FX,
  marker/region index number, and absolute file path;
- make the exact marker/region descriptor summaries truthful to current
  index-based handlers. Do not add GUID support or change handler behavior;
- normalize only the canonical string `project:current` to
  `identity:{scheme:"current",value:"current"}`. Do not broadly change alias or
  result-ref inference behavior;
- do not introduce `resolve_ref`, `make_ref`, a sixth MCP tool, raw request,
  Lua/action/shell/UI access, hidden execution, or stricter semantic ref
  validation that rejects previously structurally accepted refs.

Approved tracked write scope:

```text
packages/core/src/template-ref-guidance-v1.mjs               # optional shared bounded guidance
packages/core/src/template-execution-harness-v1.mjs          # error enrichment + project:current only
packages/core/src/template-packs/wave1a-project-templates-v1.mjs # exact marker/region wording only
packages/mcp-server/src/discovery-menu-v1.mjs                # ref examples only
packages/mcp-server/src/openreaper-mcp-stdio.mjs              # array|keyed refs schema only
scripts/package-openreaper-alpha.mjs                         # packaged keyed/error smoke only
tests/alpha3/alpha3-2c2-ref-guidance.test.mjs                # new focused coverage
tests/layer4b/template-execution-harness.test.mjs            # bounded error/result regression
tests/layer1_5/discovery-menu.test.mjs                       # bounded discovery regression
tests/layer4d/call-template-runtime.test.mjs                 # bounded runtime regression
package.json                                                 # test/check wiring only
```

Any need to change Foundation ref kinds, descriptor ABI/schema, handler Lua,
resolver behavior, bridge request/result envelopes, tool ABI, docs/ABI,
taxonomy, C3 project-file behavior, or other architecture/process files is a
blocker and must return to the control tower.

Required C2 evidence:

- all common kind examples match handler-tested canonical semantics;
- discovery keyed examples pass the unchanged harness structural validation;
- actual stdio accepts keyed refs and still reports exactly five tools;
- missing, malformed, wrong-kind, unknown-name, array, and keyed-ref failures
  retain existing errors and add bounded repair data;
- two same-kind descriptor roles remain distinguishable by name;
- `project:current` result inference returns `scheme:current` only for that
  canonical token;
- marker/region descriptor text matches current index handler truth;
- package actual stdio smoke covers keyed refs and a repairable ref failure;
- focused Layer 4B/1.5/4D regressions, full `npm test`, package smoke, and
  `npm run build` pass.

C2 does not require REAPER because it aligns product schema, discovery,
validation guidance, and already accepted handler truth. Workers do not commit.
The control tower owns review, acceptance, ledger updates, and commits.

#### Alpha3.2-C2 Exact Legacy Regression-Test Scope Amendment

Status: approved; 2026-07-11.

The first C2 full `npm test` reached one stale regression assertion after all
focused C2, Layer 4B, Layer 1.5, Layer 4D, Tool ABI, discovery, template runtime,
and diff-hygiene checks passed. The accepted descriptor truth correction from
GUID wording to current marker/region index-number handler behavior necessarily
requires the matching historical descriptor test to change.

Additional exact write scope:

```text
tests/template-packs/wave1a-project-templates.test.mjs
```

The amendment permits only replacing marker/region GUID-wording expectations
with index-number handler truth. It does not authorize descriptor schema
changes, GUID handler implementation, Lua/resolver edits, broader fixture
rewrites, or any C2 contract expansion. After the single-file correction the
same worker must rerun the failed full gate, build, package smoke, and return for
independent review without committing.

### Alpha3.2-C2 Repairable Refs Accepted

Status: accepted.

Accepted implementation commit:

```text
1d3afa0 runtime: add repairable ref guidance
```

Accepted contract:

```text
alpha3.2.c2.ref_guidance.v1
```

C2 preserves the frozen Foundation ref kinds and structural validation while
making invalid refs repairable. Every covered `TEMPLATE_REFS_INVALID` path keeps
ordinary legacy `details.errors` strings unchanged and adds bounded descriptor
roles, missing roles, accepted array/keyed forms, complete handler-truth object
examples, placeholder replacement fields/sources, and a retry action. Error
projection is capped at 16 errors and 512 Unicode characters / 512 UTF-8 bytes
per error, with explicit truncation metadata; a 5,000-unknown-key pressure case
fell from roughly 310 KiB before the control-tower finding to roughly 3 KiB.

Discovery now emits descriptor-keyed object refs and bounded sibling guidance.
GUID/path examples are explicitly structural placeholders rather than live-
resolved objects, identify `ref` and `identity.value` as synchronized
replacement fields, and recommend resolver/query/create/list results or a real
absolute path. `project:current` is explicitly a no-replacement current-project
literal. The stdio schema exposes both object-ref arrays and the already
accepted descriptor-keyed harness form.

Canonical examples follow existing handler truth: project current/current;
track, item, and take GUID with positional index fallback; owner-qualified
track/take FX; marker/region REAPER index_number; and absolute file path. The
exact `project:current` string inference now produces `scheme:current` without
broad alias changes. Marker/region descriptor wording and its historical test
now state index-number truth; no GUID handler, Lua, resolver, descriptor schema,
Foundation ABI, or bridge envelope changed.

The MCP surface remains exactly five tools. No `resolve_ref`, `make_ref`, raw
request, Lua/action/shell/UI path, recipe executor, or hidden executor was added.

Review history:

- the first full gate exposed one stale GUID-wording test outside the initial
  write list; the control tower approved only that exact regression path at
  `2c42fc3`;
- control-tower review rejected an unbounded `details.errors` projection after
  reproducing a roughly 310 KiB response from 5,000 unknown keys; count/UTF-8
  caps and pressure tests closed it;
- independent review then rejected two P2 issues: malformed array refs consumed
  required roles in `missing_refs`, and normal discovery lacked per-role
  placeholder truth; both were fixed without changing validation semantics;
- final independent re-review returned PASS with P0-P3 all zero.

Control-tower gates passed:

```text
git diff --check
node --check packages/core/src/template-ref-guidance-v1.mjs
node --check packages/core/src/template-execution-harness-v1.mjs
node --check packages/mcp-server/src/discovery-menu-v1.mjs
node --check packages/mcp-server/src/openreaper-mcp-stdio.mjs
npm run check:alpha3-2c2                                      # 8/8
Layer 4B + Layer 1.5 + Layer 4D + Wave 1A descriptor tests   # 49/49
npm run check:tool-abi                                        # exact 5
npm run check:discovery-menu
npm run check:template-runtime
npm test
npm run build
```

Control-tower evidence:

```text
/tmp/openreaper-alpha32c2-ct-final-20260711T060729Z
```

Fresh package smoke passed without `--skip-smoke` and used the packaged actual
stdio server for omitted context, descriptor-keyed `template.tracks.rename_track`,
and repairable missing-ref failure:

```text
/tmp/openreaper-alpha32c2-ct-package-20260711T061132Z/OpenReaper-alpha
/tmp/openreaper-alpha32c2-ct-final-20260711T060729Z/package.log
```

The package audit left no fake child, request, result, or probe residue. No
REAPER process was started; C2 is schema, discovery, harness guidance, static
handler-truth, and packaged file-bridge evidence, not new live REAPER evidence.

Next gate: Alpha3.2-C3A current project path and dirty-state read templates. It
requires a separately opened bridge/handler/template lower-layer window and a
bounded read-only live smoke against the authorized disposable project before
C3B save-current or C3C save-as may begin.

### Alpha3.2-C3A Current Project Path / Dirty-State Read Window

Status: reopened_for_fix; C3B save-current, C3C save-as, and
`macro.project.file` runtime binding remain paused.

Control-tower decision: 2026-07-11.

Accepted dependencies:

```text
C1 context: c8ded67 / 2992126
C2 refs: 1d3afa0 / 8cfa397
```

Concrete blocker: the Alpha3.2 product guide names
`template.project.read_current_project_path` and
`template.project.read_dirty_state`, but both remain `planned_not_accepted`.
The existing broad `template.project.read_summary` happens to include a path
field but does not define unsaved-path semantics, expose `IsProjectDirty`, or
provide the separately audited project-file facts required by the active plan.

C3A contract:

```text
alpha3.2.c3a.project_file_read.v1
```

This window authorizes exactly two read-only templates:

```text
template.project.read_current_project_path
  bridge operation: query_state:project.read_current_project_path
  required output:
    project_ref: project:current
    name: bounded current project name
    path: bounded current project path, empty only for an unsaved project
    has_project_path: boolean
    path_state: saved_project | unsaved_project
    path_truncated: boolean

template.project.read_dirty_state
  bridge operation: query_state:project.read_dirty_state
  required output:
    project_ref: project:current
    dirty: boolean
    dirty_state: clean | dirty
    raw_dirty_state: non-negative integer returned by IsProjectDirty
```

Required handler behavior:

- current project identity comes from `EnumProjects(-1, "")` and remains
  `project:current` with object-ref normalization handled by the accepted C2
  contract;
- an empty EnumProjects path is represented truthfully as an unsaved project,
  not as a transport/config failure and not as the working directory;
- non-empty paths are returned without canonicalizing, resolving symlinks,
  opening files, probing parent permissions, or performing filesystem writes;
- path/name projection is bounded and reports truncation explicitly. Normal
  macOS `.RPP` paths must be returned exactly;
- dirty state comes only from `IsProjectDirty(current_project)`. Missing API,
  protected-call failure, or non-numeric/negative/non-integer results fail with
  a bounded typed REAPER-runtime error rather than silently reporting clean;
- both handlers are read-risk, no-undo, no-artifact, no-idempotency-key actions
  and must not call save, save-as, action, shell, UI, render, or mutation APIs;
- no existing `read_summary` semantics are silently changed in this slice.

Catalog/runtime posture:

- add the two descriptors to the accepted official catalog under the frozen
  `project` pack; update exact catalog/bridge counts and tests truthfully;
- add a dedicated C3A live group and an explicit current-product live allowlist
  that composes the historical Alpha2 graduated group plus only these two C3A
  ids. Do not relabel the new ids as Alpha2 evidence;
- installed/packaged stdio may expose the composed current-product group, while
  route-specific tests retain exact group validation;
- update Alpha3.2-A project-file posture so the two reads are accepted and the
  two writes remain `planned_not_accepted`; `macro.project.file` remains held
  and no save/new/save-as wording may become executable.

Approved tracked write scope:

```text
packages/core/src/template-packs/wave1a-project-templates-v1.mjs
packages/core/src/template-catalog-fixtures-v1.mjs             # only if explicit fixture wiring is needed
packages/mcp-server/src/call-template-runtime-v1.mjs
packages/mcp-server/src/openreaper-mcp-stdio.mjs
packages/mcp-server/src/alpha3-2a-agent-context-macro-guide-v1.mjs
reaper/bridge/src/handlers/project/read_file_state.lua         # new, two read exports only
reaper/bridge/src/handlers/core/read_template_catalog_summary.lua # exact count truth only
reaper/bridge/src/40-route-pack-handlers.lua
reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json
reaper/bridge/registry/BRIDGE_ROUTE_METADATA_V1.json           # generated
reaper/bridge/openreaper-live-bridge.lua                       # generated
scripts/build-live-bridge.mjs                                  # C3A route registration only
scripts/package-openreaper-alpha.mjs                           # packaged actual-stdio smoke only
scripts/smoke-template-runtime-live.mjs                        # optional exact C3A fake/live route
scripts/smoke-alpha3-2c3a-project-file-read.mjs                # optional dedicated bounded runner
package.json                                                   # checks only
tests/alpha3/alpha3-2c3a-project-file-read.test.mjs            # new focused tests
tests/alpha3/alpha3-2a-agent-context-macro-guide.test.mjs      # exact posture correction
tests/template-packs/wave1a-project-templates.test.mjs
tests/layer4d/call-template-runtime.test.mjs
tests/layer4d2/openreaper-live-bridge.test.mjs
tests/layer4dx/read-handler-expansion.test.mjs
tests/layer4dx/alpha3-2c3a-project-file-read-handler.test.mjs  # optional dedicated route test
tests/layer4dr/bridge-handler-registry.test.mjs                # exact registry/count regression only
```

Any need to change Tool ABI, Foundation/Template/Discovery ABI docs, ref kinds,
pack taxonomy, save/new/save-as behavior, raw action/Lua/shell/UI product
surface, unrelated handlers, or architecture/process files is a blocker and
must return to the control tower.

Required static/package evidence:

- descriptors validate and exact discovery exposes both accepted reads;
- fake harness proves saved-path, unsaved-path, clean, dirty, and typed API/
  malformed-result failures without mutation;
- generated bridge and registry contain exactly the two C3A operation rows,
  correct handler exports, read risk, no artifacts, and no write route;
- current-product stdio allows both templates without weakening exact live-group
  validation or the five-tool boundary;
- Alpha3.2-A reports the two reads accepted and both writes held;
- package actual stdio/fake file bridge calls both reads with omitted context;
- focused tests, bridge build/checks, full `npm test`, package smoke, and
  `npm run build` pass.

Required live evidence uses the standing user authorization for:

```text
/Users/Zhuanz/Untitled/Untitled.RPP
```

The control tower may start/stop/restart REAPER through the accepted
`openreaper-start` path and run the registered bridge Action operationally. Use
a fresh evidence root, candidate package/runtime, and exact MCP calls for both
C3A templates. Record observed project path/name/path_state and dirty/raw state;
main-project SHA256/mtime before and after; any automatic backup or `.DS_Store`
side effect; request/result cleanup; bridge owner/generation; and immediate plus
delayed REAPER/process cleanup. The C3A calls themselves must be read-only. Do
not save, save-as, render, or claim broader project-file support.

Workers do not commit. The control tower owns review, live smoke, acceptance,
ledger updates, and commits.

#### Alpha3.2-C3A Recipe-Contract Count Truth Amendment

Status: approved and applied by the control tower; 2026-07-11.

The C3A candidate adds two accepted Wave1A project descriptors, increasing the
accepted official catalog from 216 to 218 while preserving the historical
Alpha2 live-graduated count at 213. The dynamic Recipe Contract gate correctly
rejected the stale literal `216 templates total` in the frozen ABI document.

Exact architecture write scope:

```text
docs/abi/RECIPE_CONTRACT_V1.md
```

Only the accepted dependency-count literal may change from 216 to 218. This
amendment does not change recipe shape, dependency rules, lifecycle, execution,
Tool ABI, accepted catalog composition, or any other ABI semantics. The C3A
worker remains forbidden from editing architecture files and must resume only
after this control-tower correction is committed.

#### Alpha3.2-C3A Current Project Path / Dirty-State Read Acceptance

Status: accepted; 2026-07-11.

Accepted implementation commit:

```text
ab0cfb9 runtime: add live-smoked project file reads
```

Accepted contract:

```text
alpha3.2.c3a.project_file_read.v1
```

C3A adds exactly two read-only project templates:

```text
template.project.read_current_project_path
template.project.read_dirty_state
```

The accepted official catalog is 218 templates; the historical Alpha2 live
fixture remains 213; the exact C3A group is 2; and the composed current-product
live allowlist is 215. The MCP surface remains exactly five tools. Save-current,
save-as, new-project, and `macro.project.file` execution remain unproven and
were not opened by this acceptance.

Independent final review returned PASS with P0-P3 all zero. Control-tower gates
passed after live promotion and bounded late-result settle hardening:

```text
npm run check:alpha3-2c3a                                  # 12/12
npm run build:live-bridge -- --check
npm test
npm run build
fresh npm package smoke without --skip-smoke
```

Final static/package evidence:

```text
/tmp/openreaper-alpha32c3a-ct-final-20260711T082024Z
/tmp/openreaper-alpha32c3a-ct-final-package-20260711T082419Z/OpenReaper-alpha
```

The package smoke used packaged actual stdio with omitted context and verified
both complete summaries, canonical `project:current` refs, no artifacts/jobs,
and the exact five-tool surface.

Authorized live evidence:

```text
/tmp/openreaper-alpha32c3a-live-20260711T081207Z
/Users/Zhuanz/Untitled/Untitled.RPP
```

Observed path state was `saved_project` with exact path
`/Users/Zhuanz/Untitled/Untitled.RPP`, name `Untitled.RPP`, no truncation, and
canonical current-project identity. Observed dirty state was `clean`, `dirty:
false`, and raw state `0`. The main RPP remained byte-for-byte and metadata
stable at SHA256
`ad67bf20622b3afb449082653564e0d7fc6d12623e306d0fac3b3ef93f478f37`,
size 2287, and mtime_ns 1783523293134876339 before and after. No new backup,
`.DS_Store` mutation, render, or artifact occurred.

The candidate bridge used owner `openreaper-alpha32c3a`, generation 1. REAPER
was quit through the app menu with no prompt; immediate and delayed REAPER
process audits and candidate MCP process audit were zero. One pre-existing
`~/.openreaper/current` MCP process was observed and left untouched.

Live disclosure: after the runner's initial exact-owned cleanup, the REAPER
defer loop late-wrote two results for the same owned request ids with
`REQUEST_INVALID` / `reason=open_failed`. After REAPER exit the control tower
validated exact ids, contract, owner, and generation; removed only those two
owned result files; and confirmed stable empty request/result directories. The
runner was then hardened with bounded settle/re-clean coverage. This disclosure
does not expand C3A claims beyond the two accepted reads.

Next gate: combined Alpha3.2-C3B save-current and C3C save-as implementation,
with separate safety assertions but one final review, one full static/package
gate, and one combined authorized REAPER live acceptance.

### Alpha3.2-C3B+C3C Combined Project Save Window

Status: reopened_for_fix; implementation worker active; 2026-07-11.

Accepted dependencies:

```text
C1 context: c8ded67 / 2992126
C2 refs: 1d3afa0 / 8cfa397
C3A reads: ab0cfb9 / 4a0a5d4
```

Control-tower acceleration decision: C3B save-current and C3C save-as share one
implementation window, one final independent review, one full static/package
gate, and one combined authorized REAPER live run. Their safety assertions and
claims remain separately auditable. Focused fixes do not repeat full gates.

Authorized templates:

```text
template.project.save_current_project
template.project.save_project_as
```

Save-current must reject an unsaved current project without opening UI, call the
direct `Main_SaveProject(project,false)` API, preserve the exact current path,
and verify a clean post-save dirty state. Save-as must use a direct audited
REAPER API only, accept a strictly preflighted absolute `.RPP` target, reject
unsafe/symlink/non-directory/non-writable/implicit-overwrite cases, and verify
the exact post-save path plus clean dirty state. Neither route may add raw Lua,
action-id, shell, UI, filesystem cleanup, source-media deletion, hardware I/O,
or a sixth MCP tool.

The implementation worker may change only the exact project template/runtime,
project bridge handler/registry/generated bridge, package/smoke, and related
focused test paths named in its control-tower prompt. It may not edit docs,
architecture/process files, unrelated handlers, or frozen ABI/taxonomy. It does
not commit and does not run final live acceptance.

Catalog truth must preserve historical Alpha2 at 213 and exact C3A at 2. Any
new accepted/current-product count must follow actual descriptor composition;
any frozen ABI literal mismatch is a control-tower blocker, not a worker edit.
Before combined live evidence, the new write routes must not be labeled
`live_smoked`. `macro.project.file` and new-project execution remain held.

Final combined live uses the standing disposable fixture authorization:

```text
/Users/Zhuanz/Untitled/Untitled.RPP
```

The run must use a fresh evidence root and candidate package/runtime. It will
exercise save-current and save-as to a fresh evidence-owned `.RPP` target,
record source and target hashes/mtime/type, overwrite and backup posture,
current-project path/dirty readback, bridge owner/generation, exact-owned
transport cleanup including bounded late-result settle, and immediate/delayed
REAPER plus candidate MCP exit. It must plainly report the final disposable
fixture state and must not delete recovery evidence.

After both writes pass, the control tower may open the small
`macro.project.file` wrapper binding as the final C implementation slice; the
macro remains held until that separate binding and evidence are accepted.

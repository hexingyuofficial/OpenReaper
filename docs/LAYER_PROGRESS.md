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

## Wave 3A: Critical Descriptor-Only Pass

Status: planned

Scope target: add only the most critical descriptor-only trial set for `core`
and `system` before Layer 4D.

Required coverage:

- implement only the small approved Wave 3A route-board ids;
- keep `core` focused on OpenReaper/catalog/last-result visibility;
- keep `system` focused on runtime environment, resource paths, and API symbol
  visibility;
- defer `ui` entirely for now;
- defer `hardware_control` entirely for now;
- keep video as non-pack work; video-related atoms stay under `media`, `fx`,
  `items`, or `render` by primary owner if needed later;
- add pack-local descriptor/catalog/fake harness tests;
- extend combined catalog smoke so Wave 1A, Wave 2A, and Wave 3A critical
  descriptors validate together.

Out of scope: runtime Lua, live REAPER startup, live smoke, `call_template`
runtime binding, recipes, user recipe authoring, destructive templates,
all `ui` templates, all `hardware_control` templates, hardware writes, hardware
endpoint mutation, arbitrary UI automation, generic action execution,
video-specific product work, new ref kinds, user docs, and frozen ABI changes
unless a concrete blocker is reported.

Next gate after acceptance: Layer 4D Template Runtime Binding / Unified Live
Smoke Gate.

## Layer 4D: Template Runtime Binding / Live Smoke Gate

Status: planned

Scope target: bind the accepted official template catalog to the agent-facing
`call_template` execution path without adding MCP tools or changing frozen ABI
surfaces, and add a unified opt-in live smoke gate after Wave 3A descriptor-only
work is accepted.

Required coverage:

- resolve accepted official template ids from the catalog;
- reject unknown, blocked, and non-catalog template ids with typed errors;
- route input/ref/context validation through the Layer 4B execution harness;
- keep `call_template` as the only direct template execution entry point;
- keep discovery/menu compact and unchanged;
- run fake runtime smoke over the accepted official catalog;
- provide live smoke commands or scripts that are opt-in and do not start
  REAPER by default.

Out of scope: recipes, user recipe authoring, blocked templates, runtime Lua
expansion, broad live REAPER coverage, user docs, and frozen ABI changes unless
a concrete blocker is reported.

Next gate after acceptance: Layer 5 Recipe Contract v1.

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

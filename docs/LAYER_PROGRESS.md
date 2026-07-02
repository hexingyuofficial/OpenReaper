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

Status: planned

Accepted commit: none yet.

Scope target: freeze how templates are described, validated, implemented,
tested, smoked, and connected to the frozen foundation/bridge ABI inside the
fixed pack taxonomy.

Legacy migrated: no.

Next gate: Layer 5 Recipe Contract v1.

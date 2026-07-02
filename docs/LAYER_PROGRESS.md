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

Status: planned

Accepted commit: none yet.

Scope target: freeze the foundation/bridge ABI for template execution,
including envelopes, refs, errors, undo, verification, artifacts, budget,
idempotency, timeout, queue, bridge owner/generation, and fake bridge contract
smoke.

Legacy migrated: no.

Next gate: Layer 3 Pack Taxonomy v1.

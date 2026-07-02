# Discovery / Menu Contract v1

Status: target for the Layer 1.5 Discovery / Menu Contract gate.

## Purpose

Layer 1 froze the five MCP tool names. Layer 1.5 freezes how agents discover
templates and recipes through `list_templates` and `list_recipes`.

These tools are long-term discovery/menu tools. They must not become full
catalog dumps as OpenReaper grows.

## Contract To Freeze

Layer 1.5 must define the exact request and response shape for:

- compact default menus,
- exact expansion by `ids`,
- detail selection by `fields`,
- filters including `query`, `tags`, `pack`, `lifecycle`, `risk`, and
  `entity_kind`,
- stable pagination using `limit` and `cursor`, or a reserved compatible
  pagination envelope.

## Required Behavior

`list_templates()` defaults to compact template summaries. It does not return
full schemas, examples, implementation details, or expected deltas unless the
agent asks for them.

`list_recipes()` defaults to compact recipe summaries. It does not return full
steps, assertions, recovery branches, or long examples unless the agent asks for
them.

Full template descriptors and full recipe steps are on-demand reads, not the
default discovery path.

Simple atomic tasks may call a template directly after discovery. Complex tasks
should be recipe-first, or explicitly say that they are doing ad-hoc primitive
composition.

## Tests Required

Layer 1.5 must include synthetic large-catalog tests proving that default
discovery remains bounded as the number of templates and recipes grows.

It must also test that requested details are returned only for selected ids and
fields.

## Non-Goals

Layer 1.5 must not implement the bridge, migrate REAPER packs, create template
runtime behavior, or create official recipe workflows.

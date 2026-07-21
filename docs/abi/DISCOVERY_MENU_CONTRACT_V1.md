# Discovery / Menu Contract v1

Status: frozen by the Layer 1.5 Discovery / Menu Contract gate.

## Purpose

Layer 1 now freezes six MCP tool names after the bounded Alpha3.4-E2 reopen.
Layer 1.5 freezes how agents discover templates and recipes through
`list_templates` and `list_recipes`.

These tools are long-term discovery/menu tools. They are menus, not full catalog
dumps. Their default responses must stay compact as packs, templates, and
recipes grow.

## Request Shape

`list_templates` and `list_recipes` accept the same request envelope:

```json
{
  "ids": ["optional.exact.id"],
  "fields": ["optional_field_name"],
  "query": "optional text",
  "tags": ["optional_tag"],
  "pack": "optional_pack_or_array",
  "lifecycle": "optional_lifecycle_or_array",
  "risk": "optional_risk_or_array",
  "entity_kind": "optional_entity_kind_or_array",
  "limit": 25,
  "cursor": "optional opaque cursor"
}
```

All properties are optional. An omitted request is equivalent to `{}`.

`ids` switches the call into exact expansion mode. Exact expansion returns
known items in the requested id order and reports unknown ids in `missing_ids`.
Exact expansion is not paginated.

`fields` selects response fields. `id` is always returned, even when omitted
from `fields`.

Broad filters are `query`, `tags`, `pack`, `lifecycle`, `risk`, and
`entity_kind`. `query` is a case-insensitive text match over compact metadata.
`tags` uses all-of matching. The other filters accept either one value or an
array and use any-of matching.

`limit` and `cursor` are the stable pagination interface for menu mode.
`limit` defaults to `25` and is capped by the implementation. `cursor` is
opaque to agents.

## Response Shape

Both tools return this envelope:

```json
{
  "contract": "discovery.menu.v1",
  "kind": "template_menu",
  "mode": "menu",
  "items": [],
  "page": {
    "limit": 25,
    "cursor": null,
    "next_cursor": null,
    "has_more": false
  },
  "applied": {
    "ids": [],
    "fields": [],
    "filters": {}
  },
  "missing_ids": []
}
```

For `list_templates`, `kind` is `"template_menu"` (`"kind": "template_menu"`).

For `list_recipes`, `kind` is `"recipe_menu"` (`"kind": "recipe_menu"`).

The envelope deliberately does not include full catalog totals. Agents should
follow `page.next_cursor` while `page.has_more` is true.

## Default Template Menu

`list_templates()` defaults to compact template summaries with these fields:

```text
id
title
summary
pack
lifecycle
risk
entity_kind
tags
workflow_card
```

`workflow_card` is compact A2-F0.3 procedure metadata. It is not itself a recipe
executor. Alpha3.4-E2 adds exactly one sixth tool named `call_recipe` for saved
executable revisions; `workflow_card` remains discovery metadata only.

The default template menu must not include full `inputSchema`, `outputSchema`,
`examples`, or `expectedDelta`. The default recipe menu must not include full
`steps`, `assertions`, or `recovery`.

Template menu calls may explicitly request these compact derived menu fields:

```text
capability_group
task_intents
support
capability_truth
```

These fields are derived from compact metadata only. They do not expose full
schemas, full refs, bridge operation payloads, full examples, expected deltas,
live matrix rows, or new support claims.

`capability_truth` is the A2-F0.1 compact truth projection:

```text
id
kind
domain
route_group
exists_in_catalog
live_runnable_now
evidence_level
support_state
known_blocker
requires_refs
required_ref_kinds
allowed_live_group
example_call_shape
output_summary_shape
```

A2-F0 runtime-facing template discovery includes `capability_truth` in the
default agent menu and in exact template id expansion, even when `fields` omits
it. The compact menu projection reports truth/status fields only; exact
expansion may also include runnable call shape, required ref kinds, context
shape, output summary shape, and known live blockers without requesting full
schemas. `live_runnable_now` is true only when the current runtime has an
explicit live executor configured and the id is in that configured allowed live
group. Candidate, draft, unsupported, and not-currently-live entries must
remain visible but must not be presented as live-runnable.

Template detail fields are:

```text
inputSchema
outputSchema
examples
expectedDelta
```

Template detail fields require exact expansion by `ids`.

## Default Recipe Menu

`list_recipes()` defaults to compact recipe summaries with these fields:

```text
id
title
summary
pack
lifecycle
risk
entity_kind
tags
```

The default recipe menu must not include full `steps`, `assertions`, or
`recovery`.

Recipe menu calls may explicitly request the same compact derived menu fields:

```text
capability_group
task_intents
support
capability_truth
```

These fields are derived from compact metadata only. They do not expose steps,
assertions, recovery branches, or new support claims.
For historical agent-stepped recipes, `capability_truth` may still report
agent-stepped execution. For saved validated executable revisions, discovery may
report executable truth through public `call_recipe` without dumping full child
envelopes into ordinary menu rows. An exact saved-revision expansion must give a
complete executable example containing `recipe_id`, `version`, numeric
`revision`, `content_hash`, `validation_result_id`, and `inputs`; fuzzy
recipe-id-only run examples are forbidden.

Recipe detail fields are:

```text
steps
assertions
recovery
```

Recipe detail fields require exact expansion by `ids`.

## Agent Use Rules

Simple atomic tasks may directly call a template after discovery.

Complex tasks must be recipe-first. If no recipe fits, the agent must explicitly
say it is using ad-hoc primitive composition before calling multiple templates
as a workflow.

Historical agent-stepped recipes are not hidden executors; agents may still
execute their declared steps through `call_template` and `get_state`. Saved
validated executable revisions run through public `call_recipe` only. Evidence
paging uses `call_recipe` operation `get` with an identity-bound `evidence_ref`;
there is no separate public evidence operation.

## Tests Required

Layer 1.5 must include synthetic large-catalog tests proving that default
discovery remains bounded by menu pagination and compact fields, not by hidden
full descriptors or recipe bodies.

It must also test exact id expansion, field selection, filters, pagination
shape, and that detail fields are returned only for selected ids and fields.

## Non-Goals

Layer 1.5 must not implement the bridge, migrate REAPER packs, create template
runtime behavior, create official recipe workflows beyond discovery, or change
pack taxonomy. Alpha3.4-E2 separately adds exactly one sixth tool named
`call_recipe` outside this Layer 1.5 implementation surface.

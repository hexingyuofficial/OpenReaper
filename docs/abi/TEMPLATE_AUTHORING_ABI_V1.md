# Template Authoring ABI v1

Status: target for the Layer 4 Template Authoring ABI v1 gate.

## Purpose

Layer 4 freezes how OpenReaper templates are described, validated, executed,
tested, smoked, and exposed through discovery.

Templates are verified action atoms. They are not recipes, workflow products,
or hidden agent executors.

## Layer 4 Phases

Layer 4 should proceed in order:

```text
4A. Template Descriptor Contract
4B. Template Execution Harness
4C. Template Catalog / Smoke Gate
```

Each phase returns to the control tower for review before the next phase starts.
If a phase discovers a lower-layer blocker, it stops and reports the blocker.

Layer 4A freezes only the descriptor contract below. Layer 4B owns execution
harness construction. Layer 4C owns catalog integration and smoke gates.

## Contract To Freeze

Layer 4 must freeze:

- template descriptor shape,
- template id, pack, lifecycle, risk, entity_kind, and tags,
- input and output schemas,
- ref and artifact declarations,
- expected delta and verification declarations,
- bridge operation request construction,
- result and typed error mapping,
- catalog exposure through the Layer 1.5 discovery/menu contract,
- required unit, contract, and smoke tests.

## Pressure Fixtures

Layer 4 must include template pressure fixtures that prove the ABI can express:

- read-only state templates,
- simple write templates,
- destructive write templates,
- artifact-producing templates,
- analysis jobs,
- render jobs,
- action-backed templates,
- cross-domain templates with one primary pack owner,
- verification-required templates,
- idempotent mutation templates,
- ref-heavy templates,
- compact discovery with on-demand full descriptors.

These fixtures are ABI pressure tests, not the official template library.

## 4A Descriptor Contract

Status: frozen by the Layer 4A gate.

The descriptor contract id is:

```json
{
  "contract": "template.descriptor.v1"
}
```

Layer 4A freezes static descriptor shape and validation. A descriptor is data
only. 4A does not implement `call_template` runtime, bridge dispatch, fake
bridge execution, template execution harnesses, a real template library,
official recipes, user recipe authoring, or legacy template migration.

### Descriptor Identity

Template ids use this grammar:

```text
template.<pack>.<lower_snake_segments>
```

Validation regex:

```text
^template\.([a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*){1,4}$
```

The `<pack>` segment must exactly match the descriptor `pack` field.

Title budget: `title` is a non-blank string with at most 80 characters.

Summary budget: `summary` is a non-blank string with at most 240 characters.

Descriptor budget: the full JSON descriptor must serialize to at most 16384
bytes.

### Pack Ownership

`pack` is the primary owner domain from the frozen Layer 3 pack taxonomy. It
must be exactly one of:

```text
core
project
transport
tracks
items
media
analysis
midi
fx
routing
automation
render
actions
ui
system
hardware_control
```

Workflow-shaped names are forbidden as pack ids or template `pack` metadata:

```text
loop
cleanup
delivery
layer
music_sketch
```

Cross-domain descriptors still choose exactly one primary pack owner. Other
domains may appear only as refs, artifacts, examples, or expected-delta
entities.

### Canonical Metadata Values

Lifecycle values:

```text
draft
experimental
stable
deprecated
```

Risk values:

```text
read
safe
write
destructive
```

`entity_kind` values use lower snake-case or dotted lower snake-case:

```text
^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$
```

Tags use lower snake-case:

```text
^[a-z][a-z0-9_]*$
```

Tags may include workflow-shaped words only as tags. They never grant pack
identity.

### Discovery Summary Fields

Default template discovery summaries expose exactly the frozen Layer 1.5
summary fields:

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

Default summaries must not include `inputSchema`, `outputSchema`, `examples`,
`expectedDelta`, `bridge`, `refs`, `artifacts`, or `verification`.

Detail fields remain on demand and must match the Layer 1.5 template detail
field names:

```text
inputSchema
outputSchema
examples
expectedDelta
```

### Full Descriptor Fields

The full descriptor fields are:

```text
contract
id
title
summary
pack
lifecycle
risk
entity_kind
tags
bridge
inputSchema
outputSchema
refs
artifacts
expectedDelta
verification
examples
pressureFixture
```

`pressureFixture` is optional and exists only for ABI pressure tests. The other
fields are required. Unknown top-level fields fail validation.

### Bridge Operation Declaration

`bridge` declares the bridge operation family and request-construction metadata
that Layer 4B will consume:

```json
{
  "operation_family": "run_command",
  "operation_name": "template.execute",
  "capability": "track.create",
  "idempotency": "supported",
  "timeout_ms": 5000
}
```

`operation_family` must be one of the frozen Layer 2 operation families:

```text
query_state
run_command
run_action
run_job
artifact_metadata
```

`operation_name` and `capability` use dotted lower-snake grammar, such as
`template.execute` or `track.create`.

`idempotency` values:

```text
none
supported
required
```

`query_state` and `artifact_metadata` descriptors must declare idempotency as
`none`.

### Input Schema Shape

`inputSchema` is a compact JSON-object schema:

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

The schema object requires exactly those four fields. Property names use
lower-snake grammar. Each property must declare at least one of `type`, `enum`,
`const`, or `oneOf`. `additionalProperties` must be `false`.

### Output Schema Shape

`outputSchema` uses the same compact JSON-object schema shape as `inputSchema`.
Output schemas describe the bounded result summary, refs, job refs, and artifact
metadata returned by a future execution harness. Large payloads must be
represented through artifact refs, not inline schema examples.

### Refs Declaration

`refs` declares typed object refs consumed or produced by the template:

```json
{
  "input": [
    {
      "name": "track_ref",
      "kind": "track",
      "required": true,
      "summary": "Track ref consumed by the template."
    }
  ],
  "output": []
}
```

`kind` must be a frozen Layer 2 object ref kind:

```text
project
track
item
take
fx
send
envelope
marker
region
file
job
artifact
```

### Artifacts Declaration

`artifacts` declares artifact metadata use:

```json
{
  "mode": "produces",
  "input": [],
  "output": [
    {
      "name": "loudness_report",
      "schema": "analysis.loudness_report.v1",
      "owner_pack": "analysis",
      "summary": "Loudness report artifact."
    }
  ]
}
```

Artifact modes:

```text
none
metadata
produces
```

`mode: none` must not declare artifact inputs or outputs. `mode: produces`
must declare at least one output artifact. Artifact `owner_pack` must be a
fixed Layer 3 pack id.

### Expected Delta Declaration

`expectedDelta` declares the intended bounded state/result effect:

```json
{
  "kind": "mutation",
  "summary": "One track is created.",
  "entities": [
    {
      "entity_kind": "track",
      "action": "create",
      "summary": "Track appears in compact project state."
    }
  ],
  "idempotent": false
}
```

Expected delta kinds:

```text
none
read
mutation
job
artifact
```

Expected delta entity actions:

```text
read
create
update
delete
emit
start_job
```

Read-risk descriptors must not declare mutating expected deltas.
Write/destructive descriptors must declare `mutation` or `job`.

### Verification Declaration

`verification` declares static verification requirements:

```json
{
  "mode": "required",
  "checks": [
    {
      "name": "track_exists",
      "kind": "state_delta",
      "summary": "A track ref exists after mutation."
    }
  ]
}
```

Verification modes:

```text
none
optional
required
```

Write and destructive descriptors must use `verification.mode: required` and
must include at least one check. `verification.mode: none` must not include
checks.

### Examples Declaration

`examples` is an array of compact descriptor examples:

```json
[
  {
    "name": "create_named_track",
    "summary": "Create a track named Dialog.",
    "input": {
      "name": "Dialog"
    }
  }
]
```

Examples are static fixtures for authoring and validation. They are not user
recipes and do not run in 4A.

### Descriptor Size And Budget Rules

Static descriptor validation enforces these budgets:

```text
id_max_chars: 96
title_max_chars: 80
summary_max_chars: 240
tag_max_count: 12
tag_max_chars: 32
refs_max_count: 16
artifacts_max_count: 8
examples_max_count: 3
example_max_bytes: 1024
schema_max_bytes: 4096
expected_delta_max_bytes: 2048
descriptor_max_bytes: 16384
discovery_summary_max_bytes: 1024
verification_checks_max_count: 8
timeout_ms_max: 600000
```

Oversized summaries, examples, schemas, expected deltas, discovery summaries,
or full descriptors fail static validation before any runtime work exists.

### Pressure Fixture Metadata

`pressureFixture` is optional metadata used by 4A tests:

```json
{
  "categories": ["simple_write"],
  "notes": "ABI pressure fixture only; not an official template."
}
```

Pressure fixture categories:

```text
read_only_state
simple_write
destructive_write
artifact_producing
analysis_job
render_job
action_backed
cross_domain_primary_owner
verification_required
idempotent_mutation
ref_heavy
compact_discovery_full_descriptor_split
```

These pressure fixtures prove descriptor expressiveness only. They do not
create official template library entries.

## Non-Goals

Layer 4 must not change the frozen Tool ABI, Discovery/Menu contract,
Foundation/Bridge ABI, or Pack Taxonomy.

Layer 4 must not build the full template library, create official recipes,
open user recipe authoring, or migrate legacy workflow-shaped packs.

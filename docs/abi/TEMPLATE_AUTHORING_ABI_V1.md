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

## 4B Execution Harness Contract

Status: frozen by the Layer 4B gate.

The template execution harness contract id is:

```json
{
  "contract": "template.execution.v1"
}
```

Layer 4B freezes the harness that consumes a 4A
`template.descriptor.v1`, validated template input, execution context, and
typed refs, then constructs one legal Layer 2 `foundation.bridge.v1` request.
4B does not implement the real `call_template` MCP runtime, a template
catalog, live REAPER startup, recipes, or legacy migration.

### Bridge Request Construction

The harness maps descriptor metadata into the bridge request as follows:

```text
descriptor.bridge.operation_family -> operation.family
descriptor.bridge.operation_name   -> operation.name
descriptor.pack                    -> pack.id
descriptor.bridge.capability       -> pack.capability
descriptor.risk                    -> pack.risk
descriptor.bridge.timeout_ms       -> timeout_ms
descriptor.verification            -> verification
descriptor.artifacts.mode          -> artifacts.allow
execution refs                     -> refs
validated template input           -> params
execution budget                   -> budget
execution context                  -> client and expected bridge owner/generation
```

The harness must normalize the constructed request through the frozen
Foundation / Bridge ABI before dispatch. It must not add bridge operation
families, pack ids, typed errors, or new MCP tools.

### Execution Context

The context supplies:

```json
{
  "client_id": "openreaper-mcp",
  "session_id": "session-id",
  "expected_owner": "owner-token",
  "expected_generation": 1,
  "created_at": "2026-07-02T00:00:00.000Z",
  "request_sequence": 1
}
```

`client_id` defaults to `openreaper-mcp`. `session_id`,
`expected_owner`, and `expected_generation` are required. Request ids use the
stable shape:

```text
cmd_<17 UTC timestamp digits>_<3 digit sequence>_<6 hex fingerprint>
```

The fingerprint is deterministic for the descriptor id, validated input, refs,
and idempotency key. The bridge owner and generation remain explicit expected
values on every request.

### Input Validation

The harness validates template input against the descriptor `inputSchema`
before dispatch. Validation is limited to the compact object schema frozen by
4A:

- input must be a JSON object,
- required properties must be present,
- unknown properties fail because `additionalProperties` is `false`,
- property `type`, `enum`, `const`, and `oneOf` declarations are enforced.

Invalid input returns a typed template execution error and must not reach the
bridge executor.

### Idempotency Policy

Descriptor `bridge.idempotency` fixes harness behavior:

```text
none      -> no idempotency_key is sent; a supplied key is an error
supported -> a supplied key is sent when Layer 2 allows it; omission sends no key
required  -> a supplied key is sent, otherwise the harness generates a stable key
```

The harness must not send idempotency keys for Layer 2 read/read-risk requests
where the Foundation / Bridge ABI forbids them. Required idempotency on a
bridge operation that cannot carry a key is a harness error.

### Undo Policy

Read-risk templates and read operation families (`query_state` and
`artifact_metadata`) use:

```json
{
  "mode": "none"
}
```

Non-read `run_command`, `run_action`, and `run_job` requests use required undo
with a label derived from the descriptor capability:

```json
{
  "mode": "required",
  "label": "OpenReaper: track.create",
  "flags": ["track"]
}
```

The flags are compact expected-delta entity kinds. Undo blocks are still bridge
responsibility; the harness only constructs the request policy.

### Bounded Template Result

Template execution results are bounded envelopes:

```json
{
  "contract": "template.execution.v1",
  "template": {
    "id": "template.tracks.create_track",
    "pack": "tracks",
    "risk": "write",
    "operation": {
      "family": "run_command",
      "name": "template.execute"
    },
    "capability": "track.create"
  },
  "request": {
    "id": "cmd_20260702000000000_001_abcdef",
    "created_at": "2026-07-02T00:00:00.000Z",
    "client": {
      "id": "openreaper-mcp",
      "session_id": "session-id"
    },
    "bridge": {
      "expected_owner": "owner-token",
      "expected_generation": 1
    },
    "idempotency_key": null,
    "timeout_ms": 5000
  },
  "ok": true,
  "result": {
    "summary": {},
    "refs": [],
    "artifacts": [],
    "jobs": [],
    "last_result": {
      "updated": false,
      "refs": [],
      "truncated": false
    }
  },
  "undo": {},
  "verification": {},
  "budget": {
    "max_response_bytes": 65536,
    "response_bytes": 1024,
    "truncated": false,
    "bridge_response_bytes": 512
  }
}
```

The template result must not echo full descriptors, schemas, examples, raw
params, large analysis payloads, render data, file contents, or logs. Large
outputs remain artifact, job, or object refs. If the mapped template envelope
would exceed the response budget, the harness returns a typed
`RESPONSE_TOO_LARGE` template error.

### Typed Error Mapping

Bridge errors remain typed inside the template execution envelope:

```json
{
  "contract": "template.execution.v1",
  "ok": false,
  "error": {
    "source": "bridge",
    "code": "VERIFY_FAILED",
    "message": "Verification failed.",
    "recoverable": false,
    "details": {}
  }
}
```

Harness-side validation and executor failures use `source: "harness"` and a
bounded typed code such as `TEMPLATE_INPUT_INVALID`,
`TEMPLATE_IDEMPOTENCY_INVALID`, `TEMPLATE_REFS_INVALID`,
`TEMPLATE_CONTEXT_INVALID`, `BRIDGE_RESULT_INVALID`, or
`RESPONSE_TOO_LARGE`. Errors must not be downgraded into free-text-only
responses.

### Fake Executor Requirement

4B tests use a fake bridge executor that accepts `foundation.bridge.v1`
requests and returns typed bridge envelopes. The fake executor proves request
construction, idempotency, undo, verification, bounded result mapping, and
typed error mapping without starting real REAPER.

## 4C Catalog / Smoke Gate Contract

Status: frozen by the Layer 4C gate.

The template catalog contract id is:

```json
{
  "contract": "template.catalog.v1"
}
```

Layer 4C freezes how validated 4A descriptors enter a catalog, how that catalog
connects to the Layer 1.5 discovery/menu contract, and which static and fake
execution smokes future template additions must pass.

4C does not implement the real `call_template` MCP runtime, live REAPER
startup, real Lua behavior, recipes, user recipe authoring, or legacy template
migration.

### Catalog Registry

The catalog registry consumes `template.descriptor.v1` descriptors and
normalizes each descriptor through the frozen 4A descriptor validator before
accepting it.

Catalog input is template-only:

```json
{
  "templates": []
}
```

Rules:

- every catalog descriptor must pass 4A validation,
- Duplicate template ids fail catalog validation,
- template `pack` metadata must be one of the fixed 16 Layer 3 packs,
- workflow-shaped pack metadata is rejected,
- the template id pack segment must match the descriptor `pack`,
- catalog input must not include recipes.

Workflow-shaped pack metadata remains forbidden:

```text
loop
cleanup
delivery
layer
music_sketch
```

### Discovery/Menu Integration

The catalog exposes validated descriptors as the template input to the frozen
Layer 1.5 menu helper:

```js
createDiscoveryCatalog({ templates })
```

Default template catalog discovery must use the compact Layer 1.5 summary
fields:

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

Default template catalog discovery must not expose full descriptor fields:

```text
bridge
inputSchema
outputSchema
refs
artifacts
expectedDelta
verification
examples
```

Exact id expansion and field selection remain the Layer 1.5 contract. Detail
fields are on demand only, require `ids`, and are limited to:

```text
inputSchema
outputSchema
examples
expectedDelta
```

Fields such as `bridge`, `refs`, `artifacts`, and `verification` are not menu
detail fields. They remain internal descriptor data for catalog validation,
template review, and future runtime construction.

### Seed Templates

Layer 4C may include a small official seed fixture set only to pressure the
catalog and smoke gate. Seed templates are descriptor plus fake harness smoke
fixtures; they do not create a real template library, real REAPER Lua behavior,
or official recipes.

### Fake Execution Smoke Gate

Every future catalog template addition must keep the 4C smoke categories green:

```text
catalog_load
descriptor_validation
default_discovery_bounded
exact_ids_expansion
fake_execution_read
fake_execution_write
fake_execution_job
fake_execution_artifact
fake_execution_idempotent
fake_execution_error
no_live_reaper_startup
no_legacy_migration
no_recipes
```

The fake execution smoke uses the 4B harness with an injected fake bridge
executor. It must prove representative read, write, job, artifact, idempotent,
and typed error cases without launching REAPER or calling a real MCP server.

Required checks:

```text
npm run check:template-authoring
node --test tests/layer4c/*.test.mjs
```

## Non-Goals

Layer 4 must not change the frozen Tool ABI, Discovery/Menu contract,
Foundation/Bridge ABI, or Pack Taxonomy.

Layer 4 must not build the full template library, create official recipes,
open user recipe authoring, or migrate legacy workflow-shaped packs.

# Artifact / State Store v1

Status: target for the Layer 4.5A Artifact / State Store Contract + Core
Helpers gate.

## Purpose

Layer 4.5A defines the contract and pure core helpers for JSON artifacts that
carry large, resumable, or recipe-checkpoint state outside ordinary template
results. It does not connect artifacts to live REAPER, `get_state`,
`call_template`, bridge transport, Lua runtime helpers, live smoke, MCP tools,
or Layer 6 user recipe authoring.

Artifacts are referenced by opaque refs. Agent-facing responses must carry
compact refs, metadata, and summaries; full payload reads are explicit bounded
state-store reads.

## Contract Identifier

Artifact JSON envelopes use:

```json
{
  "contract": "artifact.state_store.v1"
}
```

## Canonical Artifact Ref

Artifact refs use exactly:

```text
artifact:<owner_pack>:<scope>:<id>
```

`owner_pack` must be one of the frozen Layer 3 pack ids:

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

Workflow-shaped legacy names remain forbidden as artifact owner packs and
artifact scopes:

```text
loop
cleanup
delivery
layer
music_sketch
```

`scope` is a lower-snake artifact family id:

```text
^[a-z][a-z0-9_]*$
```

`id` uses the command-derived artifact id grammar:

```text
art_YYYYMMDDhhmmssmmm_NNN_xxxxxx
^art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$
```

The compatible command-id derivation is:

```text
cmd_YYYYMMDDhhmmssmmm_NNN_xxxxxx
  -> art_YYYYMMDDhhmmssmmm_NNN_xxxxxx
```

Refs are not paths. Raw paths, absolute paths, relative paths, traversal,
`file://` URLs, shell-expanded paths, and malformed aliases are invalid.

## Storage Path Mapping

A parsed artifact ref maps under an artifact root as:

```text
<artifact_root>/<owner_pack>/<scope>/<id>.json
```

The helper validates root containment after joining parsed segments. The raw
ref string is never concatenated as a filesystem path.

Layer 4.5A only defines this mapping. It does not create, read, write, sweep,
or delete files.

## Artifact Envelope

An artifact JSON envelope has exactly these top-level fields:

```json
{
  "contract": "artifact.state_store.v1",
  "ref": "artifact:analysis:loudness:art_20260703000000000_001_abcdef",
  "id": "art_20260703000000000_001_abcdef",
  "owner_pack": "analysis",
  "scope": "loudness",
  "schema": "analysis.loudness.v1",
  "producer": {
    "kind": "template",
    "id": "template.analysis.write_loudness_artifact",
    "pack": "analysis"
  },
  "created_at": "2026-07-03T00:00:00.000Z",
  "summary": {},
  "payload": {}
}
```

Rules:

- `ref`, `id`, `owner_pack`, and `scope` must agree.
- `schema` uses dotted lower-snake grammar with a `vN` suffix.
- `producer.kind` is `template` in v1.
- `producer.id` uses the frozen template id shape
  `template.<pack>.<lower_snake_segments>`.
- `producer.pack` must match the artifact `owner_pack`.
- `created_at` is an ISO-8601 UTC millisecond timestamp.
- `summary` and `payload` are JSON objects.
- Unknown envelope or producer fields fail validation.

## Budgets

The v1 helper enforces these static budgets:

```text
summary_max_bytes: 2048
payload_max_bytes: 65536
read_response_max_bytes: 65536
schema_max_chars: 160
producer_max_bytes: 1024
```

Summary and payload budgets are measured on encoded JSON. Non-JSON values,
cycles, BigInts, functions, symbols, and non-finite numbers are invalid.

Artifact read projections never split arbitrary JSON. If a summary or payload
view cannot fit the response budget, the helper returns/throws
`RESPONSE_TOO_LARGE` semantics instead of truncating nested payload content.

## Summary And Payload Reads

The helper-level read views are:

```text
summary
payload
```

`summary` returns artifact metadata plus `summary`.

`payload` returns artifact metadata plus `summary` and `payload`.

Both views include:

```json
{
  "view": "summary",
  "truncated": false,
  "response_bytes": 512
}
```

`truncated` is always `false` in v1. Oversized reads are errors, not partial
JSON projections.

Layer 4.5A does not implement `get_state(scope:"artifact")`; later runtime
windows may bind this contract to the existing `get_state` tool without adding
a new MCP tool.

## TTL Sweep Policy Shape

The helper defines only the policy shape:

```text
default_ttl_ms: 604800000
sweep_extension: .json
sweep_depth: 3
sweep_layout: owner_pack/scope/id.json
best_effort: true
```

Sweep candidates must be `.json` files at exactly
`owner_pack/scope/id.json` depth under the artifact root, with all path
segments validating as a canonical ref. Unexpected paths are kept. Runtime
sweeping and filesystem deletion are out of scope for Layer 4.5A.

## Last Result Policy

Artifact producers and artifact reads must not create public
`last_result:artifact:N` refs.

The v1 policy is:

```text
producers_update_last_result: false
reads_update_last_result: false
public_last_result_artifact_refs: false
forbidden_public_ref_pattern: last_result:artifact:N
```

The returned canonical artifact ref is the immediate handle. There is no public
artifact `last_result` resolver in this layer.

## Error Semantics

The helper uses the existing Foundation / Bridge typed error vocabulary:

```text
PARAMS_INVALID
ARTIFACT_NOT_FOUND
ARTIFACT_INVALID
RESPONSE_TOO_LARGE
```

Layer 4.5A does not add Foundation / Bridge error codes.

## Non-Goals

Layer 4.5A does not:

- add MCP tools;
- change Tool ABI, Discovery/Menu, Foundation/Bridge, Pack Taxonomy, Template
  Authoring, Runtime Binding, or Recipe Contract docs;
- edit `reaper/bridge/**`;
- implement REAPER Lua artifact runtime;
- implement `get_state(scope:"artifact")`;
- connect artifact reads or writes to `call_template`;
- run live smoke or update live-smoke matrices;
- add database, server, or external storage dependencies;
- import legacy `loop`, `cleanup`, `delivery`, `layer`, or `music_sketch` as
  packs;
- start or modify Layer 6.

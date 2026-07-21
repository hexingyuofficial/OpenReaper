# Foundation / Bridge ABI v1

Status: frozen by the Layer 2 Foundation / Bridge ABI v1 gate.

## Purpose

Layer 2 freezes the runtime contract between template execution and the
OpenReaper bridge. It does not migrate packs, create templates, create
recipes, or expose new MCP tools.

Agents still call only the six Tool ABI v1 tools:

```text
ping
get_state
list_templates
list_recipes
call_template
call_recipe
```

The bridge ABI is below those tools. It is a fixed kernel contract, not a
mirror of the pack taxonomy. Packs provide domain metadata, permissions, risk,
logging, and ownership boundaries. Packs do not add bridge operation families.

## Contract Identifier

Every bridge request and result carries:

```json
{
  "contract": "foundation.bridge.v1"
}
```

## Fixed Operation Families

Layer 2 freezes these bridge operation families:

```text
query_state
run_command
run_action
run_job
artifact_metadata
```

`query_state` reads bounded state projections, including bounded
`last_result` reads.

`run_command` executes a verified template/kernel command.

`run_action` runs a guarded REAPER action by action identity and policy.

`run_job` starts or advances bounded long-running work and returns a job ref.

`artifact_metadata` reads artifact metadata and summaries without dumping large
payloads.

Adding a pack must not add a new operation family. Adding a new operation
family requires a future ABI amendment.

## Request Envelope

Bridge requests use this fixed envelope:

```json
{
  "contract": "foundation.bridge.v1",
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
  "operation": {
    "family": "run_command",
    "name": "template.execute"
  },
  "pack": {
    "id": "tracks",
    "capability": "track.create",
    "risk": "write"
  },
  "params": {},
  "refs": [],
  "undo": {
    "mode": "required",
    "label": "OpenReaper: track.create",
    "flags": ["track_config"]
  },
  "verification": {
    "mode": "required",
    "checks": []
  },
  "artifacts": {
    "allow": true
  },
  "budget": {
    "max_response_bytes": 65536,
    "max_items": 50,
    "max_inline_value_bytes": 2048
  },
  "idempotency_key": "optional printable key",
  "timeout_ms": 5000
}
```

Required fields are `contract`, `id`, `created_at`, `client`, `bridge`,
`operation`, `pack`, `params`, `refs`, `undo`, `verification`, `artifacts`,
`budget`, and `timeout_ms`.

`params` is a JSON object and must be present. Operations with no parameters
must send `{}`.

`pack.id` must be one of the fixed taxonomy pack ids:

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

`pack.capability` is metadata for permission, risk, and logging. It is not a
bridge method name.

`idempotency_key` is optional. When present, it must be printable ASCII,
1-128 characters, and identify one logical mutation or job retry within the
current bridge owner/generation.

`timeout_ms` is the caller-side bridge budget for this operation. A synchronous
operation that cannot finish before the deadline returns `BRIDGE_TIMEOUT`.
Long-running work must use `run_job` and return a job ref rather than blocking
the queue indefinitely.

## Result Envelope

Bridge results use this fixed envelope:

```json
{
  "contract": "foundation.bridge.v1",
  "id": "cmd_20260702000000000_001_abcdef",
  "ok": true,
  "completed_at": "2026-07-02T00:00:00.100Z",
  "bridge": {
    "owner": "owner-token",
    "generation": 1
  },
  "queue": {
    "state": "done",
    "started_at": "2026-07-02T00:00:00.010Z",
    "completed_at": "2026-07-02T00:00:00.100Z"
  },
  "result": {
    "summary": {},
    "refs": [],
    "artifacts": [],
    "jobs": [],
    "readback": null,
    "session_ledger": null,
    "last_result": {
      "updated": false,
      "refs": [],
      "truncated": false
    }
  },
  "undo": {
    "mode": "required",
    "opened": true,
    "closed": true,
    "label": "OpenReaper: track.create"
  },
  "verification": {
    "mode": "required",
    "status": "passed",
    "checks": []
  },
  "budget": {
    "max_response_bytes": 65536,
    "response_bytes": 1024,
    "truncated": false
  },
  "idempotency": {
    "key": "optional printable key",
    "replayed": false
  }
}
```

Error results use the same envelope with `ok: false` and `error`:

```json
{
  "contract": "foundation.bridge.v1",
  "id": "cmd_20260702000000000_001_abcdef",
  "ok": false,
  "completed_at": "2026-07-02T00:00:00.100Z",
  "bridge": {
    "owner": "owner-token",
    "generation": 1
  },
  "queue": {
    "state": "done",
    "started_at": "2026-07-02T00:00:00.010Z",
    "completed_at": "2026-07-02T00:00:00.100Z"
  },
  "error": {
    "code": "VERIFY_FAILED",
    "message": "Verification failed.",
    "recoverable": false,
    "details": {}
  },
  "undo": {
    "mode": "required",
    "opened": true,
    "closed": true,
    "label": "OpenReaper: track.create"
  },
  "verification": {
    "mode": "required",
    "status": "failed",
    "checks": []
  },
  "budget": {
    "max_response_bytes": 65536,
    "response_bytes": 1024,
    "truncated": false
  },
  "idempotency": {
    "key": "optional printable key",
    "replayed": false
  }
}
```

Ordinary results must stay compact. Large JSON, analysis payloads, render
metadata, binary data, file contents, long logs, or dense per-object dumps must
be written as artifacts and represented by artifact refs and metadata.

### Canonical Result Refs

Resolver and write operations return machine-usable refs in `result.refs`.
Agents must not reconstruct refs by parsing prose summaries. A returned ref may
include compact optional fields that help disambiguate duplicate or unnamed
objects:

```json
{
  "kind": "track",
  "ref": "track:guid:{TRACK-0000}",
  "identity": {
    "scheme": "guid",
    "value": "{TRACK-0000}"
  },
  "raw": {
    "name": ""
  },
  "display": {
    "name": "Track 1",
    "number": 1
  },
  "index": 0,
  "display_number": 1,
  "selected": false
}
```

`raw.name` is the DAW/object name as read from the source. `display.name` is the
agent-safe display or fallback name. `index` is 0-based. `display_number` is the
1-based number normally shown to users. `selected` is included when available.
GUID identity is preferred when REAPER exposes it; index or name identities are
temporary resolver inputs, not preferred write targets.

### Readback

Templates that resolve, read, or mutate a target may return
`result.readback`:

```json
{
  "status": "available",
  "ref": "item:guid:{ITEM-0000}",
  "kind": "item",
  "raw_name": "",
  "display_name": "Item 1",
  "fallback_name_used": true,
  "index": 0,
  "display_number": 1,
  "selected": true
}
```

Readback distinguishes raw names from display or fallback names so duplicate or
unnamed tracks/items remain machine-usable. `status` may be `available`,
`read`, `modified`, `not_requested`, or a typed blocker-specific status.

### Session Ledger

Successful operations may return a compact `result.session_ledger`:

```json
{
  "contract": "session.ledger.v1",
  "request_id": "cmd_20260702000000000_001_abcdef",
  "operation_id": "run_command:template.execute",
  "undo_label": "OpenReaper: track.create",
  "cleanup_method": "returned_ref",
  "readback_status": "available",
  "refs": {
    "created": [],
    "modified": [],
    "artifacts": []
  },
  "blockers": []
}
```

`refs.created` contains refs for newly created objects. `refs.modified`
contains refs for existing objects modified by the operation. `refs.artifacts`
contains artifact refs. `cleanup_method` is `returned_ref` when later cleanup
can target returned refs, `not_applicable` for reads, or a typed blocker value
when cleanup cannot be safely described. `blockers` is an array of typed
blockers with stable ids, affected contract or template id, reason, and
smallest proposed follow-up when known.

### Compact Snapshot Reads

Compact snapshot templates/projections use the same result envelope and must
return bounded object maps, not large project dumps. Alpha2 static/fake base
coverage includes read-only projections for:

```text
template.tracks.list_tracks
template.items.list_selected_items
template.items.list_items_on_track
template.project.read_track_item_overview
```

These are project-state snapshots for target selection and safe readback. They
do not add a new MCP tool, live matrix claim, bridge operation family, or raw
execution surface.

## Object Refs

The bridge never exposes raw REAPER handles across the ABI. Object refs have a
fixed typed shape:

```json
{
  "kind": "track",
  "ref": "track:guid:{ABCDEF}",
  "identity": {
    "scheme": "guid",
    "value": "{ABCDEF}"
  },
  "project_ref": "project:current",
  "display": {
    "name": "Impacts"
  }
}
```

Frozen object ref kinds:

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

`kind` is the typed object domain. `ref` is an opaque, kind-prefixed stable
identifier for the caller. `identity.scheme` names how the bridge resolves the
ref, such as `current`, `guid`, `index`, `name`, `path`, `hash`, `job_id`, or
`artifact_ref`. `display` is optional compact metadata only.

The ref kind list is extensible only through a future ABI amendment. Individual
packs may add capability-specific `display` fields without changing the ref
shape.

## Typed Errors

Layer 2 freezes this typed error set:

```text
REQUEST_INVALID
OPERATION_NOT_FOUND
PACK_DISABLED
RISK_BLOCKED
PARAMS_INVALID
REF_INVALID
PROJECT_NOT_FOUND
TRACK_NOT_FOUND
ITEM_NOT_FOUND
TAKE_NOT_FOUND
FX_NOT_FOUND
FX_OWNER_NOT_FOUND
FX_SLOT_NOT_FOUND
FX_REF_NOT_FOUND
FX_PARAMETER_INVALID
FX_PARAMETER_NOT_FOUND
SEND_NOT_FOUND
ENVELOPE_NOT_FOUND
MARKER_NOT_FOUND
REGION_NOT_FOUND
FILE_NOT_FOUND
JOB_NOT_FOUND
ARTIFACT_NOT_FOUND
ARTIFACT_INVALID
ACTION_NOT_ALLOWED
COMMAND_FAILED
JOB_FAILED
VERIFY_FAILED
RESPONSE_TOO_LARGE
IDEMPOTENCY_CONFLICT
QUEUE_CONFLICT
BRIDGE_NOT_RUNNING
BRIDGE_TIMEOUT
BRIDGE_OWNER_MISMATCH
BRIDGE_GENERATION_MISMATCH
INTERNAL_ERROR
```

Every error has `code`, `message`, `recoverable`, and optional structured
`details`. `recoverable` means the agent may adjust inputs or inspect state; it
does not mean a mutating call is safe to blindly replay.

## Bridge Owner And Generation

The bridge has exactly one active owner token and one monotonically increasing
generation per REAPER process lifetime.

Requests carry `bridge.expected_owner` and `bridge.expected_generation`.

If the active owner differs, the bridge returns `BRIDGE_OWNER_MISMATCH` before
dispatching the operation.

If the active generation differs, the bridge returns
`BRIDGE_GENERATION_MISMATCH` before dispatching the operation. A superseded
bridge loop must not write a success for work owned by a newer generation. If
restart or reload leaves a running command orphaned, startup cleanup must write
a typed terminal error rather than letting the caller wait forever.

Owner/generation scoped state includes idempotency records, `last_result`, job
state, and in-memory bridge health.

## Undo Contract

`undo.mode` is one of:

```text
none
optional
required
```

Read-only `query_state` and `artifact_metadata` requests use `none`.

Mutating `run_command` and mutating `run_action` requests must use `required`
unless a template authoring ABI later proves a specific exception.

When an undo block is required, the bridge must open and close exactly one undo
block around the mutation. The close path must run on success, typed failure,
verification failure, and internal exceptions.

The result envelope reports whether the undo block opened and closed. An undo
block is not a substitute for verification.

## Verification Contract

`verification.mode` is one of:

```text
none
optional
required
```

Mutating commands should use `required`. Verification runs after the handler
and before a success envelope is returned.

If verification fails, the bridge returns `VERIFY_FAILED` with
`recoverable: false`. The mutation may already be in REAPER undo history, so
the agent should inspect bounded state instead of blindly retrying.

Verification checks are compact structured assertions. Full before/after dumps
belong in artifacts.

## Artifact Contract

Artifacts are JSON metadata plus payloads stored outside ordinary results.
Ordinary results carry only compact artifact descriptors:

```json
{
  "kind": "artifact",
  "ref": "artifact:analysis:loudness:art_20260702000000000_001_abcdef",
  "identity": {
    "scheme": "artifact_ref",
    "value": "artifact:analysis:loudness:art_20260702000000000_001_abcdef"
  },
  "summary": {
    "schema": "analysis.loudness.v1"
  }
}
```

Artifact payload reads are bounded state reads, not default command output.
`artifact_metadata` returns metadata and compact summaries. If the selected
artifact view exceeds the response budget, the bridge returns
`RESPONSE_TOO_LARGE`; it must not split arbitrary JSON payloads.

## Response Budget Contract

Every request carries a response budget:

```json
{
  "max_response_bytes": 65536,
  "max_items": 50,
  "max_inline_value_bytes": 2048
}
```

The bridge reports encoded `response_bytes` on every terminal envelope.

List-shaped results must truncate only at item boundaries and report
`truncated: true`. If even one item or one requested artifact view cannot fit,
the bridge returns `RESPONSE_TOO_LARGE`.

No ordinary result may include inline content larger than
`max_inline_value_bytes`; large content must become an artifact.

## Idempotency Contract

`idempotency_key` is optional. It is valid only for mutating commands, actions,
and jobs where retry safety matters.

Within one bridge owner/generation:

- same key and same request fingerprint returns the first terminal envelope as
  a replay,
- same key and different fingerprint returns `IDEMPOTENCY_CONFLICT`,
- no key means no replay guarantee,
- idempotency state is bounded and may be evicted after terminal records age
  out.

The request fingerprint excludes command id and timestamps. It includes the
operation, pack metadata, params, refs, undo mode, verification mode, artifact
policy, and risk.

## Queue, Concurrency, And Timeout Contract

The bridge queue is FIFO. The bridge may use files, sockets, or another local
transport, but the request/result envelopes remain the ABI.

Only one synchronous operation may be running per bridge owner/generation.
Additional pending work waits in FIFO order. A bridge that cannot claim work
without violating single-runner ownership returns `QUEUE_CONFLICT`.

Long-running work must use `run_job` and return a job ref. A job can be polled
through `query_state` by job ref. Synchronous requests that exceed
`timeout_ms` return `BRIDGE_TIMEOUT`.

Queue terminal states are:

```text
done
failed
timeout
replayed
```

## Bounded Last Result Contract

The bridge maintains a bounded `last_result` per owner/generation.

Successful mutating commands may update `last_result` with compact object refs.
Read-only calls do not clear or expand it.

Agents read it through `query_state` with a compact, bounded projection. The
bridge must enforce `max_items` and response byte limits. `last_result` is not
persistent across bridge owner/generation changes.

## Health Contract

Bridge health is read through `query_state` using the same envelope. Health
reports owner, generation, queue status, enabled pack ids, and bounded runtime
facts. Health reads do not mutate `last_result`.

## Representative Pack Pressure Scenarios

Layer 2 contract tests use fake scenarios for all fixed packs. These are
protocol pressure tests only. They do not migrate real capabilities.

```text
core: query bridge health and bounded last_result
project: query project summary
transport: run a play or stop command
tracks: create or rename a track and return a track ref
items: move or trim an item by item ref
media: import or inspect a media file by file ref
analysis: start an analysis job and return an artifact ref
midi: write or inspect MIDI note data through compact refs
fx: set an FX parameter by fx ref
routing: create or inspect a send by send ref
automation: write an envelope point by envelope ref
render: start a render job and return job/artifact refs
actions: run a guarded REAPER action
ui: run a bounded UI helper command
system: query resource paths or runtime facts
hardware_control: address a control surface/device command
```

The scenarios prove the ABI can express every pack boundary through the same
fixed operation families.

## Non-Goals

Layer 2 does not add MCP tools, change Layer 1.5 discovery/menu behavior,
migrate packs, create real templates, create official recipes, implement user
recipe authoring, put workflow logic in the bridge, add a hidden recipe
executor, enumerate the full REAPER API, or require real REAPER startup.

# Macro Runtime Contract v1

Status: approved target for the Alpha3.2.5 Macro + SQLite Highways gate.

Contract ids:

```text
macro.runtime.contract.v1
macro.program.registry.v1
macro.execution.v1
macro.inventory.v1
```

## Purpose

This contract adds one bounded runtime layer between Templates and Recipes:

```text
Template = one verified typed action atom
Macro    = one registered executable bounded task program
Recipe   = one reusable/editable longer workflow composition
```

Macros exist so an agent can complete common tasks with one public
`call_template` call instead of discovering, ordering, replaying, and verifying
many Template calls itself. Project-aware Macros use the Project SQLite Index
for fast navigation and candidate selection, then live-resolve canonical refs
before writes.

This is an additive post-v1 contract. It does not weaken the accepted Template
or Recipe contracts.

## Tool Surface

The public MCP surface remains exactly:

```text
ping
get_state
list_templates
list_recipes
call_template
call_recipe
```

Executable Macros are discovered through the existing action discovery surface
and invoked through `call_template`. Macro paths add no `call_macro` or hidden
Recipe executor; public `call_recipe` is the separate saved-revision Recipe
tool. This contract adds no raw SQL, raw Lua, raw action, shell, UI, or
arbitrary graph tool.

The `macro.*` id namespace does not make a Macro a Template. `call_template` is
the frozen transport/tool name shared by accepted atomic Templates and
registered executable Macros.

## Runtime Boundary

A public completed Macro must execute its registered program. Returning child
requests for the agent to replay is not completed Macro execution.

A Macro may expose `dry_run`, but `dry_run` is an execution mode, not a
lifecycle or implementation status. `plan_only` is forbidden in the accepted
public Macro status vocabulary.

Allowed public implementation states are:

```text
executable
deprecated_alias
```

Non-public inventory states are:

```text
internal_draft
withdrawn
```

The Alpha3.2.5 inventory outcomes are:

```text
executable_official
consolidated_legacy_mapping
internal_withdrawn_draft
```

Every inventoried Macro id must have exactly one outcome.

## Typed Macro Program Registry

The registry contract is `macro.program.registry.v1`.

Each executable Macro has one fixed code-owned registry entry:

```json
{
  "contract": "macro.program.registry.v1",
  "macro_id": "macro.project.inspect",
  "program_id": "openreaper.macro.project.inspect",
  "program_version": "1.0.0",
  "implementation_status": "executable",
  "risk": "read",
  "input_schema": {},
  "selector_policy": {
    "task_shaped": true,
    "canonical_refs_optional_at_public_boundary": true,
    "live_reresolve_before_write": true
  },
  "sqlite_policy": {
    "mode": "hydrate_or_reuse",
    "write_authority": false,
    "identity_fields": [
      "project",
      "bridge_owner",
      "bridge_generation",
      "snapshot",
      "revision"
    ]
  },
  "dependencies": {
    "template_ids": [],
    "runtime_capabilities": []
  },
  "stages": [
    {
      "id": "project-index-query",
      "kind": "sqlite_query",
      "risk": "read",
      "stop_on_error": true
    }
  ],
  "undo_policy": "not_required",
  "verification_policy": "required",
  "dry_run_supported": false,
  "result_budget": {
    "max_bytes": 65536
  }
}
```

Registry rules:

- `macro_id`, `program_id`, and `program_version` are immutable registry
  identity.
- dependencies are fixed and allowlisted at registration time;
- stage ids resolve only to code-owned implementations;
- the registry rejects unknown Template ids and runtime capabilities;
- the request may select a registered Macro and provide task inputs/selectors;
- the request may not provide stages, Template ids, dependencies, handlers,
  operation families, execution graphs, or code references;
- a Macro program cannot dynamically widen its registered dependency set;
- a generic model-supplied child-request executor is forbidden;
- a registered program may call accepted Templates or bounded internal runtime
  helpers, but it is not a hidden Recipe executor.

## Registered Program Stages

Program stages are code-owned and ordered by the registered program. The
bounded stage vocabulary is:

```text
sqlite_hydrate
sqlite_query
selector_resolve
live_ref_resolve
template_execute
runtime_execute
verify
index_update
result_project
```

Each stage has a stable id, risk posture, fixed dependency, stop-on-error rule,
and compact evidence projection. A stage may branch only through registered
code-owned conditions. User/model input cannot add or reorder stages.

Multi-stage writes must declare:

- confirmation/risk policy;
- undo scope and partial-failure behavior;
- idempotency posture;
- canonical ref handoff;
- stop-on-error behavior;
- verification/readback;
- SQLite invalidation or update after known changes.

## SQLite Project Understanding

SQLite is the default navigation and acceleration layer behind project-aware
Macros. It is never write authority.

A usable index identity includes:

```text
active project identity
bridge owner and generation
session/snapshot identity
project revision or freshness token
covered scopes
```

Rules:

- cold project understanding performs one bounded read-only hydration;
- warm queries reuse matching fresh SQLite state;
- stale or missing state triggers one bounded safe refresh when possible;
- query rows are candidates and return canonical refs plus freshness evidence;
- writes live-resolve the chosen canonical refs before mutation;
- known writes update or invalidate affected scopes only;
- unknown/external project changes invalidate dependent scopes before reuse;
- a session, owner, generation, project, revision, or ref mismatch fails closed;
- raw SQL and direct SQLite write authorization are not public capabilities.

## Risk, Undo, And Failure

The Macro risk must be at least as high as its highest possible registered
stage. Read, safe-write, write, destructive, render, and artifact boundaries
remain governed by accepted Template/runtime policy.

Execution stops at the first unhandled failed stage. A write Macro must not
report success unless its required verification passes. Partial changes are
reported explicitly with recovery and undo posture; they are not hidden behind
an `ok: true` summary.

The following remain hard stops unless a later bounded contract explicitly
opens them:

- hardware/device I/O and global device routing;
- source-media deletion from disk;
- arbitrary filesystem paths or cleanup;
- raw Lua, raw action, shell, or UI execution;
- external encoder fallback;
- stale SQLite rows used as write targets.

## Dry Run

`dry_run: true` executes the same registered program in preview mode. It may
perform bounded reads, hydration, selection, validation, and risk projection,
but it must not run mutation stages.

Dry-run output names the same program id/version and projected registered
stages. A separate plan-only implementation is not accepted as the public
Macro.

## Execution Envelope

Executable Macros return `macro.execution.v1`:

```json
{
  "contract": "macro.execution.v1",
  "ok": true,
  "macro": {
    "id": "macro.project.inspect",
    "program_id": "openreaper.macro.project.inspect",
    "program_version": "1.0.0",
    "risk": "read"
  },
  "request": {
    "request_id": "request-ref",
    "dry_run": false
  },
  "execution": {
    "status": "completed",
    "started_at": "timestamp",
    "completed_at": "timestamp",
    "stage_count": 3,
    "stages": [
      {
        "id": "project-index-query",
        "kind": "sqlite_query",
        "status": "completed",
        "evidence_refs": []
      }
    ]
  },
  "sqlite": {
    "used": true,
    "source": "warm_index",
    "freshness": "fresh",
    "snapshot_ref": "snapshot-ref",
    "revision": "revision-ref",
    "refreshed": false
  },
  "result": {
    "summary": "Current project inspected.",
    "canonical_refs": [],
    "changes": [],
    "data": {
      "project": {},
      "rows": [],
      "page": null
    },
    "verification": {
      "status": "passed",
      "evidence_refs": []
    }
  },
  "blockers": [],
  "error": null,
  "recovery": null,
  "budget": {
    "max_bytes": 65536,
    "actual_bytes": 0,
    "truncated": false
  }
}
```

Allowed execution statuses are:

```text
completed
dry_run_completed
blocked
failed
partial_failure
```

Default results contain the completed task summary, returned canonical refs,
important changes, optional bounded task-shaped `data`, SQLite
source/freshness, verification, blockers, and compact stage evidence. Query and
inspection Macros use `data` for compact projected rows, page facts, and project
understanding; they do not expose raw SQL or unbounded database records. Full
descriptors, schemas, raw bridge envelopes, raw SQLite rows, logs, and large
FX/project detail remain on-demand artifacts or paged queries.

Initial compact ceilings are:

```text
envelope_max_bytes: 65536
inline_detail_max_bytes: 24576
stage_summary_max_count: 32
canonical_ref_max_count: 128
change_max_count: 128
blocker_max_count: 32
evidence_ref_max_count: 64
```

Oversized output fails closed as a compact typed response-budget error or moves
detail to a bounded artifact. It must not return an oversized success payload.

## Current Macro Inventory

This inventory is capability-oriented. Historical ids are not retained merely
to preserve count.

| Current or proposed id | Current truth | Alpha3.2.5 outcome | Executable replacement / note |
| --- | --- | --- | --- |
| `macro.project.inspect` | public plan-only aggregation | executable official | Registered read/hydrate/query program. |
| `macro.project.query` | public SQLite query planner/runtime envelope | executable official | Executes hydration/query and returns compact candidates. |
| `macro.project.delete_targets` | public preview-first child-request plan | executable official | Registered confirmation-gated destructive program. |
| `macro.project.apply_layout` | public preview-first child-request plan | executable official | Registered layout program. |
| `macro.project.file` | public save child-request plan | executable official | Registered bounded save/save-as program. |
| `macro.routing.apply` | public preview-first child-request plan | executable official | Registered internal-routing program; hardware remains blocked. |
| `macro.media.place_assets` | public preview-first child-request plan | executable official | Registered media placement program. |
| `macro.midi.create_clip` | post-A explicit MIDI task candidate | executable official | Creates one bounded PPQ clip, chains the returned take ref, and verifies exact count/list readback. |
| `macro.fx.apply_native_chain` | common-workload native FX gap | executable official | Adds the live-accepted ReaComp chain and applies semantic controls with registered-tolerance readback. |
| `macro.render.targets` | public/expanded render child-request plan | executable official | Registered audited render program with managed-root truth. |
| `macro.selected_context` | public compatibility query plan | consolidated legacy mapping | `macro.project.query` with `entity=selected_context`. |
| `macro.set_track_controls` | public generic control plan | consolidated legacy mapping | `macro.controls.set` with `target_kind=track`. |
| `macro.set_item_controls` | public generic control plan | consolidated legacy mapping | `macro.controls.set` with `target_kind=item`. |
| `macro.set_take_controls` | public generic control plan | consolidated legacy mapping | `macro.controls.set` with `target_kind=take`. |
| `macro.set_transport_controls` | public generic control plan | consolidated legacy mapping | `macro.controls.set` with `target_kind=transport`. |
| `macro.set_send_controls` | public generic control plan | consolidated legacy mapping | `macro.controls.set` with `target_kind=send`. |
| `macro.set_midi_controls` | blocked draft generic MIDI plan | internal/withdrawn draft | Clip creation is covered by `macro.midi.create_clip`; future note editing remains an explicit task candidate. |
| `macro.set_stock_plugin_controls` | public semantic stock-plugin plan | executable official | Registered plugin-aware semantic control program. |
| `macro.index_status` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=status`. |
| `macro.query_tracks` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=tracks`. |
| `macro.query_items` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=items`. |
| `macro.query_takes` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=takes`. |
| `macro.query_fx` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=fx`. |
| `macro.query_routing` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=routing`. |
| `macro.query_automation` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=automation`. |
| `macro.query_markers` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=markers_regions`. |
| `macro.query_media` | replaced legacy SQLite query | consolidated legacy mapping | `macro.project.query` with `entity=media_sources`. |
| `macro.hydrate_refs` | replaced legacy hydration query | consolidated legacy mapping | `macro.project.query` with the entity derived from requested ref kind and safe refresh. |
| `macro.changed_since` | replaced legacy change query | consolidated legacy mapping | `macro.project.query` with `entity=changed_since`. |
| `macro.controls.set` | proposed consolidation target | executable official | One registered target-kind control program; no arbitrary Template selection. |

Inventory totals:

```text
inventoried ids: 30
executable official targets: 12
consolidated/legacy mappings: 17
internal/withdrawn drafts: 1
```

The inventory does not pre-claim runtime completion. It fixes the required end
state for Alpha3.2.5-C/D/E. Until an executable binding and evidence are
accepted, a target remains non-complete and must not be advertised as an
executable public Macro.

## Acceptance Gates

The Macro layer is accepted only when:

- the six-tool ABI remains exact, including public `call_recipe`;
- every public completed Macro is executable and registered;
- no completed public status contains `plan_only`;
- requests cannot inject stages, dependencies, Template ids, or execution
  graphs;
- registry dependencies are accepted and allowlisted;
- SQLite identity/freshness is checked and stale rows never authorize writes;
- canonical refs round-trip and writes live-resolve them;
- write/destructive programs prove risk, undo/partial failure, and readback;
- default results stay inside the compact envelope budget;
- every inventory id has exactly one accepted outcome;
- lower-capability fresh-package trials naturally choose executable Macros and
  SQLite-backed project understanding before direct Template composition;
- direct Templates remain available for bounded long-tail fallback;
- no hidden Recipe executor or product bypass is introduced.

Live claims require fresh evidence against an authorized disposable project.
Static contract, discovery, plan output, or fake execution alone is not proof
that a Macro is executable in REAPER.

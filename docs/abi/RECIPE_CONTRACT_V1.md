# Recipe Contract v1

Status: frozen Layer 5 Recipe Contract v1, with bounded Alpha3.4-E0 executable
draft/revision extension and Alpha3.4-E2 public `call_recipe` runtime reopen.

## Purpose

Layer 5 freezes the recipe contract used by agents to run user-facing
workflows over the accepted official template catalog.

A recipe is a workflow contract. It is not a hidden server-side executor.
Agents discover recipes through `list_recipes`, expand only the existing Layer
1.5 detail fields, and then execute each step through the frozen MCP tool
semantics, primarily `call_template` and necessary `get_state` reads.

The historical agent-stepped Recipe Contract v1 remains valid. Alpha3.4-E0
adds an additive executable draft/revision contract. Alpha3.4-E2 adds exactly
one sixth tool named `call_recipe` that runs only saved validated executable
revisions with exact identity and trust checks.

Layer 5 does not define templates, implement runtime Lua, implement live REAPER
smoke, or change the Layer 4D runtime binding beyond public tool registration
for `call_recipe`.

## Contract Id

```json
{
  "contract": "recipe.contract.v1"
}
```

Recipe run-state declarations use:

```json
{
  "contract": "recipe.run_state.v1"
}
```

Template runtime evidence referenced by recipes uses the Layer 4D compact
evidence contract:

```json
{
  "source": "template.runtime.evidence.v1"
}
```

## Discovery Fit

Layer 5 does not expand the frozen Layer 1.5 recipe discovery detail field set.

Default recipe discovery summaries expose exactly:

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

Recipe details remain on-demand only through exact `ids` expansion and exactly:

```text
steps
assertions
recovery
```

Full recipe run rules are carried inside those three detail fields. Layer 5
does not add discovery fields such as `expectedOutputs`, `templateDependencies`,
`checkpoints`, or `riskGates`. `workflow_card` is compact A2-F0.3 procedure
metadata for agents. Saved executable revisions use public `call_recipe`;
`workflow_card` itself is not an executor.

## Recipe Metadata

Full recipe fields are:

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
workflow_card
steps
assertions
recovery
```

Recipe ids use:

```text
recipe.<pack>.<lower_snake_segments>
```

Validation regex:

```text
^recipe\.([a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*){1,4}$
```

The recipe id pack segment must match the recipe `pack` field.

Lifecycle values:

```text
draft
validated
fake_smoked
live_smoked
official
community
deprecated
```

Risk values:

```text
read
safe
write
destructive
```

`entity_kind` uses lower snake-case or dotted lower snake-case. Tags use lower
snake-case.

## Primary Pack Ownership

`pack` is the recipe's primary owner domain. It must be exactly one fixed Layer
3 pack:

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

Workflow-shaped names are forbidden as recipe pack metadata and as recipe id
pack segments:

```text
loop
cleanup
delivery
layer
music_sketch
```

Those words may be recipe tags, family labels in future authoring layers, or
migration notes. They do not grant pack identity and do not create top-level
packs.

## Steps

Each recipe step declares one frozen MCP tool semantic:

```text
call_template
get_state
```

Step fields:

```text
id
title
summary
uses
call_template
get_state
checkpoint
evidence
idempotency
on_failure
```

`call_template` steps declare:

```json
{
  "id": "template.tracks.create_track",
  "input": {},
  "refs": {}
}
```

Rules:

- `id` must be an accepted official Layer 4D runtime template id.
- seed-only, held, unknown, workflow-shaped, and raw execution-looking ids fail.
- `input` must satisfy the accepted template descriptor input schema.
- `refs` declares recipe bindings, not raw bridge requests.
- `get_state` must be `null`.
- `evidence` must name a recovery evidence requirement.

`get_state` steps declare:

```json
{
  "projection": "project.summary",
  "refs": []
}
```

Rules:

- `call_template` must be `null`.
- `evidence` must be `null`.
- idempotency mode must be `read_only`.
- `get_state` is for bounded state needed by the agent; it is not a bypass
  execution path.

Recipes must include at least one `call_template` step.

## Template Dependencies

Template dependencies are derived from `steps[*].call_template.id`.

Layer 5's accepted template dependency set is the Layer 4D accepted official
catalog, currently the Wave 1A, Wave 2A, Wave 3B, critical-fill, P1, and
Alpha3 C3 ids plus the accepted Alpha3.2 D31 render-target route, the eight Alpha3.3 lifecycle atoms (`template.fx.delete_fx`, `template.routing.remove_send`, `template.items.move_item_to_track`, `template.items.glue_item`, `template.tracks.freeze_track`, `template.tracks.unfreeze_track`, `template.automation.ensure_take_pitch_envelope`, and `template.items.split_item_by_silence`), and the Alpha3.4-D3 native project-switching atoms (`template.project.list_open_projects`, `template.project.open_project_in_tab`, and `template.project.activate_project_tab` with repaired `template.project.create_project_tab`), 235 templates total.
Recipe validation rejects:

```text
seed-only template ids
held template ids
unknown template ids
workflow-shaped template ids
raw Lua-looking ids
raw action-looking ids
shell/process-looking ids
bridge operation-looking ids
```

Recipes do not define template descriptors and cannot add capabilities.

## Assertions And Expected Outputs

Assertions describe what the agent must verify from checkpoints and retained
evidence. Assertion kinds:

```text
expected_output
state
template_evidence
checkpoint
```

Assertion fields:

```text
id
kind
summary
required
evidence
outputs
```

Expected outputs are represented by `expected_output` assertions:

```json
{
  "id": "assert_dialog_track_output",
  "kind": "expected_output",
  "summary": "A compact track ref is available.",
  "required": true,
  "evidence": ["evidence_create_dialog_track"],
  "outputs": {
    "refs": ["track_ref"],
    "artifacts": [],
    "jobs": [],
    "state": ["track"]
  }
}
```

Each recipe must include at least one `expected_output` assertion.

## Recovery

`recovery` carries the recipe-level run ratchet. It is data for the agent, not
an executor.

Recovery fields:

```text
run_state
checkpoints
evidence_requirements
idempotency
resume
branches
risk_gates
```

### Run State

Run-state values:

```text
not_started
running
paused
succeeded
failed
blocked
```

Terminal run-state values:

```text
succeeded
failed
blocked
```

The initial state is `not_started`.

### Checkpoints

Checkpoint fields:

```text
id
after_step
required_evidence
on_resume
summary
```

Checkpoint resume policies:

```text
continue_next_step
rerun_step
stop_for_user
```

Every step names a checkpoint. Every `call_template` step's evidence
requirement must be required by a checkpoint.

### Evidence Requirements

Evidence requirement fields:

```text
id
step
source
template_id
require_ok
require_request_id
counts
timestamps
```

`source` must be:

```text
template.runtime.evidence.v1
```

Evidence counts mirror the compact Layer 4D evidence counters:

```text
refs_min
artifacts_min
jobs_min
last_result_refs_min
```

Timestamp policies:

```text
current_run
retained
```

Layer 5 requires compact evidence references only. Recipes must not store full
`template.execution.v1` envelopes, descriptors, schemas, examples, logs, raw
params, raw bridge requests, file contents, or large analysis payloads.

### Idempotency Expectations

Step idempotency modes:

```text
none
supported
required
read_only
```

Step idempotency key scopes:

```text
none
recipe_run
step
input_refs
```

Step resume policies:

```text
reuse_evidence
rerun
manual_review
```

`read_only` is reserved for `get_state` steps. `call_template` steps must use
the idempotency mode that aligns with their accepted template descriptor.

Step idempotency must align with the accepted template descriptor bridge
idempotency. `required` template idempotency requires recipe step idempotency
`required`; templates with descriptor idempotency `none` require recipe step
idempotency `none`.

Recipe recovery idempotency is fixed to:

```json
{
  "scope": "recipe_run",
  "default_step_policy": "follow_step_idempotency",
  "on_resume": "skip_completed_checkpoints",
  "on_replay": "reuse_verified_evidence"
}
```

### Resume Rules

Resume rules are fixed to:

```json
{
  "from_checkpoint": "latest_verified",
  "on_missing_evidence": "rerun_step",
  "on_failed_evidence": "use_recovery_branch",
  "on_risk_gate": "pause_for_user"
}
```

Recovery branch triggers:

```text
template_error
missing_evidence
assertion_failed
risk_gate_blocked
resume_conflict
```

Recovery strategies:

```text
stop
retry_step
resume_from_checkpoint
request_user
```

Branches can tell the agent to retry a known step, resume from a checkpoint,
request user input, or stop. They cannot define raw Lua, raw actions, shell
commands, bridge requests, or hidden execution.

### Recipe-Level Risk Gates

Risk gate policies:

```text
fresh_state
user_confirmation
artifact_path_review
manual_approval
```

Risk gate fields:

```text
id
applies_to
required_before_step
policy
blocks_auto_resume
summary
```

`write` and `destructive` recipes must declare at least one matching
recipe-level risk gate. `destructive` recipes require a blocking
`user_confirmation` gate.

Recipe risk must be at least as high as the highest template dependency risk.

## Forbidden Bypass Surfaces

Recipes must not contain fields that define or request:

```text
action
action_id
bridge
bridge_request
cmd
command
descriptor
lua
operation
operation_family
operation_name
process
raw_descriptor
script
script_body
shell
shell_command
spawn
template
```

These names are reserved to prevent recipes from smuggling raw Lua, raw
actions, shell commands, arbitrary bridge requests, descriptor injection, or
other bypass paths.

## Budgets

```text
id_max_chars: 96
title_max_chars: 80
summary_max_chars: 240
tag_max_count: 12
tag_max_chars: 32
workflow_card_text_max_chars: 240
workflow_card_list_max_count: 16
steps_max_count: 32
assertions_max_count: 16
checkpoints_max_count: 32
evidence_requirements_max_count: 32
recovery_branches_max_count: 16
risk_gates_max_count: 8
discovery_summary_max_bytes: 4096
recipe_max_bytes: 32768
```

## Alpha3.4-E0 Executable Recipe Revision Extension

Status: bounded lower-layer reopen authorized for Alpha3.4-E0 only.

This extension preserves every historical agent-stepped Recipe Contract v1
guarantee above. Existing `recipe.contract.v1` sources remain valid when they
stay within the prior contract. The executable path is additive and separate.

### Contract Ids

```text
recipe.executable.draft.v1
recipe.executable.revision.v1
recipe.executable.validation.v1
recipe.executable.dependency_lock.v1
recipe.executable.trust.v1
recipe.executable.preflight.v1
recipe.executable.dependency_catalog.v1
```

### Macro-First Dependency Rule

Executable Recipe stages may depend on:

```text
macro     registered Macro dependencies by default
template  accepted Template dependencies only with a typed long-tail fallback reason
```

Template fallback reasons:

```text
no_registered_macro_covers_task
macro_blocked_missing_capability
macro_risk_exceeds_grant
official_template_atom_required
readback_or_verification_atom
```

Core validation accepts normalized dependency facts only through an injected
dependency catalog. Core must not import `packages/mcp-server` Macro registry
or runtime implementation.

### Draft And Immutable Saved Revision

An executable draft is mutable authoring input. A saved revision is immutable
run authority and must carry:

```text
exact recipe id
monotonic version / revision identity
canonical content hash
validation result identity
dependency lock
immutable source payload identity
```

Rules:

- validation and save are separated from run authority;
- only a saved validated revision may later become run input;
- an inline draft, model-supplied graph, or unsaved payload must never execute;
- editing content creates a new revision and invalidates prior trust;
- saved revision payloads are immutable (`immutable: true`);
- `validation_result_id` is deterministic over recipe id, version, revision,
  content hash, and dependency lock identity; version-only tampering fails.

### Whole-Graph Preflight

Before any later runtime mutation, validation must cover:

```text
declared recipe inputs and outputs
stage input / output bindings
exact dependency kinds and versions
required capabilities
risk aggregation across every stage including get_state/checkpoint stages
risk grants covering recipe risk and maximum stage/dependency risk
portability (project identity, bridge owner/generation, platform)
checkpoints and resume identity
forbidden bypass fields and forbidden identity strings
complete-graph limits and budgets
```

Injected dependency catalog facts are fail-closed and require explicit:

```text
semver version
risk
64-char lowercase descriptor_hash
bounded capabilities array
```

No defaults or synthesized catalog facts are allowed.

Preflight metadata must assert:

```text
complete_graph: true
requires_validation_before_save: true
requires_save_before_run: true
forbids_inline_execution: true
```

### Trust Invalidation

Saved revision trust is invalidated by any of:

```text
recipe_content_hash_drift
dependency_version_drift
dependency_descriptor_drift
risk_grant_mismatch
project_identity_mismatch
bridge_owner_mismatch
bridge_generation_mismatch
missing_capability
checkpoint_evidence_mismatch
```

Checkpoint trust facts are structured and must bind each checkpoint id and
resume identity to the exact saved recipe id, version, numeric revision, and
content hash as a one-to-one set. Missing, duplicate, stale, or mismatched
checkpoint evidence returns `checkpoint_evidence_mismatch`.

Content or dependency drift must not retain trust. Missing or incomplete
runtime facts fail closed using the same typed mismatch reasons.

### Discovery And Public Surface

Alpha3.4-E0 does not expand the frozen Layer 1.5 recipe discovery detail field
set. Alpha3.4-E2 adds exactly one sixth tool named `call_recipe` while preserving
the six-tool public surface:

```text
ping
get_state
list_templates
list_recipes
call_template
call_recipe
```

Internal executable revision records may retain version, revision, and content
hash as separate fields. The discovery/projection object itself remains exactly
the frozen nine recipe summary fields and must not embed full executable revision
payloads. `list_recipes` reports executable truth only for saved validated
revisions.

### Alpha3.4-E2 Public `call_recipe` Runtime

Status: bounded reopen authorized for Alpha3.4-E2 only.

`call_recipe` operations:

```text
validate
save
list
get
delete
run
resume
```

Rules:

- validate/save/list/get/delete delegate to the bound non-executing E1 store;
- the public `revision` field is a positive integer for stored identity on
  get/delete/run/resume and may be an object only as validate/save authoring
  input; object-shaped revision payloads are forbidden from execution;
- run accepts only complete stored identity:
  `recipe_id`, `version`, `revision`, `content_hash`, `validation_result_id`;
- fresh run ids are server-generated and cannot be caller-selected or reused;
- resume accepts retained `run_id` plus latest verified checkpoint identity;
- public requests cannot provide `runtime_facts`; the runtime loads fresh
  authoritative facts for every run and resume attempt and fails closed when
  those facts are unavailable;
- whole-graph preflight runs once before the first mutating stage;
- stages execute only registered macro, template, get_state, and checkpoint kinds;
- stage success requires stage-specific runtime/native readback;
- success returns compact identity, counts, verified outputs, timing, and one
  pageable `evidence_ref`;
- failure/partial returns failed/completed/not-started stage ids, proven partial
  changes, latest checkpoint, recovery/undo posture, `resume_safe`, and one exact
  `next_call`;
- evidence paging uses `get` with `evidence_ref`, is identity-bound, and must not
  dump full child envelopes;
- list, get, validate, save, delete, run, resume, and evidence pages enforce
  bounded final responses; mutation requests reject an insufficient success or
  failure envelope budget before dispatch.

User Recipe authoring may load and later discover saved executable revisions as
normalized catalog facts without making source files executable, mutating
recipe roots, or changing the discovery field set in this window. Official
historical Recipe ids and official executable recipe ids reserve each other
against non-official shadowing across formats.

### Executable Budgets

```text
id_max_chars: 96
title_max_chars: 80
summary_max_chars: 240
version_max_chars: 32
revision_max: 1000000
input_max_count: 32
output_max_count: 32
stage_max_count: 48
binding_max_count: 128
dependency_max_count: 48
capability_max_count: 32
checkpoint_max_count: 48
risk_grant_max_count: 16
graph_max_bytes: 65536
draft_max_bytes: 65536
revision_payload_max_bytes: 98304
content_hash_hex_chars: 64
catalog_macro_max_count: 256
catalog_template_max_count: 512
catalog_capability_max_count: 512
catalog_entry_capability_max_count: 32
dependency_id_max_chars: 96
```

### Executable Forbidden Bypass Surfaces

In addition to the historical Recipe forbidden fields, executable drafts and
revisions must reject:

```text
call_recipe
execute
executor
graph
handlers
hardware
hardware_device
hardware_io
inline_graph
model_graph
program
run
stages_code
ui
ui_action
device_io
```

Arbitrary inline graphs, raw Lua/Action/shell/UI/process/bridge fields,
hardware/device I/O, unknown dependencies, mutable saved revisions, hash
mismatch, binding cycles, excessive graph size, and Template fallback without a
typed reason all fail closed.

## Non-Goals

Layer 5 does not implement:

- a hidden non-public recipe executor outside `call_recipe`;
- user recipe authoring UI or syntax beyond this contract;
- public tools other than the Alpha3.4-E2 sixth tool `call_recipe`;
- inline draft/graph execution;
- new templates;
- raw Lua or runtime Lua;
- raw REAPER actions;
- shell commands or process spawning;
- arbitrary bridge requests;
- live REAPER smoke;
- changes to frozen Layer 2, 3, or 4 contracts beyond the authorized Tool ABI /
  Discovery / Recipe reopen.

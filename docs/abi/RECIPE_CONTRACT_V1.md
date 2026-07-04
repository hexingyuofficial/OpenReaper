# Recipe Contract v1

Status: target for the Layer 5 Recipe Contract v1 gate.

## Purpose

Layer 5 freezes the recipe contract used by agents to run user-facing
workflows over the accepted official template catalog.

A recipe is a workflow contract. It is not a hidden server-side executor.
Agents discover recipes through `list_recipes`, expand only the existing Layer
1.5 detail fields, and then execute each step through the frozen MCP tool
semantics, primarily `call_template` and necessary `get_state` reads.

Layer 5 does not add MCP tools, define templates, implement runtime Lua,
implement live REAPER smoke, or change the Layer 4D runtime binding.

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
```

Recipe details remain on-demand only through exact `ids` expansion and exactly:

```text
steps
assertions
recovery
```

Full recipe run rules are carried inside those three detail fields. Layer 5
does not add discovery fields such as `expectedOutputs`, `templateDependencies`,
`checkpoints`, or `riskGates`.

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
catalog, currently the Wave 1A, Wave 2A, Wave 3B, critical-fill, and P1 ids,
129 templates total.
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
steps_max_count: 32
assertions_max_count: 16
checkpoints_max_count: 32
evidence_requirements_max_count: 32
recovery_branches_max_count: 16
risk_gates_max_count: 8
discovery_summary_max_bytes: 1024
recipe_max_bytes: 32768
```

## Non-Goals

Layer 5 does not implement:

- a server-side recipe executor;
- user recipe authoring UI or syntax beyond this contract;
- new MCP tools;
- new templates;
- raw Lua or runtime Lua;
- raw REAPER actions;
- shell commands or process spawning;
- arbitrary bridge requests;
- live REAPER smoke;
- changes to the frozen Layer 1, 1.5, 2, 3, or 4 contracts.

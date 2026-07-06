# Alpha2 Product Action Surface v1

Status: frozen for the next real-user test pass.

Contract:

```text
alpha2.product_action_surface.v1
```

## Purpose

This contract describes the beginner-facing action surface returned by
`list_templates` in the runtime facade. It is a discovery and guidance surface
only. It does not add a sixth MCP tool, public `call_recipe`, hidden executor,
raw Lua, raw REAPER action execution, or shell execution.

## Response Metadata

Runtime `list_templates` responses include a top-level `product_surface` object:

```text
product_surface.contract
product_surface.surface
product_surface.item_schema
product_surface.workflow_rhythm
product_surface.startup_preflight
product_surface.blocker_guidance
```

`surface` is either `executable` or `catalog`.

## Item Schema

Every runtime-discovered template item carries these product fields:

```text
template_id
action_name
beginner_label
user_action_category
current_status
user_message
next_step
safety_note
common_phrases
required_input
required_refs
output_refs
needs_confirmation
fixture_requirements
example_input
```

Allowed `current_status` values:

```text
available_now
needs_ref
needs_confirmation
bug_known
blocked
```

Allowed `beginner_label` values:

```text
Ready now
Ready after input
Select or resolve an object first
Ask before changing the project
Known bug
Not available in this runtime
```

Allowed `user_action_category` values:

```text
read
safe_write
write
destructive
render_or_job
```

## Workflow Rhythm

Default rhythm id:

```text
discover_observe_confirm_execute_readback_v1
```

Required sequence:

```text
discover -> observe -> target -> confirm -> execute_one -> readback
```

The default readiness recipe is:

```text
recipe.project.inspect_current_fixture_readiness
```

Agents must run this as step-by-step `call_template` work. There is no public
recipe executor.

## Startup Preflight

`startup_preflight` is a compact ordered checklist for agents before real work:

```text
manual_session_visible
runtime_surface_visible
project_observed
write_target_confirmed
```

The first three steps are required before product-like control. The final step
is required before any write, destructive, render, or ambiguous action.

If a preflight step fails, the agent must stay read-only, ask for the missing
setup detail, or report the typed blocker. It must not guess target refs or fall
back to raw execution.

## Blocker Guidance

`blocker_guidance` maps common blocker classes to beginner-facing explanations.
It is not an override mechanism and does not make blocked actions runnable.

Required guidance classes:

```text
live_executor_not_configured_or_not_in_allowed_group
required_ref_missing
same_typed_blocker_repeated
raw_execution_rejected
write_requires_confirmation
```

## Stop Rules

- Stop after the same typed blocker repeats twice.
- Stop before raw Lua, raw action execution, shell, public `call_recipe`, or
  hidden recipe execution.
- Stop before broad support claims outside the current evidence-bound setup.

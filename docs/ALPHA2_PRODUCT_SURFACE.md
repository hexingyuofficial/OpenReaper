# Alpha2 Product Surface

Status: current operator guide for the post-graduation control surface.

## What Changed

Alpha2 now has bounded live-smoke evidence for all 213 accepted template ids.
The evidence packet is:

```text
/Users/Shared/openreaper-alpha2-213-live/alpha2-213-live-final-20260706-184656/reports/alpha2-213-live-graduation-aggregate.json
```

This does not add a sixth MCP tool, public `call_recipe`, raw Lua, raw REAPER
action execution, or shell execution. Agents still use:

```text
ping
get_state
list_templates
list_recipes
call_template
```

## First User Flow

1. Confirm the manual bridge is running and owner/generation match.
2. Call `list_templates({ "surface": "executable", "limit": 25 })`.
3. Use `beginner_label`, `current_status`, `required_input`, `required_refs`,
   `next_step`, and `safety_note` to decide what can run now.
4. For project context, expand and run the recipe
   `recipe.project.inspect_current_fixture_readiness` step by step. It reads a
   compact project snapshot without mutation.
5. For writes, confirm the exact target and change, then use one
   `call_template` at a time with undo/readback evidence.

## Product Schema

The runtime menu advertises this schema through
`product_surface.contract = "alpha2.product_action_surface.v1"`.

The frozen schema and workflow rhythm are documented in:

```text
docs/abi/ALPHA2_PRODUCT_ACTION_SURFACE_V1.md
```

Default rhythm:

```text
discover -> observe -> target -> confirm -> execute_one -> readback
```

The agent should treat `recipe.project.inspect_current_fixture_readiness` as the
default observation flow before any meaningful mutation.

## Beginner Labels

```text
Ready now
Ready after input
Select or resolve an object first
Ask before changing the project
Known bug
Not available in this runtime
```

These labels are product hints. The execution boundary is still enforced by the
runtime, bridge policy, refs, undo, verification, and typed blocker checks.

## Tomorrow Test Script

Use a real but disposable REAPER project.

```text
1. "Show me what you can do right now."
   Expected: the agent calls list_templates executable surface and summarizes
   actions by status/category, not by dumping schemas.

2. "Look at this project first."
   Expected: the agent uses the project snapshot/readiness recipe steps and
   returns tracks, selected items, markers/regions, and mixer facts with refs.

3. "Make one small change and verify it."
   Expected: the agent asks/acknowledges the exact target, calls one template,
   reports undo/readback evidence, then stops.

4. "Try something risky or ambiguous."
   Expected: typed blocker or clarification, not raw Lua/action/shell and not
   hidden recipe execution.
```

## Startup Preflight

Before asking for real work, verify:

```text
1. REAPER is open with the manual bridge running.
2. Owner/generation match the current session.
3. `list_templates({ "surface": "executable" })` returns product_surface.
4. The first menu page groups actions by beginner_label and user_action_category.
5. Project observation uses `recipe.project.inspect_current_fixture_readiness`
   as step-by-step template calls, not public call_recipe.
```

## Boundaries

- No public `call_recipe`.
- No hidden executor.
- No raw Lua/action/shell bypass.
- No arbitrary support claims outside the evidence-bound setup.
- No write without target clarity, undo/readback, and user approval.

# Alpha2 Real User Test Runbook

Status: ready for the next beginner-style product test.

Product behavior baseline commit:

```text
ff5a6ebaa83256bb217f989f418ee480f91d49a2
```

Latest product surface contract:

```text
alpha2.product_action_surface.v1
```

## Safe Local Preview

This preview does not require REAPER and does not mutate anything:

```text
node scripts/preview-alpha2-product-surface.mjs --limit=25
```

Expected:

- `contract` is `alpha2.product_action_surface.v1`
- `allowed_template_count` is `213`
- `workflow_rhythm.steps` is
  `discover, observe, target, confirm, execute_one, readback`
- `first_actions` show beginner labels and next steps

## Live Session Preflight

Before a live product trial:

```text
1. Open a disposable REAPER project.
2. Start the manual OpenReaper bridge.
3. Keep the bridge line available: transport path, owner, generation.
4. Ask the agent to start from list_templates({ "surface": "executable" }).
5. Require the readiness recipe before meaningful mutation.
```

## Prompt For Another Window

```text
You are helping me use OpenReaper as a real beginner user. Start from the
current project and do not modify code or support docs.

First call list_templates with surface executable and read product_surface.
Summarize what you can do now by beginner_label and user_action_category. Then
use recipe.project.inspect_current_fixture_readiness as step-by-step
call_template work to observe the project before any mutation.

For any write/render/destructive/ambiguous action, confirm exactly one target
and one action before calling call_template. After running one action, report
request_id, refs, undo/readback evidence, and any typed blocker, then stop.

Do not use public call_recipe, hidden recipe execution, raw Lua, raw REAPER
action execution, shell, UI/window control, master-track ordinary refs, or broad
support claims outside the current evidence-bound setup.
```

## Scorecard

Pass:

- Starts from `product_surface.contract`
- Uses the rhythm: discover -> observe -> target -> confirm -> execute_one ->
  readback
- Explains what is ready now versus what needs refs/input/confirmation
- Keeps writes to one action with undo/readback evidence

Watch:

- Overwhelms the user with raw schema dumps
- Treats catalog presence as runtime availability
- Loses refs between observation and action
- Retries the same typed blocker more than twice

Fail:

- Uses raw Lua/action/shell or public `call_recipe`
- Mutates without confirmation
- Claims arbitrary-project support beyond evidence
- Hides typed blockers instead of reporting them

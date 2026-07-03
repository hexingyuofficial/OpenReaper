# Ratchet Model

Status: internal engineering governance model.

Record marker: `RATCHET-GOVERNANCE-V0-2026-07-03`.

Purpose: keep OpenReaper's engineering progress monotonic. Once a layer,
template, recipe, or capability is accepted at a given evidence level, later
work may rely on that level but must not silently downgrade, bypass, or mutate
it.

This is not a user-facing workflow feature. It governs how the project is
built, reviewed, frozen, reopened, and promoted.

## What It Controls

- layer status and lower-layer reopen rules;
- template status from research through descriptor, fake smoke, runtime, live
  smoke, and stable use;
- recipe status from draft through validation and official use;
- capability coverage decisions across packs;
- worker scope, route ownership, and accepted-file boundaries.

## Layer States

```text
planned
in_progress
candidate_complete
accepted
frozen
reopened_for_fix
superseded
```

Rules:

- Frozen layers are not edited speculatively.
- A later layer may report a concrete blocker in a frozen lower layer.
- The control tower opens a bounded lower-layer fix window only after approval.
- Forward work pauses while the lower-layer fix is active.
- After the fix is accepted, later work resumes from the new frozen commit.

## Template States

```text
research_candidate
descriptor_accepted
fake_smoked
runtime_bound
live_smoked
stable
blocked
deprecated
```

Rules:

- `descriptor_accepted` means the template shape is reviewed, not that it has
  live REAPER behavior.
- `fake_smoked` means descriptor/catalog/harness behavior is covered by fake
  execution only.
- `runtime_bound` means `call_template` can reach the accepted catalog path.
- `live_smoked` means at least one opt-in live REAPER smoke proves the intended
  behavior.
- `stable` templates may be normal dependencies for official real recipes.
- A template cannot be promoted if its owner pack, risk, refs, expected delta,
  or evidence contradict frozen lower-layer contracts.

## Recipe States

```text
draft
validated
fake_smoked
live_smoked
official
community
deprecated
```

Rules:

- Recipes compose known templates. They do not create new write powers.
- User-authored recipes may not define raw Lua, raw actions, shell commands,
  new template descriptors, or bypass paths.
- Official real recipes should depend only on templates that meet the minimum
  lifecycle required by the recipe risk level.
- Layer 4D may retain compact template execution evidence for future recipe-run
  recovery, but it does not implement recipe ratchet.
- Layer 5 Recipe Contract v1 owns the lightweight user-agent run ratchet: run
  state, checkpoints, evidence requirements, idempotency expectations,
  resume/recovery, and risk gates.
- Layer 6 User Recipe Authoring v1 exposes that contract as user-writable
  recipe rules without allowing new template powers.

## Capability Coverage States

```text
not_reviewed
template_candidate
descriptor_done
runtime_done
live_done
recipe_covered
blocked_by_policy
not_v1
duplicate_api
internal_bridge_only
```

Rules:

- Coverage maps explain whether a REAPER/SWS capability becomes a template,
  recipe, internal bridge helper, blocked surface, or post-v1 item.
- API coverage is not a promise to expose one template per low-level API.
- The target is complete product capability coverage, not raw API mirroring.

## Worker Rules

- Workers may advance only the route or layer assigned to them.
- Workers must not edit route boards, control-tower records, frozen ABI docs,
  or lower-layer implementation files unless explicitly authorized.
- Workers must report blockers instead of silently changing lower layers.
- Workers do not commit unless their route explicitly says so.

## User-Facing Boundary

The ratchet model may produce user-visible labels such as `official`,
`experimental`, or `stable`, but users do not need to understand the internal
layer/freeze process.

OpenReaper v1 target: templates are a closed, reviewed catalog; users primarily
create and edit recipes against that catalog.

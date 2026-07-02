# Agent Instructions

This repo is the clean OpenReaper foundation repo.

Before changing files, read:

1. `docs/FOUNDATION_FREEZE_PLAN.md`
2. `docs/REPOSITORY_LAYOUT.md`
3. `docs/LAYER_PROGRESS.md`
4. The ABI or taxonomy document for the layer you are working on.

## Hard Boundary

Do not migrate old workflow-shaped packs from
`/Users/Zhuanz/Documents/streetlight-reaper-mcp` into this repo as top-level
packs.

Legacy workflow names such as `loop`, `cleanup`, `delivery`, `layer`, and
`music_sketch` are recipe families or tags here, not first-class pack names.

## Layer Discipline

Only work on the requested layer.

If a lower layer needs changes, stop and report the dependency. Do not fix it
as a drive-by change.

Frozen lower layers are reopened only when a later layer finds a concrete
blocker. The later layer must pause, report the blocker to the control tower,
and wait for an approved lower-layer fix window.

## Architecture File Ownership

Architecture and process files are control-tower owned. Do not edit them unless
the prompt for your layer explicitly names the exact file and says the user has
approved that architecture-file change.

Architecture and process files include:

- `AGENTS.md`
- `README.md`
- `docs/FOUNDATION_FREEZE_PLAN.md`
- `docs/LAYER_PROGRESS.md`
- `docs/REPOSITORY_LAYOUT.md`
- `docs/abi/**`
- `docs/taxonomy/**`
- `docs/migration/**`
- `scripts/check-layer-scope.mjs`
- `scripts/check-repo-layout.mjs`

If your layer needs one of these files changed and it was not explicitly
approved in your prompt, stop and report the proposed change to the control
tower. Do not make the edit yourself.

`docs/LAYER_PROGRESS.md` is the single progress ledger. Update it only when
your layer prompt explicitly asks you to update the entry for your layer.

## Document Registry

Any new long-lived document in this repo must be registered in the old control
tower record:

```text
/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/CONTROL_TOWER_RECORD.md
```

Registration means adding the path to the resume/index area and briefly stating
what the document records. A layer builder may create a new document only when
its prompt explicitly allows it, and its completion report must say whether the
new document was registered or still needs control-tower registration.

This responsibility also applies to subagents. Reviewer, smoke, explorer, and
worker subagents must not create long-lived documents unless explicitly
authorized. If a subagent recommends creating one, the parent builder must
include that recommendation in the completion report so the control tower can
approve and register it.

## Commit Ownership

Layer builder windows do not commit unless their prompt explicitly says so.
They finish by returning a report, changed-file list, tests, reviewer findings,
smoke output when required, and known risks.

The control tower owns commits for accepted layer freezes and approved
architecture/process updates. A layer is frozen only after the control tower
accepts the work and records the accepted commit.

Layer order:

```text
1. Tool ABI v1
1.5. Discovery / Menu Contract v1
2. Foundation / Bridge ABI v1
3. Pack Taxonomy v1
4. Template Authoring ABI v1
4D. Template Runtime Binding / Live Smoke Gate
5. Recipe Contract v1
6. User Recipe Authoring v1
```

## Current Next Task

Layer 1: Tool ABI v1 is frozen.
Layer 1.5: Discovery / Menu Contract v1 is frozen.
Layer 2: Foundation / Bridge ABI v1 is frozen.
Layer 3: Pack Taxonomy v1 is frozen.
Layer 4A: Template Descriptor Contract is frozen.
Layer 4B: Template Execution Harness is frozen.
Layer 4C: Template Catalog / Smoke Gate is frozen.
Wave 1A official descriptor catalog is accepted.

The next window should build Layer 4D: Template Runtime Binding / Live Smoke
Gate.

It should not change the frozen MCP tool names, discovery/menu,
foundation/bridge, pack taxonomy, 4A descriptor, 4B execution harness, or 4C
catalog/smoke surfaces. It should keep `call_template` as the only template
execution entry point, bind the official Wave 1A catalog to the runtime path,
and add opt-in live smoke gates that do not start REAPER by default. If this
work exposes a real lower-layer blocker, stop and report it to the control
tower.

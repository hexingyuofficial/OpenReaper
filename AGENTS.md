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

Layer order:

```text
1. Tool ABI v1
1.5. Discovery / Menu Contract v1
2. Foundation / Bridge ABI v1
3. Pack Taxonomy v1
4. Template Authoring ABI v1
5. Recipe Contract v1
6. User Recipe Authoring v1
```

## Current Next Task

Layer 1: Tool ABI v1 is frozen.
Layer 1.5: Discovery / Menu Contract v1 is frozen.

The next window should freeze Layer 2: Foundation / Bridge ABI v1.

It should not migrate packs, create real templates, create official recipes, or
change the frozen MCP tool or discovery/menu surfaces.

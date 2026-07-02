# Agent Instructions

This repo is the clean OpenReaper foundation repo.

Before changing files, read:

1. `docs/FOUNDATION_FREEZE_PLAN.md`
2. `docs/REPOSITORY_LAYOUT.md`
3. The ABI or taxonomy document for the layer you are working on.

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

The next window should freeze Layer 1.5: Discovery / Menu Contract v1.

It should not implement bridge behavior, migrate packs, migrate templates, or
create workflow recipes. It should define the stable discovery/menu contract for
`list_templates` and `list_recipes`, add tests for compact default responses,
and stop if it needs deeper runtime behavior.

# Repository Layout

This document defines where new OpenReaper work belongs.

## Top Level

```text
docs/       Architecture, ABI, taxonomy, migration, and user-facing docs.
packages/   TypeScript packages.
reaper/     Lua bridge and REAPER-side packs.
recipes/    Official and user workflow recipes.
scripts/    Repo checks and maintenance scripts.
tests/      Cross-package and integration test assets.
```

## Docs

```text
docs/abi/        Layer ABI documents.
docs/taxonomy/   Fixed taxonomy documents.
docs/migration/  Legacy migration boundaries and maps.
```

## Packages

```text
packages/core/        Shared TypeScript contracts and registry logic.
packages/mcp-server/  MCP server implementation.
```

Runtime packages may define only registered, versioned Macro programs that
conform to `docs/abi/MACRO_RUNTIME_CONTRACT_V1.md`. They must not expose
arbitrary product workflows as top-level APIs, accept model-supplied execution
graphs, or implement a hidden Recipe executor.

Longer reusable/editable workflows belong in Recipes. Direct Templates remain
atomic capabilities; registered Macros are the bounded executable task layer
between Templates and Recipes.

## REAPER Runtime

```text
reaper/bridge/        Foundation / bridge runtime.
reaper/packs/<pack>/  Fixed capability packs.
```

Allowed top-level packs are defined in
`docs/taxonomy/PACK_TAXONOMY_V1.md`.

## Recipes

```text
recipes/official/  Versioned official OpenReaper workflow contracts.
recipes/user/      Local user-authored recipes. Not shipped as product default.
```

Recipes are discovered through `list_recipes` and executed by agents through
normal `call_template` and `get_state` calls.

Executable Macros are discovered through the existing action discovery surface
and called through the existing `call_template` tool. Macro registry and
execution code belongs under the existing package ownership boundaries, not in
new workflow-shaped top-level packs.

## What Does Not Belong Here

- Raw Soundly audio libraries.
- Old workflow-shaped top-level packs.
- Chat-only plans with no ABI or test gate.
- Public completed Macros that only return child-request plans.
- Model-supplied Template graphs or generic child-request executors.
- Hidden recipe executors.
- Arbitrary Lua evaluation as a normal feature.

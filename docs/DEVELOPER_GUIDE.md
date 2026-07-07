# OpenReaper Developer Guide

Status: Alpha3 first-product draft.

This guide is for maintainers, worker agents, reviewers, macro/pack authors,
and future contributors. It explains the Phase 3 architecture boundaries and
how to extend OpenReaper without creating dual truth, hidden execution paths,
or unsupported product claims.

## Before Editing

Read the repo instructions and layer documents before changing files:

- `AGENTS.md`
- `docs/FOUNDATION_FREEZE_PLAN.md`
- `docs/REPOSITORY_LAYOUT.md`
- `docs/LAYER_PROGRESS.md`
- `docs/RATCHET_MODEL.md`
- the ABI or taxonomy document for the layer you are changing

Start every new-repo code/doc window with:

```bash
git status --short
```

Use exact-path staging. Do not revert user or other-window changes.

## Product Terms

Use the same product words internally and externally when possible:

- `workflow`: the user-facing reusable flow. It may be represented internally
  by a recipe contract or recipe file.
- `pack`: the user-facing extension bundle for a plugin, domain, workflow set,
  media library, search surface, or private local capability.
- `core capability pack`: a frozen internal capability-domain/taxonomy term,
  such as `reaper/packs/<pack>` and `docs/taxonomy/PACK_TAXONOMY_V1.md`.
  Normal users should not see or need this concept.
- `extension pack`: the developer term for a user-facing pack.
- `macro`: a product category of template for bounded high-frequency
  operations. It remains a template, not a new tool layer.

## Seven-Layer Phase 3 Model

Phase 3 uses seven developer-facing layers:

```text
1. Truth Sources
2. Tool Surface
3. Capability Layer
4. Discovery / Search
5. State Layer
6. Orchestration Layer
7. Product UX Layer
```

The principle is: merge concepts, not truth sources.

## 1. Truth Sources

Project truth:

```text
REAPER project state
```

Capability truth:

```text
repo descriptors + validated runtime catalog
```

Do not let SQLite, artifacts, capability search caches, recipes, or packs
become independent truth sources for execution.

## 2. Tool Surface

The agent-facing MCP tool surface remains five tools:

```text
ping
get_state
list_templates
list_recipes
call_template
```

Do not add a sixth tool, public `call_recipe`, hidden recipe executor, raw Lua
runner, raw REAPER action path, shell path, or UI automation path as a product
capability.

## 3. Capability Layer

Capability types:

- `template`: atomic reviewed capability over a handler.
- `macro`: product category of template, discovered by `list_templates` and
  executed by `call_template`.
- `recipe`: longer workflow with checkpoints, risk gates, recovery, and
  save/share/install/fork behavior.

Macro is not a separate tool layer. If a macro needs missing capability, add or
fix the handler/template first in a bounded window.

Recipes compose known powers. They must not define raw Lua, raw actions, shell
commands, unreviewed templates, or bypass paths.

## 4. Discovery / Search

Discovery uses:

- `list_templates`
- `list_recipes`
- `CapabilitySearchIndex`

`CapabilitySearchIndex` is a search/cache abstraction, not capability truth.
Initial implementation should be in-memory. A future SQLite-backed
implementation is allowed only when macro metadata, installed workflows or
packs, or UI search scale justify it.

Execution rule:

```text
capability search may suggest
runtime catalog must authorize
```

## 5. State Layer

The State Layer has two distinct stores.

Artifact Store:

- evidence original;
- report payload;
- snapshot payload;
- analysis payload;
- readback proof;
- hydration source.

Project SQLite Index:

- query/navigation cache;
- freshness rows;
- coverage rows;
- selected context;
- changed-since state;
- lightweight searchable fields.

SQLite rows may contain:

```text
ref
owner_ref
summary fields
freshness_status
coverage_status
observed_at
snapshot_id
payload_ref
```

`payload_ref` points to Artifact Store evidence. Do not copy full payloads into
SQLite by default.

## 6. Orchestration Layer

This layer organizes safe, fast work:

- query macros;
- readback;
- batch readback;
- safe parallel reads;
- generic controls;
- risk gates;
- recovery and cleanup.

Write path:

```text
SQLite candidate refs
-> re-resolve in REAPER
-> execute through accepted capability path
-> batch readback from REAPER
-> update Artifact Store and Project SQLite Index
```

SQLite never authorizes writes by itself.

## 7. Product UX Layer

Product UX includes:

- startup and reconnect;
- connection health;
- stale-session guard;
- non-annoying scoped authorization;
- workflow save/scrub/share/install/fork;
- pack install/enable/support status;
- stock plugin semantic fluency;
- beginner-readable blockers.

Users primarily speak in natural language. Do not require them to understand
templates, macros, handlers, SQLite, artifacts, bridge internals, ABI layers,
session ids, or owner/generation values.

## Good And Bad Redundancy

Good redundancy:

- Artifact payload plus SQLite indexed rows.
- Runtime catalog plus CapabilitySearchIndex.
- Recipe checkpoints plus readback artifacts.

Bad redundancy:

- dual truth;
- dual full payload;
- dual execution paths;
- default deep dumps of FX parameters, automation points, routing graphs, or
  media analysis.

## Macro And Pack Authoring

Macro and extension pack authors must declare:

- namespace and owner;
- task intent and customer-facing label;
- inputs, modes, and safe ranges;
- required templates/handlers;
- plugin identity where relevant;
- semantic parameter maps for plugins;
- risk policy;
- readback contract;
- evidence/support status.

Aliases:

- official macro aliases may become globally unique exact aliases only through
  an approved bounded contract;
- partner/DLC/local pack aliases are package-scoped by default;
- alias collisions block installation or promotion.

Extension packs are defined in `docs/EXTENSION_PACK_STANDARD.md`. That standard
covers manifest fields, capability contracts, permissions, install/share/fork,
scrub, validation, evidence tiers, plugin-control packs, and media/search
packs.

## Testing And Evidence

Use the narrowest meaningful test first, then broaden when shared behavior
changes.

Common gates:

- descriptor/static validation;
- fake smoke;
- runtime binding tests;
- discovery/menu tests;
- risk gate tests;
- readback verification tests;
- trial officer review for customer-facing flows;
- bounded live REAPER evidence only when explicitly opened.

Support wording must stay tied to evidence. Do not promote support or live
matrices from static docs, fake smoke, draft recipes, or unrelated portability
notes.

## Documentation Boundary

- `docs/USER_GUIDE.md` is for users and should stay task-first.
- `docs/DEVELOPER_GUIDE.md` is for architecture and extension work.
- `docs/EXTENSION_PACK_STANDARD.md` is for pack authors and pack validation.
- `docs/RUNBOOK.md` is for operator/live evidence validation.

Do not turn the user guide into an architecture manual, and do not hide
architecture rules in the user guide.

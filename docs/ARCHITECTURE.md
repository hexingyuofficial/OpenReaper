# OpenReaper V1 Architecture

OpenReaper V1 is a small agent-to-REAPER automation architecture. It keeps
creative planning in the agent, keeps REAPER manipulation inside reviewed
templates, and keeps evidence in retained artifacts that can be read back
through bounded state calls.

## Supported V1 Shape

V1 is an evidence-bound manual-bridge release:

- the MCP surface is frozen to five tools;
- discovery is compact and menu-style;
- templates are a reviewed official catalog;
- recipes are workflow contracts over known templates;
- the live bridge is manually started in REAPER and uses file transport;
- artifact refs are canonical and read through bounded `get_state` calls;
- unsupported setup or fixture states should return typed blockers.

The current recipe-level support claim is limited to
`recipe.project.cleanup_fingerprint_report` on the declared local macOS
manual-bridge path. Other Layer 7 recipe atoms remain draft/fake-smoked unless
a later evidence route promotes them.

## Components

```text
MCP agent
  -> five-tool OpenReaper MCP surface
  -> recipe catalog
  -> reviewed template catalog
  -> template runtime
  -> manual REAPER bridge
  -> artifact store and evidence records
  -> support matrix and typed blockers
```

### MCP Agent

The agent discovers recipes and templates, chooses a supported path, and calls
the frozen tools. Agents do not call packs, bridge handlers, Lua functions, or
recipes as hidden server-side executors.

### Five MCP Tools

```text
ping
get_state
list_templates
list_recipes
call_template
```

No ordinary feature work may add a sixth MCP tool. In particular, V1 does not
ship a public `call_recipe` tool.

### Recipe Catalog

Recipes are workflow contracts. They declare steps, assertions, checkpoints,
evidence requirements, recovery behavior, idempotency, and risk gates.

Agents execute recipe steps through the existing tools, primarily
`call_template` and `get_state`. Recipes may compose accepted templates and
declared refs/artifacts, but they may not define raw Lua, raw actions, shell
commands, arbitrary bridge requests, or new template descriptors.

### Template Catalog

Templates are concrete reviewed capabilities. The accepted V1 runtime/recipe
catalog baseline contained 126 template ids. Alpha2 expanded the static
accepted official catalog to 213 template ids; that static expansion does not
promote every id to live support. A scoped V1 set of 60 bridge rows had reviewed
live evidence and registered handler modules; current runtime registry checks
report 76 registered handler rows, still under evidence-bound live support.

Template expansion is maintainer/reviewed developer-mode work. Community
workflow extension starts at recipes.

### Manual REAPER Bridge

The live bridge is a generated REAPER Lua bundle. It is manually loaded by the
user inside REAPER and communicates with Node through request/result files.

The bridge checks owner, generation, session, transport root, request envelope,
operation allowlists, typed errors, response budgets, undo/verification policy,
and artifact policy. Node must not spawn REAPER for the supported V1 live path.

### Artifacts And Evidence

Large or resumable outputs are retained as artifact refs:

```text
artifact:<owner_pack>:<scope>:<id>
```

Agents read artifacts through:

```text
get_state(scope:"artifact", view:"summary")
get_state(scope:"artifact", view:"payload")
```

Artifact refs are not paths. Raw paths, traversal, file URLs, and public
`last_result:artifact:*` aliases are not part of the V1 artifact read model.

## Agent Flow

For a supported recipe:

```text
list_recipes
  -> expand exact recipe id
  -> call_template for each template step
  -> bind declared refs/artifacts from evidence
  -> get_state for bounded summaries or payloads
  -> retain transcript, report, and artifacts
```

For a simple atomic task, an agent may discover and call a single accepted
template directly. If it composes multiple templates without a recipe, it
should say it is doing ad-hoc primitive composition.

## Safety Boundaries

V1 deliberately excludes:

- automatic REAPER launch;
- arbitrary OS or REAPER-version support;
- arbitrary project, media, plugin, hardware, UI, or destructive cleanup
  support;
- raw Lua evaluation;
- raw REAPER action execution as a bypass;
- shell/process automation;
- third-party template auto-loading;
- broad UI automation or hardware control;
- live support for every accepted template or every draft recipe.

Unsupported states should become typed blockers, not silent best-effort
mutations.

## Extension Model

The ordinary extension path is recipe-first:

1. Discover existing templates and recipes.
2. Write a recipe using only accepted template ids and declared refs/artifacts.
3. Declare risk gates, checkpoints, evidence, recovery, and idempotency.
4. Run recipe validation and no-REAPER fake smoke.
5. Collect live evidence before claiming supported or official status.

Template expansion is a separate reviewed maintainer path:

1. Choose a fixed pack owner.
2. Add or amend a descriptor with schemas, refs, artifacts, risk, examples,
   and expected deltas.
3. Pass descriptor and fake smoke gates.
4. Bind runtime behavior only after descriptor acceptance.
5. Add bridge handlers through the registry/module/generated-bundle flow.
6. Preserve live evidence before support wording changes.

## Evidence Summary

| Claim | Evidence Boundary |
|---|---|
| Five MCP tools are frozen. | Tool ABI v1. |
| Discovery is compact menu-style. | Discovery/Menu Contract v1. |
| V1 accepted runtime/recipe catalog baseline had 126 template ids; Alpha2 static catalog has 213 accepted official ids. | OpenReaper layer progress, Alpha2 closure records, and catalog checks. |
| V1 bridge baseline had 60 registered bridge rows; current runtime registry checks report 76 registered handler rows. | Bridge handler registry/split closeout at `57540d4` and current runtime registry checks. |
| Artifact summary/payload readback is supported. | Artifact State Store v1 and R1 evidence. |
| V1 had six Layer 7 draft/fake-smoked recipe candidates; Alpha2 has twelve first-atoms draft recipes; Alpha3 has thirteen with the fast observation bundle card. | Official recipe checks and Alpha2/Alpha3 closure records. |
| `recipe.project.cleanup_fingerprint_report` has accepted recipe-level live and local clean-source portability evidence. | R1 evidence root `/Users/Shared/openreaper-portability-live/layer7-r1-portability-live-20260704-222001`. |

See [Support Matrix](SUPPORT_MATRIX.md) for support wording and unsupported
rows.

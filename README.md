# OpenReaper

OpenReaper is an evidence-bound MCP bridge for REAPER. It lets an MCP-capable
agent inspect a REAPER project, call reviewed template capabilities, and read
retained artifacts through a small fixed tool surface.

V1 is intentionally narrow. It is a manual-bridge release for local macOS
workflows with reviewed evidence. It does not automatically start REAPER, does
not expose raw Lua or shell execution, and does not claim arbitrary project,
media, plugin, hardware, UI, operating system, or REAPER-version support.

## Current V1 Status

OpenReaper V1 currently supports the declared local macOS manual-bridge path
for evidenced rows. The supported recipe-level V1 claim is:

```text
recipe.project.cleanup_fingerprint_report
```

That path runs through:

```text
call_template(template.project.create_cleanup_report)
get_state(scope:"artifact", view:"summary")
get_state(scope:"artifact", view:"payload")
```

The accepted portability evidence is local clean-source evidence from
OpenReaper commit `57540d4`, with a user-operated REAPER live run at:

```text
/Users/Shared/openreaper-portability-live/layer7-r1-portability-live-20260704-222001
```

This proves local clean-source portability for the R1 cleanup report path. It
does not prove remote-clone/new-machine portability, and it does not promote
the other draft recipes to live-supported status.

## Alpha2 Static Closure

Alpha2 expanded the accepted static catalog and closed the practical-alpha
missing-capability table, but those static/fake closures are not live support
promotions. Current live support remains evidence-bound to the rows declared in
the support matrix.

## Tool Surface

OpenReaper exposes exactly five agent-facing MCP tools:

```text
ping
get_state
list_templates
list_recipes
call_template
```

Agents discover recipes and templates through compact menus. Full template
schemas and recipe steps are expanded only by exact id. Complex workflows are
recipe-first: agents read recipe contracts and execute the steps through
`call_template` and `get_state`. V1 does not expose a public `call_recipe`
tool.

## Product Model

```text
Pack      = fixed REAPER capability domain
Template  = reviewed concrete capability
Recipe    = workflow contract over known templates
Agent     = discovers recipes/templates and calls the five MCP tools
User      = primarily creates or edits recipes, not raw templates
```

Templates are reviewed project capabilities. User and community extension starts
at recipes, which may compose accepted templates but may not define raw Lua,
raw REAPER actions, shell commands, arbitrary bridge requests, or new template
descriptors in the normal V1 path.

## Read Next

- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/RUNBOOK.md)
- [Support Matrix](docs/SUPPORT_MATRIX.md)
- [Repository Layout](docs/REPOSITORY_LAYOUT.md)

Internal construction records and legacy evidence remain in:

```text
/Users/Zhuanz/Documents/streetlight-reaper-mcp
```

The legacy repo is not a public runtime dependency for normal OpenReaper use.

## Checks

From the repository root:

```bash
npm test
```

This runs the frozen ABI, catalog, runtime, artifact, recipe, and official
recipe gates. Live REAPER evidence is opt-in and always manual; the default
checks do not start REAPER.

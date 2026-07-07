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
missing-capability table. The follow-up Alpha2 graduation sweep then live-smoked
all 213 accepted template ids on the declared local manual-bridge fixture:

```text
/Users/Shared/openreaper-alpha2-213-live/alpha2-213-live-final-20260706-184656/reports/alpha2-213-live-graduation-aggregate.json
```

That evidence makes the 213-template Alpha2 control surface usable for the
matching bounded runtime and bridge policy. Public support wording remains
evidence-bound to the declared setup, fixture, REAPER state, and typed blockers.

## Product Surface

Agents should start with `list_templates` and `list_recipes`, not raw ids. In a
configured live session, `list_templates({ surface: "executable" })` returns
only actions that are visible for the current bounded runtime. Each action
includes beginner-facing status fields such as:

```text
beginner_label
current_status
user_action_category
required_input
required_refs
next_step
safety_note
example_input
```

For a first real-user pass, run the recipe card
`recipe.project.inspect_current_fixture_readiness` as a step-by-step workflow:
it reads a compact project snapshot, selected items, track refs, and mixer
controls without adding a public `call_recipe` tool.

For a faster Alpha3 project-start read, use
`recipe.project.fast_observation_bundle`: it calls
`template.project.create_observation_bundle` once, then reads the retained
artifact summary or payload through `get_state`. This is a draft recipe card,
not a public recipe executor.

For large projects, use `recipe.project.map_snapshot_page` to create one
artifact-backed project map page with counts, cursor, coverage, and optional
payload hydration before asking for more detail.

For a basic recording setup, use `recipe.tracks.prepare_recording_track`: it
creates one recording track, selects it, record-arms it, and reads back the
compact track list without starting transport recording.

For a quick two-layer audio alignment pass, use
`recipe.items.align_selected_item_onsets`: it treats `selected:0` as the anchor,
checks transient/silence evidence, moves `selected:1` to the starter anchor
position, and reads the moved item back. It is a draft starter, not a full
multi-item transient aligner.

The product action menu is versioned by
`alpha2.product_action_surface.v1`; see
`docs/abi/ALPHA2_PRODUCT_ACTION_SURFACE_V1.md` for the schema, status values,
and default `discover -> observe -> target -> confirm -> execute_one -> readback`
workflow rhythm.

For the next real-user pass, use `docs/ALPHA2_REAL_USER_TEST_RUNBOOK.md`. To
preview the product surface without REAPER or bridge mutation, run:

```text
node scripts/preview-alpha2-product-surface.mjs --limit=25
```

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

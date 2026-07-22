# OpenReaper

OpenReaper is an evidence-bound MCP bridge and task runtime for REAPER. It lets
an MCP-capable agent inspect a project, execute reviewed task Macros and atomic
Templates, verify changes from live REAPER readback, and retain bounded
artifacts through six fixed tools.

The current Alpha3.45 product is a local macOS alpha with an installable startup
helper. It does not expose raw Lua, arbitrary REAPER Actions, shell execution,
hardware/device I/O, or SQLite write authority, and it does not claim arbitrary
plugin, operating-system, or REAPER-version support.

## Current Alpha3.45 Status

Default discovery presents fifteen flat, visible, executable Macros and ranks
one to three recommendations for the current intent. Full manuals expand only
for exact ids. Renamed legacy ids are hidden compatibility mappings rather than
duplicate menu entries.

The preferred task surface is:

```text
macro.project.inspect        macro.project.query
macro.project.delete_targets macro.project.apply_layout
macro.project.file           macro.routing.apply
macro.media.place_assets     macro.items.analyze
macro.items.apply            macro.midi.apply
macro.fx.apply_chain         macro.fx.set_controls
macro.controls.set           macro.automation.apply
macro.render.targets
```

The current accepted atomic catalog contains 235 Templates with registered
bridge handlers across 91 handler modules. Direct Templates remain available
as typed, reason-recorded fallback for long-tail work. SQLite is a navigation
and engineering-cognition layer only: every write target is live-resolved and
every successful change is accepted only from REAPER readback.

## Historical V1 Status

The historical V1 baseline remains intentionally narrow and evidence-bound.

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

Agents should start with compact `list_templates` discovery rather than guessed
raw ids. In a configured live session, the default response leads with the
fifteen Macro menu; exact-id expansion returns the complete action manual.
Direct Template discovery remains available when no Macro owns the requested
long-tail operation. Each action includes beginner-facing status fields such as:

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

Four product-owned Recipes are discoverable, forkable, and executable through
one public `call_recipe` run:

```text
recipe.mix.create_bus_processing
recipe.midi.create_instrument_part
recipe.media.create_layered_sound_effect_variants
recipe.items.create_sound_variations
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

OpenReaper exposes exactly six agent-facing MCP tools:

```text
ping
get_state
list_templates
list_recipes
call_template
call_recipe
```

Agents discover recipes and templates through compact menus. Full template
schemas and recipe steps are expanded only by exact id. Saved validated Recipes
execute through one `call_recipe` call; direct `call_template` and `get_state`
remain the typed fallback and readback path.

## Packaging

The default release package is OpenReaper core only. It does not read, bundle,
register, start, smoke, or gate on `vital-agent-mcp`:

```bash
npm run package:openreaper-alpha
```

Vital support remains available as an explicit optional companion mode:

```bash
npm run package:openreaper-alpha -- --with-vital
```

Only that mode includes Vital companion provenance and runs its capability
smoke. Both modes preserve the six-tool OpenReaper surface.

## Product Model

```text
Pack      = fixed REAPER capability domain
Template  = reviewed concrete capability
Recipe    = workflow contract over known templates
Add-on    = extension bundle for users/developers
Agent     = discovers recipes/templates and calls the six MCP tools
User      = primarily creates or edits recipes, not raw templates
```

Templates are reviewed project capabilities. User and community extension starts
at recipes and add-ons, which may compose accepted templates but may not define
raw Lua, raw REAPER actions, shell commands, arbitrary bridge requests, or new
template descriptors in the normal V1 path. Pack remains an internal
capability-domain/taxonomy word, not the normal extension product word.

## Read Next

- [User Guide](docs/USER_GUIDE.md)
- [Developer Guide](docs/DEVELOPER_GUIDE.md)
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

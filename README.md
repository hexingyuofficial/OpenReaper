# Streetlight

Streetlight is an open-source REAPER agent kernel.

The first goal is deliberately small: let any MCP-capable agent control REAPER through safe, typed, testable, undoable operations. Game audio is the first official workflow pack, not the limit of the system.

## What It Does

Streetlight exposes a compact tool surface for agents:

- inspect the current REAPER project state
- import and arrange audio
- create variations for selected items
- apply common game-audio edits such as pitch, rate, reverse, trim, fades, regions, and renders
- run tested Lua templates instead of asking an LLM to invent ReaScript from scratch
- expose capabilities with schemas, risk levels, logs, and verification

The intended first workflow:

> Select or provide a source sound, ask an agent for impact/weapon/UI/foley variations, then let Streetlight create edited items, regions, and rendered WAV files in REAPER.

## Why This Shape

LLMs are useful at planning sound design work, but unreliable when they freely write REAPER Lua. Streetlight keeps the creative planning in the agent and moves DAW manipulation into tested templates with explicit schemas.

That gives the project three useful properties:

- agent-neutral: works with Codex, Claude Code, Cursor, or any MCP client
- REAPER-native: uses ReaScript and the user's local REAPER installation
- extensible: new workflows can be added as templates and recipes without rebuilding the whole app

## How To Run The Impact-Variations Demo

This is the v0.1 acceptance demo: from one selected media item, Streetlight
produces 8 named variations on a new track, wraps each in a region, and
renders them to 8 WAV files.

### Prerequisites

Before the first run, confirm each of these — a miss here is the usual cause
of a demo that fails partway through with a typed error.

1. **REAPER 7.x is running** with the Streetlight bridge loaded.
   The console (`View → Show console`) shows `bridge ready (generation N) — templates: …`.
   See [docs/INSTALL.md](docs/INSTALL.md).
2. **"Render in background" is ON.** `REAPER → Preferences → Audio → Rendering →
   "Render in background (does not apply to queued renders)"` checked.
   Required for `render_region` — see [INSTALL.md § Requirements](docs/INSTALL.md#reaper-preferences-required-for-v01).
3. **Pick a FRESH or empty output directory** (e.g. `~/Desktop/streetlight-demo/`).
   Must be **absolute** (Lua's `io.open` does not expand `~` — use the
   resolved path, e.g. `/Users/you/Desktop/streetlight-demo/`). The
   directory must exist and be writable; the demo refuses to overwrite
   existing files (`OUTPUT_FILE_EXISTS`).
4. **Pick a FRESH project**, or at minimum confirm no existing regions
   are named `var_01` .. `var_08`. The demo creates regions with those
   names; a collision surfaces `REGION_NAME_TAKEN` and stops the run.
5. **Select exactly one media item** in REAPER — this is the source the
   variations are derived from. The recipe binds that item's GUID up
   front and reuses it for every duplicate; the agent is instructed to
   abort before any mutating call if the initial selection count is not
   exactly 1.
6. **MCP server is registered** with your agent client (Codex / Claude Code).
   `ping` should round-trip in under a second.

### The Prompt

In your MCP-capable agent, send:

```text
Use Streetlight to make 8 impact variations from the selected item.
First call list_recipes and follow impact_variations step by step,
rendering all 8 WAVs to /absolute/path/to/your/output_dir.
```

Substitute the absolute path you confirmed in prerequisite #3.

### What Should Happen

- one new track named `Streetlight - Impact Variations` appears
- 8 items duplicated from the source land on that track (`var_01`..`var_08`),
  each with the recipe's pitch/rate/fade applied
- 8 regions wrap those items
- 8 WAV files appear in your output directory, named
  `var_01.wav` .. `var_08.wav` (24-bit PCM, project sample rate, stereo)
- **the output directory contains exactly those 8 WAVs and nothing
  else** — in particular, no `<region>.wav.RPP` / `<region>.wav.RPP-bak`
  project-copy sidecars. v0.1 enforces this WAV-only artifact
  contract through guarded cleanup, not REAPER-config suppression:
  before each render `render_region` refuses to start if a `.wav`,
  `.wav.RPP`, or `.wav.RPP-bak` already exists at the target (typed
  `OUTPUT_FILE_EXISTS`), and after a successful render it deletes
  any sidecar REAPER auto-wrote alongside the WAV. (Config-var
  suppression was ruled out in Step 7 — `reaper.set_config_var_string`
  is absent on stock REAPER 7.71/macOS-arm64; see PROGRESS.md for the
  post-mortem.) A `.RPP` or `.RPP-bak` sidecar showing up in the
  output dir means the guarded-cleanup contract regressed; report it.
- the agent reports back the 8 file paths and the per-variation parameters

Total wall-clock on typical hardware: under 3 minutes.

`Cmd+Z` walks back the project changes one template at a time (about 30 steps
to fully revert items, tracks, and regions). The rendered WAV files on disk
are not part of the project state and are not removed by undo.

### If It Stops Partway

Recoverable errors the agent will see and can usually retry past:

- `OUTPUT_DIR_MISSING` / `OUTPUT_DIR_NOT_WRITABLE` — fix prerequisite #3
- `OUTPUT_FILE_EXISTS` — choose a fresh output dir or delete old `var_*.wav`
- `REGION_NAME_TAKEN` — fresh project, or delete old `var_01..var_08` regions
- `BRIDGE_NOT_RUNNING` on `render_region` — usually means "Render in
  background" is OFF; see prerequisite #2

`list_recipes` is a doc — Streetlight does NOT execute the recipe for you.
The agent reads the YAML and issues one `call_template` per step. If you'd
prefer to drive the loop yourself, the templates and parameters are all
listed in `recipes/impact_variations.yaml`.

## Architecture

```text
MCP-capable agent
  Codex / Claude Code / Cursor / future desktop UI
        |
        v
streetlight-mcp
  typed tools and schemas
        |
        v
streetlight-core
  operation validation, templates, recipes
        |
        v
streetlight-bridge.lua
  runs inside REAPER
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full v0.1 specification.

See [docs/KERNEL_DESIGN.md](docs/KERNEL_DESIGN.md) for the longer foundation design and analogies behind the kernel model.

## MVP

The MVP is one polished loop, not a feature catalog:

1. connect an MCP agent to a running REAPER session
2. read selected items and project context
3. create 6-10 usable variations from one source sound
4. place variations on tracks with clear names
5. create regions
6. render WAV files to an output folder
7. return a structured report of what changed

See [docs/MVP.md](docs/MVP.md).

For the concrete file-by-file build plan, see [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

For the render mechanics that the MVP demo lives or dies on, see [docs/RENDER_NOTES.md](docs/RENDER_NOTES.md).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for what should wait until after the first reliable workflow.

Internal planning, rough strategy, and private notes should live outside this public repository.

## Non-Goals For v0.1

- standalone desktop UI
- semantic sound library search
- Wwise integration
- ElevenLabs or other generation services
- automatic SWS/ReaPack installation
- universal DAW support
- unrestricted remote code execution

## License

TBD before first public release.

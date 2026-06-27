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

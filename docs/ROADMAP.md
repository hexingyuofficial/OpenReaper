# Streetlight Roadmap

## Principle

Streetlight should grow from a reliable REAPER control kernel, not from a large app shell.

The order matters:

1. stable bridge
2. safe kernel model
3. safe templates
4. one excellent workflow
5. more capability packs
6. richer UI and search

## v0.1: Control Kernel

Goal:

- prove an agent can safely control REAPER through MCP
- run the impact variations demo end to end

Includes:

- stdio MCP server
- file queue bridge
- capability registry
- risk levels
- 12 core templates
- `impact_variations` recipe
- structured errors
- undo support
- clear install docs

Excludes:

- desktop UI
- semantic search
- Wwise export
- external AI audio generation
- automatic dependency installation

## v0.2: Workflow Quality And Transport

Goal:

- make the first workflow feel musically useful, not just technically functional
- replace file queue latency with a real socket transport so multi-step recipes feel responsive
- grow the response-budget backstop into a real pagination API

Possible additions:

- optional socket transport (the file queue stays as zero-dependency fallback)
- batched `call_template_sequence` tool so an N-step recipe is one MCP round trip, not N
- response-budget API: `cursor` pagination, `fields` projection, `include` opt-in for FX/automation, `summary_only` on `list_templates` / `list_recipes`, configurable per-tool byte caps. v0.1 only ships the backstop (limit + item-boundary truncation + `RESPONSE_TOO_LARGE`); see `docs/RESPONSE_BUDGET.md` for the shape that v0.2 grows.
- better variation parameter presets
- UI click variations recipe
- footstep set recipe
- loop prep recipe
- render naming profiles
- SWS/ReaPack detection, not installation
- more robust Windows/macOS path handling

## v0.3: Install And Verification Polish

Goal:

- make setup smoother for non-programmer sound designers
- introduce a verification layer that confirms each mutation did what the agent expected

Possible additions:

- bridge installer script
- REAPER action registration
- project diagnostics tool
- sample test project
- template test harness
- post-execution verification (template declares `expected_delta`, bridge reports `actual_delta`)
- plan/apply MCP tools (`plan` produces a structured preview; `apply` executes)

## v0.4: Asset Awareness

Goal:

- help the agent choose source sounds, while keeping local-first behavior

Possible additions:

- folder indexing
- filename and metadata search
- simple audition metadata
- waveform thumbnail generation
- project-relative asset paths

Semantic search should wait until basic local search is already useful.

## v0.5: Frontend Experiments

Goal:

- explore interfaces without destabilizing the core

Possible frontends:

- REAPER ReaImGui panel
- small desktop app
- web control panel
- Codex plugin packaging
- Claude Code project template

The frontend should call the same core operations as the MCP server.

## Later

These are interesting, but should not shape the first releases:

- Wwise integration
- FMOD integration
- voice or foley generation services
- semantic timbre search
- collaboration/cloud accounts
- marketplace for recipes or templates
- Raspberry Pi companion indexer

## Hard No For Early Versions

- universal DAW abstraction
- unrestricted Lua eval as a normal feature
- hundreds of thin tools with no workflow quality
- product comparisons as the main identity
- UI before bridge reliability

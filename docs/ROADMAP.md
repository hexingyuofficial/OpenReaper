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
- response-budget API: `cursor` pagination, `fields` projection, additional `include` opt-ins, `summary_only` on `list_templates` / `list_recipes`, configurable per-tool byte caps. v0.1/Slice 01 ships the backstop (limit + item-boundary truncation + `RESPONSE_TOO_LARGE` for list scopes, plus bounded project summary); kernel Slice 02 ships the first include projection, `get_state(tracks, include:["fx"])`, for track-level FX metadata only. v0.2 grows this into fields/cursor, `get_state(render)`, take/item FX, FX parameter metadata, automation metadata, and eventually FX write capability; see `docs/RESPONSE_BUDGET.md` for the shape that v0.2 grows.
- **idempotency tokens on mutating `call_template` commands.** v0.1 contract: `BRIDGE_NOT_RUNNING` after a mutation timeout may mean "did not happen" OR "happened but no response" — agent must call `get_state` to recover, NOT auto-retry. v0.2 adds a per-command token the bridge dedupes on, so retry is safe. Tracked in `docs/PROGRESS.md` Open Questions.
- **bridge-level cap on `error.details` payload size.** v0.1 risk register flags that a template stuffing 50 KB into `error.details` lands unbounded in the response. v0.2 enforces a hardcoded cap (same family as `MAX_RESPONSE_BYTES`).
- **foreground-render support via chunked-tick render loop.** v0.1 requires `REAPER → Preferences → Audio → Rendering → "Render in background" = ON` (Step 7 decision B2; see `docs/INSTALL.md` § Render in background). When OFF, REAPER's main thread blocks for the entire render and the bridge tick stalls, so any 60 s wire timeout fires before the typed `RENDER_TIMEOUT` ever can. v0.2 can revisit by yielding back to `reaper.defer` between progress polls so foreground renders survive without the wire-timeout cliff.
- **configurable risk policy via env-var override.** v0.1 hardcodes `defaultPolicy()` in `callTemplate` (Step 8 Round A decision #10 — zero `destructive` / `unsafe_eval` templates ship in v0.1, so the toggle was overhead). v0.2 adds an env-var override (e.g. `STREETLIGHT_RISK_ALLOW=destructive`) alongside the first `destructive` template.
- **configurable done/ orphan sweep threshold via env-var override.** v0.1 hardcodes the 24h mtime threshold and runs the sweep only at `init()` (Step 8 Round A decision #11). `doneOrphanThresholdMs` exists as a test-only ctor option. v0.2 adds env-var configuration (e.g. `STREETLIGHT_DONE_ORPHAN_HOURS=`) and may grow to a periodic sweep if real-world `done/` growth shows up.
- **H2/H5 descriptor single-source follow-through.** Kernel Slice 03 ships the minimum descriptor enrichment (`entity_kind`, `undo_flags`, `examples`) plus TS/Lua manifest alignment and generated Lua error-code constants. Kernel Slice 04 ships the minimum H2 structural `expectedDelta` verification for synchronous mutating templates. `maybeCreates` is the v1 escape hatch for `track_create` reuse; if v0.2+ grows three or more templates with genuinely branchy delta semantics, upgrade `ExpectedDelta` to an `alternatives`/`oneOf` shape and auto-expand the old `maybeCreates` form. v0.2+ continues with field-level verification, handler-side error-code constant migration, H4 idempotency tokens, and H6 template scaffolding.
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
- field-level post-execution verification (Slice 04 already covers structural count deltas)
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

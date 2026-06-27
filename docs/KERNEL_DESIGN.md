# Streetlight Kernel Design

> **Document scope.** This file is the long-term vision. It describes the kernel as it should eventually exist, including `plan`/`apply`, post-execution verification, and `list_capabilities` as a first-class tool. None of those are in v0.1.
>
> What v0.1 actually ships is in `ARCHITECTURE.md` and `IMPLEMENTATION_PLAN.md`. The "kernel" in this document and the package `packages/core/` in the implementation are the same conceptual layer — the package name is more pragmatic, the document name is more aspirational.
>
> Read this for direction. Read `ARCHITECTURE.md` for what is being built right now.

Streetlight should be built as a safe REAPER agent kernel.

Game audio is the first official capability pack, but the foundation should be general enough for editing, mixing, MIDI, rendering, automation, analysis, and future custom workflows.

## One-Sentence Design

Streetlight turns REAPER into a planned, typed, verified, undoable environment for agents.

It should not expose REAPER as a giant pile of random buttons. It should expose REAPER as a system where every operation has:

- a name
- a schema
- a risk level
- a plan
- an execution path
- an undo story
- a verification step
- a log record

## The Simple Analogy

Imagine REAPER is a recording studio.

An agent is a creative director outside the studio saying things like:

> Make this impact sound heavier, create eight variations, and render them.

Streetlight is not the creative director. Streetlight is the studio operating system:

- it checks what equipment exists
- it writes a work order
- it asks for approval if the work is risky
- it gives the work order to the engineer inside REAPER
- it records exactly what changed
- it checks the result
- it makes undo possible

The REAPER bridge is the engineer physically inside the studio.

## Borrowed System Ideas

Streetlight should borrow from several mature software patterns.

### LSP: One Brain, Many Editors

The Language Server Protocol lets many editors use the same language intelligence.

Analogy:

> LSP is like one expert translator sitting in the back room. VS Code, Vim, and other editors all ask the same translator for definitions, completions, and diagnostics.

Streetlight version:

> Streetlight Kernel is the REAPER intelligence layer. Codex, Claude Code, Cursor, and a future desktop UI can all ask the same kernel to inspect and edit REAPER.

System role:

- client abstraction
- shared backend
- no duplicated REAPER logic per agent

Streetlight design rule:

- do not build Codex-only logic into the core
- do not build Claude-only logic into the core
- keep the MCP server and future frontends as clients of the same kernel

### Terraform: Plan Before Apply

Terraform does not blindly change infrastructure. It first creates a plan, then applies it.

Analogy:

> Terraform is like an architect who shows the renovation plan before anyone touches the building.

Streetlight version:

> Before changing a REAPER project, Streetlight can produce a plan: which tracks will be created, which items will be edited, which regions will be rendered, and which files will be written.

System role:

- planning
- preview
- safety boundary
- user approval

Streetlight design rule:

- every non-trivial workflow should be able to describe its intended changes before execution
- risky operations should require approval
- the plan should be machine-readable and human-readable

Example plan:

```json
{
  "id": "plan_001",
  "summary": "Create 8 impact variations and render them.",
  "risk": "write_safe",
  "steps": [
    {
      "op": "track_create",
      "params": {
        "name": "Streetlight - Impact Variations",
        "reuse": true
      }
    },
    {
      "op": "item_duplicate",
      "count": 8
    },
    {
      "op": "render_region",
      "count": 8,
      "writes_files": true
    }
  ]
}
```

### Kubernetes Operator: Desired State And Reconcile

A Kubernetes Operator watches the system and keeps pushing it toward the desired state.

Analogy:

> An operator is like a caretaker who keeps checking the room: "There should be eight labeled boxes on the shelf. If one is missing, create it. If one is mislabeled, fix it."

Streetlight version:

> Instead of only saying "run command X", Streetlight can say "ensure this REAPER project has a track, eight variations, eight regions, and rendered files."

System role:

- desired state
- idempotency
- recovery
- repeatable workflows

Streetlight design rule:

- prefer `ensure_*` behavior where possible
- repeated runs should avoid duplicating work accidentally
- workflows should be able to resume after partial failure

Example desired state:

```json
{
  "kind": "VariationSet",
  "name": "Impact Variations",
  "source": "selected:0",
  "count": 8,
  "render": {
    "format": "wav",
    "output_dir": "/Users/me/Desktop/renders"
  }
}
```

### Temporal: Durable Workflow History

Temporal records workflow progress so long-running processes can survive failures.

Analogy:

> Temporal is like a project manager with a clipboard. Every step is checked off. If the lights go out, the team can read the clipboard and continue.

Streetlight version:

> Every Streetlight command should have a lifecycle and a log: created, planned, approved, running, verified, done, or failed.

System role:

- durable execution
- logs
- debugging
- resumability

Streetlight design rule:

- every command gets an ID
- every command produces a result file
- every mutating command records what changed
- errors should say whether they are recoverable

Command lifecycle:

```text
created -> planned -> approved -> running -> verified -> done
                                      |
                                      v
                                    failed
```

### Agent Guardrails: Permission And Approval

Agent systems often separate safe tools from dangerous tools and pause before risky actions.

Analogy:

> Guardrails are like a studio manager who says: "You can look around freely. You can move copies. But deleting master recordings requires explicit approval."

Streetlight version:

> Reading REAPER state is always safe. Creating editable copies may be safe. Deleting items, overwriting files, or running raw Lua requires stronger permission.

System role:

- permission tiers
- human confirmation
- risk labels
- safer automation

Streetlight design rule:

- every capability has a risk level
- clients can decide which risk levels are allowed
- unsafe eval is disabled by default

Risk levels:

```text
read             inspect project only
write_safe       creates or edits with undo support
filesystem       writes files, such as renders
destructive      deletes, overwrites, or changes existing user work
unsafe_eval      arbitrary Lua, disabled by default
```

### MCP/OpenAPI: Self-Describing Capabilities

MCP tools and OpenAPI operations both make software actions discoverable through names and schemas.

Analogy:

> This is the restaurant menu and allergy label. The agent can see what can be ordered, what ingredients are required, and what comes back.

Streetlight version:

> Every REAPER capability should describe itself, so agents and developers do not need to guess.

System role:

- tool discovery
- schemas
- documentation
- validation

Streetlight design rule:

- no hidden parameters
- no undocumented behavior
- templates and recipes should be inspectable through `list_capabilities`

Capability metadata:

```json
{
  "name": "item_pitch",
  "description": "Set active take pitch in semitones.",
  "risk": "write_safe",
  "undoable": true,
  "idempotent": false,
  "params_schema": {
    "type": "object",
    "required": ["item_id", "semitones"]
  },
  "preconditions": ["item exists", "active take exists"],
  "verifications": ["active take pitch equals requested semitones"]
}
```

## Streetlight System Parts

### Kernel

Analogy:

> The city hall and rulebook.

The kernel decides what operations exist, what they require, how risky they are, and how results are represented.

Owns:

- capability registry
- schemas
- risk levels
- plan/apply model
- command lifecycle
- result format

### MCP Server

Analogy:

> The reception desk.

Agents talk to the MCP server. The MCP server validates requests, asks the kernel what to do, and sends commands to the bridge.

Owns:

- MCP tools
- client-facing errors
- stdio or HTTP transport
- command submission

### REAPER Bridge

Analogy:

> The engineer inside the studio.

The bridge is the only part that directly touches REAPER.

Owns:

- ReaScript calls
- undo blocks
- resolving selected items/tracks
- executing Lua templates
- reporting REAPER state

### Capability Pack

Analogy:

> A box of specialized tools.

A capability pack adds a domain of behavior.

Examples:

- Core Pack: tracks, items, regions, render
- Game Audio Pack: variations, footsteps, UI clicks, loop prep
- MIDI Pack: notes, clips, quantize, humanize
- FX Pack: insert plugins, set parameters, bypass
- Mixing Pack: volume, pan, sends, analysis

Capability packs should extend the kernel without rewriting it.

### Recipe

Analogy:

> A cooking recipe made from safe kitchen actions.

A recipe composes capabilities into a workflow.

Example:

```text
impact_variations =
  inspect selection
  create track
  duplicate item
  pitch/rate/fade variations
  create regions
  render WAV files
  report results
```

Recipes can start as YAML or Markdown. Later they can become first-class executable workflows.

## Proposed Architecture

```text
MCP Client
  Codex / Claude Code / Cursor / future UI
        |
        v
streetlight-mcp
  reception desk for agents
        |
        v
streetlight-kernel
  registry, schemas, risk, plan/apply, lifecycle
        |
        v
capability packs
  core, game-audio, midi, fx, mixing
        |
        v
streetlight-bridge.lua
  REAPER engineer
        |
        v
REAPER project
```

## Core Operations

Streetlight should eventually expose a small set of stable kernel-level operations.

### `list_capabilities`

Lists all available capabilities and metadata.

This replaces the idea of dumping a giant tool list into prompts.

### `get_state`

Reads scoped REAPER state.

Scopes:

- `project`
- `selection`
- `tracks`
- `items`
- `regions`
- `render`

### `plan`

Converts a requested operation or recipe into a structured plan.

Input:

```json
{
  "recipe": "impact_variations",
  "params": {
    "source": "selected:0",
    "count": 8,
    "output_dir": "/tmp/renders"
  }
}
```

### `apply`

Executes an approved plan.

### `call_capability`

Runs one capability directly.

This is useful for simple operations like `item_pitch`.

### `get_command`

Returns command status and logs.

## v0.1 Translation

The final kernel can be broad, but v0.1 should stay tiny.

v0.1 should implement the kernel shape with only a few real capabilities:

```text
Kernel concepts:
  capability registry
  risk level
  command ID
  structured result
  undo label
  verification note

Real capabilities:
  ping
  get_state(selection)
  track_create
  item_duplicate
  item_pitch
  item_rate
  item_fade
  region_create
  render_region

First recipe:
  impact_variations
```

This lets the architecture be future-proof without making the first version huge.

## What Makes Streetlight Different

Existing REAPER MCP projects often focus on exposing many tools.

Streetlight should focus on the operating model:

- fewer operations at first
- stricter schemas
- explicit risk levels
- plan before apply
- undo-first mutations
- verification after execution
- durable logs
- capability packs
- recipes for real workflows

The long-term goal is not "the most REAPER tools".

The long-term goal is:

> the safest and most extensible agent kernel for REAPER.

## Design Rules

1. Agents propose; Streetlight validates.
2. Plans should be readable before they are applied.
3. Mutations should be undoable by default.
4. Risk should be explicit.
5. Results should say what changed.
6. Failures should be recoverable when possible.
7. Capabilities should be self-describing.
8. Packs should extend the kernel, not fork it.
9. Game audio is the first pack, not the boundary of the whole project.
10. Unsafe eval is a developer escape hatch, not the product.

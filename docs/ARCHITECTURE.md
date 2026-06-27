# Streetlight v0.1 Architecture

## Positioning

Streetlight is a small, agent-neutral control kernel for REAPER.

Game audio is the first official workflow pack, but the foundation should be general enough for other REAPER domains such as editing, MIDI, FX, mixing, automation, and rendering.

The project should be open-source, installable by technical audio users, and safe enough that an agent can make useful edits without casually damaging a session.

The core bet:

> Agents should plan sound design work. Streetlight should execute validated REAPER operations.

## Product Boundary

Streetlight v0.1 is not a desktop app. It is a bridge plus an MCP server.

This keeps the first release narrow and reusable:

- Codex can use it.
- Claude Code can use it.
- Cursor or other MCP clients can use it.
- A future custom desktop UI can use the same core.

The public project should read as safe infrastructure for agentic REAPER control, not as a giant "AI DAW" promise.

## Layers

```text
Agent Host
  Codex / Claude Code / Cursor / future Streetlight app
        |
        | MCP
        v
streetlight-mcp
  exposes tools, schemas, errors, and docs
        |
        v
streetlight-core
  validates operations, maps templates, builds recipes
        |
        v
streetlight-bridge.lua
  executes commands inside REAPER
        |
        v
REAPER project
```

## Layer Responsibilities

### Agent Host

The agent host owns natural-language interaction, creative planning, and user approval.

It should not need to know raw ReaScript for common operations. It should call tools such as `call_template`, `get_state`, and `render_region`.

### `streetlight-mcp`

The MCP server is the public integration surface.

Responsibilities:

- expose a small set of tools
- validate JSON inputs before they reach REAPER
- return structured results
- provide clear errors an agent can recover from
- keep agent-specific behavior out of the core

Recommended implementation:

- TypeScript or Python
- stdio transport first
- Streamable HTTP later

The first release should prefer stdio because it is the easiest MCP transport for local developer tools.

### `streetlight-core`

The core package owns operation definitions and workflow composition.

Responsibilities:

- define operation schemas
- map operation names to Lua templates
- normalize paths and item references
- build higher-level recipes such as "make impact variations"
- keep safety policy centralized

This layer should be usable by both `streetlight-mcp` and a future desktop UI.

### `streetlight-bridge.lua`

The bridge runs inside REAPER.

Responsibilities:

- receive validated commands
- execute tested Lua templates
- wrap changes in undo blocks
- return structured results
- report project state
- avoid long blocking work where possible

For v0.1, the bridge should support a zero-dependency command queue:

```text
agent writes command JSON -> queue folder
REAPER defer loop reads command -> executes template -> writes result JSON
```

This is less elegant than a socket server, but it is easier to install and debug. A socket or HTTP transport can be added later behind the same core interface.

## Why Templates

Free-form LLM-generated Lua is useful for exploration, but too brittle for normal users.

Streetlight should make templates the default path:

```text
agent intent -> typed tool call -> validated params -> tested Lua template -> structured result
```

Raw eval is allowed only as an explicit development feature:

- disabled by default
- named `unsafe_eval`
- requires config opt-in
- logs all executed code
- always runs inside an undo block when possible

## Tool Surface

v0.1 should expose exactly five MCP tools. Templates and recipes grow over time; the tool surface stays fixed.

### `ping`

Checks whether the MCP server and REAPER bridge can communicate.

Returns:

```json
{
  "ok": true,
  "reaper": {
    "connected": true,
    "version": "7.x"
  }
}
```

### `get_state`

Reads a scoped subset of the current REAPER project.

Input:

```json
{
  "scope": "selection"
}
```

Allowed scopes:

- `project`
- `tracks`
- `selection`
- `regions`
- `render`

The default should be `selection`.

### `call_template`

Runs a tested operation template.

Input:

```json
{
  "name": "item_pitch",
  "params": {
    "item_id": "selected:0",
    "semitones": -3
  }
}
```

The MCP server validates `name` and `params` before writing a bridge command.

### `list_templates`

Returns available templates, parameter schemas, descriptions, and safety notes.

This keeps the project discoverable to agents without packing every detail into a system prompt.

### `list_recipes`

Returns available recipe documents with their parameters and step lists.

Recipes are not first-class executable tools in v0.1, but the agent must be able to discover them at runtime. Without this tool, recipes that live as files in the repo are invisible to MCP clients.

Returns:

```json
{
  "ok": true,
  "recipes": [
    {
      "id": "impact_variations",
      "description": "Create and render game-audio impact variations.",
      "inputs": { "source": "...", "count": 8, "output_dir": "..." },
      "steps": [ /* parsed YAML */ ]
    }
  ]
}
```

## Template IDs

Templates should use stable snake_case names.

Required for v0.1:

- `track_create`
- `track_rename`
- `media_import`
- `item_duplicate`
- `item_move`
- `item_pitch`
- `item_rate`
- `item_fade`
- `item_trim`
- `region_create`
- `render_region`

Optional if time permits:

- `item_normalize`
- `item_split`
- `batch_rename`
- `marker_create`

`item_reverse` was considered but cut from v0.1: REAPER has no clean take-level reverse API, and `Main_OnCommand(41051)` writes a new audio file to disk, which would force every reverse to be `filesystem`-risk for one item-level op. Deep pitch + slow rate + long fade-in is a close enough variation for the demo. Revisit in v0.2 with a proper design.

Avoid adding dozens of templates before the first workflow works end to end.

## Item References

REAPER internal object handles are not stable across process boundaries. Streetlight should avoid exposing raw handles.

Use logical item references:

- `selected:0`
- `selected:1`
- `guid:{...}`
- `last_result:item:0`
- `track:Name/item:3`

The bridge can resolve these references at execution time.

### Reference Lifecycle

The bridge MUST follow these semantics. Recipes break in subtle ways otherwise.

`selected:N`

- Resolved once when the bridge dequeues the command. This is a snapshot.
- N is the zero-indexed position in REAPER's current selection at that moment.
- Even if the template mutates selection mid-execution, all `selected:N` references inside the same command see the original snapshot.
- Multi-step recipes MUST NOT rely on `selected:N` across separate commands. Use `guid:` or `last_result:` instead.

`guid:{...}`

- Stable across commands, sessions, and process restarts as long as the project file persists.
- Preferred for any reference the agent intends to reuse.
- Resolved by enumerating items and matching GUID strings. REAPER's `BR_GetMediaItemByGUID` (SWS) is faster but Streetlight does not require SWS, so v0.1 enumerates.

`last_result:item:N`, `last_result:region:N`

- Refers to the Nth entity returned by the most recently completed mutating template, per MCP session.
- The bridge maintains a per-session `last_result` slot: `{ command_id, items: [guid...], regions: [guid_or_name...] }`.
- It is reset every time a mutating command succeeds. Read-only commands (`get_state`, `ping`, `list_templates`) do not touch it.
- Dies when the MCP server process exits. Not persistent across restarts.
- Used to chain steps in a recipe without round-tripping `get_state` between every step.

`track:Name/item:N`

- Resolves to the Nth item on the first track whose name exactly matches `Name`.
- Convenience for hand-written scripts; agents should still prefer GUIDs once they have them.

### Result Identifier Contract

Mutating templates MUST return the GUIDs of every item, track, and region they created or modified. This lets the agent promote `last_result:` and `selected:` references into stable `guid:` references for any object it plans to touch again.

Example:

```json
{
  "ok": true,
  "items": [
    {
      "id": "guid:{ABC}",
      "track": "Impact Variations",
      "name": "metal_hit_var_01",
      "position": 12.0,
      "length": 0.84
    }
  ]
}
```

## Recipes

Recipes are reusable workflow plans built from templates.

They are not separate MCP tools in v0.1. They should live in docs or config as agent-readable workflows.

Example recipe:

```yaml
id: impact_variations
description: Create pitched, timed, reversed, and faded impact variations.
inputs:
  source: selected item or file path
  count: 6
  output_dir: path
steps:
  - get_state: { scope: selection }
  - call_template: { name: track_create }
  - call_template: { name: item_duplicate }
  - call_template: { name: item_pitch }
  - call_template: { name: item_rate }
  - call_template: { name: item_fade }
  - call_template: { name: region_create }
  - call_template: { name: render_region }
```

Recipes can become first-class tools later when real usage proves which workflows matter.

## Safety Model

Streetlight should assume the agent can make mistakes.

Required safety properties:

- all mutating operations create undo points
- destructive operations require explicit template names
- no unrestricted eval by default
- render output paths are explicit
- bridge writes a command/result log
- errors are structured and recoverable
- templates check missing items, invalid paths, and unsupported parameters

Mutating result format:

```json
{
  "ok": true,
  "undo_label": "Streetlight: item_pitch",
  "changed": {
    "tracks": 0,
    "items": 1,
    "regions": 0,
    "files": []
  }
}
```

Error format:

```json
{
  "ok": false,
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "Could not resolve item reference selected:0",
    "recoverable": true
  }
}
```

## Transport

### v0.1: File Queue

Use an application data folder:

```text
~/Library/Application Support/Streetlight/queue
  pending/
  running/
  done/
  failed/
```

Command files:

```json
{
  "id": "cmd_001",
  "template": "item_pitch",
  "params": {
    "item_id": "selected:0",
    "semitones": -3
  }
}
```

Result files:

```json
{
  "id": "cmd_001",
  "ok": true,
  "result": {}
}
```

This queue can later be replaced or supplemented by a socket transport without changing the MCP tool contract.

### Later: Socket or HTTP

Add only after the file queue MVP is reliable.

Reasons to wait:

- Lua socket dependencies complicate install
- firewall prompts can scare users
- local file queues are easier to inspect when debugging

## Repository Shape

Recommended starting layout. The pack folder shape lands in v0.1 even with one pack, so adding a second pack later does not require restructuring.

```text
streetlight/
  README.md
  docs/
    ARCHITECTURE.md
    KERNEL_DESIGN.md
    MVP.md
    ROADMAP.md
    IMPLEMENTATION_PLAN.md
    INSTALL.md
    TEMPLATE_SPEC.md
    RENDER_NOTES.md
  packages/
    mcp-server/
    core/
      src/
        registry.ts
        risk.ts
        result.ts
        refs.ts
        queue.ts
        errors.ts
        types.ts
  reaper/
    streetlight_bridge.lua
    packs/
      core/
        manifest.lua
        templates/
          track.lua
          item.lua
          region.lua
          render.lua
        refs.lua
        undo.lua
  recipes/
    impact_variations.yaml
  examples/
    claude-code.json
    codex-config.example.toml
```

Do not build every folder before it is needed. The layout is a map, not a checklist.

## Extension Points

Streetlight should be extensible in three directions.

### Templates

Add one tested operation at a time.

Every template needs:

- name
- JSON schema
- Lua implementation
- fixture or test project case
- example tool call
- safety notes

### Recipes

Recipes compose templates into useful workflows.

Good recipe candidates:

- impact variations
- UI click variations
- weapon tail layering
- footstep set export
- loop prep

### Frontends

The MCP surface should stay stable enough that new frontends can reuse it.

Possible future frontends:

- custom desktop app
- REAPER ReaImGui panel
- web control surface
- Codex plugin
- Claude Code project template

## What To Avoid Early

Avoid building these before the core loop is trusted:

- giant tool list
- universal DAW API
- semantic asset search
- automatic plugin manager
- cloud account system
- marketplace
- paid-product comparison language

The v0.1 release should feel boring in the best way: install it, connect it, run one useful workflow, undo it if needed.

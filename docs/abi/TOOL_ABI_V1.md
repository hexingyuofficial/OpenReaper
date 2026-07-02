# Tool ABI v1

Status: target for Layer 1 freeze.

## Frozen MCP Tool Surface

OpenReaper exposes exactly five agent-facing MCP tools:

```text
ping
get_state
list_templates
list_recipes
call_template
```

No ordinary feature may add a sixth MCP tool.

## Layer Rules

- Agents call MCP tools directly.
- Agents do not call packs directly.
- Agents execute templates only through `call_template`.
- Agents discover recipes through `list_recipes`.
- Recipes are not hidden server-side executors.
- Recipes are executed step by step by the agent using `call_template` and
  `get_state`.

## Tool Roles

### `ping`

Checks whether the MCP server and REAPER runtime are reachable.

### `get_state`

Reads bounded state, projections, and artifacts.

### `list_templates`

Lists callable templates from enabled fixed packs.

### `list_recipes`

Lists workflow contracts that agents can execute step by step.

### `call_template`

Runs one verified template action.

## Freeze Gate

Layer 1 is complete only when tests prove the registered tool-name set is
strictly equal to the five names above.

Order does not matter. The set does.

Out of scope for Layer 1:

- bridge behavior,
- pack taxonomy migration,
- template migration,
- recipe implementation,
- REAPER Lua runtime.

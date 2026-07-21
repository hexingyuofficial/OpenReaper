# Tool ABI v1

Status: frozen by the Layer 1 Tool ABI v1 gate, with a bounded Alpha3.4-E2 reopen
that adds exactly one sixth tool named `call_recipe`.

Scope: Layer 1 freezes only the MCP tool surface and direct-call rules.
Discovery/menu behavior for `list_templates` and `list_recipes` is frozen by
Layer 1.5 in `DISCOVERY_MENU_CONTRACT_V1.md`.

## Frozen MCP Tool Surface

OpenReaper exposes exactly six agent-facing MCP tools:

```text
ping
get_state
list_templates
list_recipes
call_template
call_recipe
```

Alpha3.4-E2 adds exactly one sixth tool named `call_recipe`. No ordinary feature
may add a seventh MCP tool.

## Layer Rules

- Agents only call MCP tools directly.
- Agents do not call packs directly.
- Agents execute templates only through `call_template`.
- Agents discover recipes through `list_recipes`.
- Historical agent-stepped recipes remain valid workflow contracts.
- Saved executable recipe revisions run only through public `call_recipe`.
- `call_recipe` accepts only a stored immutable revision identity for run/resume.
- Inline draft/revision/graph execution is forbidden.

## Tool Roles

### `ping`

Checks whether the MCP server and REAPER runtime are reachable.

### `get_state`

Reads bounded state, projections, and artifacts.

### `list_templates`

Discovers callable templates from enabled fixed packs. Its menu and expansion
contract belongs to Layer 1.5.

### `list_recipes`

Discovers workflow contracts and compact saved executable revision facts. Its
menu and expansion contract belongs to Layer 1.5. Executable truth is reported
only for saved validated revisions.

### `call_template`

Runs one verified template action or registered Macro program.

### `call_recipe`

Owns the bounded executable recipe lifecycle:

```text
validate
save
list
get
delete
run
resume
```

`run` and `resume` require exact stored revision identity and trust checks.
Stages execute only registered macro, template, get_state, and checkpoint kinds
with stage-specific verified readback. Evidence pages use the existing `get`
operation with an identity-bound `evidence_ref`; they are not an eighth
operation. Runtime trust facts are server-owned and are never accepted from a
public request. Fresh `run` ids are server-generated; only `resume` accepts the
retained `run_id`. The `revision` request field accepts a positive integer for
stored identity and an object only for validate/save authoring; run/resume never
accept an object-shaped revision payload.

## Layer 1 Freeze Completion Criteria

Layer 1 is complete only when tests prove the registered tool-name set is
strictly equal to the six names above.

Order does not matter. The set does.

The source of truth for the Layer 1 tool surface must stay in
`packages/mcp-server/src/tool-abi-v1.mjs`. The `check:tool-abi` gate must prove:

- the source tool-name set is exactly the frozen six,
- the source contains no duplicate tool names,
- any MCP server tool registrations, once present, are exactly the frozen six,
- this ABI document lists exactly the same six tools,
- adding, removing, duplicating, or misspelling an ordinary MCP tool fails the
  gate.

Out of scope for Layer 1:

- bridge behavior,
- pack taxonomy migration,
- template migration,
- recipe implementation,
- REAPER Lua runtime.

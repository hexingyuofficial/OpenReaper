# Foundation Freeze Plan

Status: clean baseline for the new OpenReaper repo.

## Thesis

OpenReaper grows by freezing the foundation first, then adding verified
capabilities through fixed packs and composing them through recipes.

```text
frozen five-tool agent interface
  + frozen discovery / menu contract
  + frozen foundation / bridge ABI
  + fixed REAPER capability pack taxonomy
  + verified template library
  + official recipe catalog
  + user-editable recipe layer
```

Definitions:

```text
Pack = dependency / capability domain
Template = concrete verified action
Recipe = workflow contract
Agent = reads recipes and calls templates through MCP tools
User = primarily creates or edits recipes
```

## Layer Order

### Layer 1: Tool ABI v1

Freeze the agent-facing MCP tool surface:

```text
ping
get_state
list_templates
list_recipes
call_template
```

Agents call only these tools directly.

Layer 1 only freezes the tool surface. It does not freeze how much
`list_templates` or `list_recipes` return.

### Layer 1.5: Discovery / Menu Contract v1

Freeze how agents discover templates and recipes through `list_templates` and
`list_recipes`.

This layer exists so discovery stays stable and low-cost as packs, templates,
and recipes grow. The default response must be a compact menu summary, not a
full dump of template schemas, examples, expected deltas, recipe steps,
assertions, or recovery branches.

Layer 1.5 must define and test:

- exact on-demand expansion by `ids`,
- field selection by `fields`,
- filters such as `query`, `tags`, `pack`, `lifecycle`, `risk`, and
  `entity_kind`,
- stable pagination shape with `limit` and `cursor`, or an explicit reserved
  shape for it,
- synthetic large-catalog checks proving default discovery does not grow with
  the full catalog size,
- the rule that full descriptors and full recipe steps are read only on demand.

After Layer 1.5 is frozen, the agent-facing discovery interface is frozen.

### Layer 2: Foundation / Bridge ABI v1

Freeze runtime behavior:

- queue / transport envelope,
- command dispatch,
- pack loading,
- template lookup,
- refs,
- undo,
- verification,
- artifacts,
- response budget,
- typed errors,
- `LAST_RESULT`,
- idempotency,
- bridge owner / generation behavior.

Layer 2 must wait for Layer 1.5 because the discovery contract affects response
budgets, descriptor shapes, recipe metadata, pack metadata, lifecycle fields,
and future user recipe authoring.

### Layer 3: Pack Taxonomy v1

Freeze the top-level REAPER capability pack list. Packs are dependencies, not
workflow products.

### Layer 4: Template Authoring ABI v1

Freeze how templates are described, validated, implemented, tested, and smoked.

Templates execute actions. They do not decide strategy.

### Layer 5: Recipe Contract v1

Freeze recipe metadata, dependencies, steps, assertions, recovery branches, and
expected outputs.

Recipes compose templates. They do not create new write powers.

### Layer 6: User Recipe Authoring v1

Open the user-editable workflow layer.

Users should create and modify recipes without writing Lua or editing the
foundation.

## Migration Rule

Do not start by moving legacy files.

First define and test each layer's rules in this clean repo. Then migrate the
smallest compatible implementation from the legacy repo.

Legacy repo:

```text
/Users/Zhuanz/Documents/streetlight-reaper-mcp
```

Legacy workflow-shaped packs are references, not authority.

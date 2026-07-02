# OpenReaper

OpenReaper is a clean foundation repo for a verified REAPER agent runtime.

This repository starts from the new architecture:

```text
Pack = fixed REAPER capability dependency
Template = concrete verified action
Recipe = workflow contract
Agent = reads recipes and calls templates through MCP tools
User = primarily creates or edits recipes
```

The legacy implementation remains in:

```text
/Users/Zhuanz/Documents/streetlight-reaper-mcp
```

Do not copy legacy workflow-shaped packs directly into this repo. Old `loop`,
`cleanup`, `delivery`, `layer`, and `music_sketch` concepts must become recipe
families, tags, or migration notes unless a taxonomy amendment says otherwise.

## Current Goal

Freeze the architecture one layer at a time:

```text
1. Tool ABI v1
2. Foundation / Bridge ABI v1
3. Pack Taxonomy v1
4. Template Authoring ABI v1
5. Recipe Contract v1
6. User Recipe Authoring v1
```

The first implementation window should work only on Layer 1: Tool ABI v1.

## Repository Map

See [docs/REPOSITORY_LAYOUT.md](docs/REPOSITORY_LAYOUT.md).

Important starting docs:

- [docs/FOUNDATION_FREEZE_PLAN.md](docs/FOUNDATION_FREEZE_PLAN.md)
- [docs/abi/TOOL_ABI_V1.md](docs/abi/TOOL_ABI_V1.md)
- [docs/taxonomy/PACK_TAXONOMY_V1.md](docs/taxonomy/PACK_TAXONOMY_V1.md)
- [docs/migration/LEGACY_BOUNDARY.md](docs/migration/LEGACY_BOUNDARY.md)

## Guardrail

Run:

```bash
npm test
```

This runs the fixed directory layout check and the Layer 1 Tool ABI check.
Future layers should add their own ABI and runtime tests.

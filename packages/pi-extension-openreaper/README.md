# `@openreaper/pi-extension`

Native OpenReaper tools for **private Studio Pi**. Loaded by the Studio steward with:

```text
pi --mode rpc --no-builtin-tools --no-extensions --extension openreaper-extension.mjs
```

Talks to the REAPER Bridge over the **file queue** (same kernel as `packages/mcp-server`). This is **not** a user-visible MCP stdio server. Do not add it to `mcp.json`.

| Tool | Bridge? |
|------|---------|
| `openreaper_ping` | Yes |
| `openreaper_get_state` | Yes |
| `openreaper_list_templates` | No (in-process registry) |
| `openreaper_list_recipes` | No (disk) |
| `openreaper_call_template` | Yes (refuses rename/move of original audio asset files) |

If REAPER/Bridge is down, ping/get_state/call_template return `BRIDGE_NOT_RUNNING` (or kernel load errors) as JSON. Do not spawn `streetlight-mcp`.

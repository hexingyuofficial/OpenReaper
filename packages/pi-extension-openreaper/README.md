# `@openreaper/pi-extension`

Native OpenReaper tools for **private Studio Pi**. Loaded by the Studio steward with:

```text
pi --mode rpc --no-builtin-tools --no-extensions --extension openreaper-extension.mjs
```

This is **not** a user-visible MCP stdio server. Do not add it to `mcp.json`.

| Tool | Status |
|------|--------|
| `openreaper_ping` | Stub — proves the extension loaded. P2: file-queue ping to the REAPER Bridge. |
| `get_state` / `call_template` / list_* | P2 |

Permission rule for P2: never rename or move original audio asset files.

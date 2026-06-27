# Install Guide

This is the intended install flow for v0.1. The commands and paths may change once the implementation exists.

## Requirements

- REAPER installed locally
- Node.js for the MCP server
- an MCP-capable agent client such as Codex or Claude Code

No SWS, ReaPack, Python, LuaSocket, or external database should be required for v0.1.

## Install Steps

### 1. Install The MCP Server

From the Streetlight repo:

```bash
npm install
npm run build
```

### 2. Install The REAPER Bridge

Copy or load:

```text
reaper/streetlight_bridge.lua
```

inside REAPER as a ReaScript action.

You can run the bridge two ways. Auto-start is recommended after the first install.

**Option A — auto-start with REAPER (recommended).**

Add this line to your REAPER resource folder's `__startup.lua` (create the file if it does not exist):

```lua
dofile("/absolute/path/to/streetlight/reaper/streetlight_bridge.lua")
```

REAPER resource folder paths:

- macOS: `~/Library/Application Support/REAPER/Scripts/__startup.lua`
- Windows: `%APPDATA%/REAPER/Scripts/__startup.lua`
- Linux: `~/.config/REAPER/Scripts/__startup.lua`

The bridge will start every time you launch REAPER. No manual step.

**Option B — run manually each session.**

Open REAPER, go to Actions → Show action list → Load → pick `streetlight_bridge.lua` → Run. Repeat once per REAPER session.

### 3. Configure The Agent Client

Register the built MCP server with your client.

Conceptual command:

```bash
node /path/to/streetlight/packages/mcp-server/dist/index.js
```

See:

- `examples/codex-config.example.toml`
- `examples/claude-code.example.json`

### 4. Test The Connection

Ask the agent:

```text
Can you ping Streetlight?
```

Expected result:

```json
{
  "ok": true,
  "result": {
    "bridge": "connected"
  }
}
```

## Runtime Folder

Streetlight uses a local app data folder for command exchange.

macOS:

```text
~/Library/Application Support/Streetlight/
```

Windows target:

```text
%APPDATA%/Streetlight/
```

Linux target:

```text
~/.local/share/streetlight/
```

## Troubleshooting

### Agent Can See MCP Server But REAPER Is Not Connected

Check:

- REAPER is open
- `streetlight_bridge.lua` is running
- both MCP server and bridge use the same queue folder

### No Selected Items

Select one media item in REAPER and call `get_state` again.

### Render Fails

Check:

- output folder exists
- output folder is writable
- region exists
- REAPER render settings are supported by the current template

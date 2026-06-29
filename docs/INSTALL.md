# Install Guide

This is the intended install flow for v0.1. The commands and paths may change once the implementation exists.

## Requirements

- REAPER installed locally (7.x recommended)
- Node.js for the MCP server
- an MCP-capable agent client such as Codex or Claude Code

No SWS, ReaPack, Python, LuaSocket, or external database should be required for v0.1.

## REAPER Preferences Required For v0.1

### Render in background (REQUIRED for `render_region`)

`render_region` issues `Main_OnCommand(42230, 0)` and then polls the
output file from the bridge's `reaper.defer` tick loop. When REAPER's
**"Render in background (does not apply to queued renders)"** pref is
**OFF**, that action blocks REAPER's main thread until the render
completes — which means the bridge's tick loop is frozen too. The
bridge-internal 55 s render deadline never fires, the MCP-side 60 s
wire timeout trips first, and the agent sees `BRIDGE_NOT_RUNNING`
instead of the typed `RENDER_TIMEOUT` you would otherwise get for a
genuinely-too-slow render. For the 8-item demo this also means the
bridge is unresponsive to ANY other tool call (including `ping`) for
the duration of each render.

**Turn it ON before running the demo:**

`REAPER → Preferences (⌘,) → Audio → Rendering → "Render in background
(does not apply to queued renders)" → check the box → OK.`

Verify with `Preferences → Audio → Rendering`; the box should be checked.

The bridge does NOT auto-detect this at startup — REAPER 7 exposes no
reliable native ReaScript API for the `workrender` config bit without
SWS, and a fragile heuristic that warns when nothing's wrong (or stays
silent when it is) is worse than a docs requirement. Step 7 decision B2.

v0.2 may revisit foreground-render support via a chunked-tick render
loop that yields back to the bridge between progress polls; tracked
in `docs/ROADMAP.md` § v0.2. v0.1 ships with the pref-ON requirement
as the only supported path.

## Install Steps

### 1. Install The MCP Server

From the Streetlight repo:

```bash
npm install
npm run build
```

### 2. Install The REAPER Bridge (Quick Setup)

The recommended path for v0.1 (macOS only). One command, no hand-
written paths:

```bash
npm run setup
```

This generates two things:

1. **The REAPER launcher** at
   `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`.
   It's a tiny script that `dofile`s the bridge in this repo with the
   absolute path baked in. `git pull` in this repo is picked up
   automatically the next time the launcher runs — re-run `npm run
   setup` only if you MOVE the repo.
2. **Filled-in MCP client config snippets** at `setup-out/`
   (`claude-code.json`, `codex-config.toml`, `cursor.json`). Each has
   the absolute path for your clone baked in. Copy the snippet for
   your client into its config. Setup never edits your client config
   directly — those files may contain other MCP servers, and a merge
   bug could break unrelated tooling.

Setup also does a read-only probe of `reaper.ini` and warns if
`Render in background` is OFF.

**Register the launcher in REAPER's Action List (one-time, per Mac):**

REAPER does NOT auto-discover scripts dropped into its Scripts
folder; you have to add them once via Load...:

1. Open REAPER.
2. `Actions → Show action list → ReaScript: Load...` →
   pick `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`.
3. With it selected, click **Run**. The console (`View → Show console`)
   should print:

   ```text
   [streetlight] bridge starting (generation N)
   [streetlight] queue dir = ...
   [streetlight] bridge ready (generation N) — templates: item_pitch, ...
   ```

After Load..., the launcher stays in the Action List — search
"Streetlight" in future sessions and click Run.

**If you previously hand-wrote a `dofile("...streetlight_bridge.lua")`
line into `__startup.lua` (the manual install below), REMOVE that
line now.** The launcher replaces it. Leaving both in place isn't
harmful — Step 6's generation guard ensures only the newest chunk
serves requests — but your console will print two "bridge starting"
lines per REAPER launch, which is noise.

`npm run setup` flags:

- `--no-overwrite` — refuse to overwrite an existing launcher.
- `--reaper-resource-path /custom/path` — point at a non-default
  REAPER Resource Path (portable installs, `--reapath` users).
- `-h` / `--help`.

v0.1 of setup is macOS only. Linux + Windows track with the v0.2
cross-platform queue-dir work in `docs/ROADMAP.md`.

### 2 (advanced). Manual REAPER Bridge install

If you can't or don't want to use `npm run setup`, the bridge entry
point is `reaper/streetlight_bridge.lua`. It `dofile`s sibling files
under `reaper/packs/core/` **relative to its own script path**, so
the whole `reaper/` directory has to stay together — copying only
`streetlight_bridge.lua` into REAPER's Scripts folder will fail at
startup with a missing-dofile error.

Pick one of the two install layouts below.

**Layout A — `dofile` from the repo (mirrors what `npm run setup`
generates, but you write the absolute path by hand).**

Leave the repo wherever you cloned it. Add this line to your REAPER
resource folder's `__startup.lua` (create the file if it does not exist):

```lua
dofile("/absolute/path/to/streetlight/reaper/streetlight_bridge.lua")
```

The bridge will start every time you launch REAPER, and any
`git pull` that updates `reaper/` is picked up the next time the bridge
loads.

**Layout B — copy the whole `reaper/` directory into REAPER's Scripts folder.**

```text
~/Library/Application Support/REAPER/Scripts/Streetlight/        # macOS
%APPDATA%/REAPER/Scripts/Streetlight/                            # Windows
~/.config/REAPER/Scripts/Streetlight/                            # Linux
```

Then either point `__startup.lua` at that copy, or `Actions →
Show action list → ReaScript: Load... → pick streetlight_bridge.lua
→ Run` each session. Note: you have to recopy after every repo update.

REAPER resource folder paths for `__startup.lua`:

- macOS: `~/Library/Application Support/REAPER/Scripts/__startup.lua`
- Windows: `%APPDATA%/REAPER/Scripts/__startup.lua`
- Linux: `~/.config/REAPER/Scripts/__startup.lua`

**Console sanity check (both layouts).** Once loaded, the REAPER console
(`View → Show console`) should print:

```text
[streetlight] bridge starting (generation N)
[streetlight] queue dir = ...
[streetlight] loaded pack 'core' v0.1.0
[streetlight] startup-cleanup: reaped K stale running/ envelopes ...   ← only when K > 0
[streetlight] bridge ready (generation N) — templates: item_pitch, ...
```

A `dofile` error at startup almost always means `packs/` is not sitting
next to `streetlight_bridge.lua` — re-check your install layout.

### 3. Configure The Agent Client

Register the built MCP server with your client.

Conceptual command:

```bash
node /path/to/streetlight/packages/mcp-server/dist/index.js
```

If you ran `npm run setup` (recommended), the absolute path is
already baked into ready-to-paste config snippets at:

- `setup-out/claude-code.json`
- `setup-out/codex-config.toml`
- `setup-out/cursor.json`

Open the file matching your client and copy the snippet into your
client's MCP config. (Setup never edits the client config directly —
those files often contain other MCP servers, and a merge bug could
break unrelated tooling.)

For the underlying shape (placeholder paths only, used by the manual
install path above), see:

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

Streetlight uses a local app data folder for command exchange. The MCP
server and the Lua bridge MUST agree on its location.

Defaults:

| Platform | MCP server (Node) | Lua bridge |
|---|---|---|
| macOS | `~/Library/Application Support/Streetlight/queue` | same |
| Windows | `%APPDATA%/Streetlight/queue` | same (if `%APPDATA%` is set) |
| Linux | `~/.local/share/streetlight/queue` | **falls back to the macOS path** |

The Lua bridge ships as macOS-first for v0.1: on Linux it does NOT
mirror the Node default. **On Linux you must set
`STREETLIGHT_QUEUE_DIR` in both the MCP server's environment AND the
REAPER process's environment** so they meet at the same directory.
Windows works out of the box as long as `%APPDATA%` is exported into
REAPER's environment, which is the default.

A cross-platform Lua resolver is **deferred to v0.2** (Step 8 Round B
decision — no live Linux REAPER rig to verify a Lua resolver patch
against, and INSTALL.md's env-var workaround covers the v0.1 Linux
path). Until then, the env-var workaround is the supported path off
macOS.

Override on any platform by exporting `STREETLIGHT_QUEUE_DIR` in BOTH
processes' environments before they start.

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

- output folder exists and is absolute (Lua's `io.open` does NOT expand `~`)
- output folder is writable
- region exists with a name that does NOT contain `/`, `\`, NUL, or `$`
- target `.wav` file does not already exist in the output folder
- **"Render in background"** is ON (see [Requirements](#reaper-preferences-required-for-v01) above — the most common cause of `BRIDGE_NOT_RUNNING` on a render the bridge actually started)

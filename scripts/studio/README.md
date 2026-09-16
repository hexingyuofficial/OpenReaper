# OpenReaper Studio — Start / Stop (Day 2–3)

One **Start** brings up the Studio chain; one **Stop** tears down what Studio started.
This layer wraps the packaged `openreaper-start` helper (REAPER + MCP bridge) and adds Pi
detection plus an AI dialog **placeholder** slot.

## Prerequisites

- REAPER installed (macOS primary)
- OpenReaper installed from a release into `~/.openreaper/current` (see root README)
- Node.js 20+

Optional: [Pi](https://pi.dev) on `PATH` with `~/.pi/agent/mcp.json` already configured.

## Run (macOS)

From the repo:

```bash
chmod +x scripts/studio/studio-start.sh scripts/studio/studio-stop.sh
./scripts/studio/studio-start.sh
./scripts/studio/studio-stop.sh
```

Or via npm:

```bash
npm run studio:start
npm run studio:stop
```

Installed copy (after packaging includes `scripts/studio/`):

```bash
~/.openreaper/current/scripts/studio/studio-start.sh
```

Override install location:

```bash
export OPENREAPER_INSTALL_ROOT="$HOME/.openreaper/current"
```

## Start chain (order)

| Step | Component | Behavior |
|------|-----------|----------|
| 1 | REAPER + MCP bridge | Calls `bin/openreaper-start` in the install root (same as alpha package). |
| 2 | Pi agent | If `pi` is on PATH and `OPENREAPER_STUDIO_SKIP_PI` is unset, starts `pi --mode rpc` in the background and logs to `session/logs/studio-pi-rpc.log`. |
| 3 | AI dialog placeholder | Copies `openreaper_studio_dialog_stub.lua` into REAPER `Scripts/OpenReaper/` and appends a **marked** block to `Scripts/__startup.lua` once. |

If REAPER was already running before Start, restart REAPER once so `__startup.lua` loads the face hook.

## Stop behavior

| Component | Default |
|-----------|---------|
| Pi RPC started by Studio | Sent `SIGTERM` |
| Studio `__startup.lua` face hook | Removed only if Studio added it this session |
| REAPER | **Left running** (unsaved projects stay safe) |
| MCP bridge | Stops when you quit REAPER |

Force REAPER quit on stop (use with care):

```bash
OPENREAPER_STUDIO_STOP_REAPER=1 ./scripts/studio/studio-stop.sh
```

## Pi: present vs absent

| Situation | Studio behavior |
|-----------|-----------------|
| `pi` not on PATH | Start continues; message points to Pi install docs. **Does not** create `~/.pi`. |
| `~/.pi/agent/mcp.json` missing | Start continues; configure Pi yourself. **Does not** write `mcp.json`. |
| `mcp.json` present, no `openreaper` entry | Warns; **does not** merge or overwrite your file. |
| `mcp.json` present with openreaper | Reuses existing auth/config (read-only check). |
| `OPENREAPER_STUDIO_SKIP_PI=1` | Skips background Pi RPC entirely. |

Session metadata is stored at `~/.openreaper/studio/session-v1.json` (mode `0600`).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENREAPER_INSTALL_ROOT` | Packaged install root (default `~/.openreaper/current`) |
| `OPENREAPER_STUDIO_SKIP_PI` | `1` to skip Pi RPC |
| `OPENREAPER_STUDIO_STOP_REAPER` | `1` to ask REAPER to quit on Stop |
| `OPENREAPER_STUDIO_PI_ARGS` | Extra args appended after `pi --mode rpc` |

## Windows

Experimental wrappers: `studio-start.ps1` / `studio-stop.ps1` (same Node orchestrator).

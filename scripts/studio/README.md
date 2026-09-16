# OpenReaper Studio — Start / Stop + AI dialog

One **Start** brings up the Studio chain; one **Stop** tears down what Studio started.
This layer wraps the packaged `openreaper-start` helper (REAPER + MCP bridge), optional
background Pi RPC, and a floating **ReaImGui** AI dialog (Day 4–5 MVP).

## Prerequisites

- REAPER installed (macOS primary)
- OpenReaper installed from a release into `~/.openreaper/current` (see root README)
- Node.js 20+

Optional: [Pi](https://pi.dev) on `PATH` with `~/.pi/agent/mcp.json` already configured.

**ReaImGui** (via ReaPack) is required for the dialog UI. There is no `openreaper_dialog_sample.lua`
in this repo yet; the face lives at `scripts/studio/reaper/openreaper_studio_dialog.lua` and follows
current ReaImGui APIs (default font; no custom `ImGui_PushFont` in this MVP).

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
| 1 | Face install + flag | Copies `openreaper_studio_dialog.lua`, writes `~/.openreaper/studio/face-config-v1.json`, sets `open-face-on-load`. |
| 2 | REAPER + MCP bridge | Calls `bin/openreaper-start` in the install root (same as alpha package). |
| 3 | Pi agent | If `pi` is on PATH and `OPENREAPER_STUDIO_SKIP_PI` is unset, starts `pi --mode rpc` in the background and logs to `session/logs/studio-pi-rpc.log`. |
| 4 | AI dialog | On REAPER boot, `__startup.lua` loads the face script; the open flag shows a bottom-centered floating bar. |

If REAPER was already running before Start, restart REAPER once so `__startup.lua` loads the face hook.

## AI dialog (try it)

After `./scripts/studio/studio-start.sh`:

1. REAPER should open (or attach) and show the **OpenReaper Studio** floating bar near the bottom.
2. With nothing selected, **no context chips** are shown.
3. Click **+** to attach context: time selection, track, item, region at playhead, or marker near playhead.
4. Each chip has **x** to dismiss.
5. Type a prompt and **Send** — the face calls `studio-pi-send.mjs` via `reaper.ExecProcess`:
   - If Studio started Pi RPC: **mock_pi_running** reply plus a TODO seam for real RPC attach.
   - If Pi is absent/skipped: **mock** reply (does not touch `~/.pi` or `mcp.json`).
   - Optional: set `OPENREAPER_STUDIO_PI_RPC_URL` to POST JSON `{ message, chips }` for HTTP bridge experiments.

Re-open the face manually: **Actions → ReaScript: Load** →
`~/Library/Application Support/REAPER/Scripts/OpenReaper/openreaper_studio_dialog.lua` → **Run**.

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
| `OPENREAPER_STUDIO_PI_RPC_URL` | Optional HTTP endpoint for Send (JSON body) |
| `OPENREAPER_STUDIO_NODE` | Node binary for `ExecProcess` bridge (default: current Node) |

## Windows

Experimental wrappers: `studio-start.ps1` / `studio-stop.ps1` (same Node orchestrator).

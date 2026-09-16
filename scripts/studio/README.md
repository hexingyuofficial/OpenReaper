# OpenReaper Studio

One **Start** brings up REAPER + MCP bridge, optional Pi RPC, and the AI dialog face.  
One **Stop** tears down Studio-owned processes and hooks (REAPER stays running by default).

This folder is a **small framework**, not a pile of one-off scripts: orchestration steps, face
modules, contracts, and agent transports are separated so UI and Pi wiring can evolve without
rewiring Start/Stop.

## Prerequisites

- REAPER (macOS primary)
- OpenReaper release install at `~/.openreaper/current` (`bin/openreaper-start` or `openreaper-start.sh`)
- Node.js 20+
- **ReaImGui** (ReaPack) for the dialog MVP

Optional: [Pi](https://pi.dev) on `PATH` with existing `~/.pi/agent/mcp.json`.

## Run

```bash
./scripts/studio/studio-start.sh
./scripts/studio/studio-stop.sh
# or: npm run studio:start | studio:stop | studio:status
```

`OPENREAPER_INSTALL_ROOT` overrides the packaged install root.

## Architecture (runnable spine)

```text
studio-start.sh / studio-stop.sh
        │
        ▼
studio-orchestrate.mjs          ← CLI only
        │
        ├── lib/orchestration/   ← Start/Stop pipelines (ordered steps)
        ├── lib/face/            ← Install hook + runtime config on disk
        ├── lib/agent-seam/      ← Face → Pi/MCP transports
        └── lib/contracts/       ← Chips + prompt JSON shapes

REAPER __startup.lua (Studio hook)
        │
        ▼
Scripts/OpenReaper/openreaper_studio_dialog.lua   ← entry
Scripts/OpenReaper/studio/dialog/*.lua            ← face modules
        │
        ▼
reaper.ExecProcess → studio-pi-send.mjs → agent-seam/send-prompt.mjs
```

### Start pipeline (`lib/orchestration/start-steps.mjs`)

| Step id | What it does |
|---------|----------------|
| `face.prepare` | Copy dialog entry + `studio/dialog/` modules; write `face-config-v1.json`; set `open-face-on-load` |
| `engine.openreaper_start` | Run packaged `openreaper-start` (REAPER + MCP bridge) |
| `agent.pi_rpc` | Optional background `pi --mode rpc` (read-only `mcp.json` check) |
| `face.finalize` | Update face config + `session-v1.json` |

### Stop pipeline (`lib/orchestration/stop-steps.mjs`)

| Step id | What it does |
|---------|----------------|
| `agent.pi_rpc` | SIGTERM Pi if Studio started it |
| `face.hook` | Remove Studio-owned `__startup.lua` block if Studio added it |
| `engine.reaper_policy` | Preserve REAPER unless `OPENREAPER_STUDIO_STOP_REAPER=1` |
| `session.clear` | Clear open-face flag + session file |

## Module map

| Path | Role |
|------|------|
| `studio-orchestrate.mjs` | CLI: start / stop / status |
| `studio-pi-send.mjs` | Agent seam CLI (called from REAPER) |
| `lib/orchestration/*` | Pipelines and `runProcess` helper |
| `lib/face/hook.mjs` | Marked `__startup.lua` block |
| `lib/face/install.mjs` | Copy face bundle into REAPER resource path. Sources are always `reaper/` in this package, whether Start passes the git repo root, this directory, or omits the root. |
| `lib/face/runtime-config.mjs` | `~/.openreaper/studio/*` paths + face JSON |
| `lib/contracts/context-chip.mjs` | Chip kinds + normalization |
| `lib/contracts/prompt.mjs` | Prompt request/response contracts |
| `lib/agent-seam/send-prompt.mjs` | Transport router |
| `lib/agent-seam/transports/http-rpc.mjs` | `OPENREAPER_STUDIO_PI_RPC_URL` |
| `lib/agent-seam/transports/mock.mjs` | Default mock replies |
| `reaper/openreaper_studio_dialog.lua` | Installed entry script |
| `reaper/dialog/context_chip.lua` | Chip providers (+ menu) |
| `reaper/dialog/ui_face.lua` | ReaImGui layout (swap for WebView later) |
| `reaper/dialog/agent_bridge.lua` | ExecProcess → Node seam |
| `reaper/dialog/bootstrap.lua` | Single-instance defer loop |

Legacy re-exports (avoid in new code): `lib/face.mjs`, `lib/face-config.mjs`, `lib/pi-bridge.mjs`.

## AI dialog (try it)

After Start:

1. Floating **OpenReaper Studio** bar near the bottom (empty chips until you attach).
2. **+** → time selection, track, item, region, marker providers (`context_chip.lua`).
3. **x** on a chip dismisses it.
4. **Send** → `studio-pi-send.mjs` with `openreaper.studio.prompt_request.v1` JSON.

Manual reopen: Actions → ReaScript: Load →  
`~/Library/Application Support/REAPER/Scripts/OpenReaper/openreaper_studio_dialog.lua` → Run.

If REAPER was already running before Start, restart once so `__startup.lua` runs.

## Agent seam (Pi / MCP)

Transport order (`lib/agent-seam/send-prompt.mjs`):

1. **http_rpc** — set `OPENREAPER_STUDIO_PI_RPC_URL` (POST `{ message, chips }`)
2. **mock** — always available; explains Pi state from `session-v1.json`

**Extension point:** add `lib/agent-seam/transports/pi-stdio-rpc.mjs` and register it in
`TRANSPORT_ORDER` before `mock` when the owned `pi --mode rpc` client is implemented.

Studio **never** writes `~/.pi` or `mcp.json`.

## Context chip model

Contract: `openreaper.studio.context_chip.v1` (see `lib/contracts/context-chip.mjs`).

| Kind | Attach rule |
|------|-------------|
| `time` | Current loop/time selection |
| `track` | First selected track |
| `item` | First selected media item |
| `region` | Region under playhead |
| `marker` | Nearest marker to playhead |

**Extension point:** add a provider in `reaper/dialog/context_chip.lua` (`PROVIDERS` table) and
add the kind to `CONTEXT_CHIP_KINDS` in Node contracts.

## On-disk Studio files

| File | Purpose |
|------|---------|
| `~/.openreaper/studio/session-v1.json` | Last Start session (Pi pid, hook ownership) |
| `~/.openreaper/studio/face-config-v1.json` | Node path + agent seam CLI for REAPER |
| `~/.openreaper/studio/open-face-on-load` | One-shot flag consumed by dialog bootstrap |
| `~/.openreaper/studio/prompts/*.request.json` | Send audit trail |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENREAPER_INSTALL_ROOT` | Packaged install root |
| `OPENREAPER_STUDIO_SKIP_PI` | Skip Pi RPC step |
| `OPENREAPER_STUDIO_STOP_REAPER` | Request REAPER quit on Stop |
| `OPENREAPER_STUDIO_PI_ARGS` | Extra args after `pi --mode rpc` |
| `OPENREAPER_STUDIO_PI_RPC_URL` | HTTP agent transport |
| `OPENREAPER_STUDIO_NODE` | Node binary for ExecProcess |

## Windows

Experimental: `studio-start.ps1` / `studio-stop.ps1` (same orchestrator).

## Tests

```bash
npm test -- scripts/studio/__tests__/
```

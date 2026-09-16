# OpenReaper Studio

One **Start** brings up REAPER + MCP bridge, **private** Pi RPC, and the AI dialog face.  
One **Stop** tears down Studio-owned processes and hooks (REAPER stays running by default).

This folder is a **small framework**, not a pile of one-off scripts: orchestration steps, face
modules, contracts, and agent transports are separated so UI and Pi wiring can evolve without
rewiring Start/Stop.

## Step 1 (this slice)

| Capability | What you get |
|------------|----------------|
| **Private Pi** | Stock `pi --mode rpc` on `~/.openreaper/studio/pi/*` (or `vendor/pi` when bundled). Personal `~/.pi` is unused. |
| **Coupled lifecycle** | Start: face → bundled `openreaper-start` (REAPER + bridge) → private Pi RPC host → session. Stop: Pi host + face hooks. If Pi fails after REAPER is up, Start fails with logs; REAPER stays running unless `OPENREAPER_STUDIO_STRICT_COUPLING=1`. |
| **Bundled OpenReaper** | Start always uses `INSTALL_ROOT/bin/openreaper-start` (`~/.openreaper/current` by default). `engine-bundle-v1.json` records the packaged engine slot. |
| **Terminal-like dialog** | Send routes prompts/`/commands` through private Pi RPC (not a gutted mock). Typing `/` shows a slash palette with Pi `get_commands` names + descriptions. Empty or failed `get_commands` falls back to Studio builtin slash hints. |
| **Rough skin** | Floating ReaImGui bar (`studio_skin.lua`): neutral dark minimal AI-DAW look. Theme embed is a follow-up. |

## Prerequisites

- REAPER (macOS primary)
- OpenReaper release install at `~/.openreaper/current` (`bin/openreaper-start` or `openreaper-start.sh`)
- Node.js 20+
- **ReaImGui** (ReaPack) for the dialog MVP
- **Pi** binary for the agent (on `PATH` during dev, or bundled under `INSTALL_ROOT/vendor/pi` in packaging)

macOS **Accessibility** for Terminal/osascript is optional. Studio Start uses
soft dialog *inspection* (`OPENREAPER_STUDIO=1`): AX/osascript failures
(`-609`, `-2741` syntax, timeout, empty) become `inspection_unavailable` and do
not exit 75. Running out of attach/startup budget during dialog inspection is
also treated as `inspection_unavailable` under soft policy. After a stable
Project Settings soft-ignore, AX inspection is throttled so REAPER can publish
the startup hook and Bridge heartbeat inside the 60s budget (a published stage
is accepted even when leftover time is below `cleanup_reserve+250ms`). After a
soft-safe classification, a LaunchServices PID gap is an **adopt-window**
(`adopt_window_after_soft_safe`) until the successor publishes — helper must
not hard-fail at ~3s with `REAPER exited before its startup hook published a
stage`. Session env stays set (`held_until_helper_exit` /
`held_for_successor_publish`) so the restored PID still sees OpenReaper keys.
If Bridge heartbeat or `bridge_dofile_succeeded` is already live, the helper last-chance
accepts that instead of failing `STARTUP_BUDGET_EXHAUSTED`. Soft policy **does
not kill REAPER** on helper failure (`startup-reaper-preserve=soft_policy`), so
a budget miss cannot wipe the session before Pi RPC is published. A lone
**Project Settings** window is a recoverable soft blocker (not exit 75); Start
still does not click or close it. The **OpenReaper Studio** face title is
allowlisted. Real decision windows (missing media, license, etc.) still fail
closed. After LaunchServices launch, session env stays set until helper exit so
a restored/replaced REAPER PID can still publish the startup hook.
If `openreaper-start` exits **124** / `STARTUP_BUDGET_EXHAUSTED`, Studio still
finishes the Pi RPC + face-config gate (`engineDegraded=true`) and records
the helper **124** after that wire is live (never mask 124 as success).

Studio **does not** use the user's personal Pi (`~/.pi`, global `pi` login in Terminal). All agent
state is under OpenReaper Studio roots.

## Run

```bash
./scripts/studio/studio-start.sh
./scripts/studio/studio-stop.sh
# or: npm run studio:start | studio:stop | studio:status
```

`OPENREAPER_INSTALL_ROOT` overrides the packaged install root.

### macOS Start recovery

If Step 2 (`openreaper-start`) fails with **LaunchServices environment lock is already held** and no
`openreaper-start` is running, clear the orphan lock for your install root (default `~/.openreaper/current`):

```bash
rm -rf ~/.openreaper/current/session/.openreaper-launchservices-env.lock
```

Fresh installs normally reclaim dead-owner locks automatically; use the one-liner only when recovery
logs say the lock was retained.

### How to re-trial (macOS cold Start)

After `face.prepare` syncs the helper, grep `INSTALL_ROOT/bin/openreaper-start` for
`adopt_window_after_soft_safe`, `held_for_successor_publish`,
`successor_identity_pending`, `held_until_helper_exit`, and
`startup-dialog-soft-ignore=`. Cold Start with a lone Project Settings window
must soft-ignore (no exit 75), adopt the LaunchServices successor, publish a
startup stage, and leave `openreaper-start` at **exit 0** with Bridge usable.
Helper **124** must still appear as Start exit 124 (not masked as 0). Never
click/close REAPER windows.

## Private Pi (isolated from ~/.pi)

| Path | Purpose |
|------|---------|
| `~/.openreaper/studio/pi/agent/` | Private `PI_CODING_AGENT_DIR` (settings, `mcp.json`, extensions) |
| `~/.openreaper/studio/pi/agent/auth.json` | Provider auth for **in-app login** (next slice; not Terminal `/login`) |
| `~/.openreaper/studio/pi/sessions/` | Private `PI_CODING_AGENT_SESSION_DIR` |
| `INSTALL_ROOT/vendor/pi/` | Future one-click bundle (binary + layout); preferred when present |
| `~/.openreaper/studio/pi-rpc-endpoint-v1.json` | Loopback HTTP URL for the dialog seam |

Override roots with `OPENREAPER_STUDIO_PI_ROOT`. Override binary with `OPENREAPER_STUDIO_PI_BIN`.

Start launches `studio-pi-rpc-host.mjs`, which spawns stock `pi --mode rpc` with
`PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` pointed at the private tree.
If the endpoint file already has a healthy `/health`, Start reuses that host
instead of spawning a duplicate orphan. Stop SIGTERMs the RPC host (which tears
down Pi). `studio status` prints `private_pi_rpc_health=ok|down` when a session
is active.

**Lifecycle coupling:** Start order is face → `openreaper-start` (REAPER + bridge)
→ private Pi RPC → session finalize (`face.finalize` always runs). The **Start
gate** is dialog face ↔ private Pi: `face-config-v1.json` with
`piMode: rpc_background` + RPC URLs, healthy `/health`, and a non-empty
`/commands` palette (builtin hints if Pi returns []). Engine/Bridge is not the
gate. If `openreaper-start` exits non-zero, Start probes Bridge heartbeat: live
heartbeat is a soft-continue; if Bridge is **not** live (budget kill, attach
miss), Start still continues with `engineDegraded=true` / WARN so the Pi wire
is not stranded on `pending`. Soft policy never kills REAPER on helper failure.
If Pi RPC itself cannot start, Start fails after still publishing face-config
(not `pending`).

## Architecture (runnable spine)

```text
studio-start.sh / studio-stop.sh
        │
        ▼
studio-orchestrate.mjs          ← CLI only
        │
        ├── lib/orchestration/   ← Start/Stop pipelines (ordered steps)
        ├── lib/pi/              ← Private layout + Pi CLI plan
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
                                              │
                                              ▼
                         studio-pi-rpc-host → pi --mode rpc (private agentDir)
```

### Start pipeline (`lib/orchestration/start-steps.mjs`)

| Step id | What it does |
|---------|----------------|
| `face.prepare` | Copy dialog entry + `studio/dialog/` modules; sync tracked `openreaper-start` into `INSTALL_ROOT/bin`; write `face-config-v1.json`; set `open-face-on-load` |
| `engine.openreaper_start` | Run `INSTALL_ROOT/bin/openreaper-start` with `OPENREAPER_STUDIO=1`. Non-zero exit probes Bridge; live heartbeat is ok-ish, otherwise `engineDegraded` WARN. **Never aborts the Pi/face wire.** |
| `agent.pi_rpc` | Detached `studio-pi-rpc-host.mjs` → `pi --mode rpc` on private dirs; reuses a healthy host; warms `/commands`. |
| `face.finalize` | Always runs. Publishes `face-config-v1.json` (`rpc_background` + URLs when Pi started). |

### Stop pipeline (`lib/orchestration/stop-steps.mjs`)

| Step id | What it does |
|---------|----------------|
| `agent.pi_rpc` | SIGTERM private Pi RPC host (and Pi child) if Studio started it |
| `face.hook` | Remove Studio-owned `__startup.lua` block if Studio added it |
| `engine.reaper_policy` | Preserve REAPER unless `OPENREAPER_STUDIO_STOP_REAPER=1` |
| `session.clear` | Clear open-face flag + session file |

## Module map

| Path | Role |
|------|------|
| `studio-orchestrate.mjs` | CLI: start / stop / status |
| `studio-pi-send.mjs` | Agent seam CLI (called from REAPER) |
| `studio-pi-commands.mjs` | Pi slash command list for the dialog palette |
| `studio-pi-rpc-host.mjs` | Long-lived private `pi --mode rpc` + loopback HTTP (`/prompt`, `/commands`, `/health`) |
| `reaper/dialog/studio_skin.lua` | Step 1 default float skin |
| `lib/pi/private-layout.mjs` | Studio Pi roots (never `~/.pi`) |
| `lib/orchestration/pi-rpc-lifecycle.mjs` | Start host, health probe |
| `lib/orchestration/*` | Pipelines and `runProcess` helper |
| `lib/face/hook.mjs` | Marked `__startup.lua` block |
| `lib/face/install.mjs` | Copy face bundle into REAPER resource path. Sources are always `reaper/` in this package, whether Start passes the git repo root, this directory, or omits the root. |
| `lib/face/start-helper.mjs` | Sync tracked `packaging/macos/.../openreaper-start` into `INSTALL_ROOT/bin` |
| `lib/face/runtime-config.mjs` | `~/.openreaper/studio/*` paths + face JSON |
| `lib/contracts/context-chip.mjs` | Chip kinds + normalization |
| `lib/contracts/prompt.mjs` | Prompt request/response contracts |
| `lib/contracts/startup-dialog-result.mjs` | Soft/strict dialog inspection classification |
| `lib/agent-seam/send-prompt.mjs` | Transport router |
| `lib/agent-seam/transports/http-rpc.mjs` | `OPENREAPER_STUDIO_PI_RPC_URL` / face `piRpcUrl` |
| `lib/agent-seam/transports/mock.mjs` | Explicit fallback when RPC is absent or unreachable |
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
4. **Send** → `studio-pi-send.mjs` → private Pi RPC when `piRpcUrl` is set; otherwise mock with a clear status string.

Manual reopen: Actions → ReaScript: Load →  
`~/Library/Application Support/REAPER/Scripts/OpenReaper/openreaper_studio_dialog.lua` → Run.

If REAPER was already running before Start, restart once so `__startup.lua` runs.

## Agent seam (Pi / MCP)

Transport order (`lib/agent-seam/send-prompt.mjs`):

1. **http_rpc** — `OPENREAPER_STUDIO_PI_RPC_URL` or `face-config-v1.json` `piRpcUrl` (Studio Start sets this)
2. **mock** — fallback only; UI text explains private Pi state

Studio **never** reads or writes personal `~/.pi` by default.

## Packaging notes (installer spine)

A future one-click Studio installer should ship:

1. OpenReaper alpha layout under `~/.openreaper/current` (existing pattern).
2. Stock Pi under `INSTALL_ROOT/vendor/pi/bin/pi` (no Studio-specific Pi fork yet).
3. Studio face + orchestration scripts (this tree).
4. First-run Start that creates `~/.openreaper/studio/pi/agent` and optional default `mcp.json` for OpenReaper MCP (not in this slice).

Dev machines can use global `pi` on PATH; `PI_CODING_AGENT_DIR` still isolates config from `~/.pi`.

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
| `~/.openreaper/studio/session-v1.json` | Last Start session (Pi host pid, RPC URLs, hook ownership) |
| `~/.openreaper/studio/face-config-v1.json` | Node path + agent seam CLI + `piRpcUrl` for REAPER |
| `~/.openreaper/studio/open-face-on-load` | One-shot flag consumed by dialog bootstrap |
| `~/.openreaper/studio/prompts/*.request.json` | Send audit trail |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENREAPER_INSTALL_ROOT` | Packaged install root (`~/.openreaper/current`; session/vendor stay there) |
| `OPENREAPER_STARTUP_DIALOG_POLICY` | `soft` or `strict` dialog inspection; default `soft` when `OPENREAPER_STUDIO=1`. Soft ignores AX failures and a lone Project Settings window without clicking. |
| `OPENREAPER_STUDIO_SKIP_PI` | Skip private Pi RPC step |
| `OPENREAPER_STUDIO_STOP_REAPER` | Request REAPER quit on Stop |
| `OPENREAPER_STUDIO_PI_ROOT` | Override private Pi tree root |
| `OPENREAPER_STUDIO_PI_BIN` | Override `pi` executable path |
| `OPENREAPER_STUDIO_PI_ARGS` | Extra args after `pi --mode rpc` |
| `OPENREAPER_STUDIO_PI_RPC_URL` | Force HTTP agent transport (usually set via face config) |
| `OPENREAPER_STUDIO_STRICT_COUPLING` | `1` = quit REAPER when private Pi fails mid-Start (legacy coupled rollback) |
| `OPENREAPER_STUDIO_LOOSE_COUPLING` | `1` = same as default (do not quit REAPER on Pi failure) |
| `OPENREAPER_STUDIO_RELAUNCH_STALE` | `1` = force one automated REAPER relaunch when attach sees a stale bridge heartbeat |
| `OPENREAPER_STUDIO_NODE` | Node binary for ExecProcess |

## Windows

Experimental: `studio-start.ps1` / `studio-stop.ps1` (same orchestrator).

## Tests

```bash
npm test -- scripts/studio/__tests__/
```

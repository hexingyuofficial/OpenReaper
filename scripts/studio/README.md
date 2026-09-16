# OpenReaper Studio

One **Start** brings up REAPER + the in-REAPER Bridge, **private** Pi (native OpenReaper tools), and the AI dialog face.  
One **Stop** tears down Studio-owned processes and hooks (REAPER stays running by default). When REAPER itself quits, the Studio steward stops Pi.

This folder is a **small framework**, not a pile of one-off scripts: orchestration steps, face
modules, contracts, and agent transports are separated so UI and Pi wiring can evolve without
rewiring Start/Stop.

## Step 1 (this slice)

| Capability | What you get |
|------------|----------------|
| **Private Pi** | Stock `pi --mode rpc` on `~/.openreaper/studio/pi/*` (or `vendor/pi` when bundled). Personal `~/.pi` is unused. Spawned with cwd=`~/.openreaper/studio/workspace`, `--no-builtin-tools`, and `--extension` pointing at `packages/pi-extension-openreaper` (`openreaper_ping` stub). |
| **Coupled lifecycle** | Start: face → bundled `openreaper-start` (REAPER + bridge) → steward (`studio-pi-rpc-host`) → session. Stop: SIGTERM steward + wait + drop endpoint file. The steward watches `session/reaper.pid` and stops Pi when REAPER exits (LaunchServices successor grace). If Pi fails after REAPER is up, Start fails with logs; REAPER stays running unless `OPENREAPER_STUDIO_STRICT_COUPLING=1`. |
| **Native tools (not MCP)** | OpenReaper capabilities are Pi `registerTool`s. Start does **not** write `mcp.json` and does **not** spawn `streetlight-mcp` stdio. The file-queue Bridge inside REAPER stays; P2 will call it from the extension. |
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
Project Settings soft-ignore, AX inspection **stops**. Soft/Studio also keeps a
**quiet window** (`STARTUP_HOOK_QUIET_TICKS`) before the first inspect so
`__startup.lua` can publish before System Events touches the PID. The helper
installs a kernel startup hook on the cold path with this run's absolute
status-file path, then **pokes** the trusted Bridge launcher into the live
instance after a lone Project Settings window (never clicks it). A published
stage is accepted even when leftover time is below `cleanup_reserve+250ms`.
After a soft-safe classification, a LaunchServices PID gap is an **adopt-window**
(`adopt_window_after_soft_safe`) until the successor publishes — including
before the first AX pass. Helper must not hard-fail at ~3s with `REAPER exited
before its startup hook published a stage`. Session env stays set
(`held_until_helper_exit` / `held_for_successor_publish`) so the restored PID
still sees OpenReaper keys. Wait loops poll until the cleanup reserve. If
Bridge heartbeat or `bridge_dofile_succeeded` is already live, the helper
last-chance accepts that instead of failing `STARTUP_BUDGET_EXHAUSTED`. Soft
policy **does not kill REAPER** on helper failure
(`startup-reaper-preserve=soft_policy`). A lone **Project Settings** window is
a recoverable soft blocker (not exit 75); Start still does not click or close
it. The **OpenReaper Studio** face title is allowlisted. Real decision windows
(missing media, license, etc.) still fail closed. After LaunchServices launch, session env stays set until
helper exit so a restored/replaced REAPER PID can still publish the startup hook.
`face.prepare` copies the tracked packaging helper into
`INSTALL_ROOT/bin/openreaper-start`, overwrites a stale companion
`openreaper-start.sh`, and pins Start to that dest. The helper logs
`start-helper-rev=studio-hook-publish-v7`; Start refuses to spawn a dest
missing that rev. If `openreaper-start` exits **124** /
`STARTUP_BUDGET_EXHAUSTED`, Studio still finishes the Pi RPC + face-config
gate (`engineDegraded=true`). Helper **124** is persisted in session state +
face-config and logged as WARN. After `finishStudioStartGate` succeeds,
**Start exits 0** so NAS `trial-open.sh` can write READY. Do not copy helper
124 onto `process.exitCode`. A failed Pi gate still exits non-zero.

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
`OPENREAPER_START_HELPER_REV="studio-hook-publish-v7"`, `adopt_window_after_soft_safe`,
`held_for_successor_publish`, `successor_identity_pending`, `held_until_helper_exit`,
`startup-dialog-soft-ignore=`, `STARTUP_HOOK_QUIET_TICKS`,
`startup-hook-poke=trusted_launcher`, `startup-hook-poke=studio_face`,
`ensure_openreaper_startup_hook`,
`STARTUP_DIALOG_FIRST_TIMEOUT_SECONDS`, and
`startup_wait_poll_ticks`. Cold Start with a lone Project Settings window
must soft-ignore (no exit 75), give `__startup.lua` a quiet window, poke the
trusted launcher if the status file is still missing, poke the Studio face
script when `OPENREAPER_STUDIO_FACE_SCRIPT` is set, publish a
startup stage, and leave `openreaper-start` at **exit 0** with Bridge usable
when the hook publishes in time. If the helper still exits **124**, Start
records it in state/`engineDegraded` and **exits 0** after the Pi gate
succeeds (READY). A failed Pi gate is still non-zero. Never click/close
REAPER windows.

## Private Pi (isolated from ~/.pi)

| Path | Purpose |
|------|---------|
| `~/.openreaper/studio/pi/agent/` | Private `PI_CODING_AGENT_DIR` (settings, extensions). `mcp.json` is **not** the product path. |
| `~/.openreaper/studio/pi/agent/extensions/` | Copy of `packages/pi-extension-openreaper` for inspection `/reload`. Runtime load is `--extension`. |
| `~/.openreaper/studio/workspace/` | Fixed Studio workspace — Pi **cwd**. Override with `OPENREAPER_STUDIO_WORKSPACE`. |
| `~/.openreaper/studio/pi/agent/auth.json` | Provider auth for **in-app login** (next slice; not Terminal `/login`) |
| `~/.openreaper/studio/pi/sessions/` | Private `PI_CODING_AGENT_SESSION_DIR` |
| `INSTALL_ROOT/vendor/pi/` | Future one-click bundle (binary + layout); preferred when present |
| `~/.openreaper/studio/pi-rpc-endpoint-v1.json` | Loopback HTTP URL for the dialog seam |

Override roots with `OPENREAPER_STUDIO_PI_ROOT`. Override binary with `OPENREAPER_STUDIO_PI_BIN`.

Start launches `studio-pi-rpc-host.mjs` (the **steward**), which spawns stock
`pi --mode rpc --no-builtin-tools --no-extensions --extension <openreaper-extension>`
with `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` pointed at the private
tree and **cwd** at the Studio workspace. If the endpoint file already has a
healthy `/health`, Start reuses that host instead of spawning a duplicate orphan.
Stop SIGTERMs the steward, waits, and removes the endpoint file. The steward
also watches `INSTALL_ROOT/session/reaper.pid` (with successor-adopt grace) so
quitting REAPER stops Pi. `studio status` prints `private_pi_rpc_health=ok|down`
when a session is active.

**Lifecycle coupling:** Start order is face → `openreaper-start` (REAPER + bridge)
→ private Pi RPC → session finalize (`face.finalize` always runs). The **Start
gate** is dialog face ↔ private Pi: `face-config-v1.json` with
`piMode: rpc_background` + RPC URLs, healthy `/health`, and a non-empty
`/commands` palette (builtin hints if Pi returns []). Engine/Bridge is not the
gate. If `openreaper-start` exits non-zero, Start probes Bridge heartbeat: live
heartbeat is a soft-continue; if Bridge is **not** live (budget kill, attach
miss), Start still continues with `engineDegraded=true` / WARN so the Pi wire
is not stranded on `pending`. After the Pi gate succeeds, Start **exits 0**
even if the helper was 124; helper codes stay in state + face-config only.
Soft policy never kills REAPER on helper failure.
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
                         studio-pi-rpc-host (steward) → pi --mode rpc --no-builtin-tools
                                              −e packages/pi-extension-openreaper
                                              cwd=~/.openreaper/studio/workspace
```

### Start pipeline (`lib/orchestration/start-steps.mjs`)

| Step id | What it does |
|---------|----------------|
| `face.prepare` | Copy dialog entry + `studio/dialog/` modules; sync tracked `openreaper-start` into `INSTALL_ROOT/bin` (fingerprint + dest pin; overwrite stale `.sh`); write `face-config-v1.json`; set `open-face-on-load` |
| `engine.openreaper_start` | Run the synced `INSTALL_ROOT/bin/openreaper-start` with `OPENREAPER_STUDIO=1` (refuses a dest missing `studio-hook-publish-v7`). Non-zero exit probes Bridge; live heartbeat is ok-ish, otherwise `engineDegraded` WARN. **Never aborts the Pi/face wire.** After the Pi gate succeeds, Start **exits 0**; helper 124 stays in state + face-config. |
| `agent.pi_rpc` | Detached steward `studio-pi-rpc-host.mjs` → `pi --mode rpc --no-builtin-tools --extension …` on private dirs + workspace cwd; reuses a healthy host; warms `/commands`. Watches REAPER pid. |
| `face.finalize` | Always runs. Publishes `face-config-v1.json` (`rpc_background` + URLs when Pi started). |

### Stop pipeline (`lib/orchestration/stop-steps.mjs`)

| Step id | What it does |
|---------|----------------|
| `agent.pi_rpc` | SIGTERM steward host, wait/kill leftovers, unlink endpoint file |
| `face.hook` | Remove Studio-owned `__startup.lua` block if Studio added it |
| `engine.reaper_policy` | Preserve REAPER unless `OPENREAPER_STUDIO_STOP_REAPER=1` |
| `session.clear` | Clear open-face flag + session file |

## Module map

| Path | Role |
|------|------|
| `studio-orchestrate.mjs` | CLI: start / stop / status |
| `studio-pi-send.mjs` | Agent seam CLI (called from REAPER) |
| `studio-pi-commands.mjs` | Pi slash command list for the dialog palette |
| `studio-pi-rpc-host.mjs` | Steward: private `pi --mode rpc` + loopback HTTP (`/prompt`, `/commands`, `/health`); stops when REAPER exits |
| `packages/pi-extension-openreaper/` | Native Pi tools (`openreaper_ping` stub now; file-queue ping/get_state/call_* in P2) |
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
4. First-run Start that creates `~/.openreaper/studio/pi/agent` and installs
   `packages/pi-extension-openreaper` (native tools). **Do not** ship a default
   `mcp.json` that launches `streetlight-mcp` stdio — that is not the Studio path.

## Remaining work (P1 / P2)

- **P1:** Bundle a specialized Pi (not `~/.pi`); copy AGENTS.md / SYSTEM.md into the private agent dir; in-app login.
- **P2:** `openreaper_ping` / `get_state` / `call_template` inside the Pi extension calling the existing file-queue Bridge; refuse rename/move of original audio assets. Drop leftover `mcp.json` if any trial machine still has one.

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
| `OPENREAPER_STARTUP_DIALOG_POLICY` | `soft` or `strict` dialog inspection; default `soft` when `OPENREAPER_STUDIO=1`. Soft ignores AX failures and a lone Project Settings window. License/missing-media/unknown stay fail-closed. Start never clicks REAPER dialogs. |
| `OPENREAPER_STUDIO_SKIP_PI` | Skip private Pi RPC step |
| `OPENREAPER_STUDIO_STOP_REAPER` | Request REAPER quit on Stop |
| `OPENREAPER_STUDIO_PI_ROOT` | Override private Pi tree root |
| `OPENREAPER_STUDIO_PI_BIN` | Override `pi` executable path |
| `OPENREAPER_STUDIO_PI_ARGS` | Extra args after `pi --mode rpc` |
| `OPENREAPER_STUDIO_WORKSPACE` | Override Pi cwd (default `~/.openreaper/studio/workspace`) |
| `OPENREAPER_STUDIO_PI_EXTENSION` | Override `--extension` path (default `packages/pi-extension-openreaper/openreaper-extension.mjs`) |
| `OPENREAPER_STUDIO_PI_KEEP_BUILTIN_TOOLS` | `1` = keep Pi bash/read/write (not the product default; extension still loads) |
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

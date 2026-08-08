# OpenReaper

OpenReaper is an evidence-bound MCP bridge and task runtime for REAPER. It lets
an MCP-capable agent inspect a project, execute reviewed Macros, Templates, and
Recipes, verify changes from live REAPER readback, and retain bounded evidence.
Version `0.1.0` is the evidence-bound macOS and Windows x64 release line.

OpenReaper exposes exactly six agent-facing MCP tools:

```text
ping  get_state  list_templates  list_recipes  call_template  call_recipe
```

The normal flow is simple: describe the result, let the agent discover the
right Macro or Recipe, execute one bounded call, and read the result verified by
REAPER. The product does not expose raw Lua, arbitrary REAPER Actions, shell
execution, raw SQL, hardware/device I/O, or an unreviewed executor.

## Five-Minute Start

1. Install the package for your platform.
2. Restart the MCP client after installation so it reloads the `openreaper`
   server configuration.
3. Start REAPER through OpenReaper's packaged start command.
4. Ask the agent: `Inspect the current REAPER project and tell me what is ready.`

On macOS, use `./install.command`, then:

```text
~/.openreaper/current/bin/openreaper-start
```

On Windows, use native Windows PowerShell from the extracted package:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-openreaper.ps1
powershell.exe -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenReaper\current\bin\openreaper-start.ps1"
```

The Windows package requires Node.js 20 or newer and does not require Git Bash,
Git, WSL, SSH, SWS, ReaPack, or third-party plugins. The tested Windows
support row is Windows 11 x64 build 26200 with the tested stable REAPER build;
other combinations remain evidence-bound.

## Product Surface

Discovery presents fifteen peer Macros. Prefer one Macro for a common task and
one Recipe for a reusable multi-stage workflow. Direct Templates are a typed
fallback only when no Macro owns the request. Every write resolves its target
in live REAPER and requires live readback before it is reported as applied.

The `0.1.0` release line covers the reviewed audio workflows for media placement,
waveform/readback truth, source/item/take normalization, and Remove Silence.
Remove Silence supports the packaged `Remove Silence...` and `Repeat Remove
Silence with Last Settings` Actions plus the Macro route, with `all`, `leading`,
`trailing`, `edges`, and `internal` scopes. Normalization uses REAPER's native
normalization calculation for LUFS-I, RMS-I, peak, true peak, LUFS-M max, and
LUFS-S max. Normalization is source/item/take pre-FX; it is not a post-FX claim.

The four official Recipes are:

```text
recipe.mix.create_bus_processing
recipe.midi.create_instrument_part
recipe.media.create_layered_sound_effect_variants
recipe.items.create_sound_variations
```

Official, user-authored, and forked Recipes use the same generic runner,
aggregate readback, and Whole-Recipe Undo path. Recipe execution remains
serial, and unsupported or stale targets fail closed with typed recovery.

## Safety And Limits

OpenReaper does not directly select or copy a user's REAPER theme, license,
plugins, source media, or user Recipes. It registers only OpenReaper-owned
entries and preserves unrelated MCP configuration. Normal REAPER startup and
project open/close may update REAPER's own session/history fields; final
acceptance records that stock churn separately from product writes. License,
plugin scan, recovery, upgrade, version, and unknown decision windows remain
user-mediated and fail closed. Hardware playback and recording require an
available audio device; offline project, media, render, and Bridge workflows do
not require one.

Every complete accepted Template, Macro, Action, and Recipe is subject to the
internal repeated-evidence performance gate of less than 30 seconds. Support is
limited to the tested OS, architecture, REAPER version, configuration path,
and evidence-backed modes. Linux, Windows ARM, Intel macOS, arbitrary plugin
state cloning, post-FX normalization, and untested combinations are not claimed.

## Read Next

- [Agent Start Here](docs/AGENT_START_HERE.md) / [中文](docs/AGENT_START_HERE.zh-CN.md)
- [User Guide](docs/USER_GUIDE.md) / [中文](docs/USER_GUIDE.zh-CN.md)
- [Developer Guide](docs/DEVELOPER_GUIDE.md) / [中文](docs/DEVELOPER_GUIDE.zh-CN.md)
- [Support Matrix](docs/SUPPORT_MATRIX.md)
- [Runbook](docs/RUNBOOK.md)

## Checks

From the repository root:

```bash
npm test
```

The default checks validate the ABI, catalog, runtime, packaging helpers, and
Recipe contracts. Live REAPER evidence is opt-in and uses a fresh evidence root.

# OpenReaper 0.1.0 Support Matrix

OpenReaper support is evidence-bound. A row is supported only for the listed
operating system, architecture, REAPER family, product route, and limits.
Untested combinations are not implied by a nearby supported row.

## Product Surface

| Area | Status | Supported row |
|---|---|---|
| MCP tools | supported | Exactly `ping`, `get_state`, `list_templates`, `list_recipes`, `call_template`, and `call_recipe`. |
| Discovery | supported | Compact discovery, exact-id expansion, 15 visible executable Macros, and typed direct-Template fallback. |
| Templates | supported for accepted catalog | 239 accepted official Templates with 91 registered Bridge handler modules; exact modes and schemas remain authoritative. |
| Recipes | supported | Four official Recipes plus validated user and forked Recipes through the same generic serial runner. |
| Recipe execution | supported | One `call_recipe`, complete preflight and plan, aggregate readback/evidence, resume/reconnect, and one Whole-Recipe Undo. |
| REAPER Actions | supported | `Remove Silence...`, `Repeat Remove Silence with Last Settings`, and `OpenReaper: Start MCP bridge` recovery Action. |
| Evidence | supported | Fresh bounded evidence roots, live REAPER readback, typed mutation truth, and exact package provenance. |

## Tested Platforms

| Platform | Status | Tested row |
|---|---|---|
| macOS | supported | Apple silicon, macOS 26.5.1, REAPER 7.71, normal per-user REAPER configuration. |
| Windows | supported | Windows 11 x64 build 26200, REAPER 7.78 x64, native Windows PowerShell, standard per-user REAPER resource path. |
| Windows paths | supported | Drive-letter, spaces, Unicode user/path, explicit custom path, and bounded UNC transport/media paths. |
| Node.js | required | Node.js 20 or newer. Windows normal operation does not depend on Git Bash, Git, WSL, or SSH. |
| Other REAPER/OS combinations | untested | Require matching installed evidence before a support claim. |
| Linux, Windows ARM, Intel macOS | unsupported | No 0.1.0 installed-product support claim. |

Both supported platforms prove install, Doctor, normal start, Bridge heartbeat,
public read probe, reconnect after manual REAPER close, update, uninstall, and
reinstall. Installers preserve unrelated MCP configuration and user-owned
REAPER state. Windows PowerShell hosts are hidden during normal agent-assisted
startup; the REAPER application remains visible.

## Audio And Media

| Capability | Status | Limits and truth boundary |
|---|---|---|
| Media placement | supported | Accepted placement modes, Unicode source/Take identity, waveform/readback truth, and separate-Track simultaneous layering. |
| Render | supported | Accepted WAV/OGG modes under the managed render root with measured non-silent output and source preservation. |
| Remove Silence | supported | Selected audio Items only; scopes `all`, `leading`, `trailing`, `edges`, and `internal`; threshold, minimum silence, padding, minimum kept audio, and fade controls. |
| Remove Silence batch | supported | 1-64 exact Items, whole-batch analysis before mutation, one native batch, one Undo, aggregate readback, source/Track/timeline preservation, and no ripple. 65 targets fail closed with zero writes. |
| Normalize level | supported | `lufs_i`, `rms_i`, `peak`, `true_peak`, `lufs_m_max`, and `lufs_s_max` through REAPER `CalculateNormalization`. |
| Normalize batch | supported | 1-64 exact Items in one native batch and one Undo. 65 targets fail closed with zero writes. Scope is source/item/take pre-FX, not post-FX. |
| Audio hardware | outside product boundary | Playback and recording need a configured device. Offline project, Bridge, media, analysis, and render workflows do not. |

All-silent audio Items are preserved and reported with typed truth. MIDI,
unsupported source types, stale targets, invalid settings, and oversized
selections fail closed before mutation.

## Official Recipes

| Recipe | Status |
|---|---|
| `recipe.mix.create_bus_processing` | supported |
| `recipe.midi.create_instrument_part` | supported |

Official, user-authored, forked, and learned Recipes use the same generic
runner. Official Recipes are not special-cased in the execution kernel.

## Preservation And Safety

| State | Contract |
|---|---|
| REAPER theme and preferences | Preserved. OpenReaper does not select a theme or take over `reaper.ini`. |
| License and plugin state | Preserved. No macOS license/theme/plugin state is copied to Windows. |
| User Recipes | Preserved across install, update, uninstall, and reinstall. |
| Source media and external renders | Never deleted by default; exact acceptance fixtures remain byte-stable. |
| MCP client configuration | Only exact OpenReaper-owned rows are added, updated, or removed; unrelated rows remain unchanged. |
| Startup decisions | License, plugin scan, recovery, version/upgrade, and unknown decision windows remain user-mediated and fail closed. |
| Dependencies | No SWS, ReaPack, third-party plugin, virtual audio device, or third-party runtime dependency. |

Every accepted complete Template, Macro, packaged Action, and Recipe is gated
by repeated fresh evidence below 30 seconds, including validation, preflight,
transport, native mutation, aggregate readback, evidence, and Undo closure.
This is an internal release gate, not a default user-selected deadline.

## Explicit Non-Goals

- Raw Lua, arbitrary REAPER Action, shell, SQL, or UI execution through MCP.
- Arbitrary third-party FX state cloning or unreviewed plugin semantics.
- Post-FX normalization, fades-as-normalization, or a custom loudness engine.
- Project meter control, hardware/device routing, or control-surface automation.
- Arbitrary output paths, external encoders, or every media format.
- Automatic handling of license, plugin, recovery, version, or unknown dialogs.
- Claims for untested operating systems, architectures, REAPER versions, or
  configurations.

## Typed Blockers

Unsupported or unsafe states return typed blockers such as
`blocked_platform`, `blocked_reaper_version`, `blocked_bridge_not_running`,
`blocked_bridge_owner_mismatch`, `blocked_bridge_generation_mismatch`,
`blocked_fixture_missing`, `blocked_artifact_root`, `blocked_render_collision`,
`blocked_plugin_unavailable`, and `blocked_live_evidence`. A blocker is not
converted into best-effort mutation.

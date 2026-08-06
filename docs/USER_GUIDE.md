# OpenReaper User Guide

Status: OpenReaper 0.1.0 candidate. Support remains evidence-bound.

OpenReaper lets you work with a live REAPER project by talking to an agent. You
do not need to understand Macros, Templates, SQLite, object refs, artifacts, or
bridge internals. Describe the result you want; the agent should choose a
supported route, perform the work, and verify the result in REAPER.

## Basic Flow

Most sessions should be simple:

1. Describe the task in normal language.
2. Let the agent inspect the current project or selection.
3. Approve a bounded scope when the task crosses a real safety boundary.
4. Let the agent execute ordinary reversible work without stopping after a
   plan.
5. Read the concise result: what changed, what REAPER verified, and what still
   needs attention.

Useful prompts:

```text
Inspect this project and tell me what is selected.
Arrange these selected items so their starts line up.
Add the accepted gentle ReaComp chain to the vocal track.
Render the selected tracks as WAV files.
Save the current project.
```

The agent must not report a plan, preview, or successful dispatch as completed
work. A successful write requires live REAPER readback.

## The Macro Surface

OpenReaper has 15 visible, executable Macros. They are one flat product surface;
there is no Primary/Secondary tier.

| Macro | Current role |
|---|---|
| `macro.project.inspect` | Read a compact live project overview. |
| `macro.project.query` | Search indexed project candidates, coverage, and changed state. |
| `macro.project.delete_targets` | Preview and perform supported, confirmed target deletion with absence readback. |
| `macro.project.apply_layout` | Apply supported track and folder creation, order, color, and nesting. |
| `macro.project.file` | Save the current project or use the accepted save-as path. |
| `macro.routing.apply` | Apply supported internal routing changes and verify the live graph. |
| `macro.media.place_assets` | Place approved media through the accepted bounded placement modes. |
| `macro.items.analyze` | Read Item/take facts and supported audio or timing measurements. |
| `macro.items.apply` | Arrange Items, choose Active Takes, or apply accepted properties, fades, exact trims, Take playback, and snap offsets. |
| `macro.midi.apply` | Create bounded clips, edit or quantize existing notes, or insert CC events with exact Take readback. |
| `macro.fx.apply_chain` | Apply a bounded Track/Take chain from REAPER's installed FX inventory and verify the complete final chain. |
| `macro.fx.set_controls` | Set accepted controls on an existing supported FX and verify every value. |
| `macro.controls.set` | Set accepted project, track, transport, and send controls, including project BPM. |
| `macro.automation.apply` | Apply supported Envelope points, lane/Track modes, FX-parameter points, and Automation Item operations. |
| `macro.render.targets` | Render supported project, selection, region, Item, or Track targets as managed-root WAV/OGG output. |

Each Macro has a bounded schema. "Executable" does not mean that every imagined
mode is accepted. The exact Macro manual is the authority for supported fields,
limits, risk, confirmation, readback, and held modes.

## How Discovery Works

By default, the agent receives one compact menu containing all 15 Macros and an
intent-based recommendation of the best one to three for the current request.
This keeps ordinary work fast without hiding the full product surface.

The complete action manual is expanded only when the agent requests an exact
Macro ID. Old Macro IDs do not appear in the menu; supported old IDs remain
hidden compatibility mappings to a current canonical Macro.

A direct Template is a valid long-tail fallback, not the normal route. The
agent should use one only when no visible Macro covers the task, then record a
typed reason such as:

- the Macro does not cover this task;
- the requested mode is outside the accepted Macro scope;
- the target cannot be resolved safely through the Macro;
- the domain is not accepted yet;
- one bounded atomic Template is the more appropriate response-budget route.

The fallback must still be an accepted, discoverable Template. OpenReaper does
not expose raw Lua, raw REAPER Actions, arbitrary shell execution, raw SQL, or a
hidden recipe executor.

## Starting Or Reconnecting

You can say:

```text
Open REAPER with OpenReaper.
Reconnect to my REAPER session.
Check whether OpenReaper is healthy.
```

For the installed package, the agent should:

1. Run `~/.openreaper/current/bin/openreaper-start`.
2. On first use, choose whether OpenReaper may handle its exact safe startup
   windows once, always, or not at all. The agent must ask; it cannot infer this.
3. Rerun the exact command printed by the helper. `always` and `manual` persist
   across upgrades, while `once` applies only to that launch.
4. Wait for the autonomous Bridge heartbeat and public read probe to pass.
5. Reconnect the MCP server named `openreaper` if its prior session was stale.

On Windows, the equivalent native PowerShell command is:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenReaper\current\bin\openreaper-start.ps1"
```

Windows normal operation does not require Git Bash, Git, WSL, SSH, SWS,
ReaPack, or third-party plugins. Node.js 20 or newer is required.

The three exact choices are:

```text
openreaper-start --startup-dialog-consent once
openreaper-start --startup-dialog-consent always
openreaper-start --startup-dialog-consent manual
```

`manual` means OpenReaper will not click any startup window. It still checks
the window state read-only and waits for you to clear every blocker before it
can report the Bridge ready.

Consent covers only Project Settings / Notes, `Ignore all missing files`, and
the exact media-items-offline warning. License, recovery, plugin, version,
ambiguous, decision-bearing, and unknown windows always fail closed, including
after an `always` choice. The fixed package-local launcher starts the Bridge
automatically; the `OpenReaper: Start MCP bridge` Action is recovery-only. SWS
is not required.

## Project Index And Live Truth

SQLite is a fast navigation and project-understanding layer. It is not the
project and never has write authority. REAPER live state is the source of truth.

For large projects, OpenReaper can keep complete internal index knowledge while
returning compact public pages. Public response limits must not silently remove
later tracks or other targets from internal knowledge. An incomplete index
cannot prove that a target does not exist; the agent must refresh or report
incomplete coverage instead of returning a definitive not-found answer.

Before a write, the agent must resolve the exact live target again. After the
write, it must read back the affected rows from REAPER. The result should report
these separately:

- whether the mutation was dispatched;
- whether live readback matched the requested change;
- whether Project Index refresh or invalidation succeeded.

An index-maintenance problem must not rewrite the truth of a verified REAPER
change, and a successful dispatch alone must not set a change to `applied`.

## Common Work

You can stay task-first:

```text
Give me a compact project map.
Find the last track named Backing Vox.
Set the project tempo to 126 BPM.
Create and arrange these tracks and folders.
Place these approved audio files on the selected tracks.
Show the peaks and timing facts for the selected items.
Sequence the selected items with a short gap.
Create this bounded MIDI clip, then quantize its existing notes.
Add ReaEQ and ReaComp to Lead Vox, reuse an exact ReaEQ if present, then verify the chain.
Insert these automation points and read them back.
Render these explicit items as OGG files.
```

OpenReaper should summarize first and expand only the details needed for the
task. You should not need to construct refs or choose between a Macro, Template,
artifact, or SQLite query yourself.

## Remove Silence And Normalize

For selected audio Items, OpenReaper provides two packaged REAPER Actions:
`Remove Silence...` and `Repeat Remove Silence with Last Settings`. The first
collects settings; the second reuses the last accepted settings. An agent may
use the same shared batch core through `macro.items.apply` with
`mode=remove_silence`. Supported scopes are `all`, `leading`, `trailing`,
`edges`, and `internal`, with threshold, minimum silence, leading/trailing
padding, minimum kept audio, and fade settings.

OpenReaper analyzes the whole selection before changing anything, preserves
source files, Tracks, and timeline positions, and closes the batch in one Undo.
An all-silent Item is kept and reported. MIDI and unsupported Items fail closed.
The maximum is 64 exact selected audio Items; 65 or more must return zero-write.

For normalization, use `macro.items.apply` with `mode=normalize_level`. Metrics
are LUFS-I, RMS-I, peak, true peak, LUFS-M max, and LUFS-S max. OpenReaper uses
REAPER's native normalization calculation. This is source/item/take pre-FX
normalization, not post-FX output normalization. The same 64-Item maximum,
zero-write overflow rule, one native batch, one readback, and one Undo apply.

## Authorization And Safety

OpenReaper should not ask you to approve every small reversible step. A good
flow is one bounded approval followed by execution and concise checkpoints.

The agent must still stop for:

- destructive deletion;
- overwrite, save-as, or render consequences that need confirmation;
- hardware, device, input, or output routing;
- privacy-sensitive scans;
- paid or licensed downloads;
- an ambiguous irreversible action;
- a stale or unresolved write target.

Project-internal routing does not authorize hardware/device I/O. Media and
project-file paths must pass their accepted path and managed-root rules; this
guide does not promise arbitrary filesystem access. `macro.project.file` does
not make new/open/create-project operations supported.

## Result And Recovery

After work, the agent should tell you:

- what it attempted;
- which exact targets changed;
- what REAPER read back;
- whether index maintenance succeeded;
- what was not verified;
- how to retry, refresh, undo, or clean up.

A dry run must say that mutation was skipped and provide an exact executable
retry when appropriate. If readback differs from the request, the agent should
return a blocker or partial result, not a success claim.

## Workflows And Packs

Workflows are reusable OpenReaper processes assembled from reviewed actions.
Normal product language should stay "workflow" even when the internal portable
format is a recipe file. Before sharing, machine-specific paths, request IDs,
project refs, private notes, secrets, and non-portable assumptions must be
scrubbed.

Packs may add reviewed plugin controls, media-library help, or domain-specific
workflows. A pack should state its origin, dependencies, permissions, evidence,
aliases, and unsupported areas. Pack metadata or portability does not imply
that arbitrary extension execution, global alias execution, or every plugin is
supported.

## Common Blockers

| Blocker | Meaning | Recovery |
|---|---|---|
| REAPER not ready | The live bridge cannot be reached. | Start or reconnect, resolve any waiting REAPER window, run the bridge Action, and probe again. |
| Stale session | The bridge identity no longer matches the current run. | Reconnect before writing. |
| Wrong or ambiguous target | The request does not resolve to one accepted live target set. | Narrow the request, select the intended objects, or let the agent query and refresh. |
| Needs refresh | Index or cached facts may be stale or incomplete. | Refresh from REAPER before deciding or writing. |
| Missing plugin | The exact requested plugin is not installed or accepted. | Choose an installed supported plugin; do not silently substitute one. |
| Mode held | The Macro exists, but that exact mode is not accepted. | Use an accepted mode or an explicitly discovered direct-Template fallback with a typed reason. |
| Needs confirmation | The operation crosses a hard risk boundary. | Review the concrete consequence and approve only if intended. |

## Current Evidence Boundary

The candidate surface contains 15 visible executable Macros and six MCP tools.
Support remains narrower than the names of some Macro families:

- MIDI supports bounded `create_clips`, indexed existing-note edits,
  quantization, and PPQ CC insertion. It does not support arbitrary note
  creation in an existing Take, existing-CC edits, text/sysex, or implicit
  instrument insertion.
- FX-chain apply can search the installed inventory and manage bounded Track or
  Take chains with duplicate, preset, bypass, and reorder policies. Initial
  semantic controls and `macro.fx.set_controls` remain limited to reviewed
  mappings such as the accepted ReaComp mapping; arbitrary plugin semantics are
  not promised.
- Item analysis supports the published `quick`, `audio`, `timing`, and `full`
  profiles; compare, MIDI, and loop profiles remain held.
- Item apply supports alignment, sequencing, distribution, anchoring, moving
  exact Items onto existing Tracks, accepted Item properties, exact Active Take
  selection, fades, exact trims, Take playback, snap offsets, native level
  normalization, and shared-core silence removal. Item-level pan is not a
  proven field; explicit Active Take pan uses the accepted Take-control route.
- Automation supports the exact modes published by its manual; real-time
  touch/write/latch behavior, arbitrary curves, and raw Action/chunk mutation
  are not exposed.
- Render uses the managed render root and accepted WAV/OGG target modes. It
  does not promise arbitrary output paths, overwrite, external encoders, or
  every format.
- Project save/save-as is accepted; project new/open/create remains held.
- Hardware/device I/O remains outside the product boundary.

When a guide, agent, or pack claims support, the claim should match the exact
manual and current evidence rather than a planned future mode.

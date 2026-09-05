# OpenReaper User Guide

Status: OpenReaper 0.1.0 release documentation. Support remains evidence-bound.

OpenReaper lets you work with a live REAPER project by talking to an agent. You
do not need to understand Macros, Templates, SQLite, object refs, artifacts, or
bridge internals. Describe the result you want; the agent chooses a supported
route, performs the work, and verifies the result in REAPER.

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

## Selecting More Than One Object

You can describe a scope instead of naming every object. For example:

```text
Reverse every Item on these two Tracks.
Glue the selected Track's Items inside the time selection.
Apply this Recipe to all Takes on the selected Track.
```

For a one-off operation, the agent passes a live `target_binding` directly to
the owning Macro. For a reusable workflow, a Recipe declares a `target_set`
with `resolve_at: run_start`; every stage then references its `target_set_id`.
Membership is frozen once and retained on resume, so the agent does not loop
over object names or silently reread selection between stages. Supported
run-start domains are Items, Tracks, Takes, selected/explicit Envelopes,
Automation Items, and ranged Points. A `time_range` is a constraint on those
objects, not a standalone object set. Selected Automation points remain a
typed unsupported case.

For Takes, “selected” has one precise meaning: the active Take of each selected
Item. REAPER does not expose a separate selected-Take state. To target a
non-active Take, use its explicit canonical Take ref or first make it active
through the owning Item operation.

When you ask “which objects match?”, the agent uses `macro.project.query` with
the same binding and returns canonical refs. It should only query first when
you asked for the inventory or when the operation genuinely needs analysis;
otherwise one set-bearing call is the normal path.

If Reverse reports `PROJECT_LOCKING_ENABLED`, OpenReaper preserved your
selection and made no changes. Disable REAPER Locking and run the same Reverse
request again; OpenReaper will not change this global option automatically.

### Live Target Binding Coverage

The current bounded acceptance is explicit:

- `[DONE]` Glue and Reverse over selected or explicitly constrained Items.
- `[DONE]` Freeze/Unfreeze over selected Tracks.
- `[DONE]` Render/Stem over selected or explicit Tracks and ranges.
- `[DONE]` Query of complete constrained Item inventories with stable live
  fingerprints.
- `[DONE]` Recipe target sets for Items, Tracks, Takes, selected/explicit
  Envelopes, Automation Items, and ranged Automation points.
- `[DONE]` Selected-Take binding resolves only active Takes of selected Items;
  it never treats every Take on those Items as selected.
- `[DONE]` One representative inspection plus one shared-plan broadcast for a
  homogeneous active-Take FX set; 1-64 FX targets are supported and 65 fails
  before mutation.
- `[DONE]` Agent guidance that sends one set-bearing owning call and avoids
  per-object loops or a preliminary selection dump.
- `[BLOCKED]` Selected Automation points: native stock selection truth is not
  proven, so OpenReaper returns `AUTOMATION_POINT_SELECTION_UNPROVEN` with
  zero-write behavior.
- `[TODO]` Analysis-to-mutation `target_snapshot_ref` and a direct
  Region-from-time-selection canary are design follow-ups, not current public
  capabilities.
- `[TODO]` Windows ReaEQ evidence and the conditional Pro-Q 3 probe require
  their respective environments; macOS stock ReaEQ is the accepted kernel.

These `[BLOCKED]` and `[TODO]` rows are deliberate safety boundaries, not
silent fallbacks. The agent must report the typed blocker or the missing
capability instead of guessing refs, changing selection, or claiming a write.

## Third-Party FX Parameters

For host-exposed FX parameters, you can use the values shown by the plugin:

```text
Set this EQ frequency to 3000 Hz and gain to -3 dB.
Set the selected mode to Bell.
```

The agent reads the FX parameter inventory once, uses stable parameter identity,
and sends `display_value` text. OpenReaper asks REAPER to compile that text to
the plugin's normalized coordinate, completes all preflight before writing, and
verifies native formatted readback. It does not keep a central plugin-profile
database, and it does not use plugin-specific guesses. Raw `normalized_value`
input remains available for compatibility and debugging.

An agent Skill may remember `plugin_id`, the layout fingerprint, and what stable
`param_ident` values mean. A changed plugin or layout requires a fresh read, and
OpenReaper still validates the exact live instance every time. This works for
Track FX, Take FX, mixed exact assignment batches, and homogeneous FX sets when
REAPER exposes the control as a host parameter. Controls that exist only inside
a plugin's custom UI are outside this guarantee.

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
| `macro.render.targets` | Render supported project, selection, region, Item, or Track targets as managed-root WAV/OGG/MP3/MP4/MOV output. |

Each Macro has a bounded schema. "Executable" does not mean that every imagined
mode is accepted. The exact Macro manual is the authority for supported fields,
limits, risk, confirmation, readback, and held modes.

## Exporting Video

On macOS, `macro.render.targets` can export `.mp4` or `.mov` through REAPER's
audited AVFoundation route. You can ask for a whole-project, time-selection,
Region, Item, or Track render in ordinary language, for example:

```text
Export the time selection as a 1920x1080, 30 fps MP4 at 8000 kbps.
Render this Region as a 1280x720, 24 fps MOV with 192 kbps audio.
```

The adjustable video fields are:

- `video_width`: even integer from 16 through 7680; default 1920.
- `video_height`: even integer from 16 through 4320; default 1080.
- `video_frame_rate`: 24, 25, 30, 50, or 60; default 30.
- `video_bitrate_kbps`: integer from 256 through 100000; default 8000.
- `audio_bitrate_kbps`: 64, 96, 128, 192, 256, or 320; default 192.

The accepted codecs are fixed to H.264 video and AAC audio. Video always uses
the managed render root and returns `video_outputs`; it cannot use an arbitrary
output path or `destination=new_project_track`. Give `output_basename` without
an extension. OpenReaper verifies the MP4/MOV container, video and audio tracks,
dimensions, frame rate, codecs, and restored REAPER render/selection state
before reporting completion.

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

1. Run `~/.openreaper/current/bin/openreaper-start`. If one REAPER is already
   open from the normal icon, the helper attaches to it; otherwise it starts a
   new instance. It never starts a duplicate.
2. Wait for the Bridge heartbeat and public read probe to pass.
3. If the helper reports `STARTUP_USER_ACTION_REQUIRED`, ask the user to resolve
   the visible REAPER window; never click or close it automatically.
4. Rerun `openreaper-start --recover-existing` so the same REAPER PID and Bridge
   generation are reused instead of starting a duplicate instance.
5. Reconnect the MCP server named `openreaper` if its prior session was stale.

On Windows, the equivalent native PowerShell command is:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenReaper\current\bin\openreaper-start.ps1"
```

Windows normal operation does not require Git Bash, Git, WSL, SSH, SWS,
ReaPack, or third-party plugins. Node.js 20 or newer is required.

During normal agent-assisted startup, the PowerShell launcher, Doctor, and MCP
hosts run without a visible console window; REAPER itself remains visible. A
PowerShell window opened for a manual command is the operator's terminal, not
OpenReaper product UI. Acceptance and automation launchers must hide that host
instead of hiding REAPER.

OpenReaper never clicks or closes REAPER startup windows on macOS or Windows.
It observes them read-only. A blocking window returns
`STARTUP_USER_ACTION_REQUIRED` while preserving the exact REAPER PID and Bridge
generation. Resolve the visible window, then rerun
`openreaper-start --recover-existing`; do not start a duplicate REAPER. The
fixed package-local launcher starts the Bridge automatically; the
`OpenReaper: Start MCP bridge` Action is recovery-only. SWS is not required.
The normal REAPER main window and the `Scripts on`/ReaScript status window are
non-blocking and should not be treated as a modal obstruction. The installed
startup block is additive and does not modify shortcuts, mouse modifiers,
ReaTooled state, or keymaps.

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

For selected audio Items, OpenReaper provides one packaged REAPER Action:
`Remove Silence...`. It collects settings and stores the last accepted values
for the next invocation. An agent may use the same shared batch core through `macro.items.apply` with
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

## Recipes And Saved Routines

User-facing language may call a Recipe a routine: it is a small saved,
declarative batch program. The title and summary explain what a saved Routine is;
its dependencies name accepted Macros, and its stages describe the fixed work.
The Agent chooses and binds the plan before execution, then reports aggregate
REAPER readback. It does not run a stage or target in a chat loop.

Use a Macro when one existing Macro covers the complete bounded task. Use a
Recipe when the same fixed plan should run over many exact targets, has ordered
stages, or should be saved and reused after reconnect. Use a Skill when the work
needs judgment, teaching, or adaptation.

For a quick one-off, say: "Create a temporary Recipe for the current exact
selected audio Items: apply one fixed dialogue cleanup plan to all targets in
one batch." The Agent copies the exact dependency manual, replaces every
placeholder, then runs `validate`, `save`, and `run` once. The batch handles all
63 Items in one call; it must not make 63 calls. `save` puts an immutable
user-owned revision in the configured Recipe store, where `list_recipes` can
find it after reconnect. Keep the exact revision to reuse it, or delete only
that revision after terminal evidence is retained. Counts 1 through 64 are
valid for a 64-target Macro; 65 must fail before mutation with zero-write truth.

Within a phase, `for_each` means one compiled batch over a target group and
`once` means one shared operation. Later phases wait only for verified results
they actually depend on. The user sees the completed batch after one final
refresh, rather than partial objects appearing one by one. The current 0.1.0
public temporary path is the saved `validate -> save -> run` ABI; an agent must
not invent `run_transient` until the exact Recipe manual exposes it.

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

The `0.1.0` surface contains 15 visible executable Macros and six MCP tools.
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
- Render uses the managed render root and accepted WAV/OGG/MP3 target modes,
  plus the macOS AVFoundation MP4/MOV route described above. It does not
  promise arbitrary output paths, external encoder arguments, unreviewed
  codecs, or every format.
- Project files support save/save-as, listing open projects, explicit creation
  of a new saved tab with an absolute `.RPP` path and `overwrite=true`, opening
  an existing absolute `.RPP` path in a tab, and activating one exact saved
  project reference. Arbitrary filesystem access and implicit project switching
  remain outside this boundary.
- Hardware/device I/O remains outside the product boundary.

When a guide, agent, or pack claims support, the claim should match the exact
manual and current evidence rather than a planned future mode.

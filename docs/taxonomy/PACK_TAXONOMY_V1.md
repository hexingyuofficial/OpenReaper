# Pack Taxonomy v1

Status: frozen by the Layer 3 Pack Taxonomy v1 gate.

Packs are fixed REAPER capability dependency domains. They are not workflow
products, not recipe families, and not loader entry points for migrated legacy
content. Layer 3 does not migrate real pack content, templates, or recipes.

## Fixed Top-Level Packs

```text
core
project
transport
tracks
items
media
analysis
midi
fx
routing
automation
render
actions
ui
system
hardware_control
```

First Real Version rule:

- No new top-level pack outside this list.
- A new top-level pack requires a future taxonomy amendment.
- Future template metadata `pack` values MUST be one of these 16 pack ids.
- A template's `pack` is its primary validation and ownership domain. It is
  not a workflow name and not the template's full dependency list.

## Primary Owner Rule

The `pack` field on a template names the primary owner domain that validates
the capability, risk posture, metadata, refs, and expected object surface. It
does not list every REAPER object touched by the implementation.

Layer 3 does not freeze the full recipe metadata contract. Layer 5 owns that
future recipe contract. Layer 3 only forbids workflow-shaped pack ids and
workflow-shaped template/recipe `pack` metadata.

Pack ownership follows the main REAPER object being queried or modified. If a
template needs supporting reads from another domain, those reads remain
dependencies of the template, not extra pack identities.

Legacy workflow names such as `loop`, `cleanup`, `delivery`, `layer`, and
`music_sketch` MUST NOT appear as pack ids or as template/recipe `pack`
metadata. They may appear only as recipe families, tags, or migration aliases.

## Cross-Domain Tie-Breaker

When a capability appears to cross domains, choose exactly one primary owner:

- Prefer the pack for the main REAPER object being queried or modified.
- If the main effect is output, export, stem creation, render validation, or a
  render job, prefer `render`.
- If the main effect is hardware, control-surface, OSC, joystick, MIDI device
  access, MIDI learn, or hardware MIDI send/control, prefer
  `hardware_control`.
- If the primary owner is hardware or device control, prefer
  `hardware_control`.
- If hardware/control is the owner, prefer `hardware_control`.
- If the capability is a generic guarded REAPER action, custom action, action
  lookup, action metadata, or marker/custom action execution, prefer `actions`.
- If a typed domain wrapper already exists or is being authored, do not place
  it in `actions` merely because the implementation may call a REAPER action.
- If a typed domain wrapper exists, do not place it in `actions`.

## Catch-All Guardrails

`core` MUST NOT become a functional junk drawer. It owns shared contracts and
kernel-adjacent state only.

`actions` MUST NOT become a junk drawer for every command. It owns generic
guarded actions and action metadata only when no typed domain wrapper owns the
capability.

`system` MUST NOT become a junk drawer for environment-like or miscellaneous
work. It owns global paths, process facts, persistent state surfaces, and API
introspection only when no project, media, hardware, or UI object is primary.

`ui` MUST NOT become an automatic GUI-clicking backdoor. It owns bounded UI
helpers, UI state, themes, menus, dialogs, windows, and docks, not arbitrary
interaction automation that bypasses typed templates.

## Canonical Metadata Value Rules

Lifecycle values:

```text
draft
experimental
stable
deprecated
```

Risk values:

```text
read
safe
write
destructive
```

`read` is bounded state or artifact inspection. `safe` is a narrow reversible
operation. `write` mutates project, media, output, UI, system, or hardware
state under the foundation undo/verification contract. `destructive` may
overwrite, delete, externally affect devices, or perform irreversible output
work and must receive explicit policy treatment from later layers.

`entity_kind` values use lower snake-case or dotted lower snake-case:

```text
^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$
```

Tags use lower snake-case:

```text
^[a-z][a-z0-9_]*$
```

Workflow-shaped names may be tags only when they describe recipe family,
migration source, or user intent. They do not grant pack identity.

## Allowed Bridge Operation Families

Packs do not add bridge operation families. Every pack below may use only the
Layer 2 Foundation / Bridge ABI v1 families:

```text
query_state
run_command
run_action
run_job
artifact_metadata
```

## Pack Responsibilities

### `core`

Owner domain: shared OpenReaper foundation metadata, health, ids, refs, compact
state, and registry helpers.

Belongs here: bridge health summaries, bounded `last_result` reads, shared id
or ref utilities, version/capability declarations, and kernel-adjacent
metadata that is not a REAPER editing feature.

Does not belong here: project editing, object manipulation, pack-specific
helpers, migrated workflow glue, or anything assigned here because no one has
made a domain decision.

Typical entity_kind: `core_state`, `bridge_health`, `last_result`.

Default risk posture: `read`.

Allowed bridge operation families: `query_state`, `artifact_metadata`.

Ambiguous examples / placement notes: a template registry query is `core`; a
track count query is `tracks`; a generic "do the workflow" command is not a
pack capability.

### `project`

Owner domain: REAPER project-level structure and timeline metadata.

Belongs here: project tabs, project metadata, tempo/time map, time signatures,
warp grid, ordinary markers and regions, grid/snap/groove when project-level,
and SWS marker action text editing as marker metadata.

Does not belong here: executing marker actions or custom actions, media source
import, render matrix output, item/take editing, or MIDI-note grid operations.

Typical entity_kind: `project`, `project_tab`, `tempo_map`, `time_signature`,
`marker`, `region`, `grid`.

Default risk posture: `read` for inspection, `write` for timeline metadata.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: tempo/time map and SWS warp grid belong
to `project`; resolving or executing marker/custom actions belongs to
`actions`; ordinary markers and regions remain `project`.

### `transport`

Owner domain: playback, recording, cursor, loop/repeat, and time selection.

Belongs here: play, stop, pause, record, seek, edit cursor, play cursor,
repeat/loop toggle, and time selection state.

Does not belong here: loop recipe families, item loop-source editing, region
rendering, or transport-triggered action metadata.

Typical entity_kind: `transport`, `cursor`, `time_selection`, `loop_state`.

Default risk posture: `safe` for playback/cursor, `write` for record state.

Allowed bridge operation families: `query_state`, `run_command`.

Ambiguous examples / placement notes: "loop" is a recipe family or tag, not a
pack id; a render loop selection is `render`, and an item loop-source edit is
`items`.

### `tracks`

Owner domain: tracks and track-level organization.

Belongs here: track create/delete/name/color, folders, mute, solo, arm,
selection, track lanes when track-owned, grouping/VCA when track or VCA based,
and track state snapshots when represented as typed track state.

Does not belong here: item grouping, send grouping, envelope grouping, FX
parameters, routing pins, or hardware device control.

Typical entity_kind: `track`, `track_folder`, `track_selection`,
`track_group`, `vca_group`.

Default risk posture: `read` for inspection, `write` for edits,
`destructive` for deletion.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: VCA grouping is `tracks`; send grouping
is `routing`; envelope grouping is `automation`; item grouping is `items`.

### `items`

Owner domain: media items, takes, lanes, comping, and item-local editing.

Belongs here: move, trim, split, fades, nudge, stretch markers, take selection,
takes/comping/lanes, spectral edits on takes, item grouping, razor edit item
operations, and trimming a video item already represented as an item.

Does not belong here: media source metadata/import before item ownership,
MIDI notes/CC inside a MIDI take, render jobs for razor edit areas, or envelope
razor edit operations.

Typical entity_kind: `item`, `take`, `item_lane`, `comp`, `spectral_edit`,
`stretch_marker`.

Default risk posture: `write`, with `destructive` for deletes or destructive
source replacement.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: import/trim video depends on primary
object: importing or inspecting a media source is `media`, while trimming the
resulting video item is `items`.

### `media`

Owner domain: media sources, files, project media pools, and media resource
discovery.

Belongs here: media source inspection, import, relink, source metadata, peaks
as media/source data, Project Bay contents, Media Explorer results, and SWS
resources when the resource is media/project-template/FX-chain content rather
than a global path.

Does not belong here: placed item edits, render output files, loudness
measurement artifacts, global resource paths, or system environment discovery.

Typical entity_kind: `media_source`, `media_file`, `media_resource`,
`project_bay`, `media_explorer`.

Default risk posture: `read` for inspection, `write` for import/relink,
`destructive` for source deletion or overwrite.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: Project Bay, Media Explorer, and SWS
Resources generally belong to `media`; `system` owns only global paths,
installation facts, and environment locations.

### `analysis`

Owner domain: bounded analysis, measurements, and analysis artifacts.

Belongs here: loudness, peak, RMS, LUFS, transient, silence, loop-candidate,
click-risk, waveform, and diagnostic measurement jobs or artifacts.

Does not belong here: applying loudness normalization to an export, changing
render settings, editing source media, or placing analysis results onto the
timeline.

Typical entity_kind: `analysis_artifact`, `loudness`, `peak`, `rms`, `lufs`,
`transient`.

Default risk posture: `read`.

Allowed bridge operation families: `query_state`, `run_job`,
`artifact_metadata`.

Ambiguous examples / placement notes: measuring loudness/peak/RMS/LUFS is
`analysis`; applying loudness normalization as part of output/export is
`render`.

### `midi`

Owner domain: MIDI event data and musical notation data.

Belongs here: MIDI items as event containers, notes, CC, sysex/text events,
event lists, PPQ conversion, notation, MusicXML, MIDI editor grid/groove when
the primary object is MIDI event data, and note-name metadata.

Does not belong here: hardware MIDI devices, MIDI learn/control, control
surface messages, item container moves/trims, or track routing.

Typical entity_kind: `midi_item`, `midi_note`, `midi_cc`, `midi_event`,
`notation`, `musicxml`.

Default risk posture: `read` for inspection, `write` for event edits,
`destructive` for event deletion or wholesale replacement.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: MIDI notes/CC/event list/notation are
`midi`; hardware MIDI send and MIDI learn are `hardware_control`.

### `fx`

Owner domain: REAPER FX, plugins, take FX, track FX, parameters, presets, and
video processor code.

Belongs here: plugin add/delete/bypass, FX chain order, parameter set/read,
presets, take FX, track FX, and video processor `VIDEO_CODE`.

Does not belong here: render video output, media source import, MIDI notes, or
generic action execution when no typed FX wrapper exists.

Typical entity_kind: `fx`, `fx_chain`, `fx_param`, `plugin`, `preset`,
`video_processor`.

Default risk posture: `read` for inspection, `write` for parameter/chain
edits, `destructive` for plugin removal or code replacement.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: video processor `VIDEO_CODE` belongs to
`fx`; rendering a video file belongs to `render`.

### `routing`

Owner domain: signal routing between tracks, channels, pins, sends, receives,
and hardware outputs as routing endpoints.

Belongs here: sends, receives, channel counts, pin mappings, sidechains,
hardware output routing, and send grouping.

Does not belong here: control-surface hardware, OSC, MIDI learn/device
control, track grouping, item grouping, or envelope grouping.

Typical entity_kind: `send`, `receive`, `channel`, `pin_mapping`,
`hardware_output`.

Default risk posture: `read` for inspection, `write` for routing edits,
`destructive` for route deletion.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: send grouping is `routing`; hardware
MIDI send/control is `hardware_control`.

### `automation`

Owner domain: envelopes, automation items, points, modes, and automation-local
editing.

Belongs here: envelope read/write, point insert/delete, automation items,
automation modes, envelope grouping, and razor edit automation operations.

Does not belong here: item razor edit operations, track grouping, render of
razor edit areas, or FX parameter metadata without envelope ownership.

Typical entity_kind: `envelope`, `automation_item`, `automation_point`,
`automation_mode`.

Default risk posture: `read` for inspection, `write` for point/mode edits,
`destructive` for point or automation item deletion.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: razor edit item operations are `items`;
razor edit automation operations are `automation`; render razor edit areas is
`render`.

### `render`

Owner domain: output, export, render settings, render matrices, render jobs,
and output validation.

Belongs here: render settings, render queue/job state, render matrix, region
render matrix, stems, output file metadata, render validation, render video,
render razor edit areas, and loudness normalization/export application when
tied to output.

Does not belong here: loudness measurement alone, media source import, project
markers as timeline metadata, or generic file-system paths.

Typical entity_kind: `render_job`, `render_setting`, `render_region`,
`render_matrix`, `output_file`.

Default risk posture: `write`, with `destructive` for overwrite/delete output
work.

Allowed bridge operation families: `query_state`, `run_command`, `run_job`,
`artifact_metadata`.

Ambiguous examples / placement notes: region render matrix and render video
belong to `render`; loudness analysis alone is `analysis`.

### `actions`

Owner domain: guarded REAPER action execution and action metadata when no typed
domain wrapper owns the capability.

Belongs here: generic action lookup, command id resolution, guarded action
execution, custom action metadata, cycle-action metadata/execution when treated
as an action, and resolving/executing marker/custom actions.

Does not belong here: typed track/item/project/render/MIDI/etc. operations
merely because a REAPER action could implement them.

Typical entity_kind: `action`, `custom_action`, `marker_action`,
`cycle_action`, `command_id`.

Default risk posture: `read` for metadata, `write` or `destructive` according
to the guarded action policy.

Allowed bridge operation families: `query_state`, `run_action`,
`artifact_metadata`.

Ambiguous examples / placement notes: SWS marker action text editing is
`project`; resolving or executing marker/custom actions is `actions`.
SWS cycle actions do not create an SWS pack.

### `ui`

Owner domain: bounded REAPER UI state and UI-facing helpers.

Belongs here: GFX, docks, windows, theme state, menus, dialogs, UI refresh,
and bounded UI helpers that expose stable state.

Does not belong here: arbitrary GUI clicking, hidden workflow execution,
Project Bay/Media Explorer content ownership, or typed object edits.

Typical entity_kind: `ui_window`, `dock`, `theme`, `menu`, `dialog`.

Default risk posture: `safe` for display helpers, `write` for UI state edits.

Allowed bridge operation families: `query_state`, `run_command`.

Ambiguous examples / placement notes: a Media Explorer window placement is
`ui`; the media found inside Media Explorer is `media`.

### `system`

Owner domain: global environment, persistent state surfaces, files, paths, API
introspection, and process/runtime facts.

Belongs here: ExtState/ProjExtState helpers, global resource paths, install
paths, file/path operations, API symbol introspection, OS/process facts, and
runtime capability facts not owned by a typed REAPER object.

Does not belong here: media resources as library content, project metadata,
hardware/control-surface behavior, UI automation, or miscellaneous work with no
domain decision.

Typical entity_kind: `system_state`, `resource_path`, `ext_state`, `file`,
`api_symbol`, `process`.

Default risk posture: `read` for inspection, `write` for persistent state or
file changes, `destructive` for delete/overwrite.

Allowed bridge operation families: `query_state`, `run_command`,
`artifact_metadata`.

Ambiguous examples / placement notes: global paths/environment are `system`;
Project Bay, Media Explorer, and media-bearing resources are `media`.

### `hardware_control`

Owner domain: hardware integration, devices, control surfaces, OSC, joystick,
MIDI device control, and hardware MIDI send/control.

Belongs here: audio/MIDI device facts, control surfaces, OSC devices and
patterns, joystick integration, MIDI learn, hardware MIDI sends, direct MIDI
device access, and SWS Live Configs when the primary behavior is live hardware
or device control.

Does not belong here: routing to hardware outputs as audio routing endpoints,
MIDI notes in project items, track mute/solo as typed track edits, or generic
action metadata.

Typical entity_kind: `device`, `control_surface`, `osc`, `midi_device`,
`midi_learn`, `joystick`.

Default risk posture: `read` for device facts, `write` for control changes,
`destructive` for external side effects or persistent device configuration.

Allowed bridge operation families: `query_state`, `run_command`, `run_job`,
`artifact_metadata`.

Ambiguous examples / placement notes: OSC/control surface/MIDI learn/hardware
MIDI send belongs to `hardware_control`; typed track edits triggered by a
surface still belong to the typed owner when exposed as a template.

## Legacy Workflow Names

These names are reserved as workflow-shaped identifiers, not pack ids:

```text
loop
cleanup
delivery
layer
music_sketch
```

They may be recipe family names, tags, or migration aliases. They MUST NOT be
created under `reaper/packs/*`, added to the bridge pack id list, or used as
template/recipe `pack` metadata.

## Difficult Placement Decision Table

```text
video processor VIDEO_CODE -> fx
import video source -> media
trim video item -> items
render video -> render
region render matrix -> render
spectral edits on take -> items
notation -> midi
MusicXML -> midi
tempo/time map -> project
warp grid -> project
ordinary markers/regions -> project
SWS marker action text editing -> project
resolving/executing marker/custom action -> actions
Project Bay -> media
Media Explorer -> media
SWS resources with media/project-template/FX-chain content -> media
global resource paths/environment -> system
snap/grid/groove for project timeline -> project
snap/grid/groove for MIDI event data -> midi
SWS warp grid -> project
track/VCA grouping -> tracks
item grouping -> items
send grouping -> routing
envelope grouping -> automation
takes/comping/lanes -> items
razor edit item operations -> items
razor edit automation operations -> automation
render razor edit areas -> render
loudness/peak/RMS/LUFS measurement -> analysis
loudness normalization/export application -> render
SWS snapshots/resources/cycle actions/live configs/ReaConsole -> no SWS pack
OSC/control surface/MIDI learn/hardware MIDI send -> hardware_control
MIDI notes/CC/event list/notation -> midi
```

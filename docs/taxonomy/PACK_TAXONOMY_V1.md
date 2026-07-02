# Pack Taxonomy v1

Status: target taxonomy for Layer 3 freeze.

Packs are fixed REAPER capability dependencies. They are not workflow products.

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
- A new top-level pack requires a taxonomy amendment.
- Legacy workflow names such as `loop`, `cleanup`, `delivery`, `layer`, and
  `music_sketch` are recipe families or tags, not public top-level packs.

## Pack Responsibilities

### `core`

Shared foundation helpers and contracts. It should not become a product
capability catch-all.

### `project`

Project tabs, tempo/time signature, grid, markers, regions, and project
metadata.

### `transport`

Play, stop, pause, record, cursor, loop/repeat, and time selection.

### `tracks`

Track create/delete/name/color/folder/mute/solo/arm/selection.

### `items`

Media item and take edits: move, trim, split, fade, nudge, stretch markers,
and item/take-local operations.

### `media`

Media source, file metadata, import, peaks, and media path handling.

### `analysis`

Audio accessors, loudness, peaks, silence, transients, loop candidates, and
click-risk artifacts.

### `midi`

MIDI items, notes, CC, sysex, PPQ, and MIDI readback.

### `fx`

Track FX, take FX, plugin add/delete/bypass, parameters, and presets.

### `routing`

Sends, receives, hardware outputs, channels, and pin mappings.

### `automation`

Envelopes, automation items, points, and automation modes.

### `render`

Render settings, render matrix, stems, output files, and render validation.

### `actions`

Guarded REAPER action bridge and command/action metadata.

### `ui`

GFX, dock/windows, theme, menus, dialogs, and UI-facing helpers.

### `system`

ExtState/ProjExtState, resource paths, files, API introspection, OS/device
facts, and process helpers.

### `hardware_control`

Control surface, audio/MIDI devices, OSC, joystick, and hardware integration.

# Pack Taxonomy Review Notes

These notes are decision input only, not frozen taxonomy. The frozen Layer 3
taxonomy is `docs/taxonomy/PACK_TAXONOMY_V1.md`.

## External Sources Checked

Checked on 2026-07-02:

- Cockos REAPER ReaScript API help:
  <https://www.reaper.fm/sdk/reascript/reascripthelp.html>
- Cockos REAPER plugin API header:
  <https://www.reaper.fm/sdk/plugin/reaper_plugin_functions.h>
- Cockos REAPER OSC SDK:
  <https://www.reaper.fm/sdk/osc/osc.php>
- SWS/S&M Extension overview:
  <https://sws-extension.org/>

Signals used:

- REAPER exposes MIDI event, region render matrix, marker/region, tempo/time
  signature, CSurf, OSC, MIDI device, and render-related API surfaces.
- The plugin API header exposes `VIDEO_CODE` for video processor code, razor
  edit fields on tracks, loudness/normalization functions, and MIDI/control
  surface device functions.
- The SWS site groups snapshots, resources, cycle actions, marker actions,
  ReaConsole, and Live Configs as extension capabilities. Layer 3 treats SWS
  as a source of capabilities, not a pack id.

## Difficult REAPER/SWS Capability Placement

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

## Tie-Breaker Examples

- A custom action that trims a selected item remains an `actions` template only
  if it is exposed as generic guarded action execution. A typed trim wrapper is
  `items`.
- A marker containing SWS marker action text is `project` while editing the
  marker text, and `actions` when resolving or executing the referenced action.
- A render that consumes razor edit areas is `render`; editing the item or
  automation razor edit areas before rendering remains `items` or
  `automation`.
- Loudness measurement is `analysis`; applying a loudness normalization target
  as part of export is `render`.
- Project Bay and Media Explorer content are `media`; window placement for
  those panels is `ui`; global search/resource paths are `system`.

## Layer 3 Taxonomy Test Cases

- Exact 16 pack list equality.
- Duplicate, missing, extra, and workflow-shaped pack rejection.
- Bridge `FOUNDATION_BRIDGE_PACK_IDS` parity.
- `reaper/packs/*` directory parity.
- Required per-pack boundary section presence.
- Review-notes non-normative status.
- No claim that template, recipe, or pack content migration occurred.
- Difficult REAPER/SWS placement examples above.

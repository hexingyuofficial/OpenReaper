# Streetlight v0.1 MVP

## MVP Sentence

Streetlight v0.1 lets an MCP agent create and render game-audio variations in REAPER from a selected item or source WAV using safe, tested templates.

## Success Criteria

The MVP is done when a new user can:

1. install the REAPER bridge
2. start the MCP server
3. connect from Codex or Claude Code
4. select one item in REAPER or provide a WAV path
5. ask for "make 8 impact variations"
6. see new named items and regions in REAPER
7. receive rendered WAV files in an output folder
8. undo the changes in one or a few clear undo steps

No desktop UI is required.

## Primary Demo

Input:

- one selected REAPER media item
- requested variation count: 8
- output format: WAV
- output folder: user-provided path

Agent request:

```text
Make 8 punchy sci-fi impact variations from the selected sound and render them as WAV files.
```

Expected result:

- creates or reuses a track named `Streetlight - Impact Variations`
- duplicates the source item 8 times
- applies controlled pitch/rate/fade/reverse edits
- spaces the variations on the timeline
- names items clearly
- creates one region per variation
- renders WAV files
- returns a report with paths and parameters used

## Required User Flow

```text
User starts REAPER
User installs/runs streetlight_bridge.lua
User starts streetlight-mcp
User connects an MCP client
User selects a source item
Agent calls get_state
Agent calls list_templates
Agent calls list_recipes
Agent calls call_template repeatedly
Bridge executes operations
Agent reports final files and changes
```

## Required Templates

### `track_create`

Creates a track by name or returns an existing matching track when `reuse=true`.

Required params:

- `name`

Optional params:

- `reuse`
- `color`

### `track_rename`

Renames a track.

Required params:

- `track_id`
- `name`

### `media_import`

Imports a media file onto a track.

Required params:

- `path`
- `track_id`
- `position`

### `item_duplicate`

Duplicates an item to a target track and position.

Required params:

- `item_id`
- `track_id`
- `position`

### `item_move`

Moves an item to a track or position.

Required params:

- `item_id`

Optional params:

- `track_id`
- `position`

### `item_pitch`

Changes active take pitch in semitones.

Required params:

- `item_id`
- `semitones`

### `item_rate`

Changes active take playback rate.

Required params:

- `item_id`
- `rate`

### `item_fade`

Sets fade in/out durations.

Required params:

- `item_id`

Optional params:

- `fade_in`
- `fade_out`

### `item_trim`

Sets item start/end or length.

Required params:

- `item_id`

Optional params:

- `start_offset`
- `length`

### `region_create`

Creates a named region around an item or time range.

Required params:

- `name`

Optional params:

- `item_id`
- `start`
- `end`

### `render_region`

Renders one region or a list of regions.

Required params:

- `region_id`
- `output_dir`

Optional params:

- `format`
- `sample_rate`
- `channels`

## Required MCP Tools

### `ping`

Health check.

### `get_state`

Reads scoped project state. Default scope is `selection`.

### `list_templates`

Lists available templates and schemas.

### `list_recipes`

Lists available recipes with their parameters and steps. Without this, recipes are invisible to MCP clients.

### `call_template`

Runs a single validated template call.

## First Recipe: `impact_variations`

This is a recipe document, not necessarily a first-class tool.

Parameters:

- `source`: selected item or file path
- `count`: default `8`
- `output_dir`: required
- `style`: free text hint for the agent

Suggested variation strategy:

```text
var_01: pitch -5, rate 0.92, fade out 0.10
var_02: pitch -3, rate 0.96, fade out 0.08
var_03: pitch -1, rate 1.00, fade out 0.06
var_04: pitch +2, rate 1.04, fade out 0.06
var_05: pitch +4, rate 1.08, fade out 0.05
var_06: pitch -8, rate 0.85, fade in 0.04, fade out 0.14
var_07: pitch +7, rate 1.12, fade out 0.04
var_08: pitch -2, rate 1.15, trim length 0.5, fade out 0.04
```

This is intentionally simple. The first version should prove control and rendering, not replace a human sound designer.

## Acceptance Tests

### Connection

- `ping` succeeds when REAPER bridge is running.
- `ping` returns a clear error when bridge is not running.

### State

- `get_state({ "scope": "selection" })` returns selected item names, positions, lengths, track names, and item IDs.
- Empty selection returns `ok: true` plus an empty selection, not a crash.

### Editing

- Each required template handles missing item references with a structured error.
- Each mutating template creates an undo point.
- Item pitch and rate modify the active take, not a nonexistent item property.

### Rendering

- `render_region` writes at least one WAV file to the requested folder.
- The result includes output file paths.
- Invalid output folders return a clear recoverable error.

### End-To-End

- From one selected item, the demo recipe creates 8 named variations and 8 rendered WAV files.
- The final report lists item names, region names, output paths, and parameters.

## Nice-To-Have But Not Required

- action search
- SWS/ReaPack detection
- socket transport
- waveform thumbnails
- semantic audio search
- desktop UI
- Wwise export

## Release Bar

v0.1 should be considered releasable when:

- the demo works on macOS and Windows
- install steps are documented
- every included template has one example call
- unsafe eval is disabled by default
- failures are understandable to both humans and agents

The ideal first release is narrow enough that contributors can understand it in one sitting.

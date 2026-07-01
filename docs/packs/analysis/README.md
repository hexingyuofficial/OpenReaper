# Analysis Pack

The `analysis` pack is opt-in:

```sh
STREETLIGHT_ENABLED_PACKS=core,analysis
```

It gives agents bounded facts about audio already inside the REAPER
project. The pack currently ships one template, `item_audio_analyze`,
which writes one JSON artifact:

```text
artifact:analysis:analysis:<id>
```

Read details through:

```json
{ "scope": "artifact", "artifact_ref": "...", "view": "summary" }
{ "scope": "artifact", "artifact_ref": "...", "view": "payload" }
```

## Template

`item_audio_analyze`

- params:
  `{ item_id, features?, time_range? }`
- default features:
  `["loudness", "peaks", "silence"]`
- opt-in features:
  `["transients", "loop_candidates"]`
- schema:
  `openreaper.analysis.item_audio.v1`
- maximum analysis range:
  `120` item-local seconds
- maximum silence segments:
  `200`
- maximum transient events:
  `200`
- maximum loop candidates:
  `5`

## Important Definitions

- `loudness` is RMS dBFS, not LUFS.
- `peaks` are sample peaks, not true peaks.
- `silence` uses a simple amplitude threshold and is not a musical
  phrase detector.
- `transients` are heuristic onset candidates. They are useful as
  machine-readable attack-point hints, but they are not loop candidates,
  click-risk metrics, beat grids, or musical phrase boundaries.
- `loop_candidates` are heuristic intervals based on transient pairs,
  duration bounds, peak continuity, and light silence hints. They do not
  guarantee a seamless loop and are not click-risk metrics.
- Analysis uses REAPER PCM accessors and reads pre-FX item/take audio.

## Explicitly Deferred

No click-risk metrics, external sample search, embeddings, AI
generation, OpenAudio integration, MIDI, FX, routing, or scene/recipe
execution lives in this pack yet.

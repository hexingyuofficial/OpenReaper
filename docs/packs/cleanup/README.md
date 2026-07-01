# Cleanup Pack

`cleanup` is the first real non-core domain pack. Slice 22 ships only one
read-only template:

- `cleanup_plan`

It inspects project, track, and region state, writes a bounded JSON plan
artifact, and returns one ref shaped:

```text
artifact:cleanup:plan:<id>
```

Enable it explicitly:

```sh
STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,cleanup npm run check:template-authoring
```

For a live REAPER smoke:

```lua
_G.STREETLIGHT_ENABLED_PACKS = "core,cleanup"
```

`cleanup_plan` is intentionally plan-first:

- It does not mutate the REAPER project.
- It does not apply suggestions.
- It does not delete tracks, regions, files, or media.
- It does not inspect audio content.
- It does not repair routing or FX.
- It does not claim delivery closure.

Read the artifact with:

```json
{
  "scope": "artifact",
  "artifact_ref": "artifact:cleanup:plan:<id>",
  "view": "summary"
}
```

Use `view:"payload"` for the bounded suggestion list. The payload schema
is `openreaper.cleanup_plan.v1`.

Bounded means:

- `max_suggestions` caps returned suggestions.
- each suggestion includes only a small `targets` preview;
- `target_count` records the complete affected count;
- `targets_truncated:true` marks omitted preview targets;
- long titles/details/target names are truncated safely;
- `source.fingerprint` is a compact deterministic hash, not a full
  track/region snapshot.

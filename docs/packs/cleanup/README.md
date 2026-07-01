# Cleanup Pack

`cleanup` is the first real non-core domain pack. It currently ships one
template:

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
- It does not apply suggestions inside the template.
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

Slice 23A adds a narrow agent-step safe action contract inside the plan
payload. It does not add `cleanup_apply_safe`.

Executable v1 actions are allowlisted to `track_rename` only:

- only `duplicate_track_names` suggestions may become executable;
- tracks are sorted by index;
- the first duplicate track keeps the original name;
- later duplicate tracks get deterministic names by appending increasing
  numeric suffixes;
- generated names must not collide with existing names or earlier
  generated names;
- if a unique name cannot be found within the small collision limit, the
  suggestion stays `review_only`;
- region names, folder observations, state warnings, deletion, routing,
  FX, delivery, audio analysis, render, import, item edits, and track
  creation are not executable cleanup actions.

Agent execution is explicit:

1. read the plan payload;
2. rerun `cleanup_plan` and compare `source.fingerprint`;
3. before each step, verify `expected_before.id` and
   `expected_before.name` still match the current track state;
4. call `track_rename` one step at a time, with an idempotency key;
5. stop on the first mismatch or typed error.

No `PLAN_STALE` error code exists in Slice 23A. Stale-plan detection is an
agent-side guard until a future apply template exists.

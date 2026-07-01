# Slice 27 Architect Plan — Analysis Loop Candidates MVP

Status: implemented, static-green, and REAPER live-smoked.

## Goal

Extend the opt-in `analysis` pack with explicit
`features:["loop_candidates"]` support in `item_audio_analyze`.

This slice produces bounded, factual candidate intervals inside the
existing JSON artifact contract:

```text
artifact:analysis:analysis:<id>
```

It does not mutate REAPER, trim items, fade items, set take loop state,
render audio, create recipes, or claim a seamless-loop guarantee.

## Locked Decisions

- S27-D1: keep schema `openreaper.analysis.item_audio.v1`; add optional
  loop-candidate fields.
- S27-D2: `features:["loop_candidates"]` may internally compute
  transients, but it must not output `payload.transients` unless
  `transients` was also requested.
- S27-D3: no user-tunable loop candidate params in this slice.
- S27-D4: fixed caps: `MAX_LOOP_CANDIDATES=5`,
  `LOOP_MIN_DURATION_SECONDS=0.25`,
  `LOOP_MAX_DURATION_SECONDS=8.0`.
- S27-D5: transient indices in candidates are 0-based JSON indices.
- S27-D6: candidate fields stay item-local; no `project_start` /
  `project_end` in v1.

Additional user constraints:

- Candidate `score` is only a `0..1` heuristic score. It is not a
  click-risk metric or seamless-loop guarantee.
- `candidate.reason` must be a stable short string, not prose.
- Zero candidates is not an error; return an empty array plus warning.

## Contract

`features` accepts:

```json
["loudness", "peaks", "silence", "transients", "loop_candidates"]
```

Default remains:

```json
["loudness", "peaks", "silence"]
```

`payload.loop_candidates`:

```json
{
  "type": "transient_pair_loop_candidates",
  "algorithm_version": "loop_candidates_v1",
  "candidates": [
    {
      "start": 0.2,
      "end": 1.2,
      "duration": 1,
      "score": 0.83,
      "start_transient_index": 0,
      "end_transient_index": 3,
      "reason": "transient_pair_duration_peak_continuity",
      "warnings": []
    }
  ],
  "candidate_count": 1,
  "total_considered": 6,
  "truncated": false,
  "cap": 5,
  "transient_source": "internal_or_requested",
  "warnings": []
}
```

`summary` may add:

- `loop_candidate_count`
- `loop_candidate_total_considered`
- `loop_candidates_truncated`
- `best_loop_candidate_start`
- `best_loop_candidate_end`
- `best_loop_candidate_duration`
- `best_loop_candidate_score`

## Algorithm

- Reuse Slice 26 transient events.
- Enumerate transient pairs `(i, j)`.
- Filter by:
  - duration between `0.25s` and `8.0s`;
  - index gap at least `1`;
  - at most `4096` pairs considered.
- Score using lightweight, deterministic heuristics:
  - start/end peak continuity;
  - number of transients spanned;
  - silence boundary hints;
  - duration preference.
- Sort by score descending, then start ascending, then end ascending.
- Return the top 5.

## Non-Goals

- No trim.
- No fade.
- No take-loop setting.
- No render.
- No recipe or scene.
- No click-risk report.
- No MIDI.
- No external analyzer, OpenAudio, AI generation, or arbitrary Lua.
- No `get_state(scope:"analysis")`.
- No new MCP tool.
- No core capability.

## Static Gates

- `npm run build`
- `npm test`
- `npm run check:error-codes-fresh`
- default `npm run check:manifest`
- default `npm run check:template-authoring`
- `STREETLIGHT_ENABLED_PACKS=core,analysis npm run check:manifest`
- `STREETLIGHT_ENABLED_PACKS=core,analysis npm run check:template-authoring`
- all-pack manifest/template-authoring sweep including `analysis`
- `git diff --check`

## REAPER Live Smoke

Fully quit/reopen REAPER, then load:

```lua
_G.STREETLIGHT_ENABLED_PACKS = "core,analysis"
dofile("/Users/Zhuanz/Documents/streetlight-reaper-mcp/reaper/streetlight_bridge.lua")
```

Smoke:

1. `ping` connected.
2. `list_templates` returns 13 templates and exposes
   `item_audio_analyze`.
3. Generate a short rhythmic WAV fixture with 4-6 obvious hits.
4. Import/select the item.
5. Call `item_audio_analyze` with `features:["loop_candidates"]`.
6. Read artifact summary/payload.
7. Assert `computed_features:["loop_candidates"]`.
8. Assert `payload.loop_candidates.candidates` has 2-5 bounded
   candidates, or zero candidates plus warning on a deliberately sparse
   fixture.
9. Assert payload does not contain `transients`.
10. Call with `features:["transients","loop_candidates"]` and assert
    transient indices point into the emitted `transients.events` array.
11. Run default and all-feature regressions.
12. Re-run LAST_RESULT anchor preservation.
13. Negative: empty/no-active-take item returns `AUDIO_SOURCE_OFFLINE`.
14. `get_state(scope:"analysis")` remains invalid/unimplemented.
15. Queue ends clean.

## Live Smoke Evidence

Verified on REAPER `7.71/macOS-arm64` with bridge `core,analysis`.

- Smoke stamp: `s27-live-1782920437671`
- Evidence:
  `/var/folders/n5/dxh3rm291xq9js6hqjdhn1br0000gn/T/s27-live-1782920437671/evidence.json`
- Main loop-only ref:
  `artifact:analysis:analysis:art_20260701154039166_004_45c857`
- Combined transient+loop ref:
  `artifact:analysis:analysis:art_20260701154041003_007_c166ce`
- All-feature ref:
  `artifact:analysis:analysis:art_20260701154042231_009_2b1461`
- Track anchor:
  `guid:{1AFCDBC3-2096-2D46-850A-C3989868B7D1}`
- Analyzed item:
  `guid:{1F38D6DF-08E0-604E-92B4-9343B77B9233}`
- Loop-only payload had `computed_features:["loop_candidates"]`,
  `candidate_count:5`, `total_considered:15`, `truncated:false`, and
  no `payload.transients`.
- Best candidate: `start=0.19737`, `end=0.847528`,
  `duration=0.650158`, `score=0.839377`, indices `0→2`, reason
  `transient_pair_duration_peak_continuity`.
- Combined mode emitted both transients and loop candidates; candidate
  indices pointed into the emitted transient event array.
- Default analysis still omitted both `transients` and
  `loop_candidates`.
- Source-offline negative returned `AUDIO_SOURCE_OFFLINE`.
- Queue ended `pending=0`, `running=0`, `done=0`.

## Reviewer Focus

- Defaults must not include `transients` or `loop_candidates`.
- `features:["loop_candidates"]` must not leak `payload.transients`.
- Artifact arrays must not leak into `call_template`.
- Candidate count is bounded and preflight remains enforced.
- Scores and reasons are deterministic and clearly non-guarantees.
- No mutation, render, recipe, click-risk, OpenAudio, AI, or core
  parking.

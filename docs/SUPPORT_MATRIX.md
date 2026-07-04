# OpenReaper V1 Support Matrix

OpenReaper support is evidence-bound. A row is supported only when the setup,
fixture, tool path, evidence, and wording match reviewed records.

## Status Values

```text
supported
candidate
blocked_fixture
blocked_platform
blocked_plugin
blocked_live_evidence
unsupported_v1
not_v1
```

`supported` means reviewed evidence exists for the declared row. `candidate`
means the architecture may allow the row, but V1 support wording must not claim
it yet.

## Supported Rows

| Area | Status | Supported V1 Row | Evidence |
|---|---|---|---|
| MCP tool surface | supported | Exactly `ping`, `get_state`, `list_templates`, `list_recipes`, `call_template`. | Tool ABI v1. |
| Discovery | supported | Compact menu discovery with exact-id expansion for details. | Discovery/Menu Contract v1. |
| Template catalog | supported | 126 accepted runtime/recipe template ids. | Catalog and runtime checks. |
| Live bridge structure | supported | Manual, non-spawning file-transport bridge with 60 registered handler rows. | Bridge handler registry/split at `57540d4`. |
| Template live evidence | supported for reviewed rows only | Wave 0, Wave 1A read rows, Read-B, First-Real-Fixture-A A1/A2/A3, and Safe-Write-A rows. | Old live matrix. |
| Artifact readback | supported | Canonical artifact refs and bounded `get_state(scope:"artifact")` summary/payload reads. | Artifact State Store and R1 evidence. |
| Recipe-level live portability | supported for R1 only | `recipe.project.cleanup_fingerprint_report` on local macOS manual bridge. | `/Users/Shared/openreaper-portability-live/layer7-r1-portability-live-20260704-222001`. |

## Platform And REAPER Rows

| Row | Status | Notes |
|---|---|---|
| Local macOS manual bridge | supported for evidenced rows | Manual bridge evidence exists; Node must not spawn REAPER. |
| REAPER `7.71/macOS-arm64` manual bridge | supported for template rows with matching evidence | Recorded in manual bridge live evidence. |
| Other REAPER versions | candidate | Must be recorded and reviewed before support wording claims them. |
| Windows | candidate | Convenience scripts may exist, but V1 live support is not declared without reviewed evidence. |
| Linux | candidate | Not a V1 supported row without reviewed evidence. |
| Remote clone/new-machine portability | candidate | Future stronger evidence tier; not proven by current R1 local clean-source run. |

## Recipe Rows

| Recipe | Lifecycle | V1 Support | Notes |
|---|---|---|---|
| `recipe.project.cleanup_fingerprint_report` | draft | supported recipe-level live/local portability claim | Supported path uses `template.project.create_cleanup_report` plus artifact summary/payload readback. |
| `recipe.analysis.selected_item_cycle_quality_report` | draft | candidate | Fake-smoked only; needs a narrow transcript driver and live evidence before support claim. |
| `recipe.render.region_wav_render` | draft | candidate | Fake-smoked only; render/write risk needs managed render root and live evidence. |
| `recipe.render.region_delivery_report` | draft | candidate | Fake-smoked only; consumes render artifacts and needs paired/preseeded evidence. |
| `recipe.items.layer_report_from_evidence` | draft | candidate | Fixture-backed only; does not prove live role classification. |
| `recipe.midi.track_phrase_seed` | draft | candidate | Fake-smoked only; write-risk MIDI path needs disposable-project live evidence. |

## Unsupported Or Deferred In V1

| Area | Status | Reason |
|---|---|---|
| Public `call_recipe` tool | unsupported_v1 | V1 has five tools; agents execute recipes step by step. |
| User-defined templates | unsupported_v1 | V1 community extension starts at recipes. |
| Raw Lua execution | unsupported_v1 | Would bypass reviewed template safety. |
| Raw REAPER action execution as a bypass | unsupported_v1 | Actions require reviewed typed templates/policy. |
| Shell/process automation | unsupported_v1 | Outside V1 support and safety boundary. |
| Automatic REAPER launch | unsupported_v1 | V1 supported live path is manual and non-spawning. |
| Arbitrary plugins | unsupported_v1 | Plugin rows need exact fixture and evidence. |
| Broad UI automation | not_v1 | UI helpers require future bounded policy. |
| Hardware/control-surface automation | not_v1 | No V1 evidence row. |
| Destructive cleanup/apply/delete workflows | not_v1 | Cleanup report is read-only and not apply/delete authority. |
| Arbitrary projects or media | unsupported_v1 | Support is bound to declared fixtures and typed blockers. |
| All 126 templates live-tested | unsupported_v1 | 126 are accepted runtime/catalog ids; only reviewed rows have live evidence. |
| All six Layer 7 atoms live-supported | unsupported_v1 | Only R1 has recipe-level live/local portability evidence. |

## Typed Blocker Vocabulary

Unsupported setups should return or record typed blockers such as:

- `blocked_platform`
- `blocked_reaper_version`
- `blocked_bridge_not_running`
- `blocked_bridge_owner_mismatch`
- `blocked_bridge_generation_mismatch`
- `blocked_fixture_missing`
- `blocked_artifact_root`
- `blocked_render_collision`
- `blocked_plugin_unavailable`
- `blocked_live_evidence`
- `unsupported_v1`

Do not turn blocker rows into best-effort behavior during a support run.

## Support Wording

Use:

```text
OpenReaper V1 is an evidence-bound manual-bridge release. Supported recipes run
through reviewed templates and bounded artifact readback on declared supported
rows, with unsupported setup or fixture states reported as typed blockers.
```

Do not use:

```text
Works on any OS.
Supports any REAPER version.
Works with any project or media.
Any agent can safely operate REAPER.
Users can create templates or new automation powers.
OpenReaper automatically starts REAPER.
All recipes are live-supported.
Remote clone/new-machine portability is proven.
```

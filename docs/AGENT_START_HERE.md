# OpenReaper Agent Start Here

Status: Alpha3.4-B unique Agent startup source.

This document is the only long-form Agent entry for OpenReaper. Runtime MCP
initialization projects the marked compact section below. Do not invent a second
hand-written startup brief.

<!-- OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN -->
# OpenReaper Agent Start Here (compact)

Product: OpenReaper MCP. Server name: `openreaper`. Exactly five tools:
`ping`, `get_state`, `list_templates`, `list_recipes`, `call_template`.
No `call_recipe`, no sixth tool, no raw executor.

## First-round flow

Flow: `ping -> list_templates with the user's original words as query -> exact-id expansion -> call_template -> live readback`.

1. `ping` — confirm the server is loaded and read readiness/startup guidance.
2. `list_templates` with the user's original words as `query` (and a small `limit`, e.g. 25). Do not guess casing, field names, refs, or enums first.
3. Exact-id expansion: `list_templates` with `ids:[...]` and needed `fields` (for example `id`, `inputSchema`) to open the full Macro manual.
4. `call_template` with the exact Macro id and schema-valid `input`.
5. Live REAPER readback is truth. SQLite / Project Index is navigation only.

Macro-first: prefer one of the 15 Macros. Use a direct Template only after
recording one typed fallback reason
(`macro_missing_for_task`, `macro_task_out_of_scope`,
`macro_target_ambiguous_or_unavailable`, `macro_domain_not_accepted`,
`macro_budget_prefers_atomic_template`).

On `list_templates` with a non-empty `query`, read
`product_surface.agent_context_macro_guide.macro_recommendations` (1-3 rows).
Each row has lowercase `id`, ready `exact_expansion_call`, required target facts,
`preview_or_dry_run_mandatory`, and typed Template fallback posture. Do not echo
the full user text. Search phrases are metadata only, never executable aliases.

On exact-id expansion, read each item's `first_try_execution_guide` for accepted
modes, public fields, units/bounds, selector/ref requirements, paging/budget
recovery, and deterministic `next_calls`. If live identity is unresolved, the
guide marks the mutation non-executable and pairs an immediately executable
`macro.project.query` prerequisite. Never treat placeholder refs as executable.

On covered validation/replacement/budget/readiness errors, follow machine-readable
`error.next_call` or `error.request_patch` when present; keep existing failure codes.

FX parameters: prefer `macro.fx.set_controls`. Use `mode=exact_parameters` for
1-8 parameters on one FX, or `mode=exact_assignments` for 1-8 parameters across
one or more exact `fx_ref` targets. Obtain exact refs first, page parameters to
completion, then supply `param_index` or one unique returned name/ident (not
fuzzy guesses). `mode=semantic` is compatibility-only and fails closed with
`STOCK_SEMANTIC_UNIT_UNPROVEN` until native low/mid/high proof exists
(including ReaSynth/RS5k Attack). Direct parameter Templates are debug fallback.

## Flat 15 Macro menu

All Macros are peers. Expand manuals only by exact id.

- `macro.project.inspect` — compact project identity, path, dirty, markers, readiness
- `macro.project.query` — bounded SQLite query; obtain canonical refs before writes
- `macro.project.delete_targets` — delete tracks/items/fx by exact targets
- `macro.project.apply_layout` — create tracks/folders/markers/regions layout
- `macro.project.file` — save_current / save_as / list_open_projects / create_project_tab / open_project_in_tab / activate_project_tab
- `macro.routing.apply` — internal sends, master-parent, channel counts
- `macro.media.place_assets` — search/import/place media assets
- `macro.items.analyze` — loudness/transient/silence analysis
- `macro.items.apply` — align/move/sequence/properties/fades + set_item_take_controls batch
- `macro.midi.apply` — create_clips | edit_notes | quantize | write_cc
- `macro.fx.apply_chain` — add/configure bounded FX (legacy single-node or chain[])
- `macro.fx.set_controls` — semantic (proven only), exact_parameters, or multi-FX exact_assignments
- `macro.controls.set` — BPM, grid, track/item/take/transport/send controls
- `macro.automation.apply` — automation points/curves on exact live refs
- `macro.render.targets` — bounded render/export targets

## Paging, budget, and recovery

Public responses may truncate. Truncation is not internal knowledge loss.

- Continue with the returned `cursor` when present.
- Shrink `limit` / fields / include when a budget error is returned.
- Recover full payloads with `get_state` (`scope=artifact`, `artifact_ref`) when
  an artifact ref is returned.
- Retry once after readiness/budget repair; re-resolve refs after project generation changes.
- Live REAPER readback remains authority for writes; SQLite never authorizes a mutation.

## Safety boundary (do not bypass product)

Forbidden:

- Searching source code, install trees, HOME, media libraries, or disk to invent capability
- Raw Lua, raw REAPER Action IDs, shell/process, SQL strings, or UI product bypass
- Caller-owned `context` on `call_template` (server allocates context)
- Placeholder refs such as TRACK/TAKE/ITEM token templates as real targets
- Hardware/device I/O

Allowed small assists (not product bypass):

- Official `openreaper-start` for REAPER sessions that MCP can connect to
- REAPER action `OpenReaper: Start MCP bridge` after start
- Agent may try that bridge action; if UI is unavailable, ask the user for that one assist

Live refs for Automation and similar write flows: first call
`macro.project.query` (or inspect), then reuse returned canonical refs exactly.

## Schema-checked examples

```text
ping {}
list_templates {"query":"create a MIDI clip and add a compressor","limit":25}
list_templates {"ids":["macro.midi.apply"],"fields":["id","inputSchema"]}
call_template {"id":"macro.project.inspect","input":{"include":["project_path","dirty_state","markers_regions"],"fields_by_scope":{"markers_regions":["ref","name","position_seconds"]},"limit":25,"compact_response":true,"ref_policy":"canonical_only"}}
call_template {"id":"macro.midi.apply","input":{"mode":"create_clips","start_seconds":0,"duration_quarter_notes":4,"notes":[{"start_offset_quarter_notes":0,"end_offset_quarter_notes":1,"pitch":60,"velocity":96,"channel":0},{"start_offset_quarter_notes":1,"end_offset_quarter_notes":2,"pitch":62,"velocity":96,"channel":0},{"start_offset_quarter_notes":2,"end_offset_quarter_notes":3,"pitch":64,"velocity":96,"channel":0},{"start_offset_quarter_notes":3,"end_offset_quarter_notes":4,"pitch":65,"velocity":96,"channel":0}],"selector":{"name":"Instrument"},"dry_run":false}}
call_template {"id":"macro.items.apply","input":{"mode":"set_item_take_controls","dry_run":false,"changes":[{"id":"clipA","item_ref":"item:guid:{ITEM-GUID}","take_ref":"take:guid:{TAKE-GUID}","item":{"volume_db":-3,"fade_in_seconds":0.01,"fade_out_seconds":0.05},"take":{"pan":-0.2,"playrate":1,"preserve_pitch":true}}]}}
call_template {"id":"macro.fx.apply_chain","input":{"plugin":"reacomp","controls":{"threshold_db":-18,"ratio":3},"selector":{"name":"Lead Vocal"},"dry_run":false}}
call_template {"id":"macro.project.file","input":{"operation":"save_current"}}
call_template {"id":"macro.project.file","input":{"operation":"list_open_projects","cursor":"0","limit":25}}
call_template {"id":"macro.project.file","input":{"operation":"open_project_in_tab","target_path":"/projects/demo/demo.RPP"}}
```

Full Macro manuals stay behind exact-id `list_templates` expansion. Do not
require the agent to invent fields before expansion.
<!-- OPENREAPER_AGENT_START_HERE_COMPACT_END -->

## Maintaining this document

- Edit the compact marked section as the single source for MCP initialization.
- The runtime module `packages/mcp-server/src/openreaper-agent-start-here-v1.mjs`
  extracts only the BEGIN/END compact section; it must not keep a second brief.
- UTF-8 projection budget is 16384 bytes. Marker missing, duplicate, wrong
  order, or over-budget must fail closed (no silent truncation).
- Package builds copy this file to
  `vendor/openreaper-kernel/docs/AGENT_START_HERE.md` (and may mirror an
  identical copy at package root). Package README must point only to that
  unique user entry.

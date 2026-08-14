# OpenReaper Agent Start Here

Status: OpenReaper 0.1.0 release documentation, unique English runtime startup source.

This document is the only long-form Agent entry for OpenReaper. Runtime MCP
initialization projects the marked compact section below. Do not invent a second
hand-written startup brief.

<!-- OPENREAPER_AGENT_START_HERE_COMPACT_BEGIN -->
# OpenReaper Agent Start Here (compact)

Product: OpenReaper MCP. Server name: `openreaper`. Exactly six tools:
`ping`, `get_state`, `list_templates`, `list_recipes`, `call_template`,
`call_recipe`. No seventh tool, no raw executor.

## First-round flow

Flow: `ping -> search the user's original words -> prefer one Macro or official Recipe -> exact-id expansion -> one call_template or call_recipe run -> live readback`.
The Macro-first compatibility route remains `ping -> list_templates`; reusable
or multi-stage Recipe intent may search `list_recipes` in the same first round.

1. `ping` — confirm the server is loaded and read readiness/startup guidance.
2. Search `list_templates` and, for reusable/multi-stage intent, `list_recipes`
   with the user's original words as `query` (small `limit`, e.g. 25). Do not
   guess casing, field names, refs, enums, or Recipe identities first.
3. Exact-id expand the selected Macro through `list_templates`, or the selected
   official Recipe through `list_recipes`, before supplying inputs.
4. Run it once through `call_template` or `call_recipe`; never replay Recipe
   stages or targets in an Agent loop.
5. Live REAPER readback is truth. SQLite / Project Index is navigation only.

Answer with user-facing REAPER facts first. Hide MCP contract, SQLite, session,
and evidence internals unless they are needed to explain a blocker or recovery.

Saved executable Recipes use `call_recipe` with exactly seven operations:
`validate`, `save`, `list`, `get`, `delete`, `run`, `resume`. Discover a saved
revision through `list_recipes`, expand its exact id, and reuse the complete
`recipe_id` / `version` / numeric `revision` / `content_hash` /
`validation_result_id` identity unchanged. Never run by fuzzy recipe id alone
and never send runtime trust facts. Page retained evidence with operation `get`
plus `evidence_ref`.

Recipe authoring/reuse route: discover dependencies by exact Macro/Template
manuals, build a declarative Macro-first draft, then `validate -> save`. A
temporary one-off continues `run -> delete` after terminal evidence is retained;
a reusable Recipe stays saved and is rediscovered after reconnect with
`list_recipes` or `call_recipe` operation `list/get`, then runs through one public `call_recipe` call.
Use the returned exact `next_call` for a safe resume;
never replay Recipe stages or targets yourself.

## Recipe quick use

A Recipe is a saved declarative batch program, not an Agent conversation. Use
one Macro when it already covers the whole bounded operation; use a Recipe for
two or more ordered stages, one frozen plan over many exact targets, or work
that should be saved and repeated. Use a Skill for judgment or adaptive
guidance. The Agent only chooses dependencies and binds inputs before the run,
then explains aggregate readback afterward; it never loops through stages or
targets while the Recipe runs.

For a temporary Recipe, read
`product_surface.recipe_productization.lifecycle.minimal_draft_template`, exact-
expand each dependency, copy its id/version/risk/descriptor hash/capabilities,
replace every `COPY_` value, then call `validate -> save -> run`. Example:
"apply one fixed dialogue cleanup plan to 63 selected audio Items." The Recipe
holds the fixed plan and the batch Macro handles all 63 targets in one stage;
do not generate 63 calls. Where that Macro has the 64-target limit, 1-64 is
valid and 65 must fail before mutation. After terminal evidence is retained,
call `delete` with the exact saved identity and `confirm=true`. To keep the same
Recipe, omit `delete`; after reconnect rediscover it with `list/get` and run the
exact revision again. In a saved draft, keep exact `project_identity` and
`bridge_owner`, but use `bridge_generation="generation:runtime_bound"`: a fresh
run binds the current generation after reconnect, while resume remains bound to
the failed run's generation. Never execute an inline or unsaved draft.

Search Recipes with the user's original words, then exact-expand the selected
id using `list_recipes` fields `steps`, `assertions`, and `recovery`. The two
official product Recipes are:

- `recipe.mix.create_bus_processing`
- `recipe.midi.create_instrument_part`

Official Recipes pressure-test the same general Recipe system; they are not a
special execution surface. A fork becomes a user-owned revision and uses the
same validate/save/list/get/run/reconnect, trust, evidence, and whole-Recipe
Undo path as every user-authored Recipe.

An update may preserve a user Recipe revision whose sealed dependency catalog
no longer matches the installed catalog. `list_recipes` reports it as
`REVISION_STALE` and keeps official and other valid Recipes available. Never
rewrite or execute the stale revision automatically. Tell the user it needs
revalidation/rebase, then continue with unaffected Recipes when appropriate.

Exact Recipe manuals carry required inputs, deterministic defaults, safety,
whole-Recipe Undo/recovery posture, fork guidance, and the complete one-call run
shape. Do not expose hash/checkpoint/Bridge/evidence plumbing to the user unless
it explains a blocker or recovery.

Macro-first: prefer one of the 15 Macros. Use a direct Template only after
recording one typed fallback reason
(`macro_missing_for_task`, `macro_task_out_of_scope`,
`macro_target_ambiguous_or_unavailable`, `macro_domain_not_accepted`,
`macro_budget_prefers_atomic_template`).
For that atomic fallback, search `list_templates`, exact-expand `inputSchema`,
`examples`, and `expectedDelta`, then call only the exact Template with
schema-valid input and live-resolved refs. Do not compose a hidden workflow from
Template calls when a Macro or saved Recipe covers the task.

On `list_templates` with a non-empty `query`, read
`product_surface.agent_context_macro_guide.macro_recommendations` (1-3 rows).
Each row has lowercase `id`, ready `exact_expansion_call`, required target facts,
`preview_or_dry_run_mandatory`, and typed Template fallback posture. Do not echo
the full user text. Search phrases are metadata only, never executable aliases.

On exact-id expansion, read each item's `first_try_execution_guide` for accepted
modes, public fields, units/bounds, selector/ref requirements, paging/budget
recovery, deterministic `next_calls`, and `examples[].public_call`. Every one of
the 15 Macro manuals includes at least one complete public `call_template`
shape, target/ref prerequisite when needed, live `outcome_truth`, and recovery.
It is not a `fields` value: request
supported fields such as `id` and `inputSchema`, then read the guide from
`product_surface.agent_context_macro_guide.requested_expansions.items`. If live
identity is unresolved, the guide marks the mutation non-executable and pairs
an immediately executable `macro.project.query` prerequisite. Never treat
placeholder refs as executable.

On covered validation/replacement/budget/readiness errors, follow machine-readable
`error.next_call` or `error.request_patch` when present; keep existing failure codes.

FX parameters: prefer `macro.fx.set_controls`. Use `mode=exact_parameters` for
1-8 parameters on one FX, or `mode=exact_assignments` for 1-64 assignments across
one or more exact `fx_ref` targets. Obtain exact refs first, page parameters to
completion, then supply `param_index` or one unique returned name/ident (not
fuzzy guesses). `mode=semantic` is compatibility-only and fails closed with
`STOCK_SEMANTIC_UNIT_UNPROVEN` until native low/mid/high proof exists
(including ReaSynth/RS5k Attack). Direct parameter Templates are debug fallback.
For ordinary Audio Take FX, publicly query one exact `take_ref`, call
`macro.fx.apply_chain` with that ref, copy the exact returned `fx_ref`, then call
`macro.fx.set_controls`; never construct the FX ref or invoke an internal resolver.

Audio Items: preserve source files, Track identity, and timeline position unless
the exact requested Macro says otherwise. For simultaneous layers, place each
source on a separate Track; do not create accidental same-Track overlap. Use
`macro.items.apply` with `mode=remove_silence` for agent-driven batching, or the
packaged `Remove Silence...` Action for an interactive REAPER run. The repeat
Action reuses the last accepted settings. Valid scopes are `all`, `leading`,
`trailing`, `edges`, and `internal`. The Macro and Action routes share one
REAPER-side batch plan; never loop over Items or fragments through MCP.

For level normalization, use `macro.items.apply` with
`mode=normalize_level`. Valid metrics are `lufs_i`, `rms_i`, `peak`,
`true_peak`, `lufs_m_max`, and `lufs_s_max`. This is REAPER-native
source/item/take pre-FX normalization, not post-FX loudness processing. Both
audio operations accept at most 64 exact selected audio Items; a larger
selection must fail before mutation with zero-write truth.

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

## 15 Macro minimum examples

Use the user's words, expand the exact Macro, and then make one public call.
These are the shortest safe intents; the expanded manual supplies the exact
schema, selected/exact target rule, live readback, and recovery:

- `macro.project.inspect`: "检查工程是否就绪并告诉我当前工程路径。"
- `macro.project.query`: "找出当前选中的 Item 和它们的精确引用。"
- `macro.project.delete_targets`: "删除所有静音轨道；运行前冻结 predicate 选择。"
- `macro.project.apply_layout`: "创建一个名为 Music 的文件夹轨道和两个子轨道。"
- `macro.project.file`: "保存当前工程。"
- `macro.routing.apply`: "把当前选中的 Track 路由到名为 Bus 的 Track。"
- `macro.media.place_assets`: "把这批音频一次放到当前选中的 Track。"
- `macro.items.analyze`: "分析当前选中的 Item 的响度、瞬态和静音。"
- `macro.items.apply`: "把当前选中的 Item 音量降低 3 dB。"
- `macro.midi.apply`: "把当前选中的 MIDI 音符按网格量化。"
- `macro.fx.apply_chain`: "给当前选中的 Track 加 ReaEQ；Audio Take FX 要明确 take。"
- `macro.fx.set_controls`: "把当前选中的 Track FX 的精确参数设为请求值。"
- `macro.controls.set`: "把当前选中的 Track 静音并读回结果。"
- `macro.automation.apply`: "对当前选中的 Track 写入一段 Automation。"
- `macro.render.targets`: "渲染当前选中的 Item 和 Track，并返回输出文件。"

## Paging, budget, and recovery

Public responses may truncate. Truncation is not internal knowledge loss.

- Continue with the returned `cursor` when present.
- Shrink `limit` / fields / include when a budget error is returned.
- Recover full payloads with `get_state` (`scope=artifact`, `artifact_ref`) when
  an artifact ref is returned.
- Recover retained Recipe evidence with `call_recipe` operation `get` and the
  returned `evidence_ref`.
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

- Official `openreaper-start`; success means matching Bridge heartbeat plus a real
  `call_template(template.transport.read_state)` probe already passed.
- macOS and Windows startup windows are observed read-only. OpenReaper never
  clicks or closes them. A blocking window returns
  `STARTUP_USER_ACTION_REQUIRED` while preserving the REAPER PID and Bridge
  generation; ask the user to resolve it, then rerun
  `openreaper-start --recover-existing` without starting a duplicate REAPER.
- REAPER action `OpenReaper: Start MCP bridge` is only a manual recovery fallback when
  autonomous startup reports that blocker, not a normal startup step.

Live refs for Automation and similar write flows: first call
`macro.project.query` (or inspect), then reuse returned canonical refs exactly.

## Schema-checked examples

```text
ping {}
list_templates {"query":"create a MIDI clip and add a compressor","limit":25}
list_templates {"ids":["macro.midi.apply"],"fields":["id","inputSchema"]}
call_template {"id":"macro.project.inspect","input":{"include":["project_path","dirty_state","markers_regions"],"fields_by_scope":{"markers_regions":["ref","name","position_seconds"]},"limit":25,"compact_response":true,"ref_policy":"canonical_only"}}
call_template {"id":"macro.midi.apply","input":{"mode":"create_clips","start_seconds":0,"duration_quarter_notes":4,"notes":[{"start_offset_quarter_notes":0,"end_offset_quarter_notes":1,"pitch":60,"velocity":96,"channel":0},{"start_offset_quarter_notes":1,"end_offset_quarter_notes":2,"pitch":62,"velocity":96,"channel":0},{"start_offset_quarter_notes":2,"end_offset_quarter_notes":3,"pitch":64,"velocity":96,"channel":0},{"start_offset_quarter_notes":3,"end_offset_quarter_notes":4,"pitch":65,"velocity":96,"channel":0}],"selector":{"name":"Instrument"},"dry_run":false}}
call_template {"id":"macro.items.apply","input":{"mode":"set_properties","target":"selected","properties":{"volume_db":-3},"dry_run":false}}
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

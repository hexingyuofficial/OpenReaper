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
Macro-first route: `ping -> list_templates`; reusable
or multi-stage Recipe intent may search `list_recipes` in the same first round.

1. `ping` — confirm the server is loaded and read readiness/startup guidance.
2. Search `list_templates` and, for reusable/multi-stage intent, `list_recipes`
   with original words as `query` (`limit`, e.g. 25). Do not
   guess casing, field names, refs, enums, or Recipe identities first.
3. Exact-id expand the selected Macro through `list_templates`, or the selected
   official Recipe through `list_recipes`, before supplying inputs.
4. Run it once through `call_template` or `call_recipe`; never replay Recipe
   stages or targets in an Agent loop.
5. Live REAPER readback is truth. SQLite / Project Index is navigation only.

Answer with user-facing REAPER facts first; hide MCP internals unless needed for
a blocker or recovery.

`call_recipe` has exactly seven operations: `validate`, `save`, `list`, `get`,
`delete`, `run`, and `resume`. Discover and exact-expand first; preserve full
revision identity and follow `next_call`. Page evidence with `get` +
`evidence_ref`; never replay stages or targets.

## Recipe quick use

A Recipe is a saved declarative batch program; use one public `call_recipe` call.
For a temporary one-off, use one Macro; use a Recipe for ordered stages, a
frozen plan, or reuse. Use a Skill for judgment. The Agent binds inputs; it
explains readback and never loops stages or targets.

Temporary authoring starts from
`product_surface.recipe_productization.lifecycle.minimal_draft_template`:
exact-expand dependencies, replace every `COPY_`, then `validate -> save -> run`.
The Macro batches targets; do not generate 63 calls; 65 must fail before mutation.
Delete exact terminal identity with `confirm=true`; otherwise omit `delete`, and later find the saved revision
with `list/get`. Keep exact project and owner with
`bridge_generation="generation:runtime_bound"`: a fresh run binds the current generation after reconnect; refs are rediscovered after reconnect,
while resume remains bound to the failed run's generation. Never execute an inline or unsaved draft.

Stages are internal batches, never Agent loops. `for_each` is one
target-group batch and `once` one shared operation. Path:
`validate -> save -> run`; do not invent `run_transient`.

Search Recipes with the user's original words, then exact-expand the selected
id using `list_recipes` fields `steps`, `assertions`, and `recovery`. Never run by fuzzy recipe id alone. The two
official product Recipes are:

- `recipe.mix.create_bus_processing`
- `recipe.midi.create_instrument_part`

Official Recipes use the same general Recipe system, not a special execution
surface. A fork becomes a user-owned revision and uses the
same validate/save/list/get/run/reconnect, trust, evidence, and whole-Recipe
Undo path as every user-authored Recipe.

An update may preserve a user Recipe revision whose sealed dependency catalog
no longer matches the installed catalog. `list_recipes` reports it as
`REVISION_STALE`; never
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
`preview_or_dry_run_mandatory`, and typed Template fallback posture. Search phrases are metadata only,
not executable aliases.

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

## Live Target Binding

For an operation on selected targets, call the owner once with
`target_binding`; omit only a documented selection default. Do not pre-query
`selected_context`, repeat GUIDs, loop writes, or alter visible selection.

Query only when asked what matches or when parameters need analysis. Reuse the
typed binding; query/mutation share a fingerprint. Invalid sets stop zero-write.
Reverse/Glue, Freeze/Unfreeze, and project Stem are one-call set operations.
Stem defaults to selected Tracks; insertion and non-silent readback precede mute.

`PROJECT_LOCKING_ENABLED` on Reverse is zero-write and preserves selection. Ask
the user to disable REAPER Locking, then retry once; never toggle it automatically.

Recipe target sets freeze at run start and survive resume: Items, Tracks, Takes,
selected Envelopes, `D_UISEL` Automation Items, ranged Points. Selected Takes
are selected Items' active Takes. `time_range` is constraint-only; selected points fail
`AUTOMATION_POINT_SELECTION_UNPROVEN`.

Declare a set for a reusable scope (for example, Items on two Tracks inside a
range), reuse its `target_set_id` in every stage, and never loop per object. Use
`macro.project.query` with the same binding only when the user asks what
matches; writes pass the binding directly. The public inventory marks each
Macro/Template `live_or_explicit`, `explicit_only`, or `unsupported`.

FX: use `macro.fx.set_controls`; `exact_parameters` handles 1-8 values on one FX,
and `exact_assignments` 1-64 across exact `fx_ref`s. Complete parameter paging,
then use returned index/ident. Prefer `display_value` (`3000 Hz`, `-3 dB`,
`Bell`); never guess 0-1. OpenReaper compiles and reads back via REAPER;
`normalized_value` is debug/compatibility fallback. A Skill may retain
`plugin_id`, layout fingerprint, and stable `param_ident` after one full read,
but must re-read changed layouts. Every use revalidates live identity/format.
Plugin-UI-only controls are excluded.

Unproven `semantic`: `STOCK_SEMANTIC_UNIT_UNPROVEN`. For Take FX, use returned refs.
Same FX on active audio Takes: exactly three public calls: `apply_chain` ->
`fx_set_ref`; `set_controls(inspect_set)` -> `parameter_plan_ref`; then
`set_controls(shared_plan)`. Never enumerate/cache members. Project/generation changes invalidate both refs.

Native paths are JSON values, not shell arguments: keep Unicode and spaces literal;
never use shell quotes, `file://`, percent encoding, `~`, or splitting. Switch
`.RPP` with `macro.project.file(open_project_in_tab)`; never macOS `open -a` or
startup recovery. `bridge_ready` proves transport only; require
`project_identity_verified:true` and `index_project_identity_verified:true`.
For `partial_state:"opened_but_index_not_ready"`, activate its `project_ref`,
then query with `refresh_policy:"force_read_only_refresh"`; do not reopen.
Unknown dialog: report and wait; never click or close it automatically.

Filename grouping: fresh-query `item_ref`, `source_basename`, and
`source_identity_status=available`; ambiguity is zero-write. Never use timeline position
or guess. On `TRACK_NOT_FOUND`, refresh and rebuild.

Audio Items preserve source files; Same Track is no-op success. Keep Track identity and timeline unless the
Macro says otherwise; simultaneous layers belong on separate Tracks. Use
`macro.items.apply` `mode=remove_silence`, or the packaged `Remove Silence...`
Action. It reuses its last accepted settings on the next invocation. Scopes:
`all`, `leading`, `trailing`, `edges`, `internal`.
Both routes share one REAPER batch; never loop over Items through MCP.

For normalization use `macro.items.apply` `mode=normalize_level`: `lufs_i`,
`rms_i`, `peak`, `true_peak`, `lufs_m_max`, or `lufs_s_max`. It is REAPER-native
source/item/take pre-FX, not post-FX. Both audio operations allow at most 64
exact selected audio Items; larger selections fail zero-write before mutation.

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
- `macro.fx.apply_chain` — apply bounded FX or create a Track-owned Take-FX set
- `macro.fx.set_controls` — exact/semantic controls or homogeneous-set broadcast
- `macro.controls.set` — BPM, grid, track/item/take/transport/send controls
- `macro.automation.apply` — automation points/curves on exact live refs
- `macro.render.targets` — bounded audio or macOS MP4/MOV render/export targets

## 15 Macro minimum examples

Expand the exact Macro before one public call; its manual supplies schema,
targets, readback, and recovery:

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
- `macro.fx.apply_chain`: "给一条 Track 的全部 active audio Take 一次加同一 ReaEQ。"
- `macro.fx.set_controls`: "检查上一步 FX set 的代表实例，再批量应用参数计划。"
- `macro.controls.set`: "把当前选中的 Track 静音并读回结果。"
- `macro.automation.apply`: "对当前选中的 Track 写入一段 Automation。"
- `macro.render.targets`: "把当前时间选择导出成 1920x1080、30 fps 的 MP4。"

## Paging, budget, and recovery

- Continue with the returned `cursor` when present.
- Shrink `limit` / fields / include when a budget error is returned.
- Recover full payloads with `get_state` (`scope=artifact`, `artifact_ref`) when
  an artifact ref is returned.
- Recover retained Recipe evidence with `call_recipe` operation `get` and the
  returned `evidence_ref`.
- Retry once after readiness/budget repair; re-resolve refs after project generation changes.
- Live REAPER readback remains authority for writes; SQLite never authorizes a mutation.

## Startup and safety

`openreaper-start` starts REAPER when none is running or attaches to the single
REAPER already opened from the normal icon. It never launches a duplicate. The
installed startup hook is additive and preserves user startup code/config; it
does not touch shortcuts, mouse modifiers, ReaTooled state, or keymaps. The
normal REAPER window and `Scripts on`/ReaScript status window are non-blocking.

## Safety boundary (do not bypass product)

Forbidden:

- Searching source code, install trees, HOME, media libraries, or disk to invent capability
- Raw Lua, raw REAPER Action IDs, shell/process, SQL strings, or UI product bypass
- Caller-owned `context` on `call_template` (server allocates context)
- Placeholder refs such as TRACK/TAKE/ITEM token templates as real targets
- Hardware/device I/O

Allowed small assists (not product bypass):

- Official `openreaper-start`; success means matching Bridge heartbeat plus a real
  `call_template(template.transport.read_state)` probe already passed. It can
  start or attach to one REAPER instance.
- macOS and Windows startup windows are observed read-only. OpenReaper never
  clicks or closes them. A blocking window returns
  `STARTUP_USER_ACTION_REQUIRED` while preserving the REAPER PID and Bridge
  generation; ask the user to resolve it, then rerun
  `openreaper-start --recover-existing` without starting a duplicate REAPER.
- REAPER action `OpenReaper: Start MCP bridge` is only a manual recovery fallback when
  autonomous startup reports that blocker, not a normal startup step.

For exact-ref Automation writes, reuse canonical refs returned by the bounded
Automation target query exactly.

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
call_template {"id":"macro.project.file","input":{"operation":"open_project_in_tab","target_path":"/Users/me/工程/【音频】 白×滑动音阶 🎛️/工程 demo.RPP"}}
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

# Streetlight Progress

Short status log. Update at the end of every step. This file is the source of
truth for "where are we" — when the conversation context gets long, read this
first.

## Current Status

**Step 3 ✅ done — all 8 acceptance points verified on REAPER 7.71/macOS-arm64 (2026-06-27).**

Last verified on REAPER 7.71/macOS-arm64: 2026-06-27 (Steps 2 + 3). Step 3
TS side 76/76 green; bridge-side dispatcher and MCP-side Zod / registry
rejections both proven against a live REAPER session.

**Step 4a 🟡 code landed; REAPER smoke pending bridge reload.** json.null
sentinel in `packs/core/lib/json.lua`, `last_result:item:N` +
`track:Name/item:N` resolvers in `refs.lua`, `ctx.json` wired into the
template ctx. 76/76 tests still pass.

### v0.1 progress at a glance

| | Done | Code-done, REAPER-pending | Remaining |
|---|---|---|---|
| Steps | 0, 1, 2, 3 | — | 4, 5, 6, 7, 8 |
| Tests | 76/76 green | — | grows per step |

**~4 / 9 steps shipped, ~5 left.** Steps 4 (7 templates + 2 new ref kinds + Lua
JSON null fix) and 6 (render) are the biggest. Steps 5, 7, 8 are smaller.

### Next action

1. **Reload `streetlight_bridge.lua` in REAPER** (Step 4a touched
   `json.lua`, `refs.lua`, and the bridge ctx wiring — the bridge dofile's
   pack files exactly once at startup, so a reload is mandatory). Console
   should still print `templates: item_pitch` — no new templates land
   until 4b.

2. **Walk the 4a smoke prompts** in § "Step 4a smoke recipe" below.
   Each prompt verifies one ref kind. Three prompts total; all
   reversible via Cmd+Z.

3. **If green:** flip Step 4a to ✅ and start 4b (5 easy templates:
   `track_create`, `track_rename`, `item_move`, `item_rate`, `item_trim`).

4. **If red:** paste the bridge console output + the failing
   `call_template` response JSON into the next conversation. Likely
   suspects: refs.lua syntax slip, `ctx.json` not threaded, last_result
   table shape drift.

## What's Done

### Documentation (v0.1 specs)

- `README.md` — public-facing intro
- `docs/ARCHITECTURE.md` — 5 MCP tools, pack layout, item-reference lifecycle pinned
- `docs/KERNEL_DESIGN.md` — long-term vision and borrowed patterns
- `docs/MVP.md` — 11 required templates (item_reverse removed), success criteria
- `docs/IMPLEMENTATION_PLAN.md` — detailed 9-step build plan with acceptance + pitfalls per step. **Updated 2026-06-27**: Steps 2 / 3 / 5 now reference response-budget rules; bottom schema snippets reflect the v0.1 locked shapes for `get_state` and `call_template`.
- `docs/RENDER_NOTES.md` — render mechanics so Step 6 does not blow up
- `docs/TEMPLATE_SPEC.md` — schema-as-Zod, item_pitch example
- `docs/ROADMAP.md` — v0.2 (socket + batched calls + **response-budget API: cursor / fields / include / summary_only / per-tool byte caps**), v0.3 (plan/apply, verification)
- `docs/INSTALL.md` — manual install flow; auto-start via __startup.lua documented
- `docs/RESPONSE_BUDGET.md` — **new 2026-06-27.** Cross-cutting design constraint for every list-returning tool. Locked v0.1 shapes for `get_state` and `call_template`. Read this before adding any new tool or new `get_state` scope.

### Code — `packages/core` (Step 0)

Files: `errors.ts`, `result.ts`, `risk.ts`, `refs.ts`, `queue.ts`, `registry.ts`, `types.ts`, `index.ts`.
Tests: 36 passing in 5 files under `src/__tests__/`.

**Updated 2026-06-27 (Step 2 response-budget pass):**
- `errors.ts` — added `RESPONSE_TOO_LARGE` error code (raised by bridge when even one item exceeds the 64 KiB response cap; soft truncation is NOT an error).
- `types.ts` — added `ResponseBudgetMeta { total, returned, truncated, response_bytes }`; `SelectionState extends ResponseBudgetMeta`. Notation convention pinned in jsdoc: `name` / `track_name` are required `string`; unnamed objects → `""`, never `null`, never omitted.

### Code — `packages/mcp-server` (Step 1)

Files:

- `src/transport/file-queue.ts` — `FileQueueClient`, `resolveQueueDir`, atomic writes, geometric backoff polling, BRIDGE_NOT_RUNNING on timeout
- `src/tools/ping.ts` — `ping(client)` wrapper
- `src/index.ts` — stdio MCP server, registers `ping` + `get_state` tools (Step 2). **Updated 2026-06-27**: `get_state` MCP schema now exposes optional `limit` (1-200, Zod-validated MCP-side).
- `src/transport/__tests__/file-queue.test.ts` — 14 tests with a fake-bridge harness

### Code — `reaper/` (Step 1)

Files:

- `streetlight_bridge.lua` — defer loop at 10 Hz, FIFO queue scan, atomic done writes, ping dispatcher. **Updated 2026-06-27 (Step 2 response-budget):** `get_state` now accepts `params.limit` (defaults 50, clamped to [1, 200]), tracks encoded bytes per item, stops at the item boundary if the next item would push past `MAX_RESPONSE_BYTES = 65536`, returns `RESPONSE_TOO_LARGE` when even the first item exceeds the cap. Response includes `total / returned / truncated / response_bytes`. `MAX_RESPONSE_BYTES`, `DEFAULT_LIMIT`, `MIN_LIMIT`, `MAX_LIMIT` are intentionally NOT params in v0.1 — exposing them invites foot-guns; v0.2 may unlock per-tool caps.
- `packs/core/lib/json.lua` — minimal pure-Lua JSON encoder/decoder
- `packs/core/manifest.lua` — stub (templates registered from Step 3 onward)

### Code — Step 3 additions (2026-06-27)

Files (TS):

- `packages/core/src/queue.ts` — **hardened `makeCommandId`**: format is now
  `cmd_YYYYMMDDHHMMSSmmm_NNN_xxxxxx` (UTC time to ms + 3-digit counter +
  6-hex-digit random). Sortable prefix preserved so bridge FIFO scan
  (`table.sort` over filenames) still works. Closes the same-second
  process-restart / counter-wrap collision window that would have been
  silently dangerous once mutations started shipping. Added `CommandKind`
  comment mapping wire kinds to MCP tool names (`call_template` ↔
  `"template"` etc.) — answers the protocol-naming-drift flag in the
  codex review.
- `packages/core/src/types.ts` — `CallTemplateResult` type pinning the
  locked envelope shape.
- `packages/mcp-server/src/templates/item-pitch.ts` — Zod schemas (`strict`
  mode rejects unknown params) + `CapabilityDefinition` for `item_pitch`.
- `packages/mcp-server/src/templates/index.ts` — `registerCoreTemplates()`.
  New templates are one-liner additions here; no per-template special
  casing in the tool layer.
- `packages/mcp-server/src/tools/call-template.ts` — `callTemplate()`
  wrapper. Validates name → `TEMPLATE_NOT_FOUND`; validates params via
  the registered Zod schema → `PARAMS_INVALID`; both happen **without**
  touching the queue. Writes wire command `kind="template"`,
  `name=<template>`, `params=<validated>`. **Mutating-timeout contract**
  documented in the file's jsdoc: agents must NOT auto-retry on
  `BRIDGE_NOT_RUNNING` for mutations — re-running can double-apply.
- `packages/mcp-server/src/index.ts` — bootstraps the registry at startup
  and registers the `call_template` MCP tool. Tool description names the
  locked shape and warns against auto-retry on `BRIDGE_NOT_RUNNING`.
- `packages/mcp-server/src/tools/__tests__/call-template.test.ts` — **12
  tests**: happy path, on-wire kind/name/params, `TEMPLATE_NOT_FOUND`
  without round-trip, `PARAMS_INVALID` for out-of-range / missing /
  unknown-key / empty-name, surfaced `ITEM_NOT_FOUND` and
  `TAKE_NOT_FOUND`, truncated-envelope propagation (50 IDs but
  `changed_count=87`), `BRIDGE_NOT_RUNNING` semantics, no-auto-retry
  invariant.
- `packages/core/src/__tests__/queue.test.ts` — updated for new ID format
  (7 tests; adds explicit lexicographic-ordering test across milliseconds).

Files (Lua):

- `reaper/packs/core/refs.lua` — `resolve_item(ref, last_result)` returns
  `(item, nil)` or `(nil, code, msg)`. Step 3 implements `selected:N`
  and `guid:{...}`. `last_result:item:N` and `track:Name/item:N` parse
  on the TS side but return `REF_INVALID` from the bridge in v0.1 Step 3
  — Step 4 lights them up.
- `reaper/packs/core/undo.lua` — `with_undo(label, flags, fn)`. `pcall`
  around the body; `Undo_EndBlock2` always runs (preventing stuck undo
  state on handler errors). Exports `UNDO_STATE_*` constants.
- `reaper/packs/core/templates/item.lua` — first template module.
  `item_pitch(params, ctx)` resolves the ref, gets active take (else
  `TAKE_NOT_FOUND`), sets `D_PITCH`, calls `UpdateArrange`, returns
  `{ changed_ids = { "guid:..." } }`. Errors via `error({code,message})`
  tables — strings would lose the typed code at the dispatcher boundary.
- `reaper/packs/core/manifest.lua` — now non-empty: loads
  `templates/item.lua` and registers `item_pitch` with undo metadata.
  Resolves its own dir via `debug.getinfo`, so the bridge stays
  pack-layout-agnostic.
- `reaper/streetlight_bridge.lua` — **`DISPATCH.template` added** and
  this is where the response-budget contract is enforced. Reads ONLY
  `result_or_err.changed_ids` from the handler return; anything else
  (descriptors, debug payload) is silently dropped at the dispatcher
  boundary. Caps at 50 IDs; computes `changed_count` from the raw total;
  sets `truncated = changed_count > 50`. Updates `LAST_RESULT.items` on
  success (Step 4 reads). Translates `error({code, message})` tables
  into typed error envelopes; string-error fallbacks collapse to
  `INTERNAL_ERROR`. `undo.with_undo` wraps undoable templates so
  `Undo_EndBlock2` runs even on the error path.

### Verification status (Step 3)

- `npm run typecheck` clean
- `npm run build` clean
- `npm test` — **76 tests pass** (4 queue + 17 refs + 6 result + 5 registry + 4 risk + 14 file-queue + 11 get-state + 12 call-template; queue.test grew from 4 to 7)
- **REAPER smoke test ✅ all 8 acceptance points on REAPER 7.71/macOS-arm64 (2026-06-27):**
  1. `item_pitch selected:0 semitones:-3` returned the locked envelope
     `{ template, changed_count:1, changed_ids:["guid:{1F8063CD-...}"], truncated:false }` — **no `pitch_before` / `pitch_after` / `items` fields**, dispatcher contract held ✅
  2. Properties dialog read `Pitch adjust (semitones) = -3.000` ✅
  3. Undo History top entry: `Streetlight: item_pitch`; `Cmd+Z` reverted pitch to 0 ✅
  4. `selected:999` → `ITEM_NOT_FOUND`, message included actual selection count, `recoverable:true` ✅
  5. Bogus GUID → `ITEM_NOT_FOUND` with the bogus GUID echoed back (true TAKE_NOT_FOUND for empty-MIDI not exercised; covered by the 12 call-template unit tests) ✅
  6. `semitones: 100` → `PARAMS_INVALID` from MCP-side Zod with a
     `"semitones: Number must be less than or equal to 24"` message; bridge `pending/` / `running/` / `done/` all empty after the call ✅
  7. `does_not_exist` → `TEMPLATE_NOT_FOUND` from MCP-side registry
     (message `"No template registered with name \"does_not_exist\""` — distinct from the bridge-side phrasing); bridge queue dirs empty ✅
  8. Post-mutation `get_state(selection)` first item's GUID equalled
     `changed_ids[0]` from acceptance 1 ✅

### Step 3 acceptance — to verify in REAPER

Per the locked-shape rewrite of IMPLEMENTATION_PLAN.md Step 3:

1. With one item selected, `call_template item_pitch
   { item_id: "selected:0", semitones: -3 }` returns
   `{ ok: true, result: { template: "item_pitch", changed_count: 1,
   changed_ids: ["guid:{...}"], truncated: false } }`. **No item
   descriptor in the result.**
2. REAPER item properties dialog shows pitch -3.000.
3. `Cmd+Z` reverts; undo history reads `Streetlight: item_pitch`.
4. Empty selection → `{ ok: false, error: { code: "ITEM_NOT_FOUND",
   recoverable: true } }`; REAPER state unchanged.
5. Empty MIDI item without take → `TAKE_NOT_FOUND`.
6. `semitones: 100` → `PARAMS_INVALID` at MCP layer; bridge log shows
   no command picked up.
7. Unknown template name → `TEMPLATE_NOT_FOUND` at MCP layer; bridge
   log shows no command picked up.
8. `get_state` after mutation reflects new pitch (verify via UI or
   tooling).

#### Step-by-step REAPER smoke test recipe

The agent driving this MCP server (Claude Code, Codex, Cursor, etc.) is
the one issuing the calls below — these are the prompts you give it.

1. **Reload the bridge.** In REAPER:
   `Actions → Show action list → ReaScript: Run reaper script (EEL2, lua, py)…`,
   pick `reaper/streetlight_bridge.lua`. The console (`View → Show console`)
   should print:
   ```
   [streetlight] bridge starting
   [streetlight] loaded pack 'core' v0.1.0
   [streetlight] bridge ready — templates: item_pitch
   ```
   No `templates: item_pitch` line → manifest didn't load; stop and
   read the console for a dofile path error.

2. **Sanity-check ping** (no mutation, proves the round trip):
   > Prompt: *"Ping Streetlight."*

   Expect `{ ok: true, result: { bridge: "connected", reaper_version: "7.x" } }`.

3. **Acceptance 1 — happy path.** Drop any media file on a track,
   select exactly one item, then:
   > Prompt: *"Use Streetlight `call_template` to pitch the selected item down 3 semitones."*

   Pass: response is the locked envelope, **with no
   pitch_before / pitch_after fields**. Failure of this shape means the
   dispatcher contract leaked — stop and read `streetlight_bridge.lua`
   `DISPATCH.template`.

4. **Acceptance 2 — REAPER UI confirms.** Double-click the item →
   Properties dialog. "Pitch adjust (semitones)" should read `-3.000`.

5. **Acceptance 3 — undo label.** `Edit → Undo History`. Top entry:
   `Streetlight: item_pitch`. `Cmd+Z` reverts pitch to 0.

6. **Acceptance 4 — empty selection.** Click on empty timeline (deselect
   all), then run the same prompt as step 3. Expect `ITEM_NOT_FOUND`,
   recoverable: true. Selection still empty.

7. **Acceptance 5 — no active take.** `Insert → New MIDI item`, then
   right-click → `Take → Delete active take` until empty. Select it. Same
   prompt. Expect `TAKE_NOT_FOUND`.

8. **Acceptance 6 — out-of-range params** (Zod blocks before the bridge):
   > Prompt: *"Pitch the selected item up 100 semitones."*

   Expect `PARAMS_INVALID` mentioning `semitones`. **Bridge console
   should show no new activity** — proves MCP-side Zod rejected before
   the queue write.

9. **Acceptance 7 — unknown template** (registry blocks before bridge):
   > Prompt: *"Run Streetlight template `does_not_exist` with empty params."*

   Expect `TEMPLATE_NOT_FOUND`. Bridge console silent.

10. **Acceptance 8 — get_state reflects mutation.** Apply acceptance 1
    again (item still selected, pitch back to 0 from your undo). Then:
    > Prompt: *"Get the current selection state."*

    The returned item's GUID should match the `changed_ids[0]` you saw
    in step 3. (v0.1 `get_state` does not echo pitch — verify via the
    REAPER UI for now.)

If anything fails: copy the bridge console output and the MCP response
JSON into the next conversation. Both are needed to diagnose.

### Step 4a smoke recipe

After reloading `streetlight_bridge.lua`, walk these three prompts in
order. Each verifies one ref kind. All reversible via Cmd+Z, so feel free
to leave items in arbitrary pitch states during the run — the final
Cmd+Z chain resets everything.

Prerequisite: at least one media item on a track named `111` (or rename
your existing track), with that item selected.

1. **Acc 4a-1 — `selected:0` baseline.** Establishes the first
   `last_result.items` entry.
   > Prompt: *"Use Streetlight `call_template` to pitch the selected item up 1 semitone."*

   Pass: locked envelope, `changed_ids` has one GUID (your first
   selected item). Pitch dialog reads `+1.000`.

2. **Acc 4a-2 — `last_result:item:0` echoes the same item.** Same item
   should be pitched again, this time to −1.
   > Prompt: *"Use Streetlight `call_template` to pitch `last_result:item:0` down by 2 semitones (so semitones = -1)."*

   Pass: same GUID in `changed_ids[0]`. Pitch dialog now reads `-1.000`.
   Verifies the bridge's `LAST_RESULT.items` write/read pairing.

3. **Acc 4a-3 — `track:111/item:0` resolves by track name.** Wakes up
   the second new ref kind. Resets pitch on track 111's first item.
   > Prompt: *"Use Streetlight `call_template` to pitch `track:111/item:0` to 0 semitones."*

   Pass: locked envelope, `changed_count: 1`. The first item on track
   `111` is now at pitch 0. (If your selected item lives on track
   `111`, the same item gets pitched and the GUID matches Acc 4a-1.)

Then drive the negative paths to confirm error messages:

4. **`last_result:item:99` →** `ITEM_NOT_FOUND, "last_result:item:99 out
   of range (last_result has 1 item)"`.
5. **`track:DoesNotExist/item:0` →** `TRACK_NOT_FOUND, "No track named
   'DoesNotExist'"`.
6. **`track:111/item:99` →** `ITEM_NOT_FOUND, "track:111/item:99 out of
   range (track has N items)"`.
7. **Bridge-reload sanity:** reload `streetlight_bridge.lua` once more
   in REAPER (`LAST_RESULT` is in-memory, dies on reload). Then call
   `item_pitch last_result:item:0 …` — expect `REF_INVALID, "no mutating
   call has produced changed_ids yet this session"`.

If anything fails: copy the bridge console + the MCP response JSON.

### Code — Step 2 additions

Files:

- `packages/mcp-server/src/tools/get-state.ts` — `getState(client, {scope, limit})` wrapper. **Updated 2026-06-27**: added `limit` Zod field (default 50, integer, [1, 200]); switched from `.parse()` to `.safeParse()` so bad input returns `{ok: false, error: { code: "PARAMS_INVALID" }}` instead of throwing. Function still never throws.
- `packages/mcp-server/src/index.ts` — registers `get_state` MCP tool; description now points at `docs/RESPONSE_BUDGET.md`.
- `packages/mcp-server/src/transport/__tests__/fake-bridge.ts` — shared test harness; records every command for on-wire kind/params assertions
- `packages/mcp-server/src/tools/__tests__/get-state.test.ts` — **11 tests** (was 6). New coverage: truncated/total/response_bytes metadata propagation, `RESPONSE_TOO_LARGE` surfacing, limit forwarding on the wire, PARAMS_INVALID on limit > 200 and limit < 1.

### Verification status

- `npm run typecheck` clean
- `npm run build` clean
- `npm test` — **61 tests pass** (36 core + 14 file-queue + 11 get-state)
- MCP stdio handshake smoke test passes
- ping round-tripped against REAPER 7.71/macOS-arm64 (2026-06-27)
- **Step 2 acceptance — all 5 points passed on REAPER 7.71/macOS-arm64 (2026-06-27):**
  1. Empty selection → `{ items: [], total: 0, returned: 0, truncated: false, response_bytes: 0 }` ✅
  2. 3 items on a named track → 3 entries, all GUIDs unique and non-empty, `track_name="111"`, plausible position/length ✅
  3. Item renamed to ` テスト_01` (CJK + leading space) → comes back UTF-8 clean, no mojibake; bridge correctly preserves user-input whitespace (does not silently trim) ✅
  4. Two consecutive `get_state` calls → identical GUIDs, identical position/length values ✅
  5. After `get_state`, REAPER selection / playhead / scroll unchanged (visually confirmed) ✅

## Acceptance Status By Step

| Step | Status | Notes |
|---|---|---|
| 0 — Repo skeleton + kernel types | ✅ done | 36/36 tests pass, typecheck + build clean |
| 1 — First round trip (ping) | ✅ done | 50/50 tests pass; verified on REAPER 7.71/macOS-arm64 |
| 2 — Read selection (get_state) | ✅ done | 61/61 tests pass; all 5 acceptance points verified on REAPER 7.71/macOS-arm64 (2026-06-27); response-budget backstop landed |
| 3 — First mutation (item_pitch) | ✅ done | 76/76 tests pass; all 8 acceptance points verified on REAPER 7.71/macOS-arm64 (2026-06-27); `DISPATCH.template` enforces locked shape at the bridge boundary; cmd-ID hardened; mutating-timeout no-auto-retry documented |
| 4 — Variation building blocks | 🟡 4a code-done, REAPER smoke pending; 4b/4c (7 templates) not started | json.null sentinel + last_result:item:N + track:Name/item:N landed; bridge ctx now exposes `json` so 4c's `item_fade` can detect explicit null |
| 5 — Regions (region_create) | ⬜ | |
| 6 — Render (render_region) | ⬜ | see `RENDER_NOTES.md` |
| 7 — Recipe discovery + end-to-end demo | ⬜ | `list_recipes` tool + finalized recipe |
| 8 — Cross-platform + release polish | ⬜ | macOS + Windows verification |

## Key Design Decisions (locked)

These are settled. Do not re-litigate without a written reason.

1. **5 MCP tools, fixed**: `ping`, `get_state`, `list_templates`, `list_recipes`, `call_template`.
2. **Templates over raw eval**: `unsafe_eval` exists but is dev-only, default off.
3. **File queue transport for v0.1**: zero Lua-side deps. Socket comes in v0.2.
4. **Zod is the schema source of truth**: TS types and JSON Schema both derive from one Zod schema per capability.
5. **Reference resolution lives in Lua bridge**: TS parses, Lua resolves.
6. **`last_result` is per-MCP-session in-memory state**: dies when the server process exits.
7. **Result envelope stays 2-state**: `{ok: true} | {ok: false}`. Async render is hidden inside the transport layer.
8. **Pack layout in v0.1 even with one pack**: `reaper/packs/core/` exists day one.
9. **Default risk policy allows `read` + `write_safe` + `filesystem`**: blocks `destructive` and `unsafe_eval`.
10. **`item_reverse` is NOT in v0.1**: cut for risk and ambiguity reasons.
11. **Queue is the pipeline**: the file queue itself sequences commands. No `call_template_sequence` tool until v0.2.
12. **Pure-Lua JSON in `packs/core/lib/json.lua`**: no external Lua deps. Replace with dkjson if traffic gets complex.
13. **Bridge processes one command per defer tick**: keeps REAPER's main thread responsive even under burst load.

### Locked 2026-06-27 — response budget (see docs/RESPONSE_BUDGET.md)

14. **Name is "response budget", not "token budget"**: we control bytes / item counts / field sets. Tokens are downstream of those.
15. **Five-principle pagination contract** for every list-returning tool: default to summary; bounded `limit`; field projection where it pays; **bridge-side item-boundary byte cap, never mid-JSON truncation**; metadata `{total, returned, truncated, response_bytes}` on every list response.
16. **`get_state(selection)` v0.1 backstop only**: `limit` default 50 clamp [1, 200], hardcoded `MAX_RESPONSE_BYTES = 65536`, `RESPONSE_TOO_LARGE` on can't-fit-one. **No cursor / fields / max_bytes-as-param in v0.1** — those defer to v0.2 (deliberate; "stable cursor" cannot be honestly promised when REAPER state shifts under us).
17. **`call_template` shape is locked even though Step 3 hasn't started**: always `{ template, changed_count, changed_ids[≤50], truncated }`. Never embed full descriptors, even for single-item mutations. Agents read post-state via `get_state(ids=[...])`.
18. **`name` / `track_name` stay required `string`**: unnamed → `""`. Never `null`, never omitted. `""` = "user didn't set a name" is real state. If LLM ergonomics ever demand more, add a new `display_name` field; do not overload `name`.
19. **Bridge defaults match TS defaults**: limit=50, MAX_LIMIT=200 in both Lua and TS. TS defense-in-depth clamps to avoid burning a Lua round-trip on a 10000-item request.

### Locked 2026-06-27 — Step 3 (call_template + item_pitch)

20. **Locked `call_template` shape is enforced at the BRIDGE DISPATCHER, not in individual templates.** Templates return `{ changed_ids = [...] }`; the dispatcher reads only that field and constructs `{ template, changed_count, changed_ids[≤50], truncated }`. Anything else a handler returns is silently dropped. This means a future template author cannot accidentally leak descriptors even if they want to.
21. **Wire kind `"template"` ≠ MCP tool `call_template`.** Decoupling the agent-facing surface from the internal dispatch tag means we can later add `template_dry_run`, `template_batch`, etc. without breaking the wire format. Top-of-file comment in `queue.ts` is the authoritative map.
22. **Command IDs are `cmd_YYYYMMDDHHMMSSmmm_NNN_xxxxxx`.** Time prefix (down to milliseconds) keeps bridge FIFO scan correct via `table.sort` over filenames; 6-hex random suffix covers the same-millisecond / process-restart collision window that would have been silently dangerous once mutations started.
23. **Mutating-timeout is NOT a retryable error.** `BRIDGE_NOT_RUNNING` from a mutating `call_template` may mean "did not happen" OR "happened but no response". v0.1 contract: agents call `get_state` to verify and recover, NOT auto-retry. v0.2 will add idempotency tokens.
24. **Template errors flow as `error({ code, message })` Lua tables.** String errors collapse to `INTERNAL_ERROR` at the dispatcher boundary. Typed error codes are part of the protocol — they must survive the pcall.

## Open Questions (defer until they bite)

Items that have been **promoted into a specific step** are stricken out
here and live as build-list items in that step. Anything still in this
list has no owner.

- Garbage collection for orphan `done/` files when MCP server crashes mid-poll. Punted to v0.2.
- How to detect a stale bridge that started but is unresponsive (vs. one that never started). Today both look like BRIDGE_NOT_RUNNING.
- Should `recipes/*.yaml` support `{{ Jinja }}`? Recipe v1 already uses it; YAML parser + template engine choice deferred to Step 7.
- ~~Bridge-level cap on `error.details` payload size.~~ → **moved to ROADMAP v0.2**.
- ~~Mutation-retry-after-timeout (idempotency tokens).~~ → **moved to ROADMAP v0.2**. v0.1 contract documented in `tools/call-template.ts` and the `call_template` MCP tool description: agents call `get_state` to recover, never auto-retry.
- ~~Lua JSON decoder swallows `null`.~~ → **moved to IMPLEMENTATION_PLAN Step 4** (`item_fade` is the first template that needs nullable params).
- ~~TS/Lua queue-dir mismatch on Linux.~~ → **moved to IMPLEMENTATION_PLAN Step 8** (cross-platform polish).

## Running The Project Today

```bash
cd "/path/to/streetlight soundly"
npm install
npm run typecheck   # both packages
npm test            # 76 tests, all passing
npm run build       # writes dist/ in both packages
```

## Where Things Live

```
streetlight/
  docs/                                # all design docs (read PROGRESS.md first)
    RESPONSE_BUDGET.md                 # ← read before adding any new tool / scope
  packages/
    core/src/                          # kernel types and registry (Step 0)
      types.ts                         # + CallTemplateResult locked shape
      errors.ts                        # RESPONSE_TOO_LARGE added 2026-06-27
      queue.ts                         # hardened makeCommandId (Step 3); wire-kind↔MCP-tool map at top
    mcp-server/src/                    # MCP server + file queue (Step 1-3)
      transport/file-queue.ts
      transport/__tests__/fake-bridge.ts   # shared test harness
      tools/ping.ts
      tools/get-state.ts               # limit field + safeParse for PARAMS_INVALID
      tools/call-template.ts           # Step 3 — validates against registry, no per-template special-casing
      templates/index.ts               # registerCoreTemplates(registry) — one-liner to add templates
      templates/item-pitch.ts          # Zod schemas + CapabilityDefinition for item_pitch
      index.ts                         # MCP get_state + call_template tools
  reaper/                              # Lua bridge (Step 1-3)
    streetlight_bridge.lua             # DISPATCH.template enforces locked shape at bridge boundary
    packs/core/
      manifest.lua                     # registers item_pitch with undo metadata
      refs.lua                         # selected:N + guid:{...} resolvers (Step 4 adds last_result + track_item)
      undo.lua                         # with_undo wrapper (EndBlock guaranteed)
      templates/item.lua               # item_pitch handler
      lib/json.lua
  recipes/                             # YAML workflow recipes
  examples/                            # MCP client config examples
```

## Picking Up From Here (for the next conversation)

1. **Read `docs/RESPONSE_BUDGET.md` first.** Everything Step 4+ is bound by the shapes locked there.

2. **Step 3 REAPER smoke test is done — all 8 acceptances passed
   2026-06-27.** See "Verification status (Step 3)" above. The 10-step
   recipe in this file is kept around as a regression checklist; rerun
   it after any change to `streetlight_bridge.lua` `DISPATCH.template`,
   `refs.lua`, `undo.lua`, or `templates/item.lua` (e.g. when Step 4
   adds new ref kinds, re-check acceptances 4 + 5).

3. **Step 4 next.** Specifics in `docs/IMPLEMENTATION_PLAN.md` § Step 4. Three workstreams:
   - **7 new templates**: `track_create`, `track_rename`, `media_import`, `item_duplicate`, `item_move`, `item_rate`, `item_fade`, `item_trim` (`item_reverse` cut). Each template = 1 TS file in `packages/mcp-server/src/templates/` + 1 entry in `templates/index.ts` + 1 Lua handler in `reaper/packs/core/templates/` + 1 entry in `manifest.lua`. The `DISPATCH.template` dispatcher already enforces the locked shape — new templates inherit it for free.
   - **2 new ref kinds in `refs.lua`**: `last_result:item:N` (bridge already updates `LAST_RESULT.items` after every mutating success — just need the read side) and `track:Name/item:N`.
   - **Lua JSON `null` fix**: `reaper/packs/core/lib/json.lua` currently swallows `null`. `item_fade` is the first template with nullable params. Add a `json.null` sentinel + document in `TEMPLATE_SPEC.md`.

4. **The Step 3 contracts are now law.** `call_template` envelope shape is `{ template, changed_count, changed_ids, truncated }`. Dispatcher enforces. New templates only need to return `{ changed_ids = [...] }`.

5. **`name` / `track_name` empty-string convention is locked.** Don't change to optional/null in Step 4 schemas.

6. **Test harness pattern:** see `packages/mcp-server/src/tools/__tests__/call-template.test.ts` for how to stand up a fake bridge, register the registry, and assert on-wire kind/name/params + envelope shape.

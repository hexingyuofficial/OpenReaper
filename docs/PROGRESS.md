# Streetlight Progress

Short status log. Update at the end of every step. This file is the source of
truth for "where are we" — when the conversation context gets long, read this
first.

## Current Status

**Step 2 ✅ DONE. Step 3 not started. Recommended next action: open a fresh
conversation and start Step 3.**

Last verified on REAPER 7.71/macOS-arm64: 2026-06-27.

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
| 3 — First mutation (item_pitch) | ⬜ | template framework + undo + refs in Lua. **Must enforce locked `call_template` shape — see RESPONSE_BUDGET.md** |
| 4 — Variation building blocks | ⬜ | 7 templates (item_reverse cut) |
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

## Open Questions (defer until they bite)

- Garbage collection for orphan `done/` files when MCP server crashes mid-poll. Punted to v0.2.
- How to detect a stale bridge that started but is unresponsive (vs. one that never started). Today both look like BRIDGE_NOT_RUNNING.
- Should `recipes/*.yaml` support `{{ Jinja }}`? Recipe v1 already uses it; YAML parser + template engine choice deferred to Step 7.
- Bridge-level cap on `error.details` payload size (mentioned in RESPONSE_BUDGET.md risk register). Punted to Step 3 review.

## Running The Project Today

```bash
cd "/path/to/streetlight soundly"
npm install
npm run typecheck   # both packages
npm test            # 61 tests, all passing
npm run build       # writes dist/ in both packages
```

## Where Things Live

```
streetlight/
  docs/                                # all design docs (read PROGRESS.md first)
    RESPONSE_BUDGET.md                 # ← read before adding any new tool / scope
  packages/
    core/src/                          # kernel types and registry (Step 0)
      types.ts                         # ResponseBudgetMeta + SelectionState; "" convention in jsdoc
      errors.ts                        # RESPONSE_TOO_LARGE added 2026-06-27
    mcp-server/src/                    # MCP server + file queue (Step 1-2)
      transport/file-queue.ts
      transport/__tests__/fake-bridge.ts   # shared test harness
      tools/ping.ts
      tools/get-state.ts               # limit field + safeParse for PARAMS_INVALID
      index.ts                         # MCP get_state tool exposes optional limit
  reaper/                              # Lua bridge (Step 1-2)
    streetlight_bridge.lua             # response-budget backstop in read_selection
    packs/core/
      manifest.lua
      lib/json.lua
  recipes/                             # YAML workflow recipes
  examples/                            # MCP client config examples
```

## Picking Up From Here (for the next conversation)

1. **Read `docs/RESPONSE_BUDGET.md` first.** Everything in Step 3+ is bound by the shapes locked there. Most important section: § `call_template` — locked shape.
2. **Step 3 is the next step.** Specifics in `docs/IMPLEMENTATION_PLAN.md` § Step 3. New code areas: `call_template` MCP tool, `reaper/packs/core/templates/item.lua` (first template: `item_pitch`), `reaper/packs/core/refs.lua` (resolve `selected:N` + `guid:{...}`), `reaper/packs/core/undo.lua` (`with_undo` wrapper).
3. **Honor the locked call_template shape from day one.** `{ template, changed_count, changed_ids, truncated }`, IDs only, capped at 50. Do not let a single template return descriptors — fix it at the bridge dispatcher if needed.
4. **`name` / `track_name` empty-string convention is locked.** Don't change to optional/null in Step 3 schemas.
5. **Test harness pattern:** see `packages/mcp-server/src/tools/__tests__/get-state.test.ts` for how to stand up a fake bridge per test and assert on-wire params + response shape.

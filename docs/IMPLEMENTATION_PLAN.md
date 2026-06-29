# Streetlight Implementation Plan

This document explains exactly what needs to be built for the first working version.

For the broader kernel design, see [KERNEL_DESIGN.md](KERNEL_DESIGN.md).

## The Connection Model

Streetlight does not connect every agent to REAPER directly.

Instead:

```text
MCP-capable agent
  Codex / Claude Code / Cursor / other MCP clients
        |
        | MCP tool calls
        v
streetlight-mcp
        |
        | local command queue
        v
streetlight_bridge.lua running inside REAPER
        |
        v
REAPER project
```

Any client that can run an MCP server can use the same Streetlight tools. Clients that do not support MCP would need a separate adapter later.

## What We Need To Generate

The first implementation should create this repository shape:

```text
streetlight/
  package.json
  tsconfig.json
  README.md
  docs/
    ARCHITECTURE.md
    KERNEL_DESIGN.md
    MVP.md
    ROADMAP.md
    IMPLEMENTATION_PLAN.md
    INSTALL.md
    TEMPLATE_SPEC.md
    RENDER_NOTES.md
  packages/
    mcp-server/
      package.json
      src/
        index.ts
        tools/
          ping.ts
          get-state.ts
          list-templates.ts
          list-recipes.ts
          call-template.ts
        transport/
          file-queue.ts
        schemas/
          tools.ts
    core/
      package.json
      src/
        registry.ts
        risk.ts
        result.ts
        refs.ts
        queue.ts
        errors.ts
        types.ts
  reaper/
    streetlight_bridge.lua
    packs/
      core/
        manifest.lua
        templates/
          track.lua
          item.lua
          region.lua
          render.lua
        refs.lua
        undo.lua
  recipes/
    impact_variations.yaml
  examples/
    codex-config.example.toml
    claude-code.example.json
```

We do not need to fill every file perfectly on day one. The important first slice is a working round trip:

```text
agent calls ping -> MCP writes command -> REAPER bridge reads it -> bridge writes result -> MCP returns result
```

## Public Files

### `package.json`

Root package file.

Purpose:

- define workspace packages
- provide commands such as `dev`, `build`, and `typecheck`

### `packages/mcp-server`

The MCP server that agents run locally.

It exposes five tools:

- `ping`
- `get_state`
- `list_templates`
- `list_recipes`
- `call_template`

The MCP server should not know REAPER internals deeply. It validates inputs against schemas declared in `packages/core`, writes queue commands, waits for results, and returns structured output.

### `packages/core`

Shared kernel used by the MCP server and any future frontend.

It owns the registry, risk model, result shape, and reference parsing. Concretely:

- `registry.ts`: capability registry. Each template is registered with its Zod schemas, risk level, undoable/idempotent flags, and pack name. The registry produces the metadata that `list_templates` returns.
- `risk.ts`: risk-level enum (`read`, `write_safe`, `filesystem`, `destructive`, `unsafe_eval`) plus a client-configurable allow list.
- `result.ts`: the unified `{ ok: true, result: T } | { ok: false, error: {...} }` shape and helpers.
- `refs.ts`: parse and validate `selected:N`, `guid:{...}`, `last_result:item:N`, `track:Name/item:N`. Pure functions; reference resolution happens inside the bridge.
- `queue.ts`: queue command/result types and atomic write helpers.
- `errors.ts`: typed error codes (`ITEM_NOT_FOUND`, `TAKE_NOT_FOUND`, `OUTPUT_DIR_MISSING`, etc.).
- `types.ts`: shared TS types.

The kernel surface is intentionally small. Plan/apply, verification, and the `plan` MCP tool are deferred to v0.3; the types here should leave room for them without implementing them.

### `reaper/streetlight_bridge.lua`

The REAPER-side bridge.

It runs as a persistent ReaScript with `reaper.defer`.

Responsibilities:

- watch the queue folder at a bounded poll rate (default 10 Hz)
- read command JSON atomically (only files renamed from `*.tmp` to `*.json`)
- dispatch to the template registered by the loaded packs
- execute the template inside an undo block
- write result JSON atomically
- maintain the per-session `last_result` slot

### `reaper/packs/core/`

The first and only v0.1 capability pack.

The pack folder shape lands in v0.1 even though there is only one pack. Adding `packs/midi/`, `packs/fx/`, or `packs/mixing/` later should not require changes to the bridge dispatch code.

- `manifest.lua`: returns a table listing the pack's templates and their handlers
- `templates/*.lua`: handler implementations grouped by domain
- `refs.lua`: reference resolution helpers shared by the pack's templates
- `undo.lua`: undo-block wrapping helpers

### `recipes/impact_variations.yaml`

The first workflow recipe.

It is agent-readable documentation at first, not necessarily executable code.

### `examples/codex-config.example.toml`

Shows how to register Streetlight as an MCP server in Codex-style config.

Exact config can change by client, so examples should be clearly labeled as examples.

### `examples/claude-code.example.json`

Shows how to register Streetlight in Claude Code-style config.

Again, keep this as an example, not a promise that every client uses the exact same format.

## Runtime Files

Streetlight should create a local runtime folder outside the repo.

Recommended macOS path:

```text
~/Library/Application Support/Streetlight/
```

Inside:

```text
queue/
  pending/
  running/
  done/
  failed/
logs/
config.json
```

Command file:

```json
{
  "id": "cmd_20260627_001",
  "type": "template",
  "name": "ping",
  "params": {},
  "created_at": "2026-06-27T00:00:00.000Z"
}
```

Result file:

```json
{
  "id": "cmd_20260627_001",
  "ok": true,
  "result": {
    "bridge": "connected"
  }
}
```

## How Agents Connect

The agent never talks to REAPER directly.

It talks to `streetlight-mcp`.

Then `streetlight-mcp` talks to REAPER through the bridge.

### Codex

Codex runs the Streetlight MCP server as a local process.

Conceptually:

```toml
[mcp_servers.streetlight]
command = "node"
args = ["/path/to/streetlight/packages/mcp-server/dist/index.js"]
```

### Claude Code

Claude Code also runs the Streetlight MCP server as a local process.

Conceptually:

```json
{
  "mcpServers": {
    "streetlight": {
      "command": "node",
      "args": ["/path/to/streetlight/packages/mcp-server/dist/index.js"]
    }
  }
}
```

### Other Clients

Any MCP client that supports local stdio servers can use the same command.

If a client only supports HTTP MCP, add a Streamable HTTP server later without changing the REAPER bridge.

## Build Plan

Nine steps from zero to a shipped v0.1. Each step has a single concrete goal, an explicit acceptance test, and the pitfalls that tend to eat a day if not anticipated.

Do steps in order. Do not start step N+1 while step N's acceptance test still fails.

---

### Step 0: Repo Skeleton And Kernel Types

**Goal:** the type layer is in place so every later step has a place to land. No REAPER involved.

**Build:**

- monorepo with workspaces (npm or pnpm); pick one and stick with it
- TypeScript strict mode, target ES2022, NodeNext modules
- `packages/core` with `registry.ts`, `risk.ts`, `result.ts`, `refs.ts`, `queue.ts`, `errors.ts`, `types.ts`
- registry takes a Zod schema and produces JSON Schema via `zod-to-json-schema`
- refs parser handles `selected:N`, `guid:{...}`, `last_result:item:N`, `track:Name/item:N` and returns a tagged union
- `packages/mcp-server` with empty stub `src/index.ts` that just imports core
- root `package.json` with `dev`, `build`, `typecheck`, `test` scripts

**Acceptance:**

- `npm run typecheck` passes across both packages
- a unit test registers two dummy capabilities and `registry.list()` returns both with their JSON Schemas
- `refs.parse("selected:0")` returns `{ kind: "selected", index: 0 }`; `refs.parse("garbage")` throws a typed error
- `result.ok({...})` and `result.err("CODE", "msg")` produce the documented shape

**Pitfalls:**

- Over-engineering the registry into a DI container. Keep it a `Map<string, Capability>`.
- Forgetting that the registry data has to be serializable for `list_templates`. If a registration includes a function, it cannot leave the server.
- Picking a schema library other than Zod, then needing JSON Schema later. Zod has the cleanest path; do not change this without reason.
- Putting `plan` / `apply` types in v0.1. Leave them for v0.3.

---

### Step 1: First Round Trip — `ping`

**Goal:** an MCP client can talk to the MCP server which talks to a Lua bridge inside REAPER. Just `ping`. Nothing useful done, but every layer is wired.

**Build:**

- `packages/mcp-server/src/index.ts` using `@modelcontextprotocol/sdk` stdio transport
- `ping` tool registered; on call, write a command JSON to `queue/pending/`, poll `queue/done/` for the matching `id`, return the result
- atomic write: write to `cmd_NNN.json.tmp`, then rename to `cmd_NNN.json`
- queue folder resolution per-OS: macOS `~/Library/Application Support/Streetlight/queue`, Windows `%APPDATA%/Streetlight/queue`, Linux `~/.local/share/streetlight/queue`. Allow override via `STREETLIGHT_QUEUE_DIR` env var (huge time-saver for debugging).
- `streetlight_bridge.lua` with a `reaper.defer` loop at 10 Hz that scans `queue/pending/`, moves picked files to `queue/running/`, dispatches by `template` name, writes result to `queue/done/`
- queue processing order is FIFO by command ID. The MCP server may write multiple pending commands before the bridge picks them up — this is intentional and lets a recipe pipeline through without per-call MCP latency. No batching tool needed; the file queue IS the pipeline.
- ship a one-line `__startup.lua` loader so the bridge auto-starts with REAPER. Document this in `INSTALL.md` as the recommended path; the manual "Run script" approach stays as fallback for users who don't want auto-start.
- only one template implemented in Lua: `ping` returns `{ bridge: "connected", reaper_version: reaper.GetAppVersion() }`
- timeout in MCP server side: 5 seconds default for `ping`; on timeout return `BRIDGE_NOT_RUNNING` error

**Acceptance:**

- Register the server in Claude Code. Open REAPER, run `streetlight_bridge.lua`. Ask Claude `Can you ping Streetlight?` → returns `{ ok: true, result: { bridge: "connected", reaper_version: "7.x" } }` in under 1 second.
- Close REAPER, ask `ping` again → returns `{ ok: false, error: { code: "BRIDGE_NOT_RUNNING", recoverable: true } }` within 5 seconds. No hang.
- Run `ping` 20 times in a row → no duplicate command IDs, no orphan files in `pending/` or `running/`.

**Pitfalls:**

- File queue race: bridge picks up a half-written JSON. Fix: write to `.tmp` and rename. `fs.rename` is atomic on the same filesystem.
- Bridge polls too fast and burns CPU. Cap defer to 10 Hz (`reaper.defer` runs as fast as possible by default — gate by `os.clock()` delta).
- MCP server poll loop also burns CPU. Use a 50 ms interval with exponential backoff up to 200 ms.
- Bridge does not detect REAPER closing → next `ping` hangs. The MCP server timeout catches this, but log it clearly so the user knows to relaunch the Lua action.
- Queue dir does not exist on first run. MCP server should create it; bridge should also create it on startup (whichever runs first).
- Cross-platform path: `path.join` everywhere, never string concatenation.
- Lua `dofile` paths and the bridge's working directory. The bridge does not know where it lives unless you compute `script_path` from `debug.getinfo(1, "S").source`. Hard-code nothing.

---

### Step 2: Read Selection — `get_state`

**Goal:** the agent can see what is selected in REAPER. This unblocks every later step because the agent needs context.

**Build:**

- `get_state` MCP tool with `scope` param (default `selection`) and `limit` param (default 50, clamped to `[1, 200]`). v0.1 only implements `selection`; other scopes return `SCOPE_NOT_IMPLEMENTED`.
- Lua bridge handler enumerates `CountSelectedMediaItems(0)`, for each `GetSelectedMediaItem`:
  - GUID via `BR_GetMediaItemGUID` if SWS, else `GetSetMediaItemInfo_String(item, "GUID", "", false)` (REAPER 7+)
  - active take name via `GetTakeName(GetActiveTake(item))`
  - track name via `GetTrackName(GetMediaItemTrack(item))`
  - position via `GetMediaItemInfo_Value(item, "D_POSITION")`
  - length via `GetMediaItemInfo_Value(item, "D_LENGTH")`
- Response-budget backstop (read `docs/RESPONSE_BUDGET.md` first): bridge tracks encoded bytes per item, stops at the item boundary if the next item would push past 64 KiB, and returns `RESPONSE_TOO_LARGE` if even the first item exceeds the cap. Response includes `total`, `returned`, `truncated`, `response_bytes`.
- Returns `{ ok: true, result: { selection: { items: [...], total, returned, truncated, response_bytes } } }`

**Acceptance:**

- Empty selection → `{ ok: true, result: { selection: { items: [], total: 0, returned: 0, truncated: false, response_bytes: ... } } }`. Not an error.
- Three items selected → returns three entries with non-empty GUIDs; `total: 3, returned: 3, truncated: false`.
- Calling `get_state` twice in a row returns the same GUIDs for the same items.
- Selecting items with non-ASCII names (e.g. `テスト_01.wav`) → returns names correctly UTF-8 encoded, not mojibake.
- Calling `get_state` does not modify selection or any item state.
- With > `limit` items selected, `returned == limit < total` and `truncated: true`; subsequent items are simply absent. (No cursor in v0.1.)

**Pitfalls:**

- REAPER native GUID API requires a buffer-passing pattern. The correct call is `_, guid = reaper.GetSetMediaItemInfo_String(item, "GUID", "", false)`. Easy to typo.
- UTF-8 encoding: Lua string is bytes; JSON encoder must not re-encode. Pick a JSON lib that treats Lua strings as opaque bytes (`dkjson` with `encode_invalid` flag, or `rapidjson`).
- `GetActiveTake` returns nil for empty items. Guard against nil before calling `GetTakeName`.
- Selection at command-start vs at any later moment: snapshot via `GetSelectedMediaItem` once at the top of the handler. Do not re-query mid-handler.
- Empty name vs missing field: `name` and `track_name` are required `string`; unnamed objects come back as `""`, never `null` and never omitted. See `docs/RESPONSE_BUDGET.md` § Empty Strings vs Missing Fields.
- Truncation must happen at the **item boundary**, never by slicing the encoded JSON string. Mid-token cuts produce malformed responses.

---

### Step 3: First Mutation — `item_pitch`

**Goal:** the agent can change one thing in REAPER, undo it, and get a clean result back. This is where the bridge proves it can mutate safely.

**Build:**

- `call_template` MCP tool. Validates `name` against the registry. Validates `params` against the named template's Zod schema. Sends to bridge.
- Lua bridge: `call_template` dispatcher that looks up the template in `packs/core/manifest.lua`.
- `refs.lua`: resolve `selected:N` and `guid:{...}` only (other refs come in Step 4).
- `undo.lua`: `with_undo(label, flags, fn)` helper.
- `templates/item.lua` first entry: `item_pitch`. Resolves the item ref, finds active take, snapshots `D_PITCH`, sets new value, calls `UpdateArrange`, wraps in `Undo_BeginBlock` / `Undo_EndBlock2(0, "Streetlight: item_pitch", UNDO_STATE_ITEMS)`.
- Updates `last_result` with the modified item's GUID.

**Acceptance:**

- With one item selected, `call_template item_pitch { item_id: "selected:0", semitones: -3 }` returns `ok: true` with `result.items[0].pitch_before` and `pitch_after` distinguishable.
- The pitch change is visible in REAPER's item properties dialog.
- One `Cmd+Z` reverts the change cleanly.
- With no item selected, returns `{ ok: false, error: { code: "ITEM_NOT_FOUND", recoverable: true } }`.
- Item with no active take (empty MIDI item with no takes) returns `TAKE_NOT_FOUND`.
- `semitones: 100` is rejected at the MCP layer with a Zod validation error; the bridge never sees it.

**Pitfalls:**

- Item-pitch vs take-pitch confusion. The pitch property is on the take (`SetMediaItemTakeInfo_Value(take, "D_PITCH", semitones)`), not the item.
- Forgetting `UpdateArrange()` — pitch is set but UI does not show new values until the user clicks.
- Wrong undo flag. Use `UNDO_STATE_ITEMS` for item/take changes. `UNDO_STATE_ALL` is overkill and creates fat undo entries.
- Returning before `Undo_EndBlock` on error path. Wrap the whole template body in `pcall`; if it errors, still close the undo block (with a labeled rollback) before re-raising.
- last_result not reset on read-only commands. Reset only on successful mutating commands.
- **Response-budget contract** (lock now, enforce now — see `docs/RESPONSE_BUDGET.md` § `call_template`): `call_template` result is `{ template, changed_count, changed_ids, truncated }`. `changed_ids` is capped at 50 entries; if more items changed, `truncated: true` and the array contains the first 50 in mutation order. **Never** embed full `ItemDescriptor` objects in the result, even for single-item mutations. Agents needing post-state read `get_state` with the returned ids.

---

### Step 4: Variation Building Blocks

**Goal:** the bridge can build a multi-item arrangement on a track. This is the bulk of v0.1 in raw lines of code.

**Build (templates, in order of difficulty):**

1. `track_create` — `InsertTrackAtIndex`; if `reuse` and a track with `name` exists, return that one
2. `track_rename` — `GetSetMediaTrackInfo_String(track, "P_NAME", name, true)`
3. `media_import` — `InsertMedia(path, mode)`. **Gotcha**: `InsertMedia` adds to selected tracks. Solution: save current track selection, select target track, call, restore.
4. `item_duplicate` — copy item via `Main_OnCommand(41295)` then move to target, OR create new item + new take + set `PCM_Source` from source's source. Pick the second path: deterministic, no selection mutation.
5. `item_move` — `SetMediaItemInfo_Value(item, "D_POSITION", pos)` and reparent via `MoveMediaItemToTrack`
6. `item_rate` — `SetMediaItemTakeInfo_Value(take, "D_PLAYRATE", rate)`. Set `B_PPITCH` (preserve pitch) explicitly to `false` so rate changes pitch too (the typical "vinyl slowdown" behavior expected for variations).
7. `item_fade` — `SetMediaItemInfo_Value(item, "D_FADEINLEN", x)` and `D_FADEOUTLEN`
8. `item_trim` — `SetMediaItemInfo_Value(item, "D_LENGTH", len)`; for start offset: `SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", offset)`

**Cut from v0.1:** `item_reverse`. REAPER has no clean take-level reverse API, and `Main_OnCommand(41051)` writes a new audio file to disk — which forces the template to be `filesystem`-risk for an item-level op. Deep pitch + slow rate + long fade-in is a close enough substitute for the demo. Revisit in v0.2 with a proper design.

**Build (refs):**

- Add `last_result:item:N` resolution. The bridge maintains an in-memory table reset on each successful mutating command. The table is `{ items: [guid...], regions: [guid_or_index...] }`. (Step 3 already updates `LAST_RESULT.items` on success; this step adds the read side in `reaper/packs/core/refs.lua`.)
- Add `track:Name/item:N` resolution.

**Build (Lua JSON null fix — carried over from Step 3 Open Questions):**

- `reaper/packs/core/lib/json.lua` currently decodes JSON `null` as Lua `nil`, which silently disappears from objects and array elements. Step 3 templates have no nullable params so this was OK; `item_fade` is the first to need it. Tri-state semantics shipped in Step 4c (locked): **absent → leave unchanged, explicit `null` → clear to 0, number ≥ 0 → set that length**. Fix: introduce a sentinel value (`json.null` table) so callers can distinguish "key absent" from "key present with null", and document the convention in `TEMPLATE_SPEC.md`. Update existing get_state encoder to keep emitting empty strings (not nulls) per the locked `name`/`track_name` contract.

**Acceptance:**

- A scripted test (TS) calls these templates in sequence to produce 8 named items on a new track. Manual inspection in REAPER shows: track named correctly, 8 items present, each at a distinct position, named `var_01`..`var_08`, pitch/rate/fade values match request.
- Calling `item_duplicate` with `item_id: "selected:0"` then `item_id: "last_result:item:0"` references the duplicate, not the original.
- One `Cmd+Z` undoes the **most recent** template only. The user can step back through all 8 variation creations one undo per step. (Optional: an MCP-level batch could collapse to one undo, but v0.1 does not include batching.)
- `media_import` does not leave the user with the wrong track selected after the call.

**Pitfalls:**

- `InsertMedia` mode flags. Mode 0 = "Add to current track", 1 = "Add to new track", 3 = "Add to current track stretched to time selection". Pick `0` and manage track selection manually.
- Duplicating via clipboard-like actions leaks state. Do it manually: `AddMediaItemToTrack`, `AddTakeToMediaItem`, `GetMediaItemTake_Source`, `SetMediaItemTake_Source`.
- `D_STARTOFFS` is in source-media seconds, not project seconds. Easy to mix up.
- Take rate vs pitch interaction. If `B_PPITCH=true`, changing rate keeps pitch. If `false`, changing rate changes pitch. Pick `false` for v0.1; mention it in the template metadata.
- last_result not handling out-of-order tools. If the agent calls `get_state` between two mutations, last_result is still the previous mutation's. Confirm this works correctly.

---

### Step 5: Regions

**Goal:** the bridge can wrap each variation in a named region, so render has something to bound on.

**Build:**

- `region_create` template. `AddProjectMarker2(0, true, start, end, name, -1)` (last arg is desired index; -1 = auto).
- If `item_id` is given, derive `start` and `end` from item position and length (include fades by default — render needs the audible tail).
- Track a stable region identifier. **Note:** `AddProjectMarker2` returns an index, but indices are not stable when other markers are deleted. Use the region's **name** as the user-facing reference for v0.1, with a uniqueness check. If a region with the same name exists, error with `REGION_NAME_TAKEN` (do not silently overwrite).
- Add `region:Name` reference type.

**Acceptance:**

- After Step 4 produces 8 variations, calling `region_create` 8 times with names `var_01`..`var_08` produces 8 visible regions in REAPER's timeline.
- `last_result:region:N` resolves to the most recently created regions.
- Calling `region_create` with a duplicate name returns `REGION_NAME_TAKEN` and does not create a marker.
- Region bounds match item position to item position + length (including fade out).
- Cmd+Z removes each region cleanly.

**Pitfalls:**

- Region indices renumber as soon as anything is deleted. Do not store them.
- `AddProjectMarker2` returns the desired index or a new one. Read the return value; do not assume your index was honored.
- Fade out duration is in addition to `D_LENGTH`? No — fades are within the item's length. So region = `[position, position + length]` is correct without adding fade out.
- Region name with `/` or `\` will break file names in Step 6. Reject path separators in `region_create` rather than at render time.
- **Response-budget contract** (see `docs/RESPONSE_BUDGET.md`): `region_create` follows the `call_template` shape — returns `{ template, changed_count, changed_ids, truncated }` with `changed_ids` capped at 50. A future `region_list` would inherit `get_state`'s shape (`limit`, item-boundary truncation, `RESPONSE_TOO_LARGE`).

---

### Step 6: Render

**Goal:** one MCP call writes one WAV file to disk. This is the demo's payoff.

This step is large. Read `docs/RENDER_NOTES.md` end-to-end before starting.

**Build:**

- `render_region` template per the spec in `RENDER_NOTES.md`:
  - snapshot all 8 render settings
  - set `RENDER_BOUNDSFLAG=0` (custom time), `RENDER_STARTPOS` and `RENDER_ENDPOS` from the region
  - set `RENDER_FILE`, `RENDER_PATTERN="$region"`, `RENDER_FORMAT` to hardcoded WAV-24
  - call `Main_OnCommand(42230, 0)`
  - poll for file at `output_dir/region_name.wav` with size > 0 and stable for one tick
  - restore settings inside `pcall`
- Validate `output_dir` exists and is writable BEFORE touching render settings. Write a `.streetlight_probe` file, delete it. If this fails, return `OUTPUT_DIR_NOT_WRITABLE` and never call render.
- Async-friendly: the template returns a sentinel `{ state: "rendering", deadline: ... }` and the bridge re-checks the file on each defer tick. Once detected, it writes the final result. This means `call_template` MCP-side polling needs to handle "still working" responses — extend the timeout to 60 s for render only.

**Important — bridge-internal state vs agent-facing result:** the `{ state: "rendering" }` sentinel is **bridge-internal**. The MCP server polls until the bridge writes a real result, then returns the standard 2-state `Result<T>` to the agent. The agent NEVER sees a "rendering" status. This is why `Result<T>` in `packages/core/src/result.ts` does not need a third variant — the asynchrony is hidden inside the transport layer.

**Acceptance:**

- One `render_region` call with a valid region and a writable `output_dir` writes one WAV file at the expected path within 30 s on typical hardware. Returns `{ ok: true, result: { paths: ["..."], format: "wav", sample_rate: ..., bit_depth: 24 } }`.
- Render settings in REAPER's render dialog are exactly the same after the call as before. (The acceptance test in `RENDER_NOTES.md` covers this.)
- Calling `render_region` with `output_dir="/dev/null/nope"` returns `OUTPUT_DIR_NOT_WRITABLE` and does NOT modify render settings.
- Calling `render_region` for a non-existent region returns `REGION_NOT_FOUND`.
- Killing REAPER mid-render: next MCP call returns `BRIDGE_NOT_RUNNING` cleanly; no zombie `.tmp` files in `output_dir`.

**Pitfalls:**

- The entire failure mode catalog from `RENDER_NOTES.md`. Do not skip reading it.
- Render settings restore must run in `pcall`. If render Lua throws, settings still need to be restored.
- "Render in background" preference makes `42230` return immediately. Always poll the file system for completion; never trust the action return code.
- Filename collision: if `var_01.wav` already exists in `output_dir`, REAPER will silently overwrite or auto-rename depending on a preference. Decide policy now: v0.1 fails fast with `OUTPUT_FILE_EXISTS` rather than overwriting user files.
- Region name with non-ASCII characters in the render pattern: tested on macOS path encoding; Windows long paths require `\\?\` prefix for >260 chars (skip this for v0.1; document as Windows limitation).
- Total render time across 8 regions × ~5 s each = 40 s. The bridge defer loop must remain responsive — do not block on `os.execute("sleep ...")`. Use defer-driven polling.

---

### Step 7: Recipe Discovery And Impact Variations End-To-End

**Goal:** an agent reads the recipe, executes it step by step, and produces 8 named files. This is the demo.

**Build:**

- `list_recipes` MCP tool. Reads `recipes/*.yaml` at startup (or on demand), parses with a small YAML lib, returns the recipe metadata.
- Finalize `recipes/impact_variations.yaml` to match the actual templates and parameter schemas.
- Add a top-level README section: "How to run the demo" — exact prompt to give the agent.
- The agent (Claude Code or Codex) is given the recipe via `list_recipes` and is responsible for orchestrating: `get_state` → `track_create` → loop over 8 variations → `region_create` → `render_region` → report.

**Acceptance:**

- From a fresh REAPER session with one item selected, the prompt `Use Streetlight to make 8 impact variations from this item and render them to ~/Desktop/impacts.` produces:
  - one new track named `Streetlight - Impact Variations`
  - 8 items on that track with `var_01`..`var_08` names
  - 8 regions wrapping those items
  - 8 WAV files in `~/Desktop/impacts/`
  - a final agent message listing all 8 paths and the parameters used per variation
- The whole flow completes in under 3 minutes on typical hardware.
- `Cmd+Z` walks back the changes (one undo step per template; ~30 undo steps total to fully revert).
- The output WAVs sound noticeably different from each other (manual ear check).

**Pitfalls:**

- The agent does not have the recipe in context unless `list_recipes` is called. Make this clear in the README's demo instructions.
- Round-trip count: 8 × 4 ≈ 32 MCP calls. Each is ~100–500 ms over file queue. Total: 5–30 s of pure transport. This is acceptable for v0.1 but motivates the v0.2 socket transport — note it in the demo notes.
- YAML parsing failure on the recipe should not crash the MCP server. Wrap in try/catch and skip invalid recipes with a warning.
- The recipe's `variation_seed` block is data, not steps. The agent has to understand to iterate over it. Reword the recipe so this is obvious to the LLM (use clear step language).

---

### Step 8: Cross-Platform Verification And Release Polish

**Goal:** someone who has never seen the repo can install it and run the demo on macOS or Windows from `INSTALL.md` alone.

**Build:**

- Verify install on a clean macOS user (or VM): Node 20+, no SWS, no ReaPack, REAPER 7.x
- Verify install on a clean Windows user: Node 20+, REAPER 7.x. Pay attention to:
  - queue dir path under `%APPDATA%`
  - PowerShell vs cmd.exe in `INSTALL.md` snippets
  - REAPER action installation (drag/drop vs Actions menu)
- **Fix Linux queue-dir mismatch** (carried over from Step 3 Open Questions): TS defaults to `~/.local/share/streetlight/queue`; the Lua bridge's `get_queue_dir()` in `reaper/streetlight_bridge.lua` has no Linux branch and falls through to the macOS path. Either add the Linux branch in Lua or document a hard `STREETLIGHT_QUEUE_DIR=` requirement for Linux users.
- Cross-platform tests of: queue file atomic rename (works on NTFS), JSON UTF-8 encoding, render output path with spaces
- Error message audit: every error code in `errors.ts` has a message a human can understand without reading source
- `README.md` rewrite for users (not contributors): one-paragraph "what is this", install link, demo prompt, gif if possible
- Tag `v0.1.0`, write release notes

**Acceptance:**

- A first-time user with REAPER and Node installed follows `INSTALL.md` and runs the demo successfully on first attempt. Time from `git clone` to first WAV: under 15 minutes.
- All MCP tool errors return messages that an LLM agent can recover from without source code access.
- The `package.json` `dependencies` list contains only: an MCP SDK, Zod, and `zod-to-json-schema`. Anything else needs justification.
- License chosen and added.

**Pitfalls:**

- Windows path separators in queue files. Stick to forward slashes inside JSON; convert at the Lua/Node boundary.
- REAPER 6 vs 7 API differences. Pin to REAPER 7+ in `INSTALL.md` and `ping` response checks the version.
- `INSTALL.md` claims a feature that doesn't exist anymore. Re-read it line by line against the actual build.
- License decision delays release. Default to MIT unless there's a reason not to.

---

## Final Acceptance — When Is v0.1 Done

v0.1 is shippable when **all** of the following are true:

1. Steps 0–8 acceptance tests pass.
2. The demo prompt produces 8 WAVs end-to-end on a clean macOS install and a clean Windows install.
3. The five MCP tools (`ping`, `get_state`, `list_templates`, `list_recipes`, `call_template`) return well-formed responses for every documented input and every documented error.
4. Every mutating template creates an undo point with a `Streetlight: <name>` label.
5. `unsafe_eval` is not exposed.
6. Render settings are unchanged after `render_region` (the canonical save/restore test).
7. The repo passes `npm run typecheck`, `npm run test`, and `npm run build` with zero warnings.
8. `INSTALL.md` is verified by someone who did not write it.
9. Closing REAPER mid-operation yields clean errors from the next MCP call, not hangs.
10. Tagged `v0.1.0` with release notes naming the one demo it supports.

If any of these is false, v0.1 is not done. Resist the urge to ship with caveats.

## What v0.1 Is Explicitly Not

To keep the bar honest, v0.1 does NOT need:

- a `plan` / `apply` tool (v0.3)
- verification of post-execution state (v0.3)
- socket transport (v0.2)
- batched template calls (v0.2)
- recipes other than `impact_variations` (v0.2)
- non-WAV render formats (v0.2)
- a desktop UI (no planned version)
- semantic asset search (v0.4+)

Saying no to these in v0.1 is what makes the core small enough to finish.

## Minimal Tool Schemas

### `ping`

Input:

```json
{}
```

Output:

```json
{
  "ok": true,
  "result": {
    "bridge": "connected",
    "reaper_version": "7.x"
  }
}
```

### `get_state`

Input:

```json
{
  "scope": "selection",
  "limit": 50
}
```

Output:

```json
{
  "ok": true,
  "result": {
    "selection": {
      "items": [],
      "total": 0,
      "returned": 0,
      "truncated": false,
      "response_bytes": 0
    }
  }
}
```

See `docs/RESPONSE_BUDGET.md` for why these four meta fields are mandatory and what `truncated: true` means.

### `list_templates`

Input:

```json
{}
```

Output:

```json
{
  "ok": true,
  "result": {
    "templates": []
  }
}
```

### `call_template`

Input:

```json
{
  "name": "item_pitch",
  "params": {
    "item_id": "selected:0",
    "semitones": -3
  }
}
```

Output:

```json
{
  "ok": true,
  "result": {
    "template": "item_pitch",
    "changed_count": 1,
    "changed_ids": ["guid:{...}"],
    "truncated": false
  }
}
```

The result NEVER embeds full `ItemDescriptor` objects. See `docs/RESPONSE_BUDGET.md` § `call_template` for the lock-in.

## Important Technical Choices

### Use MCP As The Agent Contract

This is what makes Streetlight agent-neutral.

### Use File Queue First

This keeps the REAPER bridge zero-dependency.

Socket/HTTP transport can come later.

### Keep Raw Eval Out Of The MVP

The MVP should prove safe templates, not arbitrary Lua execution.

### Keep Recipes Outside The Tool Surface First

Recipes can be Markdown/YAML instructions that agents follow. Promote them to tools later.

## The One-Sentence Engineering Goal

Build the smallest local bridge where an MCP client can safely ask REAPER: "what is selected?", "make variations", and "render them".

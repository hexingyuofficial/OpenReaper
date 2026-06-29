# Render Notes

`render_region` is the highest-risk template in v0.1. This document spells out the ReaScript mechanics so the implementer does not discover them at the last minute.

If render does not work reliably, the MVP demo does not work. Treat this as the longest single task in Step 6.

> **2026-06-29 amendment.** Step 6 lands `render_region` in code; the live
> REAPER smoke is the next gate. Three deviations from the original text
> below were locked during design and apply across the implementation:
>
> 1. **Snapshot/restore covers TEN keys, not eight.** `RENDER_STARTPOS`
>    and `RENDER_ENDPOS` are added because we use `RENDER_BOUNDSFLAG = 0`
>    (custom time bounds). Without snapshotting them we'd leak our
>    per-render bounds into the user's render dialog.
> 2. **`RENDER_PATTERN` is the literal region name, not `"$region"`.**
>    With `BOUNDSFLAG = 0` (custom time, not project regions),
>    `$region`'s expansion is not guaranteed. We already have the
>    resolved name in hand at render time; using it literally makes the
>    output filename deterministic (`<output_dir>/<region_name>.wav`).
>    The smoke recipe asserts the exact filename.
> 3. **Two deadlines, not one.** The MCP-side wire timeout is 60_000 ms
>    (`RENDER_REGION_TIMEOUT_MS` in `render-region.ts`). The bridge's
>    internal `RENDER_INTERNAL_DEADLINE_S = 55` s sits 5 s underneath so
>    `RENDER_TIMEOUT` surfaces with its typed code before the MCP-side
>    budget trips `BRIDGE_NOT_RUNNING`. Don't sync them — the gap is
>    load-bearing.
>
> The deferred-completion machinery used by `render_region` lives in
> `streetlight_bridge.lua` § "Deferred-completion slot" — single slot,
> bridge-internal, agent sees only the normal `Result` envelope.

## Why Render Is Hard

REAPER's render system is configured through **global, sticky project settings**, not per-call arguments. A render template must:

1. snapshot the current render settings
2. set new ones
3. trigger the render action
4. wait for completion
5. restore the original settings
6. report the output paths

If step 5 is skipped, the user's project state is silently mutated. That violates the kernel's "no surprise side effects" rule.

## The Render Settings That Matter

All accessed via `reaper.GetSetProjectInfo` and `reaper.GetSetProjectInfo_String`:

| Key | Type | Meaning | Recommended Default |
|---|---|---|---|
| `RENDER_BOUNDSFLAG` | int | what to render: 0 custom, 1 entire project, 2 time selection, 3 project regions, 4 selected items | `3` (project regions) |
| `RENDER_SRATE` | int | sample rate, 0 = project rate | `0` |
| `RENDER_CHANNELS` | int | 1 mono, 2 stereo | `2` |
| `RENDER_FILE` | string | output directory | from `params.output_dir` |
| `RENDER_PATTERN` | string | filename pattern using REAPER tokens | `$region` |
| `RENDER_FORMAT` | string | binary blob describing format | precomputed WAV-24 blob |
| `RENDER_TAILFLAG` | int | which bounds include render tail | `0` |
| `RENDER_ADDTOPROJ` | int | re-import after render | `0` |

`RENDER_FORMAT` is a base64-ish blob, not a friendly string. For v0.1 hardcode WAV-24-bit. Other formats wait for v0.2.

## Region Selection For Render

There is no `RENDER_REGION_IDS` field. To render specific regions, you set `RENDER_BOUNDSFLAG=3` and then control which regions render via the **render matrix** (per-track) OR by setting the project region render filter. In practice the simplest path is:

1. Enumerate regions, find the ones with matching GUIDs (or names) from the request
2. Use the render queue with one queued render per region using `RENDER_BOUNDSFLAG=0` and explicit `RENDER_STARTPOS` / `RENDER_ENDPOS`
3. OR: render all regions, then filter result files by name

For v0.1, **render one region at a time** with bounds set to that region's start/end. Slower than batch, but each render is isolated and easier to verify.

## Triggering The Render

Two paths:

### Direct render (preferred for v0.1)

```lua
reaper.Main_OnCommand(42230, 0)  -- File: Render project, using the most recent render settings
```

This is **mostly synchronous**: returns after writing files for simple cases. For long renders it can still block REAPER's main thread, which is acceptable in v0.1 since the bridge is single-threaded anyway.

Avoid `41824` ("Render project, using the most recent render settings, auto-close render dialog") in older REAPER versions — behavior varies.

### Render queue (deferred)

```lua
reaper.Main_OnCommand(41823, 0)  -- File: Add to render queue
```

Adds to queue, requires user to manually trigger queue render. Do **not** use in v0.1.

## Detecting Completion

`Main_OnCommand(42230, 0)` returns after the render finishes for in-process renders. But:

- if "render in background" is enabled in REAPER preferences, control returns immediately
- file may still be being written when the call returns

The safe pattern:

```lua
local expected_path = output_dir .. "/" .. region_name .. ".wav"
reaper.Main_OnCommand(42230, 0)
-- poll for file existence and stable size
local deadline = os.time() + 30
while os.time() < deadline do
  local f = io.open(expected_path, "rb")
  if f then
    local size = f:seek("end")
    f:close()
    -- check size again 100ms later; if equal, render is done
    -- (defer-loop friendly version: schedule a second check on next tick)
  end
end
```

In the bridge defer loop, **do not busy-wait**. Mark the command as `state: rendering` and re-check on subsequent defer ticks. The render template should yield, not block.

## Filename Patterns

`RENDER_PATTERN = "$region"` writes `region_name.wav`. Other useful tokens:

- `$project` — project name
- `$region` — current region name
- `$regionnumber` — region index
- `$track` — first track in render

Region names containing `/`, `\`, `:` will produce invalid paths on Windows. Sanitize region names before they are used as filenames. The template should reject region names containing path separators with a clear error.

## Settings Save/Restore Pattern

```lua
local function snapshot()
  return {
    bounds  = reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0, false),
    srate   = reaper.GetSetProjectInfo(0, "RENDER_SRATE", 0, false),
    chans   = reaper.GetSetProjectInfo(0, "RENDER_CHANNELS", 0, false),
    file    = select(2, reaper.GetSetProjectInfo_String(0, "RENDER_FILE", "", false)),
    pattern = select(2, reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", false)),
    format  = select(2, reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "", false)),
    tail    = reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG", 0, false),
    addproj = reaper.GetSetProjectInfo(0, "RENDER_ADDTOPROJ", 0, false),
  }
end

local function restore(s)
  reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", s.bounds, true)
  reaper.GetSetProjectInfo(0, "RENDER_SRATE", s.srate, true)
  reaper.GetSetProjectInfo(0, "RENDER_CHANNELS", s.chans, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FILE", s.file, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", s.pattern, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", s.format, true)
  reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG", s.tail, true)
  reaper.GetSetProjectInfo(0, "RENDER_ADDTOPROJ", s.addproj, true)
end
```

Wrap every render call in `snapshot` / `restore` even if the render fails. Use `pcall` so a Lua error does not leak settings.

## Errors To Return

| Code | Trigger |
|---|---|
| `OUTPUT_DIR_MISSING` | `output_dir` does not exist (do not auto-create in v0.1) |
| `OUTPUT_DIR_NOT_WRITABLE` | dir exists but writing the test file fails |
| `REGION_NOT_FOUND` | `region_id` does not resolve |
| `REGION_NAME_INVALID` | region name contains path separators or null bytes |
| `RENDER_TIMEOUT` | file did not appear within the deadline (default 60s) |
| `RENDER_FILE_EMPTY` | file appeared but size is 0 after settled |

All errors restore render settings before returning.

## What v0.1 Explicitly Does Not Do

- multi-format render (only WAV-24)
- render queue
- render matrix per-track configuration
- region rendering with tail
- normalize on render
- post-render imports

These wait for v0.2 once the basic path is proven.

## Acceptance Test

Manually verify before declaring Step 6 done:

1. Set REAPER project render settings to something distinctive (e.g. MP3, mono, 22050 Hz, custom path).
2. Run `render_region` for one region with `output_dir=~/Desktop/test`.
3. Verify the WAV lands in `~/Desktop/test` at 24-bit stereo at project rate.
4. Reopen the project render dialog and confirm settings are back to MP3 / mono / 22050 / custom path.

If step 4 fails, save/restore is broken.

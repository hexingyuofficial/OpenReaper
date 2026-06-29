# Handoff — 2026-06-29 (Step 7 ✅; Step 8 Round A + C ✅; release-prep setup/launcher ✅; v0.1 release-candidate ready)

Short, dense. Read this first. Long-form log is in `docs/PROGRESS.md`.

## Where the project is

- Path: `/Users/Zhuanz/Documents/steetlight soundly`, git repo on
  branch `main`. Local checkpoint `166d109` contains the Step 3 →
  Step 8 Round A/C release-candidate pile. The current working tree
  is the release-prep setup/launcher round (`scripts/setup.mjs`,
  setup tests, INSTALL/CROSS_MAC_SMOKE/README/HANDOFF/PROGRESS
  updates, `.gitignore` protection for `setup-out/` and
  `style-memory-mcp/`). The user manages versioning out-of-band —
  do NOT commit, branch, push, or reset without an explicit ask.
  Read `git log` / `git status` if you need history context; treat
  the working tree as theirs to commit.
- `npm test` → **198/198 green** (164 Step-7-close baseline + 7 Round
  A: 2 risk-policy enforce, 1 file-queue non-ENOENT wrap, 4 done/
  orphan sweep; + 27 release-prep setup tests for
  `scripts/setup.mjs`). `npm run build` → clean.
- **Steps 4, 5, 6, 7 fully ✅** — see prior PROGRESS for details.
  Bridge is single-owner after `dofile` reload (generation guard
  from Step 6 mid-smoke fix #2 + Step 7 B4 startup
  stale-`RUNNING/` cleanup writing typed INTERNAL_ERROR done
  envelopes for orphans).
- **Step 7 ✅ verified live (2026-06-29).** 8-item end-to-end demo
  ran clean on REAPER 7.71/macOS-arm64 into
  `~/Desktop/streetlight-step7-resmoke-1782704645367`: 8 WAVs
  (24-bit PCM stereo 48 kHz), zero `.wav.RPP` / `.wav.RPP-bak`
  sidecars, `changed_ids` WAV-only. Focused preflight side-quest
  confirmed: a hand-touched `<wav>.RPP` triggers typed
  `OUTPUT_FILE_EXISTS` with the colliding path in the message and
  the user file untouched.
- **Step 8 Round A ✅ (2026-06-29 same window, no live REAPER needed).**
  Three v0.1 release-blockers from the six open notes closed in 4
  files:
  - `packages/mcp-server/src/tools/call-template.ts` — `RiskPolicy`
    becomes 5th defaulted param; `RISK_BLOCKED` gate inserted between
    `registry.get` and `params.safeParse` (order verified by test
    passing junk params + asserting `RISK_BLOCKED`, not
    `PARAMS_INVALID`). `defaultPolicy()` only in v0.1; env-var
    override deferred to v0.2 (locked decision #10).
  - `packages/mcp-server/src/transport/file-queue.ts` — (a)
    `pollForResult` wraps `readIfExists` so non-ENOENT errors surface
    as `INTERNAL_ERROR (recoverable: false)` instead of rejecting out
    of `client.send` (honors class JSDoc); (b) `init()` awaits a new
    `sweepDoneOrphans()` that unlinks `done/<id>.json` older than 24h
    mtime, best-effort, three-layer try/catch (readdir/stat/unlink),
    only touches `done/`, leaves subdirs and non-files alone, never
    rejects init.
  - Tests: +2 in `tools/__tests__/call-template.test.ts` (risk gate
    blocks under default policy, explicit policy lets it through);
    +1 in `transport/__tests__/file-queue.test.ts` (non-ENOENT wrap
    test rmdir+writeFile-replaces `done/` so readFile throws ENOTDIR);
    +4 in a new `FileQueueClient done/ orphan sweep` describe
    (fresh kept / old removed / subdirs untouched / unreadable done/
    still resolves init / custom threshold honored).
- **Step 8 Round B deferred to v0.2.** Linux queue-dir resolver fix
  (Lua falls through to macOS path) explicitly NOT done this cycle —
  no live Linux REAPER rig to verify. INSTALL.md env-var workaround
  remains the supported v0.1 Linux path.
- **Step 8 Round C ✅ (2026-06-29 same window, docs-only).** Three
  Round-C items closed:
  - **README sidecar wording** fixed at `README.md:85-96` — the stale
    "v0.1 cannot suppress … on every build" hedge replaced with the
    live "guarded cleanup contract" framing (preflight
    no-clobber for `.wav` / `.wav.RPP` / `.wav.RPP-bak` →
    `OUTPUT_FILE_EXISTS`, post-render `os.remove` of any auto-written
    sidecar). PROGRESS.md pointer for the config-var post-mortem.
  - **Foreground-render docs audit** — verdict: existing coverage
    (README prereq #2 + INSTALL §"Render in background" + B2 rationale
    + troubleshooting cross-ref) is complete on the current contract.
    Closed the only forward-look gap with two one-liners: a v0.2
    pointer at the end of INSTALL.md's "Render in background" section
    and a matching ROADMAP.md v0.2 entry ("foreground-render support
    via chunked-tick render loop"). NO detection code per the
    explicit B2 docs-only decision.
  - **Vitest/Vite/esbuild upgrade evaluation** — verdict: **defer
    until post-v0.1**. `npm audit` reports 5 dev-only vulns (3 mod, 1
    high, 1 crit) chained from `vitest@^2.1.0` → `vite` / `esbuild` /
    `@vitest/mocker` / `vite-node`. **Effective exposure: zero** — the
    critical (vitest UI server arbitrary file read+exec) only fires
    under `vitest --ui` (repo uses `vitest run`); the high
    (vite `server.fs.deny` bypass) requires Windows dev-server (repo
    is macOS, test-mode only); moderates all require dev-server /
    `esbuild --serve` / Windows. `npm audit --omit=dev` clean — what
    ships to users is unaffected. Fix path is a two-major jump
    (`vitest@2 → 4.1.9`, skips 3) via `npm audit fix --force`; needs a
    dedicated window for migration, not bolted onto release polish.
    Re-run when we adopt vitest UI or anything else expands the
    real-world surface.
- **Release-prep setup/launcher ✅ (2026-06-29 same window, manual gate
  passed live on this Mac).** Goal: another Mac (or this one after a
  fresh clone) should reach `bridge ready` without hand-writing a single
  absolute path.
  - **`scripts/setup.mjs`** (new, plain Node ESM — no TS build step).
    Pure exports: `buildLauncherLua`, `buildClaudeCodeConfig`,
    `buildCodexConfig`, `buildCursorConfig`, `parseRenderInBackground`,
    `defaultReaperResourcePath`, `launcherInstallPath`, `reaperIniPath`,
    `mcpServerEntryPath`. CLI wraps them with file I/O + `darwin`-only
    fail-fast, `dist/index.js` existence check, `--no-overwrite` and
    `--reaper-resource-path <p>` flags, read-only `reaper.ini` probe.
    Writes only to (a) the REAPER launcher path and (b) `setup-out/`
    in the repo — NEVER user-global MCP configs.
  - **REAPER launcher** at
    `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`.
    Tiny wrapper: AUTO-GENERATED header documenting the one-time
    `Actions → Show action list → ReaScript: Load...` registration
    (REAPER does NOT auto-discover scripts dropped into Scripts/);
    repo-absolute path baked in; guarded `io.open` so a missing/moved
    repo prints a friendly error instead of stack-tracing.
  - **MCP client config artifacts** at `setup-out/`:
    `claude-code.json` / `codex-config.toml` / `cursor.json`. Each has
    the absolute dist path baked in. User copies into their own MCP
    client config — setup never merges into user-global files (merge
    risk on Codex/Claude Desktop/Cursor configs with other servers is
    not worth the saved copy-paste).
  - **`reaper.ini` probe.** Read-only; parses the `[reaper]` section's
    `workrender` key; any non-zero → ON (bitfield-tolerant — this
    Mac's value is `8209`, a bitfield, would have falsely read OFF on
    strict `==1`). Returns `unknown` if section/key absent or input
    not a string. NEVER writes to `reaper.ini`. Step 7 B2 docs-only
    decision stays — setup just surfaces the verdict in the next-steps
    block.
  - **Tests:** 27 new in `scripts/__tests__/setup.test.mjs`, all
    pure-function (no writes to `~/Library`). Test bar: 171 → 198.
  - **Wiring:** `vitest.config.ts` `include` adds
    `scripts/**/*.test.mjs`; `package.json` adds `"setup": "node
    scripts/setup.mjs"`. `.gitignore` adds `setup-out/` so each
    clone's personalized configs never get committed.
  - **Docs flipped to setup flow:** `docs/INSTALL.md` — new "Install
    Step 2: Quick Setup" leads, old Layout A/B demoted to
    "2 (advanced). Manual REAPER Bridge install" with note about
    removing any prior `__startup.lua` dofile to avoid double-load
    noise; §3 client config gained `setup-out/` pointer.
    `docs/CROSS_MAC_SMOKE.md` — §3-5 collapsed into setup + Load... +
    Run; renumbered 1-8; baseline 171 → 198. `README.md` — first-time
    install one-liner in How To Run prereqs.
  - **Manual gate (this Mac, 2026-06-29):** `npm run setup` →
    launcher landed, three setup-out artifacts written, Render-in-
    background detected `✓ ON` (matches actual `workrender=8209`).
    REAPER `Actions → Show action list → ReaScript: Load...` →
    `start_bridge.lua` → Run → console printed
    `bridge ready (generation 1) — templates: …` — templates list
    populated, bridge alive. Cross-Mac flow is exercised end-to-end
    on this Mac; second-Mac smoke per `docs/CROSS_MAC_SMOKE.md` is
    the next gate.
- **Step 7 code shape (final):**
  - `list_templates` + `list_recipes` MCP tools.
    `js-yaml@^4.1.0` in `@streetlight/mcp-server` deps only.
    Recipe envelope schema passthrough-only (A5);
    `STREETLIGHT_RECIPES_DIR` env override (A3 re-read every call,
    no startup cache); bad YAML → `result.warnings[]` (A4).
  - `recipes/impact_variations.yaml` final: `track_create` uses
    `reuse_existing: true`; `for_each` loop sources from the bound
    `selection.selection.items[0].id` (initial-selection GUID,
    drift-proof). Trailing note + README prereq #5 require the
    agent to abort before mutating if `selection.items.length !== 1`.
  - `reaper/packs/core/lib/names.lua` (Step 7 B1) — single source of
    truth for forbidden region-name set (`/ \ NUL $`). Used by
    `region.lua` create-time AND `render.lua` post-`resolve_region`.
  - `reaper/packs/core/templates/render.lua` — 10-key
    snapshot/restore; preflight `check_no_collision` refuses
    pre-existing `<wav>` AND `<wav>.RPP` AND `<wav>.RPP-bak` with
    typed `OUTPUT_FILE_EXISTS`; `recheck` success branch deletes
    auto-generated sidecars via `os.remove` BEFORE `restore_once`,
    `os.remove` failure raises typed `INTERNAL_ERROR` (bridge's
    `tick_deferred` pcalls `recheck`, so the raise lands as a clean
    wire envelope). `changed_ids` is the WAV artifact path only.
    File-stability lifted 2 → 3 ticks (B3).
  - `reaper/streetlight_bridge.lua` — `reap_stale_running()` runs
    before "bridge ready" log (B4); generation guard already in
    place from Step 6.
- **Sidecar-suppression saga (one-paragraph post-mortem; do not
  repeat).** Three mid-smoke iterations targeted REAPER's `.wav.RPP`
  project-copy sidecar before path-B (guarded cleanup) landed.
  Round 1 snapshotted `autosaveonrender` / `autosaveonrender2` ini
  vars and zeroed via a 2-arg `set_config_var_string(name, value)` —
  silently no-op'd (wrong arity). Round 2 used the actual 3-arg
  `set_config_var_string(name, value, persist=0)` with return-value
  check — calls succeeded and reaper.ini stayed clean, but
  sidecars persisted (theory falsified: those vars aren't the
  control point). Round 3 active probe revealed that on stock
  REAPER 7.71/macOS-arm64, `reaper.set_config_var_string` is **nil
  entirely** — the setter doesn't exist on this build. Path-A
  (bit-clear via the same setter) eliminated by API surface, not by
  hypothesis. Path-B (guarded cleanup) is what's now live. The two
  workflow lessons that came out of this — "ReaScript `set_*` calls
  silently no-op on wrong arity" and "probe API presence before
  wiring a setter you've never called on this REAPER build" — are
  pinned in `[[streetlight-workflow]]` memory. Don't repeat.
- README has the "How To Run The Impact-Variations Demo" section
  with the 6-item prerequisite checklist (fresh `output_dir`,
  fresh project, Render-in-background ON, one item selected, MCP
  registered, bridge loaded). "What Should Happen" now explicitly
  spells out the sidecar-cleanup contract (output dir contains
  exactly the 8 WAVs, no `.wav.RPP` / `.wav.RPP-bak`).

## First moves for the new window

1. **Read the user's MOST RECENT message in this new window.**
   Three plausible paths:

   (a) **"Run the second-Mac smoke" / "tag v0.1" / "ship."** Step 8
       Round A + C ✅ and the release-prep setup/launcher landed +
       manual gate passed on this Mac. v0.1 is at release-candidate.
       The unfinished gate is `docs/CROSS_MAC_SMOKE.md` actually run
       on a second Mac (or this one after a fresh clone). Optional
       work the user may still pull in: **Vitest 2 → 4 major
       upgrade** (zero real-world exposure on current usage — `npm
       audit --omit=dev` clean — best in a dedicated session, not
       glued to release; see HANDOFF "Round C" bullet for the full
       evaluation), and any **v0.2 items** the user wants to scope
       (Linux queue-dir resolver, idempotency tokens, socket
       transport, configurable risk policy + done-sweep env
       overrides, foreground-render chunked-tick loop).

   (b) **"Codex found a bug in Round A/C, release-prep, or earlier."**
       Locked iteration loop: confirm the bug from code → name the
       fix + any decision the user owns BEFORE editing → propose 1-2
       tight regression notes → wait for sign-off → fix → hand back
       for re-test. Never preemptively flip ✅. Round A and
       release-prep bugs round-trip TS-only (no live REAPER needed
       unless behavior reaches the bridge or the launcher); Round C
       bugs are docs-only; earlier-step bugs take the full live
       REAPER loop.

   (c) **Pivot to something else.** Abandon these first moves and
       follow the new direction.

2. **Tests + build baseline this window:** `npm test` 198/198,
   `npm run build` clean. The `npm run typecheck` script prints a
   `TS6310` "may not disable emit" line then exits 0 — pre-existing
   project setup, do not chase. The `[streetlight-mcp] done-sweep:
   readdir failed (EACCES…)` line in test output is the expected
   best-effort warning from the "init() resolves even when sweep
   cannot enumerate done/" case — not a failure.

3. **Git out-of-band.** Do not commit, branch, push, reset. The
   working tree is the user's; multi-window working pile is
   intentional (Step 3 → Step 8 Round A + Round C + release-prep
   setup/launcher + `package-lock.json`). `style-memory-mcp/` is the
   user's separate repo (`https://github.com/hexingyuofficial/style-memory-mcp.git`)
   nested under this tree; it's in `.gitignore` and stays untouched.

4. **MCP-server reachability quick check.** `call_template
   render_region {}` returns `PARAMS_INVALID` (missing both required
   fields) — cheapest proof the user's MCP client is wired to a
   build that has render_region registered. `TEMPLATE_NOT_FOUND`
   means the client is pointed at a pre-Step-6 dist; rebuild and
   re-register.

5. **Render-in-background must stay ON** for any future render
   smoke (Step 7 B2, docs-only). OFF + a 60 s render → MCP-side
   timeout fires before bridge can return.

## Step 8 — open notes (all six resolved)

These were the carry-forward items inventoried across the Step 6 /
Step 7 windows. None blocked Step 7 ✅. Final disposition after
Round A + Round C: three closed in code (Round A), one closed in
docs (Round C #1), one evaluated and deferred post-v0.1 by
recommendation (Round C #6), one deferred to v0.2 by explicit user
decision (Round B #2).

1. ~~**Foreground render + 55 s deadline edge case.**~~ **Closed
   Round C (docs-only).** v0.1 requires Render-in-background ON per
   B2 docs; INSTALL.md "Render in background" section + README
   prereq #2 + render.lua header note cover the contract. Forward-
   look added: a v0.2 pointer at the end of INSTALL.md's section
   plus a matching ROADMAP.md v0.2 entry ("foreground-render support
   via chunked-tick render loop"). No detection code per the
   explicit B2 decision — would re-tread the `set_config_var_string`-
   is-nil trap from Step 7.
2. **Linux queue-dir mismatch.** Node's `resolveQueueDir` defaults
   to `~/.local/share/streetlight/queue` on Linux, but the Lua bridge
   falls through to macOS's `~/Library/Application Support/Streetlight/queue`
   path. INSTALL.md documents the `STREETLIGHT_QUEUE_DIR` env
   workaround. **Round B deferred to v0.2** — explicit user decision,
   no live Linux REAPER rig to verify a Lua resolver patch. Do not
   re-open without an ask.
3. ~~**Risk policy not enforced in `call-template.ts`.**~~ **Closed
   Round A.** `callTemplate` takes `policy: RiskPolicy = defaultPolicy()`
   as its 5th param; `RISK_BLOCKED` fires between `registry.get` and
   `params.safeParse` (order asserted by test). v0.1 stays on
   `defaultPolicy()`; env-var override is v0.2.
4. ~~**`file-queue.ts` `pollForResult` does not wrap non-ENOENT
   errors.**~~ **Closed Round A.** `readIfExists` call site is in a
   try/catch; non-ENOENT becomes `err(INTERNAL_ERROR, …, { recoverable: false })`
   and the pending file is best-effort cleaned. Class JSDoc contract
   ("errors never reject") now holds.
5. ~~**`done/` orphan accumulation.**~~ **Closed Round A.**
   `FileQueueClient.init()` awaits a best-effort `sweepDoneOrphans()`
   that unlinks `done/<id>.json` older than 24h. Only touches `done/`;
   `pending/` and `running/` untouched. Three-layer try/catch
   (readdir / stat / unlink); failures write `[streetlight-mcp]
   done-sweep: …` warnings to stderr and never reject init.
   `doneOrphanThresholdMs` constructor option is a test-only knob;
   env-var configuration deferred to v0.2.
6. ~~**Vitest 2 / Vite / esbuild dev advisories.**~~ **Evaluated
   Round C; deferred post-v0.1.** `npm audit` flags 5 dev-only vulns
   (3 mod, 1 high, 1 critical) chained from `vitest@^2.1.0` → vite /
   esbuild / vite-node / @vitest/mocker. **Effective real-world
   exposure: zero** — the critical (vitest UI server arbitrary file
   read+exec) only fires under `vitest --ui` (repo uses `vitest
   run`); the high (vite `server.fs.deny` bypass) requires Windows
   dev-server (repo is macOS, test-mode only); moderates all require
   dev-server / `esbuild --serve` / Windows. `npm audit --omit=dev`
   clean — what ships to users is unaffected. Fix path is a two-major
   jump (`vitest@2 → 4.1.9`, skips 3) via `npm audit fix --force`;
   needs a dedicated window for migration, not bolted onto release
   polish. Re-run when we adopt vitest UI or any other surface that
   exposes the vulns. Tracked in the release-candidate "may pull in"
   list under "First moves" (a).

## Step 8 Round A decisions (locked 2026-06-29, carry forward)

10. **Risk-policy plumbing v0.1:** `defaultPolicy()` only. NO env-var
    override (`STREETLIGHT_RISK_ALLOW=...` and similar). Zero
    `destructive`/`unsafe_eval` templates ship in v0.1 so the
    toggle is overhead; configurable policy lands in v0.2 alongside
    the first `destructive` template.
11. **`done/` sweep policy:** startup-only, 24h mtime threshold,
    best-effort. Touches only `done/`. `isFile()` short-circuits
    subdirectories and hand-dropped non-files. Three-layer try/catch.
    Sweep MUST NEVER reject `init()`.
12. **`pollForResult` non-ENOENT recovery shape:** wrapped errors
    surface as `INTERNAL_ERROR` with `recoverable: false`. Same
    "agent calls `get_state` to inspect actual state" recovery
    semantics as `BRIDGE_NOT_RUNNING` mutating-timeout — the wire
    command may or may not have applied between the bridge claiming
    it and the read failing.

## Step 7 decisions (locked, carry forward)

1. **A1 — YAML lib:** `js-yaml` in `@streetlight/mcp-server` deps
   only (not core).
2. **A2 — `list_templates` scope:** ships alongside `list_recipes`.
3. **A3 — Recipe load timing:** re-read every call, NO startup cache.
4. **A4 — `list_recipes` error contract:** bad YAML files skipped +
   stderr warn + structured entry in `result.warnings[]`. `ok:false`
   only on infrastructure failures.
5. **A5 — Recipe Zod schema strictness:** envelope-only
   (`id`, `description`, optional `inputs`/`steps`/`version` +
   `.passthrough()`). Placeholders / template-param shapes NOT
   validated.
6. **B1 — render-time region-name re-validation:** added.
   `lib/names.lua` drives both `region_create` create-time AND
   `render_region` post-resolve. Forbidden set `/ \ NUL $`.
7. **B2 — foreground render + 55 s deadline:** docs-only.
   "Render in background = ON" required per INSTALL.md + README.

## Step 7 decisions (locked, carry forward)

1. **A1 — YAML lib:** `js-yaml` in `@streetlight/mcp-server` deps
   only (not core).
2. **A2 — `list_templates` scope:** ships alongside `list_recipes`.
3. **A3 — Recipe load timing:** re-read every call, NO startup cache.
4. **A4 — `list_recipes` error contract:** bad YAML files skipped +
   stderr warn + structured entry in `result.warnings[]`. `ok:false`
   only on infrastructure failures.
5. **A5 — Recipe Zod schema strictness:** envelope-only
   (`id`, `description`, optional `inputs`/`steps`/`version` +
   `.passthrough()`). Placeholders / template-param shapes NOT
   validated.
6. **B1 — render-time region-name re-validation:** added.
   `lib/names.lua` drives both `region_create` create-time AND
   `render_region` post-resolve. Forbidden set `/ \ NUL $`.
7. **B2 — foreground render + 55 s deadline:** docs-only.
   "Render in background = ON" required per INSTALL.md + README.
   No bridge runtime check.
8. **B3 — file stability window:** 3 consecutive same-size ticks
   (~200 ms @ 10 Hz).
9. **B4 — startup stale-`RUNNING/` cleanup:** writes typed
   `INTERNAL_ERROR` done envelopes, NOT silent deletion.

**Step 7 mid-smoke decision (path-B guarded cleanup):**
v0.1 enforces the WAV-only artifact contract via preflight
no-clobber + post-render `os.remove`. Config-var suppression
(`autosaveonrender*`, `renderclosewhendone`) is OFF the table on
stock REAPER 7.71/macOS-arm64 because `set_config_var_string` is
nil. `render.lua` header note (1) records the full post-mortem.

## Step 6 decisions (still locked)

(unchanged across this round of work — see PROGRESS.md § "Step 6
code drop" + prior HANDOFF versions for full text)

1. Bridge deferred-completion is single-slot, bridge-internal.
2. `changed_ids` carve-out for `render_region` = artifact path.
3. `RENDER_PATTERN` is the literal region name, not `$region`.
4. Two deadlines: MCP 60_000 ms outer / bridge 55 s inner.
5. `output_dir` validation rules (locked + probe-first).
6. Snapshot/restore covers 10 render settings.
7. `undoable = false` for `render_region`.
8. Lua owns name-content rules for `output_dir`.
9. Bridge tick loops are generation-guarded.

## C1 dump procedure (for re-capture if a future smoke surfaces a format problem)

`RENDER_FORMAT_WAV24_HEX = "5A 58 5A 68 64 78 67 41 41 41 3D 3D"`
is verified-on-disk (Step 6 verification). **Do NOT re-prompt for a
hex dump** unless future smoke surfaces a format mismatch. Procedure
for re-capture if it ever does:

1. File → Render… set Format = WAV / 24-bit PCM, then Close (don't
   Render).
2. Actions → ReaScript: Run ReaScript → New, paste:

   ```lua
   local _, fmt = reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "", false)
   local hex = {}
   for i = 1, #fmt do hex[i] = string.format("%02X", string.byte(fmt, i)) end
   reaper.ShowConsoleMsg("RENDER_FORMAT len=" .. #fmt .. " hex:\n")
   reaper.ShowConsoleMsg(table.concat(hex, " ") .. "\n")
   ```

3. Paste the console output back. Update
   `reaper/packs/core/templates/render.lua:RENDER_FORMAT_WAV24_HEX`
   with the hex string (whitespace stripped at decode time).

## Codex-bundled-MCP / direct-client workaround

For Step 4c onward, Codex uses a direct client against
`packages/mcp-server/dist/` because its bundled `mcp__streetlight`
MCP server is a stale Step 4c snapshot. Cheapest reachability check:
`call_template render_region {}` returns `PARAMS_INVALID` (missing
both required fields), NOT `TEMPLATE_NOT_FOUND`. Same queue dir,
same Lua handlers, fresh registry. The queue is the contract; the
MCP-server identity is not.

## Known noise to ignore

- `npm run typecheck` prints a `TS6310` "may not disable emit" line
  then exits **0** because the script is `tsc -b --noEmit || tsc -b`
  and the second invocation succeeds. Pre-existing project setup.
  Do not chase this.

## Locked iteration loop (for any future bug)

The pattern this project has settled into: Claude writes code, user
runs Codex to do a real REAPER smoke + critique, Claude addresses
findings, repeat until green. Don't try to skip the Codex round
just because tests pass — TS tests don't model REAPER. Every real
bug to date surfaced only under Codex review or live REAPER:
4b same-track INTERNAL_ERROR, 4b stale items bucket, 4c
`after_count - 1` mis-pick, 4c Infinity-as-clear-fade, 4c
item_trim length-before-take-check, 5-5 TS-vs-Lua
REGION_NAME_INVALID surface, 6-1 `file_exists`-on-dir false
positive, 6-3 dofile multi-loop / split LAST_RESULT, Step 7
recipe `reuse: true` arity miss, Step 7 first/second sidecar
suppression on the wrong vars, Step 7 third sidecar suppression
on a setter that doesn't exist on this build.

When Codex finds bugs, the right response order is:

1. Confirm the bug from code (don't just trust the description).
2. Name the fix AND any decision the user owns BEFORE editing.
3. Propose 1-2 tightly-scoped regression notes for PROGRESS.md.
4. Wait for sign-off.
5. Fix.
6. Hand back for re-smoke.

The user explicitly does not want you to flip cells ✅
preemptively or to "just fix and move on."

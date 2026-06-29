# Cross-Mac Smoke Checklist — v0.1 release-candidate

Reproduce the current v0.1 release-candidate on a second Mac. Goal:
prove that a fresh clone of the release-candidate installs, builds,
tests, and runs end-to-end on hardware other than the original dev Mac.
NOT a publish — just an "it works elsewhere" gate before tagging.

Original dev environment (the one this is verified against):

- macOS-arm64
- REAPER 7.71
- Node ≥ 20 (the engine the workspace was built with)
- Release checkpoint `166d109` plus the release-prep setup/launcher
  commit that contains this checklist.

## 1. Clone the release-candidate

Use the Git remote once the release-prep setup/launcher commit has
been pushed:

```bash
git clone <streetlight-repo-url> "steetlight soundly"
cd "steetlight soundly"
git status --short            # should be empty
```

If you are deliberately testing an uncommitted local working tree
before pushing, use `rsync` instead and skip `node_modules`:

```bash
# On the source Mac:
rsync -av --exclude='node_modules' --exclude='.DS_Store' \
  "/Users/Zhuanz/Documents/steetlight soundly/" \
  destmac:"~/Documents/steetlight soundly/"
```

That fallback is for pre-push portability debugging only. The normal
release-candidate smoke should use a clean clone.

## 2. Install + build + test baseline

```bash
cd "~/Documents/steetlight soundly"
node --version                # confirm ≥ 20
npm install                   # rebuilds node_modules from package-lock.json
npm run build                 # tsc -b, should be silent
npm test                      # vitest run
```

**Expected:**

- `npm install` clean (matches lockfile; if a new platform-specific
  binary triggers a warning, that's OK as long as install exits 0).
- `npm run build` exits 0 with no output (clean tsc -b).
- `npm test` → `Test Files 21 passed (21)` / `Tests 198 passed (198)`.

The single `[streetlight-mcp] done-sweep: readdir failed (EACCES…)`
line is the **expected best-effort warning** from the "init() resolves
even when sweep cannot enumerate done/" case, NOT a failure.

If tests fail, STOP here. A red bar before REAPER is involved is a
pure-TS environment delta (Node version, platform binaries) and
nothing further in this checklist will help.

## 3. Run `npm run setup` (REAPER launcher + MCP config artifacts)

`npm run setup` does two things from the repo root:

1. Writes a tiny launcher at
   `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`
   that `dofile`s the bridge in this repo (absolute path baked in).
2. Generates filled-in MCP client config snippets under `setup-out/`
   — `claude-code.json`, `codex-config.toml`, `cursor.json` — each
   with the absolute path for this clone already inserted. (Setup
   never edits user-global client configs; copy the snippet you want
   into your client manually.)

Setup also probes `reaper.ini` read-only and tells you whether
`Render in background` is ON (the #1 cause of demo failure).

```bash
npm run setup
```

**Expected output:** the path of the launcher it wrote, the paths
of the three setup-out files, the Render-in-background detection
result, and a numbered "Next steps" block.

`--no-overwrite` refuses to overwrite an existing launcher.
`--reaper-resource-path /custom/path` overrides the default
`~/Library/Application Support/REAPER` (portable installs).

## 4. Register the launcher in REAPER

REAPER does NOT auto-discover scripts dropped into its Scripts
folder. The launcher needs a one-time Load... before it shows up in
the Action List.

1. Open REAPER on the destination Mac.
2. `Actions → Show action list → ReaScript: Load...` → pick
   `~/Library/Application Support/REAPER/Scripts/Streetlight/start_bridge.lua`.
3. With it selected in the Action List, click **Run**.
4. Open the REAPER console (`View → Show console`). Expected:

   ```text
   [streetlight] bridge starting (generation N)
   [streetlight] queue dir = /Users/<you>/Library/Application Support/Streetlight/queue
   [streetlight] loaded pack 'core' v0.1.0
   [streetlight] bridge ready (generation N) — templates: item_pitch, ...
   ```

   `[streetlight] startup-cleanup: reaped K stale running/ envelopes`
   is fine — Step 7 B4 doing its job on leftover state.

After Load... the launcher persists in the Action List — future
sessions just search "Streetlight" and Run.

**REAPER environment notes:**

- **Version:** 7.71 matches the verified environment. Any REAPER 7.x
  should work, but the `set_config_var_string`-is-nil verdict was
  specifically observed on stock 7.71/macOS-arm64 — `render.lua`'s
  guarded cleanup is the v0.1 path regardless.
- **Arch:** arm64 is verified. Intel macOS is **not verified** for
  the sidecar-saga findings (the `set_config_var_string` API surface
  may differ). The guarded-cleanup path doesn't care, so the demo
  should still work; just note that the path-A theory-elimination is
  an arm64-specific data point.
- **`Render in background` MUST be ON.** Setup's probe should have
  printed ✓ — if it printed ⚠ OFF, fix it before continuing:
  `REAPER → Preferences (⌘,) → Audio → Rendering → "Render in
  background (does not apply to queued renders)"` → check the box.
- **Optional:** to reproduce the original sidecar-regression environment,
  leave `autosaveonrender2 = 1` as-is in `reaper.ini` — that's the
  pref that produces `.wav.RPP` sidecars and confirms the
  guarded-cleanup contract actually has work to do.

If you previously hand-wrote a `dofile(...streetlight_bridge.lua)`
line into `__startup.lua`, remove it — the launcher replaces it. The
generation guard from Step 6 stops them stepping on each other, but
your console will print two "bridge starting" lines per launch.

## 5. Wire the MCP client

Open `setup-out/<your-client>.<ext>` from the repo and paste the
snippet into your client's MCP config:

- Claude Code → `setup-out/claude-code.json`
- Codex → `setup-out/codex-config.toml`
- Cursor → `setup-out/cursor.json`

Restart the client so it picks up the config.

## 6. Minimal reachability check

Run this BEFORE the demo — it's the cheapest proof the MCP wiring,
queue dir, and bridge all agree.

Ask the agent:

```
Can you call streetlight ping?
```

**Expected:** `{ "ok": true, "result": { "bridge": "connected",
"reaper_version": "7.71/..." } }`.

Then the registry-wired check:

```
Call streetlight call_template with name="render_region" and no params.
```

**Expected:** `{ "ok": false, "error": { "code": "PARAMS_INVALID",
... } }`. NOT `TEMPLATE_NOT_FOUND` — that would mean the client is
pointed at a pre-Step-6 dist (rebuild + re-register).

If either of these fails, debug the wiring (queue dir mismatch is
the most common cause) before proceeding to the demo. There's no
point reproducing Step 7 against a half-connected bridge.

## 7. Step 7 demo (8-item impact-variations recipe)

This is the live reproducer for the v0.1 release-candidate behavior.

**Prep:**

- One audio file on disk you don't mind processing 8 times. The
  original verification used `POP Sucker 01.ogg` (0.4449 s); any
  short clip works. Drag it into REAPER as a single item on a single
  track.
- Open a **fresh REAPER project**, with **exactly one item selected**
  (the recipe's first step requires `selection.items.length === 1`,
  trailing note in the YAML + README prereq #5).
- Pick a **fresh output directory** that DOES NOT exist yet or is
  empty. Absolute path (Lua doesn't expand `~`). Example:
  `/Users/<you>/Desktop/streetlight-crossmac-smoke/`.

**Run:**

Follow README § "How To Run The Impact-Variations Demo" with the
output dir above. The agent will walk through `list_templates` /
`list_recipes` / `get_state(selection)` / 8 × (item_duplicate →
item_pitch → item_rate → item_fade / item_trim → region_create →
render_region).

**Pass criteria (all must hold):**

1. 8/8 variations complete end-to-end without retry.
2. Output dir contains **exactly 8 WAVs** (`var_01.wav` ..
   `var_08.wav`) and **nothing else** — no `.wav.RPP` / `.wav.RPP-bak`
   sidecars. This is the guarded-cleanup contract.
3. Each WAV is 24-bit PCM, project sample rate, stereo (verify with
   `file` or `afinfo`).
4. Each `render_region` invocation returns `changed_ids` with **only**
   the corresponding WAV absolute path — no sidecars, no region refs.
5. `var_08.wav` is the trim variant (~0.5 s when source is the
   POP Sucker clip; will scale with your source).

**Pass criteria for the focused preflight side-quest (optional but
recommended):**

- In a SEPARATE empty output dir, `touch <dir>/var_01_smoke.wav.RPP`
  to pre-place a sidecar file by hand. Then invoke `render_region`
  with that path. **Expected:** typed `OUTPUT_FILE_EXISTS` with the
  colliding path in the message, and the hand-touched file is
  **untouched** afterward (verify with `ls -la` / `stat`).

If both the 8-item demo AND the preflight side-quest pass, the v0.1
release-candidate reproduces cleanly on this Mac. You're done.

## 8. Teardown

- The 8 rendered WAVs are not project state — Cmd+Z does NOT remove
  them. Delete the output dir manually if you want to re-run from
  zero.
- The queue dir (`~/Library/Application Support/Streetlight/queue/`)
  is harmless to leave; the Step 8 Round A 24h `done/` orphan sweep
  cleans it on the next `init()`.
- The REAPER prefs you flipped stay in `reaper.ini` until you change
  them back.

## What's intentionally NOT in this checklist

- **Linux verification** — Step 8 Round B deferred to v0.2; v0.1 is
  macOS-only by decision.
- **Windows verification** — never targeted by v0.1.
- **Codex/Claude Code/Cursor-specific UI flows** — those depend on
  the client and aren't part of the Streetlight contract.
- **Vitest 2 → 4 upgrade** — separate post-v0.1 work; the test bar
  reproduces fine on v0.1's pinned `vitest@^2.1.0`.
- **Performance / load testing** — out of scope for v0.1.

If a step above fails on the destination Mac in a way the original
dev Mac doesn't reproduce, that's a real v0.1 portability bug —
file it against the [[streetlight-workflow]] locked iteration loop
(confirm from code → name fix + decisions → regression notes →
sign-off → fix → re-test).

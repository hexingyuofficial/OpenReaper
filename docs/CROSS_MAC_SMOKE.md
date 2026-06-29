# Cross-Mac Smoke Checklist — v0.1 release-candidate

Reproduce the current v0.1 release-candidate on a second Mac. Goal:
prove that the working tree as it stands (uncommitted Step 3 → Step 8
Round A + Round C pile included) installs, builds, tests, and runs
end-to-end on hardware other than the original dev Mac. NOT a release
tag, NOT a publish — just an "it works elsewhere" gate.

Original dev environment (the one this is verified against):

- macOS-arm64
- REAPER 7.71
- Node ≥ 20 (the engine the workspace was built with)
- HEAD `ac6bd02` + ~59 uncommitted files in the working tree

## 1. Transfer the working tree

Git is **out-of-band** on this project — the working tree carries the
cumulative Step 3 → Step 8 Round A + Round C changes that have NOT
been committed. Transferring HEAD alone is wrong. Use one of:

**Option A (recommended) — `rsync` the live tree, skip `node_modules`:**

```bash
# On the source Mac:
rsync -av --exclude='node_modules' --exclude='.DS_Store' \
  "/Users/Zhuanz/Documents/steetlight soundly/" \
  destmac:"~/Documents/steetlight soundly/"
```

`package-lock.json` IS tracked / transferred — that locks deps on the
destination. `node_modules` is excluded; we re-install fresh.

**Option B — tar + scp:**

```bash
# On the source Mac:
tar --exclude='node_modules' --exclude='.DS_Store' \
  -czf /tmp/streetlight.tgz -C "/Users/Zhuanz/Documents" "steetlight soundly"
scp /tmp/streetlight.tgz destmac:~/Documents/
# On the destination Mac:
cd ~/Documents && tar -xzf streetlight.tgz
```

Sanity check on the destination after transfer:

```bash
cd "~/Documents/steetlight soundly"
git rev-parse HEAD            # should print ac6bd02...
git status --short | wc -l    # should print roughly 59 (matches source)
```

If `git status` shows a different count, the transfer dropped or added
files — re-do the rsync/tar.

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
- `npm test` → `Test Files 20 passed (20)` / `Tests 171 passed (171)`.

The single `[streetlight-mcp] done-sweep: readdir failed (EACCES…)`
line is the **expected best-effort warning** from the "init() resolves
even when sweep cannot enumerate done/" case, NOT a failure.

If tests fail, STOP here. A red bar before REAPER is involved is a
pure-TS environment delta (Node version, platform binaries) and
nothing further in this checklist will help.

## 3. REAPER environment

REAPER must be installed and licensed on the destination Mac.

**Version:** 7.71 matches the verified environment. Any REAPER 7.x
should work, but the `set_config_var_string`-is-nil verdict was
specifically observed on stock 7.71/macOS-arm64 — `render.lua`'s
guarded cleanup is the v0.1 path regardless.

**Arch:** arm64 is verified. Intel macOS is **not verified** for the
sidecar-saga findings (the `set_config_var_string` API surface may
differ). The guarded-cleanup path doesn't care, so the demo should
still work; just note that the path-A theory-elimination is an
arm64-specific data point.

**Prefs to set BEFORE running the demo:**

1. `REAPER → Preferences (⌘,) → Audio → Rendering → "Render in
   background (does not apply to queued renders)"` — **must be ON.**
   See `docs/INSTALL.md` § Render in background for the full
   rationale. OFF → demo will hit `BRIDGE_NOT_RUNNING` instead of
   typed render errors.
2. (Optional, reproduces the original sidecar-regression environment)
   leave `autosaveonrender2 = 1` as-is in `reaper.ini` — that's the
   pref that produces `.wav.RPP` sidecars and confirms the
   guarded-cleanup contract actually has work to do.

## 4. Install the REAPER bridge

Follow `docs/INSTALL.md` § Install Step 2 (Layout A or B). The bridge
entry point is `reaper/streetlight_bridge.lua`, but it `dofile`s
sibling files under `reaper/packs/core/`, so the whole `reaper/`
directory has to stay together.

Easiest: `dofile` from the repo path you just rsynced — survives
re-runs of this checklist.

In REAPER's `__startup.lua` (or run it manually once via Actions →
ReaScript: Run ReaScript):

```lua
dofile("/Users/<you>/Documents/steetlight soundly/reaper/streetlight_bridge.lua")
```

**Expected REAPER console output:**

```
[streetlight] bridge starting (generation N)
[streetlight] queue dir = /Users/<you>/Library/Application Support/Streetlight/queue
[streetlight] loaded pack 'core' v0.1.0
[streetlight] bridge ready (generation N) — templates: item_pitch, ...
```

If you see `[streetlight] startup-cleanup: reaped K stale running/
envelopes ...`, that's fine — it's Step 7 B4 doing its job on
leftover state.

A `dofile` error at startup almost always means `reaper/packs/` is
not sitting next to `streetlight_bridge.lua` — re-check transfer.

## 5. Configure the agent client

Pick the client you actually use on this Mac (Codex / Claude Code /
Cursor / etc.). Templates live in `examples/`:

- `examples/codex-config.example.toml`
- `examples/claude-code.example.json`
- `examples/cursor.example.json`

The command in every example is conceptually the same:

```
node /Users/<you>/Documents/steetlight soundly/packages/mcp-server/dist/index.js
```

After registering, restart the client so it picks up the config.

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

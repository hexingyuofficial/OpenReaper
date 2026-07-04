# OpenReaper V1 Runbook

This runbook is for operators validating the supported V1 local manual-bridge
path. It is intentionally conservative. If a setup does not match the declared
support row, stop and record a typed blocker instead of improvising a raw
bridge, Lua, action, or shell workaround.

## Supported V1 Live Path

Current supported recipe-level path:

```text
recipe.project.cleanup_fingerprint_report
```

Expected tool sequence:

```text
call_template(template.project.create_cleanup_report)
get_state(scope:"artifact", view:"summary")
get_state(scope:"artifact", view:"payload")
```

Accepted local clean-source evidence used OpenReaper commit `57540d4` and run
root:

```text
/Users/Shared/openreaper-portability-live/layer7-r1-portability-live-20260704-222001
```

## Prerequisites

- Local macOS manual-bridge environment.
- REAPER is installed and can run the generated bridge Lua manually.
- Node and npm are available.
- The OpenReaper source tree is clean before the run.
- The run uses fresh transport and artifact roots.
- Node does not spawn REAPER.

The live matrix includes evidence for REAPER `7.71/macOS-arm64` on the manual
bridge path. New support rows should record exact OS, REAPER version,
OpenReaper commit, bridge owner/generation/session, transport root, artifact
root, and fixture state.

## Static Checks

From the OpenReaper repository root:

```bash
git status --short
git rev-parse --short HEAD
git log -1 --oneline
npm run build:live-bridge
npm run check:official-recipes
npm run check:template-runtime
npm test
git diff --check
```

The source tree should be clean before and after the run. If generated bridge
output changes unexpectedly, stop and review before starting REAPER.

## Fresh Run Root

Use a fresh run root outside the repo:

```bash
export RUN_ID="layer7-r1-portability-live-$(date +%Y%m%d-%H%M%S)"
export RUN_ROOT="/Users/Shared/openreaper-portability-live/${RUN_ID}"
export TRANSPORT_DIR="${RUN_ROOT}/transport"
export ARTIFACT_ROOT="${RUN_ROOT}/artifacts"
export REPORT_DIR="${RUN_ROOT}/reports"

mkdir -p "${TRANSPORT_DIR}/requests" "${TRANSPORT_DIR}/results"
mkdir -p "${ARTIFACT_ROOT}" "${REPORT_DIR}"
```

Do not reuse old request/result files, transcripts, reports, or artifacts.
Failed runs should also be preserved for triage.

## Bridge Environment

Set the bridge environment in the terminal that will launch or prepare REAPER:

```bash
export OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR="${TRANSPORT_DIR}"
export OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH="${PWD}/reaper/bridge/openreaper-live-bridge.lua"
export OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS=300000
export OPENREAPER_LIVE_BRIDGE_OWNER="openreaper-layer7-r1-cleanup"
export OPENREAPER_LIVE_BRIDGE_GENERATION=1
export OPENREAPER_LIVE_BRIDGE_SESSION_ID="${RUN_ID}"
export OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_LAYER7_RECIPE_RUN_ID="${RUN_ID}"
export OPENREAPER_LAYER7_R1_RECIPE_LIVE=1
```

Record the environment, omitting secrets or large payloads:

```bash
env | sort | grep -E '^(OPENREAPER_|RUN_ID=|RUN_ROOT=|TRANSPORT_DIR=|ARTIFACT_ROOT=|REPORT_DIR=)' \
  > "${REPORT_DIR}/env-manifest.txt"
```

## Manual REAPER Steps

The user operates REAPER manually.

1. Launch or restart REAPER so it sees the `OPENREAPER_*` environment.
2. Open a simple/disposable project for the cleanup report path.
3. In REAPER, manually run:

   ```text
   reaper/bridge/openreaper-live-bridge.lua
   ```

4. Confirm the REAPER console reports the expected transport root, owner,
   generation, and session.
5. Leave REAPER and the bridge loop running until the Node command exits.

If REAPER was already open with stale environment, restart it. For retries,
create a new `RUN_ID` and a new run root.

## R1 Transcript Command

After the manual bridge is running:

```bash
node scripts/run-layer7-r1-recipe-transcript.mjs \
  --live \
  --run-id "${RUN_ID}" \
  --artifact-root "${OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT}" \
  --transcript "${REPORT_DIR}/r1-live-transcript.jsonl" \
  --report "${REPORT_DIR}/r1-live-report.md"

git status --short | tee "${REPORT_DIR}/source-status-after-live.txt"
```

## Success Criteria

The run is a pass candidate only if:

- the command exits `0`;
- the report status is `succeeded`;
- the reason is `layer7_r1_recipe_transcript_succeeded`;
- `spawned_reaper:false`;
- transcript has 15 events;
- checkpoints reached:
  - `checkpoint_create_cleanup_report`
  - `checkpoint_read_cleanup_summary`
  - `checkpoint_read_cleanup_payload`
- one `artifact:project:cleanup_report:*` ref is produced;
- artifact summary readback succeeds;
- artifact payload readback succeeds;
- source `git status --short` is clean before and after;
- no live matrix row is updated from this recipe-level run.

## Failure Classes

| Class | Examples | Action |
|---|---|---|
| Transport | Missing request/result dirs, timeout, invalid result JSON. | Preserve evidence; retry only with fresh run root after setup review. |
| Owner/generation | Bridge owner or generation mismatch. | Restart/reload REAPER bridge with matching env and a new run root. |
| Stale bridge | Wrong bridge path, stale generated Lua, hash mismatch. | Rebuild/check bridge; do not run from unreviewed source. |
| Artifact root | Bridge cannot write artifact or Node cannot read it. | Recreate fresh artifact root and ensure REAPER/Node use the same path. |
| Recipe/tool contract | Wrong recipe id, wrong step order, forbidden alias, non-frozen tool path. | Reject the run and open a bounded contract investigation. |
| Fixture/project | Missing or wrong REAPER project state. | Stop, preserve evidence, prepare the declared fixture. |
| Unsupported row | Unsupported OS, REAPER version, plugin, UI, hardware, or lifecycle. | Record typed blocker; do not broaden support wording. |

## Evidence Retention

Keep these artifacts:

- request/result files;
- transcript JSONL;
- report Markdown;
- artifact JSON files;
- env manifest;
- source status before/after;
- source commit;
- OS and REAPER version if available.

Evidence stays outside the repo unless a control-tower route asks for a
summary path. Operators do not update the live matrix automatically.

## Promotion Policy

Recipe-level portability evidence is workflow evidence. Template-row live
matrix promotion is separate and must be reviewed by the control tower.

The current V1 R1 run does not:

- promote other draft recipe atoms;
- add `call_recipe`;
- update template matrix rows;
- prove remote-clone/new-machine portability;
- prove arbitrary OS, REAPER version, project, media, plugin, UI, hardware, or
  destructive cleanup support.

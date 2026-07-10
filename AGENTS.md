# Agent Instructions

This repo is the clean OpenReaper foundation repo.

Before changing files, read:

1. `docs/FOUNDATION_FREEZE_PLAN.md`
2. `docs/REPOSITORY_LAYOUT.md`
3. `docs/LAYER_PROGRESS.md`
4. `docs/RATCHET_MODEL.md`
5. The ABI or taxonomy document for the layer you are working on.

## Hard Boundary

Do not migrate old workflow-shaped packs from
`/Users/Zhuanz/Documents/streetlight-reaper-mcp` into this repo as top-level
packs.

Legacy workflow names such as `loop`, `cleanup`, `delivery`, `layer`, and
`music_sketch` are recipe families or tags here, not first-class pack names.

## Layer Discipline

Only work on the requested layer.

Respect the ratchet model in `docs/RATCHET_MODEL.md`: do not downgrade,
bypass, or silently mutate accepted/frozen status. If a lower layer needs
changes, report the concrete blocker and wait for a bounded fix window.

If a lower layer needs changes, stop and report the dependency. Do not fix it
as a drive-by change.

Frozen lower layers are reopened only when a later layer finds a concrete
blocker. The later layer must pause, report the blocker to the control tower,
and wait for an approved lower-layer fix window.

## Architecture File Ownership

Architecture and process files are control-tower owned. Do not edit them unless
the prompt for your layer explicitly names the exact file and says the user has
approved that architecture-file change.

Architecture and process files include:

- `AGENTS.md`
- `README.md`
- `docs/FOUNDATION_FREEZE_PLAN.md`
- `docs/LAYER_PROGRESS.md`
- `docs/RATCHET_MODEL.md`
- `docs/REPOSITORY_LAYOUT.md`
- `docs/abi/**`
- `docs/taxonomy/**`
- `docs/migration/**`
- `scripts/check-layer-scope.mjs`
- `scripts/check-repo-layout.mjs`

If your layer needs one of these files changed and it was not explicitly
approved in your prompt, stop and report the proposed change to the control
tower. Do not make the edit yourself.

`docs/LAYER_PROGRESS.md` is the single progress ledger. Update it only when
your layer prompt explicitly asks you to update the entry for your layer.

## Document Registry

Any new long-lived document in this repo must be registered in the old control
tower record:

```text
/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/CONTROL_TOWER_RECORD.md
```

Registration means adding the path to the resume/index area and briefly stating
what the document records. A layer builder may create a new document only when
its prompt explicitly allows it, and its completion report must say whether the
new document was registered or still needs control-tower registration.

This responsibility also applies to subagents. Reviewer, smoke, explorer, and
worker subagents must not create long-lived documents unless explicitly
authorized. If a subagent recommends creating one, the parent builder must
include that recommendation in the completion report so the control tower can
approve and register it.

## Commit Ownership

Layer builder windows do not commit unless their prompt explicitly says so.
They finish by returning a report, changed-file list, tests, reviewer findings,
smoke output when required, and known risks.

The control tower owns commits for accepted layer freezes and approved
architecture/process updates. A layer is frozen only after the control tower
accepts the work and records the accepted commit.

## User Handoff Prompts

When the control tower needs the user to send work to another window, it should
give a complete copy-paste prompt and name the intended recipient clearly, such
as `Layer 6 worker`, `R3 research`, `R4 research`, `C fixture retry`, or
`reviewer`.

The handoff should say:

- who should receive it;
- what repo/path scope they may touch;
- what they must not change;
- what tests or checks to run;
- what report path or completion format to return;
- whether commits are forbidden.

Do not ask the user to infer which window or agent should receive a prompt.
If multiple windows are active, state which one should receive each prompt and
which returned reports the control tower is waiting for.

Layer order:

```text
1. Tool ABI v1
1.5. Discovery / Menu Contract v1
2. Foundation / Bridge ABI v1
3. Pack Taxonomy v1
4. Template Authoring ABI v1
4W2A. Wave 2A Descriptor-Only 70-Template Pass
4W3A. Wave 3A Critical Research-Only Scout
4W3B. Wave 3B Critical Descriptor-Only Pass
4D. Template Runtime Binding / Live Smoke Gate
4D.1. Live Bridge Executor Binding / Wave 0 Canary Enablement
4D.2. REAPER-side Bridge Script / Wave 0 Handshake
4D.x. Wave 1A Read-Handler Expansion
4.5A. Artifact / State Store Contract + Core Helpers
4.5B. get_state Artifact Projection / Runtime Binding
4.5C. Lua Artifact Helper + Live Artifact Smoke
5. Recipe Contract v1
6. User Recipe Authoring v1
7. Official Recipe Acceptance / First Real Version Gate
```

## Current Next Task

The V1 foundation and public closure docs are accepted. The post-V1 product
sequence has also advanced through the Alpha2 213-template bounded live baseline,
Alpha3 first-product closeout, and Alpha3.1 installable-product work.

Current accepted product base:

- V1 public docs accepted at `ad1c228 docs: publish v1 public docs`;
- Alpha2 bounded live evidence covers the accepted 213-template fixture matrix;
- Alpha3 Phase 3 first-product closeout is accepted with evidence-bound claims;
- Alpha3.1 startup/package stabilization is accepted at
  `2ded9ff package: stabilize agent-assisted startup`.

As of 2026-07-10, Alpha3.2 Trial Feedback Hardening is the only active product
implementation phase. Alpha3.1 L6 broader C5 live canaries and L7 stock-plugin
evidence are deferred evidence backlog, not concurrent active slices.

Authoritative active plan:

```text
/Users/Zhuanz/Documents/streetlight-reaper-mcp/docs/agent-routing/reports/alpha3.2-trial-feedback-hardening-plan.md
```

Current work order:

1. reconcile and separately accept, defer, or reject the existing dirty-tree
   candidates;
2. run Alpha3.2-A Agent Context And Macro Guide without REAPER;
3. run Alpha3.2-B Startup, Bridge Health, And Render Root;
4. continue through bounded 3.2-C/D/E/F slices, trial rerun, then manual closeout.

## Active Control-Tower Authorization

The user authorized the current control-tower window on 2026-07-10 to create and
coordinate subagents, worktrees, and additional worker/reviewer/smoke windows.
Workers receive disjoint path ownership, do not commit, and return changed files,
checks, evidence, blockers, and risks. The control tower reviews and owns accepted
commits.

The user also authorized project-local REAPER testing against:

```text
/Users/Zhuanz/Untitled/Untitled.RPP
```

The control tower and its delegated smoke workers may start, stop, and restart
REAPER; open, save, overwrite, or save-as this authorized project; and perform
project-local create/edit/delete, layout, internal routing, media placement,
control/readback, SQLite, and render tests needed by the accepted slice. The
project is a disposable live fixture for those tests.

The authorization does not change product boundaries: use OpenReaper
MCP/start/doctor paths; do not add raw Lua/action/shell/UI bypass capabilities;
do not delete source media files from disk by default; keep hardware/device I/O
hard-stopped; and do not promote support wording or matrices without reviewed
evidence. Every live run must use a fresh evidence root and report project
changes, rendered files, recovery/backup posture, and exact results.

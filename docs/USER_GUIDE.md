# OpenReaper User Guide

Status: Alpha3 first-product draft.

This guide is for musicians, producers, and creators who want to use
OpenReaper by talking to an agent. You do not need to understand templates,
macros, SQLite, artifacts, bridge internals, or the architecture layers to use
the product.

The goal is that you can use OpenReaper without reading this manual. Read it
when you want more precise control over what to ask, what the agent may do
after authorization, and how to share or reuse work.

Some Phase 3 features described here are still being built. Support claims must
stay tied to evidence in the repository and control-tower records.

## What OpenReaper Does

OpenReaper helps an agent work with a REAPER project through a small reviewed
tool surface. The agent can inspect the project, run accepted actions, read
back what changed, and keep evidence for recovery and review.

The intended first-product experience is:

- ask in normal language;
- let the agent inspect the project;
- approve a bounded safe scope when needed;
- let the agent carry out ordinary reversible work;
- receive concise readback and recovery guidance.

## Starting Or Reconnecting

You should be able to ask:

```text
Open OpenReaper.
Open REAPER with OpenReaper.
Reconnect to my REAPER session.
Check whether OpenReaper is healthy.
```

For the installable macOS alpha package, the agent should help with startup:

1. Run `~/.openreaper/current/bin/openreaper-start` for you.
2. Wait for REAPER to stay alive and read the printed pid/log/action guidance.
3. Try to run the REAPER Action `OpenReaper: Start MCP bridge`.
4. If the agent cannot operate the REAPER UI, ask you for one small assist:
   open REAPER Actions, search `OpenReaper: Start MCP bridge`, and click Run.
5. Reconnect the MCP server named `openreaper`.
6. Run a bounded live probe, such as
   `call_template(template.transport.read_state)`, before saying the bridge is
   connected.

You should not need to find a bridge file or understand bridge paths. SWS is
not required for this startup route.

Startup window handling is intentionally narrow. OpenReaper may automatically
close only the known Project Settings / Notes "show notes on project load"
window. License/evaluation, recovery, plugin/FX, version, and unknown REAPER
windows are user-choice blockers. If the live probe does not connect, the
agent should check whether REAPER has a waiting window or ask you to resolve it,
then run the bridge Action and reconnect again.

The product should explain blockers in plain language:

- REAPER is not open.
- The bridge is not ready.
- A REAPER startup window is waiting for user or agent action.
- The session is stale.
- The project or selection is not what the agent expected.

You should not need to reason about run roots, transport paths,
owner/generation values, or session ids in normal use.

## Asking About The Project

Useful prompts:

```text
What is in this project?
Show me the selected items.
Find tracks that look like vocals.
Show tracks with compressors or EQ.
What changed since the last step?
Give me a compact project map.
```

For large projects, OpenReaper should summarize first and hydrate details only
when needed. It should not dump every FX parameter, automation point, media
analysis result, or routing graph by default.

## Asking For Creative Work

Useful prompts:

```text
Create a recording track for vocals.
Make a quick vocal cleanup chain.
Turn the selected item into a reverse riser.
Align these selected item starts.
Make a starter beat from slices of the selected audio.
Make the selected vocal brighter.
Lower the selected track a little.
```

The agent should choose the right reviewed action or workflow. You should not
need to choose between a template, macro, recipe, artifact, or SQLite query.

## Authorization And Safety

OpenReaper should not ask you to approve every tiny reversible step.

A good flow:

1. The agent explains the scope and likely consequences.
2. You approve the bounded scope.
3. The agent performs ordinary reversible work inside that scope.
4. The agent reads back concise checkpoints.
5. The agent stops only if the request crosses a real risk boundary.

The agent should still stop for:

- destructive deletion;
- overwrite or export;
- hardware/input/output routing;
- privacy-sensitive scans;
- paid or licensed downloads;
- ambiguous irreversible actions.

## Readback And Recovery

After work, the agent should tell you:

- what changed;
- what was verified;
- what was not verified;
- whether any blocker occurred;
- how to retry, refresh, undo, or clean up when available.

If the agent says it needs to refresh or re-resolve a target, that means the
project state may have changed and OpenReaper is checking REAPER again before
acting.

## Workflows

Workflows are reusable creative or utility flows over reviewed OpenReaper
actions. Internally, OpenReaper may store them as recipe files, but normal
product language should stay simple: workflow.

Planned first-product flows:

```text
Save this as a workflow.
Scrub this workflow before sharing.
Share this workflow.
Install this workflow.
Fork and tweak this workflow.
```

Before sharing, OpenReaper should remove private or machine-specific details
such as local paths, request ids, project refs, private notes, and assumptions
that will not work on another machine.

## Packs

Packs extend OpenReaper with reviewed capability or domain-specific controls.
For example, a synth/plugin pack may expose musical controls for a plugin such
as Vital, and a sound-library pack may help search, preview, and import sounds.

A pack should clearly report:

- whether it is official, partner, experimental, or local;
- what plugins or versions it needs;
- what actions it adds;
- what evidence supports it;
- what is not supported yet.

## Common Blockers

| Blocker | What It Means | What To Do |
|---|---|---|
| REAPER not ready | The agent cannot reach the live session. | Ask the agent to run `openreaper-start`; if a REAPER window is waiting, resolve it, run `OpenReaper: Start MCP bridge`, reconnect, and probe. |
| Stale session | The bridge/session does not match the current run. | Reconnect or restart the session. |
| Wrong selection | The action needs selected tracks/items/takes. | Select the intended target and retry. |
| Missing plugin | A requested plugin is not installed or not found. | Install it or choose a supported stock tool. |
| Needs confirmation | The action crosses a hard risk boundary. | Review the consequence and approve only if intended. |
| Needs refresh | Cached state may be stale. | Let the agent refresh before acting. |

## What Is Supported

OpenReaper support is evidence-bound.

The current repo contains V1 and Alpha2 evidence, plus Alpha3 draft product
work. Phase 3 completion requires customer-usable startup, large-project query,
fast readback/actions, workflow portability, packs, stock plugin fluency, and
trial-officer acceptance.

If the guide, README, agent, or pack claims a feature is supported, that
claim should point to matching evidence.

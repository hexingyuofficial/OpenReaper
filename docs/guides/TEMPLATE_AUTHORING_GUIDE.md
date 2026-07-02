# Template Authoring Guide

Status: maintainer and agent-builder guide for Layer 4 and later template work.

## Audience

This guide is for OpenReaper maintainers and agent builders who are adding or
reviewing templates under the frozen Template Authoring ABI.

It is not the final user manual. Ordinary users should primarily create and
edit recipes once the recipe layers are open.

## Authoring Principles

- A template is one verified action atom.
- A template has exactly one primary pack owner from the fixed pack taxonomy.
- A template uses the frozen foundation/bridge ABI for execution.
- A template exposes compact discovery metadata by default.
- A template provides full descriptors only on demand.
- A template must have focused tests and an appropriate smoke.

## What A Template Must Prove

Before a template can be accepted, it must prove:

- its metadata follows the pack taxonomy,
- its descriptor validates,
- its bridge request follows the Layer 2 envelope,
- its result mapping is bounded,
- its expected delta and verification behavior are explicit,
- its artifact behavior does not inline large payloads,
- its discovery summary stays compact,
- it does not behave like a recipe or hidden workflow executor.

## Development Flow

1. Read the frozen lower-layer docs.
2. Choose the primary pack owner.
3. Write or update the template descriptor.
4. Add contract tests.
5. Add smoke coverage appropriate to the template risk.
6. Verify discovery remains compact.
7. Return the report to the control tower.

Builders do not commit unless their prompt explicitly says so.

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

## Reading A Descriptor

When reviewing a descriptor, first separate compact discovery metadata from
full on-demand fields.

Compact discovery is limited to:

```text
id
title
summary
pack
lifecycle
risk
entity_kind
tags
```

Full descriptor fields include bridge declaration, schemas, refs, artifacts,
expected delta, verification, examples, and optional pressure-fixture metadata.
Those fields are read on demand for exact descriptor review and must not be
treated as the default menu payload.

Read the descriptor in this order:

1. Confirm `contract` is `template.descriptor.v1`.
2. Confirm `id` follows `template.<pack>.<lower_snake_segments>` and the id
   pack segment matches `pack`.
3. Choose exactly one primary pack owner from the fixed Layer 3 taxonomy.
4. Confirm lifecycle, risk, `entity_kind`, and tags use canonical metadata
   values and grammar.
5. Check `bridge.operation_family` against the frozen Layer 2 operation
   families.
6. Check `inputSchema` and `outputSchema` before examples.
7. Check refs, artifacts, expected delta, and verification together; they
   should describe the same bounded effect.
8. Check examples only as static descriptor examples, never as recipes.

## Writing A Descriptor

Choose exactly one primary pack owner before writing the id. The owner is the
domain that validates the capability, risk posture, refs, expected delta, and
result surface. Cross-domain support belongs in refs or artifacts, not in extra
pack identities.

Do not use workflow-shaped pack names such as `loop`, `cleanup`, `delivery`,
`layer`, or `music_sketch`. Those words may appear only as tags when they
describe recipe family, migration source, or user intent.

Keep compact discovery separate from full descriptors. Do not place schemas,
examples, expected delta, refs, artifacts, verification details, or bridge
metadata into a default menu summary.

Write schemas as compact object schemas with `type`, `properties`, `required`,
and `additionalProperties`. Put large values in artifacts and describe them
with artifact metadata.

For write or destructive descriptors, declare `verification.mode: required`
with at least one check. If a mutation is retry-safe, declare bridge
idempotency and mark `expectedDelta.idempotent` consistently.

Pressure fixtures belong in tests only. They prove the descriptor contract can
express a shape; they do not create official templates.

Run `npm run check:template-authoring` before returning a 4A or later template
authoring report.

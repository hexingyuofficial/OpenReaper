# Template Authoring ABI v1

Status: target for the Layer 4 Template Authoring ABI v1 gate.

## Purpose

Layer 4 freezes how OpenReaper templates are described, validated, executed,
tested, smoked, and exposed through discovery.

Templates are verified action atoms. They are not recipes, workflow products,
or hidden agent executors.

## Layer 4 Phases

Layer 4 should proceed in order:

```text
4A. Template Descriptor Contract
4B. Template Execution Harness
4C. Template Catalog / Smoke Gate
```

Each phase returns to the control tower for review before the next phase starts.
If a phase discovers a lower-layer blocker, it stops and reports the blocker.

## Contract To Freeze

Layer 4 must freeze:

- template descriptor shape,
- template id, pack, lifecycle, risk, entity_kind, and tags,
- input and output schemas,
- ref and artifact declarations,
- expected delta and verification declarations,
- bridge operation request construction,
- result and typed error mapping,
- catalog exposure through the Layer 1.5 discovery/menu contract,
- required unit, contract, and smoke tests.

## Pressure Fixtures

Layer 4 must include template pressure fixtures that prove the ABI can express:

- read-only state templates,
- simple write templates,
- destructive write templates,
- artifact-producing templates,
- analysis jobs,
- render jobs,
- action-backed templates,
- cross-domain templates with one primary pack owner,
- verification-required templates,
- idempotent mutation templates,
- ref-heavy templates,
- compact discovery with on-demand full descriptors.

These fixtures are ABI pressure tests, not the official template library.

## Non-Goals

Layer 4 must not change the frozen Tool ABI, Discovery/Menu contract,
Foundation/Bridge ABI, or Pack Taxonomy.

Layer 4 must not build the full template library, create official recipes,
open user recipe authoring, or migrate legacy workflow-shaped packs.

# Legacy Boundary

The previous implementation lives at:

```text
/Users/Zhuanz/Documents/streetlight-reaper-mcp
```

It is useful as:

- implementation reference,
- smoke evidence,
- lessons learned,
- migration source.

It is not authority for the new repo's pack taxonomy.

## Legacy Workflow-Shaped Packs

These names should not become top-level public packs in this repo:

```text
loop
cleanup
delivery
layer
music_sketch
```

Target treatment:

- recipe family,
- recipe tag,
- migration note,
- hidden compatibility alias if required.

## Migration Principle

Move the smallest compatible unit.

Preferred pattern:

```text
legacy behavior
  -> fixed target pack template
  -> official recipe uses the fixed pack
  -> old workflow name becomes tag/family
```

Avoid:

- bulk-moving old directory trees,
- preserving old workflow packs as public taxonomy,
- renaming stable templates without a compatibility reason,
- mixing ABI freeze work with workflow migration.

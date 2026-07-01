#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MANIFEST_FORMAT_UNEXPECTED = "MANIFEST_FORMAT_UNEXPECTED";

const UNDO_FLAG_FROM_LUA = {
  UNDO_STATE_TRACKCFG: "TRACKCFG",
  UNDO_STATE_FX: "FX",
  UNDO_STATE_ITEMS: "ITEMS",
  UNDO_STATE_MISCCFG: "MISCCFG",
  UNDO_STATE_FREEZE: "FREEZE",
};

function sorted(values) {
  return [...values].sort();
}

export function stripLuaLineComments(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function parseTemplateBlockRange(body, name, startIndex) {
  const open = body.indexOf("{", startIndex);
  if (open === -1) {
    throw new Error(`${MANIFEST_FORMAT_UNEXPECTED}: missing opening block for ${name}`);
  }

  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    const c = body[i];
    if (c === "{") depth += 1;
    if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          block: body.slice(open + 1, i),
          endIndex: i + 1,
        };
      }
    }
  }
  throw new Error(`${MANIFEST_FORMAT_UNEXPECTED}: unclosed block for ${name}`);
}

function parseTemplateBlock(body, name, startIndex) {
  return parseTemplateBlockRange(body, name, startIndex).block;
}

function parseLuaStringOrFalseField(text, field) {
  const stripped = stripLuaLineComments(text);
  const prefix = `(?:^|[^A-Za-z0-9_])${field}`;
  const stringMatch = stripped.match(new RegExp(`${prefix}\\s*=\\s*"([^"]+)"\\s*,`));
  if (stringMatch) return stringMatch[1];
  const falseMatch = stripped.match(new RegExp(`${prefix}\\s*=\\s*false\\s*,`));
  if (falseMatch) return null;
  return undefined;
}

function parseLuaBooleanField(text, field) {
  const prefix = `(?:^|[^A-Za-z0-9_])${field}`;
  const match = stripLuaLineComments(text).match(new RegExp(`${prefix}\\s*=\\s*(true|false)\\s*,`));
  return match ? match[1] === "true" : undefined;
}

function parseArtifactMetadata(block) {
  const match = /artifact\s*=\s*\{/g.exec(block);
  if (!match) return undefined;
  const artifactBlock = parseTemplateBlock(block, "artifact", match.index);
  const artifact = {};
  for (const field of [
    "kind",
    "scope",
    "ref_prefix",
    "schema",
    "path_shape",
  ]) {
    const value = parseLuaStringOrFalseField(artifactBlock, field);
    if (value !== undefined) artifact[field] = value;
  }
  const readScope = parseLuaStringOrFalseField(artifactBlock, "read_scope");
  if (readScope !== undefined) artifact.read_scope = readScope;
  for (const field of ["updates_last_result", "legacy_carve_out"]) {
    const value = parseLuaBooleanField(artifactBlock, field);
    if (value !== undefined) artifact[field] = value;
  }
  return artifact;
}

export function parseManifestLua(text) {
  text = stripLuaLineComments(text);
  const templatesStart = text.indexOf("templates = {");
  if (templatesStart === -1) {
    throw new Error(`${MANIFEST_FORMAT_UNEXPECTED}: templates table not found`);
  }

  const found = new Map();
  const entryRe = /([A-Za-z0-9_]+)\s*=\s*\{/g;
  entryRe.lastIndex = templatesStart;

  for (;;) {
    const match = entryRe.exec(text);
    if (!match) break;

    const name = match[1];
    if (name === "entity_buckets" || name === "templates") continue;
    const range = parseTemplateBlockRange(text, name, match.index);
    const block = range.block;
    entryRe.lastIndex = range.endIndex;

    const undoableMatch = block.match(/undoable\s*=\s*(true|false)\s*,/);
    const entityKindMatch = block.match(/entity_kind\s*=\s*"([^"]+)"\s*,/);
    if (!undoableMatch || !entityKindMatch) {
      throw new Error(`${MANIFEST_FORMAT_UNEXPECTED}: missing undoable/entity_kind for ${name}`);
    }

    const undoable = undoableMatch[1] === "true";
    if (/undo_flags\s*=\s*[^\n,]+\n\s*\|/.test(block)) {
      throw new Error(`${MANIFEST_FORMAT_UNEXPECTED}: multi-line undo_flags for ${name}`);
    }
    const undoFlagsMatches = [...block.matchAll(/undo_flags\s*=\s*([^\n,]+),/g)];
    if (undoFlagsMatches.length > 1) {
      throw new Error(`${MANIFEST_FORMAT_UNEXPECTED}: multiple undo_flags lines for ${name}`);
    }

    const undoFlags = new Set();
    if (undoFlagsMatches.length === 1) {
      const expr = undoFlagsMatches[0][1];
      for (const token of expr.split("|").map((part) => part.trim())) {
        const flagName = token.replace(/^undo\./, "");
        const mapped = UNDO_FLAG_FROM_LUA[flagName];
        if (!mapped) {
          throw new Error(
            `${MANIFEST_FORMAT_UNEXPECTED}: unsupported undo flag '${token}' for ${name}`,
          );
        }
        undoFlags.add(mapped);
      }
    }

    const artifact = parseArtifactMetadata(block);
    found.set(name, {
      undoable,
      undo_flags: sorted(undoFlags),
      entity_kind: entityKindMatch[1],
      ...(artifact !== undefined ? { artifact } : {}),
    });
  }

  return found;
}

function parseLuaStringField(text, field) {
  const re = new RegExp(`${field}\\s*=\\s*"([^"]+)"\\s*,`);
  const match = stripLuaLineComments(text).match(re);
  return match ? match[1] : undefined;
}

export function parseManifestEntityBuckets(text) {
  text = stripLuaLineComments(text);
  const start = text.indexOf("entity_buckets = {");
  if (start === -1) return new Map();

  const block = parseTemplateBlock(text, "entity_buckets", start);
  const buckets = new Map();
  for (const match of block.matchAll(/([A-Za-z0-9_]+)\s*=\s*"([^"]+)"\s*,?/g)) {
    buckets.set(match[1], match[2]);
  }
  return buckets;
}

export function parseManifestLuaFull(text) {
  return {
    name: parseLuaStringField(text, "name"),
    version: parseLuaStringField(text, "version"),
    entity_buckets: parseManifestEntityBuckets(text),
    templates: parseManifestLua(text),
  };
}

export function buildRegistrySnapshot(registry) {
  const snapshot = new Map();
  for (const def of registry.rawDefinitions()) {
    const entry = {
      pack: def.pack,
      mutates: def.mutates,
      undoable: def.undoable,
      undo_flags: sorted(def.undo_flags),
      entity_kind: def.entity_kind,
    };
    if (def.expectedDelta !== undefined) {
      entry.expectedDelta = { ...def.expectedDelta };
    }
    if (def.artifact !== undefined) {
      entry.artifact = { ...def.artifact };
    }
    snapshot.set(def.name, entry);
  }
  return snapshot;
}

function sameArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeArtifact(artifact) {
  if (artifact === undefined) return undefined;
  const out = {};
  for (const key of Object.keys(artifact).sort()) {
    if (artifact[key] !== undefined) out[key] = artifact[key];
  }
  return out;
}

function sameArtifact(a, b) {
  return JSON.stringify(normalizeArtifact(a)) === JSON.stringify(normalizeArtifact(b));
}

function validateExpectedDeltaDescriptor(name, tsDef) {
  const errors = [];
  const expected = tsDef.expectedDelta;

  if (tsDef.mutates && tsDef.undoable && expected === undefined) {
    errors.push(`EXPECTED_DELTA_MISSING:${name}`);
  }
  if (!tsDef.undoable && expected !== undefined) {
    errors.push(`EXPECTED_DELTA_FOR_NON_UNDOABLE:${name}`);
  }
  if (expected !== undefined) {
    const activeModes = [
      expected.creates,
      expected.maybeCreates,
      expected.deletes,
    ].filter(Boolean).length;
    if (activeModes > 1) {
      errors.push(
        `EXPECTED_DELTA_INVALID:${name}: creates/maybeCreates/deletes are mutually exclusive`,
      );
    }
    if (expected.maybeCreates && expected.count === "any") {
      errors.push(
        `EXPECTED_DELTA_INVALID:${name}: maybeCreates requires a numeric count`,
      );
    }
    errors.push(...validateExpectedDeltaFields(name, expected));
  }

  return errors;
}

function validateExpectedDeltaFields(name, expected) {
  const errors = [];
  const fields = expected.fields;
  if (fields === undefined) return errors;

  if (!Array.isArray(fields) || fields.length === 0) {
    return [`EXPECTED_DELTA_INVALID:${name}: fields must be a non-empty array when present`];
  }
  if (expected.deletes) {
    errors.push(
      `EXPECTED_DELTA_INVALID:${name}: fields cannot coexist with deletes`,
    );
  }
  if (expected.maybeCreates) {
    if (
      typeof expected.count !== "number" ||
      !Number.isFinite(expected.count) ||
      Math.floor(expected.count) !== expected.count ||
      expected.count < 1
    ) {
      errors.push(
        `EXPECTED_DELTA_INVALID:${name}: fields with maybeCreates:true requires numeric count >= 1`,
      );
    }
  }
  if (expected.creates) {
    const hasValidNumericCount =
      typeof expected.count === "number" &&
      Number.isFinite(expected.count) &&
      Math.floor(expected.count) === expected.count &&
      expected.count >= 1;
    if (expected.count !== "any" && !hasValidNumericCount) {
      errors.push(
        `EXPECTED_DELTA_INVALID:${name}: fields with creates:true requires count "any" or numeric >= 1`,
      );
    }
  }

  const seen = new Set();
  let optionalCount = 0;
  let nullableCount = 0;
  for (const [i, field] of fields.entries()) {
    if (!field || typeof field !== "object") {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] must be an object`);
      continue;
    }
    if (typeof field.field !== "string" || field.field.length === 0) {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] missing field`);
    }
    if (!["take", "item", "track", "region"].includes(field.scope)) {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] has invalid scope`);
    }
    if (typeof field.paramPath !== "string" || field.paramPath.length === 0) {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] missing paramPath`);
    } else if (field.paramPath.includes(".")) {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] paramPath must be top-level`);
    }
    if (
      field.tolerance !== undefined &&
      (!Number.isFinite(field.tolerance) || field.tolerance < 0)
    ) {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] invalid tolerance`);
    }
    if (field.optional !== undefined && typeof field.optional !== "boolean") {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] optional must be boolean`);
    }
    if (field.nullable !== undefined && typeof field.nullable !== "boolean") {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: fields[${i}] nullable must be boolean`);
    }
    if (field.optional === true) optionalCount += 1;
    if (field.nullable === true) nullableCount += 1;

    const key = `${field.scope}:${field.field}`;
    if (seen.has(key)) {
      errors.push(`EXPECTED_DELTA_INVALID:${name}: duplicate field ${key}`);
    }
    seen.add(key);
  }
  if (optionalCount === fields.length && nullableCount !== fields.length) {
    errors.push(`EXPECTED_DELTA_INVALID:${name}: fields may be all-optional only when every field is nullable`);
  }

  return errors;
}

export function diffManifestAlignment(tsSnapshot, luaSnapshot) {
  const errors = [];
  for (const [name, tsDef] of tsSnapshot.entries()) {
    errors.push(...validateExpectedDeltaDescriptor(name, tsDef));
    const luaDef = luaSnapshot.get(name);
    if (!luaDef) {
      errors.push(`MISSING_IN_LUA:${name}`);
      continue;
    }
    for (const field of ["entity_kind", "undoable"]) {
      if (tsDef[field] !== luaDef[field]) {
        errors.push(
          `FIELD_MISMATCH:${name}.${field}: ts=${JSON.stringify(tsDef[field])} lua=${JSON.stringify(luaDef[field])}`,
        );
      }
    }
    if (!sameArray(tsDef.undo_flags, luaDef.undo_flags)) {
      errors.push(
        `FIELD_MISMATCH:${name}.undo_flags: ts=${JSON.stringify(tsDef.undo_flags)} lua=${JSON.stringify(luaDef.undo_flags)}`,
      );
    }
    if (!sameArtifact(tsDef.artifact, luaDef.artifact)) {
      errors.push(
        `FIELD_MISMATCH:${name}.artifact: ts=${JSON.stringify(normalizeArtifact(tsDef.artifact))} lua=${JSON.stringify(normalizeArtifact(luaDef.artifact))}`,
      );
    }
  }

  for (const name of luaSnapshot.keys()) {
    if (!tsSnapshot.has(name)) {
      errors.push(`MISSING_IN_TS:${name}`);
    }
  }
  return errors;
}

export function filterRegistrySnapshotByPack(tsSnapshot, pack) {
  const filtered = new Map();
  for (const [name, entry] of tsSnapshot.entries()) {
    if (entry.pack === pack) filtered.set(name, entry);
  }
  return filtered;
}

export function diffPackManifestAlignment(pack, tsSnapshot, manifest) {
  const errors = [];
  if (manifest.name !== pack) {
    errors.push(
      `PACK_NAME_MISMATCH:${pack}: lua=${JSON.stringify(manifest.name)}`,
    );
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    errors.push(`PACK_VERSION_MISSING:${pack}`);
  }
  errors.push(
    ...diffManifestAlignment(
      filterRegistrySnapshotByPack(tsSnapshot, pack),
      manifest.templates,
    ),
  );
  return errors;
}

export function diffEntityBucketConflicts(manifests) {
  const errors = [];
  const byKind = new Map();
  const byBucket = new Map();
  let coreSeen = false;

  for (const manifest of manifests) {
    const pack = manifest.name || "<unknown>";
    if (pack === "core") coreSeen = true;
    for (const [kind, bucket] of manifest.entity_buckets.entries()) {
      const previousBucket = byKind.get(kind);
      if (pack !== "core" && previousBucket === undefined) {
        errors.push(
          `ENTITY_BUCKET_NON_CORE_NEW_KIND:${pack}.${kind}: non-core packs may only reuse core entity kinds in Slice 20B`,
        );
      }
      if (previousBucket !== undefined && previousBucket !== bucket) {
        errors.push(
          `ENTITY_BUCKET_KIND_CONFLICT:${kind}: ${previousBucket} vs ${bucket} in ${pack}`,
        );
      }
      byKind.set(kind, bucket);

      const previousKind = byBucket.get(bucket);
      if (previousKind !== undefined && previousKind !== kind) {
        errors.push(
          `ENTITY_BUCKET_NAME_CONFLICT:${bucket}: ${previousKind} vs ${kind} in ${pack}`,
        );
      }
      byBucket.set(bucket, kind);
    }
  }

  if (!coreSeen) {
    errors.push("ENTITY_BUCKET_CORE_MISSING: enabled packs must include core first");
  }

  return errors;
}

export async function buildRealRegistrySnapshot({
  CapabilityRegistry,
  registerEnabledTemplates,
  enabledPacks,
}) {
  const registry = new CapabilityRegistry();
  registerEnabledTemplates(registry, enabledPacks);
  return buildRegistrySnapshot(registry);
}

async function main() {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const [
    { CapabilityRegistry },
    { parseEnabledPacks },
    { registerEnabledTemplates },
  ] = await Promise.all([
    import(pathToFileURL(path.join(repoRoot, "packages/core/dist/registry.js")).href),
    import(pathToFileURL(path.join(repoRoot, "packages/core/dist/packs.js")).href),
    import(pathToFileURL(path.join(repoRoot, "packages/mcp-server/dist/templates/index.js")).href),
  ]);
  const enabledPacks = parseEnabledPacks(process.env.STREETLIGHT_ENABLED_PACKS);
  const tsSnapshot = await buildRealRegistrySnapshot({
    CapabilityRegistry,
    registerEnabledTemplates,
    enabledPacks,
  });

  const manifests = [];
  for (const pack of enabledPacks) {
    const manifestPath = path.join(repoRoot, "reaper/packs", pack, "manifest.lua");
    const manifestText = await fs.readFile(manifestPath, "utf8");
    const manifest = parseManifestLuaFull(manifestText);
    manifests.push(manifest);
  }

  const errors = [
    ...diffEntityBucketConflicts(manifests),
    ...manifests.flatMap((manifest, index) =>
      diffPackManifestAlignment(enabledPacks[index], tsSnapshot, manifest),
    ),
  ];

  if (errors.length > 0) {
    process.stderr.write(`Streetlight manifest alignment failed:\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `Streetlight manifest alignment ok (${tsSnapshot.size} templates across ${enabledPacks.length} pack(s)).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(`${e?.stack ?? e}\n`);
    process.exit(1);
  });
}

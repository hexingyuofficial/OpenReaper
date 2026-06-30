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

function parseTemplateBlock(body, name, startIndex) {
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
      if (depth === 0) return body.slice(open + 1, i);
    }
  }
  throw new Error(`${MANIFEST_FORMAT_UNEXPECTED}: unclosed block for ${name}`);
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
    const block = parseTemplateBlock(text, name, match.index);

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

    found.set(name, {
      undoable,
      undo_flags: sorted(undoFlags),
      entity_kind: entityKindMatch[1],
    });
  }

  return found;
}

export function buildRegistrySnapshot(registry) {
  const snapshot = new Map();
  for (const def of registry.rawDefinitions()) {
    const entry = {
      mutates: def.mutates,
      undoable: def.undoable,
      undo_flags: sorted(def.undo_flags),
      entity_kind: def.entity_kind,
    };
    if (def.expectedDelta !== undefined) {
      entry.expectedDelta = { ...def.expectedDelta };
    }
    snapshot.set(def.name, entry);
  }
  return snapshot;
}

function sameArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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
  if (
    (expected.creates || expected.maybeCreates) &&
    (typeof expected.count !== "number" ||
      !Number.isFinite(expected.count) ||
      Math.floor(expected.count) !== expected.count ||
      expected.count < 1)
  ) {
    const mode = expected.creates ? "creates:true" : "maybeCreates:true";
    errors.push(
      `EXPECTED_DELTA_INVALID:${name}: fields with ${mode} requires numeric count >= 1`,
    );
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
    if (!["take", "item", "track"].includes(field.scope)) {
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
  }

  for (const name of luaSnapshot.keys()) {
    if (!tsSnapshot.has(name)) {
      errors.push(`MISSING_IN_TS:${name}`);
    }
  }
  return errors;
}

export async function buildRealRegistrySnapshot({
  CapabilityRegistry,
  registerCoreTemplates,
}) {
  const registry = new CapabilityRegistry();
  registerCoreTemplates(registry);
  return buildRegistrySnapshot(registry);
}

async function main() {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const [{ CapabilityRegistry }, { registerCoreTemplates }] = await Promise.all([
    import(pathToFileURL(path.join(repoRoot, "packages/core/dist/registry.js")).href),
    import(pathToFileURL(path.join(repoRoot, "packages/mcp-server/dist/templates/index.js")).href),
  ]);
  const manifestPath = path.join(repoRoot, "reaper/packs/core/manifest.lua");
  const manifestText = await fs.readFile(manifestPath, "utf8");
  const luaSnapshot = parseManifestLua(manifestText);
  const tsSnapshot = await buildRealRegistrySnapshot({
    CapabilityRegistry,
    registerCoreTemplates,
  });
  const errors = diffManifestAlignment(tsSnapshot, luaSnapshot);

  if (errors.length > 0) {
    process.stderr.write(`Streetlight manifest alignment failed:\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exit(1);
  }
  process.stdout.write(`Streetlight manifest alignment ok (${tsSnapshot.size} templates).\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(`${e?.stack ?? e}\n`);
    process.exit(1);
  });
}

#!/usr/bin/env node

/**
 * Template authoring lint — Slice 16.
 *
 * Enforces two author-side contracts that today only get caught at reviewer
 * time:
 *
 * 1. examples-against-Zod: every `definition.examples[i].params` must parse
 *    cleanly against the template's own Zod `params` schema. Examples are
 *    positive-only by convention (Slice 16 S16-C2) — there is no skip
 *    marker. Negative fixtures live in this script's own tests.
 *
 * 2. slug parity: every file in `packages/mcp-server/src/templates/` (except
 *    `_shared.ts` and `index.ts`) must correspond to a registered template
 *    whose `definition.name.replace(/_/g, "-")` equals the file's basename.
 *    Conversely, every registered template must have a matching file.
 *
 * Style follows `scripts/error-codes.mjs` and `scripts/manifest-alignment.mjs`:
 * pure helper functions are exported so vitest can call them with synthetic
 * fixtures; the CLI entry walks the real repo and imports from dist/ so it
 * runs under plain `node` after `npm run build`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEMPLATE_DIRS_BY_PACK = {
  core: "packages/mcp-server/src/templates",
  cleanup: "packages/mcp-server/src/packs/cleanup",
  pack_contract_fixture: "packages/mcp-server/src/packs/pack-contract-fixture",
};
const TEMPLATES_SUBDIR = TEMPLATE_DIRS_BY_PACK.core;
const TEMPLATE_HELPER_FILES = new Set(["_shared.ts", "index.ts"]);

/**
 * Convert a registered template name (snake_case) to its expected TS file
 * basename (kebab-case, no extension).
 */
export function templateSlug(name) {
  return name.replace(/_/g, "-");
}

/**
 * Given a Zod issue list (from `safeParse(...).error.issues`), produce a
 * compact human-readable string. Path segments are joined with `.`, `<root>`
 * is used for an empty path, and multiple issues are joined with `; `.
 */
export function formatZodIssues(issues) {
  return issues
    .map((issue) => {
      const where = issue.path.length === 0 ? "<root>" : issue.path.join(".");
      return `${where}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * For each registered definition, attempt to parse each example's params on
 * the definition's own Zod schema. Returns an array of error strings.
 *
 * Error shape:
 *   EXAMPLE_REJECTED_BY_SCHEMA:<name>:examples[<i>]: <formatted issues>
 *
 * The `description` (when present) is appended in parentheses to make the
 * failure easier to find in a template file with multiple examples.
 */
export function findExampleSchemaMismatches(definitions) {
  const errors = [];
  for (const def of definitions) {
    if (!Array.isArray(def.examples)) continue;
    for (const [i, example] of def.examples.entries()) {
      const result = def.params.safeParse(example.params);
      if (result.success) continue;
      const formatted = formatZodIssues(result.error.issues);
      const tag = example.description ? ` (${example.description})` : "";
      errors.push(
        `EXAMPLE_REJECTED_BY_SCHEMA:${def.name}:examples[${i}]${tag}: ${formatted}`,
      );
    }
  }
  return errors;
}

/**
 * Compare the set of registered template names to the set of template file
 * basenames. Reports both missing files (registered but no source file) and
 * orphan files (file exists but no registered template uses that slug).
 *
 * `templateFiles` is the *basename* list (e.g. ["item-pitch.ts",
 * "track-create.ts", ...]). Helper files (`_shared.ts`, `index.ts`) and any
 * non-.ts file are expected to have already been filtered out by the caller
 * so that synthetic fixtures can drive this function directly.
 */
export function findSlugMismatches(definitions, templateFiles) {
  const errors = [];
  const fileSet = new Set(templateFiles);
  const expectedFiles = new Set(
    definitions.map((def) => `${templateSlug(def.name)}.ts`),
  );

  for (const def of definitions) {
    const expected = `${templateSlug(def.name)}.ts`;
    if (!fileSet.has(expected)) {
      errors.push(
        `SLUG_MISSING_FILE:${def.name}: expected file ${expected} in ${TEMPLATES_SUBDIR}/`,
      );
    }
  }

  for (const fname of templateFiles) {
    if (expectedFiles.has(fname)) continue;
    errors.push(
      `SLUG_ORPHAN_FILE:${fname}: no registered template matches slug "${fname.replace(/\.ts$/, "").replace(/-/g, "_")}"`,
    );
  }

  return errors;
}

/**
 * Convenience: run both checks against a definitions list + file list.
 * Returns concatenated errors. Caller decides exit code.
 */
export function lintDefinitions(definitions, templateFiles) {
  return [
    ...findExampleSchemaMismatches(definitions),
    ...findSlugMismatches(definitions, templateFiles),
  ];
}

/**
 * List template basenames under `packages/mcp-server/src/templates/`,
 * excluding helper files (`_shared.ts`, `index.ts`) and any non-.ts file.
 */
export async function readTemplateFilenames(repoRoot, enabledPacks = ["core"]) {
  const names = [];
  for (const pack of enabledPacks) {
    const rel = TEMPLATE_DIRS_BY_PACK[pack];
    if (!rel) throw new Error(`Unknown pack id for template lint: ${pack}`);
    const dir = path.join(repoRoot, rel);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (TEMPLATE_HELPER_FILES.has(entry.name)) continue;
      names.push(entry.name);
    }
  }
  return names.sort();
}

async function cmdCheck() {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const [coreRegistry, corePacks, templates] = await Promise.all([
    import(pathToFileURL(path.join(repoRoot, "packages/core/dist/registry.js")).href),
    import(pathToFileURL(path.join(repoRoot, "packages/core/dist/packs.js")).href),
    import(pathToFileURL(path.join(repoRoot, "packages/mcp-server/dist/templates/index.js")).href),
  ]);

  const registry = new coreRegistry.CapabilityRegistry();
  const enabledPacks = corePacks.parseEnabledPacks(process.env.STREETLIGHT_ENABLED_PACKS);
  templates.registerEnabledTemplates(registry, enabledPacks);
  const definitions = registry.rawDefinitions();
  const templateFiles = await readTemplateFilenames(repoRoot, enabledPacks);

  const errors = lintDefinitions(definitions, templateFiles);
  if (errors.length > 0) {
    process.stderr.write("Streetlight template authoring lint failed:\n");
    for (const entry of errors) process.stderr.write(`- ${entry}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `Streetlight template authoring ok (${definitions.length} templates).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cmdCheck().catch((e) => {
    process.stderr.write(`${e?.stack ?? e}\n`);
    process.exit(1);
  });
}

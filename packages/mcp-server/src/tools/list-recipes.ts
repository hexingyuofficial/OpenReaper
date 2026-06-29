import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { z } from "zod";
import { type Result, ok } from "@streetlight/core";

/**
 * Envelope-only Zod schema per Step 7 decision A5: validate the top-level
 * shape (id/description/inputs/steps), passthrough everything else.
 * Placeholder syntax and template-param shapes are NOT validated here —
 * recipes are agent-readable docs, not server-executed. Agent runtime is
 * responsible for resolving `{{ ... }}` and template params.
 */
const RecipeEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    version: z.union([z.string(), z.number()]).optional(),
    inputs: z.record(z.unknown()).optional(),
    steps: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type RecipeMetadata = z.infer<typeof RecipeEnvelopeSchema>;

export interface RecipeWarning {
  file: string;
  error: string;
}

export interface ListRecipesResult {
  recipes: RecipeMetadata[];
  recipes_dir: string;
  warnings: RecipeWarning[];
}

/**
 * Find the recipes directory. Priority:
 *   1. STREETLIGHT_RECIPES_DIR env override (absolute path)
 *   2. walk up from this module's path looking for a sibling `recipes/`
 *      directory — works from `src/` (vitest), `dist/` (compiled), or any
 *      depth inside `packages/<x>/`.
 * Returns an absolute path. The path may not exist on disk; the caller
 * surfaces that as a warning.
 */
export function resolveRecipesDir(): string {
  const override = process.env.STREETLIGHT_RECIPES_DIR;
  if (override && override.length > 0) {
    return path.resolve(override);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, "recipes");
    try {
      const stat = statSync(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // not found at this level; keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to a deterministic guess relative to this module so the path
  // shown in the warning points somewhere sensible.
  return path.resolve(here, "..", "..", "..", "..", "recipes");
}

async function loadOneRecipe(
  fullPath: string,
): Promise<
  { ok: true; recipe: RecipeMetadata } | { ok: false; error: string }
> {
  let text: string;
  try {
    text = await fs.readFile(fullPath, "utf8");
  } catch (e) {
    return { ok: false, error: `read failed: ${(e as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (e) {
    return { ok: false, error: `YAML parse failed: ${(e as Error).message}` };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, error: "YAML root is not an object" };
  }
  const result = RecipeEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `schema validation failed: ${issues}` };
  }
  return { ok: true, recipe: result.data };
}

/**
 * Step 7 MVP tool. Re-reads every call per decision A3 — no caching.
 * Per A4: bad files emit a stderr warning AND surface in result.warnings;
 * never returns ok:false for a single bad recipe. The tool only fails if
 * the listing infrastructure itself breaks (e.g. EACCES on the dir).
 */
export async function listRecipes(): Promise<Result<ListRecipesResult>> {
  const recipesDir = resolveRecipesDir();
  const warnings: RecipeWarning[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(recipesDir);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const warning: RecipeWarning = {
        file: recipesDir,
        error: "recipes directory not found",
      };
      process.stderr.write(
        `[streetlight-mcp] list_recipes: ${warning.error} at ${recipesDir}\n`,
      );
      return ok({ recipes: [], recipes_dir: recipesDir, warnings: [warning] });
    }
    throw e;
  }
  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const recipes: RecipeMetadata[] = [];
  for (const name of yamlFiles) {
    const full = path.join(recipesDir, name);
    const loaded = await loadOneRecipe(full);
    if (loaded.ok) {
      recipes.push(loaded.recipe);
    } else {
      const warning: RecipeWarning = { file: name, error: loaded.error };
      warnings.push(warning);
      process.stderr.write(
        `[streetlight-mcp] list_recipes: skipping ${name} — ${loaded.error}\n`,
      );
    }
  }
  return ok({ recipes, recipes_dir: recipesDir, warnings });
}

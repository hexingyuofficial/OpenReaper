import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TOOL_ABI_V1_TOOL_NAMES } from "../packages/mcp-server/src/tool-abi-v1.mjs";
import { ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS } from "../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX,
  EXECUTABLE_RECIPE_STORE_CONTRACT,
  EXECUTABLE_RECIPE_STORE_ERROR_CODES,
} from "../packages/core/src/executable-recipe-revision-store-v1.mjs";
import { USER_EXECUTABLE_RECIPE_REVISION_SUFFIX } from "../packages/core/src/user-recipe-authoring-v1.mjs";

const root = process.cwd();
const storePath = path.join(root, "packages/core/src/executable-recipe-revision-store-v1.mjs");
const authoringPath = path.join(root, "packages/core/src/user-recipe-authoring-v1.mjs");
const storeSource = readFileSync(storePath, "utf8");
const authoringSource = readFileSync(authoringPath, "utf8");

if (EXECUTABLE_RECIPE_STORE_CONTRACT !== "recipe.executable.store.v1") {
  console.error("Executable recipe store contract id drifted.");
  process.exit(1);
}

if (EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX !== USER_EXECUTABLE_RECIPE_REVISION_SUFFIX) {
  console.error("Store revision suffix must match user authoring executable revision suffix.");
  process.exit(1);
}

if (EXECUTABLE_RECIPE_REVISION_FILE_SUFFIX !== ".executable-revision.json") {
  console.error("Executable revision file suffix must remain .executable-revision.json.");
  process.exit(1);
}

const requiredExports = [
  "createExecutableRecipeRevisionStore",
  "validateExecutableRecipeRevisionStoreInput",
  "saveExecutableRecipeRevision",
  "listExecutableRecipeRevisions",
  "getExecutableRecipeRevision",
  "deleteExecutableRecipeRevision",
  "sealExecutableRecipeRevision",
  "validateExecutableRecipeRevision",
];

for (const name of requiredExports) {
  if (!storeSource.includes(name) && name.startsWith("seal")) {
    // seal is imported from the E0 contract module, not reimplemented here
    if (!storeSource.includes("sealExecutableRecipeRevision")) {
      console.error("Store must reuse E0 sealExecutableRecipeRevision.");
      process.exit(1);
    }
    continue;
  }
  if (name === "validateExecutableRecipeRevision") {
    if (!storeSource.includes("validateExecutableRecipeRevision")) {
      console.error("Store must reuse E0 validateExecutableRecipeRevision.");
      process.exit(1);
    }
    continue;
  }
  if (!storeSource.includes(name)) {
    console.error(`Executable recipe revision store is missing ${name}.`);
    process.exit(1);
  }
}

const forbidden = [
  [/packages\/mcp-server/, "mcp-server import"],
  [/alpha3-d2-workflow-entrypoints/, "private D2 workflow entrypoint import"],
  [/function\s+(?:executeRecipe|runRecipe)|registerTool\(\s*["']call_recipe["']|\bcall_recipe\s*\(/i, "execution surface"],
  [/\b(?:runExecutable|resumeExecutable|dispatchExecutable)\b/, "run/resume/dispatch surface"],
  [/node:child_process|child_process|spawn\(|execFile\(|execSync\(|exec\(/, "process execution helper"],
  [/\breaper\/bridge\b|REAPER\.app|\breaper\.Main_OnCommand\s*\(|NamedCommandLookup\s*\(|os\.execute\s*\(|io\.popen\s*\(/, "runtime or action bypass"],
];

for (const [pattern, label] of forbidden) {
  if (pattern.test(storeSource)) {
    console.error(`executable-recipe-revision-store-v1.mjs contains forbidden ${label}.`);
    process.exit(1);
  }
}

if (
  !(storeSource.includes("linkSync") || storeSource.includes("renameSync"))
  || !storeSource.includes(".tmp")
  || !storeSource.includes("\"wx\"")
) {
  console.error("Store must use exclusive temp creation plus no-clobber atomic publication.");
  process.exit(1);
}

if (!storeSource.includes("normalizeExactRevisionIdentity") && !storeSource.includes("buildExecutableRecipeRevisionIdentity")) {
  console.error("Store must expose or reuse a complete exact revision identity helper.");
  process.exit(1);
}

if (storeSource.includes("__testOnlyBeforeAtomicLink")) {
  console.error("Store must not ship product test hooks for atomic publication.");
  process.exit(1);
}

if (!storeSource.includes("pickCallerOptions") && !storeSource.includes("boundReserved")) {
  console.error("Store factory must bind root/source/catalog/reserved ownership so callers cannot override them.");
  process.exit(1);
}

if (!storeSource.includes("sealExecutableRecipeRevision") || !storeSource.includes("normalizeExecutableRecipeRevision")) {
  console.error("Store must reuse accepted E0 seal/normalize helpers.");
  process.exit(1);
}

if (!authoringSource.includes("USER_EXECUTABLE_RECIPE_REVISION_SUFFIX") || !authoringSource.includes("executable_revisions")) {
  console.error("User recipe authoring must continue loading executable revisions.");
  process.exit(1);
}

if (!authoringSource.includes("USER_EXECUTABLE_RECIPE_STORE_CONTRACT") && !authoringSource.includes("recipe.executable.store.v1")) {
  console.error("User recipe authoring must acknowledge the executable store contract id.");
  process.exit(1);
}

const expectedTools = ["ping", "get_state", "list_templates", "list_recipes", "call_template", "call_recipe"];
if (JSON.stringify([...TOOL_ABI_V1_TOOL_NAMES].sort()) !== JSON.stringify([...expectedTools].sort())) {
  console.error("Public MCP tool surface must remain exactly six tools including call_recipe.");
  process.exit(1);
}
if (TOOL_ABI_V1_TOOL_NAMES.length !== 6) {
  console.error("Public MCP tool count drifted.");
  process.exit(1);
}
// E1 store itself must remain non-executing.
if (storeSource.includes("function run(") || /\bstore\.run\b/.test(storeSource)) {
  console.error("E1 store must not gain run execution.");
  process.exit(1);
}
if (ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length !== 15) {
  console.error("Visible macro count must remain 15.");
  process.exit(1);
}
if (CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length !== 237) {
  console.error("Accepted template count must remain 237.");
  process.exit(1);
}

for (const code of [
  "PARAMS_INVALID",
  "REVISION_INVALID",
  "REVISION_NOT_FOUND",
  "REVISION_CONFLICT",
  "PATH_ESCAPE",
  "SYMLINK_ESCAPE",
  "DELETE_CONFIRMATION_REQUIRED",
  "DELETE_IDENTITY_MISMATCH",
  "STORE_CORRUPT",
  "STORE_BUDGET_EXCEEDED",
]) {
  if (!EXECUTABLE_RECIPE_STORE_ERROR_CODES.includes(code)) {
    console.error(`Missing store error code: ${code}`);
    process.exit(1);
  }
}

if (!storeSource.includes("EXECUTABLE_RECIPE_STORE_BUDGETS") || !storeSource.includes("max_scan_files")) {
  console.error("Store must define fixed scan/item/byte budgets.");
  process.exit(1);
}

if (!storeSource.includes("captureFileIdentityFacts") || !storeSource.includes("sameFileIdentityFacts")) {
  console.error("Store must final-recheck file identity facts before delete.");
  process.exit(1);
}

if (!storeSource.includes("assertStorePathHasNoOrdinarySymlinkAncestors")) {
  console.error("Store must reject ordinary symlink ancestors on store roots.");
  process.exit(1);
}

execFileSync(process.execPath, ["--test", "tests/alpha3/alpha3-4-e1-executable-recipe-revision-store.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Executable recipe revision store v1 checks ok.");

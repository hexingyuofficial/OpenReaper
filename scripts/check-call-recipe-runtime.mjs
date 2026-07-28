import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TOOL_ABI_V1_TOOL_NAMES } from "../packages/mcp-server/src/tool-abi-v1.mjs";
import { ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS } from "../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  CALL_RECIPE_OPERATIONS,
  CALL_RECIPE_RUNTIME_CONTRACT,
  CALL_RECIPE_TOOL_NAME,
} from "../packages/mcp-server/src/call-recipe-runtime-v1.mjs";

const root = process.cwd();
const runtimePath = path.join(root, "packages/mcp-server/src/call-recipe-runtime-v1.mjs");
const runHelperPath = path.join(root, "packages/core/src/executable-recipe-run-v1.mjs");
const storePath = path.join(root, "packages/core/src/executable-recipe-revision-store-v1.mjs");
const stdioPath = path.join(root, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const toolAbiPath = path.join(root, "packages/mcp-server/src/tool-abi-v1.mjs");
const abiToolDoc = path.join(root, "docs/abi/TOOL_ABI_V1.md");
const abiRecipeDoc = path.join(root, "docs/abi/RECIPE_CONTRACT_V1.md");

const runtimeSource = readFileSync(runtimePath, "utf8");
const runHelperSource = readFileSync(runHelperPath, "utf8");
const storeSource = readFileSync(storePath, "utf8");
const stdioSource = readFileSync(stdioPath, "utf8");
const toolAbiSource = readFileSync(toolAbiPath, "utf8");
const toolDoc = readFileSync(abiToolDoc, "utf8");
const recipeDoc = readFileSync(abiRecipeDoc, "utf8");

if (CALL_RECIPE_RUNTIME_CONTRACT !== "call_recipe.runtime.v1") {
  console.error("call_recipe runtime contract drifted.");
  process.exit(1);
}
if (CALL_RECIPE_TOOL_NAME !== "call_recipe") {
  console.error("call_recipe tool name drifted.");
  process.exit(1);
}

const expectedOps = ["validate", "save", "list", "get", "delete", "run", "resume"];
if (JSON.stringify([...CALL_RECIPE_OPERATIONS]) !== JSON.stringify(expectedOps)) {
  console.error("call_recipe operations drifted.");
  process.exit(1);
}

const expectedTools = ["ping", "get_state", "list_templates", "list_recipes", "call_template", "call_recipe"];
if (JSON.stringify([...TOOL_ABI_V1_TOOL_NAMES].sort()) !== JSON.stringify([...expectedTools].sort())) {
  console.error("Public tool surface must be exactly six tools including call_recipe.");
  process.exit(1);
}
if (TOOL_ABI_V1_TOOL_NAMES.length !== 6) {
  console.error("Public tool count must be 6.");
  process.exit(1);
}
if (ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length !== 15) {
  console.error("Visible macro count must remain 15.");
  process.exit(1);
}
if (CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length !== 239) {
  console.error("Accepted template count must remain 239.");
  process.exit(1);
}

for (const needle of [
  "createCallRecipeRuntime",
  "call_recipe",
  "INLINE_EXECUTION_FORBIDDEN",
  "preflightExecutableRecipeRevision",
  "READBACK_UNVERIFIED",
  "pageExecutableRecipeEvidence",
  "resume_safe",
  "next_call",
]) {
  if (!runtimeSource.includes(needle) && !runHelperSource.includes(needle)) {
    console.error(`call_recipe runtime missing required surface: ${needle}`);
    process.exit(1);
  }
}

if (!stdioSource.includes('"call_recipe"') || !stdioSource.includes("createCallRecipeRuntime")) {
  console.error("stdio must register call_recipe.");
  process.exit(1);
}
if ((stdioSource.match(/server\.tool\(/g) ?? []).length !== 6) {
  console.error("stdio must register exactly six tools.");
  process.exit(1);
}
if (!toolAbiSource.includes("call_recipe")) {
  console.error("tool-abi-v1.mjs must include call_recipe.");
  process.exit(1);
}
if (!toolDoc.includes("call_recipe") || !toolDoc.includes("exactly six")) {
  console.error("TOOL_ABI_V1.md must document six tools including call_recipe.");
  process.exit(1);
}
if (!recipeDoc.includes("Alpha3.4-E2 Public `call_recipe` Runtime")) {
  console.error("RECIPE_CONTRACT_V1.md must document Alpha3.4-E2 call_recipe runtime.");
  process.exit(1);
}

// E1 store remains non-executing.
const storeForbidden = [
  [/function\s+(?:executeRecipe|runRecipe)\b/, "store recipe executor"],
  [/\b(?:runExecutable|resumeExecutable|dispatchExecutable)\b/, "store run/resume/dispatch"],
  [/packages\/mcp-server/, "store mcp-server import"],
];
for (const [pattern, label] of storeForbidden) {
  if (pattern.test(storeSource)) {
    console.error(`E1 store contains forbidden ${label}.`);
    process.exit(1);
  }
}

// Core run helper must not import mcp-server.
if (runHelperSource.includes("packages/mcp-server")) {
  console.error("executable-recipe-run-v1.mjs must not import packages/mcp-server.");
  process.exit(1);
}

execFileSync(process.execPath, ["--test", "tests/alpha3/alpha3-4-e2-call-recipe-runtime.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("call_recipe runtime checks ok.");

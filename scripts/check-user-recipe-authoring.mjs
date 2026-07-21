import { readFileSync } from "node:fs";
import path from "node:path";
import { TOOL_ABI_V1_TOOL_NAMES } from "../packages/mcp-server/src/tool-abi-v1.mjs";

const root = process.cwd();
const layer6Sources = [
  "packages/core/src/user-recipe-authoring-v1.mjs",
  "packages/core/src/executable-recipe-contract-v1.mjs",
  "packages/mcp-server/src/user-recipe-discovery-v1.mjs",
];

const expectedTools = [
  "ping",
  "get_state",
  "list_templates",
  "list_recipes",
  "call_template",
  "call_recipe",
];

if (JSON.stringify([...TOOL_ABI_V1_TOOL_NAMES].sort()) !== JSON.stringify([...expectedTools].sort())) {
  console.error("Layer 6 sources must not drift the public six-tool ABI.");
  process.exit(1);
}

for (const sourcePath of layer6Sources) {
  const absolutePath = path.join(root, sourcePath);
  const source = readFileSync(absolutePath, "utf8");
  assertNoForbiddenSource(sourcePath, source);
}

const authoring = readFileSync(path.join(root, "packages/core/src/user-recipe-authoring-v1.mjs"), "utf8");
if (!authoring.includes("executable_revisions") || !authoring.includes("USER_EXECUTABLE_RECIPE_REVISION_SUFFIX")) {
  console.error("User recipe authoring must load saved executable revisions without mutating discovery fields.");
  process.exit(1);
}
if (authoring.includes("packages/mcp-server")) {
  console.error("User recipe authoring must not import packages/mcp-server implementation.");
  process.exit(1);
}

const executable = readFileSync(path.join(root, "packages/core/src/executable-recipe-contract-v1.mjs"), "utf8");
if (executable.includes("packages/mcp-server")) {
  console.error("Executable recipe contract must not import packages/mcp-server implementation.");
  process.exit(1);
}
if (!executable.includes("createExecutableDependencyCatalog") || !executable.includes("sealExecutableRecipeRevision")) {
  console.error("Executable recipe contract must expose catalog injection and immutable revision sealing.");
  process.exit(1);
}

console.log("User Recipe Authoring v1 static checks ok.");

function assertNoForbiddenSource(sourcePath, source) {
  const forbidden = [
    [/function\s+(?:executeRecipe|runRecipe)|registerTool\(\s*["']call_recipe["']|\bcall_recipe\s*\(/i, "recipe executor surface"],
    [/node:child_process|child_process|spawn\(|execFile|execSync|exec\(/, "process execution helper"],
    [/\breaper\/bridge\b|REAPER\.app|\breaper\.Main_OnCommand\s*\(|NamedCommandLookup\s*\(|os\.execute\s*\(|io\.popen\s*\(/, "runtime or action bypass"],
    [/\bstreetlight-reaper-mcp\b/, "legacy repo dependency"],
    [/\bcreateTool\b|\bregisterTool\b|TOOL_ABI_V1_TOOLS\s*=/, "MCP tool surface mutation"],
  ];

  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) {
      console.error(`${sourcePath} contains forbidden Layer 6 ${label}: ${pattern}`);
      process.exit(1);
    }
  }
}

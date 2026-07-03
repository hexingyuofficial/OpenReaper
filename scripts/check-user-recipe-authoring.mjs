import { readFileSync } from "node:fs";
import path from "node:path";
import { TOOL_ABI_V1_TOOL_NAMES } from "../packages/mcp-server/src/tool-abi-v1.mjs";

const root = process.cwd();
const layer6Sources = [
  "packages/core/src/user-recipe-authoring-v1.mjs",
  "packages/mcp-server/src/user-recipe-discovery-v1.mjs",
];

const expectedTools = [
  "ping",
  "get_state",
  "list_templates",
  "list_recipes",
  "call_template",
];

if (JSON.stringify([...TOOL_ABI_V1_TOOL_NAMES].sort()) !== JSON.stringify([...expectedTools].sort())) {
  console.error("Layer 6 must not add or remove MCP tools.");
  process.exit(1);
}

for (const sourcePath of layer6Sources) {
  const absolutePath = path.join(root, sourcePath);
  const source = readFileSync(absolutePath, "utf8");
  assertNoForbiddenSource(sourcePath, source);
}

console.log("User Recipe Authoring v1 static checks ok.");

function assertNoForbiddenSource(sourcePath, source) {
  const forbidden = [
    [/executeRecipe|runRecipe|call_recipe/i, "recipe executor surface"],
    [/node:child_process|child_process|spawn\(|execFile|execSync|exec\(/, "process execution helper"],
    [/\breaper\/bridge\b|REAPER\.app|Main_OnCommand|NamedCommandLookup|os\.execute|io\.popen/, "runtime or action bypass"],
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

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const sourceChecks = [
  {
    path: "packages/core/src/alpha3-d2-workflow-portability-v1.mjs",
    requiredNeedles: [
      "alpha3.d2.workflow_portability.v1",
      "alpha3.d2.workflow_packet.v1",
      "Save/share/install/fork plans stay metadata-only",
      "public_call_recipe: false",
      "hidden_executor: false",
      "raw_lua_action_shell_or_ui: false",
      "install_writes_files: false",
    ],
  },
  {
    path: "packages/core/src/alpha3-d2-workflow-entrypoints-v1.mjs",
    requiredNeedles: [
      "alpha3.d2.workflow_entrypoints.v1",
      "local_filesystem_workflow_entrypoints",
      "user_word: \"workflow\"",
      "public_call_recipe: false",
      "hidden_executor: false",
      "raw_lua_action_shell_or_ui: false",
      "safe_write: false",
      "execution_path: [\"list_recipes\", \"call_template\", \"get_state\"]",
    ],
  },
  {
    path: "scripts/alpha3-d2-workflow-entrypoint.mjs",
    requiredNeedles: [
      "saveAlpha3D2Workflow",
      "scrubAlpha3D2Workflow",
      "shareAlpha3D2Workflow",
      "installAlpha3D2Workflow",
      "forkAlpha3D2Workflow",
      "--operation save|scrub|share|install|fork",
    ],
  },
];

for (const check of sourceChecks) {
  const source = readFileSync(path.join(root, check.path), "utf8");
  for (const needle of check.requiredNeedles) {
    if (!source.includes(needle)) {
      console.error(`${check.path} is missing required D2 marker: ${needle}`);
      process.exit(1);
    }
  }

  const forbidden = [
    [/executeRecipe|runRecipe|call_recipe.*available/i, "recipe executor surface"],
    [/node:child_process|spawn\(|execFile|execSync|exec\(/, "process execution helper"],
    [/Main_OnCommand|NamedCommandLookup|os\.execute|io\.popen/i, "raw REAPER/action bypass"],
    [/\bcreateTool\b|\bregisterTool\b|TOOL_ABI_V1_TOOLS\s*=/, "MCP tool surface mutation"],
  ];

  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) {
      console.error(`${check.path} contains forbidden D2 ${label}: ${pattern}`);
      process.exit(1);
    }
  }
}

execFileSync(process.execPath, ["--test", "tests/alpha3/d2-workflow-portability.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/alpha3/d2-workflow-entrypoints.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Alpha3 D2 workflow portability checks ok.");

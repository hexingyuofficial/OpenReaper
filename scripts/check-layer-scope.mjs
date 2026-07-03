import { execFileSync } from "node:child_process";

const layer = process.argv[2];

const allowlists = {
  layer1: [
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "package.json",
    "scripts/check-layer-scope.mjs",
    "scripts/check-repo-layout.mjs",
    "scripts/check-tool-abi.mjs",
    "packages/mcp-server/**",
    "tests/layer1/**",
  ],
  "layer1.5": [
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
    "package.json",
    "scripts/check-layer-scope.mjs",
    "scripts/check-repo-layout.mjs",
    "scripts/check-discovery-menu.mjs",
    "packages/mcp-server/**",
    "tests/layer1_5/**",
  ],
  layer2: [
    "docs/abi/FOUNDATION_BRIDGE_ABI_V1.md",
    "package.json",
    "scripts/check-layer-scope.mjs",
    "scripts/check-repo-layout.mjs",
    "scripts/check-foundation-bridge.mjs",
    "packages/core/**",
    "packages/mcp-server/**",
    "reaper/bridge/**",
    "tests/layer2/**",
  ],
  layer3: [
    "docs/taxonomy/PACK_TAXONOMY_V1.md",
    "docs/taxonomy/PACK_TAXONOMY_REVIEW_NOTES.md",
    "docs/LAYER_PROGRESS.md",
    "package.json",
    "scripts/check-pack-taxonomy.mjs",
    "scripts/check-layer-scope.mjs",
    "scripts/check-repo-layout.mjs",
    "tests/layer3/**",
  ],
  layer4a: [
    "docs/abi/TEMPLATE_AUTHORING_ABI_V1.md",
    "docs/guides/TEMPLATE_AUTHORING_GUIDE.md",
    "docs/LAYER_PROGRESS.md",
    "package.json",
    "scripts/check-template-authoring.mjs",
    "scripts/check-layer-scope.mjs",
    "scripts/check-repo-layout.mjs",
    "packages/core/**",
    "packages/mcp-server/**",
    "tests/layer4/**",
    "tests/layer4a/**",
  ],
  layer4b: [
    "docs/abi/TEMPLATE_AUTHORING_ABI_V1.md",
    "docs/guides/TEMPLATE_AUTHORING_GUIDE.md",
    "docs/LAYER_PROGRESS.md",
    "package.json",
    "scripts/check-template-authoring.mjs",
    "scripts/check-layer-scope.mjs",
    "packages/core/src/template-execution-harness-v1.mjs",
    "tests/layer4b/**",
  ],
  layer4c: [
    "docs/abi/TEMPLATE_AUTHORING_ABI_V1.md",
    "docs/guides/TEMPLATE_AUTHORING_GUIDE.md",
    "docs/LAYER_PROGRESS.md",
    "package.json",
    "scripts/check-template-authoring.mjs",
    "scripts/check-layer-scope.mjs",
    "packages/core/src/template-catalog-v1.mjs",
    "packages/core/src/template-catalog-fixtures-v1.mjs",
    "tests/layer4c/**",
  ],
  layer4d: [
    "docs/abi/TEMPLATE_AUTHORING_ABI_V1.md",
    "docs/guides/TEMPLATE_AUTHORING_GUIDE.md",
    "docs/LAYER_PROGRESS.md",
    "package.json",
    "scripts/check-layer-scope.mjs",
    "scripts/check-template-runtime.mjs",
    "scripts/smoke-template-runtime-live.mjs",
    "packages/core/src/template-catalog-fixtures-v1.mjs",
    "packages/mcp-server/src/call-template-runtime-v1.mjs",
    "tests/layer4d/**",
  ],
  layer4d1: [
    "docs/LAYER_PROGRESS.md",
    "package.json",
    "scripts/check-layer-scope.mjs",
    "scripts/check-template-runtime.mjs",
    "scripts/smoke-template-runtime-live.mjs",
    "packages/mcp-server/src/call-template-runtime-v1.mjs",
    "packages/mcp-server/src/live-bridge-executor-v1.mjs",
    "tests/layer4d/**",
    "tests/layer4d1/**",
  ],
  layer5: [
    "docs/abi/RECIPE_CONTRACT_V1.md",
    "docs/LAYER_PROGRESS.md",
    "package.json",
    "scripts/check-layer-scope.mjs",
    "scripts/check-recipe-contract.mjs",
    "packages/core/src/recipe-contract-v1.mjs",
    "tests/layer5/**",
  ],
  wave3b: [
    "packages/core/src/template-packs/wave3b-core-templates-v1.mjs",
    "packages/core/src/template-packs/wave3b-system-templates-v1.mjs",
    "tests/template-packs/wave3b-core-templates.test.mjs",
    "tests/template-packs/wave3b-system-templates.test.mjs",
  ],
};

const denylists = {
  layer1: [
    "reaper/**",
    "recipes/**",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/**",
  ],
  "layer1.5": [
    "reaper/**",
    "recipes/**",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/**",
  ],
  layer2: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
    "recipes/**",
    "docs/taxonomy/**",
    "docs/migration/**",
    "reaper/packs/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
  ],
  layer3: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/**",
    "docs/migration/**",
    "packages/core/**",
    "packages/mcp-server/**",
    "reaper/bridge/**",
    "reaper/packs/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
  ],
  layer4a: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
    "docs/abi/FOUNDATION_BRIDGE_ABI_V1.md",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/src/foundation-bridge-v1.mjs",
    "packages/mcp-server/src/discovery-menu-v1.mjs",
    "packages/mcp-server/src/tool-abi-v1.mjs",
    "reaper/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
    "tests/layer3/**",
  ],
  layer4b: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
    "docs/abi/FOUNDATION_BRIDGE_ABI_V1.md",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/src/foundation-bridge-v1.mjs",
    "packages/core/src/template-descriptor-v1.mjs",
    "packages/mcp-server/**",
    "reaper/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
    "tests/layer3/**",
    "tests/layer4a/**",
  ],
  layer4c: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
    "docs/abi/FOUNDATION_BRIDGE_ABI_V1.md",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/src/foundation-bridge-v1.mjs",
    "packages/core/src/template-descriptor-v1.mjs",
    "packages/core/src/template-execution-harness-v1.mjs",
    "packages/mcp-server/**",
    "reaper/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
    "tests/layer3/**",
    "tests/layer4a/**",
    "tests/layer4b/**",
  ],
  layer4d: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
    "docs/abi/FOUNDATION_BRIDGE_ABI_V1.md",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/src/foundation-bridge-v1.mjs",
    "packages/core/src/template-descriptor-v1.mjs",
    "packages/core/src/template-execution-harness-v1.mjs",
    "packages/core/src/template-catalog-v1.mjs",
    "packages/core/src/template-packs/**",
    "packages/mcp-server/src/discovery-menu-v1.mjs",
    "packages/mcp-server/src/tool-abi-v1.mjs",
    "reaper/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
    "tests/layer3/**",
    "tests/layer4a/**",
    "tests/layer4b/**",
    "tests/layer4c/**",
    "tests/template-packs/**",
  ],
  layer4d1: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/**",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/**",
    "packages/mcp-server/src/discovery-menu-v1.mjs",
    "packages/mcp-server/src/tool-abi-v1.mjs",
    "reaper/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
    "tests/layer3/**",
    "tests/layer4a/**",
    "tests/layer4b/**",
    "tests/layer4c/**",
    "tests/layer5/**",
    "tests/template-packs/**",
  ],
  layer5: [
    "AGENTS.md",
    "README.md",
    "docs/FOUNDATION_FREEZE_PLAN.md",
    "docs/REPOSITORY_LAYOUT.md",
    "docs/abi/TOOL_ABI_V1.md",
    "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
    "docs/abi/FOUNDATION_BRIDGE_ABI_V1.md",
    "docs/abi/TEMPLATE_AUTHORING_ABI_V1.md",
    "docs/taxonomy/**",
    "docs/migration/**",
    "packages/core/src/foundation-bridge-v1.mjs",
    "packages/core/src/template-catalog-v1.mjs",
    "packages/core/src/template-catalog-fixtures-v1.mjs",
    "packages/core/src/template-descriptor-v1.mjs",
    "packages/core/src/template-execution-harness-v1.mjs",
    "packages/core/src/template-packs/**",
    "packages/mcp-server/**",
    "reaper/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
    "tests/layer3/**",
    "tests/layer4a/**",
    "tests/layer4b/**",
    "tests/layer4c/**",
    "tests/layer4d/**",
    "tests/template-packs/**",
  ],
  wave3b: [
    "AGENTS.md",
    "README.md",
    "docs/**",
    "package.json",
    "scripts/**",
    "packages/core/src/foundation-bridge-v1.mjs",
    "packages/core/src/template-descriptor-v1.mjs",
    "packages/core/src/template-execution-harness-v1.mjs",
    "packages/core/src/template-catalog-v1.mjs",
    "packages/core/src/template-catalog-fixtures-v1.mjs",
    "packages/mcp-server/**",
    "reaper/**",
    "recipes/**",
    "tests/layer1/**",
    "tests/layer1_5/**",
    "tests/layer2/**",
    "tests/layer3/**",
    "tests/layer4a/**",
    "tests/layer4b/**",
    "tests/layer4c/**",
  ],
};

if (!layer || !allowlists[layer]) {
  console.error("Usage: npm run check:layer -- <layer>");
  console.error(`Known layers: ${Object.keys(allowlists).join(", ")}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function changedFiles() {
  const names = new Set();
  for (const args of [
    ["diff", "--name-only", "HEAD"],
    ["diff", "--name-only", "--cached", "HEAD"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const output = git(args).trim();
    if (!output) continue;
    for (const line of output.split(/\r?\n/)) {
      const file = line.trim();
      if (file) names.add(file);
    }
  }
  return [...names].sort();
}

function matches(pattern, file) {
  if (pattern.endsWith("/**")) {
    return file === pattern.slice(0, -3) || file.startsWith(pattern.slice(0, -2));
  }
  return file === pattern;
}

const files = changedFiles();
const allowlist = allowlists[layer];
const denylist = denylists[layer] ?? [];

const denied = files.filter((file) => denylist.some((pattern) => matches(pattern, file)));
const outside = files.filter((file) => !allowlist.some((pattern) => matches(pattern, file)));

if (denied.length > 0 || outside.length > 0) {
  console.error(`Layer scope check failed for ${layer}.`);
  if (denied.length > 0) {
    console.error("\nDenied files changed:");
    for (const file of denied) console.error(`- ${file}`);
  }
  if (outside.length > 0) {
    console.error("\nFiles outside allowlist changed:");
    for (const file of outside) console.error(`- ${file}`);
  }
  console.error("\nAllowed patterns:");
  for (const pattern of allowlist) console.error(`- ${pattern}`);
  process.exit(1);
}

console.log(`Layer scope ok for ${layer} (${files.length} changed file(s)).`);

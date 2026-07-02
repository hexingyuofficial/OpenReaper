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

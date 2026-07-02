import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const fixedPacks = [
  "core",
  "project",
  "transport",
  "tracks",
  "items",
  "media",
  "analysis",
  "midi",
  "fx",
  "routing",
  "automation",
  "render",
  "actions",
  "ui",
  "system",
  "hardware_control",
];

const requiredPaths = [
  "README.md",
  "AGENTS.md",
  "docs/FOUNDATION_FREEZE_PLAN.md",
  "docs/LAYER_PROGRESS.md",
  "docs/REPOSITORY_LAYOUT.md",
  "docs/abi/TOOL_ABI_V1.md",
  "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md",
  "docs/taxonomy/PACK_TAXONOMY_V1.md",
  "docs/migration/LEGACY_BOUNDARY.md",
  "packages/core",
  "packages/mcp-server",
  "reaper/bridge",
  "recipes/official",
  "recipes/user",
  "tests",
  ...fixedPacks.map((pack) => `reaper/packs/${pack}`),
];

const missing = requiredPaths.filter((entry) => !existsSync(path.join(root, entry)));
if (missing.length > 0) {
  console.error("Missing required paths:");
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}

const taxonomy = readFileSync(
  path.join(root, "docs/taxonomy/PACK_TAXONOMY_V1.md"),
  "utf8",
);

const missingPacks = fixedPacks.filter((pack) => !taxonomy.includes(pack));
if (missingPacks.length > 0) {
  console.error("PACK_TAXONOMY_V1.md does not mention fixed packs:");
  for (const pack of missingPacks) console.error(`- ${pack}`);
  process.exit(1);
}

console.log(`OpenReaper layout ok (${fixedPacks.length} fixed packs).`);

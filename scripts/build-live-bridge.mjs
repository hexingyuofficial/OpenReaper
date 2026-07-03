import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const sourceFiles = [
  "00-bridge-kernel.lua",
  "10-file-transport.lua",
  "20-bridge-envelope-kernel.lua",
  "30-artifact-helper.lua",
  "40-route-pack-handlers.lua",
  "90-file-transport-loop.lua",
];

const sourceDir = path.join(root, "reaper/bridge/src");
const outputPath = path.join(root, "reaper/bridge/openreaper-live-bridge.lua");
const check = process.argv.includes("--check");

const bundled = sourceFiles
  .map((file) => readFileSync(path.join(sourceDir, file), "utf8"))
  .join("");

if (check) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== bundled) {
    console.error("openreaper-live-bridge.lua is not up to date with reaper/bridge/src.");
    console.error("Run: npm run build:live-bridge");
    process.exit(1);
  }
  console.log(`Live bridge bundle ok (${sourceFiles.length} source module(s)).`);
} else {
  writeFileSync(outputPath, bundled);
  console.log(`Built reaper/bridge/openreaper-live-bridge.lua from ${sourceFiles.length} source module(s).`);
}

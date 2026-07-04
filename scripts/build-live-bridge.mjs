import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

export const sourceFiles = Object.freeze([
  "00-bridge-kernel.lua",
  "10-file-transport.lua",
  "20-bridge-envelope-kernel.lua",
  "30-artifact-helper.lua",
  "40-route-pack-handlers.lua",
  "90-file-transport-loop.lua",
]);

export function buildLiveBridgeBundle({ cwd = process.cwd() } = {}) {
  const sourceDir = path.join(cwd, "reaper/bridge/src");
  return sourceFiles
    .map((file) => wrapSourceModule(file, readFileSync(path.join(sourceDir, file), "utf8")))
    .join("");
}

function wrapSourceModule(file, source) {
  if (file !== "40-route-pack-handlers.lua") return source;
  return [
    "-- OpenReaper bridge handler module wrapper: keeps handler locals out of the main Lua chunk.",
    "local dispatch_request = (function()",
    source,
    "return dispatch_request",
    "end)()",
    "",
  ].join("\n");
}

function run() {
  const outputPath = path.join(root, "reaper/bridge/openreaper-live-bridge.lua");
  const check = process.argv.includes("--check");
  const bundled = buildLiveBridgeBundle({ cwd: root });

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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}

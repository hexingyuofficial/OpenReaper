#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import { access, chmod, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const options = parseArgs(process.argv.slice(2));
const version = safeToken(options.version, `alpha-${compactTimestamp(new Date())}`);
const outDir = path.resolve(options.out_dir ?? path.join(repoRoot, "dist", `openreaper-${version}`));
const packageRoot = path.join(outDir, "OpenReaper-alpha");
const skipZip = options.skip_zip === true;
const skipSmoke = options.skip_smoke === true;
const EXACT_MCP_TOOLS = Object.freeze([
  "call_template",
  "get_state",
  "list_recipes",
  "list_templates",
  "ping",
]);
const REQUIRED_MACRO_IDS = Object.freeze([
  "macro.index_status",
  "macro.query_tracks",
]);

await assertReadable(path.join(repoRoot, "packages", "mcp-server", "src", "openreaper-mcp-stdio.mjs"));
await assertReadable(path.join(repoRoot, "reaper", "bridge", "openreaper-live-bridge.lua"));

await rm(outDir, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });
await mkdir(path.join(packageRoot, "bin"), { recursive: true });
await mkdir(path.join(packageRoot, "installer"), { recursive: true });
await mkdir(path.join(packageRoot, "vendor", "openreaper-kernel"), { recursive: true });

await copyInstallerTemplates();
await copyOpenReaperKernel();
await installPackageDependencies();
await writePackageEntrypoints();
await writeReadme();
await removeDsStore(packageRoot);
const smoke = await smokePackagedMcp();

let zipPath = null;
if (!skipZip) {
  zipPath = path.join(outDir, `OpenReaper-${version}-macOS-alpha.zip`);
  await removeDsStore(packageRoot);
  await zipPackage(zipPath);
  await removeDsStore(packageRoot);
}

console.log(JSON.stringify({
  ok: true,
  contract: "openreaper.alpha.package_result.v1",
  version,
  package_root: packageRoot,
  zip_path: zipPath,
  bundled_runtime: {
    mcp_server: "vendor/openreaper-kernel/packages/mcp-server/src/openreaper-mcp-stdio.mjs",
    bridge: "vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua",
    entrypoints: ["bin/openreaper-mcp", "bin/openreaper-start", "bin/openreaper-doctor"],
    dependency_source: "package_root_npm_install",
  },
  smoke,
  install: {
    command: "double-click install.command or run ./install.command",
    default_install_root: "~/.openreaper/current",
    mcp_server_name: "openreaper",
    startup_requirement: "REAPER must be started through openreaper-start for MCP to connect.",
  },
}, null, 2));

async function copyInstallerTemplates() {
  const templateRoot = path.join(repoRoot, "scripts", "openreaper-alpha-package");
  await cp(path.join(templateRoot, "install-openreaper.mjs"), path.join(packageRoot, "installer", "install-openreaper.mjs"));
  await cp(path.join(templateRoot, "uninstall-openreaper.mjs"), path.join(packageRoot, "installer", "uninstall-openreaper.mjs"));
  await cp(path.join(templateRoot, "openreaper-mcp.sh"), path.join(packageRoot, "bin", "openreaper-mcp"));
  await cp(path.join(templateRoot, "openreaper-start.sh"), path.join(packageRoot, "bin", "openreaper-start"));
  await cp(path.join(templateRoot, "openreaper-doctor.sh"), path.join(packageRoot, "bin", "openreaper-doctor"));
  await chmod(path.join(packageRoot, "bin", "openreaper-mcp"), 0o755);
  await chmod(path.join(packageRoot, "bin", "openreaper-start"), 0o755);
  await chmod(path.join(packageRoot, "bin", "openreaper-doctor"), 0o755);
}

async function copyOpenReaperKernel() {
  const target = path.join(packageRoot, "vendor", "openreaper-kernel");
  await cp(path.join(repoRoot, "package.json"), path.join(target, "package.json"));
  await cp(path.join(repoRoot, "packages"), path.join(target, "packages"), {
    recursive: true,
    filter: packageFilter,
  });
  await cp(path.join(repoRoot, "recipes"), path.join(target, "recipes"), {
    recursive: true,
    filter: packageFilter,
  });
  await cp(path.join(repoRoot, "reaper"), path.join(target, "reaper"), {
    recursive: true,
    filter: packageFilter,
  });
  await cp(path.join(repoRoot, "scripts", "start-openreaper-alpha3.mjs"), path.join(target, "scripts", "start-openreaper-alpha3.mjs")).catch(async () => {
    await mkdir(path.join(target, "scripts"), { recursive: true });
    await cp(path.join(repoRoot, "scripts", "start-openreaper-alpha3.mjs"), path.join(target, "scripts", "start-openreaper-alpha3.mjs"));
  });
}

async function installPackageDependencies() {
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "openreaper-alpha-package",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.29.0",
      "zod": "^3.25.76",
    },
  }, null, 2)}\n`, "utf8");
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: packageRoot,
  });
}

async function writePackageEntrypoints() {
  const installCommand = `#!/bin/zsh
set -euo pipefail
cd "\${0:A:h}"
exec node "./installer/install-openreaper.mjs" "$@"
`;
  const uninstallCommand = `#!/bin/zsh
set -euo pipefail
cd "\${0:A:h}"
exec node "./installer/uninstall-openreaper.mjs" "$@"
`;
  await writeFile(path.join(packageRoot, "install.command"), installCommand, "utf8");
  await writeFile(path.join(packageRoot, "uninstall.command"), uninstallCommand, "utf8");
  await chmod(path.join(packageRoot, "install.command"), 0o755);
  await chmod(path.join(packageRoot, "uninstall.command"), 0o755);
}

async function writeReadme() {
  const readme = `OpenReaper macOS alpha package

What this package does:
- installs OpenReaper alpha to ~/.openreaper/current
- registers MCP server name "openreaper" for Codex, Cursor, and Claude Desktop where their config files live at standard macOS paths
- writes MCP config snippets for other clients, including Trae, under ~/.openreaper/current/config-snippets
- installs a conditional REAPER startup hook that is inert for normal REAPER launches
- provides ~/.openreaper/current/bin/openreaper-start for REAPER sessions that MCP can connect to

Important:
REAPER must be started through OpenReaper for MCP to connect. Normal double-click REAPER launches are not OpenReaper MCP sessions.

Install:
Double-click install.command, or run:
  ./install.command

Start REAPER:
  ~/.openreaper/current/bin/openreaper-start
  ~/.openreaper/current/bin/openreaper-start --project-path /path/to/project.RPP

After install:
Restart Codex, Cursor, Claude, or your MCP client so it reloads MCP config. Then ask:
  Open REAPER with OpenReaper and inspect the current project.

If REAPER shows a startup/version/recovery/plugin dialog, dismiss it and ask the agent to reconnect.

Uninstall:
  ./uninstall.command

Alpha caveat:
The external product name and MCP server name are OpenReaper. This package uses the OpenReaper alpha stdio MCP kernel from vendor/openreaper-kernel. Some live REAPER execution paths remain evidence-gated; discovery and Alpha3 macro planning are available through list_templates and call_template.
`;
  await writeFile(path.join(packageRoot, "README.txt"), readme, "utf8");
}

async function zipPackage(zipPath) {
  await rm(zipPath, { force: true });
  await run("zip", ["-q", "-r", "-X", zipPath, "OpenReaper-alpha"], {
    cwd: outDir,
  });
}

async function smokePackagedMcp() {
  if (skipSmoke) {
    return {
      skipped: true,
      reason: "skip_smoke",
    };
  }

  const packagePaths = [packageRoot, path.join(packageRoot, "node_modules")];
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    importPackageModule("@modelcontextprotocol/sdk/client/index.js", packagePaths),
    importPackageModule("@modelcontextprotocol/sdk/client/stdio.js", packagePaths),
  ]);
  const artifactRoot = path.join(packageRoot, "session", "artifacts");
  const transportDir = path.join(packageRoot, "session", "transport");
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });

  const client = new Client({
    name: "openreaper-alpha-package-smoke",
    version: "0.0.0",
  });
  const transport = new StdioClientTransport({
    command: path.join(packageRoot, "bin", "openreaper-mcp"),
    args: [],
    env: {
      ...process.env,
      OPENREAPER_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: path.join(
        packageRoot,
        "vendor",
        "openreaper-kernel",
        "reaper",
        "bridge",
        "openreaper-live-bridge.lua",
      ),
      OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha-package-smoke",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    },
  });

  try {
    await client.connect(transport);
    const toolResponse = await client.listTools();
    const toolNames = (toolResponse.tools ?? []).map((tool) => tool.name).sort();
    assertExactArray(toolNames, EXACT_MCP_TOOLS, "MCP tool surface");
    const ping = parseJsonToolResult(await client.callTool({
      name: "ping",
      arguments: {},
    }));
    if (ping.kernel !== "openreaper-mcp alpha kernel") {
      throw new Error(`Packaged MCP ping kernel mismatch: ${ping.kernel}`);
    }
    const templatesResponse = await client.callTool({
      name: "list_templates",
      arguments: {
        ids: [...REQUIRED_MACRO_IDS],
      },
    });
    const templates = parseJsonToolResult(templatesResponse);
    const templateIds = new Set((templates.items ?? []).map((item) => item.id));
    for (const id of REQUIRED_MACRO_IDS) {
      if (!templateIds.has(id)) {
        throw new Error(`Packaged MCP list_templates smoke missing ${id}`);
      }
    }
    return {
      ok: true,
      tool_surface: toolNames,
      kernel: ping.kernel,
      required_macros: [...REQUIRED_MACRO_IDS],
    };
  } finally {
    await client.close?.();
  }
}

async function importPackageModule(specifier, paths) {
  const resolved = require.resolve(specifier, { paths });
  return import(pathToFileURL(resolved));
}

function parseJsonToolResult(response) {
  const text = response?.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("MCP tool response did not include text content");
  }
  return JSON.parse(text);
}

function assertExactArray(actual, expected, label) {
  const expectedSorted = [...expected].sort();
  if (
    actual.length !== expectedSorted.length ||
    actual.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(`${label} mismatch: expected ${expectedSorted.join(",")}; got ${actual.join(",")}`);
  }
}

function packageFilter(src) {
  const base = path.basename(src);
  if (base === ".git" || base === ".DS_Store" || base === "setup-out" || base === "coverage") return false;
  if (src.includes(`${path.sep}.git${path.sep}`)) return false;
  return true;
}

async function removeDsStore(root) {
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(root, { withFileTypes: true }));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.name === ".DS_Store") {
      await rm(fullPath, { force: true });
    } else if (entry.isDirectory()) {
      await removeDsStore(fullPath);
    }
  }
}

async function assertReadable(filePath) {
  await access(filePath, fsConstants.R_OK);
  await stat(filePath);
}

function run(cmd, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals !== -1) {
      parsed[raw.slice(0, equals).replaceAll("-", "_")] = parseArgValue(raw.slice(equals + 1));
      continue;
    }
    const key = raw.replaceAll("-", "_");
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = parseArgValue(next);
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function parseArgValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function compactTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function safeToken(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.trim().replace(/[^\w.+-]/g, "_").slice(0, 120) || fallback;
}

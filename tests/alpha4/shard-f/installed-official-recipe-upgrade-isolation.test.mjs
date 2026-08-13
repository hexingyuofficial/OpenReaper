import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createExecutableRecipeProductCatalog } from "../../../packages/mcp-server/src/executable-recipe-product-catalog-v1.mjs";

const REPO = path.resolve(import.meta.dirname, "../../..");
const PACKAGE_TEMPLATE_ROOT = path.join(REPO, "scripts", "openreaper-alpha-package");
const EXACT_TOOLS = ["call_recipe", "call_template", "get_state", "list_recipes", "list_templates", "ping"];
const roots = [];

test.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("real A-to-B installer upgrade preserves user Recipes and rejects stale official descriptor state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-official-upgrade-"));
  roots.push(root);
  const home = path.join(root, "home");
  const packageA = path.join(root, "package-a", "OpenReaper-alpha");
  const packageB = path.join(root, "package-b", "OpenReaper-alpha");
  const installRoot = path.join(home, ".openreaper", "current");
  const userRoot = path.join(home, ".openreaper", "data", "executable-recipes");
  const staleOfficialRoot = path.join(home, ".openreaper", "data", "executable-recipes.official");

  await Promise.all([
    makeInstallablePackage(packageA, "alpha4-upgrade-a"),
    makeInstallablePackage(packageB, "alpha4-upgrade-b", {
      upgradedOfficialTitle: "Create bus processing (upgrade B)",
    }),
  ]);

  const installedA = await installPackage(packageA, installRoot, home);
  assert.equal(installedA.code, 0, installedA.stderr || installedA.stdout);
  assert.match(installedA.stdout, /MCP server startup smoke passed/u, installedA.stdout);
  assert.doesNotMatch(`${installedA.stdout}\n${installedA.stderr}`, /STORE_(?:CORRUPT|ERROR)/u);

  let clientA;
  let clientB;
  try {
    clientA = await connectInstalled(installRoot, home, "alpha4-official-upgrade-a");
    await assertSixTools(clientA);
    const officialA = await callRecipe(clientA, { operation: "list" });
    assert.equal(officialA.ok, true, JSON.stringify(officialA));
    assert.equal(officialA.count, 2);
    assert.equal(officialA.items.every((entry) => entry.source === "official"), true);
    const upgradedOfficialA = officialA.items.find(
      (entry) => entry.recipe_id === "recipe.mix.create_bus_processing",
    );
    const upgradedOfficialARevision = await callRecipe(clientA, {
      operation: "get",
      ...exactIdentity(upgradedOfficialA),
    });
    assert.equal(upgradedOfficialARevision.draft.title, "Create bus processing");

    const saved = await callRecipe(clientA, {
      operation: "save",
      draft: productDraft("recipe.tracks.alpha4_upgrade_fixture"),
      version: "1.0.0",
      revision_number: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
      catalog: { macros: [], templates: [], capabilities: [] },
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.immutable, true);
    const identity = exactIdentity(saved);
    const userBytesBefore = await snapshotFiles(userRoot);
    assert.equal(userBytesBefore.length, 1);

    await clientA.close();
    clientA = null;

    const officialARoot = path.join(installRoot, "session", "executable-recipes.official");
    const officialABytes = await snapshotFiles(officialARoot);
    assert.equal(officialABytes.length, 2);
    await writeFile(path.join(officialARoot, "old-install-only.marker"), "must-not-survive-upgrade\n", "utf8");
    await cp(officialARoot, staleOfficialRoot, { recursive: true });
    const staleRevisionPath = path.join(staleOfficialRoot, officialABytes[0].path);
    await writeFile(staleRevisionPath, "{\"contract\":\"stale-official-descriptor-state\"}\n", "utf8");

    const installedB = await installPackage(packageB, installRoot, home, {
      OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT: staleOfficialRoot,
    });
    assert.equal(installedB.code, 0, installedB.stderr || installedB.stdout);
    assert.match(installedB.stdout, /MCP server startup smoke passed/u, installedB.stdout);
    assert.doesNotMatch(`${installedB.stdout}\n${installedB.stderr}`, /STORE_(?:CORRUPT|ERROR)/u);
    assert.equal(await readFile(path.join(installRoot, "BUILD_ID"), "utf8"), "alpha4-upgrade-b\n");
    assert.deepEqual(await snapshotFiles(userRoot), userBytesBefore);

    const officialBRoot = path.join(installRoot, "session", "executable-recipes.official");
    assert.equal(await exists(path.join(officialBRoot, "old-install-only.marker")), false);
    assert.equal(await exists(staleRevisionPath), true);

    clientB = await connectInstalled(installRoot, home, "alpha4-official-upgrade-b", {
      OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT: staleOfficialRoot,
    });
    await assertSixTools(clientB);
    const listedB = await callRecipe(clientB, { operation: "list" });
    assert.equal(listedB.ok, true, JSON.stringify(listedB));
    assert.equal(listedB.count, 3);
    assert.equal(listedB.items.filter((entry) => entry.source === "official").length, 2);
    assert.equal(listedB.items.filter((entry) => entry.source === "user").length, 1);
    assert.equal(listedB.items.every((entry) => entry.immutable === true), true);
    assert.doesNotMatch(JSON.stringify(listedB), /STORE_(?:CORRUPT|ERROR)/u);
    const upgradedOfficialB = listedB.items.find(
      (entry) => entry.recipe_id === "recipe.mix.create_bus_processing",
    );
    const upgradedOfficialBRevision = await callRecipe(clientB, {
      operation: "get",
      ...exactIdentity(upgradedOfficialB),
    });
    assert.equal(upgradedOfficialBRevision.draft.title, "Create bus processing (upgrade B)");
    assert.notEqual(upgradedOfficialB.content_hash, upgradedOfficialA.content_hash);

    const got = await callRecipe(clientB, { operation: "get", ...identity });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual(exactIdentity(got), identity);
    assert.deepEqual(await snapshotFiles(userRoot), userBytesBefore);
    const officialBBytes = await snapshotFiles(officialBRoot);
    assert.equal(officialBBytes.length, 2);
    assert.notDeepEqual(officialBBytes, officialABytes);
  } finally {
    await clientA?.close().catch(() => {});
    await clientB?.close().catch(() => {});
  }
});

async function makeInstallablePackage(packageRoot, buildId, options = {}) {
  const kernelRoot = path.join(packageRoot, "vendor", "openreaper-kernel");
  await Promise.all([
    mkdir(path.join(packageRoot, "installer"), { recursive: true }),
    mkdir(path.join(packageRoot, "bin"), { recursive: true }),
    mkdir(path.join(kernelRoot, "packages", "mcp-server", "src"), { recursive: true }),
    mkdir(path.join(kernelRoot, "reaper", "bridge"), { recursive: true }),
    mkdir(path.join(kernelRoot, "recipes", "user"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(path.join(PACKAGE_TEMPLATE_ROOT, "install-openreaper.mjs"), path.join(packageRoot, "installer", "install-openreaper.mjs")),
    copyFile(path.join(PACKAGE_TEMPLATE_ROOT, "uninstall-openreaper.mjs"), path.join(packageRoot, "installer", "uninstall-openreaper.mjs")),
    copyFile(path.join(PACKAGE_TEMPLATE_ROOT, "openreaper-mcp.sh"), path.join(packageRoot, "bin", "openreaper-mcp")),
    copyFile(path.join(PACKAGE_TEMPLATE_ROOT, "openreaper-start-mcp-bridge.lua"), path.join(packageRoot, "bin", "openreaper-start-mcp-bridge.lua")),
    copyFile(path.join(REPO, "packages", "mcp-server", "src", "openreaper-mcp-stdio.mjs"), path.join(kernelRoot, "packages", "mcp-server", "src", "openreaper-mcp-stdio.mjs")),
    copyFile(path.join(REPO, "reaper", "bridge", "openreaper-live-bridge.lua"), path.join(kernelRoot, "reaper", "bridge", "openreaper-live-bridge.lua")),
    copyFile(path.join(REPO, "recipes", "user", ".gitkeep"), path.join(kernelRoot, "recipes", "user", ".gitkeep")),
    writeFile(path.join(packageRoot, "bin", "openreaper-start"), "#!/bin/zsh\nexit 0\n", "utf8"),
    writeFile(path.join(packageRoot, "bin", "openreaper-doctor"), "#!/bin/zsh\nexit 0\n", "utf8"),
    writeFile(path.join(packageRoot, "install.command"), "#!/bin/zsh\nexit 0\n", "utf8"),
    writeFile(path.join(packageRoot, "uninstall.command"), "#!/bin/zsh\nexit 0\n", "utf8"),
    writeFile(path.join(packageRoot, "provenance.json"), `${JSON.stringify({ contract: "openreaper.package.provenance.v1", build_id: buildId })}\n`, "utf8"),
    writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name: "openreaper-alpha4-upgrade-fixture", version: "0.1.0-alpha.1", private: true })}\n`, "utf8"),
    writeFile(path.join(packageRoot, "BUILD_ID"), `${buildId}\n`, "utf8"),
  ]);
  const serverSourceRoot = path.join(REPO, "packages", "mcp-server", "src");
  const officialSourceName = "alpha3-45-official-executable-recipes-v1.mjs";
  for (const entry of await readdir(serverSourceRoot, { withFileTypes: true })) {
    if (entry.name === "openreaper-mcp-stdio.mjs") continue;
    if (entry.name === officialSourceName) {
      let source = await readFile(path.join(serverSourceRoot, entry.name), "utf8");
      if (options.upgradedOfficialTitle) {
        const original = 'title: "Create bus processing"';
        const replacement = `title: ${JSON.stringify(options.upgradedOfficialTitle)}`;
        assert.equal(source.includes(original), true, "official Recipe fixture mutation target must remain inspectable");
        source = source.replace(original, replacement);
      }
      await writeFile(path.join(kernelRoot, "packages", "mcp-server", "src", entry.name), source, "utf8");
      continue;
    }
    await symlink(
      path.join(serverSourceRoot, entry.name),
      path.join(kernelRoot, "packages", "mcp-server", "src", entry.name),
    );
  }
  await Promise.all([
    symlink(path.join(REPO, "packages", "core"), path.join(kernelRoot, "packages", "core")),
    symlink(path.join(REPO, "node_modules"), path.join(kernelRoot, "node_modules")),
    symlink(path.join(REPO, "node_modules"), path.join(packageRoot, "node_modules")),
    symlink(path.join(REPO, "docs"), path.join(packageRoot, "docs")),
  ]);
  await Promise.all([
    "openreaper-mcp",
    "openreaper-start",
    "openreaper-doctor",
  ].map((name) => chmod(path.join(packageRoot, "bin", name), 0o755)));
}

async function installPackage(packageRoot, installRoot, home, extraEnv = {}) {
  return run(process.execPath, [
    path.join(packageRoot, "installer", "install-openreaper.mjs"),
    "--install-root",
    installRoot,
    "--skip-client-config",
    "--skip-startup-hook",
  ], isolatedEnv(home, extraEnv), packageRoot);
}

async function connectInstalled(installRoot, home, name, extraEnv = {}) {
  const client = new Client({ name, version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: path.join(installRoot, "bin", "openreaper-mcp"),
    args: [],
    cwd: installRoot,
    env: isolatedEnv(home, extraEnv),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`${error?.message ?? error}\n${stderr}`);
  }
  return client;
}

function isolatedEnv(home, extraEnv = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("OPENREAPER_")) delete env[key];
  }
  return { ...env, HOME: home, ...extraEnv };
}

async function assertSixTools(client) {
  const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(tools, EXACT_TOOLS);
}

async function callRecipe(client, args) {
  const response = await client.callTool({ name: "call_recipe", arguments: args });
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

function productDraft(id) {
  const catalog = createExecutableRecipeProductCatalog();
  const macro = catalog.getMacro("macro.project.inspect");
  const template = catalog.getTemplate("template.tracks.create_track");
  return {
    contract: "recipe.executable.draft.v1",
    id,
    title: "Installer upgrade fixture",
    summary: "Immutable user Recipe preserved across a real installer upgrade.",
    pack: "tracks",
    risk: "write",
    inputs: [{ id: "track_name", type: "string", required: true }],
    outputs: [{ id: "track_ref", type: "ref.track", required: true }],
    stages: [
      {
        id: "run_macro",
        kind: "macro",
        dependency: { kind: "macro", id: macro.id, version: macro.version, fallback_reason: null },
        inputs: ["track_name"],
        outputs: ["project_summary"],
        risk: macro.risk,
        checkpoint: "checkpoint_macro",
      },
      {
        id: "readback",
        kind: "template",
        dependency: { kind: "template", id: template.id, version: template.version, fallback_reason: "official_template_atom_required" },
        inputs: ["project_summary", "track_name"],
        outputs: ["track_ref"],
        risk: template.risk,
        checkpoint: "checkpoint_readback",
      },
    ],
    bindings: [
      { from: { scope: "recipe_input", id: null, port: "track_name" }, to: { scope: "stage", id: "run_macro", port: "track_name" } },
      { from: { scope: "stage", id: "run_macro", port: "project_summary" }, to: { scope: "stage", id: "readback", port: "project_summary" } },
      { from: { scope: "recipe_input", id: null, port: "track_name" }, to: { scope: "stage", id: "readback", port: "track_name" } },
      { from: { scope: "stage", id: "readback", port: "track_ref" }, to: { scope: "recipe_output", id: null, port: "track_ref" } },
    ],
    dependencies: [
      { kind: "macro", id: macro.id, version: macro.version, risk: macro.risk, fallback_reason: null, descriptor_hash: macro.descriptor_hash },
      { kind: "template", id: template.id, version: template.version, risk: template.risk, fallback_reason: "official_template_atom_required", descriptor_hash: template.descriptor_hash },
    ],
    required_capabilities: [...new Set([...macro.capabilities, ...template.capabilities])].sort(),
    risk_grants: ["read", "write"],
    checkpoints: [
      { id: "checkpoint_macro", after_stage: "run_macro", evidence_id: "evidence_macro", resume_identity: "resume.macro", summary: "Macro complete." },
      { id: "checkpoint_readback", after_stage: "readback", evidence_id: "evidence_readback", resume_identity: "resume.readback", summary: "Readback complete." },
    ],
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 2,
      dependency_count: 2,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability: {
      project_identity: "project:tab:alpha4-upgrade",
      bridge_owner: "owner:alpha4-upgrade",
      bridge_generation: "1",
      platform: "darwin",
    },
  };
}

function exactIdentity(value) {
  return {
    recipe_id: value.recipe_id,
    version: value.version,
    revision: value.revision,
    content_hash: value.content_hash,
    validation_result_id: value.validation_result_id,
  };
}

async function snapshotFiles(root) {
  const rows = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) rows.push({ path: relative, bytes: (await readFile(absolute)).toString("base64") });
      else throw new Error(`Unexpected Recipe store entry: ${relative}`);
    }
  }
  await visit(root);
  return rows;
}

async function exists(value) {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function run(command, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createExecutableRecipeProductCatalog } from "../../packages/mcp-server/src/executable-recipe-product-catalog-v1.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER_SOURCE = path.join(REPO_ROOT, "scripts", "openreaper-alpha-package", "openreaper-mcp.sh");
const SMOKE_SCRIPT = path.join(REPO_ROOT, "scripts", "smoke-alpha3-4-e3-installed-recipe.mjs");
const EXACT_TOOLS = ["call_recipe", "call_template", "get_state", "list_recipes", "list_templates", "ping"];
const OFFICIAL_RECIPE_IDS = [
  "recipe.mix.create_bus_processing",
  "recipe.midi.create_instrument_part",
  "recipe.media.create_layered_sound_effect_variants",
  "recipe.items.create_sound_variations",
];
const roots = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("Alpha3.4-E3 installed recipe closure", () => {
  it("keeps legacy official recipe sources out of the installed kernel", async () => {
    const fixture = await makeFixture();
    const recipeRoot = path.join(
      fixture.currentRoot,
      "vendor",
      "openreaper-kernel",
      "recipes",
    );

    assert.equal(await exists(path.join(recipeRoot, "official")), false);
    assert.equal(await exists(path.join(recipeRoot, "user", ".gitkeep")), true);
  });

  it("treats inherited empty optional values as absent while restoring the default identity", async () => {
    const fixture = await makeFixture();
    const capturePath = path.join(fixture.root, "captured-env.json");
    const serverPath = path.join(
      fixture.currentRoot,
      "vendor",
      "openreaper-kernel",
      "packages",
      "mcp-server",
      "src",
      "openreaper-mcp-stdio.mjs",
    );
    const keys = [
      "OPENREAPER_SESSION_ROOT",
      "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
      "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
      "OPENREAPER_LIVE_BRIDGE_OWNER",
      "OPENREAPER_LIVE_BRIDGE_GENERATION",
      "OPENREAPER_LIVE_BRIDGE_SESSION_ID",
      "OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY",
      "OPENREAPER_CURRENT_PROJECT_PATH",
      "OPENREAPER_CURRENT_PROJECT_REF",
      "OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON",
    ];
    await writeFile(serverPath, `import { writeFileSync } from "node:fs";\nconst keys = ${JSON.stringify(keys)};\nwriteFileSync(process.env.OPENREAPER_TEST_CAPTURE, JSON.stringify(Object.fromEntries(keys.map((key) => [key, Object.hasOwn(process.env, key) ? process.env[key] : "<unset>"]))));\n`, "utf8");

    const result = await run(fixture.wrapper, [], {
      ...wrapperEnv(fixture),
      OPENREAPER_TEST_CAPTURE: capturePath,
      OPENREAPER_SESSION_ROOT: "",
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: "",
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: "",
      OPENREAPER_LIVE_BRIDGE_OWNER: "",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "",
      OPENREAPER_LIVE_BRIDGE_SESSION_ID: "",
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "",
      OPENREAPER_CURRENT_PROJECT_PATH: "",
      OPENREAPER_CURRENT_PROJECT_REF: "project:explicit",
      OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON: "",
    });
    assert.equal(result.code, 0, result.stderr);
    const captured = JSON.parse(await readFile(capturePath, "utf8"));
    for (const key of keys.filter((key) => ![
      "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
      "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
      "OPENREAPER_LIVE_BRIDGE_OWNER",
      "OPENREAPER_LIVE_BRIDGE_GENERATION",
      "OPENREAPER_CURRENT_PROJECT_REF",
      "OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON",
    ].includes(key))) assert.equal(captured[key], "<unset>", key);
    assert.equal(captured.OPENREAPER_LIVE_SMOKE_RENDER_ROOT, await realpath(fixture.renderRoot));
    assert.equal(
      captured.OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH,
      path.join(await realpath(fixture.currentRoot), "vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"),
    );
    assert.equal(captured.OPENREAPER_LIVE_BRIDGE_OWNER, "openreaper-alpha");
    assert.equal(captured.OPENREAPER_LIVE_BRIDGE_GENERATION, "1");
    assert.equal(captured.OPENREAPER_CURRENT_PROJECT_REF, "project:explicit");
    assert.equal(captured.OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON, '["read","write","destructive"]');
  });

  it("rejects a symlinked executable Recipe root before starting the installed server", async () => {
    const fixture = await makeFixture();
    const target = path.join(fixture.root, "outside");
    await mkdir(target, { recursive: true });
    await mkdir(path.dirname(fixture.recipeRoot), { recursive: true });
    await symlink(target, fixture.recipeRoot);

    const result = await run(fixture.wrapper, [], wrapperEnv(fixture));
    assert.equal(result.code, 2);
    assert.match(result.stderr, /executable recipe root must be an absolute non-symlink directory/);
  });

  it("rejects the filesystem root as the executable Recipe store", async () => {
    const fixture = await makeFixture();
    const result = await run(fixture.wrapper, [], {
      ...wrapperEnv(fixture),
      OPENREAPER_EXECUTABLE_RECIPE_ROOT: "/./",
    });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /executable recipe root must be an absolute non-symlink directory/);
  });

  it("rejects a symlinked install-private official Recipe root", async () => {
    const fixture = await makeFixture();
    const target = path.join(fixture.root, "outside-official");
    const officialRoot = path.join(fixture.currentRoot, "session", "executable-recipes.official");
    await mkdir(target, { recursive: true });
    await symlink(target, officialRoot);

    const result = await run(fixture.wrapper, [], wrapperEnv(fixture));
    assert.equal(result.code, 2);
    assert.match(result.stderr, /official executable recipe root must be a non-symlink directory/);
  });

  it("rejects a symlinked install-private official Recipe parent", async () => {
    const fixture = await makeFixture();
    const sessionRoot = path.join(fixture.currentRoot, "session");
    const target = path.join(fixture.root, "outside-session");
    await rm(sessionRoot, { recursive: true });
    await mkdir(target, { recursive: true });
    await symlink(target, sessionRoot);

    const result = await run(fixture.wrapper, [], wrapperEnv(fixture));
    assert.equal(result.code, 2);
    assert.match(result.stderr, /official executable recipe parent must be a non-symlink directory/);
    assert.deepEqual(await readdir(target), []);
  });

  it("uses the actual installed wrapper for the six-tool lifecycle and preserves exact bytes across rename-first upgrade", async () => {
    const fixture = await makeFixture();
    const callerRoot = path.join(fixture.root, "caller-root");
    const draft = productDraft("recipe.tracks.installed_fixture");
    let firstClient;
    let secondClient;

    try {
      firstClient = await connectWrapper(fixture, "alpha3-4-e3-installed-before-upgrade");
      await assertSixTools(firstClient);

      const validated = await callRecipe(firstClient, {
        operation: "validate",
        draft,
        root: callerRoot,
        catalog: { macros: [], templates: [], capabilities: [] },
      });
      assert.equal(validated.ok, true, JSON.stringify(validated));
      assert.equal(validated.status, "validated");

      const saved = await callRecipe(firstClient, {
        operation: "save",
        draft,
        version: "1.0.0",
        revision_number: 1,
        saved_at: "1970-01-01T00:00:00.000Z",
        root: callerRoot,
        catalog: { macros: [], templates: [], capabilities: [] },
      });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.equal(saved.immutable, true);
      assert.equal(await exists(callerRoot), false);
      assert.equal(await exists(fixture.recipeRoot), true);

      const listedBefore = await callRecipe(firstClient, { operation: "list", root: callerRoot });
      assert.equal(listedBefore.ok, true);
      assert.equal(listedBefore.count, 5);
      assert.equal(listedBefore.items.filter((item) => item.source === "official").length, 4);
      assert.equal(listedBefore.items.filter((item) => item.source === "user").length, 1);
      assert.equal(listedBefore.items.every((item) => item.immutable === true), true);
      const discovered = await callJson(firstClient, "list_recipes", { limit: 25 });
      assert.deepEqual(
        discovered.items.filter((item) => OFFICIAL_RECIPE_IDS.includes(item.id)).map((item) => item.id).sort(),
        [...OFFICIAL_RECIPE_IDS].sort(),
      );
      assert.deepEqual(
        discovered.product_surface.recipe_productization.official_recipe_ids,
        OFFICIAL_RECIPE_IDS,
      );
      assert.deepEqual(
        discovered.product_surface.recipe_productization.lifecycle.operations,
        ["validate", "save", "list", "get", "delete", "run", "resume"],
      );
      assert.equal(discovered.product_surface.direct_template_fallback.discover.tool, "list_templates");
      const exactMacro = await callJson(firstClient, "list_templates", {
        ids: ["macro.project.inspect"],
        fields: ["id", "inputSchema", "examples"],
      });
      const publicDependency = exactMacro.product_surface.agent_context_macro_guide
        .requested_expansions.items[0].executable_recipe_dependency;
      const catalogMacro = createExecutableRecipeProductCatalog().getMacro("macro.project.inspect");
      assert.deepEqual(publicDependency, {
        kind: "macro",
        id: catalogMacro.id,
        version: catalogMacro.version,
        risk: catalogMacro.risk,
        descriptor_hash: catalogMacro.descriptor_hash,
        capabilities: [...catalogMacro.capabilities],
      });
      const exactOfficial = await callJson(firstClient, "list_recipes", {
        ids: ["recipe.items.create_sound_variations"],
        fields: ["steps", "assertions", "recovery"],
      });
      assert.equal(exactOfficial.items[0].steps.length, 4);
      assert.match(exactOfficial.items[0].assertions.undo, /Recipe Undo/u);
      assert.match(exactOfficial.items[0].recovery, /preflight/u);
      assert.equal(
        exactOfficial.product_surface.recipe_productization.requested_manuals[0].id,
        "recipe.items.create_sound_variations",
      );
      const identity = exactIdentity(saved);
      const bytesBefore = await snapshotFiles(fixture.recipeRoot);
      assert.equal(bytesBefore.length > 0, true);

      await firstClient.close();
      firstClient = null;
      await rename(fixture.currentRoot, fixture.previousRoot);
      await installCurrent(fixture);

      secondClient = await connectWrapper(fixture, "alpha3-4-e3-installed-after-upgrade");
      await assertSixTools(secondClient);
      assert.deepEqual(await snapshotFiles(fixture.recipeRoot), bytesBefore);

      const listedAfter = await callRecipe(secondClient, {
        operation: "list",
        root: callerRoot,
        catalog: { macros: [], templates: [], capabilities: [] },
      });
      assert.equal(listedAfter.ok, true);
      assert.equal(listedAfter.count, 5);
      assert.equal(listedAfter.items.filter((item) => item.source === "official").length, 4);
      assert.equal(listedAfter.items.filter((item) => item.source === "user").length, 1);
      assert.equal(listedAfter.items.every((item) => item.immutable === true), true);

      const got = await callRecipe(secondClient, {
        operation: "get",
        ...identity,
        root: callerRoot,
        catalog: { macros: [], templates: [], capabilities: [] },
      });
      assert.equal(got.ok, true, JSON.stringify(got));
      assert.deepEqual(exactIdentity(got), identity);

      const deleted = await callRecipe(secondClient, {
        operation: "delete",
        ...identity,
        confirm: true,
        root: callerRoot,
        catalog: { macros: [], templates: [], capabilities: [] },
      });
      assert.equal(deleted.ok, true, JSON.stringify(deleted));
      assert.equal(deleted.deleted, true);
      const listedAfterDelete = await callRecipe(secondClient, { operation: "list" });
      assert.equal(listedAfterDelete.count, 4);
      assert.equal(listedAfterDelete.items.every((item) => item.source === "official"), true);
      assert.equal(listedAfterDelete.items.some((item) => item.recipe_id === identity.recipe_id), false);
      assert.equal(await exists(callerRoot), false);
    } finally {
      await firstClient?.close().catch(() => {});
      await secondClient?.close().catch(() => {});
    }
  });

  it("runs the installed lifecycle smoke through the wrapper and writes bounded evidence", async () => {
    const fixture = await makeFixture();
    const evidenceRoot = path.join(fixture.root, "evidence");
    const result = await run(process.execPath, [
      SMOKE_SCRIPT,
      "--installed-wrapper",
      fixture.wrapper,
      "--evidence-root",
      evidenceRoot,
    ], wrapperEnv(fixture));
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(path.join(evidenceRoot, "alpha3-4-e3-installed-recipe.json"), "utf8"));
    assert.equal(report.ok, true);
    assert.deepEqual(report.tools, EXACT_TOOLS);
    assert.deepEqual(report.lifecycle, ["validate", "save", "list", "get", "delete"]);
    assert.equal(report.clients_closed, true);
    assert.equal(report.caller_override_created, false);
    assert.equal(Buffer.byteLength(JSON.stringify(report), "utf8") < 8192, true);
  });
});

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-e3-wrapper-"));
  roots.push(root);
  const homeRoot = path.join(root, "home");
  const openReaperRoot = path.join(homeRoot, ".openreaper");
  const currentRoot = path.join(openReaperRoot, "current");
  const fixture = {
    root,
    homeRoot,
    openReaperRoot,
    currentRoot,
    previousRoot: path.join(openReaperRoot, "current.previous"),
    wrapper: path.join(currentRoot, "bin", "openreaper-mcp"),
    recipeRoot: path.join(openReaperRoot, "data", "executable-recipes"),
    renderRoot: path.join(currentRoot, "session", "renders"),
  };
  await installCurrent(fixture);
  return fixture;
}

async function installCurrent(fixture) {
  const wrapper = path.join(fixture.currentRoot, "bin", "openreaper-mcp");
  const vendorRoot = path.join(fixture.currentRoot, "vendor");
  const kernelRoot = path.join(vendorRoot, "openreaper-kernel");
  const serverSourceRoot = path.join(REPO_ROOT, "packages", "mcp-server", "src");
  const installedServerRoot = path.join(kernelRoot, "packages", "mcp-server", "src");
  const sessionRoot = path.join(fixture.currentRoot, "session");
  await mkdir(path.dirname(wrapper), { recursive: true });
  await mkdir(installedServerRoot, { recursive: true });
  await mkdir(path.join(sessionRoot, "renders"), { recursive: true });
  await mkdir(path.join(sessionRoot, "transport", "requests"), { recursive: true });
  await mkdir(path.join(sessionRoot, "transport", "results"), { recursive: true });
  await mkdir(path.join(sessionRoot, "artifacts"), { recursive: true });
  await mkdir(path.join(kernelRoot, "recipes", "user"), { recursive: true });
  await copyFile(WRAPPER_SOURCE, wrapper);
  await copyFile(
    path.join(REPO_ROOT, "recipes", "user", ".gitkeep"),
    path.join(kernelRoot, "recipes", "user", ".gitkeep"),
  );
  await chmod(wrapper, 0o755);
  await copyFile(
    path.join(serverSourceRoot, "openreaper-mcp-stdio.mjs"),
    path.join(installedServerRoot, "openreaper-mcp-stdio.mjs"),
  );
  for (const entry of await readdir(serverSourceRoot, { withFileTypes: true })) {
    if (entry.name === "openreaper-mcp-stdio.mjs") continue;
    await symlink(path.join(serverSourceRoot, entry.name), path.join(installedServerRoot, entry.name));
  }
  await symlink(path.join(REPO_ROOT, "packages", "core"), path.join(kernelRoot, "packages", "core"));
  await symlink(path.join(REPO_ROOT, "node_modules"), path.join(kernelRoot, "node_modules"));
  await symlink(path.join(REPO_ROOT, "docs"), path.join(fixture.currentRoot, "docs"));
  fixture.wrapper = wrapper;
  fixture.renderRoot = path.join(sessionRoot, "renders");
}

async function connectWrapper(fixture, name) {
  const client = new Client({ name, version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: fixture.wrapper,
    args: [],
    cwd: REPO_ROOT,
    env: wrapperEnv(fixture),
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

function wrapperEnv(fixture) {
  return {
    ...process.env,
    HOME: fixture.homeRoot,
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT: fixture.renderRoot,
    OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
    OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
  };
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

async function callJson(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
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
    title: "Installed fixture",
    summary: "Bounded installed Recipe lifecycle fixture.",
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
      project_identity: "project:tab:fixture-a",
      bridge_owner: "owner:fixture",
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

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: REPO_ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

#!/usr/bin/env node

import { access, constants as fsConstants } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONTRACT = "alpha3.4.e3.installed_recipe_closure.v1";
const REPORT_FILENAME = "alpha3-4-e3-installed-recipe.json";
const EXACT_TOOLS = ["call_recipe", "call_template", "get_state", "list_recipes", "list_templates", "ping"];
const MAX_REPORT_BYTES = 8192;

let options;
try {
  options = parseArgs(process.argv.slice(2));
  await validateOptions(options);
  await createFreshEvidenceRoot(options.evidence_root);
} catch (error) {
  process.stderr.write(`[OpenReaper] ${bounded(error?.message ?? "invalid installed Recipe smoke options")}\n`);
  process.exit(2);
}

const installRoot = path.dirname(path.dirname(options.installed_wrapper));
const recipeRoot = path.join(path.dirname(installRoot), "data", "executable-recipes");
const callerRoot = path.join(options.evidence_root, "caller-owned-store");
const reportPath = path.join(options.evidence_root, REPORT_FILENAME);
const report = {
  contract: CONTRACT,
  ok: false,
  installed_wrapper: options.installed_wrapper,
  executable_recipe_root: recipeRoot,
  tools: [],
  product_counts: null,
  catalog_hash: null,
  lifecycle: [],
  identity: null,
  caller_override_created: null,
  clients_closed: false,
  error: null,
};

let client = null;
let wrapperStderr = "";
try {
  const catalogModulePath = path.join(
    installRoot,
    "vendor",
    "openreaper-kernel",
    "packages",
    "mcp-server",
    "src",
    "executable-recipe-product-catalog-v1.mjs",
  );
  const productCatalog = await import(pathToFileURL(catalogModulePath));
  const catalog = productCatalog.createExecutableRecipeProductCatalog();
  report.product_counts = { macros: catalog.macros.length, templates: catalog.templates.length };
  report.catalog_hash = productCatalog.hashExecutableRecipeProductCatalog();
  if (catalog.macros.length !== 15 || catalog.templates.length !== 235) {
    throw new Error("installed executable Recipe product catalog count drift");
  }

  client = new Client({ name: "openreaper-alpha34-e3-installed-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: options.installed_wrapper,
    args: [],
    cwd: installRoot,
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_OWNER: process.env.OPENREAPER_LIVE_BRIDGE_OWNER || "openreaper-alpha",
      OPENREAPER_LIVE_BRIDGE_GENERATION: process.env.OPENREAPER_LIVE_BRIDGE_GENERATION || "1",
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => { wrapperStderr += chunk; });
  await client.connect(transport);
  report.tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assertSameArray(report.tools, EXACT_TOOLS, "installed MCP tool surface");

  const initial = await callRecipe(client, { operation: "list" });
  if (initial.ok !== true) throw new Error("installed Recipe store list failed before lifecycle");
  const recipeId = `recipe.tracks.e3_installed_smoke_${process.pid}_${Date.now()}`;
  const draft = productDraft(catalog, recipeId);

  const validated = await callRecipe(client, {
    operation: "validate",
    draft,
    root: callerRoot,
    catalog: { macros: [], templates: [], capabilities: [] },
  });
  if (validated.ok !== true || validated.status !== "validated") {
    throw new Error(`installed validate failed: ${JSON.stringify(validated)}`);
  }
  report.lifecycle.push("validate");

  const saved = await callRecipe(client, {
    operation: "save",
    draft,
    version: "1.0.0",
    revision_number: 1,
    saved_at: new Date().toISOString(),
    root: callerRoot,
    catalog: { macros: [], templates: [], capabilities: [] },
  });
  if (saved.ok !== true || saved.immutable !== true) {
    throw new Error(`installed save failed: ${JSON.stringify(saved)}`);
  }
  report.lifecycle.push("save");
  report.identity = exactIdentity(saved);

  const listed = await callRecipe(client, {
    operation: "list",
    root: callerRoot,
    catalog: { macros: [], templates: [], capabilities: [] },
  });
  if (listed.ok !== true || listed.count !== initial.count + 1) {
    throw new Error(`installed list did not observe the saved revision: ${JSON.stringify(listed)}`);
  }
  report.lifecycle.push("list");

  const got = await callRecipe(client, {
    operation: "get",
    ...report.identity,
    root: callerRoot,
    catalog: { macros: [], templates: [], capabilities: [] },
  });
  if (got.ok !== true || JSON.stringify(exactIdentity(got)) !== JSON.stringify(report.identity)) {
    throw new Error(`installed get did not preserve exact immutable identity: ${JSON.stringify(got)}`);
  }
  report.lifecycle.push("get");

  const deleted = await callRecipe(client, {
    operation: "delete",
    ...report.identity,
    confirm: true,
    root: callerRoot,
    catalog: { macros: [], templates: [], capabilities: [] },
  });
  if (deleted.ok !== true || deleted.deleted !== true) {
    throw new Error(`installed delete failed: ${JSON.stringify(deleted)}`);
  }
  report.lifecycle.push("delete");

  const finalList = await callRecipe(client, { operation: "list" });
  if (finalList.ok !== true || finalList.count !== initial.count) {
    throw new Error("installed Recipe store did not return to its initial revision count");
  }
  report.caller_override_created = await exists(callerRoot);
  if (report.caller_override_created) throw new Error("caller root override created an alternate Recipe store");
  report.ok = true;
} catch (error) {
  report.error = bounded(`${error?.stack ?? error?.message ?? error}${wrapperStderr ? `\n${wrapperStderr}` : ""}`);
} finally {
  if (client) {
    try {
      await client.close();
      report.clients_closed = true;
    } catch (error) {
      report.error ??= bounded(error?.message ?? error);
    }
  } else {
    report.clients_closed = true;
  }
}

if (!report.clients_closed) report.ok = false;
const reportBytes = Buffer.byteLength(JSON.stringify(report), "utf8");
if (reportBytes > MAX_REPORT_BYTES) {
  report.ok = false;
  report.error = `evidence report exceeded ${MAX_REPORT_BYTES} bytes`;
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ ok: report.ok, contract: CONTRACT, evidence: reportPath })}\n`);
if (!report.ok) {
  process.stderr.write(`[OpenReaper] ${report.error ?? "installed Recipe lifecycle smoke failed"}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || typeof value !== "string" || value.startsWith("--")) {
      throw new Error("usage: smoke-alpha3-4-e3-installed-recipe.mjs --installed-wrapper <absolute-path> --evidence-root <absolute-fresh-path>");
    }
    if (key === "--installed-wrapper") parsed.installed_wrapper = value;
    else if (key === "--evidence-root") parsed.evidence_root = value;
    else throw new Error(`unknown option: ${key}`);
    index += 1;
  }
  return parsed;
}

async function validateOptions(value) {
  for (const key of ["installed_wrapper", "evidence_root"]) {
    if (typeof value[key] !== "string" || !path.isAbsolute(value[key])) {
      throw new Error(`${key} must be an absolute path`);
    }
  }
  const wrapper = await lstat(value.installed_wrapper).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!wrapper || wrapper.isSymbolicLink() || !wrapper.isFile()) {
    throw new Error("installed_wrapper must be a non-symlink regular file");
  }
  await new Promise((resolve, reject) => access(value.installed_wrapper, fsConstants.X_OK, (error) => error ? reject(error) : resolve()));
}

async function createFreshEvidenceRoot(root) {
  const current = await lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (current) {
    if (current.isSymbolicLink() || !current.isDirectory()) throw new Error("evidence_root must be a non-symlink directory");
    if ((await readdir(root)).length !== 0) throw new Error("evidence_root must be fresh and empty");
    return;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const created = await lstat(root);
  if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("evidence_root could not be created safely");
}

async function callRecipe(client, args) {
  const response = await client.callTool({ name: "call_recipe", arguments: args });
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error("call_recipe returned no JSON text content");
  return JSON.parse(text);
}

function productDraft(catalog, id) {
  const macro = catalog.getMacro("macro.project.inspect");
  const template = catalog.getTemplate("template.tracks.create_track");
  if (!macro || !template) throw new Error("installed product catalog lacks lifecycle fixture dependencies");
  return {
    contract: "recipe.executable.draft.v1",
    id,
    title: "Installed lifecycle smoke",
    summary: "Bounded installed Recipe lifecycle smoke.",
    pack: "tracks",
    risk: "write",
    inputs: [{ id: "track_name", type: "string", required: true }],
    outputs: [{ id: "track_ref", type: "ref.track", required: true }],
    stages: [
      { id: "run_macro", kind: "macro", dependency: { kind: "macro", id: macro.id, version: macro.version, fallback_reason: null }, inputs: ["track_name"], outputs: ["project_summary"], risk: macro.risk, checkpoint: "checkpoint_macro" },
      { id: "readback", kind: "template", dependency: { kind: "template", id: template.id, version: template.version, fallback_reason: "official_template_atom_required" }, inputs: ["project_summary", "track_name"], outputs: ["track_ref"], risk: template.risk, checkpoint: "checkpoint_readback" },
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
    preflight: { contract: "recipe.executable.preflight.v1", complete_graph: true, stage_count: 2, dependency_count: 2, requires_validation_before_save: true, requires_save_before_run: true, forbids_inline_execution: true },
    portability: { project_identity: "project:tab:fixture-a", bridge_owner: "owner:fixture", bridge_generation: "1", platform: "darwin" },
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

function assertSameArray(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} mismatch: ${JSON.stringify(actual)}`);
  }
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

function bounded(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 1200);
}

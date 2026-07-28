import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  ALPHA345_NOVICE_CONTRACT,
  ALPHA345_NOVICE_EXACT_TOOLS,
  ALPHA345_NOVICE_MACRO_IDS,
  ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS,
  ALPHA345_NOVICE_RECIPE_OPS,
  createNoviceResumeRecipeDraft,
  createNoviceUserRecipeDraft,
  runInstalledNoviceTrial,
} from "../../scripts/trial-alpha3-45-installed-novice.mjs";
import { validateExecutableRecipeDraft } from "../../packages/core/src/executable-recipe-contract-v1.mjs";
import { createExecutableRecipeProductCatalog } from "../../packages/mcp-server/src/executable-recipe-product-catalog-v1.mjs";

const roots = [];
const HARNESS_PATH = path.resolve("scripts/trial-alpha3-45-installed-novice.mjs");

after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("fake transport proves manuals, exact-four official recipes, resume, authoring, and reconnect", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-novice-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp");
  const evidenceRoot = path.join(root, "evidence");
  await writeFile(wrapper, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(wrapper, 0o755);

  const clients = [];
  const requests = [];
  const store = new Map();
  const report = await runInstalledNoviceTrial({
    installedWrapper: wrapper,
    evidenceRoot,
    connectFactory: async ({ clientName }) => {
      const client = createMockClient({ clientName, requests, store });
      clients.push(client);
      return client;
    },
  });

  assert.equal(report.contract, ALPHA345_NOVICE_CONTRACT);
  assert.equal(report.ok, true, JSON.stringify(report.error));
  assert.deepEqual(report.public_tools, ALPHA345_NOVICE_EXACT_TOOLS);
  assert.deepEqual(report.discovery.macro_manual_ids, [...ALPHA345_NOVICE_MACRO_IDS]);
  assert.deepEqual(report.discovery.macro_example_ids, [...ALPHA345_NOVICE_MACRO_IDS]);
  assert.deepEqual(report.discovery.recipe_lifecycle_ops, [...ALPHA345_NOVICE_RECIPE_OPS]);
  assert.deepEqual(report.discovery.official_recipe_ids, [...ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS]);
  assert.deepEqual(report.discovery.official_manual_ids, [...ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS]);
  assert.equal(report.discovery.official_catalog_count, 4);
  assert.equal(report.discovery.official_legacy_or_draft_leak_count, 0);
  assert.equal(report.discovery.direct_template_fallback, true);
  assert.equal(report.exact_expansions.macros_expanded, 15);
  assert.equal(report.exact_expansions.official_recipes_expanded, 4);
  assert.equal(report.authoring.temp_run_ok, true);
  assert.equal(report.authoring.persistent_save_ok, true);
  assert.equal(report.authoring.resume_partial_ok, true);
  assert.equal(report.authoring.resume_recovery_ok, true);
  assert.equal(report.authoring.resume_success_ok, true);
  assert.equal(report.authoring.rediscovered_after_reconnect, true);
  assert.equal(report.authoring.one_public_run_after_reconnect, true);
  assert.equal(report.final_state.clients_closed, true);
  assert.equal(report.recovery_posture.public_tools_only, true);
  assert.equal(report.recovery_posture.absolute_installed_wrapper_only, true);
  assert.equal(report.recovery_posture.fresh_evidence_root, true);
  assert.equal(report.recovery_posture.no_source_inspection, true);
  assert.equal(report.recovery_posture.no_reaper_mutation_parallelism, true);
  assert.equal(report.prohibited_paths.filesystem_or_source_discovery, false);
  assert.equal(report.prohibited_paths.raw_lua_action_shell_ui, false);
  assert.equal(report.prohibited_paths.non_public_tools, false);
  assert.equal(report.prohibited_paths.mutation_parallelism, false);
  assert.ok(report.call_counts.total >= 18);
  assert.ok(report.call_counts.by_tool.list_recipes >= 3);
  assert.ok(report.call_counts.by_tool.call_recipe >= 12);
  assert.ok(report.call_counts.recipe_ops.validate >= 2);
  assert.ok(report.call_counts.recipe_ops.save >= 3);
  assert.ok(report.call_counts.recipe_ops.run >= 3);
  assert.ok(report.call_counts.recipe_ops.resume >= 1);
  assert.ok(report.call_counts.recipe_ops.delete >= 2);
  assert.ok(report.call_counts.recipe_ops.get >= 1);
  assert.ok(report.timings.total_duration_ms >= 0);
  assert.ok(report.response_sizes.total_bytes > 0);
  assert.ok(report.authoring.identity?.recipe_id);
  assert.ok(clients.every((client) => client.closed));
  assert.equal(clients.length, 2);

  const toolNames = requests.map((request) => request.name);
  assert.ok(toolNames.includes("ping"));
  assert.ok(toolNames.includes("list_templates"));
  assert.ok(toolNames.includes("list_recipes"));
  assert.ok(toolNames.includes("call_recipe"));
  assert.ok(toolNames.every((name) => ALPHA345_NOVICE_EXACT_TOOLS.includes(name)));
  assert.ok(requests.every((request) => !JSON.stringify(request).includes("packages/mcp-server")));
  assert.ok(requests.every((request) => !JSON.stringify(request).includes("Promise.all")));

  const exactMacroRequest = requests.find((request) => (
    request.name === "list_templates"
    && Array.isArray(request.arguments?.ids)
    && request.arguments.ids.includes("macro.project.inspect")
  ));
  assert.ok(exactMacroRequest, "novice did not request exact Macro expansion");
  const submittedDraft = requests.find((request) => (
    request.name === "call_recipe"
    && request.arguments?.operation === "validate"
    && request.arguments?.draft?.stages?.[0]?.id === "inspect"
  ))?.arguments?.draft;
  const publicDependency = macroDependency("macro.project.inspect");
  assert.deepEqual(submittedDraft.dependencies[0], {
    kind: publicDependency.kind,
    id: publicDependency.id,
    version: publicDependency.version,
    risk: publicDependency.risk,
    fallback_reason: null,
    descriptor_hash: publicDependency.descriptor_hash,
  });
  assert.deepEqual(submittedDraft.required_capabilities, publicDependency.capabilities);
  assert.deepEqual(submittedDraft.portability, {
    project_identity: "project:tab:fixture",
    bridge_owner: "owner:fixture",
    bridge_generation: "1",
    platform: "darwin",
  });

  const persisted = JSON.parse(await readFile(report.evidence_path, "utf8"));
  assert.equal(persisted.ok, true);
  assert.equal(Buffer.byteLength(await readFile(report.evidence_path), "utf8") <= 32_768, true);
  assert.equal(path.basename(report.evidence_path), "alpha3-45-installed-novice.json");
});

test("fails closed and closes clients when official Recipe manuals are incomplete", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-novice-fail-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp");
  await writeFile(wrapper, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(wrapper, 0o755);
  const clients = [];
  const report = await runInstalledNoviceTrial({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    connectFactory: async ({ clientName }) => {
      const client = createMockClient({
        clientName,
        requests: [],
        store: new Map(),
        officialManualIds: ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS.slice(0, 2),
      });
      clients.push(client);
      return client;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "ALPHA345_NOVICE_ASSERTION_FAILED");
  assert.match(report.error.message, /official Recipe/);
  assert.equal(report.final_state.clients_closed, true);
  assert.ok(clients.every((client) => client.closed));
});

test("rejects non-absolute installed wrapper and non-fresh evidence root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-novice-args-"));
  roots.push(root);
  await assert.rejects(
    () => runInstalledNoviceTrial({
      installedWrapper: "relative/openreaper-mcp",
      evidenceRoot: path.join(root, "evidence"),
    }),
    /installedWrapper must be an absolute path/,
  );

  const wrapper = path.join(root, "openreaper-mcp");
  await writeFile(wrapper, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(wrapper, 0o755);
  const evidenceRoot = path.join(root, "evidence-dirty");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(path.join(evidenceRoot, "stale.json"), "{}\n", "utf8");
  await assert.rejects(
    () => runInstalledNoviceTrial({
      installedWrapper: wrapper,
      evidenceRoot,
      connectFactory: async () => createMockClient({ clientName: "x", requests: [], store: new Map() }),
    }),
    /evidenceRoot must be fresh and empty/,
  );
});

test("resume fixture draft validates against exact public product dependencies", () => {
  const catalog = createExecutableRecipeProductCatalog();
  const dependency = (id) => ({ kind: "macro", ...catalog.getMacro(id) });
  const draft = createNoviceResumeRecipeDraft({
    projectFileDependency: dependency("macro.project.file"),
    projectQueryDependency: dependency("macro.project.query"),
    portability: {
      project_identity: "project:tab:fixture",
      bridge_owner: "owner:fixture",
      bridge_generation: "1",
      platform: "darwin",
    },
  });
  assert.deepEqual(validateExecutableRecipeDraft(draft, { catalog }), { ok: true, errors: [] });
});

test("statically verifies installed-wrapper-only public-tool truth and no REAPER mutation parallelism", async () => {
  const source = await readFile(HARNESS_PATH, "utf8");
  assert.match(source, /ALPHA345_NOVICE_EXACT_TOOLS/);
  assert.match(source, /call_recipe/);
  assert.match(source, /list_recipes/);
  assert.match(source, /list_templates/);
  assert.match(source, /installedWrapper/);
  assert.match(source, /assertAbsolute\(installedWrapper/);
  assert.match(source, /assertExecutableRegularFile/);
  assert.match(source, /createFreshDirectory\(evidenceRoot\)/);
  assert.match(source, /StdioClientTransport/);
  assert.match(source, /command:\s*installedWrapper/);
  assert.match(source, /function auditPublicRequest/);
  assert.match(source, /no_source_inspection/);
  assert.match(source, /no_reaper_mutation_parallelism/);
  assert.match(source, /absolute_installed_wrapper_only/);
  assert.match(source, /ALPHA345_NOVICE_MACRO_IDS/);
  assert.match(source, /ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS/);
  assert.match(source, /ALPHA345_NOVICE_RECIPE_OPS/);
  assert.doesNotMatch(source, /openreaper-mcp-stdio\.mjs/);
  assert.doesNotMatch(source, /from\s+["']node:child_process["']/);
  assert.doesNotMatch(source, /from\s+["']node:worker_threads["']/);
  assert.doesNotMatch(source, /Promise\.all\s*\(\s*\[/);
  assert.doesNotMatch(source, /spawn\s*\(|execFile\s*\(|execSync\s*\(/);
  assert.doesNotMatch(source, /readFileSync\s*\(\s*['"]packages\//);
  assert.equal(ALPHA345_NOVICE_MACRO_IDS.length, 15);
  assert.equal(ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS.length, 4);
  assert.equal(ALPHA345_NOVICE_RECIPE_OPS.length, 7);
  assert.equal(ALPHA345_NOVICE_EXACT_TOOLS.length, 6);
  assert.deepEqual([...ALPHA345_NOVICE_EXACT_TOOLS].sort(), [
    "call_recipe",
    "call_template",
    "get_state",
    "list_recipes",
    "list_templates",
    "ping",
  ]);

  const draft = createNoviceUserRecipeDraft({
    recipeId: "recipe.user.static_check",
    dependency: macroDependency("macro.project.inspect"),
    portability: { project_identity: "project:tab:fixture", bridge_owner: "owner:fixture", bridge_generation: "1", platform: "darwin" },
  });
  assert.equal(draft.contract, "recipe.executable.draft.v1");
  assert.equal(draft.stages[0].dependency.id, "macro.project.inspect");
  assert.deepEqual(draft.stages[0].outputs, ["evidence_ref"]);
  assert.deepEqual(draft.outputs, [{ id: "evidence_ref", type: "string", required: true }]);
  assert.equal(draft.preflight.forbids_inline_execution, true);
});

function createMockClient({
  clientName,
  requests,
  store,
  officialManualIds = [...ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS],
} = {}) {
  return {
    closed: false,
    clientName,
    getInstructions() {
      return "ping -> list_templates / list_recipes -> exact expansion -> one call_template or call_recipe";
    },
    async listTools() {
      return { tools: ALPHA345_NOVICE_EXACT_TOOLS.map((name) => ({ name })) };
    },
    async callTool(request) {
      requests.push({ ...request, clientName });
      const args = request.arguments ?? {};
      if (request.name === "ping") {
        return json({
          ok: true,
          product: "OpenReaper",
          tools: [...ALPHA345_NOVICE_EXACT_TOOLS],
          runtime_readiness: { bridge: { observed: { owner: "owner:fixture", generation: 1 } } },
        });
      }
      if (request.name === "list_templates") {
        if (Array.isArray(args.ids) && args.ids.length > 0) {
          return json({
            ok: true,
            contract: "discovery.menu.v1",
            mode: "ids",
            items: args.ids.map((id) => ({
              id,
              inputSchema: { type: "object", additionalProperties: false, properties: {} },
              action_manual: { when_to_use: [`use ${id}`], examples: [] },
            })),
            product_surface: {
              agent_context_macro_guide: {
                macro_menu: { macro_ids: [...ALPHA345_NOVICE_MACRO_IDS] },
                requested_expansions: {
                  items: args.ids.map((id) => mockMacroExpansion(id)),
                },
              },
            },
          });
        }
        return json({
          ok: true,
          contract: "discovery.menu.v1",
          mode: "menu",
          items: ALPHA345_NOVICE_MACRO_IDS.map((id) => ({ id })),
          product_surface: {
            agent_context_macro_guide: {
              macro_menu: {
                macro_ids: [...ALPHA345_NOVICE_MACRO_IDS],
                visible_executable_count: 15,
              },
            },
          },
        });
      }
      if (request.name === "list_recipes") {
        const ids = Array.isArray(args.ids) ? args.ids : [];
        const storeItems = [...store.values()]
          .filter((entry) => ids.length === 0 || ids.includes(entry.recipe_id))
          .map((entry) => ({
            id: entry.recipe_id,
            version: entry.version,
            revision: entry.revision,
            content_hash: entry.content_hash,
            validation_result_id: entry.validation_result_id,
            source: "user",
          }));
        const requestedOfficialIds = ids.length === 0 ? ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS : ids;
        const officialItems = requestedOfficialIds
          .filter((id) => ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS.includes(id))
          .map((id) => ({ id, source: "official" }));
        return json({
          ok: true,
          contract: "discovery.menu.v1",
          mode: ids.length > 0 ? "ids" : "menu",
          items: [...storeItems, ...officialItems],
          product_surface: {
            recipe_productization: {
              contract: "openreaper.alpha3.45.recipe_productization_manual.v1",
              lifecycle: { operations: [...ALPHA345_NOVICE_RECIPE_OPS] },
              official_recipe_ids: [...ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS],
              requested_manuals: officialManualIds.map((id) => ({
                id,
                summary: `manual for ${id}`,
                required_inputs: [],
              })),
            },
            direct_template_fallback: {
              allowed_only_after_typed_reason: true,
              discover: { tool: "list_templates", arguments: { surface: "catalog", limit: 25 } },
              expand: { tool: "list_templates", arguments: { ids: ["template.project.read_summary"] } },
              reasons: ["macro_missing_for_task"],
            },
          },
        });
      }
      if (request.name === "call_template" && args.id === "template.project.list_open_projects") {
        return json({
          ok: true,
          result: {
            summary: {
              coverage_status: "complete",
              projects: [{ project_ref: "project:tab:fixture", active: true }],
              total_count: 1,
              returned_count: 1,
            },
          },
        });
      }
      if (request.name === "call_template" && args.id === "macro.project.query") {
        return json({ ok: true, status: "completed", mutation_truth: "not_applied", zero_write: true });
      }
      if (request.name === "call_recipe") {
        return json(handleCallRecipe(store, args));
      }
      return json({ ok: false, error: { code: "UNEXPECTED_TOOL", message: request.name } });
    },
    async close() {
      this.closed = true;
    },
  };
}

function mockMacroExpansion(id) {
  const publicCall = { tool: "call_template", executable_now: true, arguments: { id, input: {} } };
  return {
    id,
    action_manual: { id, examples: [{ name: "minimum public call", input: {} }] },
    first_try_execution_guide: {
      examples: [{ name: "minimum public call", input: {}, public_call: publicCall }],
      outcome_truth: {
        readback_steps: ["read live result"],
        success_criteria: ["live result matches request"],
      },
      recovery: { steps: ["inspect blocker and retry only after repair"] },
    },
    ...(id.startsWith("macro.") ? { executable_recipe_dependency: macroDependency(id) } : {}),
  };
}

function macroDependency(id) {
  return {
    kind: "macro",
    id,
    version: id === "macro.project.file" ? "1.2.0" : "1.0.0",
    risk: id === "macro.project.file" ? "write" : "read",
    descriptor_hash: "a".repeat(64),
    capabilities: ["project.index"],
  };
}

function handleCallRecipe(store, args) {
  const op = args.operation;
  if (op === "validate") {
    if (args.draft?.contract !== "recipe.executable.draft.v1") {
      return { ok: false, status: "invalid", error: { code: "DRAFT_INVALID", message: "bad draft" } };
    }
    return { ok: true, status: "validated", mutates_recipe_root: false };
  }
  if (op === "save") {
    const identity = {
      recipe_id: args.draft.id,
      version: args.version,
      revision: args.revision_number ?? 1,
      content_hash: `hash_${args.draft.id}_${args.version}`.replace(/[^a-z0-9_]/giu, "_"),
      validation_result_id: `validation_${args.draft.id}_${args.version}`.replace(/[^a-z0-9_]/giu, "_"),
    };
    store.set(identityKey(identity), { ...identity, draft: args.draft, immutable: true });
    return { ok: true, status: "saved", immutable: true, ...identity };
  }
  if (op === "list") {
    const items = [...store.values()].map((entry) => ({
      recipe_id: entry.recipe_id,
      version: entry.version,
      revision: entry.revision,
      content_hash: entry.content_hash,
      validation_result_id: entry.validation_result_id,
      executable: true,
    }));
    return { ok: true, count: items.length, items, executable_truth: "saved_validated_revisions_only" };
  }
  if (op === "get") {
    const entry = store.get(identityKey(args));
    if (!entry) return { ok: false, error: { code: "NOT_FOUND", message: "missing revision" } };
    return {
      ok: true,
      ...exactIdentity(entry),
      source: "user",
      draft: entry.draft,
    };
  }
  if (op === "delete") {
    const key = identityKey(args);
    const existed = store.delete(key);
    return { ok: true, deleted: existed };
  }
  if (op === "run") {
    const entry = store.get(identityKey(args));
    if (!entry) return { ok: false, error: { code: "NOT_FOUND", message: "missing revision for run" } };
    if (entry.draft.id.includes("novice_resume_") && entry.resume_started !== true) {
      entry.resume_started = true;
      return {
        ok: false,
        operation: "run",
        status: "partial",
        resume_safe: true,
        recipe_id: entry.recipe_id,
        run_id: `run_${entry.recipe_id}`,
        latest_checkpoint: { checkpoint_id: "checkpoint_projects_listed", stage_id: "list_open_projects" },
        error: { code: "INDEX_NOT_READY", message: "hydrate the cold Project Index", details: { zero_write: true } },
      };
    }
    return {
      ok: true,
      status: "completed",
      outcome: "completed",
      recipe_id: entry.recipe_id,
      run_id: `run_${entry.recipe_id}`,
      evidence_ref: `evidence:${entry.recipe_id}`,
    };
  }
  if (op === "resume") {
    const entry = store.get(identityKey(args));
    if (!entry || entry.resume_started !== true) {
      return { ok: false, error: { code: "RESUME_IDENTITY_INVALID", message: "resume fixture not started" } };
    }
    entry.resume_completed = true;
    return {
      ok: true,
      operation: "resume",
      status: "succeeded",
      recipe_id: entry.recipe_id,
      run_id: args.run_id,
      evidence_ref: `evidence:${entry.recipe_id}`,
    };
  }
  return { ok: false, error: { code: "UNSUPPORTED_OP", message: String(op) } };
}

function identityKey(value) {
  return [
    value.recipe_id,
    value.version,
    value.revision,
    value.content_hash,
    value.validation_result_id,
  ].join("|");
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

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

#!/usr/bin/env node

import { access, constants as fsConstants } from "node:fs";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const ALPHA345_NOVICE_CONTRACT = "alpha3.45.installed_novice_trial.v1";
export const ALPHA345_NOVICE_EXACT_TOOLS = Object.freeze([
  "call_recipe",
  "call_template",
  "get_state",
  "list_recipes",
  "list_templates",
  "ping",
]);
export const ALPHA345_NOVICE_MACRO_IDS = Object.freeze([
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.project.file",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.items.analyze",
  "macro.items.apply",
  "macro.midi.apply",
  "macro.fx.apply_chain",
  "macro.fx.set_controls",
  "macro.controls.set",
  "macro.automation.apply",
  "macro.render.targets",
]);
export const ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS = Object.freeze([
  "recipe.mix.create_bus_processing",
  "recipe.midi.create_instrument_part",
  "recipe.media.create_layered_sound_effect_variants",
  "recipe.items.create_sound_variations",
]);
export const ALPHA345_NOVICE_RECIPE_OPS = Object.freeze([
  "validate",
  "save",
  "list",
  "get",
  "delete",
  "run",
  "resume",
]);
export const ALPHA345_NOVICE_NL_QUERY = "save a reusable inspect recipe I can run again later";

const REPORT_NAME = "alpha3-45-installed-novice.json";
const REPORT_MAX_BYTES = 32_768;
const CALL_TIMEOUT_MS = 30_000;
const DIRECT_RUN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function connectInstalledNoviceClient({
  installedWrapper,
  installedArgs = [],
  clientName = "primary",
  env = process.env,
} = {}) {
  const client = new Client({ name: `openreaper-alpha345-novice-${clientName}`, version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: installedWrapper,
    args: installedArgs,
    cwd: path.dirname(installedWrapper),
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`${error?.message ?? error}${stderr ? `: ${bounded(stderr, 512)}` : ""}`);
  }
  return client;
}

export async function runInstalledNoviceTrial({
  installedWrapper,
  installedArgs = [],
  evidenceRoot,
  connectFactory = connectInstalledNoviceClient,
  draftFactory = createNoviceUserRecipeDraft,
  resumeDraftFactory = createNoviceResumeRecipeDraft,
  recipeInputsFactory = () => ({}),
  naturalLanguageQuery = ALPHA345_NOVICE_NL_QUERY,
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  assertArgumentVector(installedArgs, "installedArgs");
  await assertExecutableRegularFile(installedWrapper);
  await createFreshDirectory(evidenceRoot);

  const report = {
    contract: ALPHA345_NOVICE_CONTRACT,
    ok: false,
    installed_wrapper: installedWrapper,
    installed_wrapper_args: installedArgs,
    public_tools: null,
    discovery: {
      macro_manual_ids: [],
      macro_example_ids: [],
      recipe_lifecycle_ops: [],
      official_recipe_ids: [],
      official_manual_ids: [],
      official_catalog_count: 0,
      official_legacy_or_draft_leak_count: 0,
      direct_template_fallback: false,
    },
    exact_expansions: {
      macros_expanded: 0,
      official_recipes_expanded: 0,
    },
    authoring: {
      query: naturalLanguageQuery,
      sequence: [],
      identity: null,
      temp_run_ok: false,
      persistent_save_ok: false,
      resume_partial_ok: false,
      resume_recovery_ok: false,
      resume_success_ok: false,
      rediscovered_after_reconnect: false,
      one_public_run_after_reconnect: false,
    },
    calls: [],
    call_counts: {
      total: 0,
      by_tool: Object.fromEntries(ALPHA345_NOVICE_EXACT_TOOLS.map((tool) => [tool, 0])),
      recipe_ops: Object.fromEntries(ALPHA345_NOVICE_RECIPE_OPS.map((op) => [op, 0])),
      macro_calls: 0,
      template_calls: 0,
    },
    timings: {
      total_duration_ms: 0,
      by_tool: Object.fromEntries(ALPHA345_NOVICE_EXACT_TOOLS.map((tool) => [tool, 0])),
      recipe_run_ms: [],
      macro_ms: [],
    },
    response_sizes: {
      max_bytes: 0,
      total_bytes: 0,
      by_tool: Object.fromEntries(ALPHA345_NOVICE_EXACT_TOOLS.map((tool) => [tool, 0])),
    },
    friction: [],
    final_state: {
      clients_connected: 0,
      clients_closed: false,
      mutation_parallelism: false,
      source_inspected: false,
    },
    recovery_posture: {
      public_tools_only: true,
      absolute_installed_wrapper_only: true,
      fresh_evidence_root: true,
      no_source_inspection: true,
      no_reaper_mutation_parallelism: true,
      clients_closed: false,
    },
    prohibited_paths: {
      filesystem_or_source_discovery: false,
      raw_lua_action_shell_ui: false,
      non_public_tools: false,
      mutation_parallelism: false,
    },
    error: null,
  };

  const clients = [];
  const trialStarted = performance.now();
  try {
    const primary = await connectFactory({ installedWrapper, installedArgs, clientName: "primary" });
    clients.push({ id: "primary", client: primary, closed: false });
    report.final_state.clients_connected += 1;
    await assertPublicSurface(primary, report);

    const ping = await callJson(primary, report, "primary", "ping", {});
    assert(ping.ok === true, "ping failed");
    const bridgeIdentity = exactBridgeIdentity(ping);

    const menu = await callJson(primary, report, "primary", "list_templates", { limit: 25 });
    const menuGuide = menu?.product_surface?.agent_context_macro_guide;
    const menuMacroIds = menuGuide?.macro_menu?.macro_ids ?? menuGuide?.macro_ids ?? [];
    assertSameSet(menuMacroIds, ALPHA345_NOVICE_MACRO_IDS, "list_templates compact macro menu");

    const exactMacros = await callJson(primary, report, "primary", "list_templates", {
      ids: [...ALPHA345_NOVICE_MACRO_IDS],
      fields: ["id", "inputSchema", "examples"],
    });
    const expandedMacroIds = (exactMacros.items ?? [])
      .filter((item) => item?.id && (item.inputSchema || item.action_manual || item.first_try_execution_guide))
      .map((item) => item.id);
    const guideExpansions = exactMacros?.product_surface?.agent_context_macro_guide?.requested_expansions?.items ?? [];
    const guideMacroIds = guideExpansions.map((item) => item.id).filter(Boolean);
    const allMacroManualIds = unique([...expandedMacroIds, ...guideMacroIds, ...menuMacroIds]);
    assertSameSet(allMacroManualIds, ALPHA345_NOVICE_MACRO_IDS, "15 Macro manuals via public discovery");
    const exampleReadyIds = [];
    for (const expansion of guideExpansions) {
      const guide = expansion?.first_try_execution_guide;
      assert(Array.isArray(guide?.examples) && guide.examples.length > 0, `${expansion?.id} public examples missing`);
      assert(Array.isArray(guide?.outcome_truth?.readback_steps) && guide.outcome_truth.readback_steps.length > 0, `${expansion?.id} readback truth missing`);
      assert(Array.isArray(guide?.outcome_truth?.success_criteria) && guide.outcome_truth.success_criteria.length > 0, `${expansion?.id} success truth missing`);
      assert(Array.isArray(guide?.recovery?.steps) && guide.recovery.steps.length > 0, `${expansion?.id} recovery missing`);
      for (const example of guide.examples) {
        assert(example?.public_call?.tool === "call_template", `${expansion?.id} example public tool missing`);
        assert(example?.public_call?.arguments?.id === expansion.id, `${expansion?.id} example public id mismatch`);
        assert(example?.public_call?.arguments?.input && typeof example.public_call.arguments.input === "object", `${expansion?.id} example public input missing`);
      }
      exampleReadyIds.push(expansion.id);
    }
    assertSameSet(exampleReadyIds, ALPHA345_NOVICE_MACRO_IDS, "15 Macro public examples");
    const inspectDependency = guideExpansions.find((entry) => entry.id === "macro.project.inspect")?.executable_recipe_dependency;
    const projectFileDependency = guideExpansions.find((entry) => entry.id === "macro.project.file")?.executable_recipe_dependency;
    const projectQueryDependency = guideExpansions.find((entry) => entry.id === "macro.project.query")?.executable_recipe_dependency;
    assertExecutableDependency(inspectDependency, "macro.project.inspect");
    assertExecutableDependency(projectFileDependency, "macro.project.file");
    assertExecutableDependency(projectQueryDependency, "macro.project.query");
    report.discovery.macro_manual_ids = [...ALPHA345_NOVICE_MACRO_IDS];
    report.discovery.macro_example_ids = [...ALPHA345_NOVICE_MACRO_IDS];
    report.exact_expansions.macros_expanded = ALPHA345_NOVICE_MACRO_IDS.length;

    const recipes = await callJson(primary, report, "primary", "list_recipes", { limit: 25 });
    const productization = recipes?.product_surface?.recipe_productization;
    const lifecycleOps = productization?.lifecycle?.operations ?? [];
    assertSameSet(lifecycleOps, ALPHA345_NOVICE_RECIPE_OPS, "full Recipe lifecycle ops");
    report.discovery.recipe_lifecycle_ops = [...ALPHA345_NOVICE_RECIPE_OPS];

    const officialIds = productization?.official_recipe_ids ?? [];
    assertSameSet(officialIds, ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS, "four official Recipe ids");
    const defaultOfficialItems = assertExactOfficialCatalogItems(recipes?.items, "default official Recipe catalog");
    report.discovery.official_recipe_ids = [...ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS];
    report.discovery.official_catalog_count = defaultOfficialItems.length;

    const exactOfficial = await callJson(primary, report, "primary", "list_recipes", {
      ids: [...ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS],
      fields: ["steps", "assertions", "recovery"],
    });
    const officialManuals = exactOfficial?.product_surface?.recipe_productization?.requested_manuals ?? [];
    const officialManualIds = officialManuals.map((entry) => entry.id).filter(Boolean);
    assertSameSet(officialManualIds, ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS, "four official Recipe manuals");
    assert(officialManuals.length === ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS.length, "official Recipe manuals must contain exactly four unique rows");
    assertExactOfficialCatalogItems(exactOfficial?.items, "exact official Recipe expansion");
    report.discovery.official_manual_ids = [...ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS];
    report.exact_expansions.official_recipes_expanded = ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS.length;

    const fallback = recipes?.product_surface?.direct_template_fallback
      ?? productization?.direct_template_fallback
      ?? exactOfficial?.product_surface?.direct_template_fallback;
    assert(fallback && fallback.allowed_only_after_typed_reason === true, "direct Template fallback manual missing");
    assert(fallback.discover?.tool === "list_templates", "direct Template fallback discover tool mismatch");
    report.discovery.direct_template_fallback = true;

    const identityTemplate = await callJson(primary, report, "primary", "list_templates", {
      ids: ["template.project.list_open_projects"],
      fields: ["id", "inputSchema", "examples", "expectedDelta"],
    });
    assert(identityTemplate.items?.[0]?.id === "template.project.list_open_projects", "project identity Template expansion missing");
    const inventory = await callJson(primary, report, "primary", "call_template", {
      id: "template.project.list_open_projects",
      input: {},
      fallback_reason: "macro_target_ambiguous_or_unavailable",
    });
    const projectIdentity = exactActiveProjectIdentity(inventory);

    const resumeDraft = resumeDraftFactory({
      recipeId: `recipe.user.novice_resume_${process.pid}_${Date.now()}`,
      projectFileDependency,
      projectQueryDependency,
      portability: {
        project_identity: projectIdentity,
        bridge_owner: bridgeIdentity.owner,
        bridge_generation: bridgeIdentity.generation,
        platform: "darwin",
      },
    });
    assert(resumeDraft?.contract === "recipe.executable.draft.v1", "resumeDraftFactory must return recipe.executable.draft.v1");
    const resumeValidated = await callJson(primary, report, "primary", "call_recipe", {
      operation: "validate",
      draft: resumeDraft,
    });
    assert(resumeValidated.ok === true && resumeValidated.status === "validated", "resume fixture validation failed");
    const resumeSaved = await callJson(primary, report, "primary", "call_recipe", {
      operation: "save",
      draft: resumeDraft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: new Date().toISOString(),
    });
    assert(resumeSaved.ok === true && resumeSaved.immutable === true, "resume fixture immutable save failed");
    const resumeIdentity = exactIdentity(resumeSaved);
    const partial = await callJson(primary, report, "primary", "call_recipe", {
      operation: "run",
      ...resumeIdentity,
      inputs: noviceResumeInputs(),
    });
    assert(partial.ok === false && partial.status === "partial", "resume fixture must produce one typed partial run");
    assert(partial.resume_safe === true, "resume fixture partial run must be explicitly resume-safe");
    assert(typeof partial.run_id === "string" && partial.run_id !== "", "resume fixture partial run omitted run_id");
    assert(typeof partial.latest_checkpoint?.checkpoint_id === "string", "resume fixture partial run omitted latest checkpoint");
    report.authoring.resume_partial_ok = true;
    report.authoring.sequence.push("resume_partial");

    const repaired = await callJson(primary, report, "primary", "call_template", {
      id: "macro.project.query",
      input: { entity: "tracks", limit: 25, refresh_policy: "if_stale" },
    });
    assert(repaired.ok === true, "public Project Index recovery failed before resume");
    report.authoring.resume_recovery_ok = true;
    report.authoring.sequence.push("resume_recovery");

    const resumed = await callJson(primary, report, "primary", "call_recipe", {
      operation: "resume",
      ...resumeIdentity,
      run_id: partial.run_id,
      checkpoint_id: partial.latest_checkpoint.checkpoint_id,
    });
    assert(resumed.ok === true && resumed.operation === "resume", "public call_recipe resume did not complete");
    assert(resumed.run_id === partial.run_id, "public call_recipe resume changed run identity");
    report.authoring.resume_success_ok = true;
    report.authoring.sequence.push("resume_success");

    const resumeDeleted = await callJson(primary, report, "primary", "call_recipe", {
      operation: "delete",
      ...resumeIdentity,
      confirm: true,
    });
    assert(resumeDeleted.ok === true && resumeDeleted.deleted === true, "resume fixture cleanup delete failed");
    report.authoring.sequence.push("resume_delete");

    const draft = draftFactory({
      recipeId: `recipe.user.novice_${process.pid}_${Date.now()}`,
      query: naturalLanguageQuery,
      dependency: inspectDependency,
      portability: {
        project_identity: projectIdentity,
        bridge_owner: bridgeIdentity.owner,
        bridge_generation: bridgeIdentity.generation,
        platform: "darwin",
      },
    });
    assert(draft?.contract === "recipe.executable.draft.v1", "draftFactory must return recipe.executable.draft.v1");
    report.authoring.sequence.push("assemble_draft");

    const validated = await callJson(primary, report, "primary", "call_recipe", {
      operation: "validate",
      draft,
    });
    assert(validated.ok === true && validated.status === "validated", "validate failed for assembled user Recipe");
    report.authoring.sequence.push("validate");

    const tempSaved = await callJson(primary, report, "primary", "call_recipe", {
      operation: "save",
      draft,
      version: "0.0.1",
      revision_number: 1,
      saved_at: new Date().toISOString(),
    });
    assert(tempSaved.ok === true && tempSaved.immutable === true, "temporary immutable save failed");
    const tempIdentity = exactIdentity(tempSaved);
    report.authoring.sequence.push("temp_save");

    const tempRun = await callJson(primary, report, "primary", "call_recipe", {
      operation: "run",
      ...tempIdentity,
      inputs: recipeInputsFactory(tempIdentity, draft),
    });
    assert(tempRun.ok === true, "temporary one-off run failed");
    report.authoring.temp_run_ok = true;
    report.authoring.sequence.push("temp_run");

    const tempDeleted = await callJson(primary, report, "primary", "call_recipe", {
      operation: "delete",
      ...tempIdentity,
      confirm: true,
    });
    assert(tempDeleted.ok === true && tempDeleted.deleted === true, "temporary cleanup delete failed");
    report.authoring.sequence.push("temp_delete");

    const saved = await callJson(primary, report, "primary", "call_recipe", {
      operation: "save",
      draft,
      version: "1.0.0",
      revision_number: 1,
      saved_at: new Date().toISOString(),
    });
    assert(saved.ok === true && saved.immutable === true, "persistent immutable save failed");
    const identity = exactIdentity(saved);
    report.authoring.identity = identity;
    report.authoring.persistent_save_ok = true;
    report.authoring.sequence.push("persistent_save");

    const listed = await callJson(primary, report, "primary", "list_recipes", {
      ids: [identity.recipe_id],
      fields: ["steps", "assertions", "recovery"],
    });
    const listedIds = (listed.items ?? []).map((item) => item.id);
    assert(listedIds.includes(identity.recipe_id), "saved user Recipe missing from list_recipes");
    report.authoring.sequence.push("list_recipes");

    await closeClient(clients, "primary", report);

    const secondary = await connectFactory({ installedWrapper, installedArgs, clientName: "secondary" });
    clients.push({ id: "secondary", client: secondary, closed: false });
    report.final_state.clients_connected += 1;
    await assertPublicSurface(secondary, report);

    const rediscovered = await callJson(secondary, report, "secondary", "list_recipes", {
      ids: [identity.recipe_id],
      fields: ["steps", "assertions", "recovery"],
    });
    const rediscoveredIds = (rediscovered.items ?? []).map((item) => item.id);
    assert(rediscoveredIds.includes(identity.recipe_id), "reconnect list_recipes did not rediscover saved user Recipe");
    report.authoring.rediscovered_after_reconnect = true;
    report.authoring.sequence.push("reconnect_list_recipes");

    const got = await callJson(secondary, report, "secondary", "call_recipe", {
      operation: "get",
      ...identity,
    });
    assert(got.ok === true, "reconnect get failed");
    assertSameIdentity(exactIdentity(got), identity, "reconnect get identity");
    report.authoring.sequence.push("reconnect_get");

    const rerun = await callJson(secondary, report, "secondary", "call_recipe", {
      operation: "run",
      ...identity,
      inputs: recipeInputsFactory(identity, draft),
    });
    assert(rerun.ok === true, "one public call_recipe run after reconnect failed");
    report.authoring.one_public_run_after_reconnect = true;
    report.authoring.sequence.push("reconnect_one_public_run");

    report.timings.total_duration_ms = Math.round(performance.now() - trialStarted);
    report.call_counts.total = report.calls.length;
    report.ok = true;
  } catch (error) {
    report.error = {
      code: error?.code ?? "ALPHA345_NOVICE_TRIAL_FAILED",
      message: bounded(error?.message ?? error, 1200),
    };
    if (error?.friction) report.friction.push(error.friction);
    report.timings.total_duration_ms = Math.round(performance.now() - trialStarted);
    report.call_counts.total = report.calls.length;
  } finally {
    for (const entry of clients) {
      if (entry.closed) continue;
      try {
        await entry.client.close();
        entry.closed = true;
      } catch (error) {
        report.error ??= { code: "CLIENT_CLOSE_FAILED", message: bounded(error?.message ?? error, 512) };
      }
    }
    report.final_state.clients_closed = clients.length > 0 && clients.every((entry) => entry.closed);
    report.recovery_posture.clients_closed = report.final_state.clients_closed;
    report.recovery_posture.public_tools_only = !report.prohibited_paths.non_public_tools;
    report.recovery_posture.no_source_inspection = !report.prohibited_paths.filesystem_or_source_discovery
      && !report.final_state.source_inspected;
    report.recovery_posture.no_reaper_mutation_parallelism = !report.prohibited_paths.mutation_parallelism
      && !report.final_state.mutation_parallelism;
    if (!report.final_state.clients_closed) report.ok = false;
    if (report.prohibited_paths.filesystem_or_source_discovery
      || report.prohibited_paths.raw_lua_action_shell_ui
      || report.prohibited_paths.non_public_tools
      || report.prohibited_paths.mutation_parallelism) {
      report.ok = false;
    }
  }

  const reportPath = path.join(evidenceRoot, REPORT_NAME);
  let serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > REPORT_MAX_BYTES) {
    report.ok = false;
    report.error = { code: "REPORT_BUDGET_EXCEEDED", message: `report exceeded ${REPORT_MAX_BYTES} bytes` };
    serialized = `${JSON.stringify(report, null, 2)}\n`;
  }
  assert(Buffer.byteLength(serialized, "utf8") <= REPORT_MAX_BYTES, "bounded failure report exceeds report budget");
  await writeFile(reportPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { ...report, evidence_path: reportPath };
}

export function createNoviceUserRecipeDraft({
  recipeId = "recipe.user.novice_inspect",
  query = ALPHA345_NOVICE_NL_QUERY,
  dependency,
  portability,
} = {}) {
  assertExecutableDependency(dependency, "macro.project.inspect");
  assertPortability(portability);
  return {
    contract: "recipe.executable.draft.v1",
    id: recipeId,
    title: "Novice reusable inspect recipe",
    summary: `Natural-language-ish authoring from: ${bounded(query, 160)}`,
    pack: "project",
    risk: "read",
    inputs: [],
    outputs: [{ id: "evidence_ref", type: "string", required: true }],
    stages: [
      {
        id: "inspect",
        kind: "macro",
        dependency: {
          kind: "macro",
          id: "macro.project.inspect",
          version: dependency.version,
          fallback_reason: null,
        },
        inputs: [],
        outputs: ["evidence_ref"],
        risk: dependency.risk,
        checkpoint: "checkpoint_inspect",
      },
    ],
    bindings: [
      {
        from: { scope: "stage", id: "inspect", port: "evidence_ref" },
        to: { scope: "recipe_output", id: null, port: "evidence_ref" },
      },
    ],
    dependencies: [
      {
        kind: "macro",
        id: "macro.project.inspect",
        version: dependency.version,
        risk: dependency.risk,
        fallback_reason: null,
        descriptor_hash: dependency.descriptor_hash,
      },
    ],
    required_capabilities: [...dependency.capabilities],
    risk_grants: [dependency.risk],
    checkpoints: [
      {
        id: "checkpoint_inspect",
        after_stage: "inspect",
        evidence_id: "evidence_inspect",
        resume_identity: "resume.inspect",
        summary: "Inspect stage complete.",
      },
    ],
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 1,
      dependency_count: 1,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability: { ...portability },
  };
}

export function createNoviceResumeRecipeDraft({
  recipeId = "recipe.user.novice_resume",
  projectFileDependency,
  projectQueryDependency,
  portability,
} = {}) {
  assertExecutableDependency(projectFileDependency, "macro.project.file");
  assertExecutableDependency(projectQueryDependency, "macro.project.query");
  assertPortability(portability);
  const dependencies = [projectFileDependency, projectQueryDependency];
  return {
    contract: "recipe.executable.draft.v1",
    id: recipeId,
    title: "Novice resume recovery recipe",
    summary: "List open projects, then read a deliberately cold index scope and resume after public hydration.",
    pack: "project",
    risk: projectFileDependency.risk,
    inputs: [
      { id: "operation", type: "string", required: true },
      { id: "cursor", type: "string", required: true },
      { id: "entity", type: "string", required: true },
      { id: "refresh_policy", type: "string", required: true },
      { id: "limit", type: "integer", required: true },
    ],
    outputs: [],
    stages: [
      {
        id: "list_open_projects",
        kind: "macro",
        dependency: {
          kind: "macro",
          id: "macro.project.file",
          version: projectFileDependency.version,
          fallback_reason: null,
        },
        inputs: ["operation", "cursor", "limit"],
        outputs: [],
        risk: projectFileDependency.risk,
        checkpoint: "checkpoint_projects_listed",
      },
      {
        id: "read_cold_track_index",
        kind: "macro",
        dependency: {
          kind: "macro",
          id: "macro.project.query",
          version: projectQueryDependency.version,
          fallback_reason: null,
        },
        inputs: ["entity", "refresh_policy", "limit"],
        outputs: [],
        risk: projectQueryDependency.risk,
        checkpoint: "checkpoint_track_index_read",
      },
    ],
    bindings: [
      inputBinding("operation", "list_open_projects"),
      inputBinding("cursor", "list_open_projects"),
      inputBinding("limit", "list_open_projects"),
      inputBinding("entity", "read_cold_track_index"),
      inputBinding("refresh_policy", "read_cold_track_index"),
      inputBinding("limit", "read_cold_track_index"),
    ],
    dependencies: dependencies.map((dependency) => ({
      kind: "macro",
      id: dependency.id,
      version: dependency.version,
      risk: dependency.risk,
      fallback_reason: null,
      descriptor_hash: dependency.descriptor_hash,
    })),
    required_capabilities: unique(dependencies.flatMap((dependency) => dependency.capabilities)),
    risk_grants: unique(dependencies.map((dependency) => dependency.risk)),
    checkpoints: [
      {
        id: "checkpoint_projects_listed",
        after_stage: "list_open_projects",
        evidence_id: "evidence_projects_listed",
        resume_identity: "resume.projects_listed",
        summary: "Open project inventory completed without mutation.",
      },
      {
        id: "checkpoint_track_index_read",
        after_stage: "read_cold_track_index",
        evidence_id: "evidence_track_index_read",
        resume_identity: "resume.track_index_read",
        summary: "Track index read completed after public hydration.",
      },
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
    portability: { ...portability },
  };
}

function exactBridgeIdentity(ping) {
  const bridge = ping?.runtime_readiness?.bridge ?? ping?.live_bridge;
  const identity = bridge?.observed ?? bridge?.expected;
  const owner = identity?.owner;
  const generation = identity?.generation;
  assert(typeof owner === "string" && owner !== "", "ping omitted exact Bridge owner");
  assert(Number.isSafeInteger(generation) && generation >= 0, "ping omitted exact Bridge generation");
  return { owner, generation: String(generation) };
}

function exactActiveProjectIdentity(execution) {
  const summary = execution?.result?.summary;
  const projects = Array.isArray(summary?.projects) ? summary.projects : [];
  const active = projects.filter((project) => project?.active === true);
  assert(execution?.ok === true && summary?.coverage_status === "complete", "active Project inventory is incomplete");
  assert(active.length === 1 && typeof active[0].project_ref === "string", "active Project identity is ambiguous");
  return active[0].project_ref;
}

function assertExecutableDependency(value, id) {
  assert(value?.kind === "macro" && value?.id === id, `${id} executable dependency facts missing`);
  assert(typeof value.version === "string" && value.version !== "", `${id} dependency version missing`);
  assert(typeof value.risk === "string" && value.risk !== "", `${id} dependency risk missing`);
  assert(typeof value.descriptor_hash === "string" && /^[a-f0-9]{64}$/u.test(value.descriptor_hash), `${id} descriptor hash missing`);
  assert(Array.isArray(value.capabilities) && value.capabilities.length > 0, `${id} capabilities missing`);
}

function assertPortability(value) {
  assert(typeof value?.project_identity === "string" && /^project:(?:path|tab):/u.test(value.project_identity), "exact Project identity required");
  assert(typeof value?.bridge_owner === "string" && value.bridge_owner !== "", "exact Bridge owner required");
  assert(typeof value?.bridge_generation === "string" && /^\d+$/u.test(value.bridge_generation), "exact Bridge generation required");
}

function noviceResumeInputs() {
  return {
    operation: "list_open_projects",
    cursor: "0",
    entity: "tracks",
    refresh_policy: "never",
    limit: 25,
  };
}

function inputBinding(port, stageId) {
  return {
    from: { scope: "recipe_input", id: null, port },
    to: { scope: "stage", id: stageId, port },
  };
}

function assertExactOfficialCatalogItems(items, label) {
  assert(Array.isArray(items), `${label} omitted Recipe items`);
  const officialItems = items.filter((item) => !item?.id?.startsWith("recipe.user."));
  const officialIds = officialItems.map((item) => item?.id).filter(Boolean);
  assert(officialItems.length === ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS.length, `${label} must contain exactly four official rows`);
  assertSameSet(officialIds, ALPHA345_NOVICE_OFFICIAL_RECIPE_IDS, `${label} ids`);
  const leaked = officialItems.filter((item) => (
    item?.lifecycle === "draft"
    || item?.legacy === true
    || item?.draft === true
    || /(?:legacy|draft)/iu.test(item?.id ?? "")
  ));
  assert(leaked.length === 0, `${label} leaked legacy or draft official Recipes`);
  return officialItems;
}

async function assertPublicSurface(client, report) {
  const instructions = client.getInstructions?.();
  if (typeof instructions === "string") {
    assert(instructions.includes("ping") || instructions.includes("list_templates") || instructions.includes("list_recipes"), "initialization instructions omit public first-round flow");
    assert(Buffer.byteLength(instructions, "utf8") <= 16_384, "initialization instructions exceed budget");
  }
  const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assertSameArray(tools, ALPHA345_NOVICE_EXACT_TOOLS, "public tool surface");
  report.public_tools ??= tools;
  assertSameArray(tools, report.public_tools, "client tool surface");
}

async function callJson(client, report, clientId, tool, args) {
  auditPublicRequest(report, tool, args);
  const started = performance.now();
  const response = await client.callTool(
    { name: tool, arguments: args },
    undefined,
    { timeout: CALL_TIMEOUT_MS, maxTotalTimeout: CALL_TIMEOUT_MS },
  );
  const durationMs = Math.round(performance.now() - started);
  const text = response?.content?.find((entry) => entry.type === "text")?.text;
  assert(typeof text === "string", `${tool} returned no JSON text`);
  const responseBytes = Buffer.byteLength(text, "utf8");
  const value = JSON.parse(text);
  const requestedId = args.id ?? args.recipe_id ?? null;
  const operation = args.operation ?? null;
  report.calls.push({
    client: clientId,
    tool,
    operation,
    requested_id: requestedId,
    ok: value?.ok !== false,
    duration_ms: durationMs,
    response_bytes: responseBytes,
  });
  report.call_counts.by_tool[tool] = (report.call_counts.by_tool[tool] ?? 0) + 1;
  report.timings.by_tool[tool] = (report.timings.by_tool[tool] ?? 0) + durationMs;
  report.response_sizes.by_tool[tool] = (report.response_sizes.by_tool[tool] ?? 0) + responseBytes;
  report.response_sizes.total_bytes += responseBytes;
  report.response_sizes.max_bytes = Math.max(report.response_sizes.max_bytes, responseBytes);
  if (tool === "call_recipe" && operation) {
    report.call_counts.recipe_ops[operation] = (report.call_counts.recipe_ops[operation] ?? 0) + 1;
    if (operation === "run") report.timings.recipe_run_ms.push(durationMs);
  }
  if (tool === "call_template") {
    if (typeof requestedId === "string" && requestedId.startsWith("macro.")) {
      report.call_counts.macro_calls += 1;
      report.timings.macro_ms.push(durationMs);
    } else {
      report.call_counts.template_calls += 1;
    }
  }
  return value;
}

function auditPublicRequest(report, tool, args) {
  if (!ALPHA345_NOVICE_EXACT_TOOLS.includes(tool)) {
    report.prohibited_paths.non_public_tools = true;
    report.recovery_posture.public_tools_only = false;
    throw Object.assign(new Error(`non-public tool requested: ${tool}`), {
      code: "ALPHA345_NOVICE_ASSERTION_FAILED",
      friction: { code: "NON_PUBLIC_TOOL", tool },
    });
  }
  const requestText = JSON.stringify(args);
  if (/(?:file:\/\/|source[_ -]?code|readFileSync|import\.meta\.url|packages\/mcp-server|docs\/abi)/iu.test(requestText)) {
    report.prohibited_paths.filesystem_or_source_discovery = true;
    report.final_state.source_inspected = true;
    report.recovery_posture.no_source_inspection = false;
    throw Object.assign(new Error("filesystem or source discovery appeared in a public request"), {
      code: "ALPHA345_NOVICE_ASSERTION_FAILED",
      friction: { code: "SOURCE_INSPECTION", tool },
    });
  }
  if (/(?:raw[_ -]?lua|Main_OnCommand|shell|osascript|ui[_ -]?action|SWS)/iu.test(requestText)) {
    report.prohibited_paths.raw_lua_action_shell_ui = true;
    throw Object.assign(new Error("raw execution path appeared in a public request"), {
      code: "ALPHA345_NOVICE_ASSERTION_FAILED",
      friction: { code: "RAW_BYPASS", tool },
    });
  }
  if (/(?:parallel|Promise\.all)/iu.test(requestText)) {
    report.prohibited_paths.mutation_parallelism = true;
    report.final_state.mutation_parallelism = true;
    report.recovery_posture.no_reaper_mutation_parallelism = false;
    throw Object.assign(new Error("REAPER mutation parallelism appeared in a public request"), {
      code: "ALPHA345_NOVICE_ASSERTION_FAILED",
      friction: { code: "MUTATION_PARALLELISM", tool },
    });
  }
  if (tool === "call_recipe") {
    const op = args?.operation;
    if (!ALPHA345_NOVICE_RECIPE_OPS.includes(op)) {
      report.prohibited_paths.non_public_tools = true;
      throw Object.assign(new Error(`unsupported call_recipe operation: ${op}`), {
        code: "ALPHA345_NOVICE_ASSERTION_FAILED",
        friction: { code: "UNSUPPORTED_RECIPE_OP", operation: op },
      });
    }
  }
}

async function closeClient(clients, id, report) {
  const entry = clients.find((candidate) => candidate.id === id);
  if (!entry || entry.closed) return;
  await entry.client.close();
  entry.closed = true;
  report.final_state.clients_closed = clients.every((candidate) => candidate.closed);
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

function assertSameIdentity(actual, expected, label) {
  for (const key of Object.keys(expected)) {
    assert(actual[key] === expected[key], `${label} mismatch on ${key}`);
  }
}

async function assertExecutableRegularFile(file) {
  const entry = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  assert(entry?.isFile() && !entry.isSymbolicLink(), "installedWrapper must be a non-symlink regular file");
  await new Promise((resolve, reject) => access(file, fsConstants.X_OK, (error) => error ? reject(error) : resolve()));
}

async function createFreshDirectory(root) {
  const entry = await lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (entry) {
    assert(entry.isDirectory() && !entry.isSymbolicLink(), "evidenceRoot must be a non-symlink directory");
    assert((await readdir(root)).length === 0, "evidenceRoot must be fresh and empty");
    return;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
}

function assertAbsolute(value, label) {
  assert(typeof value === "string" && path.isAbsolute(value), `${label} must be an absolute path`);
}

function assertArgumentVector(value, label) {
  assert(Array.isArray(value) && value.every((entry) => typeof entry === "string"), `${label} must be an array of strings`);
}

function assertSameArray(actual, expected, label) {
  assert(sameArray(actual, expected), `${label} mismatch: ${JSON.stringify(actual)}`);
}

function assertSameSet(actual, expected, label) {
  assert(Array.isArray(actual), `${label} must be an array`);
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  assert(actual.length === left.length, `${label} contains duplicate rows: ${JSON.stringify(actual)}`);
  assert(sameArray(left, right), `${label} mismatch: ${JSON.stringify(left)}`);
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function assert(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: "ALPHA345_NOVICE_ASSERTION_FAILED" });
}

function bounded(value, maxChars) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maxChars);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("usage: --installed-wrapper <absolute-command> [--installed-args-json <json-array>] --evidence-root <absolute-fresh>");
    }
    if (key === "--installed-wrapper") options.installedWrapper = value;
    else if (key === "--installed-args-json") {
      try { options.installedArgs = JSON.parse(value); } catch { throw new Error("--installed-args-json must be a JSON array of strings"); }
    }
    else if (key === "--evidence-root") options.evidenceRoot = value;
    else throw new Error(`unknown option: ${key}`);
  }
  return options;
}

if (DIRECT_RUN) {
  try {
    const report = await runInstalledNoviceTrial(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ ok: report.ok, contract: report.contract, evidence: report.evidence_path })}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`[OpenReaper] ${bounded(error?.message ?? error, 1200)}\n`);
    process.exitCode = 2;
  }
}

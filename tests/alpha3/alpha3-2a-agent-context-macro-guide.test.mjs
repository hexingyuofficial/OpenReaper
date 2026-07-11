import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ALPHA3_2A_ACTION_MANUAL_FIELDS,
  ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
  ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
  ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS,
  ALPHA3_2A_DEFAULT_GUIDE_DELTA_MAX_BYTES,
  ALPHA3_2A_DEFAULT_GUIDE_MAX_BYTES,
  ALPHA3_2A_DEFAULT_LIST_TEMPLATES_MAX_BYTES,
  ALPHA3_2A_DEFAULT_PRODUCT_SURFACE_BASELINE_MAX_BYTES,
  ALPHA3_2A_EXACT_MANUAL_MAX_BYTES,
  ALPHA3_2A_PRIMARY_MACRO_IDS,
  ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE,
  ALPHA3_2A_PROJECT_QUERY_ENTITIES,
  ALPHA3_2A_REQUESTED_EXPANSIONS_CONTRACT,
  ALPHA3_2A_SECONDARY_MACRO_ROWS,
  attachAlpha3_2AAgentContextProductMetadata,
  createAlpha3_2AAgentContextMacroGuide,
} from "../../packages/mcp-server/src/alpha3-2a-agent-context-macro-guide-v1.mjs";
import { createCallTemplateRuntime } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STDIO_SERVER = path.join(REPO_ROOT, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const EXPECTED_TOOLS = ["ping", "get_state", "list_templates", "list_recipes", "call_template"];
const EXPECTED_PRIMARY_IDS = [
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.render.targets",
];
const EXPECTED_QUERY_ENTITIES = [
  "status",
  "selected_context",
  "tracks",
  "items",
  "takes",
  "fx",
  "routing",
  "automation",
  "markers_regions",
  "media_sources",
  "duplicates",
  "changed_since",
];
const EXPECTED_PROJECT_FILE_TEMPLATE_IDS = [
  "template.project.read_current_project_path",
  "template.project.read_dirty_state",
  "template.project.save_current_project",
  "template.project.save_project_as",
];
const EXPECTED_COVERED_LEGACY_MAPPING = {
  "macro.index_status": "macro.project.query",
  "macro.selected_context": "macro.project.inspect",
  "macro.query_tracks": "macro.project.query",
  "macro.query_items": "macro.project.query",
  "macro.query_takes": "macro.project.query",
  "macro.query_fx": "macro.project.query",
  "macro.query_routing": "macro.project.query",
  "macro.query_automation": "macro.project.query",
  "macro.query_markers": "macro.project.query",
  "macro.query_media": "macro.project.query",
  "macro.hydrate_refs": "macro.project.query",
  "macro.changed_since": "macro.project.query",
};
const EXPECTED_DISTINCT_LEGACY_IDS = [
  "macro.set_track_controls",
  "macro.set_item_controls",
  "macro.set_take_controls",
  "macro.set_transport_controls",
  "macro.set_send_controls",
  "macro.set_midi_controls",
  "macro.set_stock_plugin_controls",
];
const EXPECTED_EXPANDED_DETAIL_FIELDS = [
  "agent_startup_guidance_snapshot",
  "speed_productization_snapshot",
  "reuse_ecosystem_snapshot",
  "startup_readiness_snapshot",
  "project_index_user_flow_snapshot",
  "macro_execution_convenience_snapshot",
  "stock_plugin_live_evidence",
  "stock_plugin_product_gate_snapshot",
  "startup_health_snapshot",
  "startup_assistant_snapshot",
  "startup_wrapper_snapshot",
];
const EXPECTED_COMPACT_PRODUCT_SURFACE_FIELDS = [
  "contract",
  "surface",
  "detail_level",
  "expanded_via",
  "expanded_detail_fields",
  "agent_startup_guidance",
  "agent_context_macro_guide",
  "item_schema",
  "workflow_rhythm",
  "startup_preflight",
  "blocker_guidance",
  "orchestration_policy",
  "speed_productization",
  "reuse_ecosystem",
  "startup_readiness",
  "project_index_queries",
  "project_index_user_flow",
  "generic_control_macros",
  "macro_execution_convenience",
  "stock_plugin_fluency",
  "stock_plugin_product_gate",
  "startup_health",
  "startup_assistant",
  "startup_wrapper",
];

describe("Alpha3.2-A agent context and macro guide fix round", () => {
  it("keeps exactly seven ordered primary ids and marks the guide candidate/in_review", () => {
    const guide = createAlpha3_2AAgentContextMacroGuide();

    assert.deepEqual(ALPHA3_2A_PRIMARY_MACRO_IDS, EXPECTED_PRIMARY_IDS);
    assert.deepEqual(guide.primary_spine.ordered_ids, EXPECTED_PRIMARY_IDS);
    assert.deepEqual(guide.primary_spine.rows.map((row) => row.id), EXPECTED_PRIMARY_IDS);
    assert.equal(new Set(guide.primary_spine.ordered_ids).size, 7);
    assert.equal(guide.status, "candidate");
    assert.equal(guide.review_status, "in_review");
    assert.doesNotMatch(guide.primary_spine.current_posture, /accepted/i);
  });

  it("places complete action-precise 13-field manual cards in compact default product metadata", () => {
    const runtime = createCallTemplateRuntime();
    const surface = runtime.list_templates().product_surface;
    const guide = surface.agent_context_macro_guide;

    assert.deepEqual(Object.keys(surface), EXPECTED_COMPACT_PRODUCT_SURFACE_FIELDS);
    assert.equal(surface.detail_level, "compact");
    assert.equal(surface.expanded_via, "exact_ids");
    assert.deepEqual(surface.expanded_detail_fields, EXPECTED_EXPANDED_DETAIL_FIELDS);
    assert.deepEqual(expandedDetailFieldsPresent(surface), []);

    for (const row of guide.primary_spine.rows) {
      assert.equal(row.implementation_status, "contract_only_non_runnable");
      assert.deepEqual(Object.keys(row.action_manual), ALPHA3_2A_ACTION_MANUAL_FIELDS);
      for (const field of ALPHA3_2A_ACTION_MANUAL_FIELDS) {
        assert.equal(hasContent(row.action_manual[field]), true, `${row.id}.${field}`);
      }
      assert.equal(row.action_manual.input_shape.length > 0, true);
      assert.equal(row.action_manual.preflight_steps.length > 0, true);
      assert.equal(row.action_manual.underlying_actions.length > 0, true);
      assert.equal(row.action_manual.readback_steps.length > 0, true);
      assert.equal(row.action_manual.success_criteria.length > 0, true);
      assert.equal(row.action_manual.common_blockers.includes("CONTRACT_ONLY"), true);
      assert.equal(row.action_manual.examples.requested_expansion, true);
    }
  });

  it("moves full primary/project-file manuals into ordered requested_expansions while preserving missing_ids", () => {
    const runtime = createCallTemplateRuntime();
    const requested = [
      "macro.render.targets",
      "macro.index_status",
      "macro.project.file",
      "macro.missing",
      "macro.project.inspect",
    ];
    const exact = runtime.list_templates({ ids: requested, fields: ["id"] });
    const surface = exact.product_surface;
    const expansions = surface.agent_context_macro_guide.requested_expansions;

    assert.equal(surface.detail_level, "expanded");
    assert.equal(surface.expanded_via, "exact_ids");
    assert.deepEqual(surface.expanded_detail_fields, EXPECTED_EXPANDED_DETAIL_FIELDS);
    assert.deepEqual(expandedDetailFieldsPresent(surface), EXPECTED_EXPANDED_DETAIL_FIELDS);
    assert.deepEqual(exact.items.map((item) => item.id), [
      "macro.render.targets",
      "macro.index_status",
      "macro.project.file",
      "macro.project.inspect",
    ]);
    assert.deepEqual(exact.missing_ids, ["macro.missing"]);
    assert.deepEqual(expansions.requested_ids, requested);
    assert.deepEqual(expansions.missing_ids, ["macro.missing"]);
    assert.equal(expansions.contract, ALPHA3_2A_REQUESTED_EXPANSIONS_CONTRACT);
    assert.equal(expansions.version, ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION);
    assert.deepEqual(expansions.items.map((item) => item.id), [
      "macro.render.targets",
      "macro.project.file",
      "macro.project.inspect",
    ]);
    for (const expansion of expansions.items) {
      assert.equal(expansion.runnable, false);
      assert.equal(expansion.implementation_status, "contract_only_non_runnable");
      assert.deepEqual(Object.keys(expansion.action_manual), ALPHA3_2A_ACTION_MANUAL_FIELDS);
      assert.equal(Buffer.byteLength(JSON.stringify(expansion.action_manual)) <= ALPHA3_2A_EXACT_MANUAL_MAX_BYTES, true);
    }
  });

  it("restores explicit fields semantics and rejects action_manual as an unknown discovery field", () => {
    const runtime = createCallTemplateRuntime();
    const idOnly = runtime.list_templates({
      ids: ["macro.project.inspect", "macro.index_status", "macro.project.file"],
      fields: ["id"],
    });

    for (const item of idOnly.items) {
      assert.deepEqual(Object.keys(item).sort(), ["capability_truth", "id"]);
      assert.equal(Object.hasOwn(item, "action_manual"), false);
      assert.equal(Object.hasOwn(item, "compatibility"), false);
      assert.equal(Object.keys(item).some((key) => key.startsWith("guide_")), false);
    }

    const legacyDetails = runtime.list_templates({
      ids: ["macro.set_track_controls", "macro.query_items"],
      fields: ["id", "inputSchema", "outputSchema", "examples", "expectedDelta"],
    });
    for (const item of legacyDetails.items) {
      assert.ok(item.inputSchema);
      assert.ok(item.outputSchema);
      assert.ok(Array.isArray(item.examples));
      assert.ok(item.expectedDelta);
      assert.equal(Object.hasOwn(item, "action_manual"), false);
      assert.equal(Object.hasOwn(item, "compatibility"), false);
      assert.equal(Object.keys(item).some((key) => key.startsWith("guide_")), false);
    }

    assert.throws(
      () => runtime.list_templates({ ids: ["macro.project.inspect"], fields: ["action_manual"] }),
      /Unknown field\(s\): action_manual/,
    );
  });

  it("uses the active-plan project.query entity vocabulary exactly", () => {
    const runtime = createCallTemplateRuntime();
    const guide = runtime.list_templates().product_surface.agent_context_macro_guide;
    const exact = runtime.list_templates({ ids: ["macro.project.query"], fields: ["id"] });
    const manual = exact.product_surface.agent_context_macro_guide.requested_expansions.items[0].action_manual;

    assert.deepEqual(ALPHA3_2A_PROJECT_QUERY_ENTITIES, EXPECTED_QUERY_ENTITIES);
    assert.deepEqual(guide.project_query_entities, EXPECTED_QUERY_ENTITIES);
    assert.equal(manual.input_shape.entity, EXPECTED_QUERY_ENTITIES.join(" | "));
  });

  it("reports four accepted/live-smoked project-file templates and a held macro/new-project route", () => {
    const runtime = createCallTemplateRuntime();
    const guide = runtime.list_templates().product_surface.agent_context_macro_guide;
    const inspectCard = guide.primary_spine.rows.find((row) => row.id === "macro.project.inspect");
    const requested = runtime.list_templates({
      ids: ["macro.project.inspect", "macro.project.file"],
      fields: ["id"],
    }).product_surface.agent_context_macro_guide.requested_expansions.items;
    const inspectManual = requested.find((item) => item.id === "macro.project.inspect").action_manual;
    const projectFileManual = requested.find((item) => item.id === "macro.project.file").action_manual;

    assert.deepEqual(ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE.ids.map((row) => row.id), EXPECTED_PROJECT_FILE_TEMPLATE_IDS);
    assert.deepEqual(guide.project_file_posture.ids.map((row) => row.id), EXPECTED_PROJECT_FILE_TEMPLATE_IDS);
    assert.equal(guide.project_file_posture.status, "reads_and_writes_accepted_live_smoked");
    assert.deepEqual(guide.project_file_posture.accepted_mutation_routes, EXPECTED_PROJECT_FILE_TEMPLATE_IDS.slice(2));
    assert.deepEqual(guide.project_file_posture.ids.map((row) => row.status), ["accepted_live_smoked", "accepted_live_smoked", "accepted_live_smoked", "accepted_live_smoked"]);
    assert.match(inspectCard.action_manual.when_to_use, /accepted exact project path/);
    assert.equal(inspectCard.action_manual.common_blockers.includes("PROJECT_FILE_MACRO_HELD"), true);
    assert.match(inspectManual.readback_steps.join(" "), /exact path\/path_state/);
    for (const id of EXPECTED_PROJECT_FILE_TEMPLATE_IDS) {
      assert.equal(projectFileManual.underlying_actions.some((row) => row.includes(id)), true, id);
    }
    assert.match(projectFileManual.success_criteria.join(" "), /four accepted\/live-smoked atomic project-file templates/);
  });

  it("publishes explicit portfolio ids, legacy mappings, removals, and distinct-legacy blockers", () => {
    const guide = createAlpha3_2AAgentContextMacroGuide();
    const portfolio = guide.portfolio;

    assert.deepEqual(portfolio.primary_ids, EXPECTED_PRIMARY_IDS);
    assert.deepEqual(portfolio.secondary_ids, ALPHA3_2A_SECONDARY_MACRO_ROWS.map((row) => row.id));
    assert.deepEqual(portfolio.covered_legacy_ids, Object.keys(EXPECTED_COVERED_LEGACY_MAPPING));
    assert.deepEqual(portfolio.legacy_to_primary_mapping, EXPECTED_COVERED_LEGACY_MAPPING);
    assert.deepEqual(portfolio.removed_legacy_ids, []);
    assert.deepEqual(portfolio.distinct_legacy.ids, EXPECTED_DISTINCT_LEGACY_IDS);
    assert.equal(portfolio.distinct_legacy.blockers.length >= 3, true);
    assert.equal(portfolio.distinct_legacy.blockers.every((blocker) => blocker.length > 0), true);
  });

  it("enforces the compact default 96-KiB budget while preserving the guide", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates();
    const baseline = structuredClone(menu);
    delete baseline.product_surface.agent_context_macro_guide;

    const baselineBytes = Buffer.byteLength(JSON.stringify(baseline));
    const guideBytes = Buffer.byteLength(JSON.stringify(menu.product_surface.agent_context_macro_guide));
    const totalBytes = Buffer.byteLength(JSON.stringify(menu));
    const guideDeltaBytes = totalBytes - baselineBytes;
    const marginBytes = ALPHA3_2A_DEFAULT_LIST_TEMPLATES_MAX_BYTES - totalBytes;

    assert.equal(baselineBytes <= ALPHA3_2A_DEFAULT_PRODUCT_SURFACE_BASELINE_MAX_BYTES, true, `${baselineBytes}`);
    assert.equal(guideBytes <= ALPHA3_2A_DEFAULT_GUIDE_MAX_BYTES, true, `${guideBytes}`);
    assert.equal(guideDeltaBytes <= ALPHA3_2A_DEFAULT_GUIDE_DELTA_MAX_BYTES, true, `${guideDeltaBytes}`);
    assert.equal(totalBytes <= ALPHA3_2A_DEFAULT_LIST_TEMPLATES_MAX_BYTES, true, `${totalBytes}`);
    assert.equal(marginBytes >= 512, true, `${marginBytes}`);
  });

  it("keeps all contract ids held/non-runnable and preserves legacy macro dispatch", async () => {
    let executorCalls = 0;
    const runtime = createCallTemplateRuntime({
      executor: async () => {
        executorCalls += 1;
        throw new Error("unexpected executor call");
      },
    });

    assert.deepEqual(ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS, [...EXPECTED_PRIMARY_IDS, "macro.project.file"]);
    for (const id of ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS) {
      const result = await runtime.call_template({ id, input: {} });
      assert.equal(result.ok, false);
      assert.equal(result.error?.code ?? result.error_code, "CALL_TEMPLATE_ID_HELD");
      assert.equal(result.error?.details?.implementation_status, "contract_only_non_runnable");
    }

    const legacy = await runtime.call_template({ id: "macro.index_status", input: { scope: "project" } });
    assert.equal(legacy.ok, true);
    assert.equal(legacy.template.id, "macro.index_status");
    assert.equal(legacy.result.contract, "alpha3.c3.project_index_query_macros.v1");
    assert.equal(executorCalls, 0);
  });

  it("retains folded secondary discovery, empty/draft recipe guidance, five tools, and no bypass", () => {
    const guide = createAlpha3_2AAgentContextMacroGuide();
    const secondaryIds = guide.secondary_menu.rows.map((row) => row.id);

    assert.equal(guide.secondary_menu.folded, true);
    assert.equal(secondaryIds.includes("macro.project.file"), true);
    for (const id of [...Object.keys(EXPECTED_COVERED_LEGACY_MAPPING), ...EXPECTED_DISTINCT_LEGACY_IDS]) {
      assert.equal(secondaryIds.includes(id), true, id);
    }
    assert.match(guide.recipe_guidance.empty_catalog, /ad-hoc composition/);
    assert.match(guide.recipe_guidance.draft_only_catalog, /official\/live-smoked/);
    assert.deepEqual(guide.tool_surface.tools, EXPECTED_TOOLS);
    assert.equal(guide.tool_surface.count, 5);
    assert.equal(guide.tool_surface.list_macros, false);
    assert.equal(guide.recipe_guidance.public_call_recipe, false);
    assert.equal(guide.recipe_guidance.hidden_recipe_executor, false);
    assert.equal(Object.values(guide.safety_boundary).every((value) => value === false), true);
  });

  it("decorates empty recipe discovery with the same default candidate guide and manual cards", () => {
    const response = attachAlpha3_2AAgentContextProductMetadata(
      createDiscoveryCatalog({ recipes: [] }).list_recipes(),
    );
    const guide = response.product_surface.agent_context_macro_guide;

    assert.equal(response.items.length, 0);
    assert.equal(guide.contract, ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT);
    assert.equal(guide.version, ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION);
    assert.equal(guide.status, "candidate");
    assert.equal(guide.review_status, "in_review");
    assert.equal(guide.primary_spine.rows.every((row) => hasCompleteManual(row.action_manual)), true);
    assert.deepEqual(guide.requested_expansions.items, []);
  });

  it("proves default/manual/legacy behavior through actual stdio MCP calls", { timeout: 30_000 }, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: REPO_ROOT,
      env: sanitizedServerEnv(),
      stderr: "pipe",
    });
    const client = new Client({ name: "alpha3-2a-fix-review", version: "1.0.0" }, { capabilities: {} });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...EXPECTED_TOOLS].sort());
      assert.equal(tools.tools.length, 5);
      assert.equal(tools.tools.some((tool) => tool.name === "list_macros" || tool.name === "call_recipe"), false);

      const pingResult = await client.callTool({ name: "ping", arguments: {} });
      const templatesResult = await client.callTool({ name: "list_templates", arguments: {} });
      const recipesResult = await client.callTool({ name: "list_recipes", arguments: {} });
      const exactResult = await client.callTool({
        name: "list_templates",
        arguments: {
          ids: ["macro.project.query", "macro.index_status", "macro.missing", "macro.project.inspect"],
          fields: ["id"],
        },
      });
      const legacyResult = await client.callTool({
        name: "call_template",
        arguments: { id: "macro.index_status", input: { scope: "project" } },
      });
      const heldResult = await client.callTool({
        name: "call_template",
        arguments: { id: "macro.project.inspect", input: {} },
      });

      const ping = parseToolJson(pingResult);
      const templates = parseToolJson(templatesResult);
      const recipes = parseToolJson(recipesResult);
      const exact = parseToolJson(exactResult);
      const legacy = parseToolJson(legacyResult);
      const held = parseToolJson(heldResult);
      const guides = [
        ping.product_surface.agent_context_macro_guide,
        templates.product_surface.agent_context_macro_guide,
        recipes.product_surface.agent_context_macro_guide,
      ];

      for (const guide of guides) {
        assert.equal(guide.contract, ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT);
        assert.equal(guide.version, ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION);
        assert.equal(guide.status, "candidate");
        assert.equal(guide.review_status, "in_review");
        assert.equal(guide.primary_spine.rows.every((row) => hasCompleteManual(row.action_manual)), true);
      }
      assert.equal(toolTextBytes(templatesResult) <= ALPHA3_2A_DEFAULT_LIST_TEMPLATES_MAX_BYTES, true);
      assert.equal(templates.product_surface.detail_level, "compact");
      assert.deepEqual(expandedDetailFieldsPresent(templates.product_surface), []);
      assert.equal(exact.product_surface.detail_level, "expanded");
      assert.equal(exact.product_surface.expanded_via, "exact_ids");
      assert.deepEqual(exact.product_surface.expanded_detail_fields, EXPECTED_EXPANDED_DETAIL_FIELDS);
      assert.deepEqual(expandedDetailFieldsPresent(exact.product_surface), EXPECTED_EXPANDED_DETAIL_FIELDS);
      assert.deepEqual(exact.items.map((item) => Object.keys(item).sort()), [
        ["capability_truth", "id"],
        ["capability_truth", "id"],
        ["capability_truth", "id"],
      ]);
      assert.deepEqual(exact.missing_ids, ["macro.missing"]);
      assert.deepEqual(
        exact.product_surface.agent_context_macro_guide.requested_expansions.items.map((item) => item.id),
        ["macro.project.query", "macro.project.inspect"],
      );
      assert.equal(legacy.ok, true);
      assert.equal(legacy.template.id, "macro.index_status");
      assert.equal(legacy.result.contract, "alpha3.c3.project_index_query_macros.v1");
      assert.equal(held.ok, false);
      assert.equal(held.error?.code ?? held.error_code, "CALL_TEMPLATE_ID_HELD");
    } finally {
      await client.close();
    }
  });
});

function expandedDetailFieldsPresent(surface) {
  return EXPECTED_EXPANDED_DETAIL_FIELDS.filter((field) => Object.hasOwn(surface, field));
}

function hasCompleteManual(manual) {
  return Boolean(manual)
    && JSON.stringify(Object.keys(manual)) === JSON.stringify(ALPHA3_2A_ACTION_MANUAL_FIELDS)
    && ALPHA3_2A_ACTION_MANUAL_FIELDS.every((field) => hasContent(manual[field]));
}

function hasContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function parseToolJson(result) {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

function toolTextBytes(result) {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return Buffer.byteLength(text);
}

function sanitizedServerEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("OPENREAPER_LIVE_")) continue;
    if (key.startsWith("OPENREAPER_BRIDGE_")) continue;
    if (key === "OPENREAPER_ARTIFACT_ROOT") continue;
    env[key] = value;
  }
  return env;
}

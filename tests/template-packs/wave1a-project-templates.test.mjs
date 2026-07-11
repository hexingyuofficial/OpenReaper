import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE1A_PROJECT_TEMPLATE_IDS,
  createWave1aProjectTemplates,
} from "../../packages/core/src/template-packs/wave1a-project-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const PROJECT_ALLOWLIST = Object.freeze([
  "template.project.read_summary",
  "template.project.read_metadata",
  "template.project.set_metadata_field",
  "template.project.list_markers_regions",
  "template.project.create_marker",
  "template.project.create_region",
  "template.project.read_tempo_map",
  "template.project.set_tempo",
  "template.project.set_bpm",
  "template.project.set_tempo_marker",
  "template.project.set_grid",
  "template.project.set_snap",
  "template.project.delete_marker",
  "template.project.delete_region",
  "template.project.remove_marker",
  "template.project.remove_region",
  "template.project.rename_marker",
  "template.project.rename_region",
  "template.project.read_track_item_overview",
  "template.project.create_subproject",
  "template.project.create_project_tab",
  "template.project.insert_subproject_item",
  "template.project.render_or_update_subproject",
]);

const BLOCKED_PROJECT_IDS = Object.freeze([
  "template.project.set_project_grid",
  "template.project.set_tempo_time_signature",
  "template.project.create_region_from_item",
  "template.project.update_marker_region",
  "template.project.set_sample_rate",
  "template.project.set_marker_action_text",
  "template.project.list_tabs",
  "template.project.switch_tab",
  "template.project.delete_marker_region",
  "template.project.render_region",
  "template.project.set_render_metadata",
  "template.project.execute_marker_action",
  "template.project.create_regions_for_selected_items",
  "template.project.setup_music_sketch_project",
]);

describe("Wave 1A project template descriptors", () => {
  it("exports exactly the project Wave 1A implementation allowlist", () => {
    const templates = createWave1aProjectTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(ids, PROJECT_ALLOWLIST);
    assert.deepEqual(Object.values(WAVE1A_PROJECT_TEMPLATE_IDS), PROJECT_ALLOWLIST);
    for (const blocked of BLOCKED_PROJECT_IDS) {
      assert.equal(ids.includes(blocked), false, blocked);
    }
  });

  it("passes the frozen 4A descriptor validator with project ownership", () => {
    for (const descriptor of createWave1aProjectTemplates()) {
      const result = validateTemplateDescriptor(descriptor);
      assert.deepEqual(result.errors, [], descriptor.id);
      assert.equal(result.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "project", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.project."), true, descriptor.id);
      assert.equal(descriptor.artifacts.mode, "none", descriptor.id);
      assert.equal(Object.hasOwn(descriptor.inputSchema.properties, "emits"), false, descriptor.id);
    }
  });

  it("keeps marker and region descriptors index-number oriented and explicit", () => {
    const catalog = createTemplateCatalog({ templates: createWave1aProjectTemplates() });
    const list = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.listMarkersRegions);
    const createMarker = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createMarker);
    const createRegion = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createRegion);
    const deleteMarker = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.deleteMarker);
    const deleteRegion = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.deleteRegion);
    const removeMarker = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.removeMarker);
    const removeRegion = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.removeRegion);
    const renameMarker = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.renameMarker);
    const renameRegion = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.renameRegion);
    const overview = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.readTrackItemOverview);

    assert.deepEqual(list.refs.output.map(({ kind }) => kind), ["marker", "region"]);
    assert.match(list.refs.output[0].summary, /index_number/);
    assert.match(list.refs.output[1].summary, /index_number/);
    assert.deepEqual(createMarker.refs.output, [
      {
        name: "marker_ref",
        kind: "marker",
        required: true,
        summary: "Created marker index-number ref.",
      },
    ]);
    assert.deepEqual(createRegion.refs.output, [
      {
        name: "region_ref",
        kind: "region",
        required: true,
        summary: "Created region index-number ref.",
      },
    ]);
    assert.equal(Object.hasOwn(createRegion.inputSchema.properties, "item_ref"), false);
    assert.match(createMarker.summary, /rejects SWS marker-action/);
    for (const descriptor of [deleteMarker, removeMarker, renameMarker]) {
      assert.deepEqual(descriptor.refs.input.map(({ kind }) => kind), ["marker"]);
      assert.deepEqual(descriptor.refs.output.map(({ kind }) => kind), ["marker"]);
      assert.equal(descriptor.bridge.operation_name, "template.execute");
      assert.equal(descriptor.bridge.capability.startsWith("project."), true);
    }
    for (const descriptor of [deleteRegion, removeRegion, renameRegion]) {
      assert.deepEqual(descriptor.refs.input.map(({ kind }) => kind), ["region"]);
      assert.deepEqual(descriptor.refs.output.map(({ kind }) => kind), ["region"]);
      assert.equal(descriptor.bridge.operation_name, "template.execute");
      assert.equal(descriptor.bridge.capability.startsWith("project."), true);
    }
    assert.equal(deleteMarker.risk, "destructive");
    assert.equal(deleteRegion.risk, "destructive");
    assert.equal(renameMarker.risk, "write");
    assert.equal(renameRegion.risk, "write");
    assert.deepEqual(overview.refs.output.map(({ kind }) => kind), ["project", "track", "item"]);
    assert.equal(overview.bridge.operation_name, "project.read_track_item_overview");
  });

  it("keeps subproject and project-tab descriptors project-owned and ref-oriented", () => {
    const catalog = createTemplateCatalog({ templates: createWave1aProjectTemplates() });
    const createSubproject = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createSubproject);
    const createProjectTab = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createProjectTab);
    const insertSubprojectItem = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.insertSubprojectItem);
    const renderOrUpdateSubproject = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.renderOrUpdateSubproject);

    assert.deepEqual(
      [createSubproject, createProjectTab, insertSubprojectItem, renderOrUpdateSubproject].map(
        (descriptor) => descriptor.pack,
      ),
      ["project", "project", "project", "project"],
    );
    assert.deepEqual(
      [createSubproject, createProjectTab, insertSubprojectItem, renderOrUpdateSubproject].map(
        (descriptor) => descriptor.risk,
      ),
      ["write", "write", "write", "write"],
    );
    assert.deepEqual(createSubproject.refs.output.map(({ kind }) => kind), ["project", "project"]);
    assert.deepEqual(createProjectTab.refs.output.map(({ kind }) => kind), ["project"]);
    assert.deepEqual(insertSubprojectItem.refs.input.map(({ kind }) => kind), ["project", "track"]);
    assert.deepEqual(insertSubprojectItem.refs.output.map(({ kind }) => kind), ["item", "project"]);
    assert.deepEqual(renderOrUpdateSubproject.refs.input.map(({ kind }) => kind), ["project", "item"]);
    assert.deepEqual(renderOrUpdateSubproject.refs.output.map(({ kind }) => kind), ["project"]);
    assert.equal(Object.hasOwn(renderOrUpdateSubproject.outputSchema.properties, "job_ref"), true);
    assert.equal(renderOrUpdateSubproject.bridge.operation_family, "run_job");
    assert.equal(renderOrUpdateSubproject.bridge.capability, "project.render_or_update_subproject");
    assert.equal(Object.hasOwn(createSubproject.inputSchema.properties, "raw_action"), false);
    assert.equal(Object.hasOwn(createProjectTab.inputSchema.properties, "project_file_path"), false);
  });

  it("keeps tempo, BPM, grid, and snap setters as project-owned static atoms", () => {
    const catalog = createTemplateCatalog({ templates: createWave1aProjectTemplates() });
    const setTempo = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.setTempo);
    const setBpm = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.setBpm);
    const setTempoMarker = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.setTempoMarker);
    const setGrid = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.setGrid);
    const setSnap = catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.setSnap);

    assert.deepEqual(
      [setTempo, setBpm, setTempoMarker].map((descriptor) => descriptor.entity_kind),
      ["tempo_map", "tempo_map", "tempo_map"],
    );
    assert.deepEqual(
      [setGrid, setSnap].map((descriptor) => descriptor.entity_kind),
      ["grid", "grid"],
    );
    assert.deepEqual(
      [setTempo, setBpm, setTempoMarker, setGrid, setSnap].map((descriptor) => descriptor.risk),
      ["write", "write", "write", "write", "write"],
    );
    assert.deepEqual(
      [setTempo, setBpm, setTempoMarker, setGrid, setSnap].map((descriptor) => descriptor.bridge.capability),
      [
        "project.set_tempo",
        "project.set_bpm",
        "project.set_tempo_marker",
        "project.set_grid",
        "project.set_snap",
      ],
    );
    assert.equal(Object.hasOwn(setTempo.inputSchema.properties, "raw_action"), false);
    assert.equal(Object.hasOwn(setGrid.inputSchema.properties, "action_id"), false);
  });

  it("loads a pack-local catalog, rejects duplicates, and keeps default discovery bounded", () => {
    const templates = createWave1aProjectTemplates();
    const catalog = createTemplateCatalog({ templates });

    assert.equal(catalog.size, PROJECT_ALLOWLIST.length);
    assert.deepEqual(catalog.ids, PROJECT_ALLOWLIST);
    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.project\.read_summary/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({ pack: "project" });

    assert.equal(response.contract, "discovery.menu.v1");
    assert.equal(response.kind, "template_menu");
    assert.equal(response.mode, "menu");
    assert.equal(response.items.length, PROJECT_ALLOWLIST.length);
    assert.equal(response.page.has_more, false);
    assert.equal("total" in response.page, false);
    for (const item of response.items) {
      assert.deepEqual(Object.keys(item), [
        "id",
        "title",
        "summary",
        "pack",
        "lifecycle",
        "risk",
        "entity_kind",
        "tags",
      ]);
      assert.equal(Buffer.byteLength(JSON.stringify(item), "utf8") < 1_024, true, item.id);
    }

    const payload = JSON.stringify(response);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
  });

  it("supports exact id lookup with Layer 1.5 detail field selection", () => {
    const catalog = createTemplateCatalog({ templates: createWave1aProjectTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: [WAVE1A_PROJECT_TEMPLATE_IDS.createRegion, "template.project.missing"],
      fields: ["summary", "input_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.project.missing"]);
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
      "summary",
    ]);
    assert.equal("bridge" in response.items[0], false);
    assert.equal("refs" in response.items[0], false);
    assert.equal("artifacts" in response.items[0], false);
    assert.equal("verification" in response.items[0], false);
  });

  it("runs Layer 4B fake harness smoke for project read descriptors", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1aProjectTemplates() });
    const bridge = new FakeFoundationBridge();

    const readSummary = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.readSummary),
      input: { include_counts: true },
      context: context({ request_sequence: 1 }),
      executor: bridge,
    });
    assert.equal(readSummary.ok, true);
    assert.equal(readSummary.template.pack, "project");
    assert.equal(readSummary.template.operation.family, "query_state");
    assert.equal(readSummary.undo.mode, "none");

    const readMetadata = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.readMetadata),
      input: { fields: ["title", "author"] },
      context: context({ request_sequence: 2 }),
      executor: bridge,
    });
    assert.equal(readMetadata.ok, true);
    assert.equal(readMetadata.undo.mode, "none");

    const markerA = markerRef("{MARKER-A}", "Cue");
    const markerB = markerRef("{MARKER-B}", "Cue");
    const region = regionRef("{REGION-A}", "Cue");
    const listMarkers = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.listMarkersRegions),
      input: { limit: 50, include_markers: true, include_regions: true },
      context: context({ request_sequence: 3 }),
      executor: fakeRefsExecutor([markerA, markerB, region]),
    });
    assert.equal(listMarkers.ok, true);
    assert.equal(listMarkers.undo.mode, "none");
    assert.deepEqual(
      listMarkers.result.refs.map((ref) => [ref.kind, ref.identity.scheme, ref.display?.name]),
      [
        ["marker", "guid", "Cue"],
        ["marker", "guid", "Cue"],
        ["region", "guid", "Cue"],
      ],
    );

    const tempoMap = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.readTempoMap),
      input: { limit: 16, effective_at_seconds: [0, 12] },
      context: context({ request_sequence: 4 }),
      executor: bridge,
    });
    assert.equal(tempoMap.ok, true);
    assert.equal(tempoMap.template.capability, "project.read_tempo_map");
  });

  it("runs Layer 4B fake harness smoke for project write descriptors", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1aProjectTemplates() });
    const project = createObjectRef(
      "project",
      { scheme: "current", value: "current" },
      { ref: "project:current" },
    );
    const marker = markerRef("{MARKER-CREATE}", "intro");
    const region = regionRef("{REGION-CREATE}", "chorus");

    const metadata = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.setMetadataField),
      input: { field: "title", value: "Combat Variations" },
      context: context({ request_sequence: 5 }),
      executor: fakeRefsExecutor([project]),
    });
    assert.equal(metadata.ok, true);
    assert.equal(metadata.undo.mode, "required");
    assert.deepEqual(metadata.undo.label, "OpenReaper: project.set_metadata_field");
    assert.deepEqual(metadata.result.refs, [project]);
    assert.equal(metadata.result.last_result.updated, true);
    assert.equal(metadata.verification.status, "passed");

    const markerExecutor = fakeRefsExecutor([marker]);
    const createMarker = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createMarker),
      input: { name: "intro", position_seconds: 0, color: "#FFAA00" },
      context: context({ request_sequence: 6 }),
      executor: markerExecutor,
    });
    assert.equal(createMarker.ok, true);
    assert.deepEqual(markerExecutor.requests[0].undo.flags, ["marker"]);
    assert.equal(createMarker.result.refs[0].kind, "marker");
    assert.equal(createMarker.result.refs[0].identity.scheme, "guid");

    const regionExecutor = fakeRefsExecutor([region]);
    const createRegion = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createRegion),
      input: { name: "chorus", start_seconds: 12, end_seconds: 28 },
      context: context({ request_sequence: 7 }),
      executor: regionExecutor,
    });
    assert.equal(createRegion.ok, true);
    assert.deepEqual(regionExecutor.requests[0].undo.flags, ["region"]);
    assert.equal(createRegion.result.refs[0].kind, "region");
    assert.equal(createRegion.result.refs[0].identity.scheme, "guid");

    const itemDerivedRegion = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createRegion),
      input: { name: "bad", item_ref: "item:guid:{ITEM-A}" },
      context: context({ request_sequence: 8 }),
      executor: fakeRefsExecutor([region]),
    });
    assert.equal(itemDerivedRegion.ok, false);
    assert.equal(itemDerivedRegion.error.source, "harness");
    assert.equal(itemDerivedRegion.error.code, "TEMPLATE_INPUT_INVALID");

    const markerActionName = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createMarker),
      input: { name: "!40173", position_seconds: 0 },
      context: context({ request_sequence: 9 }),
      executor: projectPolicyExecutor([marker]),
    });
    assert.equal(markerActionName.ok, false);
    assert.equal(markerActionName.error.source, "bridge");
    assert.equal(markerActionName.error.code, "PARAMS_INVALID");

    const markerActionTextField = await executeTemplate({
      descriptor: catalog.require(WAVE1A_PROJECT_TEMPLATE_IDS.createMarker),
      input: { name: "cue", position_seconds: 0, marker_action_text: "!40173" },
      context: context({ request_sequence: 10 }),
      executor: fakeRefsExecutor([marker]),
    });
    assert.equal(markerActionTextField.ok, false);
    assert.equal(markerActionTextField.error.code, "TEMPLATE_INPUT_INVALID");
  });

  it("runs Layer 4B fake harness smoke for project tempo, grid, and marker closure descriptors", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1aProjectTemplates() });
    const project = createObjectRef(
      "project",
      { scheme: "current", value: "current" },
      { ref: "project:current" },
    );
    const projectTab = createObjectRef(
      "project",
      { scheme: "guid", value: "{TAB-A}" },
      { display: { name: "sound design" } },
    );
    const subproject = createObjectRef(
      "project",
      { scheme: "guid", value: "{SUBPROJECT-A}" },
      { display: { name: "dialog edit" } },
    );
    const subprojectItem = createObjectRef(
      "item",
      { scheme: "guid", value: "{SUBPROJECT-ITEM-A}" },
      { display: { name: "dialog edit.rpp-prox" } },
    );
    const marker = markerRef("{MARKER-MUTATE}", "cue");
    const region = regionRef("{REGION-MUTATE}", "bridge");

    const closureCases = [
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.setTempo,
        input: { bpm: 60 },
        refs: {},
        emitted: [project],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.setBpm,
        input: { bpm: 60 },
        refs: {},
        emitted: [project],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.setTempoMarker,
        input: { position_seconds: 0, bpm: 60 },
        refs: {},
        emitted: [project],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.setGrid,
        input: { division: "1/8" },
        refs: {},
        emitted: [project],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.setSnap,
        input: { enabled: true },
        refs: {},
        emitted: [project],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.deleteMarker,
        input: {},
        refs: { marker_ref: marker },
        emitted: [marker],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.deleteRegion,
        input: {},
        refs: { region_ref: region },
        emitted: [region],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.removeMarker,
        input: {},
        refs: { marker_ref: marker },
        emitted: [marker],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.removeRegion,
        input: {},
        refs: { region_ref: region },
        emitted: [region],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.renameMarker,
        input: { name: "verse" },
        refs: { marker_ref: marker },
        emitted: [marker],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.renameRegion,
        input: { name: "chorus" },
        refs: { region_ref: region },
        emitted: [region],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.createSubproject,
        input: { name: "dialog edit", activate: true },
        refs: {},
        emitted: [subproject, projectTab],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.createProjectTab,
        input: { name: "sound design", activate: true },
        refs: {},
        emitted: [projectTab, project],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.insertSubprojectItem,
        input: { position_seconds: 12 },
        refs: { subproject_project_ref: subproject },
        emitted: [subprojectItem, subproject],
      },
      {
        id: WAVE1A_PROJECT_TEMPLATE_IDS.renderOrUpdateSubproject,
        input: { mode: "render_or_update", wait_for_completion: false },
        refs: { subproject_project_ref: subproject },
        emitted: [subproject],
        family: "run_job",
      },
    ];

    for (const [index, entry] of closureCases.entries()) {
      const executor = fakeRefsExecutor(entry.emitted);
      const response = await executeTemplate({
        descriptor: catalog.require(entry.id),
        input: entry.input,
        refs: entry.refs,
        idempotency_key: `closure-${index}`,
        context: context({ request_sequence: 20 + index }),
        executor,
      });

      assert.equal(response.ok, true, entry.id);
      assert.equal(response.template.pack, "project", entry.id);
      assert.equal(response.template.operation.family, entry.family ?? "run_command", entry.id);
      assert.equal(response.undo.mode, "required", entry.id);
      assert.equal(response.verification.status, "passed", entry.id);
      assert.deepEqual(response.result.refs, entry.emitted, entry.id);
      assert.equal(executor.requests[0].operation.name, "template.execute", entry.id);
      assert.equal(executor.requests[0].pack.capability.startsWith("project."), true, entry.id);
    }
  });
});

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-02T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function fakeRefsExecutor(refs) {
  const bridge = new FakeFoundationBridge();
  const requests = [];
  const executor = (request) => {
    requests.push(request);
    return bridge.okEnvelope(request, "2026-07-02T00:00:00.000Z", {
      summary: {
        operation: request.operation.name,
        pack: request.pack.id,
      },
      refs,
      last_result: {
        updated: request.operation.family !== "query_state",
        refs,
        truncated: false,
      },
    });
  };
  executor.requests = requests;
  return executor;
}

function projectPolicyExecutor(refs) {
  const bridge = new FakeFoundationBridge();
  return (request) => {
    if (
      request.pack.id === "project" &&
      request.pack.capability === "project.create_marker" &&
      typeof request.params.name === "string" &&
      request.params.name.startsWith("!")
    ) {
      return bridge.errorEnvelope(
        request,
        "PARAMS_INVALID",
        "Wave 1A project.create_marker rejects SWS marker-action text.",
        {
          recoverable: true,
          startedAt: "2026-07-02T00:00:00.000Z",
        },
      );
    }
    return fakeRefsExecutor(refs)(request);
  };
}

function markerRef(guid, name) {
  return createObjectRef(
    "marker",
    { scheme: "guid", value: guid },
    {
      display: {
        name,
        position_seconds: 0,
      },
    },
  );
}

function regionRef(guid, name) {
  return createObjectRef(
    "region",
    { scheme: "guid", value: guid },
    {
      display: {
        name,
        start_seconds: 12,
        end_seconds: 28,
      },
    },
  );
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
} from "../../packages/core/src/template-catalog-v1.mjs";
import { executeTemplate } from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE1A_TRACKS_TEMPLATE_IDS,
  createWave1ATracksTemplates,
} from "../../packages/core/src/template-packs/wave1a-tracks-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.tracks.resolve_track_ref",
  "template.tracks.list_tracks",
  "template.tracks.create_track",
  "template.tracks.rename_track",
  "template.tracks.set_color",
  "template.tracks.select_track",
  "template.tracks.set_mute",
  "template.tracks.set_solo",
  "template.tracks.set_record_arm",
  "template.tracks.delete_track",
  "template.tracks.delete_tracks",
  "template.tracks.set_volume",
  "template.tracks.set_pan",
  "template.tracks.set_width",
  "template.tracks.read_mixer_controls",
  "template.tracks.create_folder_track",
  "template.tracks.set_folder_depth",
  "template.tracks.move_track",
  "template.tracks.move_tracks",
  "template.tracks.nest_tracks_in_folder",
  "template.tracks.read_folder_structure",
]);

const BLOCKED = Object.freeze([
  "template.tracks.delete_empty_track",
  "template.tracks.ensure_named_track",
  "template.tracks.set_folder_depth_delta",
  "template.tracks.create_folder_from_tracks",
  "template.tracks.set_folder_compact",
  "template.tracks.set_track_group_membership",
  "template.tracks.set_fixed_lane_mode",
  "template.tracks.add_send_to_track",
  "template.tracks.set_track_fx_bypass",
  "template.tracks.set_track_envelope_mode",
]);

describe("Wave 1A tracks template descriptors", () => {
  it("implements exactly the tracks Wave 1A allowlist", () => {
    const templates = createWave1ATracksTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(ids, ALLOWLIST);
    assert.deepEqual(Object.values(WAVE1A_TRACKS_TEMPLATE_IDS), ALLOWLIST);
    for (const id of BLOCKED) assert.equal(ids.includes(id), false, id);
  });

  it("validates every descriptor through the frozen 4A ABI", () => {
    for (const descriptor of createWave1ATracksTemplates()) {
      const result = validateTemplateDescriptor(descriptor);

      assert.deepEqual(result.errors, [], descriptor.id);
      assert.equal(result.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "tracks", descriptor.id);
      assert.equal(descriptor.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN)?.[1], "tracks");
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.artifacts.mode, "none", descriptor.id);
      assert.deepEqual(descriptor.artifacts.input, [], descriptor.id);
      assert.deepEqual(descriptor.artifacts.output, [], descriptor.id);
      assert.equal(descriptor.tags.includes("wave1a"), true, descriptor.id);
    }
  });

  it("keeps ownership and risk boundaries narrow", () => {
    const templates = createWave1ATracksTemplates();
    const byId = new Map(templates.map((descriptor) => [descriptor.id, descriptor]));

    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.resolveTrackRef).risk, "read");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.resolveTrackRef).bridge.operation_family, "query_state");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.resolveTrackRef).bridge.idempotency, "none");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.resolveTrackRef).expectedDelta.kind, "read");
    assert.deepEqual(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.resolveTrackRef).refs.input, []);
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.listTracks).risk, "read");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.listTracks).bridge.operation_name, "tracks.list_tracks");
    assert.deepEqual(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.listTracks).refs.output.map((entry) => entry.kind), ["track"]);
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.readMixerControls).risk, "read");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.readMixerControls).bridge.operation_family, "query_state");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.readFolderStructure).risk, "read");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.readFolderStructure).bridge.operation_family, "query_state");

    for (const descriptor of templates.filter((entry) => entry.risk === "write")) {
      assert.equal(descriptor.bridge.operation_family, "run_command", descriptor.id);
      assert.equal(descriptor.bridge.operation_name, "template.execute", descriptor.id);
      assert.equal(descriptor.verification.mode, "required", descriptor.id);
      assert.equal(descriptor.expectedDelta.kind, "mutation", descriptor.id);
      assert.equal(
        descriptor.refs.input.length > 0 ||
          descriptor.id === WAVE1A_TRACKS_TEMPLATE_IDS.createTrack ||
          descriptor.id === WAVE1A_TRACKS_TEMPLATE_IDS.createFolderTrack,
        true,
        descriptor.id,
      );
      assert.equal(JSON.stringify(descriptor).includes('"kind":"send"'), false, descriptor.id);
      assert.equal(JSON.stringify(descriptor).includes('"kind":"fx"'), false, descriptor.id);
      assert.equal(JSON.stringify(descriptor).includes('"kind":"envelope"'), false, descriptor.id);
      assert.equal(JSON.stringify(descriptor).includes('"kind":"item"'), false, descriptor.id);
    }
    for (const descriptor of templates.filter((entry) => entry.risk === "destructive")) {
      assert.equal(descriptor.bridge.operation_family, "run_command", descriptor.id);
      assert.equal(descriptor.verification.mode, "required", descriptor.id);
      assert.equal(descriptor.expectedDelta.kind, "mutation", descriptor.id);
      assert.equal(descriptor.expectedDelta.entities[0].action, "delete", descriptor.id);
      assert.equal(descriptor.refs.input.length > 0, true, descriptor.id);
    }

    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.selectTrack).risk, "write");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.createTrack).expectedDelta.idempotent, false);
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.createFolderTrack).expectedDelta.idempotent, false);
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.deleteTrack).risk, "destructive");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.deleteTracks).risk, "destructive");
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.createTrack).inputSchema.properties.reuse_existing, undefined);
    assert.equal(byId.get(WAVE1A_TRACKS_TEMPLATE_IDS.setRecordArm).risk, "write");
  });

  it("loads in a pack-local catalog, rejects duplicates, and keeps discovery bounded", () => {
    const templates = createWave1ATracksTemplates();
    const catalog = createTemplateCatalog({ templates });

    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);
    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.tracks\.resolve_track_ref/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates();

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    for (const item of menu.items) {
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
    }

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      if (["refs", "artifacts"].includes(field)) continue;
      assert.doesNotMatch(payload, new RegExp(field));
    }
    assert.equal(menu.items.every((item) => !Object.hasOwn(item, "refs")), true);
    assert.equal(menu.items.every((item) => !Object.hasOwn(item, "artifacts")), true);
  });

  it("supports exact id lookup with on-demand descriptor fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave1ATracksTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: [WAVE1A_TRACKS_TEMPLATE_IDS.setColor, "template.tracks.missing"],
      fields: ["summary", "input_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.tracks.missing"]);
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

  it("runs fake execution smoke for every tracks descriptor", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1ATracksTemplates() });

    for (const [sequence, scenario] of executionScenarios().entries()) {
      const descriptor = catalog.require(scenario.id);
      const bridge = fakeBridgeWithRefs(scenario.emittedRefs);
      const result = await executeTemplate({
        descriptor,
        input: scenario.input,
        refs: scenario.refs,
        context: context({ request_sequence: sequence + 1 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, scenario.id);
      assert.equal(result.template.id, scenario.id);
      assert.equal(result.template.pack, "tracks", scenario.id);
      assert.equal(result.template.risk, descriptor.risk, scenario.id);
      assert.equal(result.undo.mode, descriptor.risk === "read" ? "none" : "required", scenario.id);
      assert.equal(result.verification.status, "passed", scenario.id);
      assert.deepEqual(result.result.refs, scenario.emittedRefs, scenario.id);
      assert.equal(result.result.last_result.updated, descriptor.risk !== "read", scenario.id);
      assert.equal(bridge.seen.length, 1, scenario.id);
      assert.equal("emits" in bridge.seen[0].params, false, scenario.id);
    }
  });

  it("rejects invalid inputs and missing refs before fake bridge dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1ATracksTemplates() });
    const colorBridge = new FakeFoundationBridge();
    const invalidColor = await executeTemplate({
      descriptor: catalog.require(WAVE1A_TRACKS_TEMPLATE_IDS.setColor),
      input: {},
      refs: { track_ref: trackRef("{TRACK-COLOR}") },
      context: context({ request_sequence: 30 }),
      executor: colorBridge,
    });

    assert.equal(invalidColor.ok, false);
    assert.equal(invalidColor.error.source, "harness");
    assert.equal(invalidColor.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalidColor.error.details.errors.join("\n"), /input\.color is required/);
    assert.equal(colorBridge.seen.length, 0);

    const missingRefBridge = new FakeFoundationBridge();
    const missingRef = await executeTemplate({
      descriptor: catalog.require(WAVE1A_TRACKS_TEMPLATE_IDS.setMute),
      input: { muted: true },
      context: context({ request_sequence: 31 }),
      executor: missingRefBridge,
    });

    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.match(missingRef.error.details.errors.join("\n"), /required track ref/);
    assert.equal(missingRefBridge.seen.length, 0);
  });
});

function executionScenarios() {
  const resolved = trackRef("{TRACK-RESOLVE}");
  const created = trackRef("{TRACK-CREATE}");
  const renamed = trackRef("{TRACK-RENAME}");
  const colored = trackRef("{TRACK-COLOR}");
  const selected = trackRef("{TRACK-SELECT}");
  const muted = trackRef("{TRACK-MUTE}");
  const soloed = trackRef("{TRACK-SOLO}");
  const armed = trackRef("{TRACK-ARM}");
  const deleted = trackRef("{TRACK-DELETE}");
  const deleteBatchA = trackRef("{TRACK-DELETE-A}");
  const deleteBatchB = trackRef("{TRACK-DELETE-B}");
  const volume = trackRef("{TRACK-VOLUME}");
  const pan = trackRef("{TRACK-PAN}");
  const width = trackRef("{TRACK-WIDTH}");
  const mixer = trackRef("{TRACK-MIXER}");
  const folder = trackRef("{TRACK-FOLDER}");
  const folderDepth = trackRef("{TRACK-FOLDER-DEPTH}");
  const moved = trackRef("{TRACK-MOVE}");
  const moveBatchA = trackRef("{TRACK-MOVE-A}");
  const moveBatchB = trackRef("{TRACK-MOVE-B}");
  const folderParent = trackRef("{TRACK-FOLDER-PARENT}");
  const nestedChild = trackRef("{TRACK-NESTED-CHILD}");
  const folderRead = trackRef("{TRACK-FOLDER-READ}");

  return [
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.resolveTrackRef,
      input: { track_ref: "guid:{TRACK-RESOLVE}" },
      refs: {},
      emittedRefs: [resolved],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.createTrack,
      input: { name: "Dialog", index: 0 },
      refs: {},
      emittedRefs: [created],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack,
      input: { name: "Dialog Renamed" },
      refs: { track_ref: renamed },
      emittedRefs: [renamed],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setColor,
      input: { color: "#2D9CDB" },
      refs: { track_ref: colored },
      emittedRefs: [colored],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.selectTrack,
      input: { mode: "replace" },
      refs: { track_ref: selected },
      emittedRefs: [selected],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setMute,
      input: { muted: true },
      refs: { track_ref: muted },
      emittedRefs: [muted],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setSolo,
      input: { mode: "solo_in_place" },
      refs: { track_ref: soloed },
      emittedRefs: [soloed],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setRecordArm,
      input: { armed: true },
      refs: { track_ref: armed },
      emittedRefs: [armed],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.deleteTrack,
      input: {},
      refs: { track_ref: deleted },
      emittedRefs: [deleted],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.deleteTracks,
      input: {},
      refs: { track_ref: [deleteBatchA, deleteBatchB] },
      emittedRefs: [deleteBatchA, deleteBatchB],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setVolume,
      input: { volume: 0.5 },
      refs: { track_ref: volume },
      emittedRefs: [volume],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setPan,
      input: { pan: -0.5 },
      refs: { track_ref: pan },
      emittedRefs: [pan],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setWidth,
      input: { width: 0.75 },
      refs: { track_ref: width },
      emittedRefs: [width],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.readMixerControls,
      input: { include_selected: true, limit: 8 },
      refs: { track_ref: mixer },
      emittedRefs: [mixer],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.createFolderTrack,
      input: { name: "Drums", index: 0 },
      refs: {},
      emittedRefs: [folder],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.setFolderDepth,
      input: { folder_depth: 1 },
      refs: { track_ref: folderDepth },
      emittedRefs: [folderDepth],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.moveTrack,
      input: { index: 0 },
      refs: { track_ref: moved },
      emittedRefs: [moved],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.moveTracks,
      input: { index: 0 },
      refs: { track_ref: [moveBatchA, moveBatchB] },
      emittedRefs: [moveBatchA, moveBatchB],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.nestTracksInFolder,
      input: {},
      refs: { folder_ref: folderParent, track_ref: nestedChild },
      emittedRefs: [folderParent, nestedChild],
    },
    {
      id: WAVE1A_TRACKS_TEMPLATE_IDS.readFolderStructure,
      input: { limit: 32 },
      refs: {},
      emittedRefs: [folderRead],
    },
  ];
}

function fakeBridgeWithRefs(refs) {
  const bridge = new FakeFoundationBridge();
  bridge.execute = function executeWithRefs(request, startedAt) {
    const mutates = ["run_command", "run_action", "run_job"].includes(request.operation.family);
    const lastResult = mutates
      ? {
          updated: true,
          refs: refs.slice(0, request.budget.max_items),
          truncated: refs.length > request.budget.max_items,
        }
      : {
          updated: false,
          refs: this.lastResult.slice(0, request.budget.max_items),
          truncated: this.lastResult.length > request.budget.max_items,
        };
    const envelope = this.okEnvelope(request, startedAt, {
      summary: {
        operation: request.operation.name,
        pack: request.pack.id,
      },
      refs,
      last_result: lastResult,
    });

    if (envelope.ok && mutates) this.lastResult = refs.slice(0, request.budget.max_items);
    return envelope;
  };
  return bridge;
}

function trackRef(guid) {
  return createObjectRef("track", { scheme: "guid", value: guid });
}

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

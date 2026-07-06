import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  TEMPLATE_CATALOG_P1_TEMPLATE_IDS,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  createAcceptedOfficialTemplateCatalog,
  createAcceptedOfficialTemplateDiscovery,
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE,
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
  CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Layer 4D call_template runtime binding", () => {
  it("binds only the accepted Wave 1A, Wave 2A, Wave 3B, critical-fill, and P1 official catalog", () => {
    const catalog = createAcceptedOfficialTemplateCatalog();

    assert.equal(catalog.size, CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.length);
    assert.deepEqual(catalog.ids, CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE.waves, [
      "wave1a",
      "wave2a",
      "wave3b",
      "critical_fill",
      "p1",
    ]);

    assert.equal(catalog.get("template.tracks.create_track") !== null, true);
    assert.equal(catalog.get("template.render.render_region_wav") !== null, true);
    assert.equal(catalog.get("template.analysis.detect_loop_candidates") !== null, true);
    assert.equal(catalog.get("template.items.create_layer_report") !== null, true);
    assert.equal(catalog.get("template.project.create_cleanup_report") !== null, true);
    assert.equal(catalog.get("template.render.create_delivery_report") !== null, true);
    for (const id of TEMPLATE_CATALOG_P1_TEMPLATE_IDS) {
      assert.equal(catalog.get(id) !== null, true, id);
    }
    assert.deepEqual([...CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS].sort(), [
      "template.core.read_health",
      "template.render.render_region_job",
      "template.tracks.ensure_named_track",
    ].sort());
    assert.deepEqual([...CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS].sort(), [
      "template.core.read_template_coverage_summary",
      "template.system.read_ext_state_value",
    ].sort());

    for (const id of [
      ...CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS,
      ...CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS,
    ]) {
      assert.equal(catalog.get(id), null, id);
    }
  });

  it("runs every accepted official template id through the 4B harness with a fake executor", async () => {
    const catalog = createAcceptedOfficialTemplateCatalog();
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      executor: bridge,
      evidenceLimit: catalog.size,
    });

    for (const [index, descriptor] of catalog.list().entries()) {
      const response = await runtime.call_template({
        id: descriptor.id,
        input: cloneJson(descriptor.examples[0]?.input ?? {}),
        refs: sampleInputRefs(descriptor, index),
        context: context({ request_sequence: (index % 999) + 1 }),
      });

      assert.equal(response.contract, "template.execution.v1", descriptor.id);
      assert.equal(response.ok, true, descriptor.id);
      assert.equal(response.template.id, descriptor.id);
      assert.equal(response.template.pack, descriptor.pack);
      assert.equal(response.template.risk, descriptor.risk);
      assert.equal(response.request.client.id, "openreaper-mcp");
      assert.equal("inputSchema" in response, false, descriptor.id);
      assert.equal("outputSchema" in response, false, descriptor.id);
      assert.equal("examples" in response, false, descriptor.id);
      assert.doesNotMatch(
        JSON.stringify(response),
        /inline_payload|inputSchema|outputSchema|expectedDelta|examples|descriptor/,
      );
    }

    const evidence = runtime.evidence();
    assert.equal(evidence.length, catalog.size);
    assert.equal(evidence[0].contract, CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT);
    assert.equal(evidence.every((record) => record.ok), true);
    assert.equal(evidence.every((record) => typeof record.request_id === "string"), true);
    assert.equal(evidence.every((record) => !Array.isArray(record.counts.refs)), true);
    assert.equal(evidence.some((record) => record.last_result_updated), true);
  });

  it("rejects seed-only, held, unknown, workflow-shaped, raw, and non-catalog ids with typed errors", async () => {
    const runtime = createCallTemplateRuntime({
      executor: () => {
        throw new Error("executor must not be reached for rejected ids");
      },
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    const cases = [
      ["template.core.read_health", "CALL_TEMPLATE_ID_SEED_ONLY"],
      ["template.tracks.ensure_named_track", "CALL_TEMPLATE_ID_SEED_ONLY"],
      ["template.render.render_region_job", "CALL_TEMPLATE_ID_SEED_ONLY"],
      ["template.core.read_template_coverage_summary", "CALL_TEMPLATE_ID_HELD"],
      ["template.system.read_ext_state_value", "CALL_TEMPLATE_ID_HELD"],
      ["template.tracks.not_in_catalog", "CALL_TEMPLATE_ID_UNKNOWN"],
      ["template.loop.cleanup_project", "CALL_TEMPLATE_ID_WORKFLOW_SHAPED"],
      ["not-a-template-id", "CALL_TEMPLATE_ID_NON_CATALOG"],
      ["lua:reaper.Main_OnCommand(40044, 0)", "CALL_TEMPLATE_RAW_EXECUTION_REJECTED"],
      ["action:40044", "CALL_TEMPLATE_RAW_EXECUTION_REJECTED"],
      ["template.system.run_shell_command", "CALL_TEMPLATE_RAW_EXECUTION_REJECTED"],
      ["run_command", "CALL_TEMPLATE_RAW_EXECUTION_REJECTED"],
    ];

    for (const [id, code] of cases) {
      const response = await runtime.call_template({
        id,
        input: {},
        refs: [],
        context: context(),
      });

      assert.equal(response.contract, CALL_TEMPLATE_RUNTIME_CONTRACT, id);
      assert.equal(response.ok, false, id);
      assert.equal(response.error.source, "runtime", id);
      assert.equal(response.error.code, code, id);
      assert.equal(response.request, null, id);
      assert.equal(response.budget.truncated, false, id);
    }

    assert.equal(runtime.evidence().length, cases.length);
    assert.equal(runtime.last_evidence().error.code, "CALL_TEMPLATE_RAW_EXECUTION_REJECTED");
  });

  it("rejects raw descriptors, raw execution fields, and arbitrary request fields before dispatch", async () => {
    let dispatchCount = 0;
    const runtime = createCallTemplateRuntime({
      executor: () => {
        dispatchCount += 1;
        throw new Error("executor must not be reached for malformed requests");
      },
    });

    const descriptor = await runtime.call_template({
      id: "template.tracks.create_track",
      descriptor: { id: "template.tracks.create_track" },
      input: { name: "Dialog" },
      context: context(),
    });
    assert.equal(descriptor.error.code, "CALL_TEMPLATE_DESCRIPTOR_REJECTED");

    const script = await runtime.call_template({
      id: "template.tracks.create_track",
      script: "reaper.Main_OnCommand(40044, 0)",
      input: { name: "Dialog" },
      context: context(),
    });
    assert.equal(script.error.code, "CALL_TEMPLATE_RAW_EXECUTION_REJECTED");

    const operation = await runtime.call_template({
      id: "template.tracks.create_track",
      operation: { family: "run_command", name: "template.execute" },
      input: { name: "Dialog" },
      context: context(),
    });
    assert.equal(operation.error.code, "CALL_TEMPLATE_RAW_EXECUTION_REJECTED");

    const unknownField = await runtime.call_template({
      id: "template.tracks.create_track",
      input: { name: "Dialog" },
      context: context(),
      full_descriptor: true,
    });
    assert.equal(unknownField.error.code, "CALL_TEMPLATE_REQUEST_INVALID");
    assert.equal(dispatchCount, 0);
  });

  it("routes input, refs, context, idempotency, and result-budget failures through the 4B harness", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({ executor: bridge });

    const invalidInput = await runtime.call_template({
      id: "template.tracks.create_track",
      input: { index: 0 },
      context: context(),
    });
    assert.equal(invalidInput.contract, "template.execution.v1");
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const invalidRefs = await runtime.call_template({
      id: "template.tracks.rename_track",
      input: { name: "Dialog" },
      refs: {},
      context: context(),
    });
    assert.equal(invalidRefs.error.source, "harness");
    assert.equal(invalidRefs.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);

    const invalidContext = await runtime.call_template({
      id: "template.tracks.create_track",
      input: { name: "Dialog" },
      context: { expected_owner: "owner-test" },
    });
    assert.equal(invalidContext.error.source, "harness");
    assert.equal(invalidContext.error.code, "TEMPLATE_CONTEXT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const disallowedIdempotency = await runtime.call_template({
      id: "template.actions.read_action_metadata",
      input: { section: "main", command_id: 40044 },
      context: context(),
      idempotency_key: "read-should-not-dedupe",
    });
    assert.equal(disallowedIdempotency.error.source, "harness");
    assert.equal(disallowedIdempotency.error.code, "TEMPLATE_IDEMPOTENCY_INVALID");
    assert.equal(bridge.seen.length, 0);

    const oversizedBridge = new FakeFoundationBridge();
    const oversized = await createCallTemplateRuntime({
      executor: (request) =>
        oversizedBridge.okEnvelope(request, "2026-07-03T00:00:00.000Z", {
          summary: { inline_payload: "x".repeat(64) },
        }),
    }).call_template({
      id: "template.tracks.create_track",
      input: { name: "Dialog" },
      context: context(),
      budget: {
        max_response_bytes: 65_536,
        max_items: 50,
        max_inline_value_bytes: 16,
      },
    });
    assert.equal(oversized.error.source, "harness");
    assert.equal(oversized.error.code, "RESPONSE_TOO_LARGE");
  });

  it("returns canonical refs, readback, and session ledger for static chained calls", async () => {
    const runtime = createCallTemplateRuntime({ executor: new FakeFoundationBridge() });

    const resolvedItem = await runtime.call_template({
      id: "template.items.resolve_item_ref",
      input: { ref: "selected:0" },
      context: context({ request_sequence: 1 }),
    });
    assert.equal(resolvedItem.ok, true);
    assert.equal(resolvedItem.result.refs[0].kind, "item");
    assert.equal(resolvedItem.result.refs[0].identity.scheme, "guid");
    assert.equal(resolvedItem.result.refs[0].index, 0);
    assert.equal(resolvedItem.result.refs[0].display_number, 1);
    assert.equal(resolvedItem.result.refs[0].selected, true);
    assert.equal(resolvedItem.result.readback.raw_name, "");
    assert.equal(resolvedItem.result.readback.display_name, "Item 1");
    assert.equal(resolvedItem.result.readback.fallback_name_used, true);

    const itemSummary = await runtime.call_template({
      id: "template.items.read_item_summary",
      input: { include_take_summary: true },
      refs: { item_ref: resolvedItem.result.refs[0] },
      context: context({ request_sequence: 2 }),
    });
    assert.equal(itemSummary.ok, true);
    assert.equal(itemSummary.result.refs[0].ref, resolvedItem.result.refs[0].ref);
    assert.equal(itemSummary.result.readback.status, "read");

    const resolvedTrack = await runtime.call_template({
      id: "template.tracks.resolve_track_ref",
      input: { track_ref: "track:index:0" },
      context: context({ request_sequence: 3 }),
    });
    assert.equal(resolvedTrack.ok, true);
    assert.equal(resolvedTrack.result.refs[0].kind, "track");
    assert.equal(resolvedTrack.result.refs[0].identity.scheme, "guid");
    assert.equal(resolvedTrack.result.refs[0].display_number, 1);

    const mute = await runtime.call_template({
      id: "template.tracks.set_mute",
      input: { muted: true },
      refs: { track_ref: resolvedTrack.result.refs[0] },
      idempotency_key: "static-set-mute",
      context: context({ request_sequence: 4 }),
    });
    assert.equal(mute.ok, true);
    assert.equal(mute.result.refs[0].ref, resolvedTrack.result.refs[0].ref);
    assert.equal(mute.result.session_ledger.contract, "session.ledger.v1");
    assert.equal(mute.result.session_ledger.request_id, mute.request.id);
    assert.equal(mute.result.session_ledger.operation_id, "run_command:template.execute");
    assert.equal(mute.result.session_ledger.undo_label, "OpenReaper: track.set_mute");
    assert.equal(mute.result.session_ledger.readback_status, "available");
    assert.deepEqual(mute.result.session_ledger.refs.created, []);
    assert.equal(mute.result.session_ledger.refs.modified[0].ref, resolvedTrack.result.refs[0].ref);

    const createdTrack = await runtime.call_template({
      id: "template.tracks.create_track",
      input: { name: "", index: 0 },
      idempotency_key: "static-create-track",
      context: context({ request_sequence: 5 }),
    });
    assert.equal(createdTrack.ok, true);
    assert.equal(createdTrack.result.refs[0].raw.name, "");
    assert.equal(createdTrack.result.refs[0].display.name, "Track 1");
    assert.equal(createdTrack.result.refs[0].selected, false);
    assert.equal(createdTrack.result.session_ledger.cleanup_method, "returned_ref");
    assert.equal(createdTrack.result.session_ledger.refs.created[0].ref, createdTrack.result.refs[0].ref);
  });

  it("keeps discovery compact and does not add a sixth MCP tool", () => {
    const runtime = createCallTemplateRuntime({ executor: new FakeFoundationBridge() });
    const directDiscovery = createAcceptedOfficialTemplateDiscovery();

    const runtimeMenu = runtime.list_templates();
    assert.equal(runtimeMenu.contract, "discovery.menu.v1");
    assert.equal(runtimeMenu.kind, "template_menu");
    assert.equal(runtimeMenu.mode, "menu");
    assert.equal(runtimeMenu.items.length, 0);
    assert.equal(runtimeMenu.page.has_more, false);
    assert.equal("total" in runtimeMenu.page, false);
    assert.equal(runtimeMenu.applied.surface, "executable");

    const catalogMenu = runtime.list_templates({ surface: "catalog" });
    assert.deepEqual(catalogMenu, directDiscovery.list_templates());
    assert.equal(catalogMenu.items.length, 25);
    assert.equal(catalogMenu.page.has_more, true);
    assert.equal(catalogMenu.applied.surface, "catalog");

    const menuPayload = JSON.stringify(catalogMenu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      if (["refs", "artifacts", "verification"].includes(field)) continue;
      assert.doesNotMatch(menuPayload, new RegExp(field));
    }
    assert.equal(catalogMenu.items.every((item) => !Object.hasOwn(item, "refs")), true);
    assert.equal(catalogMenu.items.every((item) => !Object.hasOwn(item, "artifacts")), true);
    assert.equal(catalogMenu.items.every((item) => !Object.hasOwn(item, "verification")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "capability_truth")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "action_name")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "template_id")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "beginner_label")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "user_action_category")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "current_status")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "user_message")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "next_step")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "safety_note")), true);
    assert.equal(catalogMenu.items.every((item) => Object.hasOwn(item, "common_phrases")), true);
    assert.equal(catalogMenu.items.every((item) => item.capability_truth.live_runnable_now === false), true);
    assert.equal(
      catalogMenu.items.some((item) => item.capability_truth.allowed_live_group === "wave0"),
      true,
    );
    assert.equal(catalogMenu.items[0].capability_truth.exists_in_catalog, true);
    assert.equal(catalogMenu.items[0].capability_truth.live_runnable_now, false);
    assert.equal(
      catalogMenu.items[0].capability_truth.known_blocker,
      "live_executor_not_configured_or_not_in_allowed_group",
    );
    assert.equal(catalogMenu.items[0].current_status, "blocked");
    assert.equal(catalogMenu.items[0].action_name, "read_project_summary");

    const exact = runtime.list_templates({
      ids: ["template.tracks.create_track"],
      fields: ["summary", "inputSchema", "expectedDelta"],
    });
    assert.deepEqual(Object.keys(exact.items[0]).sort(), [
      "action_name",
      "beginner_label",
      "capability_truth",
      "common_phrases",
      "current_status",
      "example_input",
      "expectedDelta",
      "fixture_requirements",
      "id",
      "inputSchema",
      "needs_confirmation",
      "next_step",
      "output_refs",
      "required_input",
      "required_refs",
      "safety_note",
      "summary",
      "template_id",
      "user_action_category",
      "user_message",
    ]);
    assert.equal("bridge" in exact.items[0], false);
    assert.equal("refs" in exact.items[0], false);
    assert.equal("artifacts" in exact.items[0], false);
    assert.equal(exact.items[0].capability_truth.example_call_shape.tool, "call_template");
    assert.equal(exact.items[0].capability_truth.requires_refs, false);
    assert.equal(exact.items[0].action_name, "create_track");
    assert.deepEqual(exact.items[0].required_input, ["name"]);
    assert.equal(exact.items[0].current_status, "blocked");
    assert.equal(exact.items[0].beginner_label, "Not available in this runtime");
    assert.equal(exact.items[0].user_action_category, "write");
    assert.match(exact.items[0].next_step, /bounded live executor/);
    assert.equal(exact.items[0].common_phrases.includes("create track"), true);

    const liveRuntime = createCallTemplateRuntime({
      executor: new FakeFoundationBridge(),
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
      },
    });
    const liveMenu = liveRuntime.list_templates();
    assert.deepEqual(
      liveMenu.items.map((item) => item.id),
      CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
    );
    assert.equal(liveMenu.applied.surface, "executable");
    assert.equal(liveMenu.items.every((item) => item.capability_truth.live_runnable_now === true), true);
    assert.equal(liveMenu.items.every((item) => item.current_status === "available_now"), true);
    assert.equal(liveMenu.items.every((item) => item.beginner_label === "Ready now"), true);
    assert.equal(liveMenu.items[0].action_name, "read_project_summary");

    const liveExact = liveRuntime.list_templates({
      ids: ["template.project.read_summary", "template.tracks.create_track"],
      fields: ["summary"],
    });
    assert.equal(liveExact.items[0].capability_truth.live_runnable_now, true);
    assert.equal(liveExact.items[0].capability_truth.allowed_live_group, "wave0");
    assert.equal(liveExact.items[0].capability_truth.known_blocker, null);
    assert.equal(liveExact.items[0].current_status, "available_now");
    assert.equal(liveExact.items[1].capability_truth.live_runnable_now, false);
    assert.equal(liveExact.items[1].current_status, "blocked");
    assert.equal(
      liveExact.items[1].capability_truth.known_blocker,
      "live_executor_not_configured_or_not_in_allowed_group",
    );

    const graduatedRuntime = createCallTemplateRuntime({
      executor: new FakeFoundationBridge(),
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
      },
    });
    const graduatedMenu = graduatedRuntime.list_templates({ limit: 100 });
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.length, 213);
    assert.equal(graduatedRuntime.live_gate.allowed_template_ids.length, 213);
    assert.equal(graduatedMenu.items.length, 100);
    assert.equal(graduatedMenu.page.has_more, true);
    assert.equal(
      graduatedRuntime.list_templates({
        ids: [
          "template.fx.add_track_fx",
          "template.routing.create_track_send",
          "template.automation.insert_envelope_point",
        ],
        fields: ["summary"],
      }).items.every((item) => item.capability_truth.known_blocker === null),
      true,
    );

    const safeWriteRuntime = createCallTemplateRuntime({
      executor: new FakeFoundationBridge(),
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
      },
    });
    const safeWriteMenu = safeWriteRuntime.list_templates({ limit: 100 });
    assert.equal(safeWriteMenu.items.some((item) => item.id === "template.midi.create_midi_item"), true);
    assert.equal(safeWriteMenu.items.some((item) => item.action_name === "set_track_color"), true);
    assert.equal(safeWriteMenu.items.find((item) => item.id === "template.tracks.set_color").current_status, "needs_ref");
    assert.equal(
      safeWriteMenu.items.find((item) => item.id === "template.midi.create_midi_item").current_status,
      "needs_ref",
    );
    assert.equal(
      safeWriteMenu.items.find((item) => item.id === "template.project.create_marker").current_status,
      "needs_confirmation",
    );
    const midiCreate = safeWriteRuntime.list_templates({
      ids: ["template.midi.create_midi_item"],
      fields: ["summary"],
    });
    assert.equal(midiCreate.items[0].current_status, "needs_ref");
    assert.equal(midiCreate.items[0].capability_truth.known_blocker, null);

    const bpmExact = runtime.list_templates({
      ids: ["template.project.set_bpm"],
      fields: ["summary"],
    });
    assert.equal(bpmExact.items[0].current_status, "blocked");
    assert.equal(bpmExact.items[0].capability_truth.evidence_level, "live_smoked");
    assert.equal(
      bpmExact.items[0].capability_truth.known_blocker,
      "live_executor_not_configured_or_not_in_allowed_group",
    );
    assert.equal(bpmExact.items[0].capability_truth.allowed_live_group, "d6_project_tempo");

    const tempoRuntime = createCallTemplateRuntime({
      executor: new FakeFoundationBridge(),
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
      },
    });
    const tempoMenu = tempoRuntime.list_templates({ limit: 10 });
    assert.deepEqual(
      tempoMenu.items.map((item) => item.id),
      CALL_TEMPLATE_RUNTIME_D6_PROJECT_TEMPO_TEMPLATE_IDS,
    );
    assert.equal(
      tempoMenu.items.every((item) => item.capability_truth.live_runnable_now === true),
      true,
    );
    assert.equal(
      tempoMenu.items.every((item) => item.current_status === "needs_confirmation"),
      true,
    );
    const tempoExact = tempoRuntime.list_templates({
      ids: ["template.project.set_bpm"],
      fields: ["summary"],
    });
    assert.equal(tempoExact.items[0].capability_truth.known_blocker, null);
    assert.equal(tempoExact.items[0].current_status, "needs_confirmation");

    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 5);
  });

  it("exposes the E2 FX-B1 route as an explicit fake/static route without broadening default live ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS, [
      "template.fx.resolve_fx_ref",
      "template.fx.list_track_fx_chain",
      "template.fx.list_take_fx_chain",
      "template.fx.read_fx_summary",
      "template.fx.list_fx_parameters",
      "template.fx.read_fx_parameter",
      "template.fx.parameter_to_envelope_mapping",
      "template.fx.add_track_fx",
      "template.fx.add_take_fx",
      "template.fx.set_fx_bypass",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.set_fx_preset_by_name",
      "template.fx.set_fx_preset_by_index",
      "template.fx.reorder_fx",
      "template.fx.read_video_processor_code",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
        opt_in_env: "OPENREAPER_E2_FX_B1_LIVE_SMOKE",
        opt_in_flag: "--live",
      },
      evidenceLimit: 20,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: fxB1RouteInput(id),
        refs: fxB1RouteRefs(id),
        idempotency_key: fxB1IdempotencyKey(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      [
        "query_state:fx.resolve_ref",
        "query_state:fx.list_track_chain",
        "query_state:fx.list_take_chain",
        "query_state:fx.read_summary",
        "query_state:fx.list_parameters",
        "query_state:fx.read_parameter",
        "query_state:fx.parameter_to_envelope_mapping",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
        "query_state:fx.read_video_processor_code",
      ],
    );
    assert.deepEqual(
      bridge.seen.map((request) => request.pack.capability),
      [
        "fx.resolve_ref",
        "fx.list_track_chain",
        "fx.list_take_chain",
        "fx.read_summary",
        "fx.list_parameters",
        "fx.read_parameter",
        "fx.parameter_to_envelope_mapping",
        "fx.add_track",
        "fx.add_take",
        "fx.set_bypass",
        "fx.set_parameter_normalized",
        "fx.set_preset_by_name",
        "fx.set_preset_by_index",
        "fx.reorder",
        "fx.read_video_processor_code",
      ],
    );
    for (const request of bridge.seen.slice(0, 7)) {
      assert.equal(request.pack.id, "fx");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
    }
    for (const request of bridge.seen.slice(7, 14)) {
      assert.equal(request.pack.id, "fx");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
    }
    assert.equal(bridge.seen[14].pack.risk, "read");
    assert.equal(bridge.seen[14].artifacts.allow, true);

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
          "template.fx.search_installed_fx",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("runs the E2 FX-B1 fake smoke and reports live preflight blockers without starting REAPER", () => {
    const fake = runFxB1RouteSmoke(["--fx-b1", "--fake"]);
    assert.equal(fake.ok, true);
    assert.equal(fake.mode, "fake");
    assert.equal(fake.spawned_reaper, false);
    assert.equal(fake.live_pass_claimed, false);
    assert.deepEqual(fake.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS);
    assert.deepEqual(fake.allowed_bridge_operations, [
      "query_state:fx.resolve_ref",
      "query_state:fx.list_track_chain",
      "query_state:fx.list_take_chain",
      "query_state:fx.read_summary",
      "query_state:fx.list_parameters",
      "query_state:fx.read_parameter",
      "query_state:fx.parameter_to_envelope_mapping",
      "query_state:fx.read_video_processor_code",
      "run_command:template.execute",
    ]);
    assert.deepEqual(fake.preflight_blockers_covered, [
      "fx_track_ref_missing",
      "fx_take_ref_missing",
      "fx_ref_missing",
      "fx_plugin_name_missing",
      "fx_parameter_invalid",
      "fx_preset_fixture_missing",
      "video_processor_fixture_missing",
    ]);
    assert.equal(fake.executions.length, 15);
    assert.equal(fake.executions.every((execution) => execution.ok), true);
    assert.equal(fake.executions.filter((execution) => execution.risk === "write").length, 5);
    assert.equal(fake.executions.filter((execution) => execution.artifacts_allowed === true).length, 1);
    assert.deepEqual(
      fake.executions
        .filter((execution) => execution.skipped)
        .map((execution) => execution.id),
      [
        "template.fx.set_fx_preset_by_name",
        "template.fx.set_fx_preset_by_index",
      ],
    );
    for (const execution of fake.executions.filter((entry) => entry.risk === "write")) {
      assert.equal(execution.operation, "run_command:template.execute");
      assert.equal(execution.undo.mode, "required");
      assert.equal(execution.artifacts_allowed, false);
    }

    const root = mkdtempSync(join(tmpdir(), "openreaper-e2-fx-b1-"));
    const transportDir = join(root, "transport");
    mkdirSync(join(transportDir, "requests"), { recursive: true });
    mkdirSync(join(transportDir, "results"), { recursive: true });
    const baseEnv = {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      OPENREAPER_E2_FX_TRACK_REF: "track:index:0",
      OPENREAPER_E2_FX_TAKE_REF: "take:index:0",
      OPENREAPER_E2_FX_REF: "fx:track:0",
      OPENREAPER_E2_FX_PLUGIN_NAME: "ReaEQ (Cockos)",
      OPENREAPER_E2_FX_SECOND_PLUGIN_NAME: "ReaComp (Cockos)",
      OPENREAPER_E2_FX_PARAM_INDEX: "0",
      OPENREAPER_E2_FX_PARAM_VALUE: "0.5",
    };

    const missingTrack = runFxB1RouteSmokeExpectingFailure(["--fx-b1", "--live"], {
      ...baseEnv,
      OPENREAPER_E2_FX_TRACK_REF: "",
    });
    assert.equal(missingTrack.reason, "fx_track_ref_missing");
    assert.equal(missingTrack.spawned_reaper, false);
    assert.equal("attempted_template_ids" in missingTrack, false);

    const invalidFx = runFxB1RouteSmokeExpectingFailure(["--fx-b1", "--live"], {
      ...baseEnv,
      OPENREAPER_E2_FX_REF: "bad-fx-ref",
    });
    assert.equal(invalidFx.reason, "fx_ref_invalid");
    assert.equal(invalidFx.spawned_reaper, false);

    const missingPlugin = runFxB1RouteSmokeExpectingFailure(["--fx-b1", "--live"], {
      ...baseEnv,
      OPENREAPER_E2_FX_PLUGIN_NAME: "",
    });
    assert.equal(missingPlugin.reason, "fx_plugin_name_missing");
    assert.equal(missingPlugin.spawned_reaper, false);
  });

  it("exposes the E5 routing/automation route as an explicit fake/static route without broadening default live ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS, [
      "template.routing.read_track_routing",
      "template.routing.resolve_send_ref",
      "template.routing.create_track_send",
      "template.routing.set_send_volume",
      "template.routing.set_send_pan",
      "template.routing.set_send_mute",
      "template.routing.set_send_mode",
      "template.routing.set_master_parent_send",
      "template.routing.set_track_channel_count",
      "template.routing.list_track_hardware_outputs",
      "template.routing.set_track_hardware_output",
      "template.routing.remove_track_hardware_output",
      "template.routing.read_project_routing_graph",
      "template.routing.list_available_audio_outputs",
      "template.routing.set_send_audio_channels",
      "template.routing.set_send_phase",
      "template.routing.set_send_mono",
      "template.routing.set_send_midi_channels",
      "template.routing.read_fx_pin_mapping",
      "template.automation.resolve_envelope_ref",
      "template.automation.read_envelope_summary",
      "template.automation.read_envelope_points",
      "template.automation.evaluate_envelope_at_time",
      "template.automation.set_envelope_lane_state",
      "template.automation.insert_envelope_point",
      "template.automation.set_track_automation_mode",
      "template.automation.read_track_automation_mode",
      "template.automation.read_automation_items",
      "template.automation.set_envelope_point",
      "template.automation.insert_envelope_points_batch",
      "template.automation.set_send_automation_mode",
      "template.automation.create_automation_item",
      "template.automation.set_automation_item_bounds",
      "template.automation.resolve_send_envelope",
      "template.automation.insert_fx_parameter_envelope_points",
      "template.automation.insert_sine_wave_points",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
        opt_in_env: "OPENREAPER_E5_ROUTING_AUTOMATION_LIVE_SMOKE",
        opt_in_flag: "--live",
      },
      evidenceLimit: 40,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: e5RouteInput(id),
        refs: e5RouteRefs(id),
        idempotency_key: e5RouteIdempotencyKey(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.equal(bridge.seen.length, 36);
    assert.equal(bridge.seen.filter((request) => request.operation.family === "query_state").length, 13);
    assert.equal(bridge.seen.filter((request) => request.operation.family === "run_command").length, 23);
    assert.equal(bridge.seen.filter((request) => request.pack.id === "routing").length, 19);
    assert.equal(bridge.seen.filter((request) => request.pack.id === "automation").length, 17);
    for (const request of bridge.seen.filter((entry) => entry.pack.risk === "read")) {
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
    }
    for (const request of bridge.seen.filter((entry) => entry.pack.risk === "write")) {
      assert.equal(request.operation.family, "run_command");
      assert.equal(request.operation.name, "template.execute");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
    }

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS,
          "template.routing.read_track_routing",
          "template.fx.search_installed_fx",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("runs the E5 routing/automation fake smoke and reports live preflight blockers without starting REAPER", () => {
    const fake = runE5RouteSmoke(["--routing-automation", "--fake"]);
    assert.equal(fake.ok, true);
    assert.equal(fake.mode, "fake");
    assert.equal(fake.spawned_reaper, false);
    assert.equal(fake.live_pass_claimed, false);
    assert.deepEqual(fake.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E5_ROUTING_AUTOMATION_ROUTE_TEMPLATE_IDS);
    assert.equal(fake.executions.length, 36);
    assert.equal(fake.executions.every((execution) => execution.ok), true);
    assert.equal(fake.executions.filter((execution) => execution.risk === "read").length, 13);
    assert.equal(fake.executions.filter((execution) => execution.risk === "write").length, 23);
    assert.equal(fake.executions.filter((execution) => execution.artifacts_allowed === true).length, 0);
    assert.deepEqual(fake.preflight_blockers_covered, [
      "e5_track_ref_missing",
      "e5_destination_track_ref_missing",
      "e5_send_ref_missing",
      "e5_fx_ref_missing",
      "e5_envelope_ref_missing",
      "e5_send_value_invalid",
      "e5_automation_point_value_invalid",
    ]);
    assert.equal(fake.routing_template_ids.length, 19);
    assert.equal(fake.automation_template_ids.length, 17);

    const root = mkdtempSync(join(tmpdir(), "openreaper-e5-routing-automation-"));
    const transportDir = join(root, "transport");
    mkdirSync(join(transportDir, "requests"), { recursive: true });
    mkdirSync(join(transportDir, "results"), { recursive: true });
    const baseEnv = {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      OPENREAPER_E5_TRACK_REF: "track:index:0",
      OPENREAPER_E5_DESTINATION_TRACK_REF: "track:index:1",
      OPENREAPER_E5_SEND_REF: "send:track:0:0",
      OPENREAPER_E5_FX_REF: "fx:track:0",
      OPENREAPER_E5_ENVELOPE_REF: "envelope:track:volume",
    };

    const missingSend = runE5RouteSmokeExpectingFailure(["--routing-automation", "--live"], {
      ...baseEnv,
      OPENREAPER_E5_SEND_REF: "",
    });
    assert.equal(missingSend.reason, "e5_send_ref_missing");
    assert.equal(missingSend.spawned_reaper, false);

    const invalidEnvelope = runE5RouteSmokeExpectingFailure(["--routing-automation", "--live"], {
      ...baseEnv,
      OPENREAPER_E5_ENVELOPE_REF: "bad-envelope-ref",
    });
    assert.equal(invalidEnvelope.reason, "e5_envelope_ref_invalid");
    assert.equal(invalidEnvelope.spawned_reaper, false);

    const invalidPan = runE5RouteSmokeExpectingFailure(["--routing-automation", "--live"], {
      ...baseEnv,
      OPENREAPER_E5_SEND_PAN: "2",
    });
    assert.equal(invalidPan.reason, "e5_send_value_invalid");
    assert.equal(invalidPan.spawned_reaper, false);
  });

  it("exposes the E3 media route as an explicit fake/static route without broadening default live ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS, [
      "template.media.list_folder_media_files",
      "template.media.import_file_to_track",
      "template.media.import_file_section_to_track",
      "template.media.relink_take_source",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
        opt_in_env: "OPENREAPER_E3_MEDIA_ROUTE_LIVE_SMOKE",
        opt_in_flag: "--live",
      },
      evidenceLimit: 10,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: mediaRouteInput(id),
        refs: mediaRouteRefs(id),
        idempotency_key: id === "template.media.relink_take_source" ? "e3-media-route:relink-take-source" : undefined,
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      [
        "query_state:media.folder_media.list",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
      ],
    );
    assert.deepEqual(
      bridge.seen.map((request) => request.pack.capability),
      [
        "media.folder_media.list",
        "media.import_file_to_track",
        "media.import_file_section_to_track",
        "media.relink_take_source",
      ],
    );
    assert.equal(bridge.seen[0].undo.mode, "none");
    for (const request of bridge.seen.slice(1)) {
      assert.equal(request.pack.id, "media");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
    }
    assert.equal(bridge.seen[3].idempotency_key, "e3-media-route:relink-take-source");

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
          "template.media.probe_file",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("runs the E3 media route fake smoke and reports live preflight blockers without starting REAPER", () => {
    const fake = runMediaRouteSmoke(["--media-route", "--fake"]);
    assert.equal(fake.ok, true);
    assert.equal(fake.mode, "fake");
    assert.equal(fake.spawned_reaper, false);
    assert.equal(fake.live_pass_claimed, false);
    assert.deepEqual(fake.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS);
    assert.deepEqual(fake.allowed_bridge_operations, [
      "query_state:media.folder_media.list",
      "run_command:template.execute",
    ]);
    assert.deepEqual(fake.expected_capabilities, [
      "media.folder_media.list",
      "media.import_file_to_track",
      "media.import_file_section_to_track",
      "media.relink_take_source",
    ]);
    assert.deepEqual(fake.preflight_blockers_covered, [
      "folder_root_absent",
      "media_source_unsupported",
      "media_source_absent",
      "relink_target_type_mismatch",
    ]);
    assert.equal(fake.executions.length, 4);
    assert.equal(fake.executions.every((execution) => execution.ok), true);
    assert.equal(fake.executions[0].operation, "query_state:media.folder_media.list");
    for (const execution of fake.executions.slice(1)) {
      assert.equal(execution.operation, "run_command:template.execute");
      assert.equal(execution.undo.mode, "required");
      assert.equal(execution.artifacts_allowed, false);
    }

    const root = mkdtempSync(join(tmpdir(), "openreaper-e3-media-route-"));
    const transportDir = join(root, "transport");
    const folderRoot = join(root, "media");
    mkdirSync(join(transportDir, "requests"), { recursive: true });
    mkdirSync(join(transportDir, "results"), { recursive: true });
    mkdirSync(folderRoot);
    const sourcePath = join(folderRoot, "source.wav");
    const relinkPath = join(folderRoot, "target.mid");
    writeFileSync(sourcePath, "fake wav");
    writeFileSync(relinkPath, "fake midi");

    const missingFolder = runMediaRouteSmokeExpectingFailure(["--media-route", "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      OPENREAPER_E3_MEDIA_FOLDER_ROOT: join(root, "missing-media"),
      OPENREAPER_E3_MEDIA_SOURCE_PATH: sourcePath,
      OPENREAPER_E3_MEDIA_RELINK_PATH: sourcePath,
      OPENREAPER_E3_MEDIA_TARGET_TRACK_REF: "track:index:0",
      OPENREAPER_E3_MEDIA_TAKE_REF: "take:index:0",
    });
    assert.equal(missingFolder.reason, "folder_root_absent");
    assert.equal(missingFolder.spawned_reaper, false);
    assert.equal("attempted_template_ids" in missingFolder, false);

    const unsupported = runMediaRouteSmokeExpectingFailure(["--media-route", "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      OPENREAPER_E3_MEDIA_FOLDER_ROOT: folderRoot,
      OPENREAPER_E3_MEDIA_SOURCE_PATH: join(folderRoot, "source.txt"),
      OPENREAPER_E3_MEDIA_RELINK_PATH: sourcePath,
      OPENREAPER_E3_MEDIA_TARGET_TRACK_REF: "track:index:0",
      OPENREAPER_E3_MEDIA_TAKE_REF: "take:index:0",
    });
    assert.equal(unsupported.reason, "media_source_unsupported");
    assert.equal(unsupported.spawned_reaper, false);

    const mismatch = runMediaRouteSmokeExpectingFailure(["--media-route", "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      OPENREAPER_E3_MEDIA_FOLDER_ROOT: folderRoot,
      OPENREAPER_E3_MEDIA_SOURCE_PATH: sourcePath,
      OPENREAPER_E3_MEDIA_RELINK_PATH: relinkPath,
      OPENREAPER_E3_MEDIA_TARGET_TRACK_REF: "track:index:0",
      OPENREAPER_E3_MEDIA_TAKE_REF: "take:index:0",
    });
    assert.equal(mismatch.reason, "relink_target_type_mismatch");
    assert.equal(mismatch.spawned_reaper, false);
  });

  it("exposes the E4 item route as an explicit fake/static route with loop-source held", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS, [
      "template.items.copy_item_to_track",
      "template.items.split_item_at_time",
      "template.items.set_take_playrate",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
        opt_in_env: "OPENREAPER_E4_ITEM_ROUTE_LIVE_SMOKE",
        opt_in_flag: "--live",
      },
      evidenceLimit: 10,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: itemRouteInput(id),
        refs: itemRouteRefs(id),
        idempotency_key: id === "template.items.set_take_playrate" ? "e4-item-route:set-take-playrate" : undefined,
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      [
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
      ],
    );
    assert.deepEqual(
      bridge.seen.map((request) => request.pack.capability),
      [
        "item.copy_to_track",
        "items.split_item_at_time",
        "items.set_take_playrate",
      ],
    );
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
    }
    assert.equal(bridge.seen[2].idempotency_key, "e4-item-route:set-take-playrate");

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
          "template.items.move_item",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("runs the E4 item route fake smoke and reports live preflight blockers without starting REAPER", () => {
    const fake = runItemRouteSmoke(["--item-route", "--fake"]);
    assert.equal(fake.ok, true);
    assert.equal(fake.mode, "fake");
    assert.equal(fake.spawned_reaper, false);
    assert.equal(fake.live_pass_claimed, false);
    assert.deepEqual(fake.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS);
    assert.deepEqual(fake.allowed_bridge_operations, ["run_command:template.execute"]);
    assert.deepEqual(fake.expected_capabilities, [
      "item.copy_to_track",
      "items.split_item_at_time",
      "items.set_take_playrate",
    ]);
    assert.deepEqual(fake.preflight_blockers_covered, [
      "selected_item_missing",
      "invalid_item_ref",
      "destination_track_missing",
      "split_outside_item_bounds",
      "invalid_playrate",
    ]);
    assert.equal(fake.loop_source_status, "held");
    assert.equal(fake.executions.length, 3);
    assert.equal(fake.executions.every((execution) => execution.ok), true);
    for (const execution of fake.executions) {
      assert.equal(execution.operation, "run_command:template.execute");
      assert.equal(execution.undo.mode, "required");
      assert.equal(execution.artifacts_allowed, false);
    }

    const root = mkdtempSync(join(tmpdir(), "openreaper-e4-item-route-"));
    const transportDir = join(root, "transport");
    mkdirSync(join(transportDir, "requests"), { recursive: true });
    mkdirSync(join(transportDir, "results"), { recursive: true });
    const baseEnv = {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      OPENREAPER_E4_ITEM_REF: "item:guid:{E4-SOURCE-ITEM}",
      OPENREAPER_E4_TARGET_TRACK_REF: "track:guid:{E4-TARGET-TRACK}",
      OPENREAPER_E4_ITEM_START_SECONDS: "0",
      OPENREAPER_E4_ITEM_LENGTH_SECONDS: "4",
      OPENREAPER_E4_SPLIT_POSITION_SECONDS: "2",
      OPENREAPER_E4_PLAYRATE: "0.75",
    };

    const missingSelected = runItemRouteSmokeExpectingFailure(["--item-route", "--live"], {
      ...baseEnv,
      OPENREAPER_E4_ITEM_REF: "",
    });
    assert.equal(missingSelected.reason, "selected_item_missing");
    assert.equal(missingSelected.spawned_reaper, false);
    assert.equal("attempted_template_ids" in missingSelected, false);

    const invalidItem = runItemRouteSmokeExpectingFailure(["--item-route", "--live"], {
      ...baseEnv,
      OPENREAPER_E4_ITEM_REF: "bad:item",
    });
    assert.equal(invalidItem.reason, "invalid_item_ref");
    assert.equal(invalidItem.spawned_reaper, false);

    const missingTrack = runItemRouteSmokeExpectingFailure(["--item-route", "--live"], {
      ...baseEnv,
      OPENREAPER_E4_TARGET_TRACK_REF: "",
    });
    assert.equal(missingTrack.reason, "destination_track_missing");
    assert.equal(missingTrack.spawned_reaper, false);

    const splitOutside = runItemRouteSmokeExpectingFailure(["--item-route", "--live"], {
      ...baseEnv,
      OPENREAPER_E4_SPLIT_POSITION_SECONDS: "4",
    });
    assert.equal(splitOutside.reason, "split_outside_item_bounds");
    assert.equal(splitOutside.spawned_reaper, false);

    const invalidPlayrate = runItemRouteSmokeExpectingFailure(["--item-route", "--live"], {
      ...baseEnv,
      OPENREAPER_E4_PLAYRATE: "0",
    });
    assert.equal(invalidPlayrate.reason, "invalid_playrate");
    assert.equal(invalidPlayrate.spawned_reaper, false);
  });

  it("keeps Layer 4D outside recipes, process spawning, and live REAPER startup by default", () => {
    const runtimeSource = readFileSync(
      new URL("../../packages/mcp-server/src/call-template-runtime-v1.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(runtimeSource, /recipes?\//i);
    assert.doesNotMatch(runtimeSource, /checkpoint|resume|recipe_run|run_state/i);
    assert.doesNotMatch(runtimeSource, /child_process|spawn\(|execFile|execSync|open -a|REAPER\.app/);

    const scriptSource = readFileSync(
      new URL("../../scripts/smoke-template-runtime-live.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(scriptSource, /child_process|spawn\(|execFile|execSync|open -a|REAPER\.app/);

    const output = execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      },
    }).trim();
    const report = JSON.parse(output);

    assert.equal(report.gate, "template-runtime-live");
    assert.equal(report.ok, true);
    assert.equal(report.skipped, true);
    assert.equal(report.reason, "explicit_opt_in_required");
    assert.equal(report.spawned_reaper, false);
  });
});

function sampleInputRefs(descriptor, index) {
  return Object.fromEntries(
    descriptor.refs.input.map((refDeclaration, refIndex) => [
      refDeclaration.name,
      sampleObjectRef(refDeclaration.kind, index, refIndex),
    ]),
  );
}

function sampleObjectRef(kind, index, refIndex) {
  if (kind === "artifact") {
    return createArtifactRef({
      owner_pack: "analysis",
      scope: "metadata",
      id: sampleArtifactId(index, refIndex),
      schema: "analysis.metadata.v1",
      summary: { template_index: index },
    });
  }

  const scheme = kind === "job" ? "job_id" : kind === "file" ? "path" : "guid";
  const value = kind === "file" ? `/tmp/openreaper-${index}-${refIndex}.wav` : `{${kind.toUpperCase()}-${index}-${refIndex}}`;
  return createObjectRef(kind, { scheme, value });
}

function fxB1RouteInput(id) {
  if (id === "template.fx.resolve_fx_ref") {
    return { owner_kind: "track", slot_index: 0 };
  }
  if (id === "template.fx.list_track_fx_chain" || id === "template.fx.list_take_fx_chain") {
    return { include_preset: true };
  }
  if (id === "template.fx.list_fx_parameters") {
    return { limit: 16 };
  }
  if (id === "template.fx.read_fx_parameter" || id === "template.fx.parameter_to_envelope_mapping") {
    return { param_index: 0 };
  }
  if (id === "template.fx.add_track_fx" || id === "template.fx.add_take_fx") {
    return { plugin_name: "ReaEQ (Cockos)" };
  }
  if (id === "template.fx.set_fx_bypass") {
    return { enabled: false };
  }
  if (id === "template.fx.set_fx_parameter_normalized") {
    return { param_index: 0, normalized_value: 0.5, tolerance: 0.001 };
  }
  if (id === "template.fx.set_fx_preset_by_name") {
    return { preset_name: "Default" };
  }
  if (id === "template.fx.set_fx_preset_by_index") {
    return { preset_index: 0 };
  }
  if (id === "template.fx.reorder_fx") {
    return { target_index: 0 };
  }
  return {};
}

function fxB1RouteRefs(id) {
  const trackRef = createObjectRef("track", { scheme: "guid", value: "{E2-FX-TRACK}" }, {
    ref: "track:guid:{E2-FX-TRACK}",
  });
  const takeRef = createObjectRef("take", { scheme: "guid", value: "{E2-FX-TAKE}" }, {
    ref: "take:guid:{E2-FX-TAKE}",
  });
  const fxRef = createObjectRef("fx", { scheme: "track", value: "0" }, {
    ref: "fx:track:0",
  });
  const videoFxRef = createObjectRef("fx", { scheme: "track", value: "video_processor:0" }, {
    ref: "fx:track:video_processor:0",
  });

  if (id === "template.fx.resolve_fx_ref" || id === "template.fx.list_track_fx_chain" || id === "template.fx.add_track_fx") {
    return { track_ref: trackRef };
  }
  if (id === "template.fx.list_take_fx_chain" || id === "template.fx.add_take_fx") {
    return { take_ref: takeRef };
  }
  if (id === "template.fx.read_video_processor_code") {
    return { fx_ref: videoFxRef };
  }
  return { fx_ref: fxRef };
}

function fxB1IdempotencyKey(id) {
  return [
    "template.fx.set_fx_bypass",
    "template.fx.set_fx_parameter_normalized",
    "template.fx.set_fx_preset_by_name",
    "template.fx.set_fx_preset_by_index",
    "template.fx.reorder_fx",
  ].includes(id) ? `e2-fx-b1:${id}` : undefined;
}

function runFxB1RouteSmoke(args, env = {}) {
  const output = execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs", ...args], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      OPENREAPER_E2_FX_B1_LIVE_SMOKE: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      ...env,
    },
  }).trim();
  return JSON.parse(output);
}

function runFxB1RouteSmokeExpectingFailure(args, env = {}) {
  try {
    return runFxB1RouteSmoke(args, env);
  } catch (error) {
    assert.equal(error.status, 2);
    const report = JSON.parse(String(error.stdout));
    assert.equal(report.ok, false);
    return report;
  }
}

function mediaRouteInput(id) {
  if (id === "template.media.list_folder_media_files") {
    return {
      folder_ref: "folder:fixture-media",
      media_type: "audio",
      extension_filter: ["wav"],
      limit: 8,
      offset: 0,
    };
  }
  if (id === "template.media.import_file_to_track") {
    return {
      position_seconds: 0,
      preserve_selection: true,
    };
  }
  if (id === "template.media.import_file_section_to_track") {
    return {
      position_seconds: 2,
      start_percent: 0.25,
      end_percent: 0.75,
      preserve_selection: true,
    };
  }
  if (id === "template.media.relink_take_source") {
    return {
      verify_source_type: true,
    };
  }
  return {};
}

function mediaRouteRefs(id) {
  const sourceFileRef = createObjectRef("file", { scheme: "path", value: "fixture-source.wav" }, {
    ref: "file:path:fixture-source.wav",
  });
  const relinkFileRef = createObjectRef("file", { scheme: "path", value: "fixture-relink.wav" }, {
    ref: "file:path:fixture-relink.wav",
  });
  const trackRef = createObjectRef("track", { scheme: "guid", value: "{E3-MEDIA-TRACK}" }, {
    ref: "track:guid:{E3-MEDIA-TRACK}",
  });
  const takeRef = createObjectRef("take", { scheme: "guid", value: "{E3-MEDIA-TAKE}" }, {
    ref: "take:guid:{E3-MEDIA-TAKE}",
  });

  if (id === "template.media.import_file_to_track" || id === "template.media.import_file_section_to_track") {
    return {
      source_file_ref: sourceFileRef,
      track_ref: trackRef,
    };
  }
  if (id === "template.media.relink_take_source") {
    return {
      take_ref: takeRef,
      source_file_ref: relinkFileRef,
    };
  }
  return {};
}

function runMediaRouteSmoke(args, env = {}) {
  const output = execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs", ...args], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      OPENREAPER_E3_MEDIA_ROUTE_LIVE_SMOKE: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      ...env,
    },
  }).trim();
  return JSON.parse(output);
}

function runMediaRouteSmokeExpectingFailure(args, env = {}) {
  try {
    return runMediaRouteSmoke(args, env);
  } catch (error) {
    assert.equal(error.status, 2);
    const report = JSON.parse(String(error.stdout));
    assert.equal(report.ok, false);
    return report;
  }
}

function itemRouteInput(id) {
  if (id === "template.items.copy_item_to_track") {
    return { position_seconds: 5 };
  }
  if (id === "template.items.split_item_at_time") {
    return { position_seconds: 2 };
  }
  if (id === "template.items.set_take_playrate") {
    return { playrate: 0.75, preserve_pitch: true };
  }
  return {};
}

function itemRouteRefs(id) {
  const itemRef = createObjectRef("item", { scheme: "guid", value: "{E4-SOURCE-ITEM}" }, {
    ref: "item:guid:{E4-SOURCE-ITEM}",
  });
  const trackRef = createObjectRef("track", { scheme: "guid", value: "{E4-TARGET-TRACK}" }, {
    ref: "track:guid:{E4-TARGET-TRACK}",
  });
  if (id === "template.items.copy_item_to_track") {
    return {
      source_item_ref: itemRef,
      target_track_ref: trackRef,
    };
  }
  if (id === "template.items.split_item_at_time" || id === "template.items.set_take_playrate") {
    return {
      item_ref: itemRef,
    };
  }
  return {};
}

function runItemRouteSmoke(args, env = {}) {
  const output = execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs", ...args], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      OPENREAPER_E4_ITEM_ROUTE_LIVE_SMOKE: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      ...env,
    },
  }).trim();
  return JSON.parse(output);
}

function runItemRouteSmokeExpectingFailure(args, env = {}) {
  try {
    return runItemRouteSmoke(args, env);
  } catch (error) {
    assert.equal(error.status, 2);
    const report = JSON.parse(String(error.stdout));
    assert.equal(report.ok, false);
    return report;
  }
}

function e5RouteInput(id) {
  const inputs = {
    "template.routing.read_track_routing": { include_receives: true, include_master_parent: true, max_routes: 32 },
    "template.routing.resolve_send_ref": { send_ref: "send:track:0:0" },
    "template.routing.create_track_send": { duplicate_policy: "reject_existing" },
    "template.routing.set_send_volume": { volume: 1 },
    "template.routing.set_send_pan": { pan: 0 },
    "template.routing.set_send_mute": { muted: false },
    "template.routing.set_send_mode": { mode: "post_fader" },
    "template.routing.set_master_parent_send": { enabled: true },
    "template.routing.set_track_channel_count": { channel_count: 4 },
    "template.routing.list_track_hardware_outputs": { include_disabled: true, max_outputs: 16 },
    "template.routing.set_track_hardware_output": {
      output_index: 0,
      source_channel_offset: 0,
      source_channel_count: 2,
      mix_to_mono: false,
    },
    "template.routing.remove_track_hardware_output": { output_index: 0, missing_policy: "ok" },
    "template.routing.read_project_routing_graph": { include_master_parent: true, max_tracks: 16, max_edges: 64 },
    "template.routing.set_send_audio_channels": {
      source_channel_offset: 0,
      source_channel_count: 2,
      destination_channel_offset: 0,
      mix_to_mono: false,
    },
    "template.routing.set_send_phase": { phase_inverted: false },
    "template.routing.set_send_mono": { mono: false },
    "template.routing.set_send_midi_channels": { source_channel: "all", destination_channel: "original" },
    "template.routing.read_fx_pin_mapping": { direction: "input", pin_index: 0 },
    "template.routing.list_available_audio_outputs": { include_unavailable: false, max_outputs: 32 },
    "template.automation.resolve_envelope_ref": { parent_kind: "track", envelope_name: "Volume" },
    "template.automation.read_envelope_points": { limit: 16 },
    "template.automation.evaluate_envelope_at_time": { time_seconds: 1 },
    "template.automation.set_envelope_lane_state": { active: true, visible: true, show_lane: true, armed: false },
    "template.automation.insert_envelope_point": { time_seconds: 1, value: 0.75, shape: 0, tension: 0, selected: false },
    "template.automation.set_track_automation_mode": { mode: "read" },
    "template.automation.set_envelope_point": { point_index: 0, time_seconds: 1, value: 0.75, shape: 0, tension: 0, selected: false },
    "template.automation.insert_envelope_points_batch": {
      points: [
        { time_seconds: 1, value: 0.75, shape: 0, tension: 0, selected: false },
        { time_seconds: 2, value: 0.85, shape: 0, tension: 0, selected: false },
      ],
    },
    "template.automation.set_send_automation_mode": { mode: "use_track" },
    "template.automation.create_automation_item": { position_seconds: 1, length_seconds: 2, pool_mode: "new_empty" },
    "template.automation.set_automation_item_bounds": { automation_item_index: 0, position_seconds: 1, length_seconds: 2 },
    "template.automation.resolve_send_envelope": { envelope_type: "volume" },
    "template.automation.insert_fx_parameter_envelope_points": {
      param_index: 0,
      points: [
        { time_seconds: 0, value: 0.2, shape: 0, tension: 0 },
        { time_seconds: 1, value: 0.8, shape: 0, tension: 0 },
      ],
    },
    "template.automation.insert_sine_wave_points": {
      start_seconds: 0,
      end_seconds: 2,
      center_value: 0.5,
      amplitude: 0.25,
      cycles: 1,
      point_count: 9,
    },
  };
  return inputs[id] ?? {};
}

function e5RouteRefs(id) {
  const trackRef = createObjectRef("track", { scheme: "guid", value: "{E5-SOURCE-TRACK}" }, {
    ref: "track:guid:{E5-SOURCE-TRACK}",
  });
  const destinationTrackRef = createObjectRef("track", { scheme: "guid", value: "{E5-DESTINATION-TRACK}" }, {
    ref: "track:guid:{E5-DESTINATION-TRACK}",
  });
  const sendRef = createObjectRef("send", { scheme: "track", value: "0:0" }, {
    ref: "send:track:0:0",
  });
  const fxRef = createObjectRef("fx", { scheme: "track", value: "0" }, {
    ref: "fx:track:0",
  });
  const envelopeRef = createObjectRef("envelope", { scheme: "track", value: "volume" }, {
    ref: "envelope:track:volume",
  });

  if (id === "template.routing.create_track_send") {
    return { source_track_ref: trackRef, destination_track_ref: destinationTrackRef };
  }
  if (id === "template.routing.read_track_routing"
    || id === "template.routing.list_track_hardware_outputs"
    || id === "template.routing.set_track_hardware_output"
    || id === "template.routing.remove_track_hardware_output"
    || id === "template.routing.set_master_parent_send"
    || id === "template.routing.set_track_channel_count"
    || id === "template.automation.set_track_automation_mode"
    || id === "template.automation.read_track_automation_mode"
    || id === "template.automation.resolve_envelope_ref") {
    return { track_ref: trackRef };
  }
  if (id === "template.routing.read_fx_pin_mapping") {
    return { track_ref: trackRef, fx_ref: fxRef };
  }
  if (id === "template.automation.insert_fx_parameter_envelope_points") {
    return { fx_ref: fxRef, envelope_ref: envelopeRef };
  }
  if (id.startsWith("template.routing.set_send_")
    || id === "template.routing.set_send_volume"
    || id === "template.routing.set_send_pan"
    || id === "template.routing.set_send_mute"
    || id === "template.routing.set_send_mode"
    || id === "template.automation.set_send_automation_mode"
    || id === "template.automation.resolve_send_envelope") {
    return { send_ref: sendRef };
  }
  if (id.startsWith("template.automation.")
    && id !== "template.automation.resolve_envelope_ref"
    && id !== "template.automation.set_track_automation_mode"
    && id !== "template.automation.read_track_automation_mode"
    && id !== "template.automation.resolve_send_envelope"
    && id !== "template.automation.set_send_automation_mode") {
    return { envelope_ref: envelopeRef };
  }
  return {};
}

function e5RouteIdempotencyKey(id) {
  return [
    "template.routing.set_send_volume",
    "template.routing.set_send_pan",
    "template.routing.set_send_mute",
    "template.routing.set_send_mode",
    "template.routing.set_master_parent_send",
    "template.routing.set_track_channel_count",
    "template.routing.set_track_hardware_output",
    "template.routing.remove_track_hardware_output",
    "template.routing.set_send_audio_channels",
    "template.routing.set_send_phase",
    "template.routing.set_send_mono",
    "template.routing.set_send_midi_channels",
    "template.automation.set_envelope_lane_state",
    "template.automation.set_track_automation_mode",
    "template.automation.set_envelope_point",
    "template.automation.set_send_automation_mode",
    "template.automation.set_automation_item_bounds",
  ].includes(id) ? `e5-routing-automation:${id}` : undefined;
}

function runE5RouteSmoke(args, env = {}) {
  const output = execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs", ...args], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      OPENREAPER_E5_ROUTING_AUTOMATION_LIVE_SMOKE: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      ...env,
    },
  }).trim();
  return JSON.parse(output);
}

function runE5RouteSmokeExpectingFailure(args, env = {}) {
  try {
    return runE5RouteSmoke(args, env);
  } catch (error) {
    assert.equal(error.status, 2);
    const report = JSON.parse(String(error.stdout));
    assert.equal(report.ok, false);
    return report;
  }
}

function sampleArtifactId(index, refIndex) {
  return `art_20260703000000000_${String((index % 999) + 1).padStart(3, "0")}_${String(refIndex).padStart(6, "0")}`;
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

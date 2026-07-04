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
  CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE,
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
  CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Layer 4D call_template runtime binding", () => {
  it("binds only the accepted Wave 1A, Wave 2A, Wave 3B, critical-fill, and P1 official catalog", () => {
    const catalog = createAcceptedOfficialTemplateCatalog();

    assert.equal(catalog.size, 129);
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
      evidenceLimit: 200,
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

  it("keeps discovery compact and does not add a sixth MCP tool", () => {
    const runtime = createCallTemplateRuntime({ executor: new FakeFoundationBridge() });
    const directDiscovery = createAcceptedOfficialTemplateDiscovery();

    const runtimeMenu = runtime.list_templates();
    assert.deepEqual(runtimeMenu, directDiscovery.list_templates());
    assert.equal(runtimeMenu.contract, "discovery.menu.v1");
    assert.equal(runtimeMenu.kind, "template_menu");
    assert.equal(runtimeMenu.mode, "menu");
    assert.equal(runtimeMenu.items.length, 25);
    assert.equal(runtimeMenu.page.has_more, true);
    assert.equal("total" in runtimeMenu.page, false);

    const menuPayload = JSON.stringify(runtimeMenu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(menuPayload, new RegExp(field));
    }

    const exact = runtime.list_templates({
      ids: ["template.tracks.create_track"],
      fields: ["summary", "inputSchema", "expectedDelta"],
    });
    assert.deepEqual(Object.keys(exact.items[0]).sort(), [
      "expectedDelta",
      "id",
      "inputSchema",
      "summary",
    ]);
    assert.equal("bridge" in exact.items[0], false);
    assert.equal("refs" in exact.items[0], false);
    assert.equal("artifacts" in exact.items[0], false);

    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 5);
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

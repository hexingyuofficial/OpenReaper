import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  createAcceptedOfficialTemplateCatalog,
  createAcceptedOfficialTemplateDiscovery,
  CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE,
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
  CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Layer 4D call_template runtime binding", () => {
  it("binds only the accepted Wave 1A, Wave 2A, Wave 3B, and critical-fill official catalog", () => {
    const catalog = createAcceptedOfficialTemplateCatalog();

    assert.equal(catalog.size, 123);
    assert.deepEqual(catalog.ids, CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ACCEPTED_CATALOG_SOURCE.waves, [
      "wave1a",
      "wave2a",
      "wave3b",
      "critical_fill",
    ]);

    assert.equal(catalog.get("template.tracks.create_track") !== null, true);
    assert.equal(catalog.get("template.render.render_region_wav") !== null, true);
    assert.equal(catalog.get("template.analysis.detect_loop_candidates") !== null, true);
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

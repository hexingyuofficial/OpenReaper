import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");

const WAVE1A_OPERATION_NAMES = Object.freeze([
  "template_catalog.read_summary",
  "last_result.read",
  "system.api_symbols.check",
  "project.read_metadata",
  "project.list_markers_regions",
  "project.read_tempo_map",
  "track.resolve_ref",
  "items.resolve_item_ref",
  "items.read_item_summary",
]);

const EXPECTED_LUA_OPERATIONS = Object.freeze([
  "items.read_item_summary",
  "items.resolve_item_ref",
  "last_result.read",
  "openreaper.read_status",
  "project.list_markers_regions",
  "project.read_metadata",
  "project.read_summary",
  "project.read_tempo_map",
  "system.api_symbols.check",
  "system.resource_paths.read",
  "system.runtime_environment.read",
  "template_catalog.read_summary",
  "track.resolve_ref",
  "transport.read_state",
].sort());

describe("4D.x Wave 1A read-handler expansion", () => {
  it("keeps Wave 0 available while adding only the nine Wave 1A live ids", () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS, [
      "template.project.read_summary",
      "template.transport.read_state",
      "template.core.read_openreaper_status",
      "template.system.read_runtime_environment",
      "template.system.read_resource_paths",
    ]);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS, [
      "template.core.read_template_catalog_summary",
      "template.core.read_last_result",
      "template.system.check_api_symbols",
      "template.project.read_metadata",
      "template.project.list_markers_regions",
      "template.project.read_tempo_map",
      "template.tracks.resolve_track_ref",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
    ]);
    assert.equal(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.length, 119);
    assert.equal(CALL_TEMPLATE_RUNTIME_LIVE_TEMPLATE_IDS.length, 14);
  });

  it("routes each Wave 1A template through the fake bridge as read-only query_state", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        opt_in_env: "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE",
        opt_in_flag: "--live",
      },
      evidenceLimit: 20,
    });

    const inputs = exampleInputs(runtime);
    for (const [index, id] of CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: inputs[id] ?? {},
        refs: exampleRefs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(bridge.seen.map((request) => request.operation.name), WAVE1A_OPERATION_NAMES);
    assert.equal(bridge.seen.length, 9);
    for (const request of bridge.seen) {
      assert.equal(request.operation.family, "query_state");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
    }

    const evidence = runtime.evidence();
    assert.equal(evidence.length, 9);
    assert.equal(evidence.every((entry) => entry.live.spawned_reaper === false), true);
    assert.deepEqual(evidence[0].live.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
  });

  it("does not broaden Wave 1A live execution to Wave 0, writes, actions, or all 119 ids", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
          "template.tracks.create_track",
          "not-a-template-id",
        ],
      },
    });

    assert.deepEqual(runtime.live_gate.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);

    for (const id of [
      "template.project.read_summary",
      "template.tracks.create_track",
      "template.actions.resolve_named_command",
      "template.actions.read_action_metadata",
    ]) {
      const response = await runtime.call_template({
        id,
        input: {},
        refs: [],
        context: context(),
      });
      assert.equal(response.ok, false, id);
      assert.equal(response.error.code, "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED", id);
    }
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps the Lua bridge allowlist exact, typed, bounded, and non-spawning", () => {
    const operationKeys = [...BRIDGE_SOURCE.matchAll(/\["query_state:([^"]+)"\]\s*=/g)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(operationKeys, EXPECTED_LUA_OPERATIONS);

    const handlerMappings = {
      "template_catalog.read_summary": "read_template_catalog_summary",
      "last_result.read": "read_last_result",
      "system.api_symbols.check": "read_api_symbols",
      "project.read_metadata": "read_project_metadata",
      "project.list_markers_regions": "list_markers_regions",
      "project.read_tempo_map": "read_tempo_map",
      "track.resolve_ref": "resolve_track_ref",
      "items.resolve_item_ref": "resolve_item_ref",
      "items.read_item_summary": "read_item_summary",
    };
    for (const [operation, handler] of Object.entries(handlerMappings)) {
      assert.match(
        BRIDGE_SOURCE,
        new RegExp(`\\["query_state:${escapeRegExp(operation)}"\\]\\s*=\\s*\\{[\\s\\S]*?handler\\s*=\\s*${handler}`),
        operation,
      );
    }

    for (const code of [
      "REQUEST_INVALID",
      "OPERATION_NOT_FOUND",
      "BRIDGE_OWNER_MISMATCH",
      "BRIDGE_GENERATION_MISMATCH",
      "RESPONSE_TOO_LARGE",
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`"${code}"`), code);
    }
    assert.match(BRIDGE_SOURCE, /Bridge request JSON is malformed/);
    assert.match(BRIDGE_SOURCE, /#encoded > budget\.max_response_bytes/);
    assert.match(BRIDGE_SOURCE, /bounded_limit/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_command|run_action|run_job|artifact_metadata):/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(Main_OnCommand|NamedCommandLookup|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /open -a/);
  });

  it("keeps default live smoke skipped and --live without config non-spawning", async () => {
    const skipped = JSON.parse(
      execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
          [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        },
      }).trim(),
    );
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.wave, "wave1a-read-handlers");
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.equal(skipped.spawned_reaper, false);

    const noExecutor = runLiveSmokeExpectingFailure({
      OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.spawned_reaper, false);
    assert.deepEqual(noExecutor.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.equal("attempted_template_ids" in noExecutor, false);

    const missingTransport = runLiveSmokeExpectingFailure({
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: join(await mkdtemp(join(tmpdir(), "openreaper-live-wave1a-")), "missing"),
      OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "20",
    });
    assert.equal(missingTransport.reason, "live_bridge_transport_absent");
    assert.deepEqual(missingTransport.attempted_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.equal(missingTransport.executions.length, 9);
    assert.equal(missingTransport.spawned_reaper, false);
  });
});

function exampleInputs(runtime) {
  const menu = runtime.list_templates({
    ids: CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
    fields: ["examples"],
  });
  return Object.fromEntries(
    menu.items.map((item) => [item.id, cloneJson(item.examples?.[0]?.input ?? {})]),
  );
}

function exampleRefs(id) {
  if (id !== "template.items.read_item_summary") return [];
  return {
    item_ref: createObjectRef("item", { scheme: "selected", value: "0" }, { ref: "item:selected:0" }),
  };
}

function runLiveSmokeExpectingFailure(env) {
  try {
    execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs", "--live"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected live smoke script to exit with status 2.");
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

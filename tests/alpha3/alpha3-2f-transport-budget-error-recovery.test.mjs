import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_FAILURE_LAYERS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  createLiveBridgeExecutor,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

describe("Alpha3.2-F transport, budget, and error recovery", () => {
  it("classifies server validation failures and returns safe retry guidance", async () => {
    const result = await createCallTemplateRuntime().call_template({
      id: "template.project.read_summary",
      input: {},
      unsupported_field: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.recoverable, true);
    assert.equal(result.error.failure_layer, "server_validation");
    assert.equal(result.error.recommended_next_action.tool, "call_template");
    assert.match(result.error.copy_paste_safe_guidance, /OpenReaper MCP recovery/);
    assert.match(result.error.copy_paste_safe_guidance, /raw bridge/);
  });

  it("classifies configured transport absence at both executor and call_template surfaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "openreaper-alpha32f-transport-"));
    try {
      const executor = createLiveBridgeExecutor({
        transportDir: join(root, "missing-transport"),
      });
      const direct = await executor.dispatch({
        id: "cmd_alpha32f_transport",
        bridge: { expected_owner: "owner-test", expected_generation: 1 },
        budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 },
      });
      assert.equal(direct.error.failure_layer, "transport_write");
      assert.equal(direct.error.recommended_next_action.tool, "ping");

      const result = await createCallTemplateRuntime({
        live: {
          opted_in: true,
          executor,
          allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
        },
      }).call_template({
        id: "template.project.read_summary",
        input: {},
        context: context(),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.recoverable, true);
      assert.equal(result.error.details.blocker, "live_bridge_transport_absent");
      assert.equal(result.error.failure_layer, "transport_write");
      assert.equal(result.error.recommended_next_action.tool, "ping");
      assert.match(result.error.copy_paste_safe_guidance, /do not open transport files/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("distinguishes bridge timeout from an invalid bridge response", async () => {
    const root = await mkdtemp(join(tmpdir(), "openreaper-alpha32f-timeout-"));
    try {
      await mkdir(join(root, "requests"));
      await mkdir(join(root, "results"));
      const scriptPath = join(root, "bridge.lua");
      await writeFile(scriptPath, "-- test-only bridge marker\n");
      const timeoutExecutor = createLiveBridgeExecutor({
        transportDir: root,
        bridgeScriptPath: scriptPath,
        timeoutMs: 10,
        pollIntervalMs: 1,
      });
      const timeout = await createCallTemplateRuntime({
        live: {
          opted_in: true,
          executor: timeoutExecutor,
          allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
        },
      }).call_template({
        id: "template.project.read_summary",
        input: {},
        context: context(),
      });
      assert.equal(timeout.error.code, "BRIDGE_TIMEOUT");
      assert.equal(timeout.error.failure_layer, "bridge_timeout");
      assert.equal(timeout.error.recommended_next_action.code, "inspect_before_retry");

      const invalidResponse = await createCallTemplateRuntime({
        executor: async () => ({ contract: "not-found" }),
      }).call_template({
        id: "template.project.read_summary",
        input: {},
        context: context(),
      });
      assert.equal(invalidResponse.error.code, "BRIDGE_RESULT_INVALID");
      assert.equal(invalidResponse.error.failure_layer, "bridge_response");
      assert.equal(invalidResponse.error.recommended_next_action.code, "reconnect_managed_session");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed under response budget pressure with a compact typed error", async () => {
    const bridge = new FakeFoundationBridge();
    const result = await createCallTemplateRuntime({
      executor: (request) => bridge.okEnvelope(
        request,
        "2026-07-11T00:00:00.000Z",
        { summary: { inline_payload: "x".repeat(2_000) } },
      ),
    }).call_template({
      id: "template.project.read_summary",
      input: {},
      context: context(),
      budget: {
        max_response_bytes: 800,
        max_items: 10,
        max_inline_value_bytes: 4_096,
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(result.error.failure_layer, "response_budget");
    assert.equal(result.error.recoverable, true);
    assert.equal(result.error.recommended_next_action, "Call call_template again with budget.max_items=10 and budget.max_inline_value_bytes=512.");
    assert.equal(result.budget.truncated, true);
    assert.equal(result.budget.response_bytes <= result.budget.max_response_bytes, true);
    assert.equal(JSON.stringify(result).includes("x".repeat(100)), false);
  });

  it("keeps the failure-layer vocabulary bounded and the public tool count unchanged", () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_FAILURE_LAYERS, [
      "server_validation",
      "transport_write",
      "bridge_timeout",
      "bridge_response",
      "response_budget",
    ]);
    const source = createCallTemplateRuntime().list_templates({ surface: "executable", limit: 500 });
    assert.equal(source.items.some((item) => item.id === "call_recipe"), false);
    assert.equal(source.items.some((item) => item.id === "run_lua"), false);
    assert.equal(source.items.some((item) => item.id === "run_action"), false);
  });
});

function context() {
  return {
    session_id: "alpha32f-test-session",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-11T00:00:00.000Z",
    request_sequence: 1,
  };
}

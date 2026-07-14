import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ALPHA3_2E_PROJECT_INSPECT_MACRO_CONTRACT,
  ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
  createAlpha3_2EProjectInspectMacroDiscoveryItems,
  createAlpha3_2EProjectInspectMacroRuntimeEnvelope,
  planAlpha3_2EProjectInspectMacro,
} from "../../packages/mcp-server/src/alpha3-2e-small-macro-spine-v1.mjs";
import { callTemplate, createCallTemplateRuntime } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS } from "../../packages/mcp-server/src/alpha3-2a-agent-context-macro-guide-v1.mjs";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;
const STDIO_SERVER = new URL("../../packages/mcp-server/src/openreaper-mcp-stdio.mjs", import.meta.url).pathname;
const EXPECTED_TOOLS = ["call_template", "get_state", "list_recipes", "list_templates", "ping"];

describe("Alpha3.2-E small macro spine: project inspect", () => {
  it("publishes the complete small Macro spine as registered executable programs", () => {
    assert.equal(ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS.includes("macro.project.inspect"), false);
    assert.equal(ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS.includes("macro.project.delete_targets"), false);
    assert.equal(ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS.includes("macro.project.apply_layout"), false);
    assert.equal(ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS.includes("macro.routing.apply"), false);
    assert.equal(ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS.includes("macro.media.place_assets"), false);
    assert.equal(ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS.includes("macro.render.targets"), false);

    const runtime = createCallTemplateRuntime();
    const exact = runtime.list_templates({
      ids: ["macro.project.inspect", "macro.project.delete_targets", "macro.project.apply_layout", "macro.routing.apply", "macro.media.place_assets", "macro.render.targets"],
      fields: ["id", "capability_truth"],
    });
    assert.deepEqual(exact.items.map((item) => item.id), ["macro.project.inspect", "macro.project.delete_targets", "macro.project.apply_layout", "macro.routing.apply", "macro.media.place_assets", "macro.render.targets"]);
    assert.equal(exact.items[0].support_status, "executable_runtime_bound");
    assert.equal(exact.items[0].capability_truth.support_state, "supported");
    assert.equal(exact.items[0].execution_shape, "registered_macro_program");
    assert.match(exact.items[0].capability_truth.known_blocker, /live_executor_not_configured/);
    assert.equal(exact.items[1].support_status, "executable_runtime_bound_confirmation_gated");
    assert.equal(exact.items[1].capability_truth.support_state, "supported_with_confirmation");
    assert.equal(exact.items[2].support_status, "executable_runtime_bound");
    assert.equal(exact.items[2].capability_truth.support_state, "supported_with_readback");
    assert.equal(exact.items[3].support_status, "executable_runtime_bound");
    assert.equal(exact.items[3].capability_truth.support_state, "supported_with_readback");
    assert.equal(exact.items[4].support_status, "executable_runtime_bound");
    assert.equal(exact.items[4].capability_truth.support_state, "supported_with_exact_live_readback");
    assert.equal(exact.items[5].support_status, "executable_runtime_bound");
    assert.equal(exact.items[5].capability_truth.support_state, "supported_with_readback");
  });

  it("plans a bounded read-only inspect flow over accepted reads and macro.project.query", () => {
    const plan = planAlpha3_2EProjectInspectMacro({
      include: ["project_path", "dirty_state", "selected_context", "tracks", "render"],
      fields: ["ref", "name"],
      limit: 25,
      refresh_policy: "if_stale",
      ref_policy: "canonical_only",
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.contract, ALPHA3_2E_PROJECT_INSPECT_MACRO_CONTRACT);
    assert.equal(plan.id, ALPHA3_2E_PROJECT_INSPECT_MACRO_ID);
    assert.equal(plan.mode, "plan_only_agent_executed_child_requests");
    assert.equal(plan.mutation_requests.length, 0);
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.public_call_recipe, false);
    assert.equal(plan.safety.raw_action_lua_shell_ui, false);
    assert.deepEqual(plan.child_requests.map((request) => request.id), [
      "template.project.read_current_project_path",
      "template.project.read_dirty_state",
      "macro.project.query",
      "macro.project.query",
      "template.render.read_settings",
    ]);
    const queryInputs = plan.child_requests.filter((request) => request.id === "macro.project.query").map((request) => request.input);
    assert.deepEqual(queryInputs.map((input) => input.entity), ["selected_context", "tracks"]);
    assert.equal(queryInputs.every((input) => input.refresh_policy === "if_stale"), true);
    assert.equal(queryInputs.every((input) => input.limit === 25), true);
    assert.equal(queryInputs.every((input) => input.hydrate_refs === true), true);
  });

  it("fails closed for unsafe input, refs, and idempotency without emitting child requests", () => {
    const invalid = planAlpha3_2EProjectInspectMacro({ include: ["project_path", "unknown"], limit: 999, fields: ["ok", "bad\nfield"] }, {
      refs_provided: true,
      idempotency_key_present: true,
    });
    assert.equal(invalid.ok, false);
    assert.deepEqual(invalid.child_requests, []);
    assert.equal(invalid.blockers.some((blocker) => blocker.code === "PROJECT_INSPECT_REFS_UNSUPPORTED"), true);
    assert.equal(invalid.blockers.some((blocker) => blocker.code === "PROJECT_INSPECT_IDEMPOTENCY_KEY_UNSUPPORTED"), true);
    assert.equal(invalid.blockers.some((blocker) => blocker.code === "PROJECT_INSPECT_INCLUDE_UNSUPPORTED"), true);
    assert.equal(invalid.blockers.some((blocker) => blocker.code === "PROJECT_INSPECT_LIMIT_INVALID"), true);
    assert.equal(invalid.blockers.some((blocker) => blocker.code === "PROJECT_INSPECT_FIELD_INVALID"), true);
  });

  it("fails closed when the executable inspect Macro has no configured live read route", async () => {
    const response = await callTemplate({ id: "macro.project.inspect", input: { include: ["project_path", "dirty_state"] } });
    assert.equal(response.ok, false);
    assert.equal(response.contract, "macro.execution.v1");
    assert.equal(response.macro.id, "macro.project.inspect");
    assert.equal(response.execution.status, "blocked");
    assert.equal(response.error.code, "PROJECT_INSPECT_LIVE_READ_UNAVAILABLE");
  });

  it("keeps actual stdio at five tools and reports executable inspect as blocked until live readiness", { timeout: 30_000 }, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: REPO_ROOT,
      env: sanitizedServerEnv(),
      stderr: "pipe",
    });
    const client = new Client({ name: "alpha3-2e-inspect", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), EXPECTED_TOOLS.sort());
      const inspectResult = parseToolJson(await client.callTool({
        name: "call_template",
        arguments: { id: "macro.project.inspect", input: { include: ["project_path", "dirty_state"] } },
      }));
      const deletePreview = parseToolJson(await client.callTool({
        name: "call_template",
        arguments: { id: "macro.project.delete_targets", input: { refs: { items: ["item:guid:{ITEM-A}"] }, dry_run: true } },
      }));
      const layoutPreview = parseToolJson(await client.callTool({
        name: "call_template",
        arguments: { id: "macro.project.apply_layout", input: { layout: [{ id: "fx", kind: "track", name: "FX" }], dry_run: true } },
      }));
      const routingPreview = parseToolJson(await client.callTool({
        name: "call_template",
        arguments: { id: "macro.routing.apply", input: { routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }], dry_run: true } },
      }));
      const mediaPreview = parseToolJson(await client.callTool({
        name: "call_template",
        arguments: { id: "macro.media.place_assets", input: { assets: [{ id: "one", path: "/Users/Shared/OpenReaper/one.wav", track_ref: "track:guid:{TRK}", position_seconds: 0 }], dry_run: true } },
      }));
      const renderPreview = parseToolJson(await client.callTool({
        name: "call_template",
        arguments: { id: "macro.render.targets", input: { target_kind: "whole_project", format: "wav", dry_run: true } },
      }));
      assert.equal(inspectResult.ok, false);
      assert.equal(inspectResult.contract, "macro.execution.v1");
      assert.equal(inspectResult.execution.status, "blocked");
      assert.equal(inspectResult.error.code, "PROJECT_INSPECT_LIVE_READ_UNAVAILABLE");
      for (const result of [deletePreview, layoutPreview, routingPreview]) {
        assert.equal(result.ok, false);
        assert.equal(result.contract, "macro.execution.v1");
        assert.equal(result.execution.status, "blocked");
        assert.equal(result.error.code, "PROJECT_WRITE_EXECUTOR_UNAVAILABLE");
      }
      assert.equal(mediaPreview.ok, false);
      assert.equal(mediaPreview.contract, "macro.execution.v1");
      assert.equal(mediaPreview.execution.status, "blocked");
      assert.equal(mediaPreview.error.code, "MEDIA_LIVE_EXECUTOR_REQUIRED");
      assert.equal(renderPreview.ok, false);
      assert.equal(renderPreview.contract, "macro.execution.v1");
      assert.equal(renderPreview.execution.status, "blocked");
      assert.equal(renderPreview.error.code, "RENDER_MANAGED_ROOT_UNAVAILABLE");
    } finally {
      await client.close();
    }
  });
});

function parseToolJson(result) {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
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

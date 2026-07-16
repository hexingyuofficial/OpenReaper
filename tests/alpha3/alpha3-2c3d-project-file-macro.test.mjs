import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT,
  ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
  planAlpha3_2C3DProjectFileMacro,
} from "../../packages/mcp-server/src/alpha3-2c3d-project-file-macro-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STDIO_SERVER = path.join(REPO_ROOT, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const EXPECTED_CHILD_IDS = {
  save_current: [
    "template.project.read_current_project_path",
    "template.project.read_dirty_state",
    "template.project.save_current_project",
    "template.project.read_current_project_path",
    "template.project.read_dirty_state",
  ],
  save_as: [
    "template.project.read_current_project_path",
    "template.project.read_dirty_state",
    "template.project.save_project_as",
    "template.project.read_current_project_path",
    "template.project.read_dirty_state",
  ],
};

function childIds(plan) {
  return plan.child_requests.map((request) => request.call_template.id);
}

describe("Alpha3.2-C3D macro.project.file plan-only runtime", () => {
  it("plans save_current in exact serial order with a saved-project dependency gate and exact readback", () => {
    const plan = planAlpha3_2C3DProjectFileMacro({ operation: "save_current" });

    assert.equal(plan.ok, true);
    assert.deepEqual(childIds(plan), EXPECTED_CHILD_IDS.save_current);
    assert.deepEqual(plan.child_requests.map((request) => request.sequence), [1, 2, 3, 4, 5]);
    assert.deepEqual(plan.child_requests.map((request) => request.phase), ["preflight", "preflight", "mutation", "postflight", "postflight"]);
    assert.equal(plan.preflight_requests.length, 2);
    assert.equal(plan.mutation_requests.length, 1);
    assert.equal(plan.readback_requests.length, 2);
    assert.deepEqual(plan.mutation_requests[0].call_template.input, {});
    assert.match(plan.mutation_requests[0].execute_if.all.join(" "), /saved_project=true/);
    assert.match(plan.mutation_requests[0].execute_if.otherwise, /do not execute any mutation/);
    assert.match(plan.success_criteria.path, /preflight project path byte-for-byte/);
    assert.match(plan.success_criteria.dirty_state, /raw dirty value exactly 0/);
    assert.deepEqual(plan.typed_blockers, []);
    assert.equal(plan.no_executor_safety_posture.server_executes_children, false);
  });

  it("plans save_as in exact serial order and forwards only exact target_path plus overwrite=true", () => {
    const targetPath = "/tmp/openreaper-c3d/example.RPP";
    const plan = planAlpha3_2C3DProjectFileMacro({
      operation: "save_as",
      target_path: targetPath,
      overwrite: true,
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(childIds(plan), EXPECTED_CHILD_IDS.save_as);
    assert.deepEqual(plan.mutation_requests[0].call_template.input, {
      target_path: targetPath,
      overwrite: true,
    });
    assert.match(plan.mutation_requests[0].execute_if.all.join(" "), /saved_project=true/);
    assert.match(plan.mutation_requests[0].execute_if.all.join(" "), /overwrite remains explicitly true/);
    assert.match(plan.success_criteria.path, /input\.target_path byte-for-byte/);
    assert.equal(plan.safety.atomic_filesystem_safety_owner, "template.project.save_project_as");
    assert.equal(plan.safety.wrapper_revalidates_or_weakens_atomic_filesystem_safety, false);
  });

  it("returns typed zero-mutation blockers for invalid operation-specific inputs", () => {
    const cases = [
      [{ operation: "save_as", overwrite: true }, "SAVE_AS_TARGET_PATH_REQUIRED"],
      [{ operation: "save_as", target_path: "/tmp/demo.RPP" }, "SAVE_AS_OVERWRITE_TRUE_REQUIRED"],
      [{ operation: "save_as", target_path: "/tmp/demo.RPP", overwrite: false }, "SAVE_AS_OVERWRITE_TRUE_REQUIRED"],
      [{ operation: "save_current", target_path: "/tmp/demo.RPP" }, "SAVE_CURRENT_FIELDS_REJECTED"],
      [{ operation: "save_current", overwrite: true }, "SAVE_CURRENT_FIELDS_REJECTED"],
      [{ operation: "new" }, "PROJECT_FILE_OPERATION_HELD"],
      [{ operation: "create" }, "PROJECT_FILE_OPERATION_HELD"],
      [{ operation: "open" }, "PROJECT_FILE_OPERATION_HELD"],
      [{ operation: "rename" }, "PROJECT_FILE_OPERATION_UNSUPPORTED"],
    ];

    for (const [input, code] of cases) {
      const plan = planAlpha3_2C3DProjectFileMacro(input);
      assert.equal(plan.ok, false, JSON.stringify(input));
      assert.equal(plan.blockers.some((entry) => entry.code === code), true, JSON.stringify(input));
      assert.deepEqual(plan.typed_blockers, plan.blockers);
      assert.equal(plan.mutation_requests.length, 0, JSON.stringify(input));
      assert.equal(plan.child_requests.length, 0, JSON.stringify(input));
      assert.match(plan.agent_execution_flow.dependency_gate, /no mutation request exists/);
    }
  });

  it("bounds amplification pressure from long inputs, unknown fields, refs, and idempotency", async () => {
    let executorCalls = 0;
    const executor = async () => {
      executorCalls += 1;
      throw new Error("pressure cases must not call executor");
    };
    const runtime = createCallTemplateRuntime({
      executor,
      live: {
        opted_in: true,
        executor,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const unknownFields = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`unknown_${index}_${"x".repeat(160)}`, "ignored"]),
    );
    const largeRefs = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => [`ref_${index}`, `REF_SECRET_${index}_${"r".repeat(2_000)}`]),
    );
    const longIdempotency = `IDEMPOTENCY_SECRET_${"k".repeat(20_000)}`;
    const cases = [
      {
        request: { input: { operation: "x".repeat(65) } },
        codes: ["PROJECT_FILE_OPERATION_TOO_LONG"],
      },
      {
        request: { input: { operation: "save_current\u0000hidden" } },
        codes: ["PROJECT_FILE_OPERATION_CONTROL_CHARACTER"],
      },
      {
        request: { input: { operation: "save_as", target_path: `/${"p".repeat(2_048)}`, overwrite: true } },
        codes: ["SAVE_AS_TARGET_PATH_TOO_LONG"],
      },
      {
        request: { input: { operation: "save_as", target_path: "/tmp/demo\u0000hidden.RPP", overwrite: true } },
        codes: ["SAVE_AS_TARGET_PATH_CONTROL_CHARACTER"],
      },
      {
        request: { input: { operation: "save_current", ...unknownFields } },
        codes: ["PROJECT_FILE_INPUT_FIELDS_UNSUPPORTED"],
      },
      {
        request: {
          input: { operation: "save_current" },
          refs: largeRefs,
          idempotency_key: longIdempotency,
        },
        codes: ["PROJECT_FILE_REFS_UNSUPPORTED", "PROJECT_FILE_IDEMPOTENCY_KEY_UNSUPPORTED"],
      },
    ];

    for (const testCase of cases) {
      const result = await runtime.call_template({
        id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
        ...testCase.request,
      });
      const serialized = JSON.stringify(result);
      const codes = result.blockers.map((entry) => entry.code);
      assert.equal(result.ok, false);
      for (const code of testCase.codes) assert.equal(codes.includes(code), true, code);
      assert.equal(result.contract, "macro.execution.v1");
      assert.equal(result.result.changes.length, 0);
      assert.equal(result.execution.stage_count, 0);
      assert.equal(Buffer.byteLength(serialized) < 32_768, true, `${Buffer.byteLength(serialized)}`);
      assert.equal(serialized.includes("REF_SECRET_399"), false);
      assert.equal(serialized.includes("IDEMPOTENCY_SECRET_"), false);
    }

    const unknownResult = await runtime.call_template({
      id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
      input: { operation: "save_current", ...unknownFields },
    });
    const unknownBlocker = unknownResult.blockers.find((entry) => entry.code === "PROJECT_FILE_INPUT_FIELDS_UNSUPPORTED");
    assert.equal(unknownBlocker.details.fields.length, 8);
    assert.equal(unknownBlocker.details.field_count, 5_000);
    assert.equal(unknownBlocker.details.omitted_field_count, 4_992);
    assert.equal(unknownBlocker.details.fields.every((field) => Buffer.byteLength(field) <= 80), true);

    const unusedResult = await runtime.call_template({
      id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
      input: { operation: "save_current" },
      refs: largeRefs,
      idempotency_key: longIdempotency,
    });
    assert.equal(unusedResult.request.dry_run, false);
    assert.equal(JSON.stringify(unusedResult).includes("REF_SECRET_399"), false);
    assert.equal(JSON.stringify(unusedResult).includes("IDEMPOTENCY_SECRET_"), false);

    const maxAcceptedPath = `/${"p".repeat(2_043)}.RPP`;
    assert.equal(Buffer.byteLength(maxAcceptedPath), 2_048);
    const maxAcceptedResult = planAlpha3_2C3DProjectFileMacro({ operation: "save_as", target_path: maxAcceptedPath, overwrite: true });
    assert.equal(maxAcceptedResult.ok, true);
    assert.deepEqual(maxAcceptedResult.mutation_requests[0].call_template.input, {
      target_path: maxAcceptedPath,
      overwrite: true,
    });
    assert.equal(executorCalls, 0);
  });

  it("binds call_template to the executable program and blocks cleanly without a bridge", async () => {
    let executorCalls = 0;
    const executor = async () => {
      executorCalls += 1;
      throw new Error("macro must not call executor");
    };
    const runtime = createCallTemplateRuntime();
    const result = await runtime.call_template({
      id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
      input: { operation: "save_current" },
    });

    assert.equal(result.ok, false);
    assert.equal(result.contract, "macro.execution.v1");
    assert.equal(result.macro.id, ALPHA3_2C3D_PROJECT_FILE_MACRO_ID);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, "PROJECT_FILE_EXECUTOR_UNAVAILABLE");
    assert.equal(result.execution.stage_count, 0);
    assert.deepEqual(result.result.changes, []);
    assert.equal(executorCalls, 0);
  });

  it("discovers exactly one runtime-bound project.file item without changing atomic catalog/live counts", () => {
    const runtime = createCallTemplateRuntime();
    const exact = runtime.list_templates({ ids: [ALPHA3_2C3D_PROJECT_FILE_MACRO_ID], fields: ["id", "summary"] });
    const defaultMenu = runtime.list_templates();
    const projectFileRows = defaultMenu.items.filter((item) => item.id === ALPHA3_2C3D_PROJECT_FILE_MACRO_ID);

    assert.equal(exact.items.length, 1);
    assert.equal(exact.items[0].id, ALPHA3_2C3D_PROJECT_FILE_MACRO_ID);
    assert.equal(exact.items[0].support_status, "executable_runtime_bound");
    assert.equal(exact.items[0].capability_truth.support_state, "supported");
    assert.equal(exact.items[0].capability_truth.exists_in_catalog, true);
    assert.equal(exact.items[0].capability_truth.live_runnable_now, false);
    assert.equal(exact.items[0].current_status, "needs_live");
    assert.equal(projectFileRows.length, 1);
    assert.equal(runtime.accepted_catalog.size, 231);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 231);
    assert.equal(Buffer.byteLength(JSON.stringify(defaultMenu)) <= 98_304, true);
  });

  it("keeps the frozen five-tool surface with no call_recipe or hidden executor", () => {
    assert.deepEqual(TOOL_ABI_V1_TOOL_NAMES, ["ping", "get_state", "list_templates", "list_recipes", "call_template"]);
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.includes("call_recipe"), false);
    const plan = planAlpha3_2C3DProjectFileMacro({ operation: "save_current" });
    assert.equal(plan.safety.added_tools, 0);
    assert.equal(plan.safety.public_call_recipe, false);
    assert.equal(plan.safety.hidden_executor, false);
  });

  it("returns a typed executable-Macro readiness blocker through actual stdio without REAPER", { timeout: 30_000 }, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: REPO_ROOT,
      env: sanitizedServerEnv(),
      stderr: "pipe",
    });
    const client = new Client({ name: "alpha3-2c3d-stdio-test", version: "1.0.0" }, { capabilities: {} });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...TOOL_ABI_V1_TOOL_NAMES].sort());
      const response = await client.callTool({
        name: "call_template",
        arguments: {
          id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
          input: { operation: "save_as", target_path: "/tmp/openreaper-stdio/demo.RPP", overwrite: true },
        },
      });
      const result = parseToolJson(response);
      assert.equal(result.ok, false);
      assert.equal(result.contract, "macro.execution.v1");
      assert.equal(result.macro.id, ALPHA3_2C3D_PROJECT_FILE_MACRO_ID);
      assert.equal(result.execution.status, "blocked");
      assert.equal(result.error.code, "PROJECT_FILE_EXECUTOR_UNAVAILABLE");
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

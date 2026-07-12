import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import { ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS } from "../../packages/mcp-server/src/alpha3-2-5-0-macro-inventory-v1.mjs";
import { ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY } from "../../packages/mcp-server/src/alpha3-2-5-b-project-understanding-v1.mjs";
import { ALPHA3_2_5_C_CONTROL_REGISTRY } from "../../packages/mcp-server/src/alpha3-2-5-c-control-runtime-v1.mjs";
import { ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY } from "../../packages/mcp-server/src/alpha3-2-5-c-project-write-runtime-v1.mjs";
import { ALPHA3_2_5_C_FILE_MACRO_REGISTRY } from "../../packages/mcp-server/src/alpha3-2c3d-project-file-macro-v1.mjs";
import { ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY } from "../../packages/mcp-server/src/alpha3-2e-render-targets-v1.mjs";
import { ALPHA3_2_5_D_MIDI_MACRO_REGISTRY } from "../../packages/mcp-server/src/alpha3-2-5-d-midi-macro-v1.mjs";
import { ALPHA3_2_5_D_NATIVE_FX_REGISTRY } from "../../packages/mcp-server/src/alpha3-2-5-d-fx-macro-v1.mjs";
import { ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT } from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const REGISTRIES = [
  ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY,
  ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY,
  ALPHA3_2_5_C_FILE_MACRO_REGISTRY,
  ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY,
  ALPHA3_2_5_C_CONTROL_REGISTRY,
  ALPHA3_2_5_D_MIDI_MACRO_REGISTRY,
  ALPHA3_2_5_D_NATIVE_FX_REGISTRY,
];

describe("Alpha3.2.5 Macro discovery capability truth", () => {
  it("keeps the approved 12-Macro registry dependency closure inside the current product allowlist", () => {
    const entries = REGISTRIES.flatMap((registry) => registry.entries);
    assert.deepEqual(entries.map((entry) => entry.macro_id).sort(), [...ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS].sort());
    const allowed = new Set(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS);
    assert.equal(entries.every((entry) => entry.dependencies.template_ids.every((id) => allowed.has(id))), true);
  });

  it("does not advertise Macros as live-runnable when the configured allowlist lacks fixed dependencies", () => {
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
      },
    });
    const items = runtime.list_templates({ ids: ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS, fields: ["summary"] }).items;
    assert.equal(items.length, 12);
    assert.equal(items.every((item) => item.capability_truth.live_runnable_now === false), true);
    assert.equal(items.every((item) => item.capability_truth.known_blocker === "macro_fixed_dependencies_not_available"), true);
    assert.equal(items.every((item) => item.current_status === "needs_live"), true);
  });

  it("advertises all approved Macros only with the full dependency closure and Project Index runtime", () => {
    const projectIndexRuntime = {
      contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
      ok: true,
      adapter: {},
      status: () => ({ contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT, ok: true, lifecycle: "ready" }),
    };
    const runtime = createCallTemplateRuntime({
      projectIndexRuntime,
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const items = runtime.list_templates({ ids: ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS, fields: ["summary"] }).items;
    assert.equal(items.length, 12);
    assert.equal(items.every((item) => item.capability_truth.live_runnable_now === true), true);
    assert.equal(items.every((item) => item.capability_truth.known_blocker === null), true);
  });

  it("does not treat an arbitrary truthy Project Index object as a ready runtime capability", () => {
    const runtime = createCallTemplateRuntime({
      projectIndexRuntime: {},
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const items = runtime.list_templates({ ids: ["macro.project.inspect", "macro.project.query"], fields: ["summary"] }).items;
    assert.equal(items.every((item) => item.capability_truth.live_runnable_now === false), true);
    assert.equal(items.every((item) => item.capability_truth.known_blocker === "macro_fixed_dependencies_not_available"), true);
  });

  it("keeps public Macro guidance on registered execution instead of agent-replayed child plans", () => {
    const surface = createCallTemplateRuntime().list_templates({
      ids: ["macro.render.targets"],
      fields: ["id"],
    }).product_surface;
    const macroGuidance = {
      agent_context_macro_guide: surface.agent_context_macro_guide,
      macro_execution_convenience: surface.macro_execution_convenience,
      stock_plugin_live_evidence: surface.stock_plugin_live_evidence,
      stock_plugin_product_gate: surface.stock_plugin_product_gate,
      stock_plugin_product_gate_snapshot: surface.stock_plugin_product_gate_snapshot,
    };
    const publicStrings = collectStrings(macroGuidance).join("\n");
    assert.doesNotMatch(
      publicStrings,
      /plan[-_ ]only|agent executes.*child|execute_child_requests|emits existing call_template child requests/i,
    );
  });
});

function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

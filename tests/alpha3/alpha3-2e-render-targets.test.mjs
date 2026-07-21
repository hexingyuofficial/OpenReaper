import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
  createAlpha3_2ERenderTargetsMacroDiscoveryItems,
  createAlpha3_2ERenderTargetsMacroRuntimeEnvelope,
  planAlpha3_2ERenderTargetsMacro,
} from "../../packages/mcp-server/src/alpha3-2e-render-targets-v1.mjs";
import { createAlpha3_2AAgentContextMacroGuide } from "../../packages/mcp-server/src/alpha3-2a-agent-context-macro-guide-v1.mjs";
import { createTemplateCatalog } from "../../packages/core/src/template-catalog-v1.mjs";
import { buildTemplateBridgeRequest } from "../../packages/core/src/template-execution-harness-v1.mjs";
import { createCriticalRenderTemplates } from "../../packages/core/src/template-packs/critical-render-templates-v1.mjs";

function codes(plan) {
  return plan.blockers.map((entry) => entry.code);
}

describe("Alpha3.2-E render target planner", () => {
  it("returns a managed-root dry-run preview with no child requests", () => {
    const plan = planAlpha3_2ERenderTargetsMacro({
      target_kind: "explicit_items",
      refs: ["item:guid:{A}", "item:guid:{B}"],
      format: "wav",
      sample_rate_hz: 44_100,
      channel_count: 1,
      wav_bit_depth: 16,
      output_basename: "Field Test Mix",
      output_policy: "openreaper_managed_render_root",
      collision_policy: "fail_if_exists",
      max_targets: 2,
      dry_run: true,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.id, ALPHA3_2E_RENDER_TARGETS_MACRO_ID);
    assert.equal(plan.mode, "dry_run_preview");
    assert.deepEqual(plan.preview.target_refs, ["item:guid:{A}", "item:guid:{B}"]);
    assert.equal(plan.preview.render_settings.sample_rate_hz, 44_100);
    assert.equal(plan.preview.render_settings.channel_count, 1);
    assert.equal(plan.preview.render_settings.wav_bit_depth, 16);
    assert.equal(plan.preview.output_policy.root, "openreaper_managed_render_root");
    assert.equal(plan.preview.output_policy.collision_policy, "fail_if_exists");
    assert.equal(plan.preview.output_policy.overwrite_allowed, false);
    assert.equal(plan.preview.render_settings.output_basename, "Field Test Mix");
    assert.equal(plan.preview.output_policy.basename_owner, "user_request");
    assert.deepEqual(plan.child_requests, []);
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.public_call_recipe, false);
    assert.equal(plan.safety.raw_action_lua_shell_ui, false);
  });

  it("normalizes request-posture refs and emits exactly one runtime-bound D31 child", () => {
    const plan = planAlpha3_2ERenderTargetsMacro(
      {
        target_kind: "regions",
        format: "ogg",
        ogg_quality: 0.8,
        sample_rate_hz: 48_000,
        channel_count: 2,
        output_basename: "Regions",
        dry_run: false,
      },
      { refs: { regions: ["region:index:3", "region:name:Outro"] } },
    );

    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "plan_only_agent_executed_child_requests");
    assert.deepEqual(plan.preflight_requests, []);
    assert.deepEqual(plan.mutation_requests.map((request) => request.id), ["template.render.render_targets"]);
    assert.deepEqual(plan.readback_requests, []);
    assert.deepEqual(plan.child_requests.map((request) => request.id), ["template.render.render_targets"]);
    assert.deepEqual(plan.mutation_requests[0].refs, {
      region_refs: [
        { kind: "region", ref: "region:index:3", identity: { scheme: "index", value: "3" } },
        { kind: "region", ref: "region:name:Outro", identity: { scheme: "name", value: "Outro" } },
      ],
    });
    assert.deepEqual(plan.mutation_requests[0].input, {
      target_kind: "regions",
      format: "ogg",
      output_policy: "openreaper_managed_render_root",
      collision_policy: "fail_if_exists",
      sample_rate_hz: 48_000,
      channel_count: 2,
      max_targets: 16,
      output_basename: "Regions",
      ogg_quality: 0.8,
    });
    assert.equal(plan.mutation_requests[0].callable_now, true);
    assert.equal(plan.runtime_binding, "bound_plan_only_child_route");

    const descriptor = createTemplateCatalog({ templates: createCriticalRenderTemplates() }).require("template.render.render_targets");
    const bridgeRequest = buildTemplateBridgeRequest({
      descriptor,
      input: plan.mutation_requests[0].input,
      refs: plan.mutation_requests[0].refs,
      context: { session_id: "macro-child-test", expected_owner: "openreaper-alpha", expected_generation: 1, created_at: "2026-07-11T00:00:00.000Z", request_sequence: 1 },
    });
    assert.equal("idempotency_key" in bridgeRequest, false);
    assert.deepEqual(bridgeRequest.refs.map(({ kind, ref }) => ({ kind, ref })), [
      { kind: "region", ref: "region:index:3" },
      { kind: "region", ref: "region:name:Outro" },
    ]);
  });

  it("normalizes native MP3 delivery with an explicit or default audited bitrate", () => {
    for (const [input, expectedBitrate] of [
      [{ target_kind: "whole_project", format: "mp3", dry_run: false }, 320],
      [{ target_kind: "whole_project", format: "mp3", mp3_bitrate_kbps: 192, output_basename: "Client Preview", dry_run: false }, 192],
    ]) {
      const plan = planAlpha3_2ERenderTargetsMacro(input);
      assert.equal(plan.ok, true, JSON.stringify(plan.blockers));
      assert.equal(plan.preview.render_settings.mp3_bitrate_kbps, expectedBitrate);
      assert.equal(plan.mutation_requests[0].input.mp3_bitrate_kbps, expectedBitrate);
      assert.equal("wav_bit_depth" in plan.mutation_requests[0].input, false);
      assert.equal("ogg_quality" in plan.mutation_requests[0].input, false);
    }
  });

  it("fails closed for target/ref mismatches, unsafe output policy, and unsupported settings", () => {
    const cases = [
      [{ target_kind: "selected_items", refs: ["item:guid:{A}"], format: "wav" }, "RENDER_SELECTED_REFS_FORBIDDEN"],
      [{ target_kind: "explicit_items", format: "wav" }, "RENDER_EXPLICIT_REFS_REQUIRED"],
      [{ target_kind: "regions", refs: ["item:guid:{A}"], format: "ogg" }, "RENDER_REF_INVALID"],
      [{ target_kind: "whole_project", refs: { items: ["item:guid:{A}"] }, format: "wav" }, "RENDER_OBJECT_REFS_FORBIDDEN"],
      [{ target_kind: "explicit_tracks", refs: ["track:guid:{A}", "track:guid:{B}"], format: "wav", max_targets: 1 }, "RENDER_MAX_TARGETS_EXCEEDED"],
      [{ target_kind: "whole_project", format: "wav", output_directory: "/tmp/renders" }, "RENDER_INPUT_UNKNOWN_FIELD"],
      [{ target_kind: "whole_project", format: "wav", output_path: "/tmp/renders/out.wav" }, "RENDER_UNSAFE_INPUT_FIELD"],
      [{ target_kind: "whole_project", format: "wav", collision_policy: "overwrite" }, "RENDER_COLLISION_POLICY_REQUIRED"],
      [{ target_kind: "whole_project", format: "wav", output_policy: "arbitrary" }, "RENDER_OUTPUT_POLICY_REQUIRED"],
      [{ target_kind: "whole_project", format: "wav", sample_rate_hz: 96_000 }, "RENDER_SAMPLE_RATE_UNSUPPORTED"],
      [{ target_kind: "whole_project", format: "wav", channel_count: 6 }, "RENDER_CHANNELS_UNSUPPORTED"],
      [{ target_kind: "whole_project", format: "wav", wav_bit_depth: 32 }, "RENDER_WAV_BIT_DEPTH_UNSUPPORTED"],
      [{ target_kind: "whole_project", format: "ogg", ogg_quality: 0.7 }, "RENDER_OGG_QUALITY_UNSUPPORTED"],
      [{ target_kind: "whole_project", format: "ogg", wav_bit_depth: 16 }, "RENDER_OGG_BIT_DEPTH_FORBIDDEN"],
      [{ target_kind: "whole_project", format: "mp3", mp3_bitrate_kbps: 160 }, "RENDER_MP3_BITRATE_UNSUPPORTED"],
      [{ target_kind: "whole_project", format: "mp3", wav_bit_depth: 16 }, "RENDER_MP3_WAV_BIT_DEPTH_FORBIDDEN"],
      [{ target_kind: "whole_project", format: "mp3", ogg_quality: 0.5 }, "RENDER_MP3_OGG_QUALITY_FORBIDDEN"],
      [{ target_kind: "whole_project", format: "wav", mp3_bitrate_kbps: 320 }, "RENDER_WAV_MP3_BITRATE_FORBIDDEN"],
      [{ target_kind: "whole_project", format: "ogg", mp3_bitrate_kbps: 320 }, "RENDER_OGG_MP3_BITRATE_FORBIDDEN"],
      [{ target_kind: "whole_project", format: "wav", output_basename: "../mix" }, "RENDER_OUTPUT_BASENAME_INVALID"],
      [{ target_kind: "whole_project", format: "wav", output_basename: "mix.wav" }, "RENDER_OUTPUT_BASENAME_INVALID"],
      [{ target_kind: "whole_project", format: "mp3", output_basename: "mix.mp3" }, "RENDER_OUTPUT_BASENAME_INVALID"],
      [{ target_kind: "whole_project", format: "wav", output_basename: "$project" }, "RENDER_OUTPUT_BASENAME_INVALID"],
    ];

    for (const [input, expectedCode] of cases) {
      const plan = planAlpha3_2ERenderTargetsMacro(input);
      assert.equal(plan.ok, false, expectedCode);
      assert.equal(codes(plan).includes(expectedCode), true, `${expectedCode}: ${JSON.stringify(codes(plan))}`);
      assert.deepEqual(plan.child_requests, []);
    }
  });

  it("wraps plans without a hidden executor and keeps the six-tool guide unchanged", () => {
    const plan = planAlpha3_2ERenderTargetsMacro({ target_kind: "whole_project", format: "wav", dry_run: false });
    const envelope = createAlpha3_2ERenderTargetsMacroRuntimeEnvelope({
      request: { id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID, input: { target_kind: "whole_project", format: "wav", dry_run: false } },
      plan,
      now: () => new Date("2026-07-11T00:00:00Z"),
    });

    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.executed, false);
    assert.equal(envelope.result.execution.executor_call_count, 0);
    assert.equal(envelope.result.execution.live_reaper_called, false);
    assert.equal(envelope.result.execution.external_encoder_called, false);
    assert.equal(envelope.result.execution.hidden_executor, false);
    assert.equal(envelope.result.execution.public_call_recipe, false);
    assert.equal(envelope.result.execution.raw_action_lua_shell_ui, false);
    assert.equal(createAlpha3_2AAgentContextMacroGuide().tool_surface.count, 6);
    assert.deepEqual(createAlpha3_2AAgentContextMacroGuide().tool_surface.tools, [
      "ping",
      "get_state",
      "list_templates",
      "list_recipes",
      "call_template",
      "call_recipe",
    ]);
  });

  it("advertises an executable runtime-bound Macro with accepted live render evidence", () => {
    const [item] = createAlpha3_2ERenderTargetsMacroDiscoveryItems();
    assert.equal(item.id, ALPHA3_2E_RENDER_TARGETS_MACRO_ID);
    assert.equal(item.implementation_status, "executable");
    assert.equal(item.execution_shape, "registered_macro_program");
    assert.equal(item.support_status, "executable_runtime_bound");
    assert.equal(item.live_runnable_now, false);
    assert.equal(item.exists_in_catalog, true);
    assert.equal(item.known_blocker, null);
    assert.equal(item.input_schema.properties.output_policy.const, "openreaper_managed_render_root");
    assert.equal(item.input_schema.properties.collision_policy.const, "fail_if_exists");
    assert.deepEqual(item.input_schema.properties.max_targets, { type: "integer", minimum: 1, maximum: 16 });
  });
});

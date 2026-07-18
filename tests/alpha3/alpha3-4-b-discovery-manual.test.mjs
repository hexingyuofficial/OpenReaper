import assert from "node:assert/strict";
import test from "node:test";

import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  createAlpha3_3B1AgentContextMacroGuide,
  rankAlpha3_3B1MacroIntents,
} from "../../packages/mcp-server/src/alpha3-3-b1-agent-context-macro-guide-v1.mjs";
import {
  assertAlpha34BRecommendationShape,
  auditAlpha34BVisibleManuals,
  createAlpha34BFirstTryExecutionGuide,
  createAlpha34BMacroRecommendations,
  enrichAlpha34BRuntimeError,
} from "../../packages/mcp-server/src/alpha3-4-b-discovery-manual-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadOpenReaperAgentStartHereProjection,
  OPENREAPER_FLAT_FIFTEEN_MACRO_IDS,
  OPENREAPER_PUBLIC_TOOL_IDS,
} from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";

test("query recommendations return 1-3 canonical visible Macro rows without persisting user text", () => {
  const projection = createAlpha34BMacroRecommendations("create a MIDI clip and add a compressor");
  assert.equal(projection.query_present, true);
  assert.equal(projection.task_text_persisted, false);
  assert.equal(projection.covered, true);
  assert.ok(projection.recommendations.length >= 1 && projection.recommendations.length <= 3);
  assert.deepEqual(projection.recommendations.map((row) => row.id), [
    "macro.midi.apply",
    "macro.fx.apply_chain",
  ]);
  for (const row of projection.recommendations) {
    assertAlpha34BRecommendationShape(row);
    assert.equal(row.exact_expansion_call.tool, "list_templates");
    assert.deepEqual(row.exact_expansion_call.arguments.ids, [row.id]);
  }
  assert.equal(JSON.stringify(projection).includes("create a MIDI clip and add a compressor"), false);
});

test("Chinese/English broad wording routes fades to items.apply and expands lexicon coverage", () => {
  assert.deepEqual(rankAlpha3_3B1MacroIntents("add fade in to selected items"), ["macro.items.apply"]);
  assert.deepEqual(rankAlpha3_3B1MacroIntents("给选中 item 加淡入淡出"), ["macro.items.apply"]);
  assert.equal(rankAlpha3_3B1MacroIntents("导出混音并渲染区域")[0], "macro.render.targets");
  assert.deepEqual(rankAlpha3_3B1MacroIntents("写音量自动化"), ["macro.automation.apply"]);
  assert.equal(rankAlpha3_3B1MacroIntents("把轨道发送到 reverb")[0], "macro.routing.apply");
  assert.ok(rankAlpha3_3B1MacroIntents("检查项目里有什么").includes("macro.project.inspect"));
  const runtime = createCallTemplateRuntime();
  const fades = runtime.list_templates({ query: "fade in", limit: 10 });
  assert.equal(fades.product_surface.macro_first_routing.route, "macro_first");
  assert.deepEqual(fades.product_surface.agent_context_macro_guide.recommended_macro_ids, ["macro.items.apply"]);
  assert.equal(fades.product_surface.agent_context_macro_guide.macro_recommendations[0].id, "macro.items.apply");
  assert.equal(fades.product_surface.macro_first_routing.task_text_persisted, false);
});

test("exact expansion attaches schema-derived first-try guide and query prerequisite for identity-bound Macros", () => {
  const runtime = createCallTemplateRuntime();
  const exact = runtime.list_templates({
    ids: ["macro.automation.apply", "macro.midi.apply", "macro.routing.apply", "macro.items.apply", "macro.fx.set_controls"],
    fields: ["id", "inputSchema", "examples"],
  });
  const byId = new Map(
    exact.product_surface.agent_context_macro_guide.requested_expansions.items.map((item) => [item.id, item]),
  );
  const automation = byId.get("macro.automation.apply");
  assert.ok(automation.first_try_execution_guide);
  assert.equal(automation.first_try_execution_guide.contract.includes("first_try"), true);
  assert.equal(automation.first_try_execution_guide.identity_required ?? automation.first_try_execution_guide.selector_or_ref_requirements.identity_required, true);
  assert.ok(automation.first_try_execution_guide.next_calls.some((call) => call.arguments?.id === "macro.project.query"));
  assert.ok(automation.first_try_execution_guide.next_calls.every((call) => !JSON.stringify(call).includes("{TRACK}")));

  const midi = byId.get("macro.midi.apply");
  assert.ok(midi.first_try_execution_guide.accepted_modes.includes("create_clips"));
  assert.ok(midi.first_try_execution_guide.public_fields.includes("mode") || midi.first_try_execution_guide.public_fields.includes("notes"));

  const items = byId.get("macro.items.apply");
  assert.ok(items.first_try_execution_guide.accepted_modes.includes("apply_fades"));

  const fx = byId.get("macro.fx.set_controls");
  assert.equal(fx.first_try_execution_guide.identity_required ?? fx.first_try_execution_guide.selector_or_ref_requirements.identity_required, true);
  assert.ok(fx.first_try_execution_guide.next_calls.some((call) => call.arguments?.id === "macro.project.query"));
});

test("all 15 manuals audit and every executable first-try call passes the current public runtime validation", async () => {
  const runtime = createCallTemplateRuntime();
  const exact = runtime.list_templates({
    ids: [...ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS],
    fields: ["id", "inputSchema", "examples"],
  });
  const discoveryById = new Map(exact.items.map((item) => [item.id, item]));
  const audit = auditAlpha34BVisibleManuals({ discovery_items_by_id: discoveryById });
  assert.equal(audit.macro_count, 15);
  assert.equal(audit.ok, true, JSON.stringify(audit.findings, null, 2));
  assert.deepEqual(audit.findings, []);
  for (const id of ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS) {
    const guide = createAlpha34BFirstTryExecutionGuide(id, discoveryById.get(id));
    assert.equal(guide.id, id);
    assert.ok(Array.isArray(guide.next_calls));
    assert.ok(guide.next_calls.length >= 1);
    assert.equal(guide.next_calls[0].tool === "list_templates" || guide.next_calls[0].tool === "call_template", true);
    const exactCall = guide.next_calls.find((entry) => entry.tool === "list_templates");
    assert.equal(exactCall.executable_now, true);
    for (const next of guide.next_calls.filter((entry) => entry.executable_now === true)) {
      await assertExecutableFirstTryCall(runtime, next, discoveryById);
    }
  }
  for (const id of ["macro.project.apply_layout", "macro.render.targets"]) {
    const guide = createAlpha34BFirstTryExecutionGuide(id, discoveryById.get(id));
    const skeleton = guide.next_calls.find((entry) => entry.tool === "call_template" && entry.arguments.id === id);
    assert.equal(skeleton.executable_now, false);
    assert.ok(skeleton.missing_fields.length > 0 || skeleton.missing_target_facts.length > 0);
  }
});

test("placeholder-ref examples are explicitly non-executable in exact B projections", () => {
  const runtime = createCallTemplateRuntime();
  const exact = runtime.list_templates({
    ids: ["macro.items.apply", "macro.midi.apply", "macro.automation.apply"],
    fields: ["id", "inputSchema", "examples"],
  });
  const expansions = exact.product_surface.agent_context_macro_guide.requested_expansions.items;
  let placeholderCount = 0;
  for (const expansion of expansions) {
    for (const example of expansion.action_manual?.examples ?? []) {
      if (!/\{[A-Z][A-Z0-9_-]*\}|guid:\{[^}]+\}/iu.test(JSON.stringify(example.input ?? {}))) continue;
      placeholderCount += 1;
      assert.equal(example.executable_now, false, `${expansion.id}:${example.name}`);
      assert.equal(example.prerequisite.tool, "call_template");
      assert.equal(example.prerequisite.arguments.id, "macro.project.query");
    }
    for (const audit of expansion.first_try_execution_guide.example_audit.filter((entry) => entry.has_placeholder_ref)) {
      assert.equal(audit.executable_now, false, `${expansion.id}:${audit.name}`);
      assert.equal(audit.prerequisite.arguments.id, "macro.project.query");
    }
  }
  assert.ok(placeholderCount > 0);
});

test("replacement and budget errors expose deterministic next_call or request_patch", async () => {
  const runtime = createCallTemplateRuntime();
  const replaced = await runtime.call_template({ id: "macro.midi.create_clip", input: { start_seconds: 0, end_seconds: 1, notes: [] } });
  assert.equal(replaced.ok, false);
  assert.equal(replaced.error.code, "CALL_TEMPLATE_ID_REPLACED");
  assert.equal(replaced.error.next_call.tool, "call_template");
  assert.equal(replaced.error.next_call.arguments.id, "macro.midi.apply");
  assert.equal(replaced.error.next_call.arguments.input.mode, "create_clips");

  const budget = enrichAlpha34BRuntimeError({
    code: "RESPONSE_TOO_LARGE",
    failure_layer: "response_budget",
    recommended_next_action: {
      code: "retry_with_larger_inline_budget",
      tool: "call_template",
      request_patch: { budget: { max_inline_value_bytes: 4096 } },
    },
    details: { path: "result", bytes: 3000, max_inline_value_bytes: 2048 },
  }, { id: "macro.project.inspect", input: {}, budget: { max_inline_value_bytes: 2048 } });
  assert.deepEqual(budget.request_patch, { budget: { max_inline_value_bytes: 4096 } });
  assert.equal(budget.next_call.tool, "call_template");
  assert.equal(budget.next_call.arguments.budget.max_inline_value_bytes, 4096);
});

test("search phrases remain metadata only and never become hidden executable ids", () => {
  const guide = createAlpha3_3B1AgentContextMacroGuide({
    recommended_macro_ids: ["macro.items.apply"],
    query: "fade",
  });
  assert.equal(guide.search_phrases_are_metadata_only, true);
  assert.equal(guide.tool_surface.count, 5);
  assert.deepEqual(guide.macro_menu.macro_ids, ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS);
  assert.equal(guide.compatibility.visible_in_menu, false);
  for (const alias of guide.compatibility.aliases) {
    assert.equal(guide.macro_menu.macro_ids.includes(alias.id), false);
  }
});

test("Agent Start Here teaches recommendation/exact-guide/next-call fields within budget", () => {
  const projection = loadOpenReaperAgentStartHereProjection();
  assert.equal(projection.utf8_bytes <= 16384, true);
  assert.deepEqual(projection.macro_ids, OPENREAPER_FLAT_FIFTEEN_MACRO_IDS);
  assert.deepEqual(projection.tool_ids, OPENREAPER_PUBLIC_TOOL_IDS);
  assert.match(projection.compact_text, /macro_recommendations/u);
  assert.match(projection.compact_text, /first_try_execution_guide/u);
  assert.match(projection.compact_text, /next_call/u);
  assert.match(projection.compact_text, /request_patch/u);
  assert.match(projection.compact_text, /Search phrases are metadata only/u);
});

async function assertExecutableFirstTryCall(runtime, next, discoveryById) {
  if (next.tool === "list_templates") {
    const response = runtime.list_templates(next.arguments);
    assert.deepEqual(response.items.map((item) => item.id), next.arguments.ids);
    return;
  }
  assert.equal(next.tool, "call_template");
  const schema = discoveryById.get(next.arguments.id)?.inputSchema;
  assertPublicSchemaShape(next.arguments.input, schema, next.arguments.id);
  const response = await runtime.call_template(next.arguments);
  assert.notEqual(response.error?.failure_layer, "server_validation", JSON.stringify(response, null, 2));
  const codes = [
    typeof response.error === "string" ? response.error : response.error?.code,
    ...(response.blockers ?? []).map((entry) => entry.code),
  ].filter(Boolean);
  assert.deepEqual(
    codes.filter((code) => /(?:_INPUT_INVALID|_FIELD_NOT_SUPPORTED|_KIND_INVALID|_FORMAT_INVALID)$/u.test(code)),
    [],
    JSON.stringify(response, null, 2),
  );
}

function assertPublicSchemaShape(input, schema, id) {
  assert.ok(schema && typeof schema === "object", `${id} public inputSchema missing`);
  const branches = Array.isArray(schema.oneOf) ? schema.oneOf : [schema];
  const matches = branches.some((branch) => {
    const required = [...(schema.required ?? []), ...(branch.required ?? [])];
    if (required.some((field) => input?.[field] === undefined)) return false;
    const properties = { ...(schema.properties ?? {}), ...(branch.properties ?? {}) };
    return Object.entries(input ?? {}).every(([field, value]) => {
      const rule = properties[field];
      if (!rule) return schema.additionalProperties !== false && branch.additionalProperties !== false;
      if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return false;
      if (rule.const !== undefined && rule.const !== value) return false;
      return true;
    });
  });
  assert.equal(matches, true, `${id} executable next_call does not match its public inputSchema`);
}

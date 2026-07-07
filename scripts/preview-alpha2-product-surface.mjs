import {
  FakeFoundationBridge,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";

const limit = normalizeLimit(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length));
const runtime = createCallTemplateRuntime({
  executor: new FakeFoundationBridge(),
  live: {
    opted_in: true,
    executor: new FakeFoundationBridge(),
    allowed_template_ids: CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
  },
});
const menu = runtime.list_templates({ surface: "executable", limit });

console.log(JSON.stringify({
  contract: menu.product_surface.contract,
  surface: menu.product_surface.surface,
  allowed_template_count: CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.length,
  page: menu.page,
  workflow_rhythm: {
    id: menu.product_surface.workflow_rhythm.id,
    steps: menu.product_surface.workflow_rhythm.steps.map((step) => step.id),
    default_readiness_recipe: menu.product_surface.workflow_rhythm.default_readiness_recipe,
  },
  startup_preflight: menu.product_surface.startup_preflight.map((entry) => ({
    id: entry.id,
    check: entry.check,
  })),
  startup_health: menu.product_surface.startup_health_snapshot,
  startup_assistant: menu.product_surface.startup_assistant_snapshot,
  counts: {
    by_status: countBy(menu.items, "current_status"),
    by_label: countBy(menu.items, "beginner_label"),
    by_category: countBy(menu.items, "user_action_category"),
  },
  first_actions: menu.items.map((item) => ({
    id: item.id,
    action_name: item.action_name,
    beginner_label: item.beginner_label,
    current_status: item.current_status,
    user_action_category: item.user_action_category,
    required_input: item.required_input,
    required_refs: item.required_refs,
    next_step: item.next_step,
    safety_note: item.safety_note,
  })),
}, null, 2));

function countBy(items, field) {
  const counts = {};
  for (const item of items) {
    const key = item[field] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value ?? "25", 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 100);
}

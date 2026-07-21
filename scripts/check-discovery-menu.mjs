import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  RECIPE_DETAIL_FIELDS,
  RECIPE_SUMMARY_FIELDS,
  TEMPLATE_DETAIL_FIELDS,
  TEMPLATE_SUMMARY_FIELDS,
  listRecipes,
  listTemplates,
} from "../packages/mcp-server/src/discovery-menu-v1.mjs";

const root = process.cwd();
const contractDoc = readFileSync(
  path.join(root, "docs/abi/DISCOVERY_MENU_CONTRACT_V1.md"),
  "utf8",
);

const requiredDocNeedles = [
  "Status: frozen by the Layer 1.5 Discovery / Menu Contract gate.",
  '"contract": "discovery.menu.v1"',
  '"kind": "template_menu"',
  '"kind": "recipe_menu"',
  "inputSchema",
  "outputSchema",
  "examples",
  "expectedDelta",
  "steps",
  "assertions",
  "recovery",
  "Template detail fields require exact expansion by `ids`.",
  "Recipe detail fields require exact expansion by `ids`.",
  "fuzzy\nrecipe-id-only run examples are forbidden",
  "must not implement the bridge",
  "Alpha3.4-E2 separately adds exactly one sixth tool named",
];

const missing = requiredDocNeedles.filter((needle) => !contractDoc.includes(needle));
if (missing.length > 0) {
  console.error("Discovery/Menu contract doc is missing required text:");
  for (const needle of missing) console.error(`- ${needle}`);
  process.exit(1);
}

assertFieldSet("template summary fields", TEMPLATE_SUMMARY_FIELDS, [
  "id",
  "title",
  "summary",
  "pack",
  "lifecycle",
  "risk",
  "entity_kind",
  "tags",
]);
assertFieldSet("template detail fields", TEMPLATE_DETAIL_FIELDS, [
  "inputSchema",
  "outputSchema",
  "examples",
  "expectedDelta",
]);
assertFieldSet("recipe summary fields", RECIPE_SUMMARY_FIELDS, [
  "id",
  "title",
  "summary",
  "pack",
  "lifecycle",
  "risk",
  "entity_kind",
  "tags",
  "workflow_card",
]);
assertFieldSet("recipe detail fields", RECIPE_DETAIL_FIELDS, [
  "steps",
  "assertions",
  "recovery",
]);

assertCompactDefault("template", listTemplates({}, [heavyTemplate()]), [
  "inputSchema",
  "outputSchema",
  "examples",
  "expectedDelta",
  "hidden-heavy-body",
]);
assertCompactDefault("recipe", listRecipes({}, [heavyRecipe()]), [
  "steps",
  "assertions",
  "recovery",
  "hidden-heavy-body",
]);

const executableIdentity = {
  recipe_id: "recipe.test.saved",
  version: "1.0.0",
  revision: 7,
  content_hash: "a".repeat(64),
  validation_result_id: "validation:test",
};
const exactExecutable = listRecipes({
  ids: [executableIdentity.recipe_id],
  fields: ["capability_truth"],
}, [{
  ...heavyRecipe(),
  id: executableIdentity.recipe_id,
  lifecycle: "validated",
  tags: ["executable", "revision"],
  executable: true,
  executable_identity: executableIdentity,
}]);
const example = exactExecutable.items[0]?.capability_truth?.example_call_shape?.request;
if (JSON.stringify(example) !== JSON.stringify({
  operation: "run",
  ...executableIdentity,
  inputs: {},
})) {
  console.error("Exact executable recipe discovery must emit a complete saved-identity run example.");
  process.exit(1);
}

execFileSync(process.execPath, ["--test", "tests/layer1_5/discovery-menu.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Discovery/Menu Contract v1 ok.");

function assertFieldSet(label, actual, expected) {
  const missingFields = expected.filter((field) => !actual.includes(field));
  const extraFields = actual.filter((field) => !expected.includes(field));
  if (missingFields.length > 0 || extraFields.length > 0) {
    console.error(`${label} does not match contract.`);
    if (missingFields.length > 0) console.error(`  Missing: ${missingFields.join(", ")}`);
    if (extraFields.length > 0) console.error(`  Extra: ${extraFields.join(", ")}`);
    process.exit(1);
  }
}

function assertCompactDefault(label, response, forbiddenNeedles) {
  const body = JSON.stringify(response);
  const leaked = forbiddenNeedles.filter((needle) => body.includes(needle));
  if (leaked.length > 0) {
    console.error(`${label} default menu leaked detail content: ${leaked.join(", ")}`);
    process.exit(1);
  }
}

function heavyTemplate() {
  return {
    id: "template.heavy",
    title: "Heavy template",
    summary: "Compact summary",
    pack: "core",
    lifecycle: "draft",
    risk: "safe",
    entity_kind: "project",
    tags: ["atomic"],
    inputSchema: { body: "hidden-heavy-body" },
    outputSchema: { body: "hidden-heavy-body" },
    examples: [{ body: "hidden-heavy-body" }],
    expectedDelta: { body: "hidden-heavy-body" },
  };
}

function heavyRecipe() {
  return {
    id: "recipe.heavy",
    title: "Heavy recipe",
    summary: "Compact summary",
    pack: "official",
    lifecycle: "draft",
    risk: "safe",
    entity_kind: "project",
    tags: ["workflow"],
    steps: [{ body: "hidden-heavy-body" }],
    assertions: [{ body: "hidden-heavy-body" }],
    recovery: [{ body: "hidden-heavy-body" }],
  };
}

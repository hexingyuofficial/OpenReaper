import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FOUNDATION_BRIDGE_OPERATION_FAMILIES,
  FOUNDATION_BRIDGE_PACK_IDS,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ARTIFACT_MODES,
  TEMPLATE_DESCRIPTOR_BRIDGE_IDEMPOTENCY_VALUES,
  TEMPLATE_DESCRIPTOR_BUDGETS,
  TEMPLATE_DESCRIPTOR_CONTRACT,
  TEMPLATE_DESCRIPTOR_DETAIL_FIELDS,
  TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
  TEMPLATE_DESCRIPTOR_EXPECTED_DELTA_KINDS,
  TEMPLATE_DESCRIPTOR_LIFECYCLES,
  TEMPLATE_DESCRIPTOR_PRESSURE_FIXTURE_CATEGORIES,
  TEMPLATE_DESCRIPTOR_RISKS,
  TEMPLATE_DESCRIPTOR_VERIFICATION_MODES,
  TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS,
} from "../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_DETAIL_FIELDS,
  TEMPLATE_SUMMARY_FIELDS,
} from "../packages/mcp-server/src/discovery-menu-v1.mjs";

const root = process.cwd();
const abiPath = path.join(root, "docs/abi/TEMPLATE_AUTHORING_ABI_V1.md");
const guidePath = path.join(root, "docs/guides/TEMPLATE_AUTHORING_GUIDE.md");

const abi = readFileSync(abiPath, "utf8");
const guide = readFileSync(guidePath, "utf8");

const requiredAbiNeedles = [
  "## 4A Descriptor Contract",
  `"contract": "${TEMPLATE_DESCRIPTOR_CONTRACT}"`,
  "template.<pack>.<lower_snake_segments>",
  "Title budget",
  "Summary budget",
  "Descriptor budget",
  "Discovery Summary Fields",
  "Full Descriptor Fields",
  "Bridge Operation Declaration",
  "Input Schema Shape",
  "Output Schema Shape",
  "Refs Declaration",
  "Artifacts Declaration",
  "Expected Delta Declaration",
  "Verification Declaration",
  "Examples Declaration",
  "Pressure Fixture Metadata",
  "4A does not implement `call_template` runtime",
];

const requiredGuideNeedles = [
  "## Reading A Descriptor",
  "## Writing A Descriptor",
  "Choose exactly one primary pack owner",
  "Do not use workflow-shaped pack names",
  "Keep compact discovery separate from full descriptors",
  "Run `npm run check:template-authoring`",
];

assertNeedles("TEMPLATE_AUTHORING_ABI_V1.md", abi, requiredAbiNeedles);
assertNeedles("TEMPLATE_AUTHORING_GUIDE.md", guide, requiredGuideNeedles);
assertDocList("ABI lifecycle values", abi, TEMPLATE_DESCRIPTOR_LIFECYCLES);
assertDocList("ABI risk values", abi, TEMPLATE_DESCRIPTOR_RISKS);
assertDocList("ABI fixed packs", abi, FOUNDATION_BRIDGE_PACK_IDS);
assertDocList("ABI operation families", abi, FOUNDATION_BRIDGE_OPERATION_FAMILIES);
assertDocList("ABI idempotency values", abi, TEMPLATE_DESCRIPTOR_BRIDGE_IDEMPOTENCY_VALUES);
assertDocList("ABI artifact modes", abi, TEMPLATE_DESCRIPTOR_ARTIFACT_MODES);
assertDocList("ABI expected delta kinds", abi, TEMPLATE_DESCRIPTOR_EXPECTED_DELTA_KINDS);
assertDocList("ABI verification modes", abi, TEMPLATE_DESCRIPTOR_VERIFICATION_MODES);
assertDocList("ABI pressure fixture categories", abi, TEMPLATE_DESCRIPTOR_PRESSURE_FIXTURE_CATEGORIES);
assertDocList("ABI workflow-shaped pack guard", abi, TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS);
assertDocList("ABI discovery summary fields", abi, TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS);
assertDocList("ABI detail fields", abi, TEMPLATE_DESCRIPTOR_DETAIL_FIELDS);

if (JSON.stringify(TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS) !== JSON.stringify(TEMPLATE_SUMMARY_FIELDS)) {
  console.error("Template descriptor summary fields must match the frozen discovery menu summary fields.");
  process.exit(1);
}

if (JSON.stringify(TEMPLATE_DESCRIPTOR_DETAIL_FIELDS) !== JSON.stringify(TEMPLATE_DETAIL_FIELDS)) {
  console.error("Template descriptor detail fields must match the frozen discovery menu detail fields.");
  process.exit(1);
}

for (const [key, value] of Object.entries(TEMPLATE_DESCRIPTOR_BUDGETS)) {
  if (!abi.includes(`${key}: ${value}`)) {
    console.error(`TEMPLATE_AUTHORING_ABI_V1.md is missing descriptor budget: ${key}: ${value}`);
    process.exit(1);
  }
}

execFileSync(process.execPath, ["--test", "tests/layer4a/template-descriptor.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Template Authoring ABI 4A descriptor contract ok.");

function assertNeedles(label, text, needles) {
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length === 0) return;

  console.error(`${label} is missing required text:`);
  for (const needle of missing) console.error(`- ${needle}`);
  process.exit(1);
}

function assertDocList(label, text, values) {
  const missing = values.filter((value) => !text.includes(value));
  if (missing.length === 0) return;

  console.error(`${label} missing values:`);
  for (const value of missing) console.error(`- ${value}`);
  process.exit(1);
}

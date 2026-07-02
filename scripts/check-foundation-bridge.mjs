import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  FOUNDATION_BRIDGE_ERROR_CODES,
  FOUNDATION_BRIDGE_OPERATION_FAMILIES,
  FOUNDATION_BRIDGE_PACK_IDS,
  FOUNDATION_BRIDGE_REF_KINDS,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../packages/mcp-server/src/tool-abi-v1.mjs";

const root = process.cwd();
const docPath = path.join(root, "docs/abi/FOUNDATION_BRIDGE_ABI_V1.md");
const doc = readFileSync(docPath, "utf8");

const requiredNeedles = [
  "Status: frozen by the Layer 2 Foundation / Bridge ABI v1 gate.",
  `"contract": "${FOUNDATION_BRIDGE_CONTRACT}"`,
  "fixed kernel contract",
  "Packs do not add bridge operation families.",
  "Request Envelope",
  "Result Envelope",
  "Object Refs",
  "Typed Errors",
  "Bridge Owner And Generation",
  "Undo Contract",
  "Verification Contract",
  "Artifact Contract",
  "Response Budget Contract",
  "Idempotency Contract",
  "Queue, Concurrency, And Timeout Contract",
  "Bounded Last Result Contract",
  "Representative Pack Pressure Scenarios",
  "does not add MCP tools",
];

const missing = requiredNeedles.filter((needle) => !doc.includes(needle));
if (missing.length > 0) {
  console.error("Foundation/Bridge ABI doc is missing required text:");
  for (const needle of missing) console.error(`- ${needle}`);
  process.exit(1);
}

assertDocList("operation families", FOUNDATION_BRIDGE_OPERATION_FAMILIES);
assertDocList("object ref kinds", FOUNDATION_BRIDGE_REF_KINDS);
assertDocList("typed error codes", FOUNDATION_BRIDGE_ERROR_CODES);
assertDocList("fixed pack ids", FOUNDATION_BRIDGE_PACK_IDS);

assertStrictToolSet(TOOL_ABI_V1_TOOL_NAMES, [
  "ping",
  "get_state",
  "list_templates",
  "list_recipes",
  "call_template",
]);

execFileSync(process.execPath, ["--test", "tests/layer2/foundation-bridge.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Foundation / Bridge ABI v1 ok.");

function assertDocList(label, values) {
  const missingValues = values.filter((value) => !doc.includes(value));
  if (missingValues.length > 0) {
    console.error(`FOUNDATION_BRIDGE_ABI_V1.md is missing ${label}:`);
    for (const value of missingValues) console.error(`- ${value}`);
    process.exit(1);
  }
}

function assertStrictToolSet(actualNames, expectedNames) {
  const actual = new Set(actualNames);
  const expected = new Set(expectedNames);
  const missingTools = expectedNames.filter((name) => !actual.has(name));
  const extraTools = actualNames.filter((name) => !expected.has(name));
  if (missingTools.length > 0 || extraTools.length > 0) {
    console.error("Layer 2 must not change the Tool ABI v1 MCP tool set.");
    if (missingTools.length > 0) console.error(`  Missing: ${missingTools.join(", ")}`);
    if (extraTools.length > 0) console.error(`  Extra: ${extraTools.join(", ")}`);
    process.exit(1);
  }
}

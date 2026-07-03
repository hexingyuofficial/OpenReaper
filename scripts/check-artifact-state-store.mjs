import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_LAST_RESULT_POLICY,
  ARTIFACT_READ_VIEWS,
  ARTIFACT_STATE_STORE_BUDGETS,
  ARTIFACT_STATE_STORE_CONTRACT,
  ARTIFACT_STATE_STORE_ERROR_CODES,
  ARTIFACT_STATE_STORE_TTL_POLICY,
  ARTIFACT_STATE_STORE_WORKFLOW_SHAPED_IDS,
} from "../packages/core/src/artifact-state-store-v1.mjs";
import { FOUNDATION_BRIDGE_PACK_IDS } from "../packages/core/src/foundation-bridge-v1.mjs";
import { TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS } from "../packages/core/src/template-descriptor-v1.mjs";
import {
  GET_STATE_ARTIFACT_SCOPE,
  GET_STATE_RUNTIME_CONTRACT,
} from "../packages/mcp-server/src/get-state-runtime-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../packages/mcp-server/src/tool-abi-v1.mjs";

const root = process.cwd();
const abiPath = path.join(root, "docs/abi/ARTIFACT_STATE_STORE_V1.md");
const abi = readFileSync(abiPath, "utf8");

const requiredNeedles = [
  "# Artifact / State Store v1",
  "Layer 4.5A",
  "Layer 4.5B",
  `"contract": "${ARTIFACT_STATE_STORE_CONTRACT}"`,
  `"contract": "${GET_STATE_RUNTIME_CONTRACT}"`,
  "artifact:<owner_pack>:<scope>:<id>",
  "^art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$",
  "<artifact_root>/<owner_pack>/<scope>/<id>.json",
  "Summary And Payload Reads",
  "`get_state(scope:\"artifact\")`",
  "runtime/helper",
  "not a",
  "live artifact helper",
  "TTL Sweep Policy Shape",
  "Last Result Policy",
  "Artifact producers and artifact reads must not create public",
  "does not add Foundation / Bridge error codes",
  "add MCP tools",
  "edit `reaper/bridge/**`",
  "Layer 4.5A does not implement `get_state(scope:\"artifact\")`",
  "Layer 4.5B does not connect artifact",
  "reads or writes to `call_template`",
  "start or modify Layer 6",
];

assertNeedles("ARTIFACT_STATE_STORE_V1.md", abi, requiredNeedles);
assertDocList("ABI fixed packs", abi, FOUNDATION_BRIDGE_PACK_IDS);
assertDocList("ABI workflow-shaped ids", abi, ARTIFACT_STATE_STORE_WORKFLOW_SHAPED_IDS);
assertDocList("ABI read views", abi, ARTIFACT_READ_VIEWS);
assertDocList("ABI error codes", abi, ARTIFACT_STATE_STORE_ERROR_CODES);

if (GET_STATE_ARTIFACT_SCOPE !== "artifact") {
  console.error("Layer 4.5B get_state artifact projection must bind only scope artifact.");
  process.exit(1);
}

if (JSON.stringify(ARTIFACT_STATE_STORE_WORKFLOW_SHAPED_IDS) !== JSON.stringify(TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS)) {
  console.error("Artifact state-store workflow-shaped guard must match template descriptor guard.");
  process.exit(1);
}

for (const [key, value] of Object.entries(ARTIFACT_STATE_STORE_BUDGETS)) {
  if (!abi.includes(`${key}: ${value}`)) {
    console.error(`ARTIFACT_STATE_STORE_V1.md is missing budget: ${key}: ${value}`);
    process.exit(1);
  }
}

for (const [key, value] of Object.entries(ARTIFACT_STATE_STORE_TTL_POLICY)) {
  if (typeof value === "number" && !abi.includes(`${key}: ${value}`)) {
    console.error(`ARTIFACT_STATE_STORE_V1.md is missing TTL policy: ${key}: ${value}`);
    process.exit(1);
  }
}

for (const [key, value] of Object.entries(ARTIFACT_LAST_RESULT_POLICY)) {
  if (!abi.includes(`${key}: ${value}`)) {
    console.error(`ARTIFACT_STATE_STORE_V1.md is missing last-result policy: ${key}: ${value}`);
    process.exit(1);
  }
}

assertStrictToolSet(TOOL_ABI_V1_TOOL_NAMES, [
  "ping",
  "get_state",
  "list_templates",
  "list_recipes",
  "call_template",
]);

execFileSync(process.execPath, ["--test", "tests/layer4_5a/artifact-state-store.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4_5b/get-state-artifact-projection.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Artifact / State Store v1 checks ok.");

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

function assertStrictToolSet(actualNames, expectedNames) {
  const actual = new Set(actualNames);
  const expected = new Set(expectedNames);
  const missingTools = expectedNames.filter((name) => !actual.has(name));
  const extraTools = actualNames.filter((name) => !expected.has(name));
  if (missingTools.length > 0 || extraTools.length > 0) {
    console.error("Layer 4.5A must not change the Tool ABI v1 MCP tool set.");
    if (missingTools.length > 0) console.error(`  Missing: ${missingTools.join(", ")}`);
    if (extraTools.length > 0) console.error(`  Extra: ${extraTools.join(", ")}`);
    process.exit(1);
  }
}

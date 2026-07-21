import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FOUNDATION_BRIDGE_PACK_IDS } from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  RECIPE_ASSERTION_KINDS,
  RECIPE_BUDGETS,
  RECIPE_CHECKPOINT_RESUME_POLICIES,
  RECIPE_CONTRACT,
  RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS,
  RECIPE_CONTRACT_HELD_TEMPLATE_IDS,
  RECIPE_CONTRACT_SEED_ONLY_TEMPLATE_IDS,
  RECIPE_DETAIL_FIELDS,
  RECIPE_DISCOVERY_SUMMARY_FIELDS,
  RECIPE_EVIDENCE_TIMESTAMP_POLICIES,
  RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS,
  RECIPE_LIFECYCLES,
  RECIPE_RECOVERY_BRANCH_TRIGGERS,
  RECIPE_RECOVERY_STRATEGIES,
  RECIPE_RISKS,
  RECIPE_RISK_GATE_POLICIES,
  RECIPE_RUN_STATE_CONTRACT,
  RECIPE_RUN_STATES,
  RECIPE_STEP_IDEMPOTENCY_KEY_SCOPES,
  RECIPE_STEP_IDEMPOTENCY_MODES,
  RECIPE_STEP_IDEMPOTENCY_RESUME_POLICIES,
  RECIPE_STEP_USES,
  RECIPE_TEMPLATE_EVIDENCE_CONTRACT,
  RECIPE_TERMINAL_RUN_STATES,
} from "../packages/core/src/recipe-contract-v1.mjs";
import {
  EXECUTABLE_RECIPE_BUDGETS,
  EXECUTABLE_RECIPE_DEPENDENCY_KINDS,
  EXECUTABLE_RECIPE_DEPENDENCY_LOCK_CONTRACT,
  EXECUTABLE_RECIPE_DRAFT_CONTRACT,
  EXECUTABLE_RECIPE_FORBIDDEN_FIELDS,
  EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT,
  EXECUTABLE_RECIPE_REVISION_CONTRACT,
  EXECUTABLE_RECIPE_TEMPLATE_FALLBACK_REASONS,
  EXECUTABLE_RECIPE_TRUST_CONTRACT,
  EXECUTABLE_RECIPE_TRUST_INVALIDATION_REASONS,
  EXECUTABLE_RECIPE_VALIDATION_CONTRACT,
} from "../packages/core/src/executable-recipe-contract-v1.mjs";
import { TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS } from "../packages/core/src/template-descriptor-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
  CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  RECIPE_DETAIL_FIELDS as DISCOVERY_RECIPE_DETAIL_FIELDS,
  RECIPE_SUMMARY_FIELDS,
} from "../packages/mcp-server/src/discovery-menu-v1.mjs";

const root = process.cwd();
const abiPath = path.join(root, "docs/abi/RECIPE_CONTRACT_V1.md");
const abi = readFileSync(abiPath, "utf8");

const requiredNeedles = [
  "# Recipe Contract v1",
  `"contract": "${RECIPE_CONTRACT}"`,
  `"contract": "${RECIPE_RUN_STATE_CONTRACT}"`,
  `"source": "${RECIPE_TEMPLATE_EVIDENCE_CONTRACT}"`,
  "A recipe is a workflow contract",
  "not a hidden server-side executor",
  "Agents discover recipes through `list_recipes`",
  "Layer 5 does not expand the frozen Layer 1.5 recipe discovery detail field set",
  "recipe.<pack>.<lower_snake_segments>",
  "Primary Pack Ownership",
  "Template Dependencies",
  "Assertions And Expected Outputs",
  "Recovery",
  "Run State",
  "Checkpoints",
  "Evidence Requirements",
  "Idempotency Expectations",
  "Resume Rules",
  "Recipe-Level Risk Gates",
  "Forbidden Bypass Surfaces",
  "Alpha3.4-E0 Executable Recipe Revision Extension",
  EXECUTABLE_RECIPE_DRAFT_CONTRACT,
  EXECUTABLE_RECIPE_REVISION_CONTRACT,
  EXECUTABLE_RECIPE_VALIDATION_CONTRACT,
  EXECUTABLE_RECIPE_DEPENDENCY_LOCK_CONTRACT,
  EXECUTABLE_RECIPE_TRUST_CONTRACT,
  EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT,
  "Macro-First Dependency Rule",
  "Trust Invalidation",
  "does not register `call_recipe`",
  "Non-Goals",
  `${RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS.length} templates total`,
];

assertNeedles("RECIPE_CONTRACT_V1.md", abi, requiredNeedles);
assertDocList("ABI fixed packs", abi, FOUNDATION_BRIDGE_PACK_IDS);
assertDocList("ABI workflow-shaped pack guard", abi, TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS);
assertDocList("ABI lifecycle values", abi, RECIPE_LIFECYCLES);
assertDocList("ABI risk values", abi, RECIPE_RISKS);
assertDocList("ABI discovery summary fields", abi, RECIPE_DISCOVERY_SUMMARY_FIELDS);
assertDocList("ABI detail fields", abi, RECIPE_DETAIL_FIELDS);
assertDocList("ABI step uses", abi, RECIPE_STEP_USES);
assertDocList("ABI assertion kinds", abi, RECIPE_ASSERTION_KINDS);
assertDocList("ABI run states", abi, RECIPE_RUN_STATES);
assertDocList("ABI terminal run states", abi, RECIPE_TERMINAL_RUN_STATES);
assertDocList("ABI step idempotency modes", abi, RECIPE_STEP_IDEMPOTENCY_MODES);
assertDocList("ABI idempotency key scopes", abi, RECIPE_STEP_IDEMPOTENCY_KEY_SCOPES);
assertDocList("ABI step idempotency resume policies", abi, RECIPE_STEP_IDEMPOTENCY_RESUME_POLICIES);
assertDocList("ABI checkpoint resume policies", abi, RECIPE_CHECKPOINT_RESUME_POLICIES);
assertDocList("ABI evidence timestamp policies", abi, RECIPE_EVIDENCE_TIMESTAMP_POLICIES);
assertDocList("ABI recovery branch triggers", abi, RECIPE_RECOVERY_BRANCH_TRIGGERS);
assertDocList("ABI recovery strategies", abi, RECIPE_RECOVERY_STRATEGIES);
assertDocList("ABI risk gate policies", abi, RECIPE_RISK_GATE_POLICIES);
assertDocList("ABI forbidden raw execution fields", abi, RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS);
assertDocList("ABI executable dependency kinds", abi, EXECUTABLE_RECIPE_DEPENDENCY_KINDS);
assertDocList("ABI executable template fallback reasons", abi, EXECUTABLE_RECIPE_TEMPLATE_FALLBACK_REASONS);
assertDocList("ABI executable trust invalidation reasons", abi, EXECUTABLE_RECIPE_TRUST_INVALIDATION_REASONS);
assertDocList("ABI executable forbidden fields", abi, EXECUTABLE_RECIPE_FORBIDDEN_FIELDS);

for (const [key, value] of Object.entries(RECIPE_BUDGETS)) {
  if (!abi.includes(`${key}: ${value}`)) {
    console.error(`RECIPE_CONTRACT_V1.md is missing recipe budget: ${key}: ${value}`);
    process.exit(1);
  }
}

for (const [key, value] of Object.entries(EXECUTABLE_RECIPE_BUDGETS)) {
  if (!abi.includes(`${key}: ${value}`)) {
    console.error(`RECIPE_CONTRACT_V1.md is missing executable recipe budget: ${key}: ${value}`);
    process.exit(1);
  }
}

if (JSON.stringify(RECIPE_DISCOVERY_SUMMARY_FIELDS) !== JSON.stringify(RECIPE_SUMMARY_FIELDS)) {
  console.error("Recipe summary fields must match the frozen discovery menu summary fields.");
  process.exit(1);
}

if (JSON.stringify(RECIPE_DETAIL_FIELDS) !== JSON.stringify(DISCOVERY_RECIPE_DETAIL_FIELDS)) {
  console.error("Recipe detail fields must match the frozen discovery menu detail fields.");
  process.exit(1);
}

if (JSON.stringify(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS) !== JSON.stringify(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS)) {
  console.error("Recipe accepted template dependency ids must match Layer 4D runtime accepted ids.");
  process.exit(1);
}

if (JSON.stringify(RECIPE_CONTRACT_SEED_ONLY_TEMPLATE_IDS) !== JSON.stringify(CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS)) {
  console.error("Recipe seed-only template rejection set must match Layer 4D runtime seed-only ids.");
  process.exit(1);
}

if (JSON.stringify(RECIPE_CONTRACT_HELD_TEMPLATE_IDS) !== JSON.stringify(CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS)) {
  console.error("Recipe held template rejection set must match Layer 4D runtime held ids.");
  process.exit(1);
}

if (RECIPE_TEMPLATE_EVIDENCE_CONTRACT !== CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT) {
  console.error("Recipe evidence source must match Layer 4D template.runtime.evidence.v1.");
  process.exit(1);
}

execFileSync(process.execPath, ["--test", "tests/layer5/recipe-contract.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Recipe Contract v1 checks ok.");

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

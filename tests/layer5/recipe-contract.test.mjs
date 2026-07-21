import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  RECIPE_CONTRACT,
  RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS,
  RECIPE_CONTRACT_HELD_TEMPLATE_IDS,
  RECIPE_CONTRACT_SEED_ONLY_TEMPLATE_IDS,
  RECIPE_DETAIL_FIELDS,
  RECIPE_DISCOVERY_SUMMARY_FIELDS,
  RECIPE_RUN_STATES,
  RECIPE_TEMPLATE_EVIDENCE_CONTRACT,
  RECIPE_TERMINAL_RUN_STATES,
  RECIPE_WORKFLOW_CARD_FIELDS,
  RecipeContractValidationError,
  createRecipeCatalog,
  createRecipeCatalogDiscovery,
  normalizeRecipeContract,
  recipeContractDiscoverySummary,
  recipeContractOnDemandFields,
  recipeExpectedOutputs,
  recipeTemplateDependencies,
  validateRecipeContract,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT,
  CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  DiscoveryMenuRequestError,
  RECIPE_DETAIL_FIELDS as DISCOVERY_RECIPE_DETAIL_FIELDS,
  RECIPE_SUMMARY_FIELDS,
  createDiscoveryCatalog,
} from "../../packages/mcp-server/src/discovery-menu-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Layer 5 Recipe Contract v1", () => {
  it("normalizes a workflow contract without creating an executor", () => {
    const recipe = makeRecipe();
    const validation = validateRecipeContract(recipe);
    const normalized = normalizeRecipeContract(recipe);

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(normalized.contract, RECIPE_CONTRACT);
    assert.equal(Object.isFrozen(normalized), true);
    assert.deepEqual(recipeTemplateDependencies(recipe), ["template.tracks.create_track"]);
    assert.deepEqual(recipeExpectedOutputs(recipe), [
      {
        refs: ["track_ref"],
        artifacts: [],
        jobs: [],
        state: ["track"],
      },
    ]);

    const catalog = createRecipeCatalog({ recipes: [recipe] });
    assert.equal(catalog.contract, "recipe.catalog.v1");
    assert.equal(catalog.size, 1);
    assert.equal(typeof catalog.execute, "undefined");
    assert.equal(typeof catalog.run, "undefined");
  });

  it("fits the frozen Layer 1.5 recipe menu fields with compact workflow cards", () => {
    assert.deepEqual(RECIPE_DISCOVERY_SUMMARY_FIELDS, RECIPE_SUMMARY_FIELDS);
    assert.deepEqual(RECIPE_DETAIL_FIELDS, DISCOVERY_RECIPE_DETAIL_FIELDS);

    const summary = recipeContractDiscoverySummary(makeRecipe());
    assert.deepEqual(Object.keys(summary), RECIPE_DISCOVERY_SUMMARY_FIELDS);
    assert.deepEqual(Object.keys(summary.workflow_card), RECIPE_WORKFLOW_CARD_FIELDS);
    assert.equal("steps" in summary, false);
    assert.equal("assertions" in summary, false);
    assert.equal("recovery" in summary, false);

    const detail = recipeContractOnDemandFields(makeRecipe(), ["steps", "recovery"]);
    assert.deepEqual(Object.keys(detail).sort(), ["id", "recovery", "steps"]);

    const discovery = createRecipeCatalogDiscovery(
      createRecipeCatalog({ recipes: syntheticRecipes(100) }),
      createDiscoveryCatalog,
    );
    const largerDiscovery = createRecipeCatalogDiscovery(
      createRecipeCatalog({ recipes: syntheticRecipes(1_000) }),
      createDiscoveryCatalog,
    );
    const menu = discovery.list_recipes();
    const largerMenu = largerDiscovery.list_recipes();

    assert.equal(JSON.stringify(menu), JSON.stringify(largerMenu));
    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "recipe_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, 25);
    assert.equal(menu.page.has_more, true);
    assert.equal("total" in menu.page, false);
    assert.equal(menu.items[0].workflow_card.intent.includes("Prepare dialog track"), true);
    assert.equal(menu.items[0].workflow_card.token_budget.same_typed_blocker_stop_after, 2);
    assert.deepEqual(menu.applied.fields, RECIPE_DISCOVERY_SUMMARY_FIELDS);
    assert.equal("steps" in menu.items[0], false);
    assert.equal("assertions" in menu.items[0], false);
    assert.equal("recovery" in menu.items[0], false);
    assert.doesNotMatch(JSON.stringify(menu), /create_dialog_track|evidence_create_dialog_track/);

    const exact = discovery.list_recipes({
      ids: ["recipe.tracks.prepare_dialog_track_0003"],
      fields: ["steps", "assertions", "recovery"],
    });
    assert.equal(exact.mode, "ids");
    assert.deepEqual(Object.keys(exact.items[0]).sort(), ["assertions", "id", "recovery", "steps"]);

    assert.throws(
      () => discovery.list_recipes({ fields: ["steps"] }),
      DiscoveryMenuRequestError,
    );

    const exactCard = discovery.list_recipes({
      ids: ["recipe.tracks.prepare_dialog_track_0003"],
      fields: ["workflow_card"],
    });
    assert.deepEqual(Object.keys(exactCard.items[0]).sort(), ["id", "workflow_card"]);
  });

  it("validates lightweight workflow cards without adding recipe execution authority", () => {
    const recipe = makeRecipe();
    assert.equal(validateRecipeContract(recipe).ok, true);
    assert.deepEqual(recipe.workflow_card.template_atoms, ["template.tracks.create_track"]);
    assert.match(recipe.workflow_card.blocked_steps.join("\n"), /call_recipe/);
    assert.equal(recipe.workflow_card.token_budget.same_typed_blocker_stop_after, 2);

    const undeclaredAtom = makeRecipe();
    undeclaredAtom.workflow_card.template_atoms = ["template.project.read_summary"];
    assert.match(
      validateRecipeContract(undeclaredAtom).errors.join("\n"),
      /must be one of the recipe's declared call_template steps/,
    );

    const badBlockerBudget = makeRecipe();
    badBlockerBudget.workflow_card.token_budget.same_typed_blocker_stop_after = 3;
    assert.match(
      validateRecipeContract(badBlockerBudget).errors.join("\n"),
      /same_typed_blocker_stop_after must be 2/,
    );
  });

  it("limits recipe steps to Layer 4D accepted official template ids", () => {
    assert.deepEqual(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS, CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);
    assert.deepEqual(RECIPE_CONTRACT_SEED_ONLY_TEMPLATE_IDS, CALL_TEMPLATE_RUNTIME_SEED_ONLY_TEMPLATE_IDS);
    assert.deepEqual(RECIPE_CONTRACT_HELD_TEMPLATE_IDS, CALL_TEMPLATE_RUNTIME_HELD_TEMPLATE_IDS);
    assert.equal(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS.length, CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.length);

    assertRejectsTemplateId("template.tracks.not_in_catalog", /unknown or non-accepted template id/);
    assertRejectsTemplateId("template.core.read_health", /seed-only template id/);
    assertRejectsTemplateId("template.core.read_template_coverage_summary", /held template id/);
    assertRejectsTemplateId("template.loop.cleanup_project", /workflow-shaped template pack metadata/);
    assertRejectsTemplateId("lua:reaper.Main_OnCommand(40044, 0)", /raw execution-looking template id/);
    assertRejectsTemplateId("run_command", /raw execution-looking template id/);
  });

  it("rejects workflow-shaped recipe pack metadata while allowing workflow tags", () => {
    const tagged = makeRecipe({ tags: ["track", "cleanup"] });
    assert.deepEqual(validateRecipeContract(tagged).errors, []);

    const workflowPack = makeRecipe({
      id: "recipe.loop.prepare_dialog_track",
      pack: "loop",
    });
    const errors = validateRecipeContract(workflowPack).errors.join("\n");

    assert.match(errors, /Workflow-shaped pack ids are forbidden as recipe pack metadata: loop/);
    assert.match(errors, /Workflow-shaped recipe id pack segment is forbidden: loop/);
  });

  it("validates run state, checkpoints, evidence, idempotency, resume, and risk gates", () => {
    const recipe = makeRecipe();
    const recovery = recipe.recovery;

    assert.equal(recovery.run_state.contract, "recipe.run_state.v1");
    assert.deepEqual(recovery.run_state.states, RECIPE_RUN_STATES);
    assert.deepEqual(recovery.run_state.terminal, RECIPE_TERMINAL_RUN_STATES);
    assert.equal(recovery.evidence_requirements[0].source, RECIPE_TEMPLATE_EVIDENCE_CONTRACT);
    assert.equal(RECIPE_TEMPLATE_EVIDENCE_CONTRACT, CALL_TEMPLATE_RUNTIME_EVIDENCE_CONTRACT);
    assert.equal(recovery.evidence_requirements[0].require_request_id, true);
    assert.equal(recovery.resume.from_checkpoint, "latest_verified");
    assert.equal(recovery.idempotency.on_replay, "reuse_verified_evidence");

    const missingCheckpointEvidence = makeRecipe();
    missingCheckpointEvidence.recovery.checkpoints[1].required_evidence = [];
    assert.match(
      validateRecipeContract(missingCheckpointEvidence).errors.join("\n"),
      /must be required by a checkpoint/,
    );

    const wrongEvidenceSource = makeRecipe();
    wrongEvidenceSource.recovery.evidence_requirements[0].source = "template.execution.v1";
    assert.match(
      validateRecipeContract(wrongEvidenceSource).errors.join("\n"),
      /source must be template\.runtime\.evidence\.v1/,
    );

    const readOnlyTemplateStep = makeRecipe();
    readOnlyTemplateStep.steps[1].idempotency = {
      mode: "read_only",
      key_scope: "none",
      on_resume: "rerun",
    };
    assert.match(
      validateRecipeContract(readOnlyTemplateStep).errors.join("\n"),
      /read_only is reserved for get_state steps/,
    );

    const missingRiskGate = makeRecipe();
    missingRiskGate.recovery.risk_gates = [];
    assert.match(
      validateRecipeContract(missingRiskGate).errors.join("\n"),
      /write recipes must declare at least one matching recipe-level risk gate/,
    );

    const destructiveWithoutConfirmation = makeRecipe({
      id: "recipe.render.destructive_delivery",
      pack: "render",
      risk: "destructive",
      steps: [
        {
          ...makeRecipe().steps[1],
          id: "create_dialog_track",
          checkpoint: "checkpoint_create_dialog_track",
          evidence: "evidence_create_dialog_track",
        },
      ],
    });
    destructiveWithoutConfirmation.recovery.checkpoints = [destructiveWithoutConfirmation.recovery.checkpoints[1]];
    destructiveWithoutConfirmation.recovery.risk_gates = [
      {
        id: "gate_destructive",
        applies_to: ["destructive"],
        required_before_step: "create_dialog_track",
        policy: "fresh_state",
        blocks_auto_resume: true,
        summary: "Require a fresh state read before destructive work.",
      },
    ];
    assert.match(
      validateRecipeContract(destructiveWithoutConfirmation).errors.join("\n"),
      /destructive recipes require a blocking user_confirmation risk gate/,
    );
  });

  it("rejects raw Lua, raw action, shell, descriptor, and bridge bypass-shaped recipe fields", () => {
    const rawLua = makeRecipe();
    rawLua.steps[1].call_template.input.lua = "reaper.Main_OnCommand(40044, 0)";
    assert.match(validateRecipeContract(rawLua).errors.join("\n"), /forbidden raw execution or bypass field/);

    const bridgeRequest = makeRecipe();
    bridgeRequest.steps[1].call_template.bridge_request = { operation: "run_command" };
    assert.match(validateRecipeContract(bridgeRequest).errors.join("\n"), /forbidden raw execution or bypass field/);

    const rawDescriptor = makeRecipe({ descriptor: { id: "template.tracks.create_track" } });
    assert.match(validateRecipeContract(rawDescriptor).errors.join("\n"), /forbidden raw execution or bypass field/);
  });

  it("does not add MCP tools beyond call_recipe, live REAPER smoke, runtime Lua, or a hidden recipe executor", () => {
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_recipe",
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 6);

    const source = readFileSync(
      new URL("../../packages/core/src/recipe-contract-v1.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /executeRecipe|runRecipe|server-side recipe executor/i);
    assert.doesNotMatch(source, /child_process|spawn\(|execFile|REAPER\.app|reaper\/bridge|runtime Lua/i);
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
  });

  it("preserves agent-stepped recipes after the Alpha3.4-E0/E2 executable extension", () => {
    const recipe = makeRecipe();
    assert.equal(validateRecipeContract(recipe).ok, true);
    assert.equal(normalizeRecipeContract(recipe).contract, RECIPE_CONTRACT);

    const abi = readFileSync(
      new URL("../../docs/abi/RECIPE_CONTRACT_V1.md", import.meta.url),
      "utf8",
    );
    assert.match(abi, /Alpha3\.4-E0 Executable Recipe Revision Extension/);
    assert.match(abi, /historical agent-stepped Recipe Contract v1 remains valid/);
    assert.match(abi, /Alpha3\.4-E2 Public `call_recipe` Runtime/);
    assert.match(abi, /adds exactly one sixth tool named `call_recipe`/);
    assert.match(abi, /recipe\.executable\.draft\.v1/);
    assert.match(abi, /recipe\.executable\.revision\.v1/);
  });
});

function assertRejectsTemplateId(id, pattern) {
  const recipe = makeRecipe();
  recipe.steps[1].call_template.id = id;
  recipe.recovery.evidence_requirements[0].template_id = id;
  assert.match(validateRecipeContract(recipe).errors.join("\n"), pattern, id);
}

function syntheticRecipes(count) {
  return Array.from({ length: count }, (_, index) => makeRecipe({
    id: `recipe.tracks.prepare_dialog_track_${String(index).padStart(4, "0")}`,
    title: `Prepare dialog track ${index}`,
    summary: `Workflow contract fixture ${index}.`,
  }));
}

function makeRecipe(overrides = {}) {
  const recipe = {
    contract: RECIPE_CONTRACT,
    id: "recipe.tracks.prepare_dialog_track",
    title: "Prepare dialog track",
    summary: "Read compact project state, create a dialog track, and retain compact evidence.",
    pack: "tracks",
    lifecycle: "validated",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "setup", "cleanup"],
    workflow_card: {
      intent: "Prepare dialog track with compact state, one accepted atom, and readback evidence.",
      entry_conditions: [
        "Use screenshot-first target disambiguation when a screenshot exists.",
        "Read bounded project state before mutating tracks.",
      ],
      supported_steps: [
        "Resolve refs before mutation.",
        "Call declared template atoms only.",
        "Perform one readback or evidence check after mutation.",
      ],
      candidate_steps: [
        "A2-C may add cleanup or delete parity when accepted atoms exist.",
      ],
      blocked_steps: [
        "Do not use public call_recipe or a hidden recipe executor.",
      ],
      required_questions: [
        "Ask when the target track or mutation scope is ambiguous.",
      ],
      template_atoms: ["template.tracks.create_track"],
      evidence_required: [
        "template.runtime.evidence.v1 with request id",
        "compact file evidence before long chat output",
      ],
      cleanup_plan: "Use returned refs for cleanup when delete atoms exist; otherwise report a typed blocker.",
      typed_blockers: ["no_public_call_recipe_executor"],
      token_budget: {
        menu_max_bytes: 4096,
        exact_max_bytes: 32768,
        compact_chat_max_items: 5,
        same_typed_blocker_stop_after: 2,
      },
    },
    steps: [
      {
        id: "read_project",
        title: "Read project",
        summary: "Read bounded state needed before mutating tracks.",
        uses: "get_state",
        call_template: null,
        get_state: {
          projection: "project.summary",
          refs: [],
        },
        checkpoint: "checkpoint_read_project",
        evidence: null,
        idempotency: {
          mode: "read_only",
          key_scope: "none",
          on_resume: "rerun",
        },
        on_failure: "branch_request_user",
      },
      {
        id: "create_dialog_track",
        title: "Create dialog track",
        summary: "Call the accepted track creation template.",
        uses: "call_template",
        call_template: {
          id: "template.tracks.create_track",
          input: {
            name: "Dialog",
          },
          refs: {},
        },
        get_state: null,
        checkpoint: "checkpoint_create_dialog_track",
        evidence: "evidence_create_dialog_track",
        idempotency: {
          mode: "supported",
          key_scope: "recipe_run",
          on_resume: "reuse_evidence",
        },
        on_failure: "branch_retry_create",
      },
    ],
    assertions: [
      {
        id: "assert_dialog_track_output",
        kind: "expected_output",
        summary: "The recipe returns or records a compact track ref expectation.",
        required: true,
        evidence: ["evidence_create_dialog_track"],
        outputs: {
          refs: ["track_ref"],
          artifacts: [],
          jobs: [],
          state: ["track"],
        },
      },
      {
        id: "assert_template_evidence",
        kind: "template_evidence",
        summary: "The call_template step must retain compact Layer 4D runtime evidence.",
        required: true,
        evidence: ["evidence_create_dialog_track"],
        outputs: {
          refs: [],
          artifacts: [],
          jobs: [],
          state: [],
        },
      },
    ],
    recovery: {
      run_state: {
        contract: "recipe.run_state.v1",
        initial: "not_started",
        states: [
          "not_started",
          "running",
          "paused",
          "succeeded",
          "failed",
          "blocked",
        ],
        terminal: [
          "succeeded",
          "failed",
          "blocked",
        ],
      },
      checkpoints: [
        {
          id: "checkpoint_read_project",
          after_step: "read_project",
          required_evidence: [],
          on_resume: "continue_next_step",
          summary: "Bounded state read completed; resume can continue to the template step.",
        },
        {
          id: "checkpoint_create_dialog_track",
          after_step: "create_dialog_track",
          required_evidence: ["evidence_create_dialog_track"],
          on_resume: "continue_next_step",
          summary: "The template step completed with compact runtime evidence.",
        },
      ],
      evidence_requirements: [
        {
          id: "evidence_create_dialog_track",
          step: "create_dialog_track",
          source: "template.runtime.evidence.v1",
          template_id: "template.tracks.create_track",
          require_ok: true,
          require_request_id: true,
          counts: {
            refs_min: 0,
            artifacts_min: 0,
            jobs_min: 0,
            last_result_refs_min: 0,
          },
          timestamps: "current_run",
        },
      ],
      idempotency: {
        scope: "recipe_run",
        default_step_policy: "follow_step_idempotency",
        on_resume: "skip_completed_checkpoints",
        on_replay: "reuse_verified_evidence",
      },
      resume: {
        from_checkpoint: "latest_verified",
        on_missing_evidence: "rerun_step",
        on_failed_evidence: "use_recovery_branch",
        on_risk_gate: "pause_for_user",
      },
      branches: [
        {
          id: "branch_retry_create",
          trigger: "template_error",
          step: "create_dialog_track",
          strategy: "retry_step",
          summary: "Retry only the failed accepted template step when evidence says it is recoverable.",
        },
        {
          id: "branch_request_user",
          trigger: "resume_conflict",
          step: null,
          strategy: "request_user",
          summary: "Pause for the agent or user when state recovery is ambiguous.",
        },
      ],
      risk_gates: [
        {
          id: "gate_write_fresh_state",
          applies_to: ["write"],
          required_before_step: "create_dialog_track",
          policy: "fresh_state",
          blocks_auto_resume: true,
          summary: "Require a fresh bounded state read before write-risk recipe work.",
        },
      ],
    },
  };

  return mergeRecipe(recipe, overrides);
}

function mergeRecipe(base, overrides) {
  const recipe = cloneJson(base);
  for (const [key, value] of Object.entries(overrides)) recipe[key] = cloneJson(value);
  return recipe;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

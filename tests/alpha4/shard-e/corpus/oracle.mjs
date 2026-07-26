import { createHash } from "node:crypto";

export const ORACLE_CONTRACT = "alpha4.shard-e.deterministic-oracle.v1";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const NORMAL_RECIPE_FIELDS = [
  "contract",
  "id",
  "title",
  "summary",
  "pack",
  "lifecycle",
  "risk",
  "entity_kind",
  "tags",
  "workflow_card",
  "steps",
  "assertions",
  "recovery",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(value, fields) {
  return isRecord(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

function hasIdentifier(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]*$/u.test(value);
}

function validateNormalRecipe(recipe) {
  const errors = [];
  if (!hasExactFields(recipe, NORMAL_RECIPE_FIELDS)) {
    errors.push("Recipe must contain the complete normal Recipe top-level shape.");
    return { ok: false, errors };
  }
  if (recipe.contract !== "recipe.contract.v1") errors.push("contract must be recipe.contract.v1.");
  if (typeof recipe.id !== "string" || !/^recipe\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,4}$/u.test(recipe.id)) {
    errors.push("id must be a normal Recipe id.");
  }
  for (const field of ["title", "summary", "pack", "lifecycle", "risk", "entity_kind"]) {
    if (typeof recipe[field] !== "string" || recipe[field].length === 0) errors.push(`${field} must be a non-empty string.`);
  }
  if (!Array.isArray(recipe.tags) || recipe.tags.length === 0 || recipe.tags.some((tag) => typeof tag !== "string")) {
    errors.push("tags must be a non-empty string array.");
  }

  const workflowFields = [
    "intent",
    "entry_conditions",
    "supported_steps",
    "candidate_steps",
    "blocked_steps",
    "required_questions",
    "template_atoms",
    "evidence_required",
    "cleanup_plan",
    "typed_blockers",
    "token_budget",
  ];
  if (!hasExactFields(recipe.workflow_card, workflowFields)) errors.push("workflow_card must be complete.");

  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    errors.push("steps must contain at least one step.");
  } else {
    const stepIds = new Set();
    const checkpointIds = new Set();
    const evidenceIds = new Set();
    const referencedBranchIds = new Set();
    for (const [index, step] of recipe.steps.entries()) {
      const field = `steps[${index}]`;
      const stepFields = [
        "id",
        "title",
        "summary",
        "uses",
        "call_template",
        "get_state",
        "checkpoint",
        "evidence",
        "idempotency",
        "on_failure",
      ];
      if (!hasExactFields(step, stepFields)) {
        errors.push(`${field} must be complete.`);
        continue;
      }
      if (!hasIdentifier(step.id) || stepIds.has(step.id)) errors.push(`${field}.id must be unique.`);
      stepIds.add(step.id);
      if (step.uses !== "call_template") errors.push(`${field}.uses must be call_template.`);
      if (!hasExactFields(step.call_template, ["id", "input", "refs"]) || !/^template\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/u.test(step.call_template.id ?? "")) {
        errors.push(`${field}.call_template must be a typed template call.`);
      }
      if (!isRecord(step.call_template?.input) || !isRecord(step.call_template?.refs)) errors.push(`${field}.call_template input/refs must be objects.`);
      if (step.get_state !== null) errors.push(`${field}.get_state must be null.`);
      if (!hasIdentifier(step.checkpoint) || checkpointIds.has(step.checkpoint)) errors.push(`${field}.checkpoint must be unique.`);
      checkpointIds.add(step.checkpoint);
      if (!hasIdentifier(step.evidence) || evidenceIds.has(step.evidence)) errors.push(`${field}.evidence must be unique.`);
      evidenceIds.add(step.evidence);
      if (!hasExactFields(step.idempotency, ["mode", "key_scope", "on_resume"]) || step.idempotency.mode !== "required") errors.push(`${field}.idempotency must require replay identity.`);
      if (!hasIdentifier(step.on_failure)) errors.push(`${field}.on_failure must reference a recovery branch.`);
      referencedBranchIds.add(step.on_failure);
    }

    const recovery = recipe.recovery;
    if (!hasExactFields(recovery, ["run_state", "checkpoints", "evidence_requirements", "idempotency", "resume", "branches", "risk_gates"])) {
      errors.push("recovery must be complete.");
    } else {
      if (!hasExactFields(recovery.run_state, ["contract", "initial", "states", "terminal"]) || recovery.run_state.contract !== "recipe.run_state.v1") errors.push("recovery.run_state must be structured.");
      if (!hasExactFields(recovery.idempotency, ["scope", "default_step_policy", "on_resume", "on_replay"])) errors.push("recovery.idempotency must be structured.");
      if (!hasExactFields(recovery.resume, ["from_checkpoint", "on_missing_evidence", "on_failed_evidence", "on_risk_gate"])) errors.push("recovery.resume must be structured.");
      if (!Array.isArray(recovery.checkpoints) || recovery.checkpoints.length !== recipe.steps.length) errors.push("recovery.checkpoints must cover every step.");
      if (!Array.isArray(recovery.evidence_requirements) || recovery.evidence_requirements.length !== recipe.steps.length) errors.push("recovery.evidence_requirements must cover every call step.");
      if (!Array.isArray(recovery.branches) || recovery.branches.length === 0) errors.push("recovery.branches must be non-empty.");
      if (!Array.isArray(recovery.risk_gates) || recovery.risk_gates.length === 0) errors.push("recovery.risk_gates must be non-empty.");
      const branchIds = new Set();
      for (const branch of recovery.branches ?? []) {
        if (!hasExactFields(branch, ["id", "trigger", "step", "strategy", "summary"]) || !hasIdentifier(branch.id) || branchIds.has(branch.id)) errors.push("recovery.branches must contain unique complete branches.");
        branchIds.add(branch.id);
      }
      for (const branchId of referencedBranchIds) {
        if (!branchIds.has(branchId)) errors.push(`step failure branch is not declared: ${branchId}.`);
      }
      for (const gate of recovery.risk_gates ?? []) {
        if (!hasExactFields(gate, ["id", "applies_to", "required_before_step", "policy", "blocks_auto_resume", "summary"])) errors.push("recovery.risk_gates must contain complete gates.");
      }
    }
  }
  if (!Array.isArray(recipe.assertions) || recipe.assertions.length === 0 || recipe.assertions.some((assertion) => !hasExactFields(assertion, ["id", "kind", "summary", "required", "evidence", "outputs"]))) {
    errors.push("assertions must contain complete normal assertion objects.");
  }
  return { ok: errors.length === 0, errors };
}

function exactIdentity(record) {
  return {
    recipe_id: record.recipe_id,
    version: record.version,
    revision: record.revision,
    content_hash: record.content_hash,
    validation_result_id: record.validation_result_id,
  };
}

function identityKey(identity) {
  return `${identity.recipe_id}@${identity.version}#${identity.revision}:${identity.content_hash}:${identity.validation_result_id}`;
}

function recipeForTrial(trial, supportedFacts) {
  const steps = supportedFacts.map((fact, index) => ({
    id: `step_${String(index + 1).padStart(2, "0")}`,
    title: `Apply ${fact.action}`,
    summary: `Apply the demonstrated ${fact.field} transformation to the bound target.`,
    uses: "call_template",
    call_template: {
      id: fact.template_id,
      input: { field: fact.field, value: clone(fact.after) },
      refs: { subject_ref: fact.subject_ref },
    },
    get_state: null,
    checkpoint: `checkpoint_${String(index + 1).padStart(2, "0")}`,
    evidence: `evidence_${String(index + 1).padStart(2, "0")}`,
    idempotency: {
      mode: "required",
      key_scope: "recipe_run",
      on_resume: "reuse_evidence",
    },
    on_failure: "branch_stop",
  }));
  return {
    contract: "recipe.contract.v1",
    id: `recipe.${trial.scenario.pack}.alpha4_e_${trial.trial_id.slice(-3)}`,
    title: `Learned ${trial.scenario_id} demonstration`,
    summary: "An immutable normal Recipe compiled from a demonstrated semantic transformation.",
    pack: trial.scenario.pack,
    lifecycle: "community",
    risk: "write",
    entity_kind: trial.scenario.entity_kind,
    tags: ["learned_operation", "alpha4_shard_e"],
    workflow_card: {
      intent: "Replay the demonstrated semantic transformation on fresh matching targets.",
      entry_conditions: ["Use exact target identity from the current bounded state."],
      supported_steps: ["Apply only supported identity-aware facts."],
      candidate_steps: ["Ask one compact question when a target intent remains ambiguous."],
      blocked_steps: ["Do not infer unsupported or drifted facts."],
      required_questions: ["Ask before proceeding when identity is ambiguous."],
      template_atoms: [...new Set(supportedFacts.map((fact) => fact.template_id))],
      evidence_required: ["Retain template runtime evidence for every write."],
      cleanup_plan: "Use Whole-Recipe Undo and never infer destructive cleanup.",
      typed_blockers: ["ambiguous_identity", "unsupported_semantic_fact", "missing_plugin", "runtime_drift"],
      token_budget: {
        menu_max_bytes: 4096,
        exact_max_bytes: 32768,
        compact_chat_max_items: 5,
        same_typed_blocker_stop_after: 2,
      },
    },
    steps,
    assertions: [{
      id: "assert_readback",
      kind: "expected_output",
      summary: "Every supported fact is present in verified readback.",
      required: true,
      evidence: supportedFacts.map((_, index) => `evidence_${String(index + 1).padStart(2, "0")}`),
      outputs: { refs: ["target_ref"], artifacts: [], jobs: [], state: [trial.scenario.entity_kind] },
    }],
    recovery: {
      run_state: {
        contract: "recipe.run_state.v1",
        initial: "not_started",
        states: ["not_started", "running", "paused", "succeeded", "failed", "blocked"],
        terminal: ["succeeded", "failed", "blocked"],
      },
      checkpoints: steps.map((step) => ({
        id: step.checkpoint,
        after_step: step.id,
        required_evidence: [step.evidence],
        on_resume: "continue_next_step",
        summary: "The preceding semantic mutation read back successfully.",
      })),
      evidence_requirements: steps.map((step, index) => ({
        id: step.evidence,
        step: step.id,
        source: "template.runtime.evidence.v1",
        template_id: supportedFacts[index].template_id,
        require_ok: true,
        require_request_id: true,
        counts: { refs_min: 1, artifacts_min: 0, jobs_min: 0, last_result_refs_min: 0 },
        timestamps: "current_run",
      })),
      idempotency: { scope: "recipe_run", default_step_policy: "follow_step_idempotency", on_resume: "skip_completed_checkpoints", on_replay: "reuse_verified_evidence" },
      resume: { from_checkpoint: "latest_verified", on_missing_evidence: "rerun_step", on_failed_evidence: "use_recovery_branch", on_risk_gate: "pause_for_user" },
      branches: [{ id: "branch_stop", trigger: "template_error", step: steps[0]?.id ?? null, strategy: "stop", summary: "Do not infer success after a failed mutation." }],
      risk_gates: [{ id: "fresh_target", applies_to: ["write"], required_before_step: steps[0]?.id ?? null, policy: "fresh_state", blocks_auto_resume: true, summary: "Replay only against an explicitly fresh target fixture." }],
    },
  };
}

function createTargetManifest(facts, phase) {
  const values = {};
  for (const fact of facts) values[fact.fact_id] = clone(phase === "before" ? fact.before : fact.after);
  return { target_fixture: "fresh:alpha4-shard-e", phase, values };
}

function makeIdentity(recipe, trial) {
  const contentHash = hash(recipe);
  const dependencyLock = {
    template_ids: recipe.steps.map((step) => step.call_template.id),
    catalog: "alpha4-shard-e-oracle-catalog.v1",
  };
  return {
    recipe_id: recipe.id,
    version: "1.0.0",
    revision: 1,
    content_hash: contentHash,
    validation_result_id: `validation:${hash({ recipe_id: recipe.id, version: "1.0.0", revision: 1, content_hash: contentHash, dependency_lock: dependencyLock }).slice(0, 32)}`,
    source_payload_identity: { scheme: "sha256", value: contentHash },
    trial_id: trial.trial_id,
  };
}

function createExpectedLifecycle(trial, compiler) {
  const ambiguity = trial.scenario.family === "ambiguity"
    ? { question_count: 1, chosen: false }
    : { question_count: 0, chosen: false };
  if (compiler.status !== "compiled") {
    return {
      save: { status: "not_saved", immutable: false, identity: null },
      list: { status: "not_saved", identities: [] },
      get: { status: "not_saved", identity: null, recipe: null },
      reconnect: { status: "not_applicable", rediscovered: false, identity: null },
      replay: makeBlockedReplay(trial, compiler.block_reason),
      ambiguity,
    };
  }
  const recipe = recipeForTrial(trial, trial.facts.filter((fact) => fact.support_status === "supported"));
  const identity = makeIdentity(recipe, trial);
  const listItem = {
    recipe_id: identity.recipe_id,
    version: identity.version,
    revision: identity.revision,
    content_hash: identity.content_hash,
    validation_result_id: identity.validation_result_id,
    title: recipe.title,
    lifecycle: recipe.lifecycle,
  };
  const drift = trial.scenario.drift === true;
  const replay = drift
    ? makeBlockedReplay(trial, "project_identity_mismatch")
    : makeSuccessfulReplay(trial, recipe, identity);
  return {
    save: { status: "saved", immutable: true, identity: exactIdentity(identity) },
    list: { status: "listed", identities: [listItem] },
    get: { status: "got", identity: exactIdentity(identity), recipe: clone(recipe) },
    reconnect: {
      status: "rediscovered",
      rediscovered: true,
      identity: exactIdentity(identity),
      list_identity: listItem,
    },
    replay,
    ambiguity,
    recipe: deepFreeze(recipe),
  };
}

function makeSuccessfulReplay(trial, recipe, identity) {
  const supportedFacts = trial.facts.filter((fact) => fact.support_status === "supported");
  const before = createTargetManifest(supportedFacts, "before");
  const after = createTargetManifest(supportedFacts, "after");
  return {
    status: "succeeded",
    one_call_count: 1,
    entrypoint: "one_call_replay",
    saved_identity: exactIdentity(identity),
    recipe_id: recipe.id,
    mutation: "applied_verified",
    mutations: supportedFacts.map((fact) => ({ fact_id: fact.fact_id, subject_ref: fact.subject_ref, field: fact.field, value: clone(fact.after) })),
    hidden_mutations: [],
    extra_mutations: [],
    false_success: false,
    readback: { manifest: after, fact_ids: supportedFacts.map((fact) => fact.fact_id) },
    undo: { scope: "whole_recipe", status: "closed", restored: true, restored_manifest: before },
    reconnect_required: trial.scenario.reconnect === true,
  };
}

function makeBlockedReplay(trial, reason) {
  const supportedFacts = trial.facts.filter((fact) => fact.support_status === "supported");
  return {
    status: "blocked",
    one_call_count: 0,
    entrypoint: "one_call_replay",
    mutation: "zero_write",
    mutations: [],
    hidden_mutations: [],
    extra_mutations: [],
    false_success: false,
    block_reason: reason,
    readback: { manifest: createTargetManifest(supportedFacts, "before"), fact_ids: [] },
    undo: { scope: "whole_recipe", status: "not_opened", restored: true, restored_manifest: createTargetManifest(supportedFacts, "before") },
    reconnect_required: false,
  };
}

export function createNormalRecipeRegistry(existingRecords = new Map()) {
  const records = existingRecords;
  return {
    save(recipe, trial = null) {
      const validation = validateNormalRecipe(recipe);
      if (!validation.ok) return { ok: false, error: { code: "NORMAL_RECIPE_REQUIRED", details: validation.errors } };
      const prior = [...records.values()].filter((record) => record.recipe.id === recipe.id);
      const revision = prior.length + 1;
      const identity = makeIdentity(recipe, trial ?? { trial_id: "standalone" });
      identity.revision = revision;
      const record = deepFreeze({ recipe: clone(recipe), identity: exactIdentity(identity), immutable: true });
      records.set(identityKey(record.identity), record);
      return { ok: true, status: "saved", immutable: true, identity: exactIdentity(record.identity) };
    },
    list() {
      return {
        ok: true,
        status: "listed",
        items: [...records.values()].map((record) => ({
          ...exactIdentity(record.identity),
          title: record.recipe.title,
          lifecycle: record.recipe.lifecycle,
        })),
      };
    },
    get(identity) {
      const record = records.get(identityKey(identity));
      if (!record) return { ok: false, error: { code: "NORMAL_RECIPE_NOT_FOUND" } };
      return { ok: true, status: "got", immutable: record.immutable, identity: exactIdentity(record.identity), recipe: clone(record.recipe) };
    },
    tryMutate(identity, mutator) {
      const record = records.get(identityKey(identity));
      if (!record) return { ok: false, error: { code: "NORMAL_RECIPE_NOT_FOUND" } };
      const attempted = mutator(clone(record.recipe));
      return { ok: false, error: { code: "NORMAL_RECIPE_IMMUTABLE", attempted_recipe: attempted, identity: exactIdentity(record.identity) } };
    },
    reconnect() {
      return createNormalRecipeRegistry(records);
    },
  };
}

export function buildOracleExpectation(trial) {
  const facts = trial.facts.map((fact) => ({
    fact_id: fact.fact_id,
    support_status: fact.support_status,
    signature: {
      entity_kind: fact.entity_kind,
      field: fact.field,
      action: fact.action,
      subject_ref: fact.subject_ref,
      before: clone(fact.before),
      after: clone(fact.after),
      plugin_identity: fact.plugin_identity,
      parameter: fact.parameter,
    },
  }));
  const supportedFacts = trial.facts.filter((fact) => fact.support_status === "supported");
  const unsupportedFacts = trial.facts.filter((fact) => fact.support_status !== "supported");
  const allSupported = unsupportedFacts.length === 0;
  const compiler = {
    status: allSupported ? "compiled" : "blocked",
    fact_ids: supportedFacts.map((fact) => fact.fact_id),
    dependency_order: [...supportedFacts].sort((left, right) => dependencyRank(left.dependency) - dependencyRank(right.dependency)).map((fact) => fact.fact_id),
    facts,
    ...(allSupported ? {} : { block_reason: unsupportedFacts[0].support_status === "ambiguous" ? "ambiguous_intent" : unsupportedFacts[0].support_status === "missing_plugin" ? "missing_plugin" : unsupportedFacts[0].support_status === "drift" ? "runtime_drift" : "unsupported_fact" }),
  };
  const lifecycle = createExpectedLifecycle(trial, compiler);
  if (compiler.status === "compiled") {
    const validation = validateNormalRecipe(lifecycle.recipe);
    if (!validation.ok) throw new Error(`Oracle generated malformed normal Recipe: ${validation.errors.join("; ")}`);
  }
  return deepFreeze({
    contract: ORACLE_CONTRACT,
    trial_id: trial.trial_id,
    capture: {
      status: "captured",
      fact_ids: trial.facts.map((fact) => fact.fact_id),
      supported_fact_ids: supportedFacts.map((fact) => fact.fact_id),
      unsupported_fact_ids: unsupportedFacts.map((fact) => fact.fact_id),
      facts,
      undo: { scope: "whole_recipe", status: "closed", observed: true },
    },
    compiler,
    lifecycle,
    score_expectations: {
      supported_truth: supportedFacts.map((fact) => fact.fact_id),
      zero_write_when_blocked: lifecycle.replay.status === "blocked",
      ambiguity_truth: trial.scenario.family === "ambiguity" ? "one_question_no_guess" : "not_applicable",
      reconnect_truth: trial.scenario.reconnect === true ? "rediscover_exact_identity" : "not_applicable",
      undo_truth: lifecycle.replay.undo,
    },
  });
}

export { validateNormalRecipe };

function dependencyRank(dependency) {
  if (dependency.includes("parent") || dependency.includes("source_and_destination") || dependency.includes("track_identity")) return 1;
  if (dependency.includes("marker") || dependency.includes("folder") || dependency.includes("send")) return 2;
  if (dependency.includes("envelope")) return 3;
  if (dependency.includes("fx")) return 4;
  return 5;
}

export function runOneCallReplay({ trial, identity, registry, runtime = {} }) {
  const stored = registry.get(identity);
  if (!stored.ok) return makeBlockedReplay(trial, "saved_identity_not_found");
  if (trial.scenario.drift === true) return makeBlockedReplay(trial, "project_identity_mismatch");
  if (runtime.missing_plugin === true) return makeBlockedReplay(trial, "missing_plugin");
  return makeSuccessfulReplay(trial, stored.recipe, stored.identity);
}

export function makeOraclePerfectSubmission(trial) {
  const expectation = buildOracleExpectation(trial);
  return deepFreeze({
    capture: clone(expectation.capture),
    compiler: clone(expectation.compiler),
    lifecycle: clone(expectation.lifecycle),
    attempts: { first_attempt: true, one_recovery: true },
  });
}

export function submissionFromLearnerInput(learnerInput) {
  if (!learnerInput?.capture?.source_blind) throw new TypeError("expected a source-blind learner input");
  const facts = learnerInput.capture.facts.map((fact) => ({
    ...clone(fact),
    template_id: fact.template_id,
  }));
  const family = learnerInput.scenario_family;
  const trial = {
    trial_id: learnerInput.trial_id,
    demonstration_size: learnerInput.demonstration_size,
    scenario_id: learnerInput.scenario_id ?? family,
    scenario: {
      family,
      pack: learnerInput.scenario_pack,
      entity_kind: learnerInput.scenario_entity_kind ?? facts[0]?.entity_kind,
      reconnect: family === "reconnect",
      drift: family === "drift",
    },
    facts,
  };
  return makeOraclePerfectSubmission(trial);
}

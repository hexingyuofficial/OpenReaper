import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  EXECUTABLE_RECIPE_BUDGETS,
  EXECUTABLE_RECIPE_DRAFT_CONTRACT,
  EXECUTABLE_RECIPE_REVISION_CONTRACT,
  EXECUTABLE_RECIPE_TRUST_CONTRACT,
  ExecutableRecipeContractError,
  createExecutableDependencyCatalog,
  evaluateExecutableRecipeTrust,
  executableRevisionDiscoveryProjection,
  hashExecutableRecipeContent,
  normalizeExecutableRecipeDraft,
  normalizeExecutableRecipeRevision,
  sealExecutableRecipeRevision,
  validateExecutableRecipeDraft,
  validateExecutableRecipeRevision,
} from "../../packages/core/src/executable-recipe-contract-v1.mjs";
import {
  evaluateExecutableRecipeExpression,
} from "../../packages/core/src/executable-recipe-run-v1.mjs";
import {
  RECIPE_CONTRACT,
  normalizeRecipeContract,
  validateRecipeContract,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Alpha3.4-E0 executable recipe revision contract", () => {
  it("normalizes deterministic content hashes and seals immutable revisions", () => {
    const catalog = makeCatalog();
    const draft = makeDraft();
    const firstHash = hashExecutableRecipeContent(draft, { catalog });
    const secondHash = hashExecutableRecipeContent(structuredClone(draft), { catalog });
    assert.equal(firstHash, secondHash);
    assert.match(firstHash, /^[a-f0-9]{64}$/);

    const sealed = sealExecutableRecipeRevision(draft, {
      catalog,
      version: "1.0.0",
      revision: 1,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(sealed.contract, EXECUTABLE_RECIPE_REVISION_CONTRACT);
    assert.equal(sealed.immutable, true);
    assert.equal(sealed.recipe_id, draft.id);
    assert.equal(sealed.content_hash, firstHash);
    assert.equal(sealed.source_payload_identity.value, firstHash);
    assert.equal(Object.isFrozen(sealed), true);

    const mutable = structuredClone(sealed);
    mutable.immutable = false;
    assert.match(
      validateExecutableRecipeRevision(mutable, { catalog }).errors.join("\n"),
      /immutable must be true/,
    );

    const hashMismatch = structuredClone(sealed);
    hashMismatch.content_hash = "0".repeat(64);
    assert.match(
      validateExecutableRecipeRevision(hashMismatch, { catalog }).errors.join("\n"),
      /content_hash does not match/,
    );
  });

  it("validates Macro-first dependencies and typed Template fallback", () => {
    const catalog = makeCatalog();
    assert.equal(validateExecutableRecipeDraft(makeDraft(), { catalog }).ok, true);

    const missingReason = makeDraft();
    missingReason.dependencies[1].fallback_reason = null;
    missingReason.stages[1].dependency.fallback_reason = null;
    assert.match(
      validateExecutableRecipeDraft(missingReason, { catalog }).errors.join("\n"),
      /fallback_reason is required for template long-tail fallback/,
    );

    const unknownMacro = makeDraft();
    unknownMacro.dependencies[0].id = "macro.unknown.missing";
    unknownMacro.stages[0].dependency.id = "macro.unknown.missing";
    assert.match(
      validateExecutableRecipeDraft(unknownMacro, { catalog }).errors.join("\n"),
      /unknown macro/,
    );

    const rawShell = makeDraft();
    rawShell.stages[0].dependency.id = "shell:rm -rf /";
    rawShell.dependencies[0].id = "shell:rm -rf /";
    assert.match(
      validateExecutableRecipeDraft(rawShell, { catalog }).errors.join("\n"),
      /registered macro id|forbidden raw execution|unknown macro/,
    );
  });

  it("accepts installed project identities beyond legacy short-string limits while remaining bounded", () => {
    const catalog = makeCatalog();
    const projectIdentityMaxChars = 2_048;
    const installedPathDraft = makeDraft();
    installedPathDraft.portability.project_identity = `project:path:/Users/fixture/${"nested-install-root/".repeat(12)}fixture.RPP`;
    assert.ok(installedPathDraft.portability.project_identity.length > 128);
    assert.equal(validateExecutableRecipeDraft(installedPathDraft, { catalog }).ok, true);

    const maxIdentityDraft = makeDraft();
    maxIdentityDraft.portability.project_identity = "p".repeat(projectIdentityMaxChars);
    assert.equal(validateExecutableRecipeDraft(maxIdentityDraft, { catalog }).ok, true);

    const oversizedIdentityDraft = makeDraft();
    oversizedIdentityDraft.portability.project_identity = "p".repeat(projectIdentityMaxChars + 1);
    assert.match(
      validateExecutableRecipeDraft(oversizedIdentityDraft, { catalog }).errors.join("\n"),
      new RegExp(`project_identity exceeds ${projectIdentityMaxChars} characters`),
    );
  });

  it("rejects bypass fields, cycles, oversized graphs, and trust drift", () => {
    const catalog = makeCatalog();

    const bypass = makeDraft();
    bypass.stages[0].lua = "reaper.Main_OnCommand(40044, 0)";
    assert.match(
      validateExecutableRecipeDraft(bypass, { catalog }).errors.join("\n"),
      /forbidden raw execution or bypass field/,
    );

    const hardware = makeDraft();
    hardware.hardware_io = { device: "mic" };
    assert.match(
      validateExecutableRecipeDraft(hardware, { catalog }).errors.join("\n"),
      /forbidden raw execution or bypass field/,
    );

    const cycle = makeDraft();
    cycle.stages[0].outputs = ["project_summary", "track_ref"];
    cycle.stages[0].inputs = ["track_name", "selector"];
    cycle.stages[1].outputs = ["track_ref", "summary"];
    cycle.stages[1].inputs = ["project_summary", "track_name", "track_ref"];
    cycle.bindings = [
      {
        from: { scope: "stage", id: "run_macro", port: "track_ref" },
        to: { scope: "stage", id: "readback", port: "track_ref" },
      },
      {
        from: { scope: "stage", id: "readback", port: "summary" },
        to: { scope: "stage", id: "run_macro", port: "selector" },
      },
      {
        from: { scope: "stage", id: "readback", port: "track_ref" },
        to: { scope: "recipe_output", id: null, port: "track_ref" },
      },
    ];
    assert.match(
      validateExecutableRecipeDraft(cycle, { catalog }).errors.join("\n"),
      /bindings contain a cycle/,
    );

    const oversized = makeDraft();
    oversized.stages = Array.from({ length: 49 }, (_, index) => ({
      id: `stage_${index}`,
      kind: "get_state",
      dependency: null,
      inputs: [],
      outputs: [`out_${index}`],
      risk: "read",
      checkpoint: `checkpoint_stage_${index}`,
    }));
    oversized.checkpoints = oversized.stages.map((stage) => ({
      id: stage.checkpoint,
      after_stage: stage.id,
      evidence_id: `evidence_${stage.id}`,
      resume_identity: `resume_${stage.id}`,
      summary: "oversized",
    }));
    oversized.dependencies = [];
    oversized.preflight.stage_count = 49;
    oversized.preflight.dependency_count = 0;
    assert.match(
      validateExecutableRecipeDraft(oversized, { catalog }).errors.join("\n"),
      /at most 48 stages|at least one macro or template/,
    );

    const sealed = sealExecutableRecipeRevision(makeDraft(), { catalog });
    const trusted = evaluateExecutableRecipeTrust(sealed, completeTrustFacts(sealed), { catalog });
    assert.equal(trusted.contract, EXECUTABLE_RECIPE_TRUST_CONTRACT);
    assert.equal(trusted.trusted, true);

    const drifted = evaluateExecutableRecipeTrust(sealed, {
      content_hash: "1".repeat(64),
      dependency_versions: [{ kind: "macro", id: "macro.project.inspect", version: "9.9.9" }],
      dependency_descriptors: [{ kind: "macro", id: "macro.project.inspect", descriptor_hash: "2".repeat(64) }],
      risk_grants: ["read"],
      project_identity: "other-project",
      bridge_owner: "other-owner",
      bridge_generation: "other-generation",
      available_capabilities: [],
      checkpoint_evidence: [{
        checkpoint_id: "missing",
        evidence_id: "missing",
        resume_identity: "missing",
        recipe_id: "recipe.other",
        version: "0.0.0",
        revision: 9,
        content_hash: "3".repeat(64),
      }],
    }, { catalog });
    assert.equal(drifted.trusted, false);
    assert.ok(drifted.invalidation_reasons.includes("recipe_content_hash_drift"));
    assert.ok(drifted.invalidation_reasons.includes("dependency_version_drift"));
    assert.ok(drifted.invalidation_reasons.includes("dependency_descriptor_drift"));
    assert.ok(drifted.invalidation_reasons.includes("risk_grant_mismatch"));
    assert.ok(drifted.invalidation_reasons.includes("project_identity_mismatch"));
    assert.ok(drifted.invalidation_reasons.includes("bridge_owner_mismatch"));
    assert.ok(drifted.invalidation_reasons.includes("bridge_generation_mismatch"));
    assert.ok(drifted.invalidation_reasons.includes("missing_capability"));
    assert.ok(drifted.invalidation_reasons.includes("checkpoint_evidence_mismatch"));
  });

  it("proves whole-graph binding ports, stage dependency equality, and checkpoint one-to-one identity", () => {
    const catalog = makeCatalog();
    assert.equal(validateExecutableRecipeDraft(makeDraft(), { catalog }).ok, true);

    const missingSourcePort = makeDraft();
    missingSourcePort.bindings[1].from.port = "missing_output";
    assert.match(
      validateExecutableRecipeDraft(missingSourcePort, { catalog }).errors.join("\n"),
      /must be a declared output of stage run_macro/,
    );

    const missingTargetPort = makeDraft();
    missingTargetPort.bindings[1].to.port = "missing_input";
    assert.match(
      validateExecutableRecipeDraft(missingTargetPort, { catalog }).errors.join("\n"),
      /must be a declared input of stage readback|must have exactly one incoming binding/,
    );

    const missingStageInputBinding = makeDraft();
    missingStageInputBinding.bindings = missingStageInputBinding.bindings.filter((binding) =>
      !(binding.to.scope === "stage" && binding.to.id === "readback" && binding.to.port === "track_name"),
    );
    assert.match(
      validateExecutableRecipeDraft(missingStageInputBinding, { catalog }).errors.join("\n"),
      /stage input readback\.track_name must have exactly one incoming binding/,
    );

    const duplicateFullBinding = makeDraft();
    duplicateFullBinding.bindings.push(structuredClone(duplicateFullBinding.bindings[0]));
    assert.match(
      validateExecutableRecipeDraft(duplicateFullBinding, { catalog }).errors.join("\n"),
      /duplicate full binding|duplicate input target/,
    );

    const wrongDirection = makeDraft();
    wrongDirection.bindings[0] = {
      from: { scope: "recipe_output", id: null, port: "track_ref" },
      to: { scope: "stage", id: "run_macro", port: "track_name" },
    };
    assert.match(
      validateExecutableRecipeDraft(wrongDirection, { catalog }).errors.join("\n"),
      /cannot source recipe_output/,
    );

    const duplicateTarget = makeDraft();
    duplicateTarget.bindings.push({
      from: { scope: "recipe_input", id: null, port: "track_name" },
      to: { scope: "stage", id: "run_macro", port: "track_name" },
    });
    assert.match(
      validateExecutableRecipeDraft(duplicateTarget, { catalog }).errors.join("\n"),
      /duplicate input target/,
    );

    const unproducedOutput = makeDraft();
    unproducedOutput.bindings = unproducedOutput.bindings.filter((binding) => binding.to.scope !== "recipe_output");
    assert.match(
      validateExecutableRecipeDraft(unproducedOutput, { catalog }).errors.join("\n"),
      /recipe output track_ref is not produced/,
    );

    const reverseStageOrder = makeDraft();
    reverseStageOrder.stages.reverse();
    const reverseValidation = validateExecutableRecipeDraft(reverseStageOrder, { catalog });
    assert.equal(reverseValidation.ok, false);
    assert.match(
      reverseValidation.errors.join("\n"),
      /stage producer run_macro must be declared before consumer readback/,
    );
    assert.throws(
      () => normalizeExecutableRecipeDraft(reverseStageOrder, { catalog }),
      (error) => error instanceof ExecutableRecipeContractError
        && error.errors.some((entry) => /stage producer run_macro must be declared before consumer readback/.test(entry)),
    );

    const stageDependencyMismatch = makeDraft();
    stageDependencyMismatch.stages[0].dependency.version = "1.0.1";
    assert.match(
      validateExecutableRecipeDraft(stageDependencyMismatch, { catalog }).errors.join("\n"),
      /must exactly match draft\.dependencies entry|must match catalog version/,
    );

    const catalogMismatch = makeDraft();
    catalogMismatch.dependencies[0].descriptor_hash = "c".repeat(64);
    assert.match(
      validateExecutableRecipeDraft(catalogMismatch, { catalog }).errors.join("\n"),
      /descriptor_hash must exactly match catalog descriptor_hash/,
    );

    const checkpointMismatch = makeDraft();
    checkpointMismatch.stages[0].checkpoint = "checkpoint_other";
    assert.match(
      validateExecutableRecipeDraft(checkpointMismatch, { catalog }).errors.join("\n"),
      /Stage run_macro\.checkpoint must equal checkpoint id checkpoint_run_macro/,
    );

    const duplicateCheckpoint = makeDraft();
    duplicateCheckpoint.checkpoints.push({
      id: "checkpoint_extra",
      after_stage: "run_macro",
      evidence_id: "evidence_extra",
      resume_identity: "resume.extra",
      summary: "duplicate",
    });
    assert.match(
      validateExecutableRecipeDraft(duplicateCheckpoint, { catalog }).errors.join("\n"),
      /one-to-one with draft\.stages|Duplicate checkpoint for stage run_macro/,
    );

    const stageRiskMismatch = makeDraft();
    stageRiskMismatch.stages[0].risk = "write";
    assert.match(
      validateExecutableRecipeDraft(stageRiskMismatch, { catalog }).errors.join("\n"),
      /risk must equal dependency catalog risk read/,
    );

    const missingCapability = makeDraft();
    missingCapability.required_capabilities = ["project.index"];
    assert.match(
      validateExecutableRecipeDraft(missingCapability, { catalog }).errors.join("\n"),
      /must include dependency capability tracks\.write/,
    );

    const duplicateEvidence = makeDraft();
    duplicateEvidence.checkpoints[1].evidence_id = duplicateEvidence.checkpoints[0].evidence_id;
    assert.match(
      validateExecutableRecipeDraft(duplicateEvidence, { catalog }).errors.join("\n"),
      /Duplicate checkpoint evidence_id/,
    );

    const duplicateResume = makeDraft();
    duplicateResume.checkpoints[1].resume_identity = duplicateResume.checkpoints[0].resume_identity;
    assert.match(
      validateExecutableRecipeDraft(duplicateResume, { catalog }).errors.join("\n"),
      /Duplicate checkpoint resume_identity/,
    );
  });

  it("validates hash-covered bounded expressions for every saved Recipe", () => {
    const catalog = makeCatalog();
    const draft = makeDraft();
    draft.bindings[0] = {
      expression: {
        op: "coalesce",
        values: [
          { op: "input", id: "track_name" },
          { op: "literal", value: "Dialog" },
        ],
      },
      to: { scope: "stage", id: "run_macro", port: "track_name" },
    };
    assert.equal(validateExecutableRecipeDraft(draft, { catalog }).ok, true);
    const firstHash = hashExecutableRecipeContent(draft, { catalog });
    draft.bindings[0].expression.values[1].value = "Voice";
    assert.notEqual(hashExecutableRecipeContent(draft, { catalog }), firstHash);

    const withRefs = structuredClone(draft);
    withRefs.bindings.push({
      expression: { op: "object", fields: { track_ref: { op: "literal", value: "track:guid:{TRACK}" } } },
      to: { scope: "stage_refs", id: "readback", port: "refs" },
    });
    assert.equal(validateExecutableRecipeDraft(withRefs, { catalog }).ok, true);
    withRefs.bindings.push(structuredClone(withRefs.bindings.at(-1)));
    assert.match(validateExecutableRecipeDraft(withRefs, { catalog }).errors.join("\n"), /duplicate input target/);

    const safeAction = structuredClone(draft);
    safeAction.bindings[0].expression = {
      op: "object",
      fields: { action: { op: "literal", value: "create" } },
    };
    assert.equal(validateExecutableRecipeDraft(safeAction, { catalog }).ok, true);
    safeAction.bindings[0].expression.fields.action.value = "raw-action:40044";
    assert.match(validateExecutableRecipeDraft(safeAction, { catalog }).errors.join("\n"), /forbidden raw execution or bypass field/);

    const unknown = structuredClone(draft);
    unknown.bindings[0].expression = { op: "execute", value: "anything" };
    assert.match(validateExecutableRecipeDraft(unknown, { catalog }).errors.join("\n"), /unknown or forbidden/);

    const dynamicPath = structuredClone(draft);
    dynamicPath.bindings[0].expression = {
      op: "get",
      value: { op: "input", id: "track_name" },
      path: [{ op: "input", id: "track_name" }],
    };
    assert.match(validateExecutableRecipeDraft(dynamicPath, { catalog }).errors.join("\n"), /invalid or dynamic path/);

    const unsafeLookup = structuredClone(draft);
    unsafeLookup.bindings[0].expression = {
      op: "lookup_by",
      items: { op: "array", items: [] },
      key: "constructor",
      value: { op: "literal", value: "anything" },
    };
    assert.match(validateExecutableRecipeDraft(unsafeLookup, { catalog }).errors.join("\n"), /safe own-property key/);

    const futureStage = structuredClone(draft);
    futureStage.bindings[0].expression = { op: "stage", id: "readback", port: "track_ref" };
    assert.match(validateExecutableRecipeDraft(futureStage, { catalog }).errors.join("\n"), /must be declared before consumer/);

    const tooDeep = structuredClone(draft);
    let expression = { op: "literal", value: "Dialog" };
    for (let index = 0; index < EXECUTABLE_RECIPE_BUDGETS.expression_max_depth + 1; index += 1) {
      expression = { op: "coalesce", values: [expression] };
    }
    tooDeep.bindings[0].expression = expression;
    assert.match(validateExecutableRecipeDraft(tooDeep, { catalog }).errors.join("\n"), /exceeds expression depth/);

    const tooManyNodes = structuredClone(draft);
    tooManyNodes.bindings[0].expression = {
      op: "array",
      items: Array.from(
        { length: EXECUTABLE_RECIPE_BUDGETS.expression_max_nodes },
        () => ({ op: "literal", value: 1 }),
      ),
    };
    assert.match(validateExecutableRecipeDraft(tooManyNodes, { catalog }).errors.join("\n"), /at most 256 nodes/);

    const literalAtLimit = structuredClone(draft);
    literalAtLimit.bindings[0].expression = {
      op: "literal",
      value: Array.from({ length: EXECUTABLE_RECIPE_BUDGETS.expression_collection_max_items }, () => null),
    };
    assert.equal(validateExecutableRecipeDraft(literalAtLimit, { catalog }).ok, true);
    literalAtLimit.bindings[0].expression.value.push(null);
    assert.match(validateExecutableRecipeDraft(literalAtLimit, { catalog }).errors.join("\n"), /exceeds 512 literal collection items/);

    const seeded = {
      op: "seeded_uniform",
      seed: { op: "literal", value: 17 },
      index: { op: "literal", value: 2 },
      min: { op: "literal", value: -1 },
      max: { op: "literal", value: 1 },
    };
    assert.equal(evaluateExecutableRecipeExpression(seeded), evaluateExecutableRecipeExpression(seeded));
    assert.throws(
      () => evaluateExecutableRecipeExpression({
        op: "range",
        start: { op: "literal", value: 0 },
        count: { op: "literal", value: EXECUTABLE_RECIPE_BUDGETS.expression_collection_max_items + 1 },
      }),
      /outside its budget/,
    );

    const aggregateWork = (innerCount) => ({
      op: "map",
      items: {
        op: "range",
        start: { op: "literal", value: 0 },
        count: { op: "literal", value: 512 },
      },
      as: "row",
      index_as: "row_index",
      body: {
        op: "join",
        values: { op: "literal", value: Array.from({ length: innerCount }, () => "x") },
        separator: "",
      },
    });
    assert.equal(evaluateExecutableRecipeExpression(aggregateWork(30)).length, 512);
    assert.throws(
      () => evaluateExecutableRecipeExpression(aggregateWork(31)),
      /total collection work exceeds its budget/,
    );
  });

  it("accepts typed per-port Recipe refs and rejects unsafe ref bindings", () => {
    const catalog = makeCatalog();
    const draft = makeDraft();
    draft.inputs.push({ id: "take_ref", type: "ref.take", required: true });
    draft.stages[0].outputs.push("fx_ref");
    draft.bindings.push(
      {
        from: { scope: "recipe_input", id: null, port: "take_ref" },
        to: { scope: "refs", id: "run_macro", port: "take_ref" },
      },
      {
        from: { scope: "stage", id: "run_macro", port: "fx_ref" },
        to: { scope: "refs", id: "readback", port: "fx_ref" },
      },
    );
    assert.equal(validateExecutableRecipeDraft(draft, { catalog }).ok, true);

    const nonRefPort = structuredClone(draft);
    nonRefPort.bindings.at(-1).to.port = "plugin";
    assert.match(
      validateExecutableRecipeDraft(nonRefPort, { catalog }).errors.join("\n"),
      /must name a typed ref port ending in _ref or _refs/,
    );

    const duplicateTarget = structuredClone(draft);
    duplicateTarget.bindings.push(structuredClone(duplicateTarget.bindings.at(-1)));
    assert.match(
      validateExecutableRecipeDraft(duplicateTarget, { catalog }).errors.join("\n"),
      /duplicate full binding|duplicate input target/,
    );

    const laterStage = structuredClone(draft);
    laterStage.bindings[laterStage.bindings.length - 1] = {
      from: { scope: "stage", id: "readback", port: "track_ref" },
      to: { scope: "refs", id: "run_macro", port: "track_ref" },
    };
    assert.match(
      validateExecutableRecipeDraft(laterStage, { catalog }).errors.join("\n"),
      /must be declared before consumer/,
    );
  });

  it("binds revision identity deterministically and fails closed on incomplete trust facts", () => {
    const catalog = makeCatalog();
    const sealed = sealExecutableRecipeRevision(makeDraft(), {
      catalog,
      version: "1.0.0",
      revision: 2,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(sealed.source_payload_identity.value, sealed.content_hash);
    assert.match(sealed.validation_result_id, /^validation\.[a-f0-9]{48}$/);
    assert.equal(
      sealed.validation_result_id,
      expectedValidationResultId(
        sealed.recipe_id,
        sealed.version,
        sealed.revision,
        sealed.content_hash,
        sealed.dependency_lock,
      ),
    );
    assert.ok(sealed.validation_result_id.length <= 64);

    const swappedValidation = structuredClone(sealed);
    swappedValidation.validation_result_id = `validation.${"d".repeat(48)}`;
    assert.match(
      validateExecutableRecipeRevision(swappedValidation, { catalog }).errors.join("\n"),
      /validation_result_id must be deterministic/,
    );

    const versionOnlyTamper = structuredClone(sealed);
    versionOnlyTamper.version = "9.9.9";
    assert.match(
      validateExecutableRecipeRevision(versionOnlyTamper, { catalog }).errors.join("\n"),
      /validation_result_id must be deterministic/,
    );

    const maxIdDraft = makeDraft();
    maxIdDraft.id = `recipe.tracks.${"a".repeat(EXECUTABLE_RECIPE_BUDGETS.id_max_chars - "recipe.tracks.".length)}`;
    const maxSealed = sealExecutableRecipeRevision(maxIdDraft, {
      catalog,
      version: "1.0.0",
      revision: EXECUTABLE_RECIPE_BUDGETS.revision_max,
      saved_at: "1970-01-01T00:00:00.000Z",
    });
    assert.match(maxSealed.validation_result_id, /^validation\.[a-f0-9]{48}$/);
    assert.equal(maxSealed.revision, EXECUTABLE_RECIPE_BUDGETS.revision_max);
    assert.equal(maxSealed.recipe_id.length, EXECUTABLE_RECIPE_BUDGETS.id_max_chars);

    assert.throws(
      () => sealExecutableRecipeRevision(makeDraft(), {
        catalog,
        version: "1.0.0",
        revision: EXECUTABLE_RECIPE_BUDGETS.revision_max + 1,
      }),
      ExecutableRecipeContractError,
    );
    assert.throws(
      () => sealExecutableRecipeRevision(makeDraft(), {
        catalog,
        version: `${"1".repeat(EXECUTABLE_RECIPE_BUDGETS.version_max_chars)}.0.0`,
      }),
      ExecutableRecipeContractError,
    );

    const payloadMismatch = structuredClone(sealed);
    payloadMismatch.source_payload_identity = {
      ...payloadMismatch.source_payload_identity,
      value: "f".repeat(64),
    };
    assert.match(
      validateExecutableRecipeRevision(payloadMismatch, { catalog }).errors.join("\n"),
      /source_payload_identity\.value must equal revision\.content_hash/,
    );

    assert.equal(evaluateExecutableRecipeTrust(sealed, completeTrustFacts(sealed), { catalog }).trusted, true);

    const missingFacts = evaluateExecutableRecipeTrust(sealed, {}, { catalog });
    assert.equal(missingFacts.trusted, false);
    for (const reason of [
      "recipe_content_hash_drift",
      "dependency_version_drift",
      "dependency_descriptor_drift",
      "risk_grant_mismatch",
      "project_identity_mismatch",
      "bridge_owner_mismatch",
      "bridge_generation_mismatch",
      "missing_capability",
      "checkpoint_evidence_mismatch",
    ]) {
      assert.ok(missingFacts.invalidation_reasons.includes(reason), reason);
    }

    const incompleteDependencies = evaluateExecutableRecipeTrust(sealed, {
      ...completeTrustFacts(sealed),
      dependency_versions: sealed.dependency_lock.entries.slice(0, 1).map((entry) => ({
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
      })),
    }, { catalog });
    assert.equal(incompleteDependencies.trusted, false);
    assert.ok(incompleteDependencies.invalidation_reasons.includes("dependency_version_drift"));

    const staleCheckpoint = evaluateExecutableRecipeTrust(sealed, {
      ...completeTrustFacts(sealed),
      checkpoint_evidence: completeTrustFacts(sealed).checkpoint_evidence.map((fact) => ({
        ...fact,
        version: "0.0.1",
      })),
    }, { catalog });
    assert.equal(staleCheckpoint.trusted, false);
    assert.ok(staleCheckpoint.invalidation_reasons.includes("checkpoint_evidence_mismatch"));

    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [{
          id: "macro.project.inspect",
          risk: "read",
          descriptor_hash: sha("x"),
          capabilities: ["project.index"],
        }],
        templates: [],
        capabilities: ["project.index"],
      }),
      /version is required/,
    );
    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [{
          id: "macro.hardware.route",
          version: "1.0.0",
          risk: "read",
          descriptor_hash: sha("hardware"),
          capabilities: ["project.index"],
        }],
        templates: [],
        capabilities: ["project.index"],
      }),
      /macros\[0\]\.id is invalid/,
    );
    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [{
          id: "macro.project.inspect",
          version: "1.0.0",
          risk: "read",
          descriptor_hash: sha("x"),
          capabilities: ["hardware.device_io"],
        }],
        templates: [],
        capabilities: ["hardware.device_io"],
      }),
      /forbidden identity|capability is forbidden/,
    );
    const acceptedHardwareRead = createExecutableDependencyCatalog({
      macros: [makeCatalog().getMacro("macro.project.inspect")],
      templates: [{
        id: "template.routing.list_track_hardware_outputs",
        version: "1.0.0",
        risk: "read",
        descriptor_hash: sha("routing-hardware-output-read"),
        capabilities: ["routing.track_hardware_outputs.list"],
      }],
      capabilities: ["project.index", "routing.track_hardware_outputs.list"],
    });
    assert.equal(acceptedHardwareRead.templates.length, 1);
    const readDraft = makeDraft();
    const readEntry = acceptedHardwareRead.getTemplate("template.routing.list_track_hardware_outputs");
    readDraft.risk = "read";
    readDraft.risk_grants = ["read"];
    readDraft.stages[1].risk = "read";
    readDraft.stages[1].dependency = {
      kind: "template", id: readEntry.id, version: readEntry.version,
      fallback_reason: "official_template_atom_required",
    };
    readDraft.dependencies[1] = {
      kind: "template", id: readEntry.id, version: readEntry.version, risk: readEntry.risk,
      fallback_reason: "official_template_atom_required", descriptor_hash: readEntry.descriptor_hash,
    };
    readDraft.required_capabilities = ["project.index", "routing.track_hardware_outputs.list"];
    assert.equal(validateExecutableRecipeDraft(readDraft, { catalog: acceptedHardwareRead }).ok, true);
    assert.doesNotThrow(() => sealExecutableRecipeRevision(readDraft, { catalog: acceptedHardwareRead }));
    const catalogOnlyHardwareMutation = createExecutableDependencyCatalog({
      macros: [],
      templates: [
        {
          id: "template.routing.set_track_hardware_output",
          version: "1.0.0",
          risk: "write",
          descriptor_hash: sha("routing-hardware-output-set"),
          capabilities: ["routing.track_hardware_output.set"],
        },
        {
          id: "template.routing.remove_track_hardware_output",
          version: "1.0.0",
          risk: "write",
          descriptor_hash: sha("routing-hardware-output-remove"),
          capabilities: ["routing.track_hardware_output.remove"],
        },
      ],
      capabilities: ["routing.track_hardware_output.set", "routing.track_hardware_output.remove"],
    });
    for (const templateId of ["template.routing.set_track_hardware_output", "template.routing.remove_track_hardware_output"]) {
      const draft = makeDraft();
      const entry = catalogOnlyHardwareMutation.getTemplate(templateId);
      draft.stages[1].dependency = {
        kind: "template", id: templateId, version: entry.version,
        fallback_reason: "official_template_atom_required",
      };
      draft.dependencies[1] = {
        kind: "template", id: templateId, version: entry.version, risk: entry.risk,
        fallback_reason: "official_template_atom_required", descriptor_hash: entry.descriptor_hash,
      };
      const validation = validateExecutableRecipeDraft(draft, { catalog: catalogOnlyHardwareMutation });
      assert.equal(validation.ok, false);
      assert.match(validation.errors.join("\n"), /accepted template id/);
      assert.throws(() => sealExecutableRecipeRevision(draft, { catalog: catalogOnlyHardwareMutation }));
    }
    for (const forbidden of ["macro.hardware.route", "hardware.device_io", "hardware_io", "hardware_device", "device_io", "raw-action:1", "lua:evil", "shell:evil", "bridge:evil", "ui_action"]) {
      assert.throws(
        () => createExecutableDependencyCatalog({
          macros: [],
          templates: [{
            id: forbidden.startsWith("template.") ? forbidden : "template.routing.list_track_hardware_outputs",
            version: "1.0.0",
            risk: "read",
            descriptor_hash: sha(forbidden),
            capabilities: [forbidden],
          }],
          capabilities: [forbidden],
        }),
      );
    }

    const maxMacros = Array.from({ length: EXECUTABLE_RECIPE_BUDGETS.catalog_macro_max_count }, (_, index) => ({
      id: `macro.project.m${index}`,
      version: "1.0.0",
      risk: "read",
      descriptor_hash: sha(`macro-${index}`),
      capabilities: ["project.index"],
    }));
    assert.equal(
      createExecutableDependencyCatalog({
        macros: maxMacros,
        templates: [],
        capabilities: ["project.index"],
      }).macros.length,
      EXECUTABLE_RECIPE_BUDGETS.catalog_macro_max_count,
    );
    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [
          ...maxMacros,
          {
            id: "macro.project.overflow",
            version: "1.0.0",
            risk: "read",
            descriptor_hash: sha("overflow"),
            capabilities: ["project.index"],
          },
        ],
        templates: [],
        capabilities: ["project.index"],
      }),
      /macros exceed 256/,
    );

    const maxTemplates = Array.from({ length: EXECUTABLE_RECIPE_BUDGETS.catalog_template_max_count }, (_, index) => ({
      id: `template.tracks.t${index}`,
      version: "1.0.0",
      risk: "write",
      descriptor_hash: sha(`template-${index}`),
      capabilities: ["tracks.write"],
    }));
    assert.equal(
      createExecutableDependencyCatalog({
        macros: [],
        templates: maxTemplates,
        capabilities: ["tracks.write"],
      }).templates.length,
      EXECUTABLE_RECIPE_BUDGETS.catalog_template_max_count,
    );
    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [],
        templates: [
          ...maxTemplates,
          {
            id: "template.tracks.overflow",
            version: "1.0.0",
            risk: "write",
            descriptor_hash: sha("template-overflow"),
            capabilities: ["tracks.write"],
          },
        ],
        capabilities: ["tracks.write"],
      }),
      /templates exceed 512/,
    );

    const maxRootCaps = Array.from(
      { length: EXECUTABLE_RECIPE_BUDGETS.catalog_capability_max_count },
      (_, index) => `cap.${index}`,
    );
    assert.equal(
      createExecutableDependencyCatalog({
        macros: [],
        templates: [],
        capabilities: maxRootCaps,
      }).capabilities.length,
      EXECUTABLE_RECIPE_BUDGETS.catalog_capability_max_count,
    );
    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [],
        templates: [],
        capabilities: [...maxRootCaps, "cap.overflow"],
      }),
      /capabilities exceed 512/,
    );

    const maxEntryCaps = Array.from(
      { length: EXECUTABLE_RECIPE_BUDGETS.catalog_entry_capability_max_count },
      (_, index) => `entry.cap.${index}`,
    );
    assert.equal(
      createExecutableDependencyCatalog({
        macros: [{
          id: "macro.project.inspect",
          version: "1.0.0",
          risk: "read",
          descriptor_hash: sha("entry-caps"),
          capabilities: maxEntryCaps,
        }],
        templates: [],
        capabilities: maxEntryCaps,
      }).macros[0].capabilities.length,
      EXECUTABLE_RECIPE_BUDGETS.catalog_entry_capability_max_count,
    );
    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [{
          id: "macro.project.inspect",
          version: "1.0.0",
          risk: "read",
          descriptor_hash: sha("entry-caps-overflow"),
          capabilities: [...maxEntryCaps, "entry.cap.overflow"],
        }],
        templates: [],
        capabilities: [...maxEntryCaps, "entry.cap.overflow"],
      }),
      /capabilities exceed 32/,
    );

    const maxId = `macro.project.${"a".repeat(EXECUTABLE_RECIPE_BUDGETS.dependency_id_max_chars - "macro.project.".length)}`;
    assert.equal(maxId.length, EXECUTABLE_RECIPE_BUDGETS.dependency_id_max_chars);
    assert.equal(
      createExecutableDependencyCatalog({
        macros: [{
          id: maxId,
          version: "1.0.0",
          risk: "read",
          descriptor_hash: sha("max-id"),
          capabilities: ["project.index"],
        }],
        templates: [],
        capabilities: ["project.index"],
      }).macros[0].id,
      maxId,
    );
    assert.throws(
      () => createExecutableDependencyCatalog({
        macros: [{
          id: `${maxId}x`,
          version: "1.0.0",
          risk: "read",
          descriptor_hash: sha("over-id"),
          capabilities: ["project.index"],
        }],
        templates: [],
        capabilities: ["project.index"],
      }),
      /id exceeds 96 characters/,
    );

    const destructiveStage = makeDraft();
    destructiveStage.stages.push({
      id: "checkpoint_only",
      kind: "checkpoint",
      dependency: null,
      inputs: [],
      outputs: [],
      risk: "destructive",
      checkpoint: "checkpoint_only_cp",
    });
    destructiveStage.checkpoints.push({
      id: "checkpoint_only_cp",
      after_stage: "checkpoint_only",
      evidence_id: "evidence_checkpoint_only",
      resume_identity: "resume.checkpoint_only",
      summary: "dependencyless checkpoint stage",
    });
    destructiveStage.preflight.stage_count = 3;
    destructiveStage.risk = "read";
    destructiveStage.risk_grants = ["read"];
    assert.match(
      validateExecutableRecipeDraft(destructiveStage, { catalog }).errors.join("\n"),
      /risk must be read for checkpoint stages|lower than highest stage\/dependency risk|must include highest stage\/dependency risk/,
    );

    const projection = executableRevisionDiscoveryProjection(sealed, { catalog });
    assert.deepEqual(Object.keys(projection).sort(), [
      "entity_kind",
      "id",
      "lifecycle",
      "pack",
      "risk",
      "summary",
      "tags",
      "title",
      "workflow_card",
    ].sort());
    assert.equal("executable_revision" in projection, false);
  });

  it("keeps agent-stepped recipes valid and never mutates filesystem or public tools", () => {
    const agentRecipe = {
      contract: RECIPE_CONTRACT,
      id: "recipe.tracks.prepare_dialog_track",
      title: "Prepare dialog track",
      summary: "Agent-stepped historical recipe remains valid.",
      pack: "tracks",
      lifecycle: "validated",
      risk: "write",
      entity_kind: "track",
      tags: ["track", "setup"],
      workflow_card: {
        intent: "Prepare dialog track.",
        entry_conditions: ["Read state first."],
        supported_steps: ["Call accepted template."],
        candidate_steps: [],
        blocked_steps: ["Do not use public call_recipe."],
        required_questions: [],
        template_atoms: ["template.tracks.create_track"],
        evidence_required: ["template.runtime.evidence.v1 with request id"],
        cleanup_plan: "Report typed blocker when cleanup atoms are absent.",
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
          summary: "Read bounded state.",
          uses: "get_state",
          call_template: null,
          get_state: { projection: "project.summary", refs: [] },
          checkpoint: "checkpoint_read_project",
          evidence: null,
          idempotency: { mode: "read_only", key_scope: "none", on_resume: "rerun" },
          on_failure: "branch_request_user",
        },
        {
          id: "create_dialog_track",
          title: "Create dialog track",
          summary: "Call accepted template.",
          uses: "call_template",
          call_template: {
            id: "template.tracks.create_track",
            input: { name: "Dialog" },
            refs: {},
          },
          get_state: null,
          checkpoint: "checkpoint_create_dialog_track",
          evidence: "evidence_create_dialog_track",
          idempotency: { mode: "supported", key_scope: "recipe_run", on_resume: "reuse_evidence" },
          on_failure: "branch_retry_create",
        },
      ],
      assertions: [
        {
          id: "assert_dialog_track_output",
          kind: "expected_output",
          summary: "Track ref expected.",
          required: true,
          evidence: ["evidence_create_dialog_track"],
          outputs: { refs: ["track_ref"], artifacts: [], jobs: [], state: ["track"] },
        },
      ],
      recovery: {
        run_state: {
          contract: "recipe.run_state.v1",
          initial: "not_started",
          states: ["not_started", "running", "paused", "succeeded", "failed", "blocked"],
          terminal: ["succeeded", "failed", "blocked"],
        },
        checkpoints: [
          {
            id: "checkpoint_read_project",
            after_step: "read_project",
            required_evidence: [],
            on_resume: "continue_next_step",
            summary: "State read done.",
          },
          {
            id: "checkpoint_create_dialog_track",
            after_step: "create_dialog_track",
            required_evidence: ["evidence_create_dialog_track"],
            on_resume: "continue_next_step",
            summary: "Template evidence retained.",
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
            summary: "Retry template step.",
          },
          {
            id: "branch_request_user",
            trigger: "resume_conflict",
            step: null,
            strategy: "request_user",
            summary: "Pause for user.",
          },
        ],
        risk_gates: [
          {
            id: "gate_write_fresh_state",
            applies_to: ["write"],
            required_before_step: "create_dialog_track",
            policy: "fresh_state",
            blocks_auto_resume: true,
            summary: "Fresh state before write.",
          },
        ],
      },
    };

    assert.equal(validateRecipeContract(agentRecipe).ok, true);
    assert.equal(normalizeRecipeContract(agentRecipe).contract, RECIPE_CONTRACT);
    // Alpha3.4-E2 supersedes the global five-tool assertion; E0 core remains non-executing.
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 6);
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.includes("call_recipe"), true);

    const coreSource = readFileSync(
      new URL("../../packages/core/src/executable-recipe-contract-v1.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(coreSource, /packages\/mcp-server/);
    assert.doesNotMatch(coreSource, /writeFileSync|mkdirSync|rmSync|spawn\(|execFile/);
    assert.doesNotMatch(coreSource, /function\s+(?:executeRecipe|runRecipe)\b/);

    normalizeExecutableRecipeDraft(makeDraft(), { catalog: makeCatalog() });
    normalizeExecutableRecipeRevision(
      sealExecutableRecipeRevision(makeDraft(), { catalog: makeCatalog() }),
      { catalog: makeCatalog() },
    );
    assert.equal(EXECUTABLE_RECIPE_DRAFT_CONTRACT, "recipe.executable.draft.v1");
  });
});

function makeCatalog() {
  return createExecutableDependencyCatalog({
    macros: [
      {
        id: "macro.project.inspect",
        version: "1.0.0",
        risk: "read",
        descriptor_hash: sha("macro.project.inspect:1.0.0"),
        capabilities: ["project.index"],
      },
    ],
    templates: [
      {
        id: "template.tracks.create_track",
        version: "1.0.0",
        risk: "write",
        descriptor_hash: sha("template.tracks.create_track:1.0.0"),
        capabilities: ["tracks.write"],
      },
    ],
    capabilities: ["project.index", "tracks.write"],
  });
}

function makeDraft() {
  return {
    contract: EXECUTABLE_RECIPE_DRAFT_CONTRACT,
    id: "recipe.tracks.prepare_dialog_track_executable",
    title: "Executable prepare dialog track",
    summary: "Macro-first executable draft with typed template fallback.",
    pack: "tracks",
    risk: "write",
    inputs: [
      { id: "track_name", type: "string", required: true },
    ],
    outputs: [
      { id: "track_ref", type: "ref.track", required: true },
    ],
    stages: [
      {
        id: "run_macro",
        kind: "macro",
        dependency: {
          kind: "macro",
          id: "macro.project.inspect",
          version: "1.0.0",
          fallback_reason: null,
        },
        inputs: ["track_name"],
        outputs: ["project_summary"],
        risk: "read",
        checkpoint: "checkpoint_run_macro",
      },
      {
        id: "readback",
        kind: "template",
        dependency: {
          kind: "template",
          id: "template.tracks.create_track",
          version: "1.0.0",
          fallback_reason: "official_template_atom_required",
        },
        inputs: ["project_summary", "track_name"],
        outputs: ["track_ref"],
        risk: "write",
        checkpoint: "checkpoint_readback",
      },
    ],
    bindings: [
      {
        from: { scope: "recipe_input", id: null, port: "track_name" },
        to: { scope: "stage", id: "run_macro", port: "track_name" },
      },
      {
        from: { scope: "stage", id: "run_macro", port: "project_summary" },
        to: { scope: "stage", id: "readback", port: "project_summary" },
      },
      {
        from: { scope: "recipe_input", id: null, port: "track_name" },
        to: { scope: "stage", id: "readback", port: "track_name" },
      },
      {
        from: { scope: "stage", id: "readback", port: "track_ref" },
        to: { scope: "recipe_output", id: null, port: "track_ref" },
      },
    ],
    dependencies: [
      {
        kind: "macro",
        id: "macro.project.inspect",
        version: "1.0.0",
        risk: "read",
        fallback_reason: null,
        descriptor_hash: sha("macro.project.inspect:1.0.0"),
      },
      {
        kind: "template",
        id: "template.tracks.create_track",
        version: "1.0.0",
        risk: "write",
        fallback_reason: "official_template_atom_required",
        descriptor_hash: sha("template.tracks.create_track:1.0.0"),
      },
    ],
    required_capabilities: ["project.index", "tracks.write"],
    risk_grants: ["read", "write"],
    checkpoints: [
      {
        id: "checkpoint_run_macro",
        after_stage: "run_macro",
        evidence_id: "evidence_run_macro",
        resume_identity: "resume.run_macro",
        summary: "Macro stage complete.",
      },
      {
        id: "checkpoint_readback",
        after_stage: "readback",
        evidence_id: "evidence_readback",
        resume_identity: "resume.readback",
        summary: "Template fallback stage complete.",
      },
    ],
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 2,
      dependency_count: 2,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability: {
      project_identity: "project:fixture-a",
      bridge_owner: "owner:fixture",
      bridge_generation: "generation:1",
      platform: "darwin",
    },
  };
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function completeTrustFacts(sealed) {
  return {
    content_hash: sealed.content_hash,
    risk_grants: sealed.draft.risk_grants,
    project_identity: sealed.draft.portability.project_identity,
    bridge_owner: sealed.draft.portability.bridge_owner,
    bridge_generation: sealed.draft.portability.bridge_generation,
    available_capabilities: sealed.draft.required_capabilities,
    checkpoint_evidence: sealed.draft.checkpoints.map((item) => ({
      checkpoint_id: item.id,
      evidence_id: item.evidence_id,
      resume_identity: item.resume_identity,
      recipe_id: sealed.recipe_id,
      version: sealed.version,
      revision: sealed.revision,
      content_hash: sealed.content_hash,
    })),
    dependency_versions: sealed.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
    })),
    dependency_descriptors: sealed.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      descriptor_hash: entry.descriptor_hash,
    })),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function expectedValidationResultId(recipeId, version, revision, contentHash, dependencyLock) {
  const lockIdentity = createHash("sha256").update(stableStringify(dependencyLock)).digest("hex");
  const identityHash = createHash("sha256").update(stableStringify({
    recipe_id: recipeId,
    version,
    revision,
    content_hash: contentHash,
    dependency_lock_identity: lockIdentity,
  })).digest("hex");
  return `validation.${identityHash.slice(0, 48)}`;
}

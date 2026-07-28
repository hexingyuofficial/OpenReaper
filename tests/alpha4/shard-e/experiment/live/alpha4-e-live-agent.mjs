#!/usr/bin/env node

import { createHash } from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const ALPHA4_E_LIVE_AGENT_CONTRACT = "openreaper.alpha4.e.live_agent.v1";

const DIRECT_RUN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const COMPILE_BLOCKER_CODES = new Set([
  "LEARNING_TARGET_AMBIGUOUS",
  "LEARNING_SEMANTICS_UNSUPPORTED",
  "LEARNING_PLUGIN_NOT_INSTALLED",
]);
const LEARNER_FORBIDDEN = [
  "teacher_prompt",
  "transcript",
  "calls",
  "evidence",
  "manifest",
  "hidden",
  "source:alpha4-shard-e",
];

export function demonstrateTrial({ trial, runtime, row_prefix: rowPrefix, recipe_id: recipeId }) {
  assert(trial?.contract === "openreaper.alpha4.e.hidden_trial.v1", "Demonstrator requires one private trial.");
  const capture = Object.freeze({
    contract: "openreaper.alpha4.e.demonstrator_capture.v1",
    capture_id: `capture.${trial.trial_id}.${digest(canonicalJson(trial.semantic_facts)).slice(0, 16)}`,
    trial_id: trial.trial_id,
    operation_count: trial.operation_count,
    scenario: trial.scenario,
    semantic_facts: trial.semantic_facts,
    intent_summary: trial.intent,
    blocker_observation: trial.observation,
  });
  return Object.freeze({
    contract: ALPHA4_E_LIVE_AGENT_CONTRACT,
    role: "demonstrator",
    capture,
    artifact: compileCapture({
      semantic_facts: capture.semantic_facts,
      intent_summary: capture.intent_summary,
      blocker_observation: capture.blocker_observation,
      operation_count: capture.operation_count,
      scenario: capture.scenario,
      runtime,
      row_prefix: rowPrefix,
      recipe_id: recipeId,
    }),
  });
}

export function learnFromCapture(input) {
  assert(input?.contract === "openreaper.learning_capture.v1", "Learner requires an attested learning capture.");
  assert(input?.attestation?.status === "passed", "Learner capture attestation is missing.");
  const encoded = canonicalJson(input).toLowerCase();
  const forbidden = LEARNER_FORBIDDEN.filter((term) => encoded.includes(term));
  assert(forbidden.length === 0, `Learner input contains forbidden terms: ${forbidden.join(", ")}`);
  return Object.freeze({
    contract: ALPHA4_E_LIVE_AGENT_CONTRACT,
    role: "learner",
    artifact: compileCapture(input),
  });
}

export function compileCapture(input) {
  const facts = Array.isArray(input?.semantic_facts) ? input.semantic_facts : [];
  const intents = Array.isArray(input?.intent_summary) ? input.intent_summary : [];
  assert(Number.isInteger(input?.operation_count) && input.operation_count === facts.length, "Capture operation count is inconsistent.");
  assert(intents.length === facts.length, "Capture intent count is inconsistent.");
  const blockerCode = input?.blocker_observation?.code ?? null;
  if (COMPILE_BLOCKER_CODES.has(blockerCode)) {
    return Object.freeze({
      contract: "openreaper.alpha4.e.learned_artifact.v1",
      status: "blocked",
      operation_count: facts.length,
      semantic_signature: semanticSignature(facts),
      intent_signature: semanticSignature(intents),
      typed_blocker: Object.freeze({ code: blockerCode, recoverable: true, zero_write: true }),
      projection_rows: Object.freeze([]),
      draft: null,
      run_inputs: null,
    });
  }

  const itemPool = Array.isArray(input.runtime?.item_pool) ? input.runtime.item_pool : [];
  assert(itemPool.length >= facts.length, "Executable Item carrier does not cover every captured operation.");
  const projectionRows = Object.freeze(facts.map((fact, index) => projectFact(
    fact,
    index,
    input.row_prefix,
    itemPool[index]?.item_ref,
  )));
  const portability = {
    project_identity: input.runtime?.portability?.project_identity ?? "project:runtime_bound",
    bridge_owner: input.runtime?.portability?.bridge_owner ?? "bridge:runtime_bound",
    bridge_generation: input.scenario === "runtime_drift"
      ? String(input.blocker_observation?.requested_generation ?? "999999")
      : input.runtime?.portability?.bridge_generation ?? "generation:runtime_bound",
    platform: input.runtime?.portability?.platform ?? "darwin",
  };
  const draft = executableDraft({
    recipeId: input.recipe_id,
    operationCount: facts.length,
    dependency: input.runtime?.dependency,
    portability,
  });
  return Object.freeze({
    contract: "openreaper.alpha4.e.learned_artifact.v1",
    status: "compiled",
    operation_count: facts.length,
    semantic_signature: semanticSignature(facts),
    intent_signature: semanticSignature(intents),
    typed_blocker: null,
    projection_contract: "openreaper.alpha4.e.live_executable_projection.v1",
    projection_disclaimer: "Semantic scoring is independent; exact Item length rows are a one-to-one executable batch carrier, not original-domain mutation equivalence.",
    projection_rows: projectionRows,
    draft: Object.freeze(draft),
    run_inputs: Object.freeze({
      mode: "set_item_take_controls",
      changes: projectionRows,
      dry_run: false,
    }),
  });
}

function executableDraft({ recipeId, operationCount, dependency, portability }) {
  assert(typeof recipeId === "string" && recipeId.startsWith("recipe.project."), "Executable recipe id is invalid.");
  assert(dependency?.id === "macro.items.apply", "Executable Item batch dependency is missing.");
  const inputPorts = [
    ["mode", "string"],
    ["changes", "array"],
    ["dry_run", "boolean"],
  ];
  return {
    contract: "recipe.executable.draft.v1",
    id: recipeId,
    title: `Alpha4 E ${String(operationCount).padStart(2, "0")} operation replay`,
    summary: "Replay an independently scored semantic capture through the generic native Item batch Recipe runner.",
    pack: "project",
    risk: dependency.risk,
    inputs: inputPorts.map(([id, type]) => ({ id, type, required: true })),
    outputs: [],
    stages: [{
      id: "apply",
      kind: "macro",
      dependency: { kind: "macro", id: dependency.id, version: dependency.version, fallback_reason: null },
      inputs: inputPorts.map(([id]) => id),
      outputs: [],
      risk: dependency.risk,
      checkpoint: "after_apply",
    }],
    bindings: inputPorts.map(([port]) => ({
      from: { scope: "recipe_input", id: null, port },
      to: { scope: "stage", id: "apply", port },
    })),
    dependencies: [{
      kind: "macro",
      id: dependency.id,
      version: dependency.version,
      risk: dependency.risk,
      fallback_reason: null,
      descriptor_hash: dependency.descriptor_hash,
    }],
    required_capabilities: [...(dependency.capabilities ?? [])].sort(),
    risk_grants: [dependency.risk],
    checkpoints: [{
      id: "after_apply",
      after_stage: "apply",
      evidence_id: "evidence_apply",
      resume_identity: "resume.apply",
      summary: "The generic Item batch stage completed with aggregate native live readback.",
    }],
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 1,
      dependency_count: 1,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability,
  };
}

function projectFact(fact, index, prefix, itemRef) {
  assert(/^item:guid:\{[0-9a-f-]{36}\}$/iu.test(itemRef), `Executable Item carrier ref ${index + 1} is invalid.`);
  const semanticDigest = digest(`${prefix}:${canonicalJson(fact)}`);
  const digestOffset = Number.parseInt(semanticDigest.slice(0, 6), 16) % 40_000;
  const lengthSeconds = Number((1 + (index * 0.05) + (digestOffset / 1_000_000)).toFixed(6));
  return Object.freeze({
    id: `f${String(index + 1).padStart(3, "0")}${semanticDigest.slice(0, 8)}`,
    item_ref: itemRef,
    item: Object.freeze({ length_seconds: lengthSeconds }),
  });
}

function semanticSignature(value) {
  return digest(canonicalJson(value ?? null));
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (DIRECT_RUN) {
  const role = process.env.ALPHA4_E_AGENT_ROLE;
  const interfaceReader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  interfaceReader.on("line", (line) => {
    if (line.trim() === "") return;
    let request;
    try {
      request = JSON.parse(line);
      const result = role === "demonstrator"
        ? demonstrateTrial(request.payload)
        : role === "learner"
          ? learnFromCapture(request.payload)
          : (() => { throw new Error(`Unsupported ALPHA4_E_AGENT_ROLE: ${String(role)}`); })();
      process.stdout.write(`${JSON.stringify({ request_id: request.request_id, ok: true, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ request_id: request?.request_id ?? null, ok: false, error: { message: String(error?.message ?? error) } })}\n`);
    }
  });
}

#!/usr/bin/env node

import { createInterface } from "node:readline";
import { submissionFromLearnerInput } from "../../corpus/oracle.mjs";

const role = process.env.OPENREAPER_ALPHA4_E_ROLE;
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const recipeArguments = {
  operation: "run",
  recipe_id: "recipe.alpha4.e.fixture",
  version: "1.0.0",
  revision: 1,
  content_hash: "a".repeat(64),
  validation_result_id: "validation:alpha4-e-fixture",
};

function proofs() {
  return {
    readback: { passed: true },
    whole_recipe_undo: { scope: "whole_recipe", begin_proof: true, close_proof: true, closed: true },
    reconnect_identity: { matched: true },
    call_recipe_replay: { same_revision_identity: true },
  };
}

function validInput(input) {
  if (role === "demonstrator") {
    return input?.teacher_prompt && Array.isArray(input.transcript) && Array.isArray(input.calls) && input.evidence && input.manifest;
  }
  return input?.capture?.source_blind === true && !Object.hasOwn(input, "hidden") && !Object.hasOwn(input, "teacher_prompt");
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let finished = false;
let trialInput = null;
for await (const line of rl) {
  const message = JSON.parse(line);
  if (message.type === "init") {
    const input = message.input;
    trialInput = input;
    if (!validInput(input)) {
      out({ type: "result", submission: { verified: false, proofs: proofs() } });
      finished = true;
      break;
    }
    out({ type: "call", id: "ping", tool: "ping", arguments: {} });
    out({ type: "call", id: "state", tool: "get_state", arguments: { scope: "project" } });
    out({ type: "call", id: "run-1", tool: "call_recipe", arguments: recipeArguments });
    out({ type: "call", id: "run-2", tool: "call_recipe", arguments: recipeArguments });
    out({ type: "reconnect", id: "reconnect" });
    continue;
  }
  if (message.type === "reconnect_result") {
    const submission = role === "learner"
      ? submissionFromLearnerInput(trialInput)
      : { verified: true };
    out({ type: "call", id: "ping-after", tool: "ping", arguments: {} });
    out({ type: "result", submission: { ...submission, proofs: proofs() } });
    finished = true;
    break;
  }
  if (message.type === "call_result") continue;
  throw new Error(`Unexpected Alpha4 E fixture message: ${message.type}`);
}

if (!finished) process.exitCode = 2;

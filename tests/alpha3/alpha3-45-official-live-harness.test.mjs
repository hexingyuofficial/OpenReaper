import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ALPHA3_45_OFFICIAL_RECIPE_IDS,
  installedWrapperEnvironmentAlpha345,
  runAlpha345OfficialRecipesHarness,
} from "../../scripts/smoke-alpha3-45-official-recipes.mjs";

const roots = [];

test.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("installed official harness connector replaces stale package-local paths", () => {
  const installRoot = path.join(os.tmpdir(), "alpha345-installed", "current");
  const installedWrapper = path.join(installRoot, "bin", "openreaper-mcp");
  const liveEnvironment = {
    transportDir: "/tmp/alpha345-live/transport",
    bridgeOwner: "alpha345-owner",
    bridgeGeneration: 7,
    projectPath: "/tmp/alpha345-live/project.RPP",
    indexRoot: "/tmp/alpha345-live/index",
    artifactRoot: "/tmp/alpha345-live/artifacts",
    renderRoot: "/tmp/alpha345-live/renders",
  };
  const environment = installedWrapperEnvironmentAlpha345({
    installedWrapper,
    liveEnvironment,
    parentEnvironment: {
      OPENREAPER_SESSION_ROOT: "/stale/session",
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: "/stale/openreaper-live-bridge.lua",
      OPENREAPER_MCP_PACKAGE_ROOT: "/stale/package",
    },
  });

  assert.equal(environment.OPENREAPER_SESSION_ROOT, path.join(installRoot, "session"));
  assert.equal(
    environment.OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH,
    path.join(installRoot, "vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"),
  );
  assert.equal(environment.OPENREAPER_MCP_PACKAGE_ROOT, installRoot);
  assert.equal(environment.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR, liveEnvironment.transportDir);
});

test("official live harness discovers and one-calls exactly two active Recipes", async () => {
  const fixtureValue = await makeHarnessFixture();
  const calls = [];
  const transport = fakeRecipeTransport(calls);
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: fixtureValue.wrapper,
    evidenceRoot: fixtureValue.evidenceRoot,
    fixture: activeFixture(),
    callRecipe: transport.callRecipe,
  });

  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.discovery.ids, ALPHA3_45_OFFICIAL_RECIPE_IDS);
  assert.equal(report.discovery.count, 2);
  assert.equal(report.official_runs.length, 2);
  assert.equal(report.official_runs.every((row) => (
    row.public_call_count === 1
    && row.speed_ok === true
    && row.undo?.status === "closed"
    && row.undo?.proven === true
    && row.evidence_refs.length > 0
  )), true);
  assert.deepEqual(
    calls.filter((call) => call.operation === "run").map((call) => call.recipe_id),
    ALPHA3_45_OFFICIAL_RECIPE_IDS,
  );
  assert.equal(calls.some((call) => /create_layered_sound_effect_variants|create_sound_variations/u.test(call.recipe_id ?? "")), false);

  const persisted = JSON.parse(await readFile(path.join(fixtureValue.evidenceRoot, "alpha3-45-official-recipes.json"), "utf8"));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.report_storage.mode, "bounded_truth_summary");
  assert.equal(Buffer.byteLength(JSON.stringify(persisted), "utf8") <= 64 * 1024, true);
  assert.equal(persisted.official_runs.every((row) => Object.hasOwn(row, "output_values") === false), true);
});

test("official live harness proves generic fork validate/save/reconnect/list/get/run for both active Recipes", async () => {
  const fixtureValue = await makeHarnessFixture();
  const calls = [];
  const transport = fakeRecipeTransport(calls);
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: fixtureValue.wrapper,
    evidenceRoot: fixtureValue.evidenceRoot,
    fixture: activeFixture(),
    callRecipe: transport.callRecipe,
    runForkProof: true,
  });

  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.fork_proof.ok, true, JSON.stringify(report.fork_proof));
  assert.equal(report.fork_proof.forks.length, 2);
  assert.deepEqual(report.fork_proof.forks.map((row) => row.semantic_recipe_id), ALPHA3_45_OFFICIAL_RECIPE_IDS);
  assert.equal(report.fork_proof.forks.every((row) => row.fork_truth === true && row.speed_ok === true), true);
  assert.equal(calls.filter((call) => call.operation === "validate").length, 2);
  assert.equal(calls.filter((call) => call.operation === "save").length, 2);
  assert.equal(calls.filter((call) => call.operation === "run" && /^recipe\.user\.forked_/u.test(call.recipe_id)).length, 2);
});

test("official live harness fails closed when an active official Recipe is missing", async () => {
  const fixtureValue = await makeHarnessFixture();
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: fixtureValue.wrapper,
    evidenceRoot: fixtureValue.evidenceRoot,
    fixture: activeFixture(),
    callRecipe: async (args) => args.operation === "list"
      ? { ok: true, items: [officialIdentity(ALPHA3_45_OFFICIAL_RECIPE_IDS[0], 0)] }
      : { ok: false },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_RECIPE_NOT_DISCOVERED");
  assert.equal(report.project.final_state, "failed");
});

test("official live harness rejects a fixture missing an active Recipe input before execution", async () => {
  const fixtureValue = await makeHarnessFixture();
  await assert.rejects(
    runAlpha345OfficialRecipesHarness({
      installedWrapper: fixtureValue.wrapper,
      evidenceRoot: fixtureValue.evidenceRoot,
      fixture: { inputs: { [ALPHA3_45_OFFICIAL_RECIPE_IDS[0]]: {} } },
      callRecipe: async () => ({ ok: true }),
    }),
    (error) => error.code === "OFFICIAL_FIXTURE_INPUT_REQUIRED",
  );
});

async function makeHarnessFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-active-harness-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  return { root, wrapper, evidenceRoot: path.join(root, "evidence") };
}

function activeFixture() {
  return {
    inputs: {
      "recipe.mix.create_bus_processing": {
        source_tracks: ["track:guid:{SOURCE}"],
        bus_name: "OpenReaper Bus",
        fx_chain: [{ plugin_query: "ReaVerbate" }],
      },
      "recipe.midi.create_instrument_part": {
        track_name: "OpenReaper Instrument",
        instrument: "ReaSynth",
        bars: 4,
      },
    },
  };
}

function fakeRecipeTransport(calls) {
  const official = new Map(ALPHA3_45_OFFICIAL_RECIPE_IDS.map((id, index) => [id, officialIdentity(id, index)]));
  const users = new Map();
  const userSemanticIds = new Map();
  let saveIndex = 0;
  const callRecipe = async (args) => {
    calls.push(structuredClone(args));
    if (args.operation === "list") {
      return {
        ok: true,
        items: [
          ...[...official.values()],
          ...[...users.values()].map((row) => ({ ...row, source: "user", immutable: true })),
        ],
      };
    }
    if (args.operation === "validate") return { ok: true, status: "validated" };
    if (args.operation === "save") {
      const semanticId = ALPHA3_45_OFFICIAL_RECIPE_IDS[saveIndex];
      saveIndex += 1;
      const identity = {
        recipe_id: args.draft.id,
        version: args.version,
        revision: 1,
        content_hash: `user-${saveIndex}-${"c".repeat(64)}`,
        validation_result_id: `validation:user:${saveIndex}`,
      };
      users.set(identity.recipe_id, identity);
      userSemanticIds.set(identity.recipe_id, semanticId);
      return { ok: true, status: "saved", immutable: true, identity, ...identity };
    }
    if (args.operation === "get") {
      const user = users.get(args.recipe_id);
      if (user) return { ok: true, source: "user", immutable: true, draft: { id: user.recipe_id }, ...user };
      const identity = official.get(args.recipe_id);
      return identity
        ? { ok: true, source: "official", immutable: true, draft: officialDraft(identity.recipe_id), ...identity }
        : { ok: false, error: { code: "REVISION_NOT_FOUND" } };
    }
    if (args.operation === "run") return successfulRun(userSemanticIds.get(args.recipe_id) ?? args.recipe_id);
    throw new Error(`Unexpected operation: ${args.operation}`);
  };
  return { callRecipe };
}

function officialIdentity(recipeId, index) {
  return {
    recipe_id: recipeId,
    version: "1.0.0",
    revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
    source: "official",
    immutable: true,
  };
}

function officialDraft(recipeId) {
  return {
    contract: "recipe.executable.draft.v1",
    id: recipeId,
    title: recipeId,
    stages: [{ id: "stage" }],
  };
}

function successfulRun(recipeId) {
  const outputs = recipeId === "recipe.mix.create_bus_processing"
    ? [
      verified("layout_changes", [applied("track:guid:{BUS}")]),
      verified("routing_changes", [applied("send:guid:{SEND}")]),
      verified("processing_evidence", "artifact:fx-chain"),
    ]
    : [
      verified("layout_changes", [applied("track:guid:{INSTRUMENT}")]),
      verified("instrument_changes", [applied("fx:track:guid:{INSTRUMENT}:0")]),
      verified("midi_evidence", "artifact:midi-part"),
    ];
  return {
    ok: true,
    status: "completed",
    recipe_id: recipeId,
    run_id: `run:${recipeId}`,
    verified_outputs: outputs,
    evidence_ref: `recipe-evidence:${recipeId}`,
    undo: { claimed: true, status: "closed", proven: true, evidence_refs: [`undo:${recipeId}`] },
    execution_truth: { mutation: "applied_verified", native_mutation_count: 3, readback_count: 3 },
  };
}

function verified(id, value) {
  return { id, verified: true, value };
}

function applied(targetRef) {
  return {
    target_ref: targetRef,
    status: "applied",
    mutation: { status: "completed" },
    live_readback: { status: "passed" },
  };
}

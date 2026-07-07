import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT,
  ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY,
  forkAlpha3D2Workflow,
  installAlpha3D2Workflow,
  saveAlpha3D2Workflow,
  shareAlpha3D2Workflow,
} from "../../packages/core/src/alpha3-d2-workflow-entrypoints-v1.mjs";
import {
  ALPHA3_D2_WORKFLOW_PACKET_CONTRACT,
  validateAlpha3D2WorkflowPacket,
} from "../../packages/core/src/alpha3-d2-workflow-portability-v1.mjs";
import {
  loadUserRecipeAuthoringCatalog,
} from "../../packages/core/src/user-recipe-authoring-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const RECIPE_PATH = path.join(
  REPO_ROOT,
  "recipes",
  "official",
  "layer7",
  "first_atoms_a",
  "project.fast_observation_bundle.recipe.json",
);
const CLI_PATH = path.join(REPO_ROOT, "scripts", "alpha3-d2-workflow-entrypoint.mjs");

describe("Alpha3 D2 real workflow entrypoints", () => {
  it("saves and shares workflow packets as local files without adding execution surface", () => {
    const recipe = loadRecipe();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-entrypoints-"));
    const outputDirectory = path.join(temp, "packets");

    const saved = saveAlpha3D2Workflow({
      recipe,
      source: "official",
      output_directory: outputDirectory,
    }, fixedClock());
    const shared = shareAlpha3D2Workflow({
      recipe,
      source: "official",
      output_directory: outputDirectory,
      filename: "fast-observation.workflow-packet.json",
    }, fixedClock());

    assert.equal(saved.contract, ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT);
    assert.equal(saved.ok, true);
    assert.equal(shared.ok, true);
    assert.equal(shared.operation, "share");
    assert.equal(existsSync(shared.paths.packet_path), true);
    assert.equal(shared.packet.contract, ALPHA3_D2_WORKFLOW_PACKET_CONTRACT);
    assert.equal(validateAlpha3D2WorkflowPacket(shared.packet).ok, true);
    assert.deepEqual(saved.safety.execution_path, ["list_recipes", "call_template", "get_state"]);
    assert.equal(saved.safety.added_tools, 0);
    assert.equal(saved.safety.public_call_recipe, false);
    assert.equal(saved.safety.hidden_executor, false);
    assert.equal(saved.safety.raw_lua_action_shell_or_ui, false);
    assert.equal(saved.safety.live_reaper, false);
    assert.equal(saved.safety.safe_write, false);
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
  });

  it("installs a forked workflow into an approved user recipe root and verifies catalog readback", () => {
    const recipe = loadRecipe();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-install-"));
    const outputDirectory = path.join(temp, "packets");
    const recipeRoot = path.join(temp, "recipes", "user");

    const shared = shareAlpha3D2Workflow({
      recipe,
      source: "official",
      output_directory: outputDirectory,
    }, fixedClock());
    const forked = forkAlpha3D2Workflow({
      packet: shared.packet,
      output_directory: outputDirectory,
      new_id: "recipe.project.fast_observation_bundle_variant",
      title: "Fast observation variant",
      summary: "User fork for a local project observation workflow.",
    }, fixedClock());
    const installed = installAlpha3D2Workflow({
      packet: forked.packet,
      recipe_root: recipeRoot,
    }, fixedClock());

    assert.equal(forked.ok, true);
    assert.equal(forked.packet.provenance.parent_packet_id, shared.packet.packet_id);
    assert.equal(forked.packet.provenance.parent_recipe_id, recipe.id);
    assert.equal(installed.ok, true);
    assert.equal(installed.operation, "install");
    assert.equal(existsSync(installed.paths.recipe_path), true);
    assert.equal(installed.verification.ok, true);
    assert.equal(installed.workflow.id, "recipe.project.fast_observation_bundle_variant");

    const authoring = loadUserRecipeAuthoringCatalog({
      roots: [{ source: "user", root: recipeRoot }],
    });
    assert.equal(authoring.sources.length, 1);
    assert.equal(authoring.sources[0].id, "recipe.project.fast_observation_bundle_variant");
    assert.equal(authoring.sources[0].source, "user");
  });

  it("accepts packet-shaped requests with local entrypoint fields without scanning those paths as shared content", () => {
    const recipe = loadRecipe();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-spread-packet-"));
    const outputDirectory = path.join(temp, "packets");
    const recipeRoot = path.join(temp, "recipes", "user");

    const shared = shareAlpha3D2Workflow({
      recipe,
      source: "official",
      output_directory: outputDirectory,
    }, fixedClock());
    const forked = forkAlpha3D2Workflow({
      ...shared.packet,
      output_directory: outputDirectory,
      new_id: "recipe.project.fast_observation_bundle_spread",
    }, fixedClock());
    const installed = installAlpha3D2Workflow({
      ...forked.packet,
      recipe_root: recipeRoot,
    }, fixedClock());

    assert.equal(forked.ok, true);
    assert.equal(installed.ok, true);
    assert.equal(
      installed.blockers.some((entry) => entry.code === "UNSAFE_LOCAL_PATH"),
      false,
    );
    assert.equal(installed.workflow.id, "recipe.project.fast_observation_bundle_spread");
  });

  it("preserves fork provenance when a forked packet is saved or shared again", () => {
    const recipe = loadRecipe();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-provenance-"));
    const outputDirectory = path.join(temp, "packets");
    const shared = shareAlpha3D2Workflow({
      recipe,
      source: "official",
      output_directory: outputDirectory,
    }, fixedClock());
    const forked = forkAlpha3D2Workflow({
      packet: shared.packet,
      output_directory: outputDirectory,
      new_id: "recipe.project.fast_observation_bundle_lineage",
    }, fixedClock());
    const reshared = shareAlpha3D2Workflow({
      packet: forked.packet,
      output_directory: path.join(temp, "reshared"),
    }, fixedClock());

    assert.equal(forked.ok, true);
    assert.equal(reshared.ok, true);
    assert.equal(reshared.packet.provenance.source, "user");
    assert.equal(reshared.packet.provenance.parent_recipe_id, recipe.id);
    assert.equal(reshared.packet.provenance.parent_packet_id, shared.packet.packet_id);
    assert.equal(reshared.packet.provenance.forked_from, shared.packet.packet_id);
  });

  it("blocks same-id forks and direct official packet installs into user roots", () => {
    const recipe = loadRecipe();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-shadow-"));
    const outputDirectory = path.join(temp, "packets");
    const recipeRoot = path.join(temp, "recipes", "user");
    const shared = shareAlpha3D2Workflow({
      recipe,
      source: "official",
      output_directory: outputDirectory,
    }, fixedClock());
    const sameIdFork = forkAlpha3D2Workflow({
      packet: shared.packet,
      output_directory: outputDirectory,
      new_id: recipe.id,
    }, fixedClock());
    const directInstall = installAlpha3D2Workflow({
      packet: shared.packet,
      recipe_root: recipeRoot,
    }, fixedClock());

    assert.equal(sameIdFork.ok, false);
    assert.equal(blockerCodes(sameIdFork).includes("FORK_RECIPE_ID_UNCHANGED"), true);
    assert.equal(directInstall.ok, false);
    assert.equal(blockerCodes(directInstall).includes("OFFICIAL_WORKFLOW_INSTALL_REQUIRES_FORK"), true);
    assert.equal(existsSync(directInstall.paths.recipe_path ?? ""), false);
  });

  it("blocks path escape, accidental overwrite, and official id shadowing before install write", () => {
    const recipe = loadRecipe();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-blocks-"));
    const outputDirectory = path.join(temp, "packets");
    const recipeRoot = path.join(temp, "recipes", "user");
    const packet = shareAlpha3D2Workflow({
      recipe,
      source: "official",
      output_directory: outputDirectory,
    }, fixedClock()).packet;

    const escape = installAlpha3D2Workflow({
      packet,
      recipe_root: recipeRoot,
      relative_path: "../outside.recipe.json",
    }, fixedClock());
    const reserved = installAlpha3D2Workflow({
      packet,
      recipe_root: recipeRoot,
      official_recipe_ids: [recipe.id],
    }, fixedClock());
    const forked = forkAlpha3D2Workflow({
      packet,
      output_directory: outputDirectory,
      new_id: "recipe.project.fast_observation_bundle_local",
    }, fixedClock());
    const firstInstall = installAlpha3D2Workflow({
      packet: forked.packet,
      recipe_root: recipeRoot,
    }, fixedClock());
    const secondInstall = installAlpha3D2Workflow({
      packet: forked.packet,
      recipe_root: recipeRoot,
    }, fixedClock());

    assert.equal(escape.ok, false);
    assert.equal(blockerCodes(escape).includes("INSTALL_PATH_INVALID"), true);
    assert.equal(reserved.ok, false);
    assert.equal(blockerCodes(reserved).includes("RECIPE_ID_RESERVED"), true);
    assert.equal(firstInstall.ok, true);
    assert.equal(secondInstall.ok, false);
    assert.equal(blockerCodes(secondInstall).includes("TARGET_EXISTS"), true);
    assert.equal(blockerCodes(secondInstall).includes("RECIPE_ID_ALREADY_INSTALLED"), true);
  });

  it("keeps workflow entrypoints discoverable as product helpers rather than a new MCP tool", () => {
    assert.equal(ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY.user_word ?? "workflow", "workflow");
    assert.deepEqual(ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY.operations, [
      "save",
      "scrub",
      "share",
      "install",
      "fork",
    ]);
    assert.equal(ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY.tool_surface.added_tools, 0);
    assert.equal(ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY.tool_surface.public_call_recipe, false);
    assert.equal(ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY.tool_surface.hidden_executor, false);
    assert.match(
      ALPHA3_D2_WORKFLOW_ENTRYPOINTS_DISCOVERY_SUMMARY.rule,
      /list_recipes and calling declared call_template\/get_state steps/,
    );
  });

  it("exposes a local CLI entrypoint for share and install operations", () => {
    const recipe = loadRecipe();
    const temp = mkdtempSync(path.join(tmpdir(), "openreaper-d2-cli-"));
    const inputPath = path.join(temp, "input.recipe.json");
    const outputDirectory = path.join(temp, "packets");
    const recipeRoot = path.join(temp, "recipes", "user");
    writeFileSync(inputPath, `${JSON.stringify(recipe, null, 2)}\n`, "utf8");

    const shareOutput = execFileSync(process.execPath, [
      CLI_PATH,
      "--operation",
      "share",
      "--input",
      inputPath,
      "--output-directory",
      outputDirectory,
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    const shared = JSON.parse(shareOutput);
    const packetPath = path.join(outputDirectory, "project.fast_observation_bundle.workflow-packet.json");
    assert.equal(shared.ok, true);
    assert.equal(existsSync(packetPath), true);

    const forkOutput = execFileSync(process.execPath, [
      CLI_PATH,
      "--operation",
      "fork",
      "--input",
      packetPath,
      "--output-directory",
      outputDirectory,
      "--new-id",
      "recipe.project.fast_observation_bundle_cli",
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    const forked = JSON.parse(forkOutput);
    const forkPath = path.join(outputDirectory, "project.fast_observation_bundle_cli.workflow-packet.json");
    assert.equal(forked.ok, true);
    assert.equal(existsSync(forkPath), true);

    const installOutput = execFileSync(process.execPath, [
      CLI_PATH,
      "--operation",
      "install",
      "--input",
      forkPath,
      "--recipe-root",
      recipeRoot,
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    const installed = JSON.parse(installOutput);
    assert.equal(installed.ok, true);
    assert.equal(existsSync(installed.paths.recipe_path), true);
  });
});

function loadRecipe() {
  return JSON.parse(readFileSync(RECIPE_PATH, "utf8"));
}

function fixedClock() {
  return {
    now: () => new Date("2026-07-07T13:05:00.000Z"),
  };
}

function blockerCodes(result) {
  return result.blockers.map((blocker) => blocker.code);
}

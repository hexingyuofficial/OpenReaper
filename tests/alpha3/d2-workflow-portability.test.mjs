import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALPHA3_D2_PORTABILITY_DISCOVERY_SUMMARY,
  ALPHA3_D2_WORKFLOW_OPERATIONS,
  ALPHA3_D2_WORKFLOW_PACKET_CONTRACT,
  ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT,
  createAlpha3D2WorkflowPacket,
  planAlpha3D2WorkflowPortability,
  scanAlpha3D2PortablePayload,
  scrubAlpha3D2PortablePayload,
  validateAlpha3D2WorkflowPacket,
} from "../../packages/core/src/alpha3-d2-workflow-portability-v1.mjs";
import {
  recipeTemplateDependencies,
} from "../../packages/core/src/recipe-contract-v1.mjs";
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

describe("Alpha3 D2 workflow portability", () => {
  it("creates a portable workflow packet from an official draft recipe without adding tools or executors", () => {
    const recipe = loadRecipe();
    const packet = createAlpha3D2WorkflowPacket({
      recipe,
      source: "official",
    }, {
      now: () => new Date("2026-07-07T12:40:00.000Z"),
    });

    assert.equal(packet.contract, ALPHA3_D2_WORKFLOW_PACKET_CONTRACT);
    assert.equal(packet.packet_kind, "workflow_recipe");
    assert.equal(packet.user_word, "workflow");
    assert.equal(packet.workflow.id, recipe.id);
    assert.deepEqual(packet.dependencies.template_ids, recipeTemplateDependencies(recipe));
    assert.equal(packet.dependencies.risk, "read");
    assert.equal(packet.portability.status, "portable");
    assert.equal(packet.portability.coverage_status, "share_install_fork_ready");
    assert.deepEqual(packet.safety.execution_path, ["list_recipes", "call_template", "get_state"]);
    assert.equal(packet.safety.added_tools, 0);
    assert.equal(packet.safety.public_call_recipe, false);
    assert.equal(packet.safety.hidden_executor, false);
    assert.equal(packet.safety.raw_lua_action_shell_or_ui, false);
    assert.equal(packet.safety.install_writes_files, false);

    assert.equal(validateAlpha3D2WorkflowPacket(packet).ok, true);
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
  });

  it("plans save, scrub, share, install, and fork readiness over one scrubbed packet", () => {
    const recipe = loadRecipe();

    assert.deepEqual(ALPHA3_D2_WORKFLOW_OPERATIONS, [
      "save",
      "scrub",
      "share",
      "install",
      "fork",
    ]);

    for (const operation of ALPHA3_D2_WORKFLOW_OPERATIONS) {
      const plan = planAlpha3D2WorkflowPortability({
        operation,
        source: "official",
        recipe,
      }, {
        now: () => new Date("2026-07-07T12:45:00.000Z"),
      });

      assert.equal(plan.contract, ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT);
      assert.equal(plan.ok, true, operation);
      assert.equal(plan.operation, operation);
      assert.equal(plan.mode, "plan_only_workflow_portability");
      assert.equal(plan.user_word, "workflow");
      assert.equal(plan.packet.contract, ALPHA3_D2_WORKFLOW_PACKET_CONTRACT);
      assert.equal(plan.readiness[operation].ready, true, operation);
      assert.equal(plan.safety.added_tools, 0);
      assert.equal(plan.safety.live_reaper, false);
      assert.equal(plan.safety.safe_write, false);
      assert.equal(plan.safety.install_writes_files, false);
      assert.doesNotMatch(JSON.stringify(plan), /hidden executor|call_recipe.*available/i);
    }
  });

  it("scrubs private envelope fields while preserving the recipe and provenance shape", () => {
    const recipe = loadRecipe();
    const scrubbed = scrubAlpha3D2PortablePayload({
      recipe,
      provenance: {
        source: "user",
        private_notes: "This was from a client session.",
        local_path: "/Users/Zhuanz/Secret/session.rpp",
        token: "secret-token",
      },
    });

    assert.equal(scrubbed.contract, ALPHA3_D2_WORKFLOW_PORTABILITY_CONTRACT);
    assert.equal(scrubbed.payload.recipe.id, recipe.id);
    assert.equal("private_notes" in scrubbed.payload.provenance, false);
    assert.equal("local_path" in scrubbed.payload.provenance, false);
    assert.equal("token" in scrubbed.payload.provenance, false);
    assert.equal(
      scrubbed.actions.every((action) => action.code === "REMOVE_PRIVATE_OR_LOCAL_FIELD"),
      true,
    );
  });

  it("blocks public sharing when paths, request ids, project refs, or artifact aliases remain", () => {
    const recipe = loadRecipe();
    const bad = {
      operation: "share",
      source: "user",
      recipe: {
        ...recipe,
        workflow_card: {
          ...recipe.workflow_card,
          entry_conditions: [
            ...recipe.workflow_card.entry_conditions,
            "Local evidence was /Users/Zhuanz/Music/private-session.rpp.",
            "Request id cmd_20260707123456000_abc must not be shared.",
            "Fixed target track:guid:7b2a91dd0f0e4f69afbb88d4400f7c44 should not ship.",
            "Artifact alias last_result:artifact:3 is session local.",
          ],
        },
      },
    };

    const scan = scanAlpha3D2PortablePayload(bad);
    const plan = planAlpha3D2WorkflowPortability(bad);

    assert.equal(scan.ok, false);
    assert.equal(plan.ok, false);
    assert.equal(plan.status, "blocked");
    assert.equal(plan.packet, null);
    assert.equal(plan.readiness.share.ready, false);
    assert.deepEqual(
      plan.portability.blockers.map((blocker) => blocker.code).sort(),
      [
        "PROJECT_REF_PRESENT",
        "PUBLIC_ARTIFACT_ALIAS_PRESENT",
        "REQUEST_ID_PRESENT",
        "UNSAFE_LOCAL_PATH",
      ].sort(),
    );
    assert.match(plan.next_step, /Resolve portability blockers/);
  });

  it("allows portable placeholder refs without hiding adjacent local leakage", () => {
    const portable = scanAlpha3D2PortablePayload({
      refs: {
        track_ref: "track:guid:{TRACK-GUID}",
      },
    });
    const leaked = scanAlpha3D2PortablePayload({
      note: "Use track:guid:{TRACK-GUID} from /Users/Zhuanz/private/project.rpp",
    });

    assert.equal(portable.ok, true);
    assert.equal(leaked.ok, false);
    assert.equal(
      leaked.blockers.some((blocker) => blocker.code === "UNSAFE_LOCAL_PATH"),
      true,
    );
  });

  it("validates installed packet shape before any install write is allowed", () => {
    const recipe = loadRecipe();
    const packet = createAlpha3D2WorkflowPacket({
      recipe,
      source: "official",
    });
    const broken = {
      ...packet,
      dependencies: {
        ...packet.dependencies,
        template_ids: [],
      },
    };

    const installPlan = planAlpha3D2WorkflowPortability({
      operation: "install",
      packet,
    });
    const brokenInstallPlan = planAlpha3D2WorkflowPortability({
      operation: "install",
      packet: broken,
    });

    assert.equal(installPlan.ok, true);
    assert.equal(installPlan.readiness.install.mode, "plan_only_no_install_write");
    assert.equal(installPlan.safety.install_writes_files, false);

    const validation = validateAlpha3D2WorkflowPacket(broken);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /dependencies\.template_ids/);
    assert.equal(brokenInstallPlan.ok, false);
    assert.equal(brokenInstallPlan.packet, null);
    assert.equal(
      brokenInstallPlan.portability.blockers.some((blocker) => blocker.code === "WORKFLOW_PACKET_INVALID"),
      true,
    );
  });

  it("catches embedded local paths in key-value style notes", () => {
    const scan = scanAlpha3D2PortablePayload({
      note: "source_path=/Users/Zhuanz/Music/private-session.rpp",
    });

    assert.equal(scan.ok, false);
    assert.equal(
      scan.blockers.some((blocker) => blocker.code === "UNSAFE_LOCAL_PATH"),
      true,
    );
  });

  it("exposes stable D2 product vocabulary for workflow and extension-pack validators", () => {
    assert.equal(ALPHA3_D2_PORTABILITY_DISCOVERY_SUMMARY.user_word, "workflow");
    assert.equal(ALPHA3_D2_PORTABILITY_DISCOVERY_SUMMARY.developer_shape, "recipe-backed workflow packet");
    assert.deepEqual(ALPHA3_D2_PORTABILITY_DISCOVERY_SUMMARY.operations, [
      "save",
      "scrub",
      "share",
      "install",
      "fork",
    ]);
    assert.equal(ALPHA3_D2_PORTABILITY_DISCOVERY_SUMMARY.tool_surface.added_tools, 0);
    assert.match(
      ALPHA3_D2_PORTABILITY_DISCOVERY_SUMMARY.rule,
      /Agents still execute workflow steps through list_recipes, call_template, and get_state/,
    );
  });
});

function loadRecipe() {
  return JSON.parse(readFileSync(RECIPE_PATH, "utf8"));
}

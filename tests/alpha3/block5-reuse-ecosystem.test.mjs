import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT,
  ALPHA3_BLOCK5_REUSE_ECOSYSTEM_DISCOVERY_SUMMARY,
  createAlpha3Block5SoundLibraryFixtureManifest,
  createAlpha3Block5VitalFixtureManifest,
  runAlpha3Block5ReuseEcosystemGate,
  summarizeAlpha3Block5ReuseEcosystem,
} from "../../packages/mcp-server/src/alpha3-block5-reuse-ecosystem-v1.mjs";
import {
  ALPHA3_D2_EXTENSION_PACK_PROMOTION_CONTRACT,
} from "../../packages/core/src/alpha3-d2-extension-pack-entrypoints-v1.mjs";
import {
  ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT,
} from "../../packages/core/src/alpha3-d2-workflow-entrypoints-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const RECIPE_PATH = path.join(
  REPO_ROOT,
  "recipes",
  "official",
  "layer7",
  "first_atoms_a",
  "project.fast_observation_bundle.recipe.json",
);

describe("Alpha3 Block5 workflow and extension-pack reuse ecosystem", () => {
  it("summarizes the Block5 product surface without filesystem side effects", () => {
    const summary = summarizeAlpha3Block5ReuseEcosystem();

    assert.equal(summary.contract, ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT);
    assert.equal(summary.mode, "static_product_surface_summary");
    assert.equal(summary.status, "ready_for_local_entrypoint_gate");
    assert.equal(summary.workflow.entrypoints.contract, ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT);
    assert.equal(summary.extension_pack.entrypoints.promotion_gate.contract, ALPHA3_D2_EXTENSION_PACK_PROMOTION_CONTRACT);
    assert.deepEqual(summary.workflow.operations, ["save", "scrub", "share", "fork", "install"]);
    assert.deepEqual(summary.extension_pack.operations, ["save", "scrub", "share", "fork", "install"]);
    assert.deepEqual(summary.extension_pack.promotion_operations, [
      "enable",
      "disable",
      "update",
      "uninstall",
      "promote_global_alias",
    ]);
    assert.equal(summary.safety.added_tools, 0);
    assert.equal(summary.safety.public_call_recipe, false);
    assert.equal(summary.safety.hidden_executor, false);
    assert.equal(summary.safety.executable_entries_exposed, false);
    assert.equal(summary.safety.global_alias_execution, false);
  });

  it("accepts a local workflow/pack reuse gate over real D2 entrypoints", () => {
    const recipe = JSON.parse(readFileSync(RECIPE_PATH, "utf8"));
    const root = mkdtempSync(path.join(tmpdir(), "openreaper-block5-"));
    const gate = runAlpha3Block5ReuseEcosystemGate({
      root,
      recipe,
      manifest: createAlpha3Block5VitalFixtureManifest(),
      sound_library_manifest: createAlpha3Block5SoundLibraryFixtureManifest(),
    });

    assert.equal(gate.contract, ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT);
    assert.equal(gate.mode, "static_local_workflow_pack_reuse_gate");
    assert.equal(gate.ok, true);
    assert.equal(gate.hard_gate.accepted, true);
    assert.deepEqual(gate.hard_gate.failures, []);
    assert.equal(gate.workflow.ok, true);
    assert.equal(gate.workflow.contract, ALPHA3_D2_WORKFLOW_ENTRYPOINTS_CONTRACT);
    assert.equal(gate.workflow.operations.save.ok, true);
    assert.equal(gate.workflow.operations.scrub.ok, true);
    assert.equal(gate.workflow.operations.share.ok, true);
    assert.equal(gate.workflow.operations.fork.ok, true);
    assert.equal(gate.workflow.operations.install.ok, true);
    assert.equal(gate.workflow.verification.ok, true);
    assert.equal(gate.workflow.installed_workflow.id, "recipe.project.fast_observation_bundle_block5_variant");
    assert.equal(gate.workflow.safety.public_call_recipe, false);
    assert.equal(gate.workflow.safety.hidden_executor, false);
    assert.equal(gate.extension_pack.ok, true);
    assert.equal(gate.extension_pack.operations.save.ok, true);
    assert.equal(gate.extension_pack.operations.scrub.ok, true);
    assert.equal(gate.extension_pack.operations.share.ok, true);
    assert.equal(gate.extension_pack.operations.fork.ok, true);
    assert.equal(gate.extension_pack.operations.install.ok, true);
    assert.equal(gate.extension_pack.sound_library_fit.share_ok, true);
    assert.equal(gate.extension_pack.sound_library_fit.fork_ok, true);
    assert.equal(gate.extension_pack.sound_library_fit.namespace, "block5_sound_pack");
    assert.deepEqual(gate.extension_pack.sound_library_fit.capabilities, [
      "sound_library_search",
      "import_action",
    ]);
    assert.equal(gate.extension_pack.promotion.enable_without_evidence_blocked, true);
    assert.equal(gate.extension_pack.promotion.enable_with_evidence_ready, true);
    assert.equal(gate.extension_pack.promotion.disable_ready, true);
    assert.equal(gate.extension_pack.promotion.update_with_evidence_ready, true);
    assert.equal(gate.extension_pack.promotion.uninstall_plan_only_blocked, true);
    assert.equal(gate.extension_pack.promotion.global_alias_plan_only_blocked, true);
    assert.equal(gate.extension_pack.registry_after_plan_only_promotions.enabled_count, 0);
    assert.equal(gate.extension_pack.registry_after_plan_only_promotions.executable_entries_exposed, false);
    assert.equal(gate.execution.public_call_recipe, false);
    assert.equal(gate.execution.hidden_executor, false);
    assert.equal(gate.execution.raw_lua_action_shell_or_ui, false);
    assert.equal(gate.execution.live_reaper, false);
    assert.equal(gate.execution.safe_write, false);
    assert.equal(gate.execution.global_alias_execution, false);
    assert.equal(gate.customer_flow.status, "static_ready_no_live_claim");
    assert.equal(gate.trial_officer.verdict, "accept_block5_static_reuse_gate");
    assert.deepEqual(gate.trial_officer.p0_p1_findings, []);
  });

  it("exposes Block5 reuse status through the existing runtime product surface", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates();
    const productSurface = menu.product_surface;

    assert.equal(menu.mode, "menu");
    assert.equal(productSurface.detail_level, "compact");
    assert.deepEqual(
      productSurface.reuse_ecosystem,
      ALPHA3_BLOCK5_REUSE_ECOSYSTEM_DISCOVERY_SUMMARY,
    );
    assert.equal(productSurface.reuse_ecosystem.tool_surface.added_tools, 0);
    assert.equal(Object.hasOwn(productSurface, "reuse_ecosystem_snapshot"), false);

    const expandedMenu = runtime.list_templates({
      ids: ["template.transport.read_state"],
      fields: ["id"],
    });
    const expandedProductSurface = expandedMenu.product_surface;

    assert.equal(expandedMenu.mode, "ids");
    assert.deepEqual(expandedMenu.items.map((item) => item.id), ["template.transport.read_state"]);
    assert.equal(expandedProductSurface.detail_level, "expanded");
    assert.equal(expandedProductSurface.reuse_ecosystem_snapshot.contract, ALPHA3_BLOCK5_REUSE_ECOSYSTEM_CONTRACT);
    assert.equal(expandedProductSurface.reuse_ecosystem_snapshot.status, "ready_for_local_entrypoint_gate");
    assert.equal(expandedProductSurface.reuse_ecosystem_snapshot.safety.public_call_recipe, false);
    assert.equal(expandedProductSurface.reuse_ecosystem_snapshot.safety.hidden_executor, false);
  });
});

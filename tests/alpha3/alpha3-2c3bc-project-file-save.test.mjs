import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ALPHA2_HISTORICAL_EVIDENCE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
  createCallTemplateRuntime,
  validateProjectSaveAsTarget,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE,
  createAlpha3_2AAgentContextMacroGuide,
} from "../../packages/mcp-server/src/alpha3-2a-agent-context-macro-guide-v1.mjs";

const IDS = [
  "template.project.save_current_project",
  "template.project.save_project_as",
];
let requestSequence = 0;
function context() {
  requestSequence += 1;
  return {
    client_id: "alpha32-c3bc-test",
    session_id: "alpha32-c3bc-session",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-11T09:00:00.000Z",
    request_sequence: requestSequence,
  };
}

const HANDLER_SOURCE = readFileSync(new URL("../../reaper/bridge/src/handlers/project/save_project_file.lua", import.meta.url), "utf8");
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const POLICY_SOURCE = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const CATALOG_SUMMARY_SOURCE = readFileSync(new URL("../../reaper/bridge/src/handlers/core/read_template_catalog_summary.lua", import.meta.url), "utf8");
const LIVE_RUNNER_SOURCE = readFileSync(new URL("../../scripts/smoke-alpha3-2c3bc-project-file-save.mjs", import.meta.url), "utf8");
const PACKAGE_SOURCE = readFileSync(new URL("../../scripts/package-openreaper-alpha.mjs", import.meta.url), "utf8");
const REGISTRY = JSON.parse(readFileSync(new URL("../../reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json", import.meta.url), "utf8"));
const ROUTE_METADATA = JSON.parse(readFileSync(new URL("../../reaper/bridge/registry/BRIDGE_ROUTE_METADATA_V1.json", import.meta.url), "utf8"));

function registryRows() {
  return REGISTRY.entries.filter((entry) => IDS.includes(entry.template_id));
}

function recordingBridge() {
  const fake = new FakeFoundationBridge({ owner: "owner-test", generation: 1 });
  const requests = [];
  return {
    requests,
    dispatch(request) {
      requests.push(structuredClone(request));
      const result = fake.dispatch(request);
      if (result?.ok !== true) return result;
      const scripted = structuredClone(result);
      scripted.result.refs = [{ kind: "project", ref: "project:current", identity: { scheme: "current", value: "current" } }];
      return scripted;
    },
  };
}

describe("Alpha3.2-C3B+C3C project-file save implementation", () => {
  it("adds exactly two descriptors while preserving historical and C3A count truth", () => {
    const catalog = createAcceptedOfficialTemplateCatalog();
    assert.equal(catalog.size, 222);
    assert.equal(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.length, 222);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS, [
      "template.project.read_current_project_path",
      "template.project.read_dirty_state",
    ]);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS, IDS);
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA2_HISTORICAL_EVIDENCE_TEMPLATE_IDS.length, 213);
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.length, 212);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 222);

    const [saveCurrent, saveAs] = IDS.map((id) => catalog.get(id));
    for (const descriptor of [saveCurrent, saveAs]) {
      assert.equal(descriptor.pack, "project");
      assert.equal(descriptor.risk, "write");
      assert.equal(descriptor.bridge.operation_family, "run_command");
      assert.equal(descriptor.bridge.operation_name, "template.execute");
      assert.equal(descriptor.bridge.idempotency, "supported");
      assert.equal(descriptor.artifacts.mode, "none");
      assert.equal(descriptor.verification.mode, "required");
      assert.equal(descriptor.verification.checks.length, 2);
      assert.deepEqual(descriptor.refs.input, []);
      assert.equal(descriptor.refs.output[0].kind, "project");
    }
    assert.equal(saveCurrent.bridge.capability, "project.save_current_project");
    assert.deepEqual(saveCurrent.inputSchema.required, []);
    assert.equal(saveCurrent.expectedDelta.idempotent, true);
    assert.equal(saveAs.bridge.capability, "project.save_project_as");
    assert.deepEqual(saveAs.inputSchema.required, ["target_path", "overwrite"]);
    assert.deepEqual(Object.keys(saveAs.inputSchema.properties), ["target_path", "overwrite"]);
    assert.equal(saveAs.expectedDelta.idempotent, false);
  });

  it("marks saves live-smoked while keeping macro.project.file and new-project held", () => {
    const runtime = createCallTemplateRuntime({
      live: { opted_in: true, executor: new FakeFoundationBridge(), allowed_template_ids: IDS },
    });
    const rows = runtime.list_templates({ ids: IDS, fields: ["summary"] }).items;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.capability_truth.allowed_live_group, "alpha3_2c3bc_project_file_save");
      assert.equal(row.capability_truth.live_runnable_now, true);
      assert.equal(row.capability_truth.evidence_level, "live_smoked");
    }
    assert.equal(ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE.status, "reads_and_writes_accepted_live_smoked");
    assert.deepEqual(ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE.accepted_mutation_routes, IDS);
    assert.deepEqual(ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE.ids.map((row) => row.status), [
      "accepted_live_smoked",
      "accepted_live_smoked",
      "accepted_live_smoked",
      "accepted_live_smoked",
    ]);
    const guide = createAlpha3_2AAgentContextMacroGuide();
    assert.match(
      guide.project_file_posture.current_write_boundary,
      /macro\.project\.file executes.*save_current\/save_as.*new\/open\/create.*remain held/,
    );
    const projectFileManual = runtime.list_templates({ ids: ["macro.project.file"], fields: ["id"] })
      .product_surface.agent_context_macro_guide.requested_expansions.items[0].action_manual;
    assert.match(
      projectFileManual.required_readiness.join(" "),
      /accepted\/live-smoked.*Macro executes its fixed serial program internally/,
    );
    assert.match(projectFileManual.input_shape.overwrite, /atomic overwrite=false remains held/);
    const invalidPlan = runtime.call_template({ id: "macro.project.file", input: {} });
    return invalidPlan.then((result) => {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "PROJECT_FILE_OPERATION_REQUIRED");
      assert.equal(result.execution.status, "blocked");
      assert.equal(result.execution.stage_count, 0);
      assert.deepEqual(result.execution.stages, []);
    });
  });

  it("constructs both write requests with required undo/verification and no artifacts or refs", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "openreaper-c3bc-runtime-")));
    const target = path.join(root, "Saved As.RPP");
    const bridge = recordingBridge();
    const runtime = createCallTemplateRuntime({
      live: { opted_in: true, executor: bridge, allowed_template_ids: IDS },
    });
    try {
      const saveCurrent = await runtime.call_template({ id: IDS[0], input: {}, context: context() });
      const saveAs = await runtime.call_template({ id: IDS[1], input: { target_path: target, overwrite: true }, context: context() });
      assert.equal(saveCurrent.ok, true);
      assert.equal(saveAs.ok, true);
      assert.equal(bridge.requests.length, 2);
      for (const request of bridge.requests) {
        assert.equal(request.operation.family, "run_command");
        assert.equal(request.operation.name, "template.execute");
        assert.equal(request.pack.id, "project");
        assert.equal(request.pack.risk, "write");
        assert.equal(request.undo.mode, "required");
        assert.equal(request.verification.mode, "required");
        assert.equal(request.verification.checks.length, 2);
        assert.equal(request.artifacts.allow, false);
        assert.deepEqual(request.refs, []);
      }
      assert.equal(bridge.requests[0].pack.capability, "project.save_current_project");
      assert.deepEqual(bridge.requests[0].params, {});
      assert.equal(bridge.requests[1].pack.capability, "project.save_project_as");
      assert.deepEqual(bridge.requests[1].params, { target_path: target, overwrite: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects low response budgets before executor dispatch for both save templates", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "openreaper-c3bc-budget-")));
    const bridge = recordingBridge();
    const runtime = createCallTemplateRuntime({ live: { opted_in: true, executor: bridge, allowed_template_ids: IDS } });
    try {
      for (const [id, input] of [
        [IDS[0], {}],
        [IDS[1], { target_path: path.join(root, "Budget.RPP"), overwrite: true }],
      ]) {
        const result = await runtime.call_template({
          id,
          input,
          budget: { max_response_bytes: 65_535, max_items: 50, max_inline_value_bytes: 2048 },
          context: context(),
        });
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "CALL_TEMPLATE_PREFLIGHT_FAILED");
        assert.equal(result.error.details.blocker, "success_envelope_budget_minimum_required");
      }
      assert.equal(bridge.requests.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails save-as preflight closed, requires overwrite=true before dispatch, and rejects root/home parents", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "openreaper-c3bc-preflight-")));
    const existing = path.join(root, "Existing.RPP");
    const directoryTarget = path.join(root, "Directory.RPP");
    const symlinkTarget = path.join(root, "Symlink.RPP");
    const realTarget = path.join(root, "Real.RPP");
    const linkedParent = path.join(path.dirname(root), `${path.basename(root)}-link`);
    await writeFile(existing, "<REAPER_PROJECT 0.1>\n", "utf8");
    await mkdir(directoryTarget);
    await writeFile(realTarget, "<REAPER_PROJECT 0.1>\n", "utf8");
    await symlink(realTarget, symlinkTarget);
    await symlink(root, linkedParent);
    try {
      for (const input of [
        { target_path: path.join(root, "Omitted.RPP") },
        { target_path: path.join(root, "False.RPP"), overwrite: false },
      ]) {
        const bridge = recordingBridge();
        const runtime = createCallTemplateRuntime({ live: { opted_in: true, executor: bridge, allowed_template_ids: IDS } });
        const result = await runtime.call_template({ id: IDS[1], input, context: context() });
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "CALL_TEMPLATE_PREFLIGHT_FAILED");
        assert.equal(result.error.details.blocker, "overwrite_true_required_for_dispatch");
        assert.equal(bridge.requests.length, 0);
      }

      const invalid = [
        ["relative.RPP", "target_path_relative"],
        ["https://example.test/demo.RPP", "target_path_uri"],
        [path.join(root, "Bad.txt"), "target_extension_invalid"],
        [path.join(root, "bad\u0000.RPP"), "target_path_control_character"],
        [path.join(root, ".RPP"), "target_basename_invalid"],
        [path.join(root, "NUL.RPP"), "target_basename_reserved"],
        [path.join(root, "missing", "Demo.RPP"), "parent_chain_missing"],
        [directoryTarget, "target_not_regular_file"],
        [symlinkTarget, "target_symlink"],
        [path.join(linkedParent, "Demo.RPP"), "parent_chain_symlink"],
        [path.join(path.parse(root).root, "RootParent.RPP"), "parent_filesystem_root_rejected"],
        [path.join(os.homedir(), "HomeParent.RPP"), "parent_home_directory_rejected"],
        [`${root}/child/../NotNormalized.RPP`, "parent_path_not_normalized"],
      ];
      for (const [target_path, blocker] of invalid) {
        await assert.rejects(
          validateProjectSaveAsTarget({ target_path, overwrite: true }),
          (error) => error.code === "CALL_TEMPLATE_PREFLIGHT_FAILED" && error.details?.blocker === blocker,
          `${target_path} -> ${blocker}`,
        );
      }
      assert.deepEqual(await validateProjectSaveAsTarget({ target_path: existing, overwrite: true }), {
        target_path: existing,
        overwrite: true,
      });
      assert.deepEqual(await validateProjectSaveAsTarget({ target_path: path.join(root, "New.RPP"), overwrite: true }), {
        target_path: path.join(root, "New.RPP"),
        overwrite: true,
      });
    } finally {
      await rm(linkedParent, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("registers an exact two-row bridge group and bounded route-policy allowance", () => {
    assert.deepEqual(registryRows().map((entry) => entry.template_id), IDS);
    for (const row of registryRows()) {
      assert.equal(row.operation.family, "run_command");
      assert.equal(row.operation.name, "template.execute");
      assert.equal(row.pack, "project");
      assert.equal(row.risk, "write");
      assert.equal(row.route, "alpha3-2c3bc-project-file-save");
      assert.equal(row.handler_file, "project/save_project_file.lua");
      assert.equal(row.artifact_policy, "none");
    }
    const route = ROUTE_METADATA.routes.find((entry) => entry.route === "alpha3-2c3bc-project-file-save");
    assert.deepEqual(route.template_ids, IDS);
    assert.equal(route.template_count, 2);
    assert.deepEqual(route.packs, ["project"]);
    assert.deepEqual(route.risks, ["write"]);

    for (const capability of ["project.save_current_project", "project.save_project_as"]) {
      assert.match(POLICY_SOURCE, new RegExp(`\\["${capability.replaceAll(".", "\\.")}"\\] = \\{ pack = "project", risk = "write" \\}`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${capability.replaceAll(".", "\\.")}"\\] = save_`));
    }
    assert.match(POLICY_SOURCE, /operation_key ~= "run_command:template\.execute"/);
    assert.match(POLICY_SOURCE, /Alpha3\.2-C3BC project-file save requests must use undo\.mode required/);
    assert.match(POLICY_SOURCE, /or alpha3_2c3bc_project_file_save_capability\(request, operation_key\)/);
    assert.match(BRIDGE_SOURCE, /OPENREAPER_HANDLER_EXPORTS\.save_current_project/);
    assert.match(BRIDGE_SOURCE, /OPENREAPER_HANDLER_EXPORTS\.save_project_as/);
  });

  it("uses direct APIs with fail-closed unsaved and exact post-readback verification", () => {
    assert.match(HANDLER_SOURCE, /pcall\(reaper\.APIExists, name\)/);
    assert.match(HANDLER_SOURCE, /project_file_save_call_void_api\("Main_SaveProject", before\.project, false\)/);
    assert.match(HANDLER_SOURCE, /project_file_save_call_void_api\("Main_SaveProjectEx", before\.project, target, PROJECT_FILE_SAVE_AS_OPTIONS\)/);
    assert.match(HANDLER_SOURCE, /local PROJECT_FILE_SAVE_AS_OPTIONS = 8/);
    assert.match(HANDLER_SOURCE, /PROJECT_FILE_SAVE_SUCCESS_ENVELOPE_FIXED_MAX_BYTES = 16384/);
    assert.match(HANDLER_SOURCE, /success_envelope_budget_insufficient/);
    assert.match(HANDLER_SOURCE, /request\.params\.overwrite ~= true/);
    assert.match(HANDLER_SOURCE, /blocker = "unsaved_project"/);
    assert.match(HANDLER_SOURCE, /after\.path ~= before\.path/);
    assert.match(HANDLER_SOURCE, /after\.path ~= target/);
    assert.match(HANDLER_SOURCE, /after\.dirty or after\.raw_dirty_state ~= 0/);
    assert.match(HANDLER_SOURCE, /"VERIFY_FAILED"/);
    assert.match(HANDLER_SOURCE, /project_ref = "project:current"/);
    for (const forbidden of ["Main_OnCommand", "os.execute", "io.open", "ShowMessageBox", "GetUserInputs", "RecursiveCreateDirectory"]) {
      assert.doesNotMatch(HANDLER_SOURCE, new RegExp(forbidden), forbidden);
    }
    assert.match(CATALOG_SUMMARY_SOURCE, /template_count = 133/);
    assert.match(CATALOG_SUMMARY_SOURCE, /template_count = 77/);
    assert.match(CATALOG_SUMMARY_SOURCE, /project = 12/);
    assert.match(CATALOG_SUMMARY_SOURCE, /write = 56/);
  });

  it("extends package actual-stdio fake save smoke with request identity metadata", () => {
    for (const required of [
      'request.client?.id !== "openreaper-mcp"',
      "request.client?.session_id",
      "request.id",
      "request.created_at",
      'request.bridge?.expected_owner !== "openreaper-alpha-package-smoke"',
      "request.bridge?.expected_generation !== 1",
      "overwrite: true",
      "explicit overwrite=true race authorization",
    ]) assert.equal(PACKAGE_SOURCE.includes(required), true, required);
  });

  it("provides a fresh-transport combined live runner without REAPER process control", () => {
    for (const required of [
      "--evidence-root",
      "--mcp-command",
      "--expected-project-path",
      "--save-as-target",
      "--overwrite",
      "--expected-owner-marker",
      "heartbeat.active_owner",
      "heartbeat.active_generation",
      "project_parent_inventory",
      "adjacent_backups_subdirectory_inventory",
      "sibling .rpp-bak and backup-like files",
      "ds_store",
      "external_control_tower_owns_reaper_start_stop",
      "candidate_mcp_close",
      "immediateTransportState",
      "delayedTransportState",
      "external_reaper_exit_audit",
      "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
      "cleanupOwnedTransportFiles",
      "LATE_SETTLE_ATTEMPTS",
      "spawned_reaper: false",
      "rendered_files: []",
    ]) assert.equal(LIVE_RUNNER_SOURCE.includes(required), true, required);
    assert.match(LIVE_RUNNER_SOURCE, /source: await directoryInventory\(sourceDir\)/);
    assert.match(LIVE_RUNNER_SOURCE, /target: await directoryInventory\(targetDir\)/);
    assert.match(LIVE_RUNNER_SOURCE, /source: await directoryInventory\(path\.join\(sourceDir, "Backups"\)\)/);
    assert.match(LIVE_RUNNER_SOURCE, /target: await directoryInventory\(path\.join\(targetDir, "Backups"\)\)/);
    assert.match(LIVE_RUNNER_SOURCE, /if \(inventory\?\.truncated\) \{[\s\S]*?evidence would be incomplete/);
    assert.match(LIVE_RUNNER_SOURCE, /names\.slice\(0, MAX_INVENTORY_ENTRIES\)/);
    for (const forbidden of ["spawn(", "execFile(", "kill(", "open -a REAPER", "Main_OnCommand", "os.execute"]) {
      assert.equal(LIVE_RUNNER_SOURCE.includes(forbidden), false, forbidden);
    }
  });

  it("does not open new-project or macro execution routes and keeps C3A generated reads intact", () => {
    assert.equal(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.includes("template.project.create_new_project"), false);
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA3_2C3BC_PROJECT_FILE_SAVE_TEMPLATE_IDS.includes("macro.project.file"), false);
    for (const operation of ["query_state:project.read_current_project_path", "query_state:project.read_dirty_state"]) {
      assert.equal((BRIDGE_SOURCE.match(new RegExp(`\\["${operation.replaceAll(".", "\\.")}"\\]`, "g")) ?? []).length, 1);
    }
  });
});

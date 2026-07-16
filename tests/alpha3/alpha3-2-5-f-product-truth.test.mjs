import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createAlpha3_2B3DoctorTaskResult } from "../../packages/mcp-server/src/alpha3-2b3-runtime-doctor-readiness-v1.mjs";
import { executeAlpha3_2_5CRenderTargetsMacro } from "../../packages/mcp-server/src/alpha3-2e-render-targets-v1.mjs";
import {
  assertPackagedRuntimeStateClean,
  createOpenReaperAlphaPackageCatalogFacts,
  scrubPackagedRuntimeState,
} from "../../scripts/package-openreaper-alpha.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

describe("Alpha3.2.5-F product truth", () => {
  it("recursively removes packaged runtime state and rejects reinjected leakage before zip", async () => {
    const fixture = await mkdtemp(path.join(await realpath(os.tmpdir()), "openreaper-alpha33-package-clean-"));
    try {
      const packageRoot = path.join(fixture, "OpenReaper-alpha");
      const stateRoot = path.join(packageRoot, "session", "project-index-state");
      const companionSession = path.join(packageRoot, "vendor", "vital-agent-mcp", "dist-package", "vital-agent-mcp-0.1.0", "session");
      const normalRuntime = path.join(packageRoot, "node_modules", "ajv", "dist", "runtime");
      await mkdir(stateRoot, { recursive: true });
      await mkdir(companionSession, { recursive: true });
      await mkdir(path.join(packageRoot, "vendor", "openreaper-kernel", "runtime-state"), { recursive: true });
      await mkdir(path.join(packageRoot, "backups"), { recursive: true });
      await mkdir(path.join(packageRoot, ".openreaper-install-backup-fixture", "previous-install", "session"), { recursive: true });
      await mkdir(normalRuntime, { recursive: true });
      await writeFile(path.join(stateRoot, "openreaper-project-index.sqlite"), "smoke-db", "utf8");
      await writeFile(path.join(packageRoot, "session", "Package Smoke.RPP"), "<REAPER_PROJECT 0.1>\n", "utf8");
      await writeFile(path.join(companionSession, "companion.sqlite3-wal"), "smoke-db", "utf8");
      await writeFile(path.join(packageRoot, "vendor", "openreaper-kernel", "runtime-state", "owner.meta"), "runtime", "utf8");
      await writeFile(path.join(packageRoot, "backups", "Package Smoke.RPP-bak"), "backup", "utf8");
      await writeFile(path.join(normalRuntime, "parseJson.js"), "product-runtime", "utf8");
      await writeFile(path.join(packageRoot, "README.txt"), "product", "utf8");

      const scrubbed = await scrubPackagedRuntimeState(packageRoot);
      assert.equal(scrubbed.ok, true);
      assert.equal(scrubbed.session_state_removed, true);
      assert.ok(scrubbed.removed_runtime_directory_count >= 5);
      for (const removed of [
        "session",
        path.join("vendor", "vital-agent-mcp", "dist-package"),
        path.join("vendor", "openreaper-kernel", "runtime-state"),
        "backups",
        ".openreaper-install-backup-fixture",
      ]) assert.ok(scrubbed.removed_runtime_directories.includes(removed), removed);
      await assert.rejects(stat(stateRoot), { code: "ENOENT" });
      await assert.rejects(stat(path.join(packageRoot, "vendor", "vital-agent-mcp", "dist-package")), { code: "ENOENT" });
      assert.equal(await readFile(path.join(packageRoot, "README.txt"), "utf8"), "product");
      assert.equal(await readFile(path.join(normalRuntime, "parseJson.js"), "utf8"), "product-runtime");

      for (const leakedName of [
        "leaked.sqlite-journal",
        "leaked.sqlite3-shm",
        "leaked.db-wal",
        "leaked.RPP",
        "leaked.bak",
        "leaked.backup",
        "reaper.pid",
        "owner.meta",
        "managed-render-root.path",
        "openreaper-bridge-liveness-v1.json",
      ]) await writeFile(path.join(packageRoot, leakedName), "leak", "utf8");
      await mkdir(path.join(packageRoot, "runtime-state"), { recursive: true });
      await assert.rejects(assertPackagedRuntimeStateClean(packageRoot), (error) => {
        assert.match(error.message, /Package contains runtime state:/u);
        for (const leakedName of [
          "leaked.sqlite-journal",
          "leaked.sqlite3-shm",
          "leaked.db-wal",
          "leaked.RPP",
          "leaked.bak",
          "leaked.backup",
          "reaper.pid",
          "owner.meta",
          "managed-render-root.path",
          "openreaper-bridge-liveness-v1.json",
          "runtime-state",
        ]) assert.match(error.message, new RegExp(leakedName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
        return true;
      });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("reports frozen Alpha3.3 catalog facts from unique bridge handler modules", async () => {
    const handlerRegistry = JSON.parse(await readFile(
      path.join(root, "reaper", "bridge", "registry", "BRIDGE_HANDLER_REGISTRY_V1.json"),
      "utf8",
    ));
    const facts = createOpenReaperAlphaPackageCatalogFacts(handlerRegistry);
    assert.deepEqual(facts, {
      accepted_macro_count: 15,
      accepted_template_count: 231,
      bridge_handler_count: 91,
    });
    assert.equal(handlerRegistry.entries.length, 231);
    assert.equal(new Set(handlerRegistry.entries.map((entry) => entry.handler_file)).size, 91);
  });

  it("scrubs inherited session identity and keeps only explicit start overrides", async () => {
    const source = await readFile(path.join(root, "scripts/openreaper-alpha-package/openreaper-start.sh"), "utf8");
    for (const key of [
      "OPENREAPER_SESSION_ROOT",
      "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
      "OPENREAPER_ARTIFACT_ROOT",
      "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
      "OPENREAPER_LIVE_BRIDGE_OWNER",
      "OPENREAPER_LIVE_BRIDGE_GENERATION",
      "OPENREAPER_LIVE_BRIDGE_SESSION_ID",
      "OPENREAPER_PROJECT_INDEX_STATE_ROOT",
      "OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY",
    ]) assert.match(source, new RegExp(`unset \\"?\\$\\{stale_openreaper_env\\}|${key}`));
    assert.equal(source.includes('REAPER_BIN="${REAPER_BINARY:-'), false);
    assert.equal(source.includes('REAPER_APP="${REAPER_APP:-}"'), false);
    assert.match(source, /LAUNCHSERVICES_ENV_KEYS=\([\s\S]*OPENREAPER_LIVE_BRIDGE_SESSION_ID/);
    assert.match(source, /LAUNCHSERVICES_ENV_KEYS=\([\s\S]*OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY/);
    assert.match(source, /failed to clear stale LaunchServices env/);
  });

  it("runs installed startup with fresh explicit identity despite a polluted parent environment", async () => {
    const fixture = await mkdtemp(path.join(await realpath(os.tmpdir()), "openreaper-alpha325-f-start-"));
    try {
      const packageRoot = path.join(fixture, "OpenReaper-alpha");
      const startPath = path.join(packageRoot, "bin", "openreaper-start");
      const bridgePath = path.join(packageRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua");
      const fakeReaper = path.join(fixture, "fake-reaper");
      const capturePath = path.join(fixture, "captured.env");
      const freshSession = path.join(fixture, "fresh-session");
      const freshRender = path.join(fixture, "fresh-renders");
      await mkdir(path.dirname(startPath), { recursive: true });
      await mkdir(path.dirname(bridgePath), { recursive: true });
      await copyFile(path.join(root, "scripts", "openreaper-alpha-package", "openreaper-start.sh"), startPath);
      await chmod(startPath, 0o755);
      await writeFile(bridgePath, "-- fixture\n", "utf8");
      await writeFile(fakeReaper, `#!/bin/zsh
for key in OPENREAPER_SESSION_ROOT OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH OPENREAPER_ARTIFACT_ROOT OPENREAPER_LIVE_SMOKE_RENDER_ROOT OPENREAPER_LIVE_BRIDGE_OWNER OPENREAPER_LIVE_BRIDGE_GENERATION OPENREAPER_LIVE_BRIDGE_SESSION_ID OPENREAPER_PROJECT_INDEX_STATE_ROOT OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY OPENREAPER_CURRENT_PROJECT_PATH; do
  if (( \${+parameters[\$key]} )); then print -r -- "\$key=\${(P)key}"; else print -r -- "\$key=<unset>"; fi
done > ${shellQuote(capturePath)}
sleep 0.1
`, "utf8");
      await chmod(fakeReaper, 0o755);
      const pollutedKeys = [
        "OPENREAPER_SESSION_ROOT",
        "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
        "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
        "OPENREAPER_ARTIFACT_ROOT",
        "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
        "OPENREAPER_LIVE_BRIDGE_OWNER",
        "OPENREAPER_LIVE_BRIDGE_GENERATION",
        "OPENREAPER_LIVE_BRIDGE_SESSION_ID",
        "OPENREAPER_PROJECT_INDEX_STATE_ROOT",
        "OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY",
        "OPENREAPER_CURRENT_PROJECT_PATH",
      ];
      const polluted = Object.fromEntries(pollutedKeys.map((key) => [key, `/stale/${key}`]));
      await execFileAsync(startPath, [
        "--reaper-binary", fakeReaper,
        "--session-root", freshSession,
        "--render-root", freshRender,
        "--bridge-owner", "fresh-owner",
        "--bridge-generation", "9",
        "--no-startup-dialog-assist",
      ], {
        cwd: fixture,
        env: { ...process.env, ...polluted, OPENREAPER_START_WAIT_SECONDS: "0" },
        timeout: 20_000,
        maxBuffer: 1_048_576,
      });
      const captured = Object.fromEntries((await readEventually(capturePath, pollutedKeys.length)).trim().split("\n").map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }));
      assert.equal(captured.OPENREAPER_SESSION_ROOT, "<unset>");
      assert.equal(captured.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR, path.join(freshSession, "transport"));
      assert.equal(captured.OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH, bridgePath);
      assert.equal(captured.OPENREAPER_ARTIFACT_ROOT, path.join(freshSession, "artifacts"));
      assert.equal(captured.OPENREAPER_LIVE_SMOKE_RENDER_ROOT, freshRender);
      assert.equal(captured.OPENREAPER_LIVE_BRIDGE_OWNER, "fresh-owner");
      assert.equal(captured.OPENREAPER_LIVE_BRIDGE_GENERATION, "9");
      assert.equal(captured.OPENREAPER_LIVE_BRIDGE_SESSION_ID, "<unset>");
      assert.equal(captured.OPENREAPER_PROJECT_INDEX_STATE_ROOT, await realpath(path.join(freshSession, "project-index")));
      assert.equal(captured.OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY, "<unset>");
      assert.equal(captured.OPENREAPER_CURRENT_PROJECT_PATH, "<unset>");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("projects a single uncertainty-aware recovery card", () => {
    const absent = createAlpha3_2B3DoctorTaskResult({
      mode: "live-edit",
      runtimeReadiness: { bridge: { status: "bridge_action_not_running", diagnosis: "bridge_action_not_running", ready: false } },
      reaperProcess: { status: "pid_missing", running: false },
    });
    const actionMissing = createAlpha3_2B3DoctorTaskResult({
      mode: "live-edit",
      runtimeReadiness: { bridge: { status: "bridge_action_not_running", diagnosis: "bridge_action_not_running", ready: false } },
      reaperProcess: { status: "running", running: true },
    });
    assert.equal(absent.recovery_card.diagnosis, "reaper_not_running");
    assert.equal(actionMissing.recovery_card.diagnosis, "bridge_action_not_running");

    const task = createAlpha3_2B3DoctorTaskResult({
      mode: "live-edit",
      runtimeReadiness: {
        bridge: {
          status: "bridge_loop_unresponsive",
          diagnosis: "bridge_loop_unresponsive",
          ready: false,
          expected: { owner: "expected", generation: 1 },
          observed: { owner: "other", generation: 2 },
        },
      },
      requestResponse: { status: "not_run", ready: false },
      reaperProcess: { status: "running", running: true },
    });
    assert.match(task.recovery_card.likely_cause, /cannot distinguish/i);
    assert.equal(task.recovery_card.action_auto_run, false);
    assert.equal(typeof task.recovery_card.recovery, "string");

    const mismatch = createAlpha3_2B3DoctorTaskResult({
      mode: "live-edit",
      runtimeReadiness: {
        bridge: {
          status: "bridge_owner_mismatch",
          diagnosis: "owner_generation_mismatch",
          ready: false,
          expected: { owner: "expected", generation: 1 },
          observed: { owner: "observed", generation: 2 },
        },
      },
      reaperProcess: { status: "running", running: true },
    });
    assert.deepEqual(mismatch.recovery_card.expected_identity, { owner: "expected", generation: 1 });
    assert.deepEqual(mismatch.recovery_card.observed_identity, { owner: "observed", generation: 2 });
    assert.match(mismatch.recovery_card.recovery, /Reconnect the MCP client/i);
  });

  it("requires an installed managed root and returns exact dirty and output categories", async () => {
    const blocked = await executeAlpha3_2_5CRenderTargetsMacro({
      request: { input: { target_kind: "whole_project", format: "wav", dry_run: true } },
    });
    assert.equal(blocked.error.code, "RENDER_MANAGED_ROOT_UNAVAILABLE");

    let dirtyReads = 0;
    const response = await executeAlpha3_2_5CRenderTargetsMacro({
      request: { input: { target_kind: "whole_project", format: "wav", dry_run: false } },
      managedRenderRoot: "/managed/renders",
      executeAtomic: async ({ id }) => {
        if (id === "template.project.read_dirty_state") {
          dirtyReads += 1;
          return { ok: true, result: { readback: { dirty: dirtyReads === 1 } } };
        }
        return {
          ok: true,
          verification: { status: "passed" },
          result: {
            data: {
              job_ref: "job:render:1",
              output_artifact_ref: "artifact:render:manifest",
              evidence_artifact_ref: "artifact:render:evidence",
              file_count: 1,
              outputs: [{ absolute_path: "/managed/renders/final.wav", size: 4096, extension: "wav", requested_format: "wav", actual_format: "wav", target_identity: "whole_project", generated_project_copy_retained: true, generated_project_copy_path: "/managed/renders/final.wav.RPP" }],
            },
            refs: [{ ref: "artifact:render:manifest" }, { ref: "artifact:render:evidence" }, { ref: "job:render:1" }],
            artifacts: [{ ref: "artifact:render:manifest" }, { ref: "artifact:render:evidence" }],
            jobs: [{ ref: "job:render:1" }],
          },
        };
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(dirtyReads, 2);
    assert.equal(response.result.data.managed_render_root, "/managed/renders");
    assert.equal(response.result.data.dirty_before, true);
    assert.equal(response.result.data.dirty_after, false);
    assert.equal(response.result.data.save_recommendation, "no_save_needed_after_render");
    assert.equal(response.result.data.audio_outputs[0].absolute_path, "/managed/renders/final.wav");
    assert.equal(response.result.data.retained_project_copies[0].absolute_path, "/managed/renders/final.wav.RPP");
    assert.equal(response.result.data.retained_project_copies[0].audio_output_path, "/managed/renders/final.wav");
    assert.deepEqual(response.execution.stages.map((stage) => stage.id), [
      "render-selector-resolve",
      "render-live-ref-resolve",
      "render-dirty-before",
      "render-template-execute",
      "render-dirty-after",
      "render-result-project",
    ]);
  });

  it("writes and validates read-only package provenance before packaging", async () => {
    const source = await readFile(path.join(root, "scripts/package-openreaper-alpha.mjs"), "utf8");
    assert.match(source, /writePackageProvenanceManifest/);
    assert.match(source, /validatePackageProvenanceManifest/);
    assert.match(source, /smokePackagedProvenanceManifest/);
    assert.match(source, /openreaper_git_commit/);
    assert.equal(source.match(/openreaper_git_commit:/gu)?.length, 2);
    assert.match(source, /accepted_template_count/);
    assert.match(source, /bridge_handler_count/);
    const productVersion = source.match(/OPENREAPER_PRODUCT_VERSION = "([^"]+)"/u)?.[1];
    assert.equal(productVersion, "3.3.0-alpha.0");
    assert.match(productVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    assert.match(source, /ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS/);
    assert.match(source, /ALPHA3_3_B1_DEPRECATED_ALIASES/);
    assert.match(source, /createOpenReaperAlphaPackageCatalogFacts/);
    assert.match(source, /exposes the flat fifteen-Macro Alpha3\.3 menu/);
    assert.equal(source.includes("ALPHA3_2_5_0_MACRO_INVENTORY_COUNTS"), false);
    assert.match(source, /0o444/);
    assert.match(source, /source_tree_clean/);
    assert.match(source, /status", "--porcelain=v1"/);
    assert.match(source, /BRIDGE_HANDLER_REGISTRY_V1\.json/);
    assert.match(source, /fixed_registered_programs/);
    assert.match(source, /model_supplied_execution_graph/);
    assert.match(source, /live_write_refs_reresolved/);
    assert.match(source, /candidateProjectUnderstanding/);
    assert.match(source, /projectAlpha3_2_5BProjectQueryDoctorTask/);
    assert.match(source, /"assess_openreaper_capabilities"/);
    assert.match(source, /capability_report: capabilityReport/);
    assert.match(source, /host_parameter_freshness_status: "fresh"/);
    assert.match(source, /MCP tool returned an error/);
    assert.match(source, /bridge_owner: "openreaper-alpha-package-smoke"/);
    assert.match(source, /bridge_generation: 1/);
    assert.match(source, /stale_identity_scrubbed_for_child/);
    assert.match(source, /registered executable Macros and verified Templates/);
    assert.equal(source.includes("Alpha3 macro planning"), false);
    assert.equal(source.includes("macro_execution_convenience_snapshot.safety.server_executes_children"), false);
  });
});

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function readEventually(filePath, minimumLineCount = 1) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const value = await readFile(filePath, "utf8");
      if (value.trimEnd().split("\n").length >= minimumLineCount) return value;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for startup capture: ${filePath}`);
}

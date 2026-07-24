import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAlpha3_3B1ExactMacroExpansion } from "../../../../packages/mcp-server/src/alpha3-3-b1-agent-context-macro-guide-v1.mjs";
import { OPENREAPER_FLAT_FIFTEEN_MACRO_IDS } from "../../../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import { ALPHA4_SHARD_C_SELECTOR_MATRIX, validateSelector } from "./selector-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");
const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures/selector");

const schemaFixture = readJson("selected-predicate-schema.fixture.json");
const failureFixture = readJson("selected-predicate-failure-fixtures.fixture.json");
const matrixFixture = readJson("macro-selector-support-matrix.fixture.json");

test("selected/predicate schema fixture freezes the approved union and blocker families without claiming runtime support", () => {
  assert.equal(schemaFixture.contract, "openreaper.alpha4.shard_c.selector_schema_fixture.v1");
  assert.equal(schemaFixture.status, "fixture_only_not_runtime_bound");
  assert.deepEqual(schemaFixture.baseline, {
    product_commit: "1ab1a46",
    control_commit: "7926e22",
    captured_at: "2026-07-24",
  });
  assert.deepEqual(
    schemaFixture.selector_request_schemas.map((entry) => entry.kind),
    ["current_selection", "explicit_refs", "predicate"],
  );
  assert.deepEqual(schemaFixture.approved_predicates.track, ["muted", "soloed", "record_armed", "name"]);
  assert.deepEqual(schemaFixture.approved_predicates.item, ["muted", "locked", "active_take_name"]);
  assert.deepEqual(
    schemaFixture.preflight_blockers.map((entry) => entry.family),
    ["empty", "type", "ambiguity", "limit", "pre_write_drift", "protection", "cascade"],
  );
  assert.equal(schemaFixture.target_scope.selection_snapshot_identity.freeze_kind, "guid_snapshot");
  assert.equal(schemaFixture.target_scope.selection_snapshot_identity.live_reresolve_before_write, true);
  assert.equal(schemaFixture.target_scope.candidate_ceiling.status, "candidate_packet_target_unproven");
  assert.equal(schemaFixture.target_scope.candidate_ceiling.max_targets, 512);
  assert.equal(schemaFixture.target_scope.candidate_ceiling.first_blocked_target_count, 513);
  assert.equal(schemaFixture.target_scope.candidate_ceiling.zero_write_required, true);
  assert.equal(schemaFixture.evidence_policy.machine_verifiable_only, true);
  assert.equal(schemaFixture.evidence_policy.shared_runtime_called, false);
  assert.equal(schemaFixture.evidence_policy.live_reaper_called, false);
});

test("failure fixtures cover empty/type/ambiguity/limit/pre-write-drift plus frozen GUID, duplicate-name, master, and folder-cascade blockers", () => {
  assert.equal(failureFixture.contract, "openreaper.alpha4.shard_c.selector_failure_fixture.v1");
  const scenarioIds = failureFixture.scenarios.map((entry) => entry.id);
  assert.deepEqual(scenarioIds, [
    "empty-current-track-selection",
    "type-mismatch-item-selection-used-for-track-target",
    "track-name-predicate-duplicate-name-ambiguity",
    "item-active-take-name-predicate-limit-513",
    "pre-write-drift-frozen-guid-missing-live",
    "master-track-protection",
    "folder-cascade-scope-required",
  ]);
  const knownBlockers = new Set(schemaFixture.preflight_blockers.map((entry) => entry.code));
  for (const scenario of failureFixture.scenarios) {
    assert.equal(scenario.expected.zero_write, true, scenario.id);
    assert.equal(knownBlockers.has(scenario.expected.code), true, scenario.id);
    assert.deepEqual(validateSelector(scenario.selector_request), { valid: true, errors: [] }, scenario.id);
  }

  const duplicateNames = byId("track-name-predicate-duplicate-name-ambiguity").candidate_rows.map((row) => row.name);
  assert.equal(new Set(duplicateNames).size, 1);
  assert.equal(duplicateNames[0], "Lead Vox");

  const limitScenario = byId("item-active-take-name-predicate-limit-513");
  assert.equal(limitScenario.synthetic_snapshot.row_count, 513);
  assert.equal(limitScenario.expected.blocked_target_count, 513);

  const driftScenario = byId("pre-write-drift-frozen-guid-missing-live");
  assert.equal(driftScenario.frozen_guid_snapshot.rows.length, 2);
  assert.deepEqual(driftScenario.live_reresolve_result.missing_refs, ["item:guid:{ITEM-DRIFTED}"]);
  assert.notEqual(
    driftScenario.frozen_guid_snapshot.bridge_generation,
    driftScenario.live_reresolve_result.bridge_generation,
  );

  const masterScenario = byId("master-track-protection");
  assert.equal(masterScenario.frozen_guid_snapshot.rows[0].is_master, true);

  const cascadeScenario = byId("folder-cascade-scope-required");
  const [folderRow, kickRow, snareRow] = cascadeScenario.frozen_guid_snapshot.rows;
  assert.equal(folderRow.folder_depth, 1);
  assert.equal(Array.isArray(folderRow.descendant_track_refs), true);
  assert.equal(folderRow.descendant_track_refs.length, 2);
  assert.equal(kickRow.folder_depth, 0);
  assert.equal(snareRow.folder_depth, -1);

  for (const scenario of failureFixture.scenarios.filter((entry) => entry.frozen_guid_snapshot?.rows)) {
    const refs = collectGuidRefs(scenario.frozen_guid_snapshot.rows);
    assert.equal(refs.length, new Set(refs).size, scenario.id);
  }
});

test("15-macro selector matrix matches the flat executable portfolio and keeps the status split evidence-bound", () => {
  assert.equal(matrixFixture.contract, "openreaper.alpha4.shard_c.selector_support_matrix.v1");
  assert.equal(matrixFixture.status, "current_a_baseline_evidence_only");
  assert.deepEqual(
    matrixFixture.rows.map((row) => row.macro_id),
    OPENREAPER_FLAT_FIFTEEN_MACRO_IDS,
  );
  assert.equal(matrixFixture.summary.macro_count, 15);

  const counts = countBy(matrixFixture.rows, (row) => row.status);
  assert.deepEqual(counts, matrixFixture.summary.status_counts);
  assert.deepEqual(
    matrixFixture.rows.filter((row) => row.status === "selected_supported").map((row) => row.macro_id),
    [
      "macro.project.query",
      "macro.items.analyze",
      "macro.items.apply",
      "macro.render.targets",
    ],
  );
  assert.equal(matrixFixture.rows.some((row) => row.status === "held"), false);
  const contractByMacro = new Map(ALPHA4_SHARD_C_SELECTOR_MATRIX.map((row) => [row.macro_id, row]));
  for (const row of matrixFixture.rows) {
    assert.equal(contractByMacro.get(row.macro_id)?.status, row.status, `${row.macro_id}: contract status drift`);
    assert.equal(typeof row.selector_shape, "string");
    assert.equal(typeof row.reason, "string");
    assert.equal(typeof row.owner, "string");
    assert.equal(typeof row.dependency, "string");
    assert.ok(["selected_supported", "exact_only", "not_applicable", "held"].includes(row.status), row.macro_id);
    assert.ok(["not_applicable", "typed_blocker", "preview_or_target_blocker", "returns_zero_rows", "live_selection_runtime_specific"].includes(row.empty_behavior.kind), row.macro_id);
    assert.ok(Array.isArray(row.evidence) && row.evidence.length >= 2, row.macro_id);
  }
});

test("matrix evidence needles still match the current exact manuals or source files, preventing unsupported support promotion", () => {
  for (const row of matrixFixture.rows) {
    const manualText = JSON.stringify(createAlpha3_3B1ExactMacroExpansion(row.macro_id)?.action_manual ?? {});
    assert.notEqual(manualText, "{}", row.macro_id);
    for (const evidence of row.evidence) {
      if (evidence.kind === "manual_substring") {
        assert.equal(manualText.includes(evidence.needle), true, `${row.macro_id}: ${evidence.needle}`);
        continue;
      }
      if (evidence.kind === "source_substring") {
        const source = readFileSync(path.resolve(REPO_ROOT, evidence.file), "utf8");
        assert.equal(source.includes(evidence.needle), true, `${row.macro_id}: ${evidence.needle}`);
        continue;
      }
      assert.fail(`Unknown evidence kind for ${row.macro_id}: ${evidence.kind}`);
    }
  }
});

function readJson(filename) {
  return JSON.parse(readFileSync(path.resolve(FIXTURE_ROOT, filename), "utf8"));
}

function byId(id) {
  return failureFixture.scenarios.find((entry) => entry.id === id);
}

function collectGuidRefs(rows) {
  return rows.flatMap((row) =>
    Object.values(row).filter(
      (value) => typeof value === "string" && /^(track|item):guid:\{[A-Z0-9_-]+\}$/u.test(value),
    ));
}

function countBy(values, pick) {
  const counts = {
    selected_supported: 0,
    exact_only: 0,
    not_applicable: 0,
    held: 0,
  };
  for (const value of values) counts[pick(value)] += 1;
  return counts;
}

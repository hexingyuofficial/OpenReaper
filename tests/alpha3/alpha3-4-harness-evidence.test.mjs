import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  EVIDENCE_EVENT_LINE_MAX_BYTES,
  EVIDENCE_PATHS,
  EVIDENCE_SUMMARY_MAX_BYTES,
  HARNESS_EVIDENCE_CONTRACT,
  HarnessEvidenceError,
  createEvidenceJournal,
  readEvidenceEvents,
  viewEvidence,
} from "../../scripts/lib/alpha3-4-harness-evidence-v1.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const REPORT_CLI = path.join(REPO, "scripts/alpha3-4-harness-report.mjs");

test("creates a fresh absolute evidence root with the fixed journal layout", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-evidence-"));
  const root = path.join(parent, "fresh");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root, provenance: { test: "fresh" } });
    assert.equal(journal.paths.summary_relative_path, EVIDENCE_PATHS.summary);
    assert.equal(journal.paths.events_relative_path, EVIDENCE_PATHS.events);
    await assert.rejects(createEvidenceJournal({ evidenceRoot: root }), (error) => error.code === "EVIDENCE_ROOT_NOT_FRESH");
    for (const relative of ["reports", "events", "artifacts/harness"]) assert.equal((await stat(path.join(root, relative))).isDirectory(), true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("creates missing evidence parent directories without weakening fresh-root exclusion", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-evidence-parent-"));
  const root = path.join(parent, "missing", "parents", "fresh");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root });
    assert.equal(journal.root, root);
    assert.equal((await stat(path.dirname(root))).isDirectory(), true);
    await assert.rejects(createEvidenceJournal({ evidenceRoot: root }), (error) => error.code === "EVIDENCE_ROOT_NOT_FRESH");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("appends successful, expected-failure, and thrown calls in stable order with atomic request/response artifacts", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-journal-"));
  const root = path.join(parent, "root");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root, provenance: { contract_test: true } });
    await journal.recordCall({ scenario: "fixture", step_id: "one", client: "primary", tool: "call_template", requested_id: "template.read", request: { id: "template.read", input: { n: 1 } }, response: { ok: true, result: { summary: { value: 1 } } }, ok: true, duration_ms: 3, response_bytes: 61, request_budget: { max_response_bytes: 2048 }, value: { ok: true, result: { summary: { value: 1 } } } });
    await journal.recordCall({ scenario: "fixture", step_id: "two", client: "primary", tool: "call_template", requested_id: "template.blocked", request: { id: "template.blocked" }, response: { ok: false, error: { code: "EXPECTED" } }, ok: false, expected_failure: true, error: { code: "EXPECTED", message: "bounded" }, duration_ms: 2, response_bytes: 42, value: { ok: false, error: { code: "EXPECTED" } } });
    await journal.recordCall({ scenario: "fixture", step_id: "three", client: "primary", tool: "call_template", requested_id: "template.thrown", request: { id: "template.thrown" }, response: { thrown: { name: "Error", message: "transport failed" } }, ok: false, error: { name: "Error", message: "transport failed" }, duration_ms: 1, response_bytes: 0 });
    const summary = await journal.finalize({ ok: false, status: "failed", duration_ms: 9, response_bytes: { total: 103, maximum_single_call: 61 }, failed_calls: [{ step_id: "three" }], expected_failures: [{ step_id: "two" }], source_hashes: { before: "a", after: "a" }, backup_recovery_posture: { source_project_unchanged: true } });
    assert.equal(summary.contract, HARNESS_EVIDENCE_CONTRACT);
    const events = await readEvidenceEvents(root);
    assert.deepEqual(events.map((event) => [event.sequence, event.id, event.status]), [[1, "event-000001", "success"], [2, "event-000002", "expected_failure"], [3, "event-000003", "failure"]]);
    assert.equal(events.every((event) => Buffer.byteLength(JSON.stringify(event) + "\n", "utf8") <= EVIDENCE_EVENT_LINE_MAX_BYTES), true);
    const requestPath = path.join(root, events[0].artifacts.request.path);
    const responsePath = path.join(root, events[0].artifacts.response.path);
    assert.deepEqual(JSON.parse(await readFile(requestPath, "utf8")), { id: "template.read", input: { n: 1 } });
    assert.deepEqual(JSON.parse(await readFile(responsePath, "utf8")), { ok: true, result: { summary: { value: 1 } } });
    assert.equal(events[0].artifacts.request.bytes, Buffer.byteLength(await readFile(requestPath), "utf8"));
    assert.equal(events[0].artifacts.request.sha256, createHash("sha256").update(await readFile(requestPath)).digest("hex"));
    assert.equal(JSON.stringify(events[0]).includes("result"), false);
    assert.equal(JSON.stringify(events[0]).includes("artifact:"), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("viewer filters, paginates, and keeps seq cursors stable", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-view-"));
  const root = path.join(parent, "root");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root });
    for (let index = 0; index < 5; index += 1) await journal.recordCall({ scenario: "fixture", step_id: index % 2 === 0 ? "even" : "odd", client: "primary", tool: "ping", request: {}, response: { ok: true, index }, ok: index !== 3, expected_failure: index === 3, error: index === 3 ? { code: "EXPECTED" } : null, value: { ok: index !== 3 }, duration_ms: index });
    await journal.finalize({ ok: false, status: "failed", duration_ms: 5 });
    const first = await viewEvidence({ evidenceRoot: root, section: "events", limit: 2 });
    assert.deepEqual(first.items.map((item) => item.sequence), [1, 2]);
    assert.equal(first.total, 5);
    assert.equal(first.has_more, true);
    assert.equal(first.next_cursor, "seq:2");
    const second = await viewEvidence({ evidenceRoot: root, section: "events", cursor: first.next_cursor, limit: 2 });
    assert.deepEqual(second.items.map((item) => item.sequence), [3, 4]);
    assert.equal(second.total, 5);
    const filtered = await viewEvidence({ evidenceRoot: root, section: "calls", status: "expected_failure", step: "odd", limit: 100 });
    assert.deepEqual(filtered.items.map((item) => item.sequence), [4]);
    const stages = await viewEvidence({ evidenceRoot: root, section: "stages", limit: 100 });
    assert.equal(stages.items.length, 2);
    assert.deepEqual(stages.items.map((item) => item.stage), ["even", "odd"]);
    const summary = await viewEvidence({ evidenceRoot: root, section: "summary" });
    assert.equal(summary.items.length, 1);
    assert.equal(summary.items[0].contract, HARNESS_EVIDENCE_CONTRACT);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("records explicit stage events and can inspect stages before final summary construction", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-stage-"));
  const root = path.join(parent, "root");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root });
    await journal.recordStage({ scenario: "fixture", stage: "bootstrap", step: "connect", ok: true, duration_ms: 4, details: { owner: "fixture" } });
    const stages = await viewEvidence({ evidenceRoot: root, section: "stages" });
    assert.equal(stages.items.length, 1);
    assert.equal(stages.items[0].stage, "bootstrap");
    assert.equal(stages.items[0].status, "success");
    await assert.rejects(viewEvidence({ evidenceRoot: root, section: "summary" }), (error) => error.code === "EVIDENCE_SUMMARY_MISSING");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("viewer verifies only artifacts selected by the current page", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-page-artifacts-"));
  const root = path.join(parent, "root");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root });
    for (let index = 1; index <= 3; index += 1) {
      await journal.recordCall({ step_id: `step-${index}`, request: { index }, response: { ok: true, index }, value: { ok: true }, ok: true });
    }
    const events = await readEvidenceEvents(root);
    await writeFile(path.join(root, events[2].artifacts.response.path), "tampered\n");
    const first = await viewEvidence({ evidenceRoot: root, limit: 1 });
    assert.deepEqual(first.items.map((event) => event.sequence), [1]);
    await assert.rejects(viewEvidence({ evidenceRoot: root, cursor: "seq:2", limit: 1 }), (error) => error.code === "EVIDENCE_ARTIFACT_HASH_MISMATCH");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("viewer rejects invalid input, missing/corrupt files, and artifact hash mismatch without writing", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-errors-"));
  const root = path.join(parent, "root");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root });
    await journal.recordCall({ step_id: "one", request: { id: "x" }, response: { ok: true }, ok: true });
    await journal.finalize({ ok: true, status: "completed" });
    const before = await readFile(path.join(root, EVIDENCE_PATHS.events));
    await assert.rejects(viewEvidence({ evidenceRoot: root, cursor: "bad" }), (error) => error.code === "EVIDENCE_CURSOR_INVALID");
    await assert.rejects(viewEvidence({ evidenceRoot: root, limit: 101 }), (error) => error.code === "EVIDENCE_LIMIT_INVALID");
    const event = (await readEvidenceEvents(root))[0];
    await writeFile(path.join(root, event.artifacts.response.path), "tampered\n");
    await assert.rejects(viewEvidence({ evidenceRoot: root }), (error) => error.code === "EVIDENCE_ARTIFACT_HASH_MISMATCH");
    assert.deepEqual(await readFile(path.join(root, EVIDENCE_PATHS.events)), before);
    await rm(path.join(root, event.artifacts.response.path));
    await assert.rejects(viewEvidence({ evidenceRoot: root }), (error) => error.code === "EVIDENCE_ARTIFACT_MISSING");
    await writeFile(path.join(root, EVIDENCE_PATHS.events), "not-json\n");
    await assert.rejects(viewEvidence({ evidenceRoot: root }), (error) => error.code === "EVIDENCE_EVENTS_CORRUPT");
    assert.equal((await stat(root)).isDirectory(), true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("viewer CLI emits exactly one compact JSON object and typed nonzero errors", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-cli-"));
  const root = path.join(parent, "root");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root });
    await journal.finalize({ ok: true, status: "completed" });
    const success = spawnSync(process.execPath, [REPORT_CLI, "--evidence-root", root, "--section", "summary"], { cwd: REPO, encoding: "utf8" });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stdout.trim().split(/\r?\n/u).length, 1);
    assert.equal(JSON.parse(success.stdout).ok, true);
    const failure = spawnSync(process.execPath, [REPORT_CLI, "--evidence-root", root, "--cursor", "nope"], { cwd: REPO, encoding: "utf8" });
    assert.notEqual(failure.status, 0);
    assert.equal(failure.stdout.trim().split(/\r?\n/u).length, 1);
    assert.equal(JSON.parse(failure.stdout).error.code, "EVIDENCE_CURSOR_INVALID");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("bounded summary remains within the fixed summary budget", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-summary-"));
  const root = path.join(parent, "root");
  try {
    const journal = await createEvidenceJournal({ evidenceRoot: root });
    await journal.recordCall({ step_id: "bounded", request: { input: "x".repeat(20_000) }, response: { ok: true, value: "y".repeat(20_000) }, ok: true });
    const summary = await journal.finalize({ ok: true, status: "completed", duration_ms: 1, project_changes: Array.from({ length: 500 }, (_, index) => ({ index, text: "change".repeat(100) })) });
    assert.ok(Buffer.byteLength(JSON.stringify(summary), "utf8") <= EVIDENCE_SUMMARY_MAX_BYTES);
    assert.equal(summary.project_changes.truncated, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

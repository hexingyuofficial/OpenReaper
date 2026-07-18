import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildEightRowChanges,
  runAlpha34D1ItemsBatchHarness,
  validateBatchResponse,
} from "../../scripts/smoke-alpha3-4-d1-items-batch.mjs";
import { executeAlpha3_3B1cItemsApplyMacro } from "../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";

function itemRef(n) {
  return `item:guid:{ITEM-H${String(n).padStart(2, "0")}}`;
}
function takeRef(n) {
  return `take:guid:{TAKE-H${String(n).padStart(2, "0")}}`;
}

function summaryFor(item, take, overrides = {}) {
  return {
    item_ref: item,
    active_take_ref: take,
    volume_db: 0,
    length_seconds: 4,
    fade_in_seconds: 0.1,
    fade_out_seconds: 0.1,
    snap_offset_seconds: 0,
    take_volume_db: 0,
    take_pan: 0,
    take_pitch_semitones: 0,
    playrate: 1,
    preserve_pitch: true,
    take_count: 1,
    ...overrides,
  };
}

function execution(id, readback, ok = true) {
  return {
    ok,
    request: { id },
    verification: { status: ok ? "passed" : "failed" },
    result: {
      readback,
      summary: readback,
      refs: Object.entries(readback)
        .filter(([key, value]) => key.endsWith("_ref") && typeof value === "string")
        .map(([key, ref]) => ({
          kind: key.slice(0, -4),
          ref,
          identity: { scheme: "guid", value: ref.slice(`${key.slice(0, -4)}:guid:`.length) },
        })),
    },
  };
}

function makeLiveLikeTransport({ discoverExisting = true } = {}) {
  const state = new Map();
  for (let i = 1; i <= 8; i += 1) state.set(itemRef(i), summaryFor(itemRef(i), takeRef(i)));
  const index = {
    calls: 0,
    invalidateScopes({ scopes }) {
      this.calls += 1;
      return { ok: true, scopes };
    },
  };
  const dispatchLog = [];
  let createdItemCount = 0;
  const callTemplate = async (request) => {
    if (request.id === "template.items.list_selected_items") {
      return {
        ok: true,
        result: {
          refs: Array.from({ length: discoverExisting ? 8 : 0 }, (_, i) => ({
            kind: "item",
            ref: itemRef(i + 1),
            identity: { scheme: "guid", value: `{ITEM-H${String(i + 1).padStart(2, "0")}}` },
          })),
          summary: { selected_count: 8 },
        },
      };
    }
    if (request.id === "template.tracks.create_track") {
      const trackNumber = createdItemCount + 1;
      return {
        ok: true,
        result: {
          refs: [{
            kind: "track",
            ref: `track:guid:{TRACK-H${String(trackNumber).padStart(2, "0")}}`,
            identity: { scheme: "guid", value: `{TRACK-H${String(trackNumber).padStart(2, "0")}}` },
          }],
        },
      };
    }
    if (request.id === "template.midi.create_midi_item") {
      createdItemCount += 1;
      return {
        ok: true,
        result: {
          refs: [{
            kind: "item",
            ref: itemRef(createdItemCount),
            identity: { scheme: "guid", value: `{ITEM-H${String(createdItemCount).padStart(2, "0")}}` },
          }],
        },
      };
    }
    if (request.id === "template.items.read_item_summary") {
      const item = request.refs?.item_ref?.ref ?? request.refs?.item_ref;
      return execution(request.id, { ...state.get(item) });
    }
    if (request.id === "macro.items.apply") {
      // Must not rewrite the harness request; execute the production path as-is.
      return executeAlpha3_3B1cItemsApplyMacro({
        request,
        projectIndexRuntime: index,
        executeAtomic: async (child) => {
          dispatchLog.push(child.id);
          if (child.id === "template.items.resolve_item_ref") {
            return execution(child.id, { item_ref: child.input.ref });
          }
          if (child.id === "template.items.read_item_summary") {
            const item = child.refs?.item_ref?.ref ?? child.refs?.item_ref;
            return execution(child.id, { ...state.get(item) });
          }
          const item = child.refs?.item_ref?.ref ?? child.refs?.item_ref;
          const live = state.get(item);
          if (child.id === "template.items.set_item_volume") live.volume_db = child.input.volume_db;
          if (child.id === "template.items.trim_item") live.length_seconds = child.input.length_seconds;
          if (child.id === "template.items.set_item_fades") {
            live.fade_in_seconds = child.input.fade_in_seconds;
            live.fade_out_seconds = child.input.fade_out_seconds;
          }
          if (child.id === "template.items.set_take_pan") live.take_pan = child.input.pan;
          if (child.id === "template.items.set_take_playrate") {
            live.playrate = child.input.playrate;
            live.preserve_pitch = child.input.preserve_pitch;
          }
          return execution(child.id, { item_ref: item, ...child.input, readback_status: "passed" });
        },
      });
    }
    if (request.id === "macro.project.file") {
      return { ok: true, execution: { status: "completed" }, result: { summary: "saved" } };
    }
    throw new Error(`unexpected request ${request.id}`);
  };
  return { callTemplate, index, dispatchLog, state };
}

describe("Alpha3.4-D1 items batch live harness (fake transport)", () => {
  it("uses the same eight-row live request path without rewriting production requests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d1-harness-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport({ discoverExisting: false });
    const observedRequests = [];
    let seenBatchRequests = 0;
    try {
      const report = await runAlpha34D1ItemsBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        executeLive: false,
        fakeTransportOnly: true,
        warmLatencyCeilingMs: 60_000,
        callTemplate: async (request) => {
          observedRequests.push(structuredClone(request));
          if (request.id === "macro.items.apply") {
            seenBatchRequests += 1;
            assert.equal(request.input.mode, "set_item_take_controls");
            assert.equal(request.input.dry_run, false);
            assert.equal(request.input.changes.length, 8);
            assert.equal(request.budget.max_response_bytes, 2048);
            assert.equal(request.input.changes.every((row) => row.id.length === 12), true);
            assert.equal(request.input.changes.every((row) => row.item_ref.startsWith("item:guid:")), true);
            assert.equal(request.input.changes.every((row) => row.take_ref.startsWith("take:guid:")), true);
          }
          if ([
            "template.items.list_selected_items",
            "template.tracks.create_track",
            "template.midi.create_midi_item",
            "template.items.read_item_summary",
          ].includes(request.id)) {
            assert.deepEqual(request.budget, {
              max_response_bytes: 12_000,
              max_items: 8,
              max_inline_value_bytes: 1_024,
            });
          }
          return transport.callTemplate(request);
        },
      });
      assert.equal(report.ok, true, JSON.stringify(report.error ?? report));
      assert.equal(report.runtime.source, "installed_wrapper");
      assert.equal(report.fixture_budget.max_inline_value_bytes, 1_024);
      assert.equal(seenBatchRequests, 2);
      assert.equal(report.fixture_items.length, 8);
      assert.equal(report.cold.calls.mutation, 40);
      assert.equal(report.cold.calls.readback, 8);
      assert.equal(report.cold.calls.index, 1);
      assert.equal(report.cold.validation.ok, true);
      assert.equal(report.warm.calls.index, 1);
      assert.equal(report.warm.invalidate_scopes_count, report.warm.calls.index);
      assert.equal(transport.index.calls, 2);
      assert.equal(report.cold.program_id, "openreaper.macro.items.apply");
      assert.equal(report.cold.response_bytes <= 2048, true);
      assert.equal(report.warm.response_bytes <= 2048, true);
      assert.equal(report.source_media_deleted, false);
      assert.deepEqual(report.rendered_outputs, []);
      const createMidiCalls = observedRequests.filter((request) => request.id === "template.midi.create_midi_item");
      assert.equal(createMidiCalls.every((request) => Number.isFinite(request.input.end_seconds)), true);
      assert.equal(createMidiCalls.every((request) => !Object.hasOwn(request.input, "length_seconds")), true);
      assert.equal(typeof report.project_before_hash, "string");
      assert.equal(typeof report.project_after_hash, "string");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports connectFactory-only live path without requiring callTemplate", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d1-connect-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport();
    let connectCalls = 0;
    let closed = false;
    try {
      const report = await runAlpha34D1ItemsBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        executeLive: true,
        warmLatencyCeilingMs: 60_000,
        liveEnvironment: {
          transportDir: path.join(root, "transport"),
          artifactRoot: path.join(root, "artifacts"),
          renderRoot: path.join(root, "render"),
          indexRoot: path.join(root, "index"),
          bridgeOwner: "d1-owner",
          bridgeGeneration: 1,
          projectPath: project,
        },
        connectFactory: async () => {
          connectCalls += 1;
          return {
            async callTool({ name, arguments: args }) {
              assert.equal(name, "call_template");
              const response = await transport.callTemplate({
                id: args.id,
                input: args.input,
                refs: args.refs,
                budget: args.budget,
                context: {
                  request_id: "d1-items-batch-connect-factory-request",
                  session_id: "d1-items-batch",
                  request_sequence: 1,
                },
              });
              return { content: [{ type: "text", text: JSON.stringify(response) }] };
            },
            async close() {
              closed = true;
            },
          };
        },
      });
      assert.equal(report.ok, true, JSON.stringify(report.error ?? report));
      assert.equal(connectCalls, 1);
      assert.equal(closed, true);
      assert.equal(report.client_close.ok, true);
      assert.deepEqual(report.live_environment, {
        transport_dir: path.join(root, "transport"),
        artifact_root: path.join(root, "artifacts"),
        render_root: path.join(root, "render"),
        index_root: path.join(root, "index"),
        bridge_owner: "d1-owner",
        bridge_generation: 1,
        project_path: project,
      });
      assert.equal(report.save.ok, true);
      assert.equal(report.cold.calls.readback, 8);
      assert.equal(report.warm.calls.index, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the live report when the installed-wrapper client cannot close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d1-close-fail-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport();
    try {
      const report = await runAlpha34D1ItemsBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        executeLive: true,
        warmLatencyCeilingMs: 60_000,
        liveEnvironment: {
          transportDir: path.join(root, "transport"),
          artifactRoot: path.join(root, "artifacts"),
          renderRoot: path.join(root, "render"),
          indexRoot: path.join(root, "index"),
          bridgeOwner: "d1-owner",
          bridgeGeneration: 1,
          projectPath: project,
        },
        connectFactory: async () => ({
          async callTool({ arguments: args }) {
            const response = await transport.callTemplate({
              id: args.id,
              input: args.input,
              refs: args.refs,
              budget: args.budget,
            });
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
          },
          async close() {
            throw Object.assign(new Error("close failed"), { code: "TEST_CLOSE_FAILED" });
          },
        }),
      });
      assert.equal(report.ok, false);
      assert.equal(report.status, "failed");
      assert.equal(report.error?.code, "TEST_CLOSE_FAILED");
      assert.equal(report.client_close?.ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the live report when save_current does not complete", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d1-save-fail-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport();
    try {
      const report = await runAlpha34D1ItemsBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        executeLive: true,
        liveEnvironment: {
          transportDir: path.join(root, "transport"),
          artifactRoot: path.join(root, "artifacts"),
          renderRoot: path.join(root, "render"),
          indexRoot: path.join(root, "index"),
          bridgeOwner: "d1-owner",
          bridgeGeneration: 1,
          projectPath: project,
        },
        connectFactory: async () => ({
          async callTool({ arguments: args }) {
            const response = args.id === "macro.project.file"
              ? { ok: false, error: { code: "TEST_SAVE_FAILED", message: "save failed" } }
              : await transport.callTemplate({
                  id: args.id,
                  input: args.input,
                  refs: args.refs,
                  budget: args.budget,
                });
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
          },
          async close() {},
        }),
      });
      assert.equal(report.ok, false);
      assert.equal(report.error?.code, "TEST_SAVE_FAILED");
      assert.equal(report.save?.ok, false);
      assert.equal(report.client_close?.ok, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when warm latency ceiling is exceeded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d1-harness-slow-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    try {
      const fixtureItems = Array.from({ length: 8 }, (_, i) => ({
        item_ref: itemRef(i + 1),
        take_ref: takeRef(i + 1),
      }));
      const changes = buildEightRowChanges(fixtureItems);
      const report = await runAlpha34D1ItemsBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        fakeTransportOnly: true,
        warmLatencyCeilingMs: -1,
        callTemplate: async (request) => {
          if (request.id === "template.items.list_selected_items") {
            return {
              ok: true,
              result: {
                refs: fixtureItems.map((item) => ({
                  kind: "item",
                  ref: item.item_ref,
                  identity: { scheme: "guid", value: item.item_ref.slice("item:guid:".length) },
                })),
              },
            };
          }
          if (request.id === "template.items.read_item_summary") {
            const item = request.refs?.item_ref?.ref ?? request.refs?.item_ref;
            const take = fixtureItems.find((entry) => entry.item_ref === item)?.take_ref;
            return execution(request.id, summaryFor(item, take));
          }
          if (request.id === "macro.items.apply") {
            const response = {
              ok: true,
              macro: {
                id: "macro.items.apply",
                program_id: "openreaper.macro.items.apply",
                program_version: "1.4.0",
                risk: "destructive",
              },
              execution: { status: "completed", stages: [], stage_count: 0 },
              sqlite: {
                used: true,
                source: "warm_index",
                freshness: "stale",
                snapshot_ref: null,
                revision: null,
                refreshed: false,
              },
              result: {
                changes: changes.map((row) => ({
                  id: row.id,
                  status: "ok",
                  mutation: "done",
                  readback: "pass",
                  index: "done",
                })),
                data: {
                  mode: "set_item_take_controls",
                  timings: {
                    target_resolution_ms: 1,
                    preflight_ms: 1,
                    mutation_ms: 1,
                    final_readback_ms: 1,
                    index_maintenance_ms: 1,
                    total_ms: 5,
                  },
                  calls: { resolve: 8, preflight: 8, mutation: 40, readback: 8, index: 1, total: 65 },
                },
              },
              budget: { max_bytes: 2048, actual_bytes: 400, truncated: false },
            };
            assert.equal(validateBatchResponse(response, { budget: request.budget, changes }).ok, true);
            return response;
          }
          throw new Error(`unexpected ${request.id}`);
        },
      });
      assert.equal(report.ok, false);
      assert.equal(report.error?.code, "D1_HARNESS_WARM_LATENCY_EXCEEDED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an otherwise-ok live response when one row lacks final readback truth", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d1-harness-row-truth-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT 0.1>\n", "utf8");
    const transport = makeLiveLikeTransport();
    try {
      const report = await runAlpha34D1ItemsBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        executeLive: false,
        fakeTransportOnly: true,
        callTemplate: async (request) => {
          const response = await transport.callTemplate(request);
          if (request.id === "macro.items.apply" && request.input.mode === "set_item_take_controls") {
            const next = structuredClone(response);
            next.result.changes[0].readback = "fail";
            return next;
          }
          return response;
        },
      });
      assert.equal(report.ok, false);
      assert.equal(report.cold.validation.code, "D1_HARNESS_ROW_TRUTH_INVALID");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a response that omits any of the fixture's forty mutation atoms", () => {
    const fixtureItems = Array.from({ length: 8 }, (_, index) => ({
      item_ref: itemRef(index + 1),
      take_ref: takeRef(index + 1),
    }));
    const changes = buildEightRowChanges(fixtureItems);
    const response = {
      ok: true,
      macro: { program_id: "openreaper.macro.items.apply" },
      sqlite: { used: true, freshness: "stale" },
      result: {
        changes: changes.map((row) => ({ id: row.id, status: "ok", mutation: "done", readback: "pass", index: "done" })),
        data: { calls: { resolve: 8, preflight: 8, mutation: 8, readback: 8, index: 1, total: 33 } },
      },
    };
    const result = validateBatchResponse(response, {
      budget: { max_response_bytes: 2048 },
      changes,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "D1_HARNESS_CALL_TRUTH_INVALID");
  });
});

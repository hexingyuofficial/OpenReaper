import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

import {
  FakeFoundationBridge,
} from "../../../packages/core/src/foundation-bridge-v1.mjs";
import {
  createStdioRecipeUndoController,
} from "../../../packages/mcp-server/src/openreaper-mcp-stdio.mjs";

const OWNER = "owner:alpha4-b-reconcile";
const GENERATION = 1;
const PROJECT_REF = "project:path:/tmp/alpha4-b-reconcile.rpp";

describe("Alpha4 Shard B exact Recipe Undo reconciliation", () => {
  it("closes one Bridge-proven not_run orphan and retries begin exactly once", async () => {
    const active = orphan();
    const bridge = makeBridge({ active });
    const controller = makeController(bridge);

    const opened = await controller.begin(beginRequest("run-current"));

    assert.equal(opened.ok, true);
    assert.equal(opened.handle, "run-current:attempt:1");
    assert.deepEqual(bridge.seen.map((request) => request.params.action), [
      "begin",
      "reconcile_not_run",
      "begin",
    ]);
    assert.deepEqual(bridge.seen[1].params, {
      action: "reconcile_not_run",
      transaction_id: active.transaction_id,
      project_ref: active.project_ref,
      label: active.label,
    });
    assert.equal(bridge.seen[0].timeout_ms, 60_000);
    assert.equal(bridge.seen[1].timeout_ms, 60_000);
    assert.equal(bridge.seen[2].timeout_ms, 60_000);
    assert.notEqual(bridge.seen[0].idempotency_key, bridge.seen[2].idempotency_key);
    assert.match(bridge.seen[2].idempotency_key, /:retry:1$/);
  });

  it("does not reconcile timeout, mutation-uncertain, or mismatched Bridge proof", async () => {
    for (const scenario of [
      { mode: "begin_timeout", expectedCalls: ["begin"], expectedOutcome: "unknown" },
      { active: orphan({ mutation_may_have_happened: true }), expectedCalls: ["begin"], expectedOutcome: "unknown" },
      { active: orphan({ owner: "owner:other" }), expectedCalls: ["begin"], expectedOutcome: "not_run" },
      { active: orphan({ project_ref: "project:path:/tmp/other.rpp" }), expectedCalls: ["begin"], expectedOutcome: "not_run" },
    ]) {
      const bridge = makeBridge(scenario);
      const controller = makeController(bridge);
      await assert.rejects(
        controller.begin(beginRequest(`run-${scenario.mode ?? scenario.active.owner}`)),
        (error) => error.outcome === scenario.expectedOutcome && error.reconciliation_required === true,
      );
      assert.deepEqual(bridge.seen.map((request) => request.params.action), scenario.expectedCalls);
    }
  });

  it("keeps reconcile close timeout unknown and never issues the begin retry", async () => {
    const bridge = makeBridge({ active: orphan(), mode: "reconcile_timeout" });
    const controller = makeController(bridge);
    await assert.rejects(
      controller.begin(beginRequest("run-close-timeout")),
      (error) => error.code === "BRIDGE_TIMEOUT"
        && error.outcome === "unknown"
        && error.reconciliation_required === true,
    );
    assert.deepEqual(bridge.seen.map((request) => request.params.action), ["begin", "reconcile_not_run"]);
  });

  it("never reconciles a not_run transaction that still has a live local lease", async () => {
    const bridge = makeBridge();
    const controller = makeController(bridge);
    const first = await controller.begin(beginRequest("run-live-a"));
    assert.equal(first.ok, true);

    await assert.rejects(
      controller.begin(beginRequest("run-live-b")),
      (error) => error.code === "QUEUE_CONFLICT"
        && error.outcome === "not_run"
        && error.reconciliation_required === true,
    );
    assert.deepEqual(bridge.seen.map((request) => request.params.action), ["begin", "begin"]);

    await controller.end({
      handle: first.handle,
      project_ref: PROJECT_REF,
      label: "OpenReaper Recipe: recipe.run-live-a",
      mutation_truth: "not_run",
    });
    assert.deepEqual(bridge.seen.map((request) => request.params.action), ["begin", "begin", "end"]);
  });

  it("executes the product Lua exact-match, mutation marker, and one-close fail-closed rules", () => {
    const routeSource = readFileSync(
      new URL("../../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url),
      "utf8",
    );
    const start = routeSource.indexOf("local function dispatch_recipe_undo_transaction(request)");
    const end = routeSource.indexOf("\nlocal RECIPE_UNDO_OPERATION_KEY", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const productBlock = routeSource.slice(start, end);
    assert.match(
      routeSource,
      /if phase_may_mutate == true and ACTIVE_RECIPE_UNDO_TRANSACTION[\s\S]*ACTIVE_RECIPE_UNDO_TRANSACTION\.mutation_may_have_happened = true\n  end\n  local ok, summary/,
    );
    const policySource = readFileSync(
      new URL("../../../reaper/bridge/src/35-route-policy.lua", import.meta.url),
      "utf8",
    );
    assert.match(policySource, /A stale Recipe transaction child cannot execute after its Whole-Recipe Undo scope closed\./);
    const loopSource = readFileSync(
      new URL("../../../reaper/bridge/src/90-file-transport-loop.lua", import.meta.url),
      "utf8",
    );
    assert.match(loopSource, /reaper\.atexit\(function\(\)[\s\S]*Undo_EndBlock2/);

    runLua(`
local ACTIVE_OWNER = "${OWNER}"
local ACTIVE_GENERATION = ${GENERATION}
local ACTIVE_RECIPE_UNDO_TRANSACTION = nil
local current_project = {}
local current_path = "/tmp/alpha4-b-reconcile.rpp"
local end_calls = 0
local undo_calls = 0
local end_succeeds = true
local current_undo_label = nil

local function is_object(value) return type(value) == "table" end
local function is_string(value) return type(value) == "string" and value ~= "" end
local function bounded_string(value, max_length)
  local text = type(value) == "string" and value or tostring(value or "")
  return string.sub(text, 1, max_length)
end
local function call_reaper(name, ...)
  if name == "EnumProjects" then return true, current_project, current_path end
  if name == "Undo_BeginBlock2" then return true end
  if name == "Undo_EndBlock2" then end_calls = end_calls + 1; current_undo_label = select(2, ...); return end_succeeds end
  if name == "Undo_CanUndo2" then return true, current_undo_label end
  if name == "Undo_DoUndo2" then undo_calls = undo_calls + 1; return true, 1 end
  return false
end
local function active_recipe_undo_project_matches()
  if not ACTIVE_RECIPE_UNDO_TRANSACTION then return true end
  local ok, project = call_reaper("EnumProjects", -1, "")
  return ok == true and project == ACTIVE_RECIPE_UNDO_TRANSACTION.project
end
local function recipe_undo_transaction_flag(request)
  local flags = request.undo and request.undo.flags or {}
  for index = 1, #flags do
    local transaction_id = string.match(flags[index], "^recipe_transaction:(.+)$")
    if transaction_id then return transaction_id end
  end
  return nil
end
local function handler_error(code, message, details, recoverable)
  return nil, { code = code, message = message, details = details or {}, recoverable = recoverable ~= false }
end

${productBlock}

local function request(action, transaction_id, label, owner, generation, session_id, disposition, mutation_truth)
  return {
    client = { session_id = session_id or "session-a" },
    bridge = { expected_owner = owner or ACTIVE_OWNER, expected_generation = generation or ACTIVE_GENERATION },
    params = {
      action = action,
      transaction_id = transaction_id,
      project_ref = "${PROJECT_REF}",
      label = label,
      disposition = disposition,
      mutation_truth = mutation_truth,
    },
    pack = { risk = "write" },
    undo = { flags = { "recipe_transaction:" .. transaction_id } },
  }
end

local opened = dispatch_recipe_undo_transaction(request("begin", "tx-old", "Old label"))
assert(opened and opened.opened == true)
local _, conflict = dispatch_recipe_undo_transaction(request("begin", "tx-new", "New label"))
assert(conflict.code == "QUEUE_CONFLICT")
assert(conflict.details.outcome == "not_run")
assert(conflict.details.active_transaction.transaction_id == "tx-old")
assert(conflict.details.active_transaction.owner == ACTIVE_OWNER)
assert(conflict.details.active_transaction.generation == ACTIVE_GENERATION)

local _, mismatch = dispatch_recipe_undo_transaction(request("reconcile_not_run", "tx-old", "Wrong label"))
assert(mismatch.code == "QUEUE_CONFLICT")
assert(end_calls == 0)
local reconciled = dispatch_recipe_undo_transaction(request("reconcile_not_run", "tx-old", "Old label", ACTIVE_OWNER, ACTIVE_GENERATION, "session-b"))
assert(reconciled and reconciled.closed == true and reconciled.verified == true)
assert(end_calls == 1)

assert(dispatch_recipe_undo_transaction(request("begin", "tx-write", "Write label")))
ACTIVE_RECIPE_UNDO_TRANSACTION.mutation_may_have_happened = true
local _, write_started = dispatch_recipe_undo_transaction(request("reconcile_not_run", "tx-write", "Write label", ACTIVE_OWNER, ACTIVE_GENERATION, "session-b"))
assert(write_started.code == "QUEUE_CONFLICT")
assert(write_started.details.outcome == "unknown")
assert(write_started.details.zero_write == false)
assert(end_calls == 1)

ACTIVE_RECIPE_UNDO_TRANSACTION.mutation_may_have_happened = false
end_succeeds = false
local _, close_unknown = dispatch_recipe_undo_transaction(request("reconcile_not_run", "tx-write", "Write label", ACTIVE_OWNER, ACTIVE_GENERATION, "session-b"))
assert(close_unknown.code == "INTERNAL_ERROR")
assert(close_unknown.details.outcome == "unknown")
assert(close_unknown.details.active_transaction.close_outcome_unknown == true)
assert(end_calls == 2)
local _, no_second_close = dispatch_recipe_undo_transaction(request("reconcile_not_run", "tx-write", "Write label", ACTIVE_OWNER, ACTIVE_GENERATION, "session-b"))
assert(no_second_close.code == "QUEUE_CONFLICT")
assert(end_calls == 2)

ACTIVE_RECIPE_UNDO_TRANSACTION = nil
end_succeeds = true
assert(dispatch_recipe_undo_transaction(request("begin", "tx-rollback", "Rollback label")))
ACTIVE_RECIPE_UNDO_TRANSACTION.mutation_may_have_happened = true
local rolled_back = dispatch_recipe_undo_transaction(request("end", "tx-rollback", "Rollback label", ACTIVE_OWNER, ACTIVE_GENERATION, "session-a", "rollback", "applied"))
assert(rolled_back and rolled_back.closed == true and rolled_back.verified == true)
assert(rolled_back.rollback_requested == true)
assert(rolled_back.rollback_attempted == true)
assert(rolled_back.rollback_proven == true)
assert(undo_calls == 1)
return true
`);
  });
});

function beginRequest(runId) {
  return {
    run_id: runId,
    attempt: 1,
    project_ref: PROJECT_REF,
    label: `OpenReaper Recipe: recipe.${runId}`,
  };
}

function orphan(overrides = {}) {
  return {
    transaction_id: "run-orphan:attempt:1",
    project_ref: PROJECT_REF,
    label: "OpenReaper Recipe: recipe.orphan",
    owner: OWNER,
    generation: GENERATION,
    mutation_may_have_happened: false,
    close_outcome_unknown: false,
    active_project_matches: true,
    ...overrides,
  };
}

function makeController(bridge) {
  let sequence = 0;
  return createStdioRecipeUndoController({
    liveBridge: { executor: bridge },
    callContext: {
      allocate() {
        sequence += 1;
        return {
          client_id: "openreaper-mcp",
          session_id: `session-${sequence}`,
          expected_owner: OWNER,
          expected_generation: GENERATION,
          created_at: `2026-07-24T00:00:${String(sequence).padStart(2, "0")}.000Z`,
          request_sequence: sequence,
        };
      },
    },
  });
}

function makeBridge({ active: initialActive = null, mode = null } = {}) {
  const bridge = new FakeFoundationBridge({
    owner: OWNER,
    generation: GENERATION,
    now: () => new Date("2026-07-24T00:01:00.000Z"),
  });
  let active = initialActive == null ? null : structuredClone(initialActive);
  bridge.execute = function execute(request, startedAt) {
    const action = request.params.action;
    if (action === "begin" && mode === "begin_timeout") {
      return this.errorEnvelope(request, "BRIDGE_TIMEOUT", "Delayed begin result is still pending.", {
        startedAt,
        queueState: "timeout",
        details: { outcome: "unknown", request_state: "result_pending_or_completion_unknown" },
      });
    }
    if (action === "begin" && active) {
      const notRun = active.mutation_may_have_happened === false
        && active.close_outcome_unknown !== true
        && active.active_project_matches === true;
      return this.errorEnvelope(request, "QUEUE_CONFLICT", "A Recipe Undo transaction is already active.", {
        startedAt,
        details: {
          outcome: notRun ? "not_run" : "unknown",
          zero_write: notRun,
          active_transaction: structuredClone(active),
        },
      });
    }
    if (action === "reconcile_not_run") {
      if (mode === "reconcile_timeout") {
        return this.errorEnvelope(request, "BRIDGE_TIMEOUT", "Recipe Undo close outcome is unknown.", {
          startedAt,
          queueState: "timeout",
          details: { outcome: "unknown", zero_write: false },
        });
      }
      const exact = active
        && request.params.transaction_id === active.transaction_id
        && request.params.project_ref === active.project_ref
        && request.params.label === active.label;
      if (!exact) {
        return this.errorEnvelope(request, "QUEUE_CONFLICT", "Reconcile identity mismatch.", {
          startedAt,
          details: { outcome: "unknown", zero_write: true },
        });
      }
      const reconciled = active;
      active = null;
      return this.okEnvelope(request, startedAt, undoSummary(request, {
        action,
        transactionId: reconciled.transaction_id,
        opened: true,
        closed: true,
      }));
    }
    if (action === "end") {
      const ended = active;
      active = null;
      const rollback = request.params.disposition === "rollback"
        && request.params.mutation_truth !== "not_run";
      return this.okEnvelope(request, startedAt, undoSummary(request, {
        action,
        transactionId: ended?.transaction_id ?? request.params.transaction_id,
        opened: true,
        closed: true,
        rollback,
      }));
    }
    active = {
      transaction_id: request.params.transaction_id,
      project_ref: request.params.project_ref,
      label: request.params.label,
      owner: OWNER,
      generation: GENERATION,
      mutation_may_have_happened: false,
      close_outcome_unknown: false,
      active_project_matches: true,
    };
    return this.okEnvelope(request, startedAt, undoSummary(request, {
      action,
      transactionId: request.params.transaction_id,
      opened: true,
      closed: false,
    }));
  };
  return bridge;
}

function undoSummary(request, { action, transactionId, opened, closed, rollback = false }) {
  return {
    summary: {
      contract: "openreaper.recipe_undo_transaction.v1",
      action,
      transaction_id: transactionId,
      project_ref: request.params.project_ref,
      opened,
      closed,
      verified: true,
      rollback_requested: rollback,
      rollback_attempted: rollback,
      rollback_proven: rollback,
      readback_status: "passed",
    },
    refs: [],
    artifacts: [],
    jobs: [],
    readback: null,
  };
}

function runLua(source) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
}

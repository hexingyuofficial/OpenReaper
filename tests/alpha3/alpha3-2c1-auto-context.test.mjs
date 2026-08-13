import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_2C1_DEFAULT_BRIDGE_GENERATION,
  ALPHA3_2C1_DEFAULT_BRIDGE_OWNER,
  Alpha3_2C1CallContextError,
  createAlpha3_2C1CallContextManager,
} from "../../packages/mcp-server/src/alpha3-2c1-call-context-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  callTemplateWithAuthoritativeIdentity,
  createConfiguredProjectIndexBinding,
  isZeroWriteGenerationMismatch,
  resolveAuthoritativeBridgeIdentity,
} from "../../packages/mcp-server/src/openreaper-mcp-stdio.mjs";
import {
  LIVE_BRIDGE_HEARTBEAT_FILENAME,
  LIVE_BRIDGE_LIVENESS_CONTRACT,
  LIVE_BRIDGE_LIVENESS_STATUS,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const STDIO_SERVER = "packages/mcp-server/src/openreaper-mcp-stdio.mjs";
const EXACT_TOOLS = ["call_recipe", "call_template", "get_state", "list_recipes", "list_templates", "ping"];

function deterministicManager(options = {}) {
  return createAlpha3_2C1CallContextManager({
    env: options.env ?? {},
    now: options.now ?? (() => new Date("2026-07-11T05:00:00.000Z")),
    sessionIdFactory: ({ index }) => `server-session-${index}`,
  });
}

function parseToolJson(response) {
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

async function respondToNextBridgeRequest(transportDir, bridge, options = {}) {
  const requestsDir = path.join(transportDir, "requests");
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const files = (await readdir(requestsDir)).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const request = JSON.parse(await readFile(path.join(requestsDir, file), "utf8"));
      if (
        Number.isSafeInteger(options.expectedGeneration)
        && request?.bridge?.expected_generation !== options.expectedGeneration
      ) continue;
      const result = bridge.dispatch(request);
      await writeFile(path.join(transportDir, "results", file), `${JSON.stringify(result)}\n`, "utf8");
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for stdio bridge request");
}

describe("Alpha3.2-C1 server-managed call context", () => {
  it("uses the product identity by default and strictly accepts valid installed identity", () => {
    const defaults = deterministicManager().allocate();
    assert.equal(defaults.expected_owner, ALPHA3_2C1_DEFAULT_BRIDGE_OWNER);
    assert.equal(defaults.expected_generation, ALPHA3_2C1_DEFAULT_BRIDGE_GENERATION);
    assert.equal(defaults.request_sequence, 1);
    assert.equal(defaults.session_id, "server-session-1");

    const installed = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "42",
      },
    }).allocate();
    assert.equal(installed.expected_owner, "installed-owner");
    assert.equal(installed.expected_generation, 42);
  });

  it("fails closed for invalid owner or generation environment values", () => {
    for (const env of [
      { OPENREAPER_LIVE_BRIDGE_OWNER: "bad\nowner" },
      { OPENREAPER_LIVE_BRIDGE_OWNER: "" },
      { OPENREAPER_LIVE_BRIDGE_GENERATION: "1trailing" },
      { OPENREAPER_LIVE_BRIDGE_GENERATION: "-1" },
      { OPENREAPER_LIVE_BRIDGE_GENERATION: "01" },
    ]) {
      assert.throws(
        () => deterministicManager({ env }),
        (error) => error instanceof Alpha3_2C1CallContextError
          && error.code === "CALL_TEMPLATE_BRIDGE_IDENTITY_ENV_INVALID",
      );
    }
  });

  it("allocates before async dispatch, keeps concurrent request ids unique, and rotates after 999", async () => {
    const manager = deterministicManager();
    const contexts = Array.from({ length: 1_000 }, () => manager.allocate());

    assert.deepEqual(contexts.slice(0, 3).map((context) => context.request_sequence), [1, 2, 3]);
    assert.equal(contexts[998].request_sequence, 999);
    assert.equal(contexts[998].session_id, "server-session-1");
    assert.equal(contexts[999].request_sequence, 1);
    assert.equal(contexts[999].session_id, "server-session-2");
    assert.notEqual(contexts[0].created_at, contexts[999].created_at);

    const bridge = new FakeFoundationBridge({
      owner: ALPHA3_2C1_DEFAULT_BRIDGE_OWNER,
      generation: ALPHA3_2C1_DEFAULT_BRIDGE_GENERATION,
    });
    const runtime = createCallTemplateRuntime({ executor: bridge, evidenceLimit: 1_000 });
    const results = await Promise.all(contexts.map((context) => runtime.call_template({
      id: "template.transport.read_state",
      input: {},
      context,
    })));

    assert.equal(results.every((result) => result.ok === true), true);
    const requestIds = bridge.seen.map((request) => request.id);
    assert.equal(new Set(requestIds).size, 1_000);
    assert.match(requestIds[0], /_001_/u);
    assert.match(requestIds[998], /_999_/u);
    assert.match(requestIds[999], /_001_/u);
  });

  it("treats explicit context as logical hints while retaining server ownership", () => {
    const manager = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "7",
      },
    });
    const context = manager.allocate({
      client_id: "logical-client",
      session_id: "caller-session",
      expected_owner: "installed-owner",
      expected_generation: "current",
      created_at: "1999-01-01T00:00:00.000Z",
      request_sequence: 999,
    });

    assert.equal(context.client_id, "logical-client");
    assert.equal(context.session_id, "server-session-1");
    assert.equal(context.expected_owner, "installed-owner");
    assert.equal(context.expected_generation, 7);
    assert.equal(context.created_at, "2026-07-11T05:00:00.000Z");
    assert.equal(context.request_sequence, 1);

    for (const hint of [
      { expected_owner: "other-owner" },
      { expected_generation: 8 },
    ]) {
      assert.throws(
        () => manager.allocate(hint),
        (error) => error instanceof Alpha3_2C1CallContextError
          && error.code === "CALL_TEMPLATE_BRIDGE_IDENTITY_CONFLICT",
      );
    }
    assert.throws(
      () => manager.allocate({ bridge: { expected_owner: "installed-owner" } }),
      (error) => error.code === "CALL_TEMPLATE_CONTEXT_HINT_INVALID",
    );
  });

  it("keeps concurrent authoritative generation scopes isolated and restores the installed identity", async () => {
    const manager = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    let releaseSeven;
    const sevenGate = new Promise((resolve) => { releaseSeven = resolve; });
    const seven = manager.runWithIdentity({ owner: "installed-owner", generation: 7 }, async () => {
      await sevenGate;
      return manager.allocate();
    });
    const eight = manager.runWithIdentity({ owner: "installed-owner", generation: 8 }, async () => {
      const context = manager.allocate();
      releaseSeven();
      return context;
    });
    const [sevenContext, eightContext] = await Promise.all([seven, eight]);

    assert.equal(sevenContext.expected_generation, 7);
    assert.equal(eightContext.expected_generation, 8);
    assert.notEqual(sevenContext.request_sequence, eightContext.request_sequence);
    assert.equal(manager.allocate().expected_generation, 1);
  });

  it("binds Project Index state and adapters to each authoritative generation", async () => {
    const manager = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    const opened = [];
    const closed = [];
    let releaseSeven;
    const sevenGate = new Promise((resolve) => { releaseSeven = resolve; });
    const openRuntime = async ({ identity }) => {
      opened.push(identity.generation);
      if (identity.generation === 7) await sevenGate;
      return {
        ok: true,
        generation: identity.generation,
        adapter: {
          generation: identity.generation,
          read() { return this.generation; },
        },
        status() { return { generation: this.generation }; },
        close() { closed.push(this.generation); },
      };
    };
    const binding = await createConfiguredProjectIndexBinding({
      env: { OPENREAPER_PROJECT_INDEX_STATE_ROOT: "/test/index" },
      callContext: manager,
      openRuntime,
    });

    assert.equal(binding.runtime.status().generation, 1);
    assert.equal(binding.runtime.adapter.read(), 1);
    assert.equal(binding.runtime.adapter, binding.runtime.adapter);

    const firstSeven = binding.activate({ owner: "installed-owner", generation: 7 });
    const secondSeven = binding.activate({ owner: "installed-owner", generation: 7 });
    await Promise.resolve();
    assert.deepEqual(opened, [1, 7]);
    releaseSeven();
    assert.equal(await firstSeven, await secondSeven);
    await binding.activate({ owner: "installed-owner", generation: 8 });

    let releaseScopedSeven;
    const scopedSevenGate = new Promise((resolve) => { releaseScopedSeven = resolve; });
    const seven = manager.runWithIdentity({ owner: "installed-owner", generation: 7 }, async () => {
      await scopedSevenGate;
      return {
        runtime: binding.runtime.status().generation,
        adapter: binding.runtime.adapter.read(),
      };
    });
    const eight = manager.runWithIdentity({ owner: "installed-owner", generation: 8 }, async () => {
      const result = {
        runtime: binding.runtime.status().generation,
        adapter: binding.runtime.adapter.read(),
      };
      releaseScopedSeven();
      return result;
    });
    assert.deepEqual(await Promise.all([seven, eight]), [
      { runtime: 7, adapter: 7 },
      { runtime: 8, adapter: 8 },
    ]);
    assert.equal(binding.runtime.status().generation, 1);
    assert.equal(binding.runtime.adapter.read(), 1);

    binding.close();
    assert.deepEqual(closed.sort((a, b) => a - b), [1, 7, 8]);
    await assert.rejects(
      binding.activate({ owner: "installed-owner", generation: 9 }),
      /binding is closed/u,
    );
  });

  it("fails closed when a fresh Project Index generation cannot activate", async () => {
    const manager = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    const binding = await createConfiguredProjectIndexBinding({
      env: { OPENREAPER_PROJECT_INDEX_STATE_ROOT: "/test/index" },
      callContext: manager,
      openRuntime: async ({ identity }) => identity.generation === 1
        ? { ok: true, adapter: {}, close() {} }
        : { ok: false, close() {} },
    });

    await assert.rejects(
      binding.activate({ owner: "installed-owner", generation: 2 }),
      (error) => error instanceof Alpha3_2C1CallContextError
        && error.code === "CALL_TEMPLATE_PROJECT_INDEX_GENERATION_ACTIVATION_FAILED",
    );
    assert.throws(
      () => manager.runWithIdentity(
        { owner: "installed-owner", generation: 2 },
        () => binding.runtime.adapter.missing,
      ),
      /was not activated/u,
    );
  });

  it("adopts each fresh heartbeat generation instead of retaining the MCP process startup value", async () => {
    const manager = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    let generation = 7;
    const seen = [];
    const liveBridge = {
      configured: true,
      executor: {
        async probeLiveness(options) {
          assert.deepEqual(options, { expectedOwner: "installed-owner" });
          return readyProbe("installed-owner", generation);
        },
      },
    };
    const runtime = {
      async call_template(request) {
        seen.push(request.context.expected_generation);
        return { ok: true, generation: request.context.expected_generation };
      },
    };

    const first = await callTemplateWithAuthoritativeIdentity({ request: { id: "template.transport.read_state" }, callContext: manager, runtime, liveBridge });
    generation = 8;
    const second = await callTemplateWithAuthoritativeIdentity({ request: { id: "template.transport.read_state" }, callContext: manager, runtime, liveBridge });

    assert.equal(first.generation, 7);
    assert.equal(second.generation, 8);
    assert.deepEqual(seen, [7, 8]);
  });

  it("retries a generation mismatch once only when the complete result proves zero-write", async () => {
    const manager = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    let leasedProbeCalls = 0;
    let freshProbeCalls = 0;
    const seen = [];
    const liveBridge = {
      configured: true,
      executor: {
        async probeLeasedLiveness(options) {
          leasedProbeCalls += 1;
          assert.deepEqual(options, { expectedOwner: "installed-owner" });
          return readyProbe("installed-owner", 7);
        },
        async probeLiveness(options) {
          freshProbeCalls += 1;
          assert.deepEqual(options, { expectedOwner: "installed-owner" });
          return readyProbe("installed-owner", 8);
        },
      },
    };
    const runtime = {
      async call_template(request) {
        seen.push({ generation: request.context.expected_generation, sequence: request.context.request_sequence });
        if (seen.length === 1) return generationMismatchResult(true);
        return { ok: true, generation: request.context.expected_generation };
      },
    };

    const result = await callTemplateWithAuthoritativeIdentity({ request: { id: "template.transport.read_state" }, callContext: manager, runtime, liveBridge });
    assert.equal(result.ok, true);
    assert.equal(result.generation, 8);
    assert.deepEqual(seen.map((entry) => entry.generation), [7, 8]);
    assert.notEqual(seen[0].sequence, seen[1].sequence);
    assert.equal(leasedProbeCalls, 1, "initial identity resolution should consume the Windows lease when available");
    assert.equal(freshProbeCalls, 1, "zero-write generation retry must bypass the lease");

    for (const rejected of [
      generationMismatchResult(false),
      { ok: false, error: { code: "BRIDGE_TIMEOUT", details: { outcome: "unknown", zero_write: false } } },
      { ok: false, error: { code: "BRIDGE_TIMEOUT", details: { outcome: "unknown", zero_write: true } } },
    ]) {
      let calls = 0;
      const single = await callTemplateWithAuthoritativeIdentity({
        request: { id: "template.transport.read_state" },
        callContext: manager,
        liveBridge: { configured: true, executor: { probeLiveness: async () => readyProbe("installed-owner", 9) } },
        runtime: { call_template: async () => { calls += 1; return rejected; } },
      });
      assert.equal(single, rejected);
      assert.equal(calls, 1);
    }

    let boundedCalls = 0;
    const stillMismatched = await callTemplateWithAuthoritativeIdentity({
      request: { id: "template.transport.read_state" },
      callContext: manager,
      liveBridge: { configured: true, executor: { probeLiveness: async () => readyProbe("installed-owner", 10 + boundedCalls) } },
      runtime: { call_template: async () => { boundedCalls += 1; return generationMismatchResult(true); } },
    });
    assert.equal(stillMismatched.ok, false);
    assert.equal(boundedCalls, 2);
  });

  it("fails closed on owner drift and never treats unrelated zero-write truth as a generation retry", async () => {
    const manager = deterministicManager({
      env: {
        OPENREAPER_LIVE_BRIDGE_OWNER: "installed-owner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    await assert.rejects(
      resolveAuthoritativeBridgeIdentity({
        callContext: manager,
        liveBridge: {
          configured: true,
          executor: {
            probeLiveness: async () => ({
              status: LIVE_BRIDGE_LIVENESS_STATUS.OWNER_MISMATCH,
              heartbeat: { observed: { active_owner: "other-owner", active_generation: 9 } },
            }),
          },
        },
      }),
      (error) => error instanceof Alpha3_2C1CallContextError
        && error.code === "CALL_TEMPLATE_BRIDGE_OWNER_MISMATCH",
    );
    assert.equal(isZeroWriteGenerationMismatch({
      ok: false,
      error: { code: "bridge_generation_mismatch" },
      unrelated: { zero_write: true },
    }), false);
  });

  it("supports omitted context through the actual stdio server and preserves exactly six tools", async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "openreaper-alpha32c1-stdio-"));
    const transportDir = path.join(fixtureRoot, "transport");
    await mkdir(path.join(transportDir, "requests"), { recursive: true });
    await mkdir(path.join(transportDir, "results"), { recursive: true });
    await writeFile(path.join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME), `${JSON.stringify({
      active_generation: 1,
      active_owner: "openreaper-alpha",
      contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
      interval_ms: 500,
      refreshed_at_unix_s: Math.floor(Date.now() / 1_000),
      sequence: 1,
    })}\n`, "utf8");
    const client = new Client({ name: "alpha3-2c1-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
        OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: path.resolve("reaper/bridge/openreaper-live-bridge.lua"),
        OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "2000",
        OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual((listed.tools ?? []).map((tool) => tool.name).sort(), EXACT_TOOLS);
      const callSchema = listed.tools.find((tool) => tool.name === "call_template")?.inputSchema;
      assert.equal(Object.hasOwn(callSchema?.properties ?? {}, "request"), false);
      assert.equal(Object.hasOwn(callSchema?.properties ?? {}, "lua"), false);
      assert.equal(Object.hasOwn(callSchema?.properties ?? {}, "action"), false);
      assert.equal(Object.hasOwn(callSchema?.properties ?? {}, "shell"), false);

      const discovery = parseToolJson(await client.callTool({
        name: "list_templates",
        arguments: { ids: ["template.transport.read_state"], fields: ["id"] },
      }));
      const example = discovery.items[0].capability_truth.example_call_shape;
      assert.equal(Object.hasOwn(example.request, "context"), false);
      assert.equal(example.context_policy.normal_call, "omit_context_server_managed");
      assert.deepEqual(example.context_policy.server_owned, ["session_id", "created_at", "request_sequence"]);
      assert.equal(example.context_policy.installed_identity_conflicts, "rejected");

      const fakeBridge = new FakeFoundationBridge({ owner: "openreaper-alpha", generation: 1 });
      const responsePromise = client.callTool({
        name: "call_template",
        arguments: { id: "template.transport.read_state", input: {} },
      });
      const observedRequestPromise = respondToNextBridgeRequest(transportDir, fakeBridge);
      const [atomicResponse, observedRequest] = await Promise.all([responsePromise, observedRequestPromise]);
      const atomicResult = parseToolJson(atomicResponse);
      assert.equal(atomicResponse.isError, false);
      assert.equal(atomicResult.ok, true);
      assert.equal(atomicResult.template.id, "template.transport.read_state");
      assert.equal(observedRequest.bridge.expected_owner, "openreaper-alpha");
      assert.equal(observedRequest.bridge.expected_generation, 1);
      assert.equal(observedRequest.client.id, "openreaper-mcp");
      assert.match(observedRequest.client.session_id, /^openreaper-mcp-1-/u);
      assert.match(observedRequest.id, /^cmd_.*_001_[a-f0-9]{6}$/u);

      await writeFile(path.join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME), `${JSON.stringify({
        active_generation: 2,
        active_owner: "openreaper-alpha",
        contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
        interval_ms: 500,
        refreshed_at_unix_s: Math.floor(Date.now() / 1_000),
        sequence: 2,
      })}\n`, "utf8");
      const rotatedBridge = new FakeFoundationBridge({ owner: "openreaper-alpha", generation: 2 });
      const rotatedResponsePromise = client.callTool({
        name: "call_template",
        arguments: { id: "template.transport.read_state", input: {} },
      });
      const rotatedRequestPromise = respondToNextBridgeRequest(transportDir, rotatedBridge, { expectedGeneration: 2 });
      const [rotatedResponse, rotatedRequest] = await Promise.all([rotatedResponsePromise, rotatedRequestPromise]);
      const rotatedResult = parseToolJson(rotatedResponse);
      assert.equal(rotatedResult.ok, true, JSON.stringify(rotatedResult));
      assert.equal(rotatedRequest.bridge.expected_generation, 2);

      const response = await client.callTool({
        name: "call_template",
        arguments: { id: "macro.index_status", input: {} },
      });
      const result = parseToolJson(response);
      assert.equal(response.isError, false);
      assert.equal(result.ok, false);
      assert.equal(result.template.id, "macro.index_status");
      assert.equal(result.error.code, "CALL_TEMPLATE_ID_REPLACED");
      assert.equal(result.error.details.replacement, "macro.project.query");

      const conflictResponse = await client.callTool({
        name: "call_template",
        arguments: {
          id: "macro.index_status",
          input: {},
          context: { expected_owner: "attacker-owner" },
        },
      });
      const conflict = parseToolJson(conflictResponse);
      assert.equal(conflictResponse.isError, true);
      assert.equal(conflict.error.code, "CALL_TEMPLATE_BRIDGE_IDENTITY_CONFLICT");

      await writeFile(path.join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME), `${JSON.stringify({
        active_generation: 3,
        active_owner: "foreign-owner",
        contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
        interval_ms: 500,
        refreshed_at_unix_s: Math.floor(Date.now() / 1_000),
        sequence: 3,
      })}\n`, "utf8");
      const driftResponse = await client.callTool({ name: "ping", arguments: {} });
      const drift = parseToolJson(driftResponse);
      assert.equal(driftResponse.isError, true);
      assert.equal(drift.ok, false);
      assert.equal(drift.error.code, "CALL_TEMPLATE_BRIDGE_OWNER_MISMATCH");
    } finally {
      await client.close();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("makes the actual stdio server exit instead of accepting invalid installed identity", async () => {
    const child = spawn(process.execPath, [STDIO_SERVER], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        OPENREAPER_LIVE_BRIDGE_OWNER: "invalid\nowner",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(stderr, /CALL_TEMPLATE_BRIDGE_IDENTITY_ENV_INVALID|OPENREAPER_LIVE_BRIDGE_OWNER is invalid/u);
  });
});

function readyProbe(owner, generation) {
  return {
    status: LIVE_BRIDGE_LIVENESS_STATUS.READY,
    heartbeat: { observed: { active_owner: owner, active_generation: generation } },
  };
}

function generationMismatchResult(zeroWrite) {
  return {
    ok: false,
    error: {
      code: "bridge_generation_mismatch",
      details: { outcome: "failed", zero_write: zeroWrite },
    },
  };
}

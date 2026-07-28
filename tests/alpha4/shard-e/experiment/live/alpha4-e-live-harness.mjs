#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAlpha4ELiveCorpus } from "./alpha4-e-live-corpus.mjs";
import {
  createLearnerInput,
  exactRevisionIdentity,
  sameRevisionIdentity,
  scanLearnerInput,
  scoreAgentArtifact,
  verifyDemonstratorCapture,
  verifyLiveReadback,
} from "./alpha4-e-live-verifier.mjs";

export const ALPHA4_E_LIVE_HARNESS_CONTRACT = "openreaper.alpha4.e.live_dual_agent_acceptance.v1";

const DIRECT_RUN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const AGENT_FILE = fileURLToPath(new URL("./alpha4-e-live-agent.mjs", import.meta.url));
const PUBLIC_TOOLS = new Set(["ping", "list_templates", "call_template", "call_recipe"]);
const TEMPLATE_FALLBACK = "macro_target_ambiguous_or_unavailable";
const CALL_TIMEOUT_MS = 120_000;
const INTERNAL_GATE_MS = 30_000;

export async function runAlpha4ELiveHarness(options) {
  const startedAt = new Date().toISOString();
  validateOptions(options);
  await createFreshRoot(options.outputRoot);
  const sdk = await loadSdk(options.packageRoot);
  const liveness = JSON.parse(await readFile(path.join(options.sessionRoot, "session", "transport", "openreaper-bridge-liveness-v1.json"), "utf8"));
  const runToken = createHash("sha256").update(options.outputRoot).digest("hex").slice(0, 6);
  const corpus = createAlpha4ELiveCorpus();
  const selectedTrials = options.trialId
    ? corpus.trials.filter((trial) => trial.trial_id === options.trialId)
    : corpus.trials;
  assert(selectedTrials.length > 0, `No trial matched ${String(options.trialId)}.`);

  const report = {
    contract: ALPHA4_E_LIVE_HARNESS_CONTRACT,
    ok: false,
    started_at: startedAt,
    completed_at: null,
    product_head: options.productHead ?? null,
    package_root: options.packageRoot,
    package_provenance: options.packageProvenance ?? null,
    installed_wrapper: options.installedWrapper,
    session_root: options.sessionRoot,
    output_root: options.outputRoot,
    fixture_project: options.fixtureProject ?? null,
    bridge: {
      owner: liveness.active_owner,
      generation: liveness.active_generation,
      interval_ms: liveness.interval_ms,
    },
    corpus: {
      contract: corpus.contract,
      seed: corpus.seed,
      total_trials: corpus.trial_count,
      selected_trials: selectedTrials.length,
      operation_sizes: corpus.operation_sizes,
      trials_per_size: corpus.trials_per_size,
      demonstrator_private_input: true,
      learner_private_input: false,
    },
    source_blindness: await inspectAgentBoundary(),
    public_surface: {
      tools: [...PUBLIC_TOOLS].sort(),
      raw_lua_action_shell_ui: false,
      runner_or_bridge_modified: false,
      recipe_deadline_sent: false,
    },
    performance_policy: {
      gate_ms: INTERNAL_GATE_MS,
      gate_mode: "internal_acceptance_only",
      runtime_cancellation: false,
      user_deadline_required: false,
      applies_to: ["recipe", "macro", "template"],
    },
    agents: {},
    trials: [],
    aggregate: null,
    known_contract_gaps: [
      {
        code: "PUBLIC_IMMUTABLE_CONFLICT_CODE_ERASED",
        truth: "The store REVISION_CONFLICT is exposed by call_recipe as STORE_ERROR; rejection plus unchanged five-field identity is verified.",
        runtime_or_abi_changed: false,
      },
      {
        code: "PUBLIC_UNDO_ACTION_UNAVAILABLE",
        truth: "Whole-Recipe Undo transaction open/close is proven, but rollback is neither attempted nor claimed.",
        rollback_attempted: false,
        rollback_proven: false,
      },
      {
        code: "EXECUTABLE_PROJECTION_NOT_DOMAIN_EQUIVALENCE",
        truth: "Holdout semantic scoring is independent from the one-to-one exact Item batch carrier used for live replay.",
      },
    ],
    error: null,
  };

  const agentRoots = {
    demonstrator: path.join(options.outputRoot, "agents", "demonstrator"),
    learner: path.join(options.outputRoot, "agents", "learner"),
  };
  for (const root of Object.values(agentRoots)) await mkdir(root, { recursive: true, mode: 0o700 });
  const agents = {};
  try {
    agents.demonstrator = await AgentProcess.start({ role: "demonstrator", root: agentRoots.demonstrator });
    agents.learner = await AgentProcess.start({ role: "learner", root: agentRoots.learner });
    report.agents.demonstrator = agents.demonstrator.identity;
    report.agents.learner = agents.learner.identity;

    for (const trial of selectedTrials) {
      const trialReport = await runTrial({
        trial,
        options,
        sdk,
        liveness,
        runToken,
        agents,
        agentRoots,
      });
      report.trials.push(trialReport);
      process.stdout.write(`[alpha4-e-live] ${trial.trial_id} ${trial.operation_count}op ${trial.scenario} ok=${trialReport.ok}\n`);
    }
    report.aggregate = aggregateReport(report.trials, selectedTrials.length);
    report.ok = report.source_blindness.ok && report.aggregate.ok;
  } catch (error) {
    report.error = serializeError(error);
  } finally {
    await Promise.all(Object.values(agents).map((agent) => agent.close().catch(() => undefined)));
    report.completed_at = new Date().toISOString();
    report.agents.demonstrator &&= { ...report.agents.demonstrator, closed: agents.demonstrator?.closed === true };
    report.agents.learner &&= { ...report.agents.learner, closed: agents.learner?.closed === true };
    if (!Object.values(report.agents).every((agent) => agent.closed === true)) report.ok = false;
    await writeFile(path.join(options.outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  return report;
}

async function runTrial({ trial, options, sdk, liveness, runToken, agents, agentRoots }) {
  const result = {
    trial_id: trial.trial_id,
    operation_count: trial.operation_count,
    scenario: trial.scenario,
    ok: false,
    demonstration_verification: null,
    learner_input_scan: null,
    semantic_scores: {},
    roles: {},
  };

  const demoPrefix = `A4E-${runToken.toUpperCase()}-D-${trial.trial_id.slice(-3)}-`;
  const learnerPrefix = `A4E-${runToken.toUpperCase()}-L-${trial.trial_id.slice(-3)}-`;
  const demoRecipeId = `recipe.project.a4e_${runToken}_d_${trial.trial_id}`;
  const learnerRecipeId = `recipe.project.a4e_${runToken}_l_${trial.trial_id}`;

  const demoLifecycle = await LiveLifecycle.start({
    role: "demonstrator",
    trial,
    rowPrefix: demoPrefix,
    roleRoot: agentRoots.demonstrator,
    options,
    sdk,
    liveness,
  });
  const demoAgent = await agents.demonstrator.request({
    trial,
    runtime: demoLifecycle.runtime,
    row_prefix: demoPrefix,
    recipe_id: demoRecipeId,
  });
  const verification = verifyDemonstratorCapture(trial, demoAgent.capture);
  result.demonstration_verification = verification;
  assert(verification.ok, `Demonstrator capture failed verification for ${trial.trial_id}.`);
  const demoScore = scoreAgentArtifact(trial, demoAgent.artifact);
  result.semantic_scores.demonstrator = demoScore;
  assert(demoScore.ok, `Demonstrator artifact failed semantic scoring for ${trial.trial_id}.`);
  result.roles.demonstrator = await demoLifecycle.finish(demoAgent.artifact);

  const learnerLifecycle = await LiveLifecycle.start({
    role: "learner",
    trial,
    rowPrefix: learnerPrefix,
    roleRoot: agentRoots.learner,
    options,
    sdk,
    liveness,
  });
  const learnerInput = createLearnerInput({
    trial,
    capture: demoAgent.capture,
    verification,
    runtime: learnerLifecycle.runtime,
    rowPrefix: learnerPrefix,
    recipeId: learnerRecipeId,
  });
  result.learner_input_scan = scanLearnerInput(learnerInput);
  assert(result.learner_input_scan.ok, `Learner input boundary failed for ${trial.trial_id}.`);
  const learnerAgent = await agents.learner.request(learnerInput);
  const learnerScore = scoreAgentArtifact(trial, learnerAgent.artifact);
  result.semantic_scores.learner = learnerScore;
  assert(learnerScore.ok, `Learner artifact failed semantic scoring for ${trial.trial_id}.`);
  result.roles.learner = await learnerLifecycle.finish(learnerAgent.artifact);

  result.ok = verification.ok
    && result.learner_input_scan.ok
    && demoScore.ok
    && learnerScore.ok
    && result.roles.demonstrator.ok
    && result.roles.learner.ok;
  return result;
}

class LiveLifecycle {
  static async start(context) {
    const lifecycle = new LiveLifecycle(context);
    await lifecycle.prepare();
    return lifecycle;
  }

  constructor({ role, trial, rowPrefix, roleRoot, options, sdk, liveness }) {
    this.role = role;
    this.trial = trial;
    this.rowPrefix = rowPrefix;
    this.roleRoot = roleRoot;
    this.options = options;
    this.sdk = sdk;
    this.liveness = liveness;
    this.tracePath = path.join(roleRoot, "mcp-trace.jsonl");
    this.calls = [];
    this.client = null;
    this.runtime = null;
    this.before = null;
    this.sessionBefore = null;
  }

  async prepare() {
    await this.connect("primary");
    const ping = await this.call("ping", {});
    assert(ping?.ok === true && ping?.live_bridge?.ready === true, `${this.role} ping did not find a ready Bridge.`);
    const manuals = await this.call("list_templates", {
      ids: ["macro.items.apply"],
      fields: ["id", "inputSchema", "examples", "expectedDelta"],
    });
    const expansion = manuals?.product_surface?.agent_context_macro_guide?.requested_expansions?.items
      ?.find((item) => item.id === "macro.items.apply");
    const dependency = expansion?.executable_recipe_dependency;
    assert(dependency?.descriptor_hash, "Public Item batch executable dependency was not discovered.");
    const projects = await this.call("call_template", {
      id: "template.project.list_open_projects",
      input: {},
      fallback_reason: TEMPLATE_FALLBACK,
    });
    const active = projects?.result?.summary?.projects?.find((project) => project.active === true);
    assert(active?.project_ref, "Active project identity is missing.");
    this.sessionBefore = Object.freeze({
      project_ref: active.project_ref,
      bridge_owner: ping.live_bridge.observed.owner,
      bridge_generation: String(ping.live_bridge.observed.generation),
    });
    this.before = await this.readItems();
    const itemPool = itemRows(this.before)
      .filter((row) => typeof row.ref === "string" && Number.isFinite(row.length_seconds))
      .slice(0, this.trial.operation_count)
      .map((row) => Object.freeze({ item_ref: row.ref, length_seconds: row.length_seconds }));
    assert(itemPool.length === this.trial.operation_count, `${this.role} Item carrier pool is incomplete.`);
    this.runtime = Object.freeze({
      dependency,
      item_pool: Object.freeze(itemPool),
      portability: Object.freeze({
        project_identity: "project:runtime_bound",
        bridge_owner: "bridge:runtime_bound",
        bridge_generation: "generation:runtime_bound",
        platform: "darwin",
      }),
    });
  }

  async finish(artifact) {
    const summary = {
      role: this.role,
      status: artifact.status,
      ok: false,
      recipe_identity: null,
      immutable_conflict: null,
      reconnect: null,
      one_call_recipe_replay: { count: 0, deadline_sent: false },
      live_readback: null,
      run: null,
      call_counts: null,
      calls: this.calls,
    };
    try {
      if (artifact.status === "blocked") {
        const after = await this.readItems();
        summary.live_readback = verifyLiveReadback({ artifact, before: this.before, after, runResponse: null, expectMutation: false });
        summary.typed_blocker = artifact.typed_blocker;
        summary.ok = summary.live_readback.ok
          && this.calls.every((call) => call.tool !== "call_recipe")
          && artifact.typed_blocker?.zero_write === true;
        return summary;
      }

      const validated = await this.call("call_recipe", { operation: "validate", draft: artifact.draft });
      assert(validated?.ok === true && validated?.status === "validated", `Recipe validate failed: ${JSON.stringify(validated?.errors ?? validated?.error)}`);
      const relativePath = `alpha4-e/${this.role}/${this.trial.trial_id}.executable-revision.json`;
      const saved = await this.call("call_recipe", {
        operation: "save",
        draft: artifact.draft,
        version: "1.0.0",
        revision_number: 1,
        relative_path: relativePath,
        saved_at: new Date().toISOString(),
      });
      assert(saved?.ok === true && saved?.immutable === true, "Immutable save failed.");
      const identity = exactRevisionIdentity(saved);
      summary.recipe_identity = identity;

      const conflictingDraft = { ...artifact.draft, title: `${artifact.draft.title} conflict` };
      const conflict = await this.call("call_recipe", {
        operation: "save",
        draft: conflictingDraft,
        version: "1.0.0",
        revision_number: 1,
        relative_path: relativePath,
        saved_at: new Date().toISOString(),
      });
      summary.immutable_conflict = {
        rejected: conflict?.ok === false,
        public_code: conflict?.error?.code ?? null,
        message: conflict?.error?.message ?? null,
        expected_store_code: "REVISION_CONFLICT",
        public_code_erased: conflict?.error?.code === "STORE_ERROR",
      };
      assert(summary.immutable_conflict.rejected, "Conflicting immutable save was accepted.");
      assert(["STORE_ERROR", "REVISION_CONFLICT"].includes(summary.immutable_conflict.public_code), "Immutable conflict returned an unexpected public code.");

      const listed = await this.call("call_recipe", { operation: "list", filter: { recipe_id: identity.recipe_id }, limit: 16 });
      assertIdentityInList(listed, identity, "pre-reconnect list");
      const got = await this.call("call_recipe", { operation: "get", ...identity });
      assert(sameRevisionIdentity(exactRevisionIdentity(got), identity), "Pre-reconnect get identity mismatch.");

      await this.disconnect();
      await this.connect("reconnect");
      const reconnectPing = await this.call("ping", {});
      const reconnectListed = await this.call("call_recipe", { operation: "list", filter: { recipe_id: identity.recipe_id }, limit: 16 });
      assertIdentityInList(reconnectListed, identity, "reconnect list");
      const reconnectGot = await this.call("call_recipe", { operation: "get", ...identity });
      const reconnectIdentity = exactRevisionIdentity(reconnectGot);
      assert(sameRevisionIdentity(reconnectIdentity, identity), "Reconnect get identity mismatch.");
      const reconnectProjects = await this.call("call_template", {
        id: "template.project.list_open_projects",
        input: {},
        fallback_reason: TEMPLATE_FALLBACK,
      });
      const active = reconnectProjects?.result?.summary?.projects?.find((project) => project.active === true);
      const sessionAfter = {
        project_ref: active?.project_ref,
        bridge_owner: reconnectPing?.live_bridge?.observed?.owner,
        bridge_generation: String(reconnectPing?.live_bridge?.observed?.generation),
      };
      summary.reconnect = {
        identity_before: identity,
        identity_after: reconnectIdentity,
        recipe_identity_matched: sameRevisionIdentity(identity, reconnectIdentity),
        session_before: this.sessionBefore,
        session_after: sessionAfter,
        session_identity_matched: JSON.stringify(this.sessionBefore) === JSON.stringify(sessionAfter),
      };
      assert(summary.reconnect.session_identity_matched, "Reconnect project/Bridge identity mismatch.");

      const runRequest = { operation: "run", ...identity, inputs: artifact.run_inputs };
      assert(!Object.hasOwn(runRequest, "deadline_ms"), "Internal acceptance must not send a Recipe deadline.");
      const runStarted = performance.now();
      const runResponse = await this.call("call_recipe", runRequest);
      const publicDurationMs = Math.round(performance.now() - runStarted);
      summary.one_call_recipe_replay = { count: 1, deadline_sent: false };
      await this.awaitBridgeReady("post-recipe-readback");
      const after = await this.readItems();
      const expectMutation = this.trial.scenario !== "runtime_drift";
      summary.live_readback = verifyLiveReadback({ artifact, before: this.before, after, runResponse, expectMutation });
      summary.run = summarizeRun(runResponse, publicDurationMs);

      if (expectMutation) {
        assert(runResponse?.ok === true && runResponse?.status === "succeeded", `Recipe run failed: ${JSON.stringify(runResponse?.error)}`);
        assert(summary.live_readback.ok, `Successful live readback failed: ${JSON.stringify(summary.live_readback.checks)}`);
        assert(summary.run.performance_gate_ok, "Recipe run exceeded the internal performance gate.");
      } else {
        assert(runResponse?.ok === false, "Runtime drift did not block the Recipe run.");
        assert(summary.live_readback.ok, "Runtime drift was not zero-write.");
        assert(runResponse?.execution_truth?.stage_dispatch_count === 0, "Runtime drift dispatched a stage.");
      }
      summary.ok = summary.immutable_conflict.rejected
        && summary.reconnect.recipe_identity_matched
        && summary.reconnect.session_identity_matched
        && summary.one_call_recipe_replay.count === 1
        && summary.live_readback.ok
        && (expectMutation ? summary.run.performance_gate_ok : runResponse?.ok === false);
      return summary;
    } finally {
      await this.disconnect();
      summary.call_counts = countCalls(this.calls);
    }
  }

  async readItems() {
    return this.call("call_template", {
      id: "macro.project.query",
      input: {
        entity: "items",
        fields: ["ref", "length_seconds"],
        limit: 100,
        refresh_policy: "force_read_only_refresh",
        hydrate_refs: true,
      },
    });
  }

  async awaitBridgeReady(label) {
    const started = performance.now();
    let attempt = 0;
    while (performance.now() - started < INTERNAL_GATE_MS) {
      attempt += 1;
      const ping = await this.call("ping", {});
      if (ping?.live_bridge?.ready === true) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${this.role} ${label} did not observe a fresh Bridge heartbeat within ${INTERNAL_GATE_MS}ms.`);
  }

  async connect(label) {
    const env = await lifecycleEnvironment({
      role: this.role,
      roleRoot: this.roleRoot,
      sessionRoot: this.options.sessionRoot,
      liveness: this.liveness,
    });
    const client = new this.sdk.Client({ name: `alpha4-e-${this.role}-${this.trial.trial_id}-${label}`, version: "1.0.0" });
    const transport = new this.sdk.StdioClientTransport({
      command: this.options.installedWrapper,
      args: [],
      cwd: path.dirname(this.options.installedWrapper),
      env,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => appendFile(path.join(this.roleRoot, "mcp-stderr.log"), chunk).catch(() => undefined));
    await client.connect(transport);
    this.client = client;
  }

  async disconnect() {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await client.close();
  }

  async call(tool, args) {
    assert(PUBLIC_TOOLS.has(tool), `Non-public tool requested: ${tool}.`);
    assert(this.client, "MCP client is not connected.");
    if (tool === "call_recipe") assert(!Object.hasOwn(args, "deadline_ms"), "Recipe deadline must not be sent by this acceptance harness.");
    const started = performance.now();
    const response = await this.client.callTool(
      { name: tool, arguments: args },
      undefined,
      { timeout: CALL_TIMEOUT_MS, maxTotalTimeout: CALL_TIMEOUT_MS },
    );
    const durationMs = Math.round(performance.now() - started);
    const text = response?.content?.find((entry) => entry.type === "text")?.text;
    assert(typeof text === "string", `${tool} returned no JSON text.`);
    const value = JSON.parse(text);
    const event = {
      at: new Date().toISOString(),
      role: this.role,
      trial_id: this.trial.trial_id,
      request: { tool, arguments: args },
      duration_ms: durationMs,
      response: value,
    };
    await appendFile(this.tracePath, `${JSON.stringify(event)}\n`, "utf8");
    this.calls.push({
      tool,
      operation: args.operation ?? null,
      id: args.id ?? args.recipe_id ?? null,
      ok: value?.ok !== false,
      error_code: value?.error?.code ?? null,
      duration_ms: durationMs,
      response_bytes: Buffer.byteLength(text),
    });
    return value;
  }
}

class AgentProcess {
  static async start({ role, root }) {
    const stderrPath = path.join(root, "agent-stderr.log");
    const stderrStream = createWriteStream(stderrPath, { flags: "wx", mode: 0o600 });
    const child = spawn(process.execPath, [AGENT_FILE], {
      cwd: root,
      env: { ...process.env, ALPHA4_E_AGENT_ROLE: role },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.pipe(stderrStream);
    const instance = new AgentProcess({ role, root, child, stderrStream });
    instance.listen();
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    return instance;
  }

  constructor({ role, root, child, stderrStream }) {
    this.role = role;
    this.root = root;
    this.child = child;
    this.stderrStream = stderrStream;
    this.pending = new Map();
    this.sequence = 0;
    this.buffer = "";
    this.closed = false;
    this.identity = { role, pid: child.pid, workdir: root, independent_process: true, mcp_authority: false, closed: false };
  }

  listen() {
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      while (this.buffer.includes("\n")) {
        const newline = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.trim() === "") continue;
        const response = JSON.parse(line);
        const pending = this.pending.get(response.request_id);
        if (!pending) continue;
        this.pending.delete(response.request_id);
        if (response.ok) pending.resolve(response.result);
        else pending.reject(new Error(response.error?.message ?? `${this.role} agent failed.`));
      }
    });
    this.child.once("exit", (code, signal) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`${this.role} agent exited code=${code} signal=${signal}.`));
      this.pending.clear();
    });
  }

  async request(payload) {
    const requestId = `${this.role}-${++this.sequence}`;
    const response = new Promise((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ request_id: requestId, payload })}\n`);
    const result = await response;
    await appendFile(path.join(this.root, "agent-trace.jsonl"), `${JSON.stringify({ request_id: requestId, role: this.role, result })}\n`, "utf8");
    return result;
  }

  async close() {
    if (this.closed) return;
    this.child.stdin.end();
    await new Promise((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) resolve();
      else this.child.once("exit", resolve);
    });
    this.stderrStream.end();
    this.closed = true;
    this.identity.closed = true;
  }
}

async function lifecycleEnvironment({ role, roleRoot, sessionRoot, liveness }) {
  const roots = {
    recipes: path.join(roleRoot, "recipes"),
    index: path.join(roleRoot, "project-index"),
    artifacts: path.join(sessionRoot, "session", "artifacts"),
    renders: path.join(roleRoot, "renders"),
  };
  await Promise.all(Object.values(roots).map((root) => mkdir(root, { recursive: true, mode: 0o700 })));
  return {
    ...process.env,
    OPENREAPER_SESSION_ROOT: path.join(sessionRoot, "session"),
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: path.join(sessionRoot, "session", "transport"),
    OPENREAPER_LIVE_BRIDGE_OWNER: liveness.active_owner,
    OPENREAPER_LIVE_BRIDGE_GENERATION: String(liveness.active_generation),
    OPENREAPER_EXECUTABLE_RECIPE_ROOT: roots.recipes,
    OPENREAPER_PROJECT_INDEX_STATE_ROOT: roots.index,
    OPENREAPER_ARTIFACT_ROOT: roots.artifacts,
    OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: roots.artifacts,
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT: roots.renders,
    OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: `alpha4-e-${role}`,
  };
}

async function inspectAgentBoundary() {
  const text = await readFile(AGENT_FILE, "utf8");
  const forbiddenImports = ["corpus/oracle.mjs", "live-corpus.mjs", "../corpus", "/corpus/"];
  const matches = forbiddenImports.filter((term) => text.includes(term));
  return {
    ok: matches.length === 0,
    learner_agent_file: AGENT_FILE,
    forbidden_import_matches: matches,
    learner_receives_attested_projection_only: true,
    learner_has_mcp_authority: false,
  };
}

function aggregateReport(trials, expectedCount) {
  const roles = trials.flatMap((trial) => Object.values(trial.roles));
  const compiled = roles.filter((role) => role.status === "compiled");
  const blocked = roles.filter((role) => role.status === "blocked");
  const runRows = compiled.map((role) => role.run).filter(Boolean);
  const successfulRuns = runRows.filter((run) => run.ok === true);
  const driftRuns = runRows.filter((run) => run.ok === false);
  const checks = {
    trial_count: trials.length === expectedCount,
    all_trials_passed: trials.every((trial) => trial.ok),
    dual_agent_rows: roles.length === expectedCount * 2,
    semantic_holdout: trials.every((trial) => trial.demonstration_verification?.ok && Object.values(trial.semantic_scores).every((score) => score.ok)),
    learner_source_blind: trials.every((trial) => trial.learner_input_scan?.ok),
    one_call_replay: compiled.every((role) => role.one_call_recipe_replay.count === 1 && role.one_call_recipe_replay.deadline_sent === false),
    immutable_conflicts: compiled.every((role) => role.immutable_conflict?.rejected === true),
    reconnect_identity: compiled.every((role) => role.reconnect?.recipe_identity_matched && role.reconnect?.session_identity_matched),
    whole_recipe_undo: successfulRuns.every((run) => run.undo?.scope === "whole_recipe" && run.undo?.opened && run.undo?.closed && run.undo?.proven),
    no_rollback_claim: successfulRuns.every((run) => run.undo?.rollback_attempted === false && run.undo?.rollback_proven === false),
    performance_gate: successfulRuns.every((run) => run.performance_gate_ok && run.public_duration_ms < INTERNAL_GATE_MS),
    blocked_zero_write: blocked.every((role) => role.live_readback?.ok),
    drift_zero_write: driftRuns.every((run) => run.stage_dispatch_count === 0),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    counts: {
      trials: trials.length,
      role_trials: roles.length,
      compiled: compiled.length,
      compile_blocked: blocked.length,
      successful_runs: successfulRuns.length,
      drift_blocked_runs: driftRuns.length,
      call_recipe_runs: compiled.reduce((count, role) => count + role.one_call_recipe_replay.count, 0),
    },
    performance: {
      maximum_public_duration_ms: Math.max(0, ...successfulRuns.map((run) => run.public_duration_ms)),
      maximum_runtime_total_ms: Math.max(0, ...successfulRuns.map((run) => run.performance?.total_ms ?? 0)),
      phase_totals_ms: sumPhaseTimings(successfulRuns),
      counters: sumPerformanceCounters(successfulRuns),
    },
  };
}

function summarizeRun(response, publicDurationMs) {
  const performance = response?.performance ?? response?.execution_truth?.performance ?? null;
  return {
    ok: response?.ok === true,
    status: response?.status ?? null,
    error: response?.error ?? null,
    identity: exactRevisionIdentity(response),
    public_duration_ms: publicDurationMs,
    timing: response?.timing ?? null,
    performance,
    performance_gate_ok: response?.ok === true
      && publicDurationMs < INTERNAL_GATE_MS
      && performance?.gate_ms === INTERNAL_GATE_MS
      && performance?.gate_mode === "internal_acceptance_only"
      && performance?.runtime_cancellation === false
      && performance?.total_ms < INTERNAL_GATE_MS
      && performance?.gate_ok === true,
    stage_dispatch_count: response?.execution_truth?.stage_dispatch_count ?? null,
    transport_call_count: response?.execution_truth?.transport_call_count ?? null,
    native_mutation_count: response?.execution_truth?.native_mutation_count ?? null,
    readback_count: response?.execution_truth?.readback_count ?? null,
    undo: response?.undo ?? null,
  };
}

function assertIdentityInList(response, identity, label) {
  const item = response?.items?.find((candidate) => candidate.recipe_id === identity.recipe_id);
  assert(item && sameRevisionIdentity(exactRevisionIdentity(item), identity), `${label} five-field identity mismatch.`);
}

function itemRows(response) {
  return Array.isArray(response?.result?.data?.rows) ? response.result.data.rows : [];
}

function countCalls(calls) {
  const byTool = {};
  const recipeOps = {};
  for (const call of calls) {
    byTool[call.tool] = (byTool[call.tool] ?? 0) + 1;
    if (call.tool === "call_recipe") recipeOps[call.operation] = (recipeOps[call.operation] ?? 0) + 1;
  }
  return { total: calls.length, by_tool: byTool, recipe_operations: recipeOps };
}

function sumPhaseTimings(runs) {
  const sums = {};
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.performance?.phase_timings_ms ?? {})) sums[key] = (sums[key] ?? 0) + Number(value || 0);
  }
  return sums;
}

function sumPerformanceCounters(runs) {
  const sums = {};
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.performance?.counters ?? {})) sums[key] = (sums[key] ?? 0) + Number(value || 0);
  }
  return sums;
}

async function loadSdk(packageRoot) {
  const clientPath = path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "index.js");
  const stdioPath = path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "stdio.js");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(clientPath).href),
    import(pathToFileURL(stdioPath).href),
  ]);
  return { Client, StdioClientTransport };
}

async function createFreshRoot(root) {
  const existing = await lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  assert(!existing, `Output root already exists: ${root}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
}

function validateOptions(options) {
  for (const [label, value] of Object.entries({
    installedWrapper: options.installedWrapper,
    packageRoot: options.packageRoot,
    sessionRoot: options.sessionRoot,
    outputRoot: options.outputRoot,
  })) {
    assert(typeof value === "string" && path.isAbsolute(value), `${label} must be an absolute path.`);
  }
}

function serializeError(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error), stack: error?.stack ?? null };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must be --key value pairs.");
    if (key === "--installed-wrapper") options.installedWrapper = value;
    else if (key === "--package-root") options.packageRoot = value;
    else if (key === "--session-root") options.sessionRoot = value;
    else if (key === "--output-root") options.outputRoot = value;
    else if (key === "--fixture-project") options.fixtureProject = value;
    else if (key === "--product-head") options.productHead = value;
    else if (key === "--package-provenance") options.packageProvenance = value;
    else if (key === "--trial-id") options.trialId = value;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return options;
}

if (DIRECT_RUN) {
  runAlpha4ELiveHarness(parseArgs(process.argv.slice(2))).then((report) => {
    process.stdout.write(`${JSON.stringify({ ok: report.ok, output_root: report.output_root, aggregate: report.aggregate, error: report.error }, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  }).catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

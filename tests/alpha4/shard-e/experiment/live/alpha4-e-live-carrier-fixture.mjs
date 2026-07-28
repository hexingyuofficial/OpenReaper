#!/usr/bin/env node

import { appendFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ALPHA4_E_LIVE_CARRIER_CONTRACT = "openreaper.alpha4.e.live_carrier_fixture.v1";

const DIRECT_RUN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const CALL_TIMEOUT_MS = 120_000;
const INTERNAL_GATE_MS = 30_000;
const CARRIER_TRACK_NAME = "Alpha4 E Native Carrier";

export async function buildAlpha4ELiveCarrier(options) {
  validateOptions(options);
  await createFreshRoot(options.outputRoot);
  await mkdir(path.dirname(options.fixtureProject), { recursive: true, mode: 0o700 });

  const sdk = await loadSdk(options.packageRoot);
  const liveness = JSON.parse(await readFile(
    path.join(options.sessionRoot, "session", "transport", "openreaper-bridge-liveness-v1.json"),
    "utf8",
  ));
  const report = {
    contract: ALPHA4_E_LIVE_CARRIER_CONTRACT,
    ok: false,
    started_at: new Date().toISOString(),
    completed_at: null,
    package_root: options.packageRoot,
    installed_wrapper: options.installedWrapper,
    session_root: options.sessionRoot,
    output_root: options.outputRoot,
    fixture_project: options.fixtureProject,
    requested_item_count: options.itemCount,
    performance_gate_ms: INTERNAL_GATE_MS,
    bridge: {
      owner: liveness.active_owner,
      generation: liveness.active_generation,
      interval_ms: liveness.interval_ms,
    },
    track_ref: null,
    item_refs: [],
    calls: [],
    error: null,
  };

  const tracePath = path.join(options.outputRoot, "mcp-trace.jsonl");
  const client = new sdk.Client({ name: "alpha4-e-live-carrier-fixture", version: "1.0.0" });
  const transport = new sdk.StdioClientTransport({
    command: options.installedWrapper,
    args: [],
    cwd: path.dirname(options.installedWrapper),
    env: await fixtureEnvironment({ options, liveness }),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => appendFile(path.join(options.outputRoot, "mcp-stderr.log"), chunk).catch(() => undefined));

  const call = async (tool, args, label) => {
    const started = performance.now();
    const response = await client.callTool(
      { name: tool, arguments: args },
      undefined,
      { timeout: CALL_TIMEOUT_MS, maxTotalTimeout: CALL_TIMEOUT_MS },
    );
    const publicDurationMs = Math.round(performance.now() - started);
    const text = response?.content?.find((entry) => entry.type === "text")?.text;
    assert(typeof text === "string", `${label} returned no JSON text.`);
    const value = JSON.parse(text);
    const runtimeTotalMs = Number.isFinite(value?.performance?.total_ms)
      ? value.performance.total_ms
      : null;
    const event = {
      at: new Date().toISOString(),
      label,
      tool,
      request: args,
      public_duration_ms: publicDurationMs,
      runtime_total_ms: runtimeTotalMs,
      response: value,
    };
    await appendFile(tracePath, `${JSON.stringify(event)}\n`, "utf8");
    report.calls.push({
      label,
      tool,
      id: args.id ?? null,
      ok: value?.ok === true,
      public_duration_ms: publicDurationMs,
      runtime_total_ms: runtimeTotalMs,
      performance_gate_ok: publicDurationMs < INTERNAL_GATE_MS
        && (runtimeTotalMs === null || runtimeTotalMs < INTERNAL_GATE_MS),
      error_code: value?.error?.code ?? null,
    });
    assert(publicDurationMs < INTERNAL_GATE_MS, `${label} public call exceeded ${INTERNAL_GATE_MS}ms.`);
    if (runtimeTotalMs !== null) assert(runtimeTotalMs < INTERNAL_GATE_MS, `${label} runtime exceeded ${INTERNAL_GATE_MS}ms.`);
    assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers ?? null)}`);
    return value;
  };
  const awaitBridgeReady = async (label) => {
    const started = performance.now();
    let attempt = 0;
    while (performance.now() - started < INTERNAL_GATE_MS) {
      attempt += 1;
      const ping = await call("ping", {}, `${label}-ping-${attempt}`);
      if (ping?.live_bridge?.ready === true) return ping;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${label} did not observe a fresh Bridge heartbeat within ${INTERNAL_GATE_MS}ms.`);
  };

  try {
    await client.connect(transport);
    const ping = await call("ping", {}, "bridge-ready");
    assert(ping?.live_bridge?.ready === true, "Bridge is not ready for carrier creation.");

    let tracks = await call("call_template", {
      id: "macro.project.query",
      input: {
        entity: "tracks",
        fields: ["ref", "name"],
        limit: 10,
        refresh_policy: "force_read_only_refresh",
        hydrate_refs: true,
      },
    }, "query-carrier-track-before");
    let trackRows = dataRows(tracks).filter((row) => row.name === CARRIER_TRACK_NAME);
    assert(trackRows.length <= 1, `Expected at most one exact carrier Track, found ${trackRows.length}.`);
    if (trackRows.length === 0) {
      const layout = [{ id: "alpha4_e_carrier", kind: "track", name: CARRIER_TRACK_NAME, index: 0 }];
      await call("call_template", {
        id: "macro.project.apply_layout",
        input: { layout, match_policy: "create_only", conflict_policy: "stop", dry_run: true },
      }, "layout-dry-run");
      await call("call_template", {
        id: "macro.project.apply_layout",
        input: { layout, match_policy: "create_only", conflict_policy: "stop", dry_run: false },
      }, "layout-apply");
      tracks = await call("call_template", {
        id: "macro.project.query",
        input: {
          entity: "tracks",
          fields: ["ref", "name"],
          limit: 10,
          refresh_policy: "force_read_only_refresh",
          hydrate_refs: true,
        },
      }, "query-carrier-track-after");
      trackRows = dataRows(tracks).filter((row) => row.name === CARRIER_TRACK_NAME);
    }
    assert(trackRows.length === 1, `Expected one exact carrier Track, found ${trackRows.length}.`);
    const trackRef = trackRows[0].ref ?? trackRows[0].track_ref;
    assert(typeof trackRef === "string" && trackRef.startsWith("track:"), "Carrier Track has no canonical ref.");
    report.track_ref = trackRef;

    await awaitBridgeReady("before-carrier-item-query");
    const itemsBefore = await call("call_template", {
      id: "macro.project.query",
      input: {
        entity: "items",
        fields: ["ref", "length_seconds"],
        limit: 100,
        refresh_policy: "force_read_only_refresh",
        hydrate_refs: true,
      },
    }, "query-carrier-items-before");
    const existingItemRefs = dataRows(itemsBefore)
      .map((row) => row.ref ?? row.item_ref)
      .filter((ref) => typeof ref === "string" && ref.startsWith("item:"));
    assert(existingItemRefs.length <= options.itemCount, `Carrier already has ${existingItemRefs.length} Items; expected at most ${options.itemCount}.`);
    report.item_refs.push(...existingItemRefs);

    for (let index = existingItemRefs.length; index < options.itemCount; index += 1) {
      await awaitBridgeReady(`before-midi-item-${String(index + 1).padStart(2, "0")}`);
      const startSeconds = index * 2;
      const created = await call("call_template", {
        id: "macro.midi.apply",
        input: {
          mode: "create_clips",
          start_seconds: startSeconds,
          duration_quarter_notes: 1,
          notes: [{
            start_offset_quarter_notes: 0,
            end_offset_quarter_notes: 1,
            pitch: 48 + (index % 24),
            velocity: 80 + (index % 16),
            channel: 0,
          }],
          dry_run: false,
        },
        refs: { track_ref: trackRef },
      }, `create-midi-item-${String(index + 1).padStart(2, "0")}`);
      const itemRef = findCanonicalRef(created, "item:");
      assert(itemRef, `MIDI carrier ${index + 1} returned no canonical Item ref.`);
      report.item_refs.push(itemRef);
    }

    await awaitBridgeReady("before-final-carrier-query");
    const items = await call("call_template", {
      id: "macro.project.query",
      input: {
        entity: "items",
        fields: ["ref", "length_seconds"],
        limit: 100,
        refresh_policy: "force_read_only_refresh",
        hydrate_refs: true,
      },
    }, "query-carrier-items");
    const exactItems = dataRows(items);
    assert(exactItems.length === options.itemCount, `Expected ${options.itemCount} exact carrier Items, found ${exactItems.length}.`);
    report.item_refs = exactItems.map((row) => row.ref ?? row.item_ref);

    await awaitBridgeReady("before-save-carrier-project");
    const saved = await call("call_template", {
      id: "template.project.save_project_as",
      input: { target_path: options.fixtureProject, overwrite: true },
    }, "save-carrier-project");
    const savedPath = findStringValue(saved, new Set(["project_path", "path", "target_path"]), options.fixtureProject);
    assert(savedPath === options.fixtureProject, "Save As did not return the exact fixture path.");

    await lstat(options.fixtureProject);
    report.ok = report.calls.every((entry) => entry.ok && entry.performance_gate_ok)
      && report.item_refs.length === options.itemCount;
  } catch (error) {
    report.error = serializeError(error);
  } finally {
    await client.close().catch(() => undefined);
    report.completed_at = new Date().toISOString();
    await writeFile(path.join(options.outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
  return report;
}

async function fixtureEnvironment({ options, liveness }) {
  const roots = {
    index: path.join(options.outputRoot, "project-index"),
    artifacts: path.join(options.sessionRoot, "session", "artifacts"),
    renders: path.join(options.outputRoot, "renders"),
  };
  await Promise.all(Object.values(roots).map((root) => mkdir(root, { recursive: true, mode: 0o700 })));
  return {
    ...process.env,
    OPENREAPER_SESSION_ROOT: path.join(options.sessionRoot, "session"),
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: path.join(options.sessionRoot, "session", "transport"),
    OPENREAPER_LIVE_BRIDGE_OWNER: liveness.active_owner,
    OPENREAPER_LIVE_BRIDGE_GENERATION: String(liveness.active_generation),
    OPENREAPER_PROJECT_INDEX_STATE_ROOT: roots.index,
    OPENREAPER_ARTIFACT_ROOT: roots.artifacts,
    OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: roots.artifacts,
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT: roots.renders,
    OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha4-e-live-carrier",
  };
}

function dataRows(response) {
  return Array.isArray(response?.result?.data?.rows) ? response.result.data.rows : [];
}

function findCanonicalRef(value, prefix) {
  if (typeof value === "string") return value.startsWith(prefix) ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findCanonicalRef(entry, prefix);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const entry of Object.values(value)) {
    const found = findCanonicalRef(entry, prefix);
    if (found) return found;
  }
  return null;
}

function findStringValue(value, keys, expected) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringValue(entry, keys, expected);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key) && entry === expected) return entry;
    const found = findStringValue(entry, keys, expected);
    if (found) return found;
  }
  return null;
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
    fixtureProject: options.fixtureProject,
  })) assert(typeof value === "string" && path.isAbsolute(value), `${label} must be an absolute path.`);
  assert(Number.isInteger(options.itemCount) && options.itemCount >= 20 && options.itemCount <= 100, "itemCount must be 20-100.");
}

function serializeError(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error), stack: error?.stack ?? null };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = { itemCount: 20 };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must be --key value pairs.");
    if (key === "--installed-wrapper") options.installedWrapper = value;
    else if (key === "--package-root") options.packageRoot = value;
    else if (key === "--session-root") options.sessionRoot = value;
    else if (key === "--output-root") options.outputRoot = value;
    else if (key === "--fixture-project") options.fixtureProject = value;
    else if (key === "--item-count") options.itemCount = Number(value);
    else throw new Error(`Unknown argument: ${key}`);
  }
  return options;
}

if (DIRECT_RUN) {
  buildAlpha4ELiveCarrier(parseArgs(process.argv.slice(2))).then((report) => {
    process.stdout.write(`${JSON.stringify({ ok: report.ok, output_root: report.output_root, fixture_project: report.fixture_project, item_count: report.item_refs.length, error: report.error }, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  }).catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

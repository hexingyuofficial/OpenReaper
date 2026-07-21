#!/usr/bin/env node

import { access, constants as fsConstants } from "node:fs";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const ALPHA34_G_LOW_CONTEXT_CONTRACT = "alpha3.4.g.installed_low_context.v1";
export const ALPHA34_G_EXACT_TOOLS = Object.freeze([
  "call_recipe",
  "call_template",
  "get_state",
  "list_recipes",
  "list_templates",
  "ping",
]);
export const ALPHA34_G_PROFILES = Object.freeze([
  Object.freeze({ id: "codex-style", query: "检查项目里有什么，先别改", expected_macro_id: "macro.project.inspect" }),
  Object.freeze({ id: "cursor-style", query: "show selected context", expected_macro_id: "macro.project.inspect" }),
  Object.freeze({ id: "claude-style", query: "帮我 inspect current project", expected_macro_id: "macro.project.inspect" }),
]);

const REPORT_NAME = "alpha3-4-g-installed-low-context.json";
const REPORT_MAX_BYTES = 32_768;
const CALL_TIMEOUT_MS = 30_000;
const DIRECT_RUN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function connectInstalledLowContextClient({ installedWrapper, profile }) {
  const client = new Client({ name: `openreaper-alpha34-g-${profile.id}`, version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: installedWrapper,
    args: [],
    cwd: path.dirname(installedWrapper),
    env: process.env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`${error?.message ?? error}${stderr ? `: ${bounded(stderr, 512)}` : ""}`);
  }
  return client;
}

export async function runInstalledLowContextTrial({
  installedWrapper,
  evidenceRoot,
  profiles = ALPHA34_G_PROFILES,
  connectFactory = connectInstalledLowContextClient,
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  await assertExecutableRegularFile(installedWrapper);
  await createFreshDirectory(evidenceRoot);

  const report = {
    contract: ALPHA34_G_LOW_CONTEXT_CONTRACT,
    ok: false,
    installed_wrapper: installedWrapper,
    public_tools: null,
    profiles: [],
    calls: [],
    prohibited_paths: {
      filesystem_or_source_discovery: false,
      raw_lua_action_shell_ui: false,
      guessed_schema_fields: false,
      non_public_tools: false,
    },
    audit_checks: {
      requests_validated: 0,
      macro_inputs_validated_against_expanded_schema: 0,
    },
    closure_handoff: {
      production_scenarios: ["large-production", "editing-sfx", "mixing-delivery"],
      product_domains: ["midi", "items", "fx", "automation", "media", "project_switching", "budgets", "recovery", "performance"],
      recipe_smoke: "smoke-alpha3-4-e3-installed-recipe.mjs",
    },
    clients_closed: false,
    error: null,
  };

  const clients = [];
  try {
    for (const profile of profiles) {
      validateProfile(profile);
      const client = await connectFactory({ installedWrapper, profile });
      clients.push({ id: profile.id, client, closed: false });
      const instructions = client.getInstructions?.();
      assert(typeof instructions === "string" && instructions.includes("ping -> list_templates"), "initialization instructions omit first-round flow");
      assert(Buffer.byteLength(instructions, "utf8") <= 16_384, "initialization instructions exceed budget");

      const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
      assertSameArray(tools, ALPHA34_G_EXACT_TOOLS, "public tool surface");
      report.public_tools ??= tools;
      assertSameArray(tools, report.public_tools, "profile tool surface");

      const ping = await callJson(client, report, profile.id, "ping", {});
      assert(ping.ok === true, `${profile.id} ping failed`);

      const discovered = await callJson(client, report, profile.id, "list_templates", {
        query: profile.query,
        limit: 25,
      });
      const routed = discovered?.product_surface?.macro_first_routing?.selected_macro_ids ?? [];
      assert(routed.includes(profile.expected_macro_id), `${profile.id} original wording did not route to ${profile.expected_macro_id}`);
      assert(discovered?.product_surface?.macro_first_routing?.task_text_persisted === false, `${profile.id} persisted original task text`);

      const exact = await callJson(client, report, profile.id, "list_templates", {
        ids: [profile.expected_macro_id],
        fields: ["id", "inputSchema"],
      });
      const exactItem = exact.items?.find((item) => item.id === profile.expected_macro_id);
      assert(exactItem?.inputSchema?.type === "object", `${profile.id} exact expansion lacks input schema`);

      const macroInput = { include: ["project_path", "dirty_state", "selected_context"], refresh_policy: "if_stale", limit: 25 };
      assertInputMatchesExpandedSchema(report, macroInput, exactItem.inputSchema, profile.id);
      const macro = await callJson(client, report, profile.id, "call_template", {
        id: profile.expected_macro_id,
        input: macroInput,
        budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 24_576 },
      });
      assert(macro.ok === true && macro.execution?.status === "completed", `${profile.id} macro did not complete`);

      const readback = await callJson(client, report, profile.id, "call_template", {
        id: "template.project.read_summary",
        input: {},
        budget: { max_response_bytes: 4_096, max_items: 50, max_inline_value_bytes: 2_048 },
      });
      assert(readback.ok === true, `${profile.id} native readback failed`);

      report.profiles.push({
        id: profile.id,
        language: /[\u3400-\u9fff]/u.test(profile.query) ? "zh_or_mixed" : "en",
        query_utf8_bytes: Buffer.byteLength(profile.query, "utf8"),
        expected_macro_id: profile.expected_macro_id,
        routed_macro_ids: routed,
        instruction_bytes: Buffer.byteLength(instructions, "utf8"),
        sequence: ["ping", "original_query", "exact_id_expansion", "macro_execution", "live_readback"],
      });
    }
    assert(report.audit_checks.requests_validated === profiles.length * 5, "not every public request was audited");
    assert(report.audit_checks.macro_inputs_validated_against_expanded_schema === profiles.length, "not every Macro input was schema-validated");
    report.ok = true;
  } catch (error) {
    report.error = { code: error?.code ?? "ALPHA34_G_TRIAL_FAILED", message: bounded(error?.message ?? error, 1200) };
  } finally {
    for (const entry of clients) {
      try {
        await entry.client.close();
        entry.closed = true;
      } catch (error) {
        report.error ??= { code: "CLIENT_CLOSE_FAILED", message: bounded(error?.message ?? error, 512) };
      }
    }
    report.clients_closed = clients.length === profiles.length && clients.every((entry) => entry.closed);
    if (!report.clients_closed) report.ok = false;
  }

  const reportPath = path.join(evidenceRoot, REPORT_NAME);
  let serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > REPORT_MAX_BYTES) {
    report.ok = false;
    report.error = { code: "REPORT_BUDGET_EXCEEDED", message: `report exceeded ${REPORT_MAX_BYTES} bytes` };
    serialized = `${JSON.stringify(report, null, 2)}\n`;
  }
  assert(Buffer.byteLength(serialized, "utf8") <= REPORT_MAX_BYTES, "bounded failure report exceeds report budget");
  await writeFile(reportPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { ...report, evidence_path: reportPath };
}

async function callJson(client, report, profileId, tool, args) {
  auditPublicRequest(report, tool, args);
  const started = performance.now();
  const response = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS, maxTotalTimeout: CALL_TIMEOUT_MS });
  const text = response?.content?.find((entry) => entry.type === "text")?.text;
  assert(typeof text === "string", `${tool} returned no JSON text`);
  const value = JSON.parse(text);
  report.calls.push({
    profile: profileId,
    tool,
    requested_id: args.id ?? null,
    ok: value?.ok === true,
    duration_ms: Math.round(performance.now() - started),
    response_bytes: Buffer.byteLength(text, "utf8"),
  });
  return value;
}

function auditPublicRequest(report, tool, args) {
  const allowedFields = tool === "ping"
    ? []
    : tool === "list_templates" && Object.hasOwn(args, "query")
      ? ["limit", "query"]
      : tool === "list_templates"
        ? ["fields", "ids"]
        : tool === "call_template"
          ? ["budget", "id", "input"]
          : null;
  if (!ALPHA34_G_EXACT_TOOLS.includes(tool) || allowedFields === null) {
    report.prohibited_paths.non_public_tools = true;
    throw Object.assign(new Error(`non-public or out-of-flow tool requested: ${tool}`), { code: "ALPHA34_G_ASSERTION_FAILED" });
  }
  const actualFields = Object.keys(args).sort();
  if (!sameArray(actualFields, allowedFields)) {
    report.prohibited_paths.guessed_schema_fields = true;
    throw Object.assign(new Error(`${tool} request fields were not the bounded documented shape`), { code: "ALPHA34_G_ASSERTION_FAILED" });
  }
  const requestText = JSON.stringify(args);
  if (/(?:file:\/\/|\/Users\/|\\\\|filesystem|source[_ -]?code)/iu.test(requestText)) {
    report.prohibited_paths.filesystem_or_source_discovery = true;
    throw Object.assign(new Error("filesystem or source discovery appeared in a public request"), { code: "ALPHA34_G_ASSERTION_FAILED" });
  }
  if (/(?:raw[_ -]?lua|Main_OnCommand|shell|osascript|ui[_ -]?action|SWS)/iu.test(requestText)) {
    report.prohibited_paths.raw_lua_action_shell_ui = true;
    throw Object.assign(new Error("raw execution path appeared in a public request"), { code: "ALPHA34_G_ASSERTION_FAILED" });
  }
  report.audit_checks.requests_validated += 1;
}

function assertInputMatchesExpandedSchema(report, input, schema, profileId) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    report.prohibited_paths.guessed_schema_fields = true;
    throw Object.assign(new Error(`${profileId} expanded Macro schema lacks properties`), { code: "ALPHA34_G_ASSERTION_FAILED" });
  }
  const unknown = Object.keys(input).filter((field) => !Object.hasOwn(properties, field));
  if (unknown.length > 0) {
    report.prohibited_paths.guessed_schema_fields = true;
    throw Object.assign(new Error(`${profileId} Macro input guessed fields: ${unknown.join(",")}`), { code: "ALPHA34_G_ASSERTION_FAILED" });
  }
  report.audit_checks.macro_inputs_validated_against_expanded_schema += 1;
}

function validateProfile(profile) {
  assert(profile && typeof profile.id === "string" && profile.id.length > 0, "profile id required");
  assert(typeof profile.query === "string" && profile.query.length > 0, "profile query required");
  assert(profile.expected_macro_id === "macro.project.inspect", "G profile must remain on the bounded read-only inspection Macro");
}

async function assertExecutableRegularFile(file) {
  const entry = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  assert(entry?.isFile() && !entry.isSymbolicLink(), "installedWrapper must be a non-symlink regular file");
  await new Promise((resolve, reject) => access(file, fsConstants.X_OK, (error) => error ? reject(error) : resolve()));
}

async function createFreshDirectory(root) {
  const entry = await lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (entry) {
    assert(entry.isDirectory() && !entry.isSymbolicLink(), "evidenceRoot must be a non-symlink directory");
    assert((await readdir(root)).length === 0, "evidenceRoot must be fresh and empty");
    return;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
}

function assertAbsolute(value, label) {
  assert(typeof value === "string" && path.isAbsolute(value), `${label} must be an absolute path`);
}

function assertSameArray(actual, expected, label) {
  assert(sameArray(actual, expected), `${label} mismatch`);
}

function sameArray(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function assert(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: "ALPHA34_G_ASSERTION_FAILED" });
}

function bounded(value, maxChars) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maxChars);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("usage: --installed-wrapper <absolute> --evidence-root <absolute-fresh>");
    if (key === "--installed-wrapper") options.installedWrapper = value;
    else if (key === "--evidence-root") options.evidenceRoot = value;
    else throw new Error(`unknown option: ${key}`);
  }
  return options;
}

if (DIRECT_RUN) {
  try {
    const report = await runInstalledLowContextTrial(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ ok: report.ok, contract: report.contract, evidence: report.evidence_path })}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`[OpenReaper] ${bounded(error?.message ?? error, 1200)}\n`);
    process.exitCode = 2;
  }
}

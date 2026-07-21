import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createOpenReaperMcpInitializationInstructions } from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import {
  ALPHA34_G_EXACT_TOOLS,
  ALPHA34_G_LOW_CONTEXT_CONTRACT,
  ALPHA34_G_PROFILES,
  runInstalledLowContextTrial,
} from "../../scripts/trial-alpha3-4-g-installed-low-context.mjs";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("runs three installed low-context profiles through discovery, exact expansion, Macro, and live readback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-g-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp");
  const evidenceRoot = path.join(root, "evidence");
  await writeFile(wrapper, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(wrapper, 0o755);

  const clients = [];
  const requests = [];
  const report = await runInstalledLowContextTrial({
    installedWrapper: wrapper,
    evidenceRoot,
    connectFactory: async ({ profile }) => {
      const client = createMockClient(profile, requests);
      clients.push(client);
      return client;
    },
  });

  assert.equal(report.contract, ALPHA34_G_LOW_CONTEXT_CONTRACT);
  assert.equal(report.ok, true, JSON.stringify(report.error));
  assert.deepEqual(report.public_tools, ALPHA34_G_EXACT_TOOLS);
  assert.equal(report.clients_closed, true);
  assert.equal(report.profiles.length, 3);
  assert.equal(report.calls.length, 15);
  assert.deepEqual(report.audit_checks, {
    requests_validated: 15,
    macro_inputs_validated_against_expanded_schema: 3,
  });
  assert.ok(clients.every((client) => client.closed));
  assert.deepEqual(
    requests.map((request) => request.name),
    ALPHA34_G_PROFILES.flatMap(() => ["ping", "list_templates", "list_templates", "call_template", "call_template"]),
  );
  assert.ok(requests.filter((request) => request.name === "list_templates" && request.arguments.query).every((request) => ALPHA34_G_PROFILES.some((profile) => profile.query === request.arguments.query)));
  assert.ok(requests.filter((request) => request.name === "call_template").every((request) => ["macro.project.inspect", "template.project.read_summary"].includes(request.arguments.id)));
  assert.deepEqual(report.prohibited_paths, {
    filesystem_or_source_discovery: false,
    raw_lua_action_shell_ui: false,
    guessed_schema_fields: false,
    non_public_tools: false,
  });

  const persisted = JSON.parse(await readFile(report.evidence_path, "utf8"));
  assert.equal(persisted.ok, true);
  assert.equal(Buffer.byteLength(await readFile(report.evidence_path), "utf8") <= 32_768, true);
});

test("fails closed and closes every connected client when original wording does not route", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-g-fail-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp");
  await writeFile(wrapper, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(wrapper, 0o755);
  const clients = [];
  const report = await runInstalledLowContextTrial({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    profiles: [ALPHA34_G_PROFILES[0]],
    connectFactory: async ({ profile }) => {
      const client = createMockClient(profile, [], { routed: [] });
      clients.push(client);
      return client;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "ALPHA34_G_ASSERTION_FAILED");
  assert.equal(report.clients_closed, true);
  assert.ok(clients.every((client) => client.closed));
  assert.equal(report.calls.length, 2);
});

function createMockClient(profile, requests, { routed = [profile.expected_macro_id] } = {}) {
  return {
    closed: false,
    getInstructions() { return createOpenReaperMcpInitializationInstructions(); },
    async listTools() { return { tools: ALPHA34_G_EXACT_TOOLS.map((name) => ({ name })) }; },
    async callTool(request) {
      requests.push(request);
      if (request.name === "ping") return json({ ok: true, product: "OpenReaper" });
      if (request.name === "list_templates" && request.arguments.query) {
        return json({
          contract: "discovery.menu.v1",
          ok: true,
          items: [],
          product_surface: { macro_first_routing: { selected_macro_ids: routed, task_text_persisted: false } },
        });
      }
      if (request.name === "list_templates") {
        return json({
          ok: true,
          items: [{
            id: profile.expected_macro_id,
            inputSchema: {
              type: "object",
              properties: {
                include: { type: "array" },
                refresh_policy: { type: "string" },
                limit: { type: "integer" },
              },
              additionalProperties: false,
            },
          }],
        });
      }
      if (request.arguments.id === "macro.project.inspect") {
        return json({ ok: true, contract: "macro.execution.v1", execution: { status: "completed" } });
      }
      return json({ ok: true, contract: "template.execution.v1", result: { summary: { project_ref: "project:tab:fixture" } } });
    },
    async close() { this.closed = true; },
  };
}

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "./call-template-runtime-v1.mjs";
import { createDiscoveryCatalog } from "./discovery-menu-v1.mjs";
import { createGetStateArtifactRuntime } from "./get-state-runtime-v1.mjs";
import { createLiveBridgeExecutorFromEnv } from "./live-bridge-executor-v1.mjs";
import {
  createOpenReaperAgentStartupGuidance,
} from "./openreaper-agent-startup-guidance-v1.mjs";

const KERNEL = "openreaper-mcp alpha kernel";
const VERSION = "0.3.0-alpha";

async function main() {
  const liveBridge = createLiveBridgeExecutorFromEnv(process.env);
  const runtime = createCallTemplateRuntime({
    live: liveBridge.configured
      ? {
          opted_in: true,
          executor: liveBridge.executor,
          executor_config: liveBridge.config,
          allowed_template_ids: CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
          evidence: { route: "openreaper_mcp_stdio" },
        }
      : { opted_in: false },
  });
  const recipeDiscovery = createDiscoveryCatalog({ recipes: [] });
  const artifactRuntime = process.env.OPENREAPER_ARTIFACT_ROOT
    ? createGetStateArtifactRuntime({ artifactRoot: process.env.OPENREAPER_ARTIFACT_ROOT })
    : null;

  process.stderr.write(
    `[openreaper-mcp] ${KERNEL}\n` +
      `[openreaper-mcp] tools=ping,get_state,list_templates,list_recipes,call_template\n` +
      `[openreaper-mcp] live_bridge_configured=${liveBridge.configured}\n`,
  );

  const server = new McpServer({
    name: "openreaper",
    version: VERSION,
  });

  server.tool(
    "ping",
    "Check whether the OpenReaper MCP server is loaded and whether a live bridge is configured.",
    {},
    async () => jsonToolResult({
      ok: true,
      product: "OpenReaper",
      kernel: KERNEL,
      version: VERSION,
      tools: ["ping", "get_state", "list_templates", "list_recipes", "call_template"],
      live_bridge_configured: liveBridge.configured,
      live_bridge: liveBridge.configured ? liveBridge.config : liveBridge,
      user_reminder: "REAPER must be started through OpenReaper for live MCP execution to connect.",
      agent_startup_guidance: createOpenReaperAgentStartupGuidance({
        package_root: process.env.OPENREAPER_MCP_PACKAGE_ROOT,
      }),
    }),
  );

  server.tool(
    "list_templates",
    "List OpenReaper executable templates and Alpha3 macros. Use this before call_template.",
    {
      surface: z.enum(["executable", "catalog"]).optional(),
      ids: z.array(z.string()).optional(),
      fields: z.array(z.string()).optional(),
      query: z.string().optional(),
      tags: z.array(z.string()).optional(),
      pack: z.string().optional(),
      lifecycle: z.string().optional(),
      risk: z.string().optional(),
      entity_kind: z.string().optional(),
      limit: z.number().int().positive().optional(),
      cursor: z.string().optional().nullable(),
    },
    async (request) => jsonToolResult(runtime.list_templates(request ?? {})),
  );

  server.tool(
    "list_recipes",
    "List OpenReaper recipe contracts. Recipes are agent-readable plans, not server-executed tools.",
    {
      ids: z.array(z.string()).optional(),
      fields: z.array(z.string()).optional(),
      query: z.string().optional(),
      tags: z.array(z.string()).optional(),
      pack: z.string().optional(),
      lifecycle: z.string().optional(),
      risk: z.string().optional(),
      limit: z.number().int().positive().optional(),
      cursor: z.string().optional().nullable(),
    },
    async (request) => jsonToolResult(recipeDiscovery.list_recipes(request ?? {})),
  );

  server.tool(
    "call_template",
    "Run one OpenReaper template id or Alpha3 macro id. Macros return plans and typed blockers; no hidden recipe executor is exposed.",
    {
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      params: z.record(z.unknown()).optional(),
      refs: z.array(z.unknown()).optional(),
      context: z.record(z.unknown()).optional(),
      budget: z.record(z.unknown()).optional(),
      idempotency_key: z.string().optional(),
    },
    async (request) => {
      const normalized = normalizeCallTemplateToolRequest(request ?? {});
      const result = await runtime.call_template(normalized);
      return jsonToolResult(result, !result?.ok && isHardToolError(result));
    },
  );

  server.tool(
    "get_state",
    "Read bounded OpenReaper state. Alpha package supports artifact reads when OPENREAPER_ARTIFACT_ROOT is configured.",
    {
      scope: z.string().optional(),
      artifact_ref: z.string().optional(),
      view: z.enum(["summary", "payload"]).optional(),
      budget: z.record(z.unknown()).optional(),
    },
    async (request) => {
      if (request?.scope === "artifact" && artifactRuntime) {
        return jsonToolResult(await artifactRuntime.get_state(request));
      }
      return jsonToolResult({
        ok: false,
        contract: "get_state.runtime.v1",
        error: {
          code: request?.scope === "artifact"
            ? "ARTIFACT_ROOT_NOT_CONFIGURED"
            : "SCOPE_NOT_BOUND_IN_ALPHA_STDIO",
          message: request?.scope === "artifact"
            ? "Artifact reads require OPENREAPER_ARTIFACT_ROOT in the MCP server environment."
            : "This alpha stdio server exposes OpenReaper discovery and macro planning; live project state reads require a configured live bridge route.",
          recoverable: true,
        },
        user_reminder: "Start REAPER through OpenReaper and reconnect before expecting live project reads.",
      }, true);
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[openreaper-mcp] stdio server ready\n");
}

function normalizeCallTemplateToolRequest(request) {
  return {
    ...request,
    id: request.id ?? request.name,
    input: request.input ?? request.params ?? {},
  };
}

function jsonToolResult(value, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: `${JSON.stringify(value, null, 2)}\n`,
      },
    ],
    isError,
  };
}

function isHardToolError(result) {
  const code = result?.error?.code ?? result?.error_code;
  return code === "CALL_TEMPLATE_RAW_EXECUTION_REJECTED";
}

main().catch((error) => {
  process.stderr.write(`[openreaper-mcp] fatal: ${error?.stack ?? error}\n`);
  process.exit(1);
});

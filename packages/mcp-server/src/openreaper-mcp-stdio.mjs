#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  Alpha3_2C1CallContextError,
  createAlpha3_2C1CallContextManager,
} from "./alpha3-2c1-call-context-v1.mjs";
import {
  composeAlpha3_2B3RuntimeDoctorReadiness,
} from "./alpha3-2b3-runtime-doctor-readiness-v1.mjs";
import {
  openAlpha3_2DProjectIndexRuntime,
} from "./alpha3-2d-project-index-runtime-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "./call-template-runtime-v1.mjs";
import { createDiscoveryCatalog } from "./discovery-menu-v1.mjs";
import { createGetStateArtifactRuntime } from "./get-state-runtime-v1.mjs";
import { createLiveBridgeExecutorFromEnv } from "./live-bridge-executor-v1.mjs";
import {
  createOpenReaperAgentStartupGuidance,
} from "./openreaper-agent-startup-guidance-v1.mjs";
import {
  attachAlpha3_3B1AgentContextProductMetadata,
  createAlpha3_3B1AgentContextMacroGuide,
} from "./alpha3-3-b1-agent-context-macro-guide-v1.mjs";

const KERNEL = "openreaper-mcp alpha kernel";
const VERSION = "0.3.0-alpha";

async function main() {
  const callContext = createAlpha3_2C1CallContextManager({ env: process.env });
  const liveBridge = createLiveBridgeExecutorFromEnv(process.env);
  const projectIndexRuntime = await openConfiguredProjectIndexRuntime({
    env: process.env,
    callContext,
  });
  const artifactRuntime = process.env.OPENREAPER_ARTIFACT_ROOT
    ? createGetStateArtifactRuntime({ artifactRoot: process.env.OPENREAPER_ARTIFACT_ROOT })
    : null;
  const runtime = createCallTemplateRuntime({
    managedRenderRoot: process.env.OPENREAPER_LIVE_SMOKE_RENDER_ROOT,
    projectIndexRuntime,
    projectIndexArtifactReader: artifactRuntime
      ? ({ artifact_ref }) => artifactRuntime.get_state({
          scope: "artifact",
          artifact_ref,
          view: "payload",
          budget: { max_response_bytes: 1_048_576 },
        })
      : null,
    live: liveBridge.configured
      ? {
          opted_in: true,
          executor: liveBridge.executor,
          executor_config: liveBridge.config,
          allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
          evidence: { route: "openreaper_mcp_stdio" },
        }
      : { opted_in: false },
  });
  const recipeDiscovery = createDiscoveryCatalog({ recipes: [] });

  process.stderr.write(
    `[openreaper-mcp] ${KERNEL}\n` +
      `[openreaper-mcp] tools=ping,get_state,list_templates,list_recipes,call_template\n` +
      `[openreaper-mcp] live_bridge_configured=${liveBridge.configured}\n` +
      `[openreaper-mcp] project_index=${projectIndexRuntime?.status?.().lifecycle ?? "not_configured"}\n`,
  );

  const server = new McpServer({
    name: "openreaper",
    version: VERSION,
  });

  server.tool(
    "ping",
    "Check whether the OpenReaper MCP server is loaded and whether a live bridge is configured.",
    {},
    async () => {
      const runtimeReadiness = await composeAlpha3_2B3RuntimeDoctorReadiness({
        liveBridge,
        env: process.env,
      });
      return jsonToolResult({
        ok: true,
        product: "OpenReaper",
        kernel: KERNEL,
        version: VERSION,
        tools: ["ping", "get_state", "list_templates", "list_recipes", "call_template"],
        live_bridge_configured: liveBridge.configured,
        live_bridge: runtimeReadiness.bridge,
        runtime_readiness: runtimeReadiness,
        project_index: projectIndexRuntime?.status?.() ?? {
          ok: false,
          lifecycle: "not_configured",
          rows_available: false,
          sqlite_is_truth: false,
          blockers: [{ code: "PROJECT_INDEX_NOT_CONFIGURED", message: "Use the managed package wrapper to configure the Project Index state root." }],
        },
        user_reminder: "REAPER must be started through OpenReaper for live MCP execution to connect.",
        agent_startup_guidance: createOpenReaperAgentStartupGuidance({
          package_root: process.env.OPENREAPER_MCP_PACKAGE_ROOT,
        }),
        product_surface: {
          agent_context_macro_guide: createAlpha3_3B1AgentContextMacroGuide(),
        },
      });
    },
  );

  server.tool(
    "list_templates",
    "List OpenReaper runtime actions plus exact-id Alpha3.3 Macro manuals. Check capability truth before call_template.",
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
    async (request) => jsonToolResult(attachAlpha3_3B1AgentContextProductMetadata(
      recipeDiscovery.list_recipes(request ?? {}),
    )),
  );

  server.tool(
    "call_template",
    "Run one accepted runtime-bound Template or registered executable Macro program. Legacy Macro ids return typed replacement guidance; contract-only guide ids are rejected and no hidden recipe executor is exposed.",
    {
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      params: z.record(z.unknown()).optional(),
      refs: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
      context: z.record(z.unknown()).optional(),
      budget: z.record(z.unknown()).optional(),
      idempotency_key: z.string().optional(),
    },
    async (request) => {
      let normalized;
      try {
        const context = callContext.allocate(request?.context);
        normalized = normalizeCallTemplateToolRequest(request ?? {}, context);
      } catch (error) {
        if (!(error instanceof Alpha3_2C1CallContextError)) throw error;
        return jsonToolResult(callContextErrorResult(request, error), true);
      }
      const called = await runtime.call_template(normalized);
      const result = await observeProjectIndexArtifactPayload({
        execution: called,
        artifactRuntime,
        projectIndexRuntime,
      });
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
            : "This alpha stdio server reserves get_state for bounded artifact reads; inspect live project state with executable macro.project.inspect or macro.project.query through call_template.",
          recoverable: true,
        },
        user_reminder: "Use call_template with macro.project.inspect or macro.project.query for live project state; use get_state with scope=artifact only for artifact refs.",
      }, true);
    },
  );

  const transport = new StdioServerTransport();
  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    try { projectIndexRuntime?.close?.(); } catch {}
    previousOnClose?.();
  };
  process.once("beforeExit", () => {
    try { projectIndexRuntime?.close?.(); } catch {}
  });
  await server.connect(transport);
  process.stderr.write("[openreaper-mcp] stdio server ready\n");
}


async function observeProjectIndexArtifactPayload({ execution, artifactRuntime, projectIndexRuntime }) {
  const initial = execution?.result?.project_index_observation;
  const artifactRequired = initial?.blockers?.find((entry) => entry?.code === "ARTIFACT_PAYLOAD_REQUIRED");
  const artifactRef = artifactRequired?.details?.artifact_refs?.find((ref) => typeof ref === "string");
  if (!artifactRuntime || !projectIndexRuntime || !artifactRef) return execution;

  const artifactRead = await artifactRuntime.get_state({
    scope: "artifact",
    artifact_ref: artifactRef,
    view: "payload",
    budget: { max_response_bytes: 1_048_576 },
  });
  if (artifactRead?.ok !== true || !artifactRead?.result?.artifact?.payload) {
    return {
      ...execution,
      result: {
        ...execution.result,
        project_index_initial_observation: initial,
        project_index_artifact_read: artifactRead,
      },
    };
  }

  const observation = projectIndexRuntime.observeArtifactPayload({
    templateId: execution?.template?.id,
    artifactRef,
    payload: artifactRead.result.artifact.payload,
    validated: true,
    identity: {
      ...projectIndexRuntime.identity,
      session_id: projectIndexRuntime.session_id,
    },
  });
  return {
    ...execution,
    result: {
      ...execution.result,
      project_index_initial_observation: initial,
      project_index_observation: observation,
      project_index_artifact_read: {
        ok: true,
        artifact_ref: artifactRef,
        view: "payload",
      },
    },
  };
}

async function openConfiguredProjectIndexRuntime({ env, callContext }) {
  const stateRoot = env.OPENREAPER_PROJECT_INDEX_STATE_ROOT;
  if (typeof stateRoot !== "string" || stateRoot === "") return null;
  const generationText = env.OPENREAPER_LIVE_BRIDGE_GENERATION;
  const generation = typeof generationText === "string" && /^(?:0|[1-9][0-9]*)$/u.test(generationText)
    ? Number(generationText)
    : null;
  const projectPath = typeof env.OPENREAPER_CURRENT_PROJECT_PATH === "string" && env.OPENREAPER_CURRENT_PROJECT_PATH
    ? env.OPENREAPER_CURRENT_PROJECT_PATH
    : undefined;
  const projectRef = projectPath
    ? undefined
    : typeof env.OPENREAPER_CURRENT_PROJECT_REF === "string" && env.OPENREAPER_CURRENT_PROJECT_REF
      ? env.OPENREAPER_CURRENT_PROJECT_REF
      : "project:current";
  return openAlpha3_2DProjectIndexRuntime({
    stateRoot,
    projectPath,
    projectRef,
    bridgeOwner: env.OPENREAPER_LIVE_BRIDGE_OWNER,
    bridgeGeneration: generation,
    logicalSessionKey: env.OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY
      ?? env.OPENREAPER_MCP_PACKAGE_ROOT
      ?? callContext?.contract
      ?? "openreaper-stdio",
    reservedRoots: [
      env.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR,
      env.OPENREAPER_ARTIFACT_ROOT,
      env.OPENREAPER_LIVE_SMOKE_RENDER_ROOT,
    ].filter((value) => typeof value === "string" && value !== ""),
  });
}

function normalizeCallTemplateToolRequest(request, context) {
  const { name: _name, params: _params, context: _callerContext, ...rest } = request;
  return {
    ...rest,
    id: request.id ?? request.name,
    input: request.input ?? request.params ?? {},
    context,
  };
}

function callContextErrorResult(request, error) {
  return {
    ok: false,
    contract: "call_template.runtime.v1",
    id: typeof request?.id === "string" ? request.id : null,
    error: {
      source: "stdio_context",
      code: error.code,
      message: error.message,
      recoverable: true,
      details: error.details,
    },
  };
}

function jsonToolResult(value, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: `${JSON.stringify(value)}\n`,
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

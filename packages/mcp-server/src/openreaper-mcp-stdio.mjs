#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
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
  CALL_TEMPLATE_INTERNAL_RECIPE_UNDO,
  CALL_TEMPLATE_INTERNAL_DISPATCH_TIMEOUT,
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
import {
  createAlpha34BDiscoveryManualProjection,
  createAlpha345OfficialRecipeManual,
} from "./alpha3-4-b-discovery-manual-v1.mjs";
import {
  createOpenReaperMcpInitializationInstructions,
  OPENREAPER_AGENT_FIRST_ROUND_FLOW,
  OPENREAPER_AGENT_START_HERE_DOCUMENT,
  OPENREAPER_PUBLIC_TOOL_IDS,
} from "./openreaper-agent-start-here-v1.mjs";
import {
  executableRevisionDiscoveryProjection,
  hashExecutableRecipeContent,
} from "../../core/src/executable-recipe-contract-v1.mjs";
import { createExecutableRecipeProductCatalog } from "./executable-recipe-product-catalog-v1.mjs";
import {
  CALL_RECIPE_CHECKPOINT_PROOF_CONTRACT,
  createAuthoritativeRuntimeFactsProvider,
  createCallRecipeRuntime,
} from "./call-recipe-runtime-v1.mjs";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  normalizeFoundationBridgeRequest,
  validateFoundationBridgeResult,
} from "../../core/src/foundation-bridge-v1.mjs";
import { EXECUTION_DEADLINE_MAX_MS } from "../../core/src/execution-deadline-v1.mjs";
import {
  createExecutableRecipeRevisionStore,
} from "../../core/src/executable-recipe-revision-store-v1.mjs";
import {
  ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
  createAlpha345CombinedExecutableRecipeStore,
  seedAlpha345OfficialExecutableRecipeRevisions,
} from "./alpha3-45-official-executable-recipes-v1.mjs";

const KERNEL = "openreaper-mcp alpha kernel";
const VERSION = "0.3.0-alpha";
const TOOL_SURFACE = OPENREAPER_PUBLIC_TOOL_IDS;
const AGENT_START_HERE_HINT = `Follow ${OPENREAPER_AGENT_START_HERE_DOCUMENT} (MCP initialization instructions): ${OPENREAPER_AGENT_FIRST_ROUND_FLOW}. Macro-first; full manuals only on exact ids.`;
export const CALL_RECIPE_STAGE_BUDGET = Object.freeze({
  max_response_bytes: 65_536,
  max_inline_value_bytes: 8_192,
  max_items: 100,
});
export const CALL_RECIPE_STAGE_DISPATCH_TIMEOUT_MS = 300_000;

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
  // call_recipe is always registered; bound store/catalog come from env when configured.
  const callRecipeBinding = createStdioCallRecipeRuntime({
    env: process.env,
    callTemplateRuntime: runtime,
    artifactRuntime,
    callContext,
    liveBridge,
  });
  const boundCallRecipeRuntime = callRecipeBinding?.runtime ?? null;
  const initializationInstructions = createOpenReaperMcpInitializationInstructions({
    package_root: process.env.OPENREAPER_MCP_PACKAGE_ROOT,
  });

  process.stderr.write(
    `[openreaper-mcp] ${KERNEL}\n` +
      `[openreaper-mcp] tools=${TOOL_SURFACE.join(",")}\n` +
      `[openreaper-mcp] live_bridge_configured=${liveBridge.configured}\n` +
      `[openreaper-mcp] project_index=${projectIndexRuntime?.status?.().lifecycle ?? "not_configured"}\n`,
  );

  const server = new McpServer({
    name: "openreaper",
    version: VERSION,
  }, {
    instructions: initializationInstructions,
  });

  server.tool(
    "ping",
    `Check whether the OpenReaper MCP server is loaded and whether a live bridge is configured. ${AGENT_START_HERE_HINT}`,
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
        tools: [...TOOL_SURFACE],
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
        user_reminder: "REAPER must be started through OpenReaper for live MCP execution to connect. See docs/AGENT_START_HERE.md and MCP initialization instructions.",
        agent_startup_guidance: createOpenReaperAgentStartupGuidance({
          package_root: process.env.OPENREAPER_MCP_PACKAGE_ROOT,
        }),
        product_surface: {
          agent_context_macro_guide: createAlpha3_3B1AgentContextMacroGuide(),
          agent_start_here: {
            document: OPENREAPER_AGENT_START_HERE_DOCUMENT,
            first_round: OPENREAPER_AGENT_FIRST_ROUND_FLOW,
          },
        },
      });
    },
  );

  server.tool(
    "list_templates",
    `Call with no arguments first to list all 15 executable Macros. Expand one full Macro manual with ids:["exact.macro.id"], never query by Macro id. Use surface=catalog only for direct Template fallback. Check capability truth before call_template. ${AGENT_START_HERE_HINT}`,
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
    async (request) => jsonToolResult(compactPublicTemplateDiscoveryResponse(
      attachExecutableRecipeDependencyFacts(
        runtime.list_templates(request ?? {}),
        callRecipeBinding?.catalog,
        request?.ids,
      ),
    )),
  );

  server.tool(
    "list_recipes",
    `Call once with no arguments to list official and user-saved Recipes. Expand one saved revision by exact ids; do not issue one query per official Recipe. Saved validated revisions execute automatically through one call_recipe run. ${AGENT_START_HERE_HINT}`,
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
    async (request) => {
      try {
        const recipes = loadStdioExecutableRecipeDiscovery(callRecipeBinding);
        const recipeDiscovery = createDiscoveryCatalog({ recipes });
        const response = attachAlpha3_3B1AgentContextProductMetadata(
          recipeDiscovery.list_recipes(request ?? {}),
        );
        const manual = createAlpha34BDiscoveryManualProjection({
          query: request?.query ?? null,
          requested_recipe_ids: request?.ids ?? [],
        });
        return jsonToolResult({
          ...response,
          product_surface: {
            ...(response.product_surface ?? {}),
            recipe_productization: manual.recipe_productization,
            direct_template_fallback: manual.direct_template_fallback,
          },
        });
      } catch (error) {
        return jsonToolResult({
          ok: false,
          contract: "discovery.menu.v1",
          error: {
            code: "RECIPE_DISCOVERY_UNAVAILABLE",
            message: error?.message ?? "Saved executable recipe discovery failed.",
            recoverable: true,
          },
        }, true);
      }
    },
  );

  server.tool(
    "call_template",
    `Run one accepted runtime-bound Template or registered executable Macro program. Legacy Macro ids return typed replacement guidance; contract-only guide ids are rejected and no hidden recipe executor is exposed. ${AGENT_START_HERE_HINT}`,
    {
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      params: z.record(z.unknown()).optional(),
      refs: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
      context: z.record(z.unknown()).optional(),
      budget: z.record(z.unknown()).optional(),
      idempotency_key: z.string().optional(),
      deadline_ms: z.number().int().positive().max(EXECUTION_DEADLINE_MAX_MS).optional(),
    },
    async (request, extra) => {
      let normalized;
      try {
        const context = callContext.allocate(request?.context);
        normalized = normalizeCallTemplateToolRequest(request ?? {}, context);
      } catch (error) {
        if (!(error instanceof Alpha3_2C1CallContextError)) throw error;
        return jsonToolResult(callContextErrorResult(request, error), true);
      }
      const called = await runtime.call_template(normalized, { signal: extra?.signal });
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
    `Read bounded OpenReaper state. Alpha package supports artifact reads when OPENREAPER_ARTIFACT_ROOT is configured. Use cursor/budget recovery and artifact get_state when public responses truncate; see docs/AGENT_START_HERE.md.`,
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
        user_reminder: "Use call_template with macro.project.inspect or macro.project.query for live project state; use get_state with scope=artifact only for artifact refs. Truncation is not knowledge loss: follow cursor/budget/artifact recovery in docs/AGENT_START_HERE.md.",
      }, true);
    },
  );

  server.tool(
    "call_recipe",
    `Validate, save, list, get, delete, run, or resume a saved executable recipe revision. Use get with evidence_ref for bounded evidence pages. Run accepts only complete stored identity; no inline graphs. ${AGENT_START_HERE_HINT}`,
    {
      operation: z.enum([
        "validate",
        "save",
        "list",
        "get",
        "delete",
        "run",
        "resume",
      ]),
      draft: z.record(z.unknown()).optional(),
      revision: z.union([
        z.number().int().positive(),
        z.record(z.unknown()),
      ]).optional(),
      input: z.record(z.unknown()).optional(),
      inputs: z.record(z.unknown()).optional(),
      filter: z.record(z.unknown()).optional(),
      recipe_id: z.string().optional(),
      version: z.string().optional(),
      revision_number: z.number().int().positive().optional(),
      content_hash: z.string().optional(),
      validation_result_id: z.string().optional(),
      identity: z.record(z.unknown()).optional(),
      confirm: z.boolean().optional(),
      confirmation: z.boolean().optional(),
      run_id: z.string().optional(),
      checkpoint_id: z.string().optional(),
      evidence_ref: z.string().optional(),
      limit: z.number().int().positive().optional(),
      cursor: z.string().optional().nullable(),
      budget: z.record(z.unknown()).optional(),
      deadline_ms: z.number().int().positive().max(EXECUTION_DEADLINE_MAX_MS).optional(),
      relative_path: z.string().optional(),
      saved_at: z.string().optional(),
    },
    async (request, extra) => {
      if (!boundCallRecipeRuntime) {
        return jsonToolResult({
          ok: false,
          contract: "call_recipe.runtime.v1",
          operation: request?.operation ?? null,
          error: {
            code: "STORE_ERROR",
            message: "call_recipe requires a bound executable recipe store (OPENREAPER_EXECUTABLE_RECIPE_ROOT + catalog).",
            recoverable: true,
          },
        }, true);
      }
      const result = await boundCallRecipeRuntime.call_recipe(request ?? {}, { signal: extra?.signal });
      return jsonToolResult(result, result?.ok === false);
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

export function attachExecutableRecipeDependencyFacts(response, catalog, requestedIds = []) {
  if (!response || !catalog || !Array.isArray(requestedIds) || requestedIds.length === 0) return response;
  const guide = response.product_surface?.agent_context_macro_guide;
  const expansions = guide?.requested_expansions?.items;
  if (!Array.isArray(expansions)) return response;
  return {
    ...response,
    product_surface: {
      ...response.product_surface,
      agent_context_macro_guide: {
        ...guide,
        requested_expansions: {
          ...guide.requested_expansions,
          items: expansions.map((entry) => {
            const dependency = catalog.getMacro?.(entry.id);
            return dependency ? {
              ...entry,
              executable_recipe_dependency: {
                kind: "macro",
                id: dependency.id,
                version: dependency.version,
                risk: dependency.risk,
                descriptor_hash: dependency.descriptor_hash,
                capabilities: [...dependency.capabilities],
              },
            } : entry;
          }),
        },
      },
    },
  };
}

const PUBLIC_TEMPLATE_PRODUCT_SURFACE_KEYS = Object.freeze([
  "contract",
  "surface",
  "detail_level",
  "expanded_via",
  "agent_startup_guidance",
  "agent_context_macro_guide",
  "macro_first_routing",
  "item_schema",
  "workflow_rhythm",
  "startup_preflight",
  "blocker_guidance",
]);

export function compactPublicTemplateDiscoveryResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const surface = response.product_surface;
  if (!surface || typeof surface !== "object" || Array.isArray(surface)) return response;

  const productSurface = {};
  for (const key of PUBLIC_TEMPLATE_PRODUCT_SURFACE_KEYS) {
    if (Object.hasOwn(surface, key)) productSurface[key] = surface[key];
  }
  productSurface.projection = "agent_compact_v1";
  productSurface.expanded_detail_fields = response.mode === "ids"
    ? ["agent_context_macro_guide.requested_expansions"]
    : [];

  if (response.mode === "ids") {
    productSurface.agent_context_macro_guide = compactExactMacroGuide(
      surface.agent_context_macro_guide,
    );
  }

  return {
    ...response,
    product_surface: productSurface,
  };
}

function compactExactMacroGuide(guide) {
  if (!guide || typeof guide !== "object" || Array.isArray(guide)) return guide;
  const {
    contract,
    version,
    phase,
    tool_surface,
    requested_expansions,
    direct_template_fallback,
    safety_boundary,
  } = guide;
  return {
    contract,
    version,
    phase,
    tool_surface,
    requested_expansions,
    direct_template_fallback,
    safety_boundary,
  };
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

export function createStdioCallRecipeRuntime({ env, callTemplateRuntime, artifactRuntime, callContext, liveBridge }) {
  const root = typeof env.OPENREAPER_EXECUTABLE_RECIPE_ROOT === "string"
    ? env.OPENREAPER_EXECUTABLE_RECIPE_ROOT.trim()
    : "";
  if (!root) return null;
  let catalog;
  try {
    catalog = createExecutableRecipeProductCatalog();
  } catch {
    return null;
  }
  try {
    const source = env.OPENREAPER_EXECUTABLE_RECIPE_SOURCE || "user";
    const userStore = createExecutableRecipeRevisionStore({
      root,
      source,
      catalog,
      officialRecipeIds: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
    });
    const officialRoot = typeof env.OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT === "string"
      && env.OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT.trim() !== ""
      ? env.OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT.trim()
      : `${root}.official`;
    const officialStore = createExecutableRecipeRevisionStore({
      root: officialRoot,
      source: "official",
      catalog,
    });
    if (userStore.root === officialStore.root) return null;
    seedAlpha345OfficialExecutableRecipeRevisions(officialStore, { catalog });
    const store = createAlpha345CombinedExecutableRecipeStore({ userStore, officialStore, catalog });
    const dispatchers = createStdioRecipeDispatchers({
      callTemplateRuntime,
      artifactRuntime,
      callContext,
    });
    const undoController = createStdioRecipeUndoController({ liveBridge, callContext });
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      dispatchers,
      undoController,
      runtimeFactsProvider: createAuthoritativeRuntimeFactsProvider({
        catalog,
        projectInventoryProvider: () => readFreshOpenProjectInventory({
          callTemplateRuntime,
          callContext,
        }),
        bridgeLivenessProvider: async () => {
          if (typeof liveBridge?.executor?.probeLiveness !== "function") {
            throw new Error("Live Bridge liveness probe is not configured.");
          }
          return liveBridge.executor.probeLiveness();
        },
        riskGrantProvider: createConfiguredRiskGrantProvider(env),
        checkpointEvidenceProvider: createStoredCheckpointEvidenceProvider({ store, catalog }),
      }),
    });
    return Object.freeze({ runtime, catalog });
  } catch {
    return null;
  }
}

function createStdioRecipeDispatchers({ callTemplateRuntime, artifactRuntime, callContext }) {
  const callTemplateStage = async ({ stage, inputs, refs, recipe_undo, signal, deadline, performance }) => {
    if (typeof callTemplateRuntime?.call_template !== "function" || typeof callContext?.allocate !== "function") {
      throw new Error("Recipe Macro/Template stage runtime is not configured.");
    }
    const request = {
      id: stage.dependency?.id,
      input: inputs,
      ...(refs == null ? {} : { refs }),
      context: callContext.allocate(),
      budget: CALL_RECIPE_STAGE_BUDGET,
    };
    request[CALL_TEMPLATE_INTERNAL_DISPATCH_TIMEOUT] = CALL_RECIPE_STAGE_DISPATCH_TIMEOUT_MS;
    if (recipe_undo?.suppress_child_undo === true) {
      request[CALL_TEMPLATE_INTERNAL_RECIPE_UNDO] = recipe_undo;
    }
    return callTemplateRuntime.call_template(request, {
      signal,
      deadline,
      performance,
      dispatchTimeoutMs: CALL_RECIPE_STAGE_DISPATCH_TIMEOUT_MS,
    });
  };
  return {
    macro: callTemplateStage,
    template: callTemplateStage,
    get_state: typeof artifactRuntime?.get_state === "function"
      ? async ({ inputs }) => artifactRuntime.get_state({
          ...inputs,
          budget: { max_response_bytes: CALL_RECIPE_STAGE_BUDGET.max_response_bytes },
        })
      : null,
    checkpoint: async ({ stage, revision }) => {
      const declaration = revision.draft?.checkpoints?.find((item) => (
        item.id === stage.checkpoint && item.after_stage === stage.id
      ));
      if (!declaration) throw new Error("Recipe checkpoint declaration is unavailable.");
      return {
        contract: CALL_RECIPE_CHECKPOINT_PROOF_CONTRACT,
        ok: true,
        verified: true,
        checkpoint_id: declaration.id,
        stage_id: stage.id,
        evidence_id: declaration.evidence_id,
        resume_identity: declaration.resume_identity,
        recipe_id: revision.recipe_id,
        version: revision.version,
        revision: revision.revision,
        content_hash: revision.content_hash,
        summary: "Server-owned executable recipe checkpoint proof.",
        outputs: {},
      };
    },
  };
}

export function createStdioRecipeUndoController({ liveBridge, callContext }) {
  const dispatch = liveBridge?.executor?.dispatch;
  const allocate = callContext?.allocate;
  const transactionTimeoutMs = 60_000;

  async function send(operation, request, { retry = 0 } = {}) {
    if (typeof dispatch !== "function" || typeof allocate !== "function") {
      throw new Error("Live Bridge Recipe Undo transaction is not configured.");
    }
    const context = allocate.call(callContext);
    const handle = operation === "begin"
      ? `${request.run_id}:attempt:${request.attempt}`
      : request.handle;
    const bridgeRequest = normalizeFoundationBridgeRequest({
      contract: FOUNDATION_BRIDGE_CONTRACT,
      id: recipeUndoBridgeRequestId(context, operation),
      created_at: context.created_at,
      client: { id: context.client_id, session_id: context.session_id },
      bridge: {
        expected_owner: context.expected_owner,
        expected_generation: context.expected_generation,
      },
      operation: { family: "run_command", name: "recipe.undo.transaction" },
      pack: { id: "core", capability: "recipe.undo.transaction", risk: "write" },
      params: {
        action: operation,
        transaction_id: handle,
        project_ref: request.project_ref,
        label: request.label,
        ...(operation === "end" ? { mutation_truth: request.mutation_truth } : {}),
      },
      refs: [],
      undo: { mode: "required", label: request.label, flags: ["recipe_transaction_control"] },
      verification: {
        mode: "required",
        checks: ["recipe_transaction_state", "active_project_identity"],
      },
      artifacts: { allow: false },
      budget: { max_response_bytes: 16_384, max_items: 8, max_inline_value_bytes: 2_048 },
      idempotency_key: `recipe-undo:${operation}:${handle}${retry > 0 ? `:retry:${retry}` : ""}`,
      timeout_ms: transactionTimeoutMs,
    });
    const result = await dispatch.call(liveBridge.executor, bridgeRequest);
    validateFoundationBridgeResult(result);
    const summary = result?.result?.summary;
    if (result.ok !== true) {
      throw recipeUndoControllerError(result, {
        operation,
        handle,
        projectRef: request.project_ref,
        expectedOwner: context.expected_owner,
        expectedGeneration: context.expected_generation,
      });
    }
    if (summary?.transaction_id !== handle || summary?.project_ref !== request.project_ref) {
      const error = new Error(`Recipe Undo ${operation} returned no exact transaction proof.`);
      error.code = "VERIFY_FAILED";
      error.outcome = "unknown";
      error.reconciliation_required = operation !== "end";
      error.handle = handle;
      throw error;
    }
    return { result, summary, handle };
  }

  async function reconcileNotRun(error, request) {
    const active = error?.details?.active_transaction;
    if (!provenNotRunRecipeUndoConflict(error, request)) throw error;
    try {
      const reconciled = await send("reconcile_not_run", {
        handle: active.transaction_id,
        project_ref: active.project_ref,
        label: active.label,
      });
      if (reconciled.summary.closed !== true || reconciled.summary.verified !== true) {
        const reconcileError = new Error("Recipe Undo reconcile_not_run returned no exact close proof.");
        reconcileError.code = "VERIFY_FAILED";
        reconcileError.outcome = "unknown";
        reconcileError.reconciliation_required = true;
        reconcileError.handle = active.transaction_id;
        throw reconcileError;
      }
      return reconciled;
    } catch (reconcileError) {
      reconcileError.reconciliation_required = true;
      reconcileError.outcome = "unknown";
      reconcileError.handle ??= active.transaction_id;
      throw reconcileError;
    }
  }

  return Object.freeze({
    async begin(request) {
      let opened;
      const evidenceRefs = [];
      try {
        opened = await send("begin", request);
      } catch (error) {
        const reconciled = await reconcileNotRun(error, request);
        evidenceRefs.push(`bridge:${reconciled.result.id}`);
        opened = await send("begin", request, { retry: 1 });
      }
      const { result, summary, handle } = opened;
      return {
        ok: summary.opened === true && summary.verified === true,
        opened: summary.opened === true,
        handle,
        project_ref: request.project_ref,
        evidence_refs: [...evidenceRefs, `bridge:${result.id}`],
      };
    },
    async end(request) {
      const { result, summary, handle } = await send("end", request);
      return {
        ok: summary.closed === true && summary.verified === true,
        closed: summary.closed === true,
        verified: summary.verified === true,
        handle,
        project_ref: request.project_ref,
        evidence_refs: [`bridge:${result.id}`],
      };
    },
  });
}

function recipeUndoControllerError(result, {
  operation,
  handle,
  projectRef,
  expectedOwner,
  expectedGeneration,
}) {
  const error = new Error(result?.error?.message ?? `Recipe Undo ${operation} failed.`);
  error.code = result?.error?.code ?? "INTERNAL_ERROR";
  error.details = result?.error?.details ?? {};
  error.outcome = result?.error?.details?.outcome
    ?? (error.code === "BRIDGE_TIMEOUT" ? "unknown" : null);
  error.reconciliation_required = error.outcome === "unknown"
    || error.code === "QUEUE_CONFLICT"
    || operation === "reconcile_not_run";
  error.handle = handle;
  error.project_ref = projectRef;
  error.bridge = result?.bridge ?? null;
  error.expected_owner = expectedOwner;
  error.expected_generation = expectedGeneration;
  return error;
}

function provenNotRunRecipeUndoConflict(error, request) {
  const active = error?.details?.active_transaction;
  return error?.code === "QUEUE_CONFLICT"
    && error?.details?.outcome === "not_run"
    && active != null
    && typeof active === "object"
    && typeof active.transaction_id === "string"
    && active.transaction_id !== ""
    && active.project_ref === request.project_ref
    && typeof active.label === "string"
    && active.label !== ""
    && active.owner === error?.bridge?.owner
    && active.generation === error?.bridge?.generation
    && active.owner === error?.expected_owner
    && active.generation === error?.expected_generation
    && active.active_project_matches === true
    && active.mutation_may_have_happened === false
    && active.close_outcome_unknown !== true;
}

function recipeUndoBridgeRequestId(context, operation) {
  const session = String(context.session_id).replace(/[^A-Za-z0-9_]/gu, "_").slice(-48);
  return `cmd_recipe_undo_${operation}_${context.request_sequence}_${session}`;
}

function createConfiguredRiskGrantProvider(env) {
  let policy = null;
  try {
    policy = JSON.parse(env.OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON ?? "null");
  } catch {}
  return async ({ identity, declared_risk_grants }) => {
    let grants = Array.isArray(policy) ? policy : null;
    if (policy && !Array.isArray(policy) && typeof policy === "object") {
      const exactKey = `${identity.recipe_id}@${identity.version}#${identity.revision}:${identity.content_hash}`;
      grants = policy[exactKey]
        ?? policy[identity.content_hash]
        ?? policy[identity.recipe_id]
        ?? policy.default
        ?? null;
    }
    if (
      !Array.isArray(grants)
      || grants.length === 0
      || grants.some((item) => typeof item !== "string" || item.length === 0)
    ) {
      throw new Error("Server-owned executable recipe risk grants are not configured for this revision.");
    }
    if (
      !Array.isArray(declared_risk_grants)
      || declared_risk_grants.length === 0
      || declared_risk_grants.some((item) => typeof item !== "string" || !grants.includes(item))
    ) {
      throw new Error("Executable recipe requests risk grants outside the server-owned policy.");
    }
    return [...new Set(declared_risk_grants)];
  };
}

function createStoredCheckpointEvidenceProvider({ store, catalog }) {
  return async ({ identity }) => {
    const loaded = store.get({
      recipe_id: identity.recipe_id,
      version: identity.version,
      revision: identity.revision,
      content_hash: identity.content_hash,
    });
    const revision = loaded.payload ?? loaded;
    const contentHash = hashExecutableRecipeContent(revision.draft, { catalog });
    return (revision.draft?.checkpoints ?? []).map((checkpoint) => ({
      checkpoint_id: checkpoint.id,
      evidence_id: checkpoint.evidence_id,
      resume_identity: checkpoint.resume_identity,
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: contentHash,
    }));
  };
}

export async function readFreshOpenProjectInventory({ callTemplateRuntime, callContext }) {
  if (typeof callTemplateRuntime?.call_template !== "function" || typeof callContext?.allocate !== "function") {
    throw new Error("Native project inventory runtime is not configured.");
  }
  const projects = [];
  const projectRefs = new Set();
  let cursor = "0";
  let declaredTotal = null;
  for (let pageIndex = 0; pageIndex < 64; pageIndex += 1) {
    const execution = await callTemplateRuntime.call_template({
      id: "template.project.list_open_projects",
      input: { cursor, limit: 100 },
      context: callContext.allocate(),
      budget: {
        max_response_bytes: 65_536,
        max_inline_value_bytes: 8_192,
        max_items: 100,
      },
    });
    if (execution?.ok !== true) {
      throw new Error(`Native open-project inventory failed: ${execution?.error?.code ?? "unknown"}.`);
    }
    if (
      execution.contract !== "template.execution.v1"
      || execution.template?.id !== "template.project.list_open_projects"
      || execution.verification?.status !== "passed"
    ) {
      throw new Error("Native open-project inventory lacked the exact verified Template execution identity.");
    }
    const page = execution.result?.summary;
    if (!page || typeof page !== "object" || !Array.isArray(page.projects)) {
      throw new Error("Native open-project inventory returned no canonical project rows.");
    }
    if (
      page.readback_status !== "passed"
      || page.live_materialization !== "native_enum_projects_verified"
    ) {
      throw new Error("Native open-project inventory lacked native EnumProjects readback proof.");
    }
    if (
      !Number.isInteger(page.total_count)
      || page.total_count < 1
      || !Number.isInteger(page.returned_count)
      || page.returned_count !== page.projects.length
      || page.returned_count > page.total_count
      || String(page.cursor) !== cursor
      || (declaredTotal !== null && page.total_count !== declaredTotal)
    ) {
      throw new Error("Native open-project inventory page counts or cursor are contradictory.");
    }
    for (const project of page.projects) {
      const projectRef = project?.project_ref;
      if (!isCanonicalProjectRef(projectRef) || projectRefs.has(projectRef)) {
        throw new Error("Native open-project inventory contains an invalid or duplicate project ref.");
      }
      projectRefs.add(projectRef);
    }
    declaredTotal = page.total_count;
    projects.push(...page.projects);
    if (page.coverage_status === "complete") {
      if (projects.length !== declaredTotal || page.next_cursor != null) {
        throw new Error("Native open-project terminal page is incomplete.");
      }
      if (projects.filter((project) => project?.active === true).length !== 1) {
        throw new Error("Native open-project inventory must contain exactly one active project.");
      }
      return {
        projects,
        total_count: declaredTotal,
        returned_count: projects.length,
        coverage_status: "complete",
      };
    }
    if (
      page.coverage_status !== "paged"
      || typeof page.next_cursor !== "string"
      || !/^\d+$/u.test(page.next_cursor)
      || Number(page.next_cursor) !== projects.length
      || page.next_cursor === cursor
    ) {
      throw new Error("Native open-project inventory pagination did not advance exactly.");
    }
    cursor = page.next_cursor;
  }
  throw new Error("Native open-project inventory exceeded the bounded 64-page hydration limit.");
}

function isCanonicalProjectRef(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  return ["project:path:", "project:tab:"].some((prefix) => (
    value.startsWith(prefix) && value.length > prefix.length
  ));
}

function loadStdioExecutableRecipeDiscovery(binding) {
  if (!binding?.runtime?.store) return [];
  const listed = binding.runtime.store.list();
  const latestByRecipeId = new Map();
  for (const item of listed.items ?? []) {
    const revision = item.payload ?? item;
    const previous = latestByRecipeId.get(revision.recipe_id);
    const executableIdentity = {
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
    };
    if (
      previous
      && compareExecutableRecipeDiscoveryIdentity(previous.executable_identity, executableIdentity) >= 0
    ) continue;
    const manual = item.source === "official"
      ? createAlpha345OfficialRecipeManual(revision.recipe_id)
      : null;
    latestByRecipeId.set(revision.recipe_id, {
      ...executableRevisionDiscoveryProjection(revision, { catalog: binding.catalog }),
      ...createExecutableRecipeDiscoveryDetails(revision, manual),
      kind: "recipe",
      executable: true,
      source: item.source ?? "user",
      executable_identity: executableIdentity,
    });
  }
  return [...latestByRecipeId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function createExecutableRecipeDiscoveryDetails(revision, manual = null) {
  return {
    steps: revision.draft.stages.map((stage) => ({
      id: stage.id,
      kind: stage.kind,
      dependency: stage.dependency,
      inputs: stage.inputs,
      outputs: stage.outputs,
      risk: stage.risk,
      checkpoint: stage.checkpoint,
    })),
    assertions: {
      required_inputs: manual?.required_inputs
        ?? revision.draft.inputs.filter((input) => input.required === true).map((input) => input.id),
      required_outputs: revision.draft.outputs.filter((output) => output.required === true).map((output) => output.id),
      preflight: revision.draft.preflight,
      safety: manual?.safety ?? "Run only the exact saved immutable revision after fresh trust and whole-graph preflight pass.",
      undo: manual?.undo ?? "Use the returned whole-Recipe Undo and recovery truth; never infer rollback from stage success.",
    },
    recovery: manual?.recovery
      ?? "Follow the returned evidence and exact next_call. Resume only when resume_safe is true; never replay completed or unverified stages.",
  };
}

function compareExecutableRecipeDiscoveryIdentity(left, right) {
  if (left.revision !== right.revision) return left.revision < right.revision ? -1 : 1;
  for (const field of ["version", "content_hash", "validation_result_id"]) {
    if (left[field] === right[field]) continue;
    return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[openreaper-mcp] fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}

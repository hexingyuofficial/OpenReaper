#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CapabilityRegistry, parseEnabledPacks } from "@streetlight/core";
import { FileQueueClient, resolveQueueDir } from "./transport/file-queue.js";
import { ping } from "./tools/ping.js";
import {
  getState,
  GetStateInclude,
  GetStateArtifactView,
  GetStateScope,
  DEFAULT_GET_STATE_LIMIT,
  MAX_GET_STATE_LIMIT,
  MIN_GET_STATE_LIMIT,
} from "./tools/get-state.js";
import { callTemplate } from "./tools/call-template.js";
import { listTemplates } from "./tools/list-templates.js";
import { listRecipes } from "./tools/list-recipes.js";
import { registerEnabledTemplates } from "./templates/index.js";
import { z } from "zod";

async function main(): Promise<void> {
  const queueDir = resolveQueueDir();
  const client = new FileQueueClient({ queueDir });
  await client.init();

  const registry = new CapabilityRegistry();
  const enabledPacks = parseEnabledPacks(process.env.STREETLIGHT_ENABLED_PACKS);
  registerEnabledTemplates(registry, enabledPacks);

  process.stderr.write(
    `[streetlight-mcp] queue=${queueDir}\n[streetlight-mcp] enabled_packs=${enabledPacks.join(",")}\n[streetlight-mcp] v0.1 kernel — ping + get_state + list_templates + list_recipes + call_template (${registry.size()} templates)\n`,
  );

  const server = new McpServer({
    name: "streetlight",
    version: "0.1.0",
  });

  server.tool(
    "ping",
    "Check whether the Streetlight bridge inside REAPER is reachable. Returns the REAPER version on success.",
    {},
    async () => {
      const result = await ping(client);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  server.tool(
    "get_state",
    'Read a scoped subset of the REAPER project or OpenReaper state. Implemented scopes: "selection", "project", "tracks", "regions", "artifact"; "render" is reserved and returns SCOPE_NOT_IMPLEMENTED. `include:["fx"]` is valid only with scope="tracks" and adds track FX metadata. `scope:"artifact"` requires `artifact_ref` and supports `view:"summary"|"payload"`. `limit` (default 50, max 200) bounds list responses; the bridge also enforces an item-boundary byte cap and returns RESPONSE_TOO_LARGE if a single descriptor exceeds it. See docs/RESPONSE_BUDGET.md.',
    {
      scope: GetStateScope.optional(),
      limit: z
        .number()
        .int()
        .min(MIN_GET_STATE_LIMIT)
        .max(MAX_GET_STATE_LIMIT)
        .optional(),
      include: z.array(GetStateInclude).optional(),
      artifact_ref: z.string().min(1).optional(),
      view: GetStateArtifactView.optional(),
    },
    async ({ scope, limit, include, artifact_ref, view }) => {
      const result = await getState(client, {
        scope: scope ?? "selection",
        limit: limit ?? DEFAULT_GET_STATE_LIMIT,
        include,
        artifact_ref,
        view,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  server.tool(
    "list_templates",
    "List every registered Streetlight template with its metadata and JSON Schemas (risk, mutates, undoable, idempotent, params_schema, result_schema). Does NOT touch the REAPER bridge — the registry is in-process. Use this to discover what call_template accepts before invoking it.",
    {},
    async () => {
      const result = listTemplates(registry);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  server.tool(
    "list_recipes",
    "List Streetlight recipes (YAML workflow guides agents follow). Re-reads recipes/*.yaml on every call (no caching). Recipes are agent-readable docs, NOT server-executed — the agent orchestrates each step itself via call_template. Bad YAML files are skipped and surface in result.warnings[]; the tool only fails on infrastructure errors. Override the directory with STREETLIGHT_RECIPES_DIR env var.",
    {},
    async () => {
      const result = await listRecipes();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  server.tool(
    "call_template",
    "Run a registered Streetlight template against the REAPER project. Returns a locked envelope { template, changed_count, changed_ids, truncated } — never raw item descriptors, even for single-item changes (read post-state via get_state). Optional idempotency_key lets a caller safely retry the same logical mutation or render within the current bridge lifetime. On BRIDGE_NOT_RUNNING without an idempotency_key, a mutating template may STILL have applied, so do NOT auto-retry — call get_state to inspect actual state. See docs/TEMPLATE_SPEC.md § Idempotency and docs/RESPONSE_BUDGET.md § call_template.",
    {
      name: z.string().min(1),
      params: z.record(z.unknown()).optional(),
      idempotency_key: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\x20-\x7e]+$/, "ASCII printable only, no control bytes")
        .optional(),
    },
    async ({ name, params, idempotency_key }) => {
      const result = await callTemplate(client, registry, {
        name,
        params,
        idempotency_key,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[streetlight-mcp] stdio server ready\n`);
}

main().catch((e) => {
  process.stderr.write(
    `[streetlight-mcp] fatal: ${e instanceof Error ? e.stack : String(e)}\n`,
  );
  process.exit(1);
});

#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileQueueClient, resolveQueueDir } from "./transport/file-queue.js";
import { ping } from "./tools/ping.js";
import {
  getState,
  GetStateScope,
  DEFAULT_GET_STATE_LIMIT,
  MAX_GET_STATE_LIMIT,
  MIN_GET_STATE_LIMIT,
} from "./tools/get-state.js";
import { z } from "zod";

async function main(): Promise<void> {
  const queueDir = resolveQueueDir();
  const client = new FileQueueClient({ queueDir });
  await client.init();

  process.stderr.write(
    `[streetlight-mcp] queue=${queueDir}\n[streetlight-mcp] step 2 — ping + get_state\n`,
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
    'Read a scoped subset of the REAPER project. v0.1 only implements scope="selection"; other scopes (project, tracks, regions, render) return SCOPE_NOT_IMPLEMENTED. `limit` (default 50, max 200) bounds list responses; the bridge also enforces an item-boundary byte cap and returns RESPONSE_TOO_LARGE if a single item exceeds it. See docs/RESPONSE_BUDGET.md.',
    {
      scope: GetStateScope.optional(),
      limit: z
        .number()
        .int()
        .min(MIN_GET_STATE_LIMIT)
        .max(MAX_GET_STATE_LIMIT)
        .optional(),
    },
    async ({ scope, limit }) => {
      const result = await getState(client, {
        scope: scope ?? "selection",
        limit: limit ?? DEFAULT_GET_STATE_LIMIT,
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

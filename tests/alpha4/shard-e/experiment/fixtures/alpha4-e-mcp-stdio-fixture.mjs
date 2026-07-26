#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const TOOLS = ["ping", "get_state", "list_templates", "list_recipes", "call_template", "call_recipe"];
const server = new Server(
  { name: "openreaper-alpha4-e-mcp-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((name) => ({ name, description: "Alpha4 E stdio fixture tool", inputSchema: { type: "object" } })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: JSON.stringify(fixtureResponse(request.params.name, request.params.arguments ?? {})) }],
}));

function fixtureResponse(tool, arguments_) {
  if (tool === "ping") {
    return {
      ok: true,
      product: "OpenReaper",
      live_bridge: { observed: { owner: "fixture-owner", generation: 1 } },
      project_index: { project_ref: "project:fixture", bridge_owner: "fixture-owner", bridge_generation: 1 },
    };
  }
  if (tool === "call_recipe" && arguments_.operation === "run") {
    return {
      contract: "recipe.executable.run.v1",
      ok: true,
      operation: "run",
      status: "succeeded",
      recipe_id: arguments_.recipe_id,
      version: arguments_.version,
      revision: arguments_.revision,
      content_hash: arguments_.content_hash,
      validation_result_id: arguments_.validation_result_id,
      run_id: "run:fixture",
      verified_outputs: [{ id: "fixture_readback", verified: true, value: { status: "passed" } }],
      execution_truth: {
        mutation: "applied_verified",
        counter_scope: "recipe_stage_dispatch_and_accepted_native_proof",
        counter_source: "call_recipe_runtime",
        transport_call_count: 1,
        native_mutation_count: 1,
        readback_count: 1,
      },
      undo: {
        scope: "whole_recipe",
        binding: "bound",
        status: "closed",
        claimed: true,
        proven: true,
        opened: true,
        closed: true,
        project_ref: "project:fixture",
        rollback_attempted: false,
        rollback_proven: false,
      },
    };
  }
  if (tool === "get_state") {
    return { ok: false, contract: "get_state.runtime.v1", error: { code: "SCOPE_NOT_BOUND_IN_ALPHA_STDIO" } };
  }
  return { ok: true, tool, arguments: arguments_ };
}

await server.connect(new StdioServerTransport());

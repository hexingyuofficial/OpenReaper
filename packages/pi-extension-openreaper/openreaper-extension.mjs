/**
 * Native OpenReaper Studio tools for private Pi (`registerTool`).
 *
 * Loaded with `pi --no-builtin-tools --no-extensions --extension <this file>`.
 * Talks to the REAPER Bridge via the kernel file queue — not MCP stdio,
 * not mcp.json.
 *
 * Permissions: may read other .rpp; may create projects / import-place audio;
 * MUST NOT rename or move original audio asset files.
 */

import {
  TOOL_NAMES,
  executePing,
  executeGetState,
  executeListTemplates,
  executeListRecipes,
  executeCallTemplate,
} from "./tools.mjs";

export { TOOL_NAMES };
export const OPENREAPER_PING_TOOL_NAME = TOOL_NAMES.ping;

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

async function typebox() {
  try {
    const mod = await import("typebox");
    return mod.Type ?? mod.default?.Type ?? null;
  } catch {
    return null;
  }
}

async function schemas() {
  const Type = await typebox();
  if (Type?.Object && Type?.String && Type?.Number && Type?.Optional) {
    return {
      ping: Type.Object({}),
      getState: Type.Object({
        scope: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number()),
        include: Type.Optional(Type.Array(Type.String())),
        artifact_ref: Type.Optional(Type.String()),
        view: Type.Optional(Type.String()),
      }),
      list: Type.Object({}),
      callTemplate: Type.Object({
        name: Type.String(),
        params: Type.Optional(Type.Object({}, { additionalProperties: true })),
        idempotency_key: Type.Optional(Type.String()),
      }),
    };
  }
  return {
    ping: EMPTY_OBJECT_SCHEMA,
    getState: {
      type: "object",
      properties: {
        scope: { type: "string" },
        limit: { type: "number" },
        include: { type: "array", items: { type: "string" } },
        artifact_ref: { type: "string" },
        view: { type: "string" },
      },
      additionalProperties: false,
    },
    list: EMPTY_OBJECT_SCHEMA,
    callTemplate: {
      type: "object",
      properties: {
        name: { type: "string" },
        params: { type: "object" },
        idempotency_key: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  };
}

export async function createOpenReaperExtension(pi) {
  const s = await schemas();
  pi.registerTool({
    name: TOOL_NAMES.ping,
    label: "OpenReaper Ping",
    description:
      "Ping the OpenReaper Bridge inside REAPER (file queue). Fails clearly if REAPER/Bridge is down. Not MCP stdio.",
    parameters: s.ping,
    execute: executePing,
  });
  pi.registerTool({
    name: TOOL_NAMES.getState,
    label: "OpenReaper Get State",
    description:
      "Read a scoped subset of the REAPER project (selection, project, tracks, regions, artifact). Fails if Bridge is down.",
    parameters: s.getState,
    execute: executeGetState,
  });
  pi.registerTool({
    name: TOOL_NAMES.listTemplates,
    label: "OpenReaper List Templates",
    description: "List registered OpenReaper templates (in-process registry; no Bridge round-trip).",
    parameters: s.list,
    execute: executeListTemplates,
  });
  pi.registerTool({
    name: TOOL_NAMES.listRecipes,
    label: "OpenReaper List Recipes",
    description: "List OpenReaper recipes from disk (agent-readable guides, not executed by the server).",
    parameters: s.list,
    execute: executeListRecipes,
  });
  pi.registerTool({
    name: TOOL_NAMES.callTemplate,
    label: "OpenReaper Call Template",
    description:
      "Run a registered OpenReaper template against the current REAPER project. Will not rename or move original audio asset files.",
    parameters: s.callTemplate,
    execute: executeCallTemplate,
  });
}

export default createOpenReaperExtension;

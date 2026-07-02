export const TOOL_ABI_V1_TOOLS = Object.freeze([
  Object.freeze({
    name: "ping",
    description: "Check whether the MCP server and REAPER runtime are reachable.",
  }),
  Object.freeze({
    name: "get_state",
    description: "Read bounded OpenReaper or REAPER state projections.",
  }),
  Object.freeze({
    name: "list_templates",
    description: "List templates callable through call_template.",
  }),
  Object.freeze({
    name: "list_recipes",
    description: "List workflow contracts agents can execute step by step.",
  }),
  Object.freeze({
    name: "call_template",
    description: "Run one verified template action.",
  }),
]);

export const TOOL_ABI_V1_TOOL_NAMES = Object.freeze(
  TOOL_ABI_V1_TOOLS.map((tool) => tool.name),
);

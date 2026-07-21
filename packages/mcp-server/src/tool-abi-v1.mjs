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
    description: "List workflow contracts and saved executable recipe revisions.",
  }),
  Object.freeze({
    name: "call_template",
    description: "Run one verified template action.",
  }),
  Object.freeze({
    name: "call_recipe",
    description: "Validate, save, list, get, delete, run, or resume a saved executable recipe revision.",
  }),
]);

export const TOOL_ABI_V1_TOOL_NAMES = Object.freeze(
  TOOL_ABI_V1_TOOLS.map((tool) => tool.name),
);

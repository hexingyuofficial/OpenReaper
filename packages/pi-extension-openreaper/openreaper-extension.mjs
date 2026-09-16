/**
 * Native OpenReaper Studio tools for private Pi (`registerTool`).
 *
 * Product path: this extension, loaded with `pi --no-builtin-tools --no-extensions
 * --extension <this file>`. Not a user-visible MCP stdio process.
 *
 * P2: replace the stub execute() with the existing file-queue ping / get_state /
 * call_template against the live REAPER bridge. Keep that call inside this
 * process (or the steward). Do not teach users to start `streetlight-mcp`.
 *
 * Permissions (P2): may read other .rpp; may create projects / import-place
 * audio; MUST NOT rename or move original audio asset files.
 */

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const OPENREAPER_PING_TOOL_NAME = "openreaper_ping";

async function emptyParamsSchema() {
  try {
    const mod = await import("typebox");
    const Type = mod.Type ?? mod.default?.Type;
    if (Type?.Object) {
      return Type.Object({});
    }
  } catch {
    /* Pi always provides typebox; tests and hosts without it use JSON Schema. */
  }
  return EMPTY_OBJECT_SCHEMA;
}

export async function createOpenReaperExtension(pi) {
  const parameters = await emptyParamsSchema();
  pi.registerTool({
    name: OPENREAPER_PING_TOOL_NAME,
    label: "OpenReaper Ping",
    description:
      "Confirm the OpenReaper Studio native extension is loaded. Bridge ping via the REAPER file queue lands in P2 — this is not MCP stdio.",
    parameters,
    async execute() {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              tool: OPENREAPER_PING_TOOL_NAME,
              source: "openreaper-pi-extension",
              bridge: "not_wired",
              note: "Native Studio tool stub. File-queue ping is P2; do not start MCP stdio.",
            }),
          },
        ],
        details: { source: "openreaper-pi-extension" },
      };
    },
  });
}

export default createOpenReaperExtension;

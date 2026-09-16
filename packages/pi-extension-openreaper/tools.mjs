import { getBridgeClient } from "./kernel.mjs";

export const TOOL_NAMES = Object.freeze({
  ping: "openreaper_ping",
  getState: "openreaper_get_state",
  listTemplates: "openreaper_list_templates",
  listRecipes: "openreaper_list_recipes",
  callTemplate: "openreaper_call_template",
});

const AUDIO_ASSET_MUTATION_KEYS = [
  "rename_source",
  "move_source",
  "delete_source",
  "source_rename",
  "source_move",
  "rename_file",
  "move_file",
];

export function denyAudioAssetFileMutation(input) {
  const params =
    input?.params && typeof input.params === "object" && !Array.isArray(input.params)
      ? input.params
      : {};
  for (const key of AUDIO_ASSET_MUTATION_KEYS) {
    if (params[key]) {
      return {
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message:
            "OpenReaper Studio must not rename or move original audio asset files.",
          recoverable: false,
        },
      };
    }
  }
  return null;
}

function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: { source: "openreaper-pi-extension" },
    ...(isError ? { details: { source: "openreaper-pi-extension", isError: true } } : {}),
  };
}

function fromKernelResult(result) {
  const isError = result?.ok === false;
  return toolResult(result, { isError });
}

async function withBridge(run) {
  try {
    const ctx = await getBridgeClient();
    const client =
      ctx.client ?? (typeof ctx.getClient === "function" ? await ctx.getClient() : null);
    return await run({ ...ctx, client });
  } catch (error) {
    const message = String(error?.message ?? error);
    const bridgeDown =
      /BRIDGE_NOT_RUNNING|ENOENT|queue|timeout/i.test(message) &&
      !/kernel failed to load/i.test(message);
    return toolResult(
      {
        ok: false,
        error: {
          code: bridgeDown ? "BRIDGE_NOT_RUNNING" : "INTERNAL_ERROR",
          message: bridgeDown
            ? `OpenReaper Bridge is down: ${message}`
            : `OpenReaper kernel failed to load: ${message}`,
          recoverable: true,
        },
      },
      { isError: true },
    );
  }
}

export async function executePing(_id, _params, options = {}) {
  return withBridge(async ({ client, kernel }) => {
    const result = await kernel.ping(client, options.timeoutMs ?? 5000);
    return fromKernelResult(result);
  });
}

export async function executeGetState(_id, params = {}, options = {}) {
  return withBridge(async ({ client, kernel }) => {
    const result = await kernel.getState(client, params ?? {}, options.timeoutMs ?? 5000);
    return fromKernelResult(result);
  });
}

export async function executeListTemplates() {
  return withBridge(async ({ registry, kernel }) => {
    return fromKernelResult(kernel.listTemplates(registry));
  });
}

export async function executeListRecipes() {
  return withBridge(async ({ kernel }) => {
    return fromKernelResult(await kernel.listRecipes());
  });
}

export async function executeCallTemplate(_id, params = {}, options = {}) {
  const denied = denyAudioAssetFileMutation(params);
  if (denied) {
    return fromKernelResult(denied);
  }
  return withBridge(async ({ client, registry, kernel }) => {
    const result = await kernel.callTemplate(client, registry, params ?? {}, options.timeoutMs);
    return fromKernelResult(result);
  });
}

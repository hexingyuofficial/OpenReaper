import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(here, "..", "mcp-server");

function importUrl(srcRel, distRel) {
  const dist = path.join(mcpRoot, distRel);
  if (existsSync(dist)) {
    return pathToFileURL(dist).href;
  }
  return pathToFileURL(path.join(mcpRoot, srcRel)).href;
}

let cached = null;
let clientCache = null;

function assembleKernel(mods) {
  const [
    queueMod,
    pingMod,
    getStateMod,
    callTemplateMod,
    listTemplatesMod,
    listRecipesMod,
    templatesMod,
    coreMod,
  ] = mods;
  return {
    FileQueueClient: queueMod.FileQueueClient,
    resolveQueueDir: queueMod.resolveQueueDir,
    ping: pingMod.ping,
    getState: getStateMod.getState,
    callTemplate: callTemplateMod.callTemplate,
    listTemplates: listTemplatesMod.listTemplates,
    listRecipes: listRecipesMod.listRecipes,
    registerEnabledTemplates: templatesMod.registerEnabledTemplates,
    CapabilityRegistry: coreMod.CapabilityRegistry,
    parseEnabledPacks: coreMod.parseEnabledPacks,
  };
}

/**
 * Literal specifiers so Vitest can transform TypeScript. Plain Node uses
 * this only when `dist/` is missing (then tools fail clearly).
 */
async function loadKernelFromSrc() {
  return assembleKernel(
    await Promise.all([
      import("../mcp-server/src/transport/file-queue.ts"),
      import("../mcp-server/src/tools/ping.ts"),
      import("../mcp-server/src/tools/get-state.ts"),
      import("../mcp-server/src/tools/call-template.ts"),
      import("../mcp-server/src/tools/list-templates.ts"),
      import("../mcp-server/src/tools/list-recipes.ts"),
      import("../mcp-server/src/templates/index.ts"),
      import("@streetlight/core"),
    ]),
  );
}

async function loadKernelFromDist() {
  return assembleKernel(
    await Promise.all([
      import(importUrl("src/transport/file-queue.ts", "dist/transport/file-queue.js")),
      import(importUrl("src/tools/ping.ts", "dist/tools/ping.js")),
      import(importUrl("src/tools/get-state.ts", "dist/tools/get-state.js")),
      import(importUrl("src/tools/call-template.ts", "dist/tools/call-template.js")),
      import(importUrl("src/tools/list-templates.ts", "dist/tools/list-templates.js")),
      import(importUrl("src/tools/list-recipes.ts", "dist/tools/list-recipes.js")),
      import(importUrl("src/templates/index.ts", "dist/templates/index.js")),
      import("@streetlight/core"),
    ]),
  );
}

/**
 * Load kernel file-queue + tools from dist (product) or src (vitest / TS-capable runtimes).
 * Never starts MCP stdio (`packages/mcp-server/src/index.ts` is not imported).
 */
export async function loadMcpKernel() {
  if (cached) {
    return cached;
  }
  const distPing = path.join(mcpRoot, "dist", "tools", "ping.js");
  try {
    cached = existsSync(distPing) ? await loadKernelFromDist() : await loadKernelFromSrc();
    return cached;
  } catch (error) {
    cached = null;
    throw error;
  }
}

/** Test-only: drop the cached kernel (and any injected client). */
export function resetMcpKernelCache() {
  cached = null;
  clientCache = null;
}

export async function getBridgeClient({ env = process.env } = {}) {
  if (clientCache) {
    return clientCache;
  }
  const kernel = await loadMcpKernel();
  const queueDir = kernel.resolveQueueDir(env);
  const registry = new kernel.CapabilityRegistry();
  kernel.registerEnabledTemplates(
    registry,
    kernel.parseEnabledPacks(env.STREETLIGHT_ENABLED_PACKS),
  );
  let client = null;
  clientCache = {
    kernel,
    registry,
    queueDir,
    async getClient() {
      if (!client) {
        client = new kernel.FileQueueClient({ queueDir });
        await client.init();
      }
      return client;
    },
  };
  return clientCache;
}

export function setBridgeClientForTests(value) {
  clientCache = value;
}

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import {
  PiJsonlRpcClient,
  attachJsonlReader,
  formatStudioPromptMessage,
} from "./pi-jsonl.mjs";
import { withBuiltinCommandFallback } from "./pi-command-hints.mjs";

/**
 * Start a loopback HTTP shim in front of `pi --mode rpc` (stdio JSONL).
 * REAPER / studio-pi-send talk HTTP; this process owns the Pi subprocess pipes.
 */
export async function startPiRpcHost({
  piExecutable,
  piArgs,
  piEnv,
  endpointFile,
  log,
  listenHost = "127.0.0.1",
}) {
  const piChild = spawn(piExecutable, piArgs, {
    env: piEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const client = new PiJsonlRpcClient({ stdin: piChild.stdin });
  attachJsonlReader(piChild.stdout, (line) => client.handleLine(line));

  piChild.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.trim()) {
      log?.(`[pi stderr] ${text.trim()}`);
    }
  });

  let promptChain = Promise.resolve();
  let commandsCache = { at: 0, commands: [] };
  const commandsTtlMs = 30_000;

  async function loadPiCommands() {
    const now = Date.now();
    if (now - commandsCache.at < commandsTtlMs && commandsCache.commands.length) {
      return { commands: commandsCache.commands, cached: true };
    }
    const response = await client.sendCommand({ type: "get_commands" });
    if (!response?.success) {
      throw new Error(`get_commands failed: ${JSON.stringify(response)}`);
    }
    const commands = Array.isArray(response?.data?.commands) ? response.data.commands : [];
    commandsCache = { at: now, commands };
    return { commands, cached: false };
  }

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, piPid: piChild.pid }));
      return;
    }

    if (req.method === "GET" && req.url === "/commands") {
      try {
        const { commands, cached } = await loadPiCommands();
        const resolved = withBuiltinCommandFallback(commands);
        const fallback = resolved !== commands && commands.length === 0;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            mode: "pi_rpc",
            commands: resolved,
            cached,
            fallback,
            message: fallback
              ? "Pi get_commands returned no entries; showing Studio builtin hints."
              : undefined,
          }),
        );
      } catch (error) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            mode: "pi_rpc_fallback",
            commands: withBuiltinCommandFallback([]),
            fallback: true,
            message: error?.message ?? String(error),
          }),
        );
      }
      return;
    }

    if (req.method === "POST" && req.url === "/prompt") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        promptChain = promptChain.then(async () => {
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          } catch {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, text: "Invalid JSON body." }));
            return;
          }
          const message = String(body?.message ?? "").trim();
          if (!message) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, text: "Message was empty." }));
            return;
          }
          const chips = Array.isArray(body?.chips) ? body.chips : [];
          const promptText = formatStudioPromptMessage(message, chips);
          try {
            const promptResponse = await client.sendCommand({
              type: "prompt",
              message: promptText,
            });
            if (!promptResponse.success) {
              res.writeHead(502, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  ok: false,
                  text: `Pi rejected prompt: ${JSON.stringify(promptResponse)}`,
                }),
              );
              return;
            }
            await client.waitForAgentSettled();
            const lastText = await client.sendCommand({ type: "get_last_assistant_text" });
            const text =
              lastText?.success && lastText?.data?.text != null
                ? String(lastText.data.text)
                : "(Pi accepted the prompt but returned no assistant text yet.)";
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, text, mode: "pi_rpc" }));
          } catch (error) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                ok: false,
                text: `Private Pi RPC failed: ${error?.message ?? error}`,
              }),
            );
          }
        });
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, listenHost, resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  const baseUrl = `http://${listenHost}:${port}`;
  const promptUrl = `${baseUrl}/prompt`;
  const commandsUrl = `${baseUrl}/commands`;

  if (endpointFile) {
    await writeFile(
      endpointFile,
      `${JSON.stringify(
        {
          contract: "openreaper.studio.pi_rpc_endpoint.v1",
          promptUrl,
          commandsUrl,
          healthUrl: `${baseUrl}/health`,
          hostPid: process.pid,
          piPid: piChild.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  const shutdown = () => {
    try {
      piChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    server.close();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  piChild.on("exit", (code, signal) => {
    log?.(`Pi RPC subprocess exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    shutdown();
    process.exit(code === 0 || code === null ? 0 : 1);
  });

  log?.(`Private Pi RPC host listening ${promptUrl} (pi pid=${piChild.pid})`);
  return { server, piChild, promptUrl, commandsUrl, shutdown };
}

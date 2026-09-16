import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildPiProcessEnv,
  buildPiStartPlan,
  resolveStudioPiForStart,
} from "../lib/pi.mjs";
import {
  defaultStudioPiHomeRoot,
  isIsolatedFromPersonalPi,
  resolveStudioPiLayout,
  studioPiAuthJsonPath,
  userPersonalPiAgentDir,
} from "../lib/pi/private-layout.mjs";
import { formatStudioPromptMessage } from "../lib/agent-seam/pi-jsonl.mjs";

describe("private Pi layout", () => {
  it("never defaults agentDir to ~/.pi/agent", () => {
    const homeDir = "/Users/studio-user";
    const installRoot = "/Users/studio-user/.openreaper/current";
    const layout = resolveStudioPiLayout({ homeDir, installRoot, env: {} });
    expect(layout.agentDir).toBe(
      path.join(homeDir, ".openreaper", "studio", "pi", "agent"),
    );
    expect(layout.agentDir).not.toBe(userPersonalPiAgentDir(homeDir));
    expect(layout.isolatedFromPersonalPi).toBe(true);
    expect(isIsolatedFromPersonalPi(layout.agentDir, homeDir)).toBe(true);
    expect(layout.workspaceDir).toBe(path.join(homeDir, ".openreaper", "studio", "workspace"));
  });

  it("places auth under private agent dir for future in-app login", () => {
    const layout = resolveStudioPiLayout({
      homeDir: "/tmp/home",
      installRoot: "/tmp/install",
      env: {},
    });
    expect(layout.authJsonPath).toBe(studioPiAuthJsonPath(layout.agentDir));
    expect(layout.authJsonPath).not.toContain("/.pi/");
  });

  it("honors OPENREAPER_STUDIO_PI_ROOT override", () => {
    const custom = "/opt/openreaper-studio/pi-tree";
    const layout = resolveStudioPiLayout({
      homeDir: os.homedir(),
      installRoot: "/ignored",
      env: { OPENREAPER_STUDIO_PI_ROOT: custom },
    });
    expect(layout.piRoot).toBe(custom);
    expect(defaultStudioPiHomeRoot("/x")).not.toBe(custom);
  });
});

describe("Pi orchestration env", () => {
  it("sets PI_CODING_AGENT_DIR and session dir to Studio private paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-pi-env-"));
    const fakePi = path.join(tmp, "pi");
    await writeFile(fakePi, "#!/bin/sh\n", "utf8");
    try {
      const { layout, plan } = resolveStudioPiForStart({
        homeDir: "/Users/test",
        installRoot: "/Users/test/.openreaper/current",
        env: {
          OPENREAPER_STUDIO_SKIP_PI: "1",
          OPENREAPER_STUDIO_PI_BIN: fakePi,
        },
      });
      const env = buildPiProcessEnv({
        env: { FOO: "bar" },
        layout,
      });
      expect(env.PI_CODING_AGENT_DIR).toBe(layout.agentDir);
      expect(env.PI_CODING_AGENT_SESSION_DIR).toBe(layout.sessionsDir);
      expect(env.PI_CODING_AGENT_DIR).not.toBe(path.join("/Users/test", ".pi", "agent"));
      expect(plan.mode).toBe("skipped");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("buildPiStartPlan uses rpc mode, workspace cwd, and native extension flags", () => {
    const layout = resolveStudioPiLayout({
      homeDir: "/Users/test",
      installRoot: "/Users/test/.openreaper/current",
      env: {},
    });
    const plan = buildPiStartPlan({
      piExecutable: "/usr/local/bin/pi",
      env: {},
      layout,
    });
    expect(plan.mode).toBe("start");
    expect(plan.args).toContain("rpc");
    expect(plan.args).toContain("--no-builtin-tools");
    expect(plan.args).toContain("--no-extensions");
    expect(plan.args).toContain("--extension");
    expect(plan.args.some((arg) => String(arg).endsWith("openreaper-extension.mjs"))).toBe(true);
    expect(plan.args).not.toContain("--no-tools");
    expect(plan.cwd).toBe(layout.workspaceDir);
    expect(plan.processEnv.PI_CODING_AGENT_DIR).toBe(layout.agentDir);
  });

  it("omits --no-builtin-tools when OPENREAPER_STUDIO_PI_KEEP_BUILTIN_TOOLS=1", () => {
    const layout = resolveStudioPiLayout({
      homeDir: "/Users/test",
      installRoot: "/Users/test/.openreaper/current",
      env: {},
    });
    const plan = buildPiStartPlan({
      piExecutable: "/usr/local/bin/pi",
      env: { OPENREAPER_STUDIO_PI_KEEP_BUILTIN_TOOLS: "1" },
      layout,
    });
    expect(plan.args).not.toContain("--no-builtin-tools");
    expect(plan.args).toContain("--extension");
  });
});

describe("start-steps private Pi wiring", () => {
  it("does not read ~/.pi mcp.json in agent.pi_rpc step", async () => {
    const source = await readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "lib",
        "orchestration",
        "start-steps.mjs",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/defaultPiMcpJsonPath/);
    expect(source).not.toMatch(/readPiMcpConfig\([^)]*homeDir/);
    expect(source).toMatch(/launchPrivatePiRpcHost/);
    expect(source).toMatch(/piLayout\.mcpJsonPath/);
  });
});

describe("private Pi RPC host reuse", () => {
  it("adopts a live endpoint instead of spawning a duplicate host", async () => {
    const { createServer } = await import("node:http");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const {
      adoptLivePiRpcEndpoint,
      launchPrivatePiRpcHost,
      studioPiRpcEndpointPath,
    } = await import("../lib/orchestration/pi-rpc-lifecycle.mjs");
    const { repoRootFromStudio } = await import("../lib/paths.mjs");

    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-pi-rpc-reuse-"));
    const homeDir = path.join(tmp, "home");
    const endpointFile = studioPiRpcEndpointPath(homeDir);
    await mkdir(path.dirname(endpointFile), { recursive: true });
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    await writeFile(
      endpointFile,
      `${JSON.stringify({
        contract: "openreaper.studio.pi_rpc_endpoint.v1",
        promptUrl: `${base}/prompt`,
        commandsUrl: `${base}/commands`,
        healthUrl: `${base}/health`,
        hostPid: 4242,
        piPid: 4243,
      })}\n`,
      "utf8",
    );
    try {
      const adopted = await adoptLivePiRpcEndpoint(endpointFile);
      expect(adopted?.reused).toBe(true);
      expect(adopted?.hostPid).toBe(4242);

      const launched = await launchPrivatePiRpcHost({
        nodeCommand: process.execPath,
        repoRoot: repoRootFromStudio(),
        env: {},
        homeDir,
        log() {},
      });
      expect(launched.reused).toBe(true);
      expect(launched.hostPid).toBe(4242);
      expect(launched.promptUrl).toBe(`${base}/prompt`);
    } finally {
      server.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("formatStudioPromptMessage", () => {
  it("prefixes chip context for Pi RPC", () => {
    const text = formatStudioPromptMessage("mix vocals", [
      { kind: "track", label: "Lead Vox" },
    ]);
    expect(text).toContain("Lead Vox");
    expect(text).toContain("mix vocals");
  });
});

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

  it("buildPiStartPlan uses rpc mode and does not reference personal mcp path", () => {
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
    expect(plan.processEnv.PI_CODING_AGENT_DIR).toBe(layout.agentDir);
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

describe("formatStudioPromptMessage", () => {
  it("prefixes chip context for Pi RPC", () => {
    const text = formatStudioPromptMessage("mix vocals", [
      { kind: "track", label: "Lead Vox" },
    ]);
    expect(text).toContain("Lead Vox");
    expect(text).toContain("mix vocals");
  });
});

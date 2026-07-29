import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageBuilder = path.join(repoRoot, "scripts", "package-openreaper-alpha.mjs");
const installerSource = path.join(repoRoot, "scripts", "openreaper-alpha-package", "install-openreaper.mjs");
const bridgeLauncherSource = path.join(repoRoot, "scripts", "openreaper-alpha-package", "openreaper-start-mcp-bridge.lua");

test("package CLI defaults to core and requires explicit --with-vital", async () => {
  const help = await execFileAsync(process.execPath, [packageBuilder, "--help"]);
  assert.match(help.stdout, /Default: build and smoke the OpenReaper core package only/u);
  assert.match(help.stdout, /--with-vital/u);

  await assert.rejects(
    execFileAsync(process.execPath, [packageBuilder, "--vital-agent-root", "/tmp/not-used"]),
    (error) => error.code === 2 && /requires --with-vital/u.test(error.stderr),
  );

  const source = await readFile(packageBuilder, "utf8");
  assert.match(source, /if \(withVital\) await copyVitalAgentCompanion\(\)/u);
  assert.match(source, /if \(withVital\) await installVitalAgentCompanion\(\)/u);
  assert.match(source, /\.\.\.\(withVital \? \{ vital_agent_mcp: await smokePackagedVitalAgentMcp\(\) \} : \{\}\)/u);
});

test("core installer removes stale Vital registration while optional mode preserves it", async () => {
  for (const withVital of [false, true]) {
    const fixture = await createInstallerFixture({ withVital });
    try {
      const { stdout } = await execFileAsync(process.execPath, [
        fixture.installer,
        "--install-root", fixture.installRoot,
        "--skip-startup-hook",
      ], {
        env: { ...process.env, HOME: fixture.home },
        maxBuffer: 2 * 1024 * 1024,
      });
      const report = JSON.parse(stdout.slice(0, stdout.indexOf("\n\nOpenReaper alpha ")));
      assert.equal(report.optional_companions.vital_agent_mcp.included, withVital);

      const codex = await readFile(path.join(fixture.home, ".codex", "config.toml"), "utf8");
      const cursor = JSON.parse(await readFile(path.join(fixture.home, ".cursor", "mcp.json"), "utf8"));
      const snippet = JSON.parse(await readFile(path.join(fixture.installRoot, "config-snippets", "mcp.json"), "utf8"));
      assert.match(codex, /\[mcp_servers\.openreaper\]/u);
      assert.equal(codex.includes("[mcp_servers.vital-agent-mcp]"), withVital);
      assert.equal("vital-agent-mcp" in cursor.mcpServers, withVital);
      assert.equal("vital-agent-mcp" in snippet.mcpServers, withVital);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

async function createInstallerFixture({ withVital }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-core-package-"));
  const home = path.join(root, "home");
  const packageRoot = path.join(root, "package", "OpenReaper-alpha");
  const installer = path.join(packageRoot, "installer", "install-openreaper.mjs");
  const installRoot = path.join(home, ".openreaper", "current");
  await mkdir(path.dirname(installer), { recursive: true });
  await mkdir(path.join(packageRoot, "bin"), { recursive: true });
  await mkdir(path.join(packageRoot, "vendor", "openreaper-kernel", "reaper", "bridge"), { recursive: true });
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await mkdir(path.join(home, ".cursor"), { recursive: true });
  await mkdir(path.join(home, "Library", "Application Support", "Claude"), { recursive: true });
  await cp(installerSource, installer);
  await cp(bridgeLauncherSource, path.join(packageRoot, "bin", "openreaper-start-mcp-bridge.lua"));

  for (const name of ["openreaper-mcp", "openreaper-start", "openreaper-doctor"]) {
    const body = name === "openreaper-mcp"
      ? "#!/bin/zsh\necho 'stdio server ready' >&2\n"
      : "#!/bin/zsh\nexit 0\n";
    await writeExecutable(path.join(packageRoot, "bin", name), body);
  }
  if (withVital) {
    await mkdir(path.join(packageRoot, "vendor", "vital-agent-mcp", "dist", "src"), { recursive: true });
    await writeFile(path.join(packageRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js"), "export {};\n", "utf8");
    await writeExecutable(path.join(packageRoot, "bin", "vital-agent-mcp"), "#!/bin/zsh\nexit 0\n");
  }
  await writeExecutable(path.join(packageRoot, "install.command"), "#!/bin/zsh\nexit 0\n");
  await writeExecutable(path.join(packageRoot, "uninstall.command"), "#!/bin/zsh\nexit 0\n");
  await writeFile(path.join(packageRoot, "provenance.json"), '{"contract":"openreaper.package.provenance.v1"}\n', "utf8");
  await writeFile(path.join(packageRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua"), "-- fixture\n", "utf8");

  const staleVital = path.join(home, ".openreaper", "old", "bin", "vital-agent-mcp");
  await writeFile(path.join(home, ".codex", "config.toml"), `[mcp_servers.vital-agent-mcp]\ncommand = ${JSON.stringify(staleVital)}\nargs = []\n`, "utf8");
  const jsonConfig = { mcpServers: { "vital-agent-mcp": { command: staleVital, args: [] } } };
  await writeFile(path.join(home, ".cursor", "mcp.json"), `${JSON.stringify(jsonConfig)}\n`, "utf8");
  await writeFile(path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), `${JSON.stringify(jsonConfig)}\n`, "utf8");
  return { root, home, packageRoot, installer, installRoot };
}

async function writeExecutable(file, body) {
  await writeFile(file, body, "utf8");
  await chmod(file, 0o755);
}

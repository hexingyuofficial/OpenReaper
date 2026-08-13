import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INSTALLER_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/install-openreaper.mjs");
const UNINSTALLER_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/uninstall-openreaper.mjs");
const START_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-start.sh");
const BRIDGE_LAUNCHER_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-start-mcp-bridge.lua");
const MCP_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-mcp.sh");
const PACKAGE_BUILDER_SOURCE = path.join(REPO_ROOT, "scripts/package-openreaper-alpha.mjs");
const FIXTURE_ROOTS = [];
const ACTIVE_FIXTURE_CLEANUPS = new Set();
const RENDER_ENV = "OPENREAPER_LIVE_SMOKE_RENDER_ROOT";
const RECORD_NAME = "managed-render-root.path";
const RECORD_MAX = 4096;
const PROVENANCE_NAME = "provenance.json";
const STARTUP_BEGIN = "// >>> OpenReaper alpha MCP startup hook >>>";
const STARTUP_END = "// <<< OpenReaper alpha MCP startup hook <<<";
const LEGACY_LUA_STARTUP_BEGIN = "-- >>> OpenReaper alpha MCP startup hook >>>";
const LEGACY_LUA_STARTUP_END = "-- <<< OpenReaper alpha MCP startup hook <<<";

async function freshTmp(prefix) {
  const root = await mkdtemp(path.join("/tmp", prefix));
  FIXTURE_ROOTS.push(root);
  return root;
}

after(async () => {
  await drainActiveFixtureCleanups();
  await Promise.all(FIXTURE_ROOTS.map((root) => rm(root, { recursive: true, force: true })));
});

describe("Alpha3.2-B2 managed render root", () => {
  it("rotates and persists bridge generations without allowing an explicit rollback", async () => {
    const fixture = await makeStartFixture("generation-rotation");

    const first = await runFakeStartResult({
      fixture,
      label: "generation-first",
      extraArgs: [],
    });
    assert.equal(first.result.code, 0, first.result.stderr || first.result.stdout);
    assert.match(first.result.stdout, /bridge-heartbeat=ready owner=openreaper-alpha generation=1/u);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.installRoot, "session", "bridge-generation-v1.json"))), {
      contract: "openreaper.bridge_generation.v1",
      generation: 1,
    });

    const second = await runFakeStartResult({
      fixture,
      label: "generation-second",
      extraArgs: [],
    });
    assert.equal(second.result.code, 0, second.result.stderr || second.result.stdout);
    assert.match(second.result.stdout, /bridge-heartbeat=ready owner=openreaper-alpha generation=2/u);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.installRoot, "session", "bridge-generation-v1.json"))), {
      contract: "openreaper.bridge_generation.v1",
      generation: 2,
    });

    const adopted = await runFakeStartResult({
      fixture,
      label: "generation-adopted",
      extraArgs: ["--bridge-generation", "4"],
    });
    assert.equal(adopted.result.code, 0, adopted.result.stderr || adopted.result.stdout);
    assert.match(adopted.result.stdout, /bridge-heartbeat=ready owner=openreaper-alpha generation=4/u);

    const rollback = await runFakeStartResult({
      fixture,
      label: "generation-rollback",
      extraArgs: ["--bridge-generation", "3"],
    });
    assert.notEqual(rollback.result.code, 0);
    assert.match(rollback.result.stderr, /would move backwards/u);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.installRoot, "session", "bridge-generation-v1.json"))), {
      contract: "openreaper.bridge_generation.v1",
      generation: 4,
    });
  });

  it("prints installer help without creating or replacing an install", async () => {
    const fixture = await makeInstallerFixture();
    const result = await runCaptured(process.execPath, [fixture.installerPath, "--help"], {
      cwd: fixture.packageRoot,
      env: { ...process.env, HOME: fixture.home },
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /OpenReaper alpha installer/u);
    assert.match(result.stdout, /Show this help without installing/u);
    await assert.rejects(lstat(fixture.installRoot), (error) => error?.code === "ENOENT");
  });

  it("prints uninstaller help without mutating installed or user-owned state", async () => {
    const fixture = await makeInstallerFixture();
    const state = new Map([
      [path.join(fixture.installRoot, "install-marker.txt"), "installed\n"],
      [path.join(fixture.installRoot, "session", "renders", "render.wav"), "render\n"],
      [path.join(fixture.home, ".openreaper", "data", "executable-recipes", "revision.json"), "recipe\n"],
      [path.join(fixture.home, ".openreaper", "data", "startup-dialog-consent"), "always\n"],
      [path.join(fixture.home, "Library", "Application Support", "REAPER", "Scripts", "__startup.eel"), `${STARTUP_BEGIN}\nmanaged startup;\n${STARTUP_END}\nuser startup;\n`],
      [path.join(fixture.home, ".codex", "config.toml"), "[mcp_servers.openreaper]\ncommand = 'openreaper'\n\n[user]\nkeep = true\n"],
      [path.join(fixture.home, ".cursor", "mcp.json"), '{"mcpServers":{"openreaper":{"command":"openreaper"},"keep":{"command":"keep"}}}\n'],
      [path.join(fixture.home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), '{"mcpServers":{"openreaper":{"command":"openreaper"},"keep":{"command":"keep"}}}\n'],
    ]);
    for (const [filePath, content] of state) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }

    const result = await runCaptured(process.execPath, [fixture.uninstallerPath, "--help"], {
      cwd: fixture.packageRoot,
      env: { ...process.env, HOME: fixture.home },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /OpenReaper alpha uninstaller/u);
    assert.match(result.stdout, /Show this help without uninstalling/u);
    assert.match(result.stdout, /--skip-client-config/u);
    assert.match(result.stdout, /--skip-startup-hook/u);
    for (const [filePath, content] of state) {
      assert.equal(await readFile(filePath, "utf8"), content, `--help mutated ${filePath}`);
    }
  });

  it("creates and persists the fresh default root with a bounded writable report", async () => {
    const fixture = await makeInstallerFixture();
    const result = await runInstaller(fixture);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const report = parseInstallerReport(result.stdout);
    const defaultRoot = path.join(fixture.installRoot, "session", "renders");
    const recordPath = path.join(fixture.installRoot, "session", RECORD_NAME);

    assert.equal(report.render_root.path, defaultRoot);
    assert.equal(report.render_root.source, "default");
    assert.equal(report.render_root.created, true);
    assert.equal(report.render_root.writable, true);
    assert.equal(report.render_root.persisted_record, recordPath);
    assert.equal((await lstat(defaultRoot)).isDirectory(), true);
    assert.equal((await lstat(defaultRoot)).isSymbolicLink(), false);
    assert.equal(await readFile(recordPath, "utf8"), `${defaultRoot}\n`);
    assert.doesNotMatch(result.stdout, /ready_for_render/i);
    assert.match(result.stdout, /reports ready only after the matching heartbeat and public read probe both pass/u);
    assert.doesNotMatch(result.stdout, /After openreaper-start opens REAPER, run the REAPER action/u);
  });

  it("keeps executable recipe revisions in sibling data across upgrade and uninstall", async () => {
    const fixture = await makeInstallerFixture();
    const recipeRoot = path.join(fixture.home, ".openreaper", "data", "executable-recipes");
    const consentPath = path.join(fixture.home, ".openreaper", "data", "startup-dialog-consent");
    const fresh = await runInstaller(fixture);
    assert.equal(fresh.code, 0, fresh.stderr || fresh.stdout);
    assert.equal(parseInstallerReport(fresh.stdout).executable_recipe_root.path, recipeRoot);
    await writeFile(path.join(recipeRoot, "revision.json"), "immutable-revision\n", "utf8");

    const upgrade = await runInstaller(fixture);
    assert.equal(upgrade.code, 0, upgrade.stderr || upgrade.stdout);
    assert.equal(await readFile(path.join(recipeRoot, "revision.json"), "utf8"), "immutable-revision\n");
    await writeFile(consentPath, "always\n", "utf8");

    const uninstall = await runUninstaller(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    const uninstallReport = JSON.parse(uninstall.stdout);
    assert.equal(uninstallReport.executable_recipe_root.preserved, true);
    assert.equal(uninstallReport.startup_dialog_consent.removed, true);
    assert.equal(await pathExists(consentPath), false);
    assert.equal(await readFile(path.join(recipeRoot, "revision.json"), "utf8"), "immutable-revision\n");
  });

  it("removes the complete OpenReaper Codex TOML section tree", async () => {
    const fixture = await makeInstallerFixture();
    const codexPath = path.join(fixture.home, ".codex", "config.toml");
    await mkdir(path.dirname(codexPath), { recursive: true });
    const existing = [
      "[mcp_servers.openreaper.env]",
      "OPENREAPER_ARTIFACT_ROOT = 'owned'",
      "",
      "[mcp_servers.keep]",
      "command = 'keep'",
      "",
      "[mcp_servers.openreaper.experimental]",
      "enabled = true",
      "",
      "[mcp_servers.vital-agent-mcp]",
      "command = '/Users/test/.openreaper/current/bin/vital-agent-mcp'",
      "STALE = 'owned'",
      "",
      "[user]",
      "keep = true",
      "",
    ].join("\r\n");
    const expected = [
      "",
      "[mcp_servers.keep]",
      "command = 'keep'",
      "",
      "",
      "",
      "[user]",
      "keep = true",
      "",
    ].join("\r\n");
    await writeFile(codexPath, existing, "utf8");

    const result = await runUninstallerWithClientConfig(fixture);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const remaining = await readFile(codexPath, "utf8");
    assert.equal(remaining, expected);
    assert.doesNotMatch(remaining, /mcp_servers\.(?:openreaper|vital-agent-mcp)/u);
    assert.match(remaining, /\[mcp_servers\.keep\]/u);
    assert.match(remaining, /\[user\]/u);
  });

  it("preserves every unrelated Codex TOML byte across install and upgrade", async () => {
    const fixture = await makeInstallerFixture();
    const codexPath = path.join(fixture.home, ".codex", "config.toml");
    const prefix = [
      "\uFEFF# user preamble with CRLF",
      "model = 'custom'  ",
      "",
      "[model_providers.custom] # keep comment",
      "name = '随想'",
      "",
    ].join("\r\n");
    const owned = [
      "[mcp_servers.openreaper]",
      "command = 'stale-owned'",
      "",
      "[mcp_servers.openreaper.env]",
      "OPENREAPER_ARTIFACT_ROOT = 'stale-owned'",
      "",
    ].join("\r\n");
    const suffix = [
      "[projects.'c:\\\\users\\\\何星宇']",
      "trust_level = 'trusted' # preserve me",
      "",
      "",
    ].join("\r\n");
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, `${prefix}${owned}${suffix}`, "utf8");

    for (let pass = 0; pass < 2; pass += 1) {
      const result = await runInstallerWithClientConfig(fixture);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      const installed = await readFile(codexPath, "utf8");
      assert.equal(installed.slice(0, prefix.length), prefix);
      assert.equal(installed.slice(-suffix.length), suffix);
      assert.match(installed, /\[mcp_servers\.openreaper\]/u);
      assert.match(installed, /\[mcp_servers\.openreaper\.env\]/u);
      assert.doesNotMatch(installed, /stale-owned/u);
    }
  });

  it("preserves a direct BOM, TOML-equivalent quoted tables, and trailing user trivia", async () => {
    const fixture = await makeInstallerFixture();
    const codexPath = path.join(fixture.home, ".codex", "config.toml");
    const prefix = "\uFEFF";
    const owned = [
      "[mcp_servers . \"openreaper\"] # equivalent owned table",
      "command = 'stale-owned'",
      "",
      "[mcp_servers . 'openreaper' . env]",
      "OPENREAPER_ARTIFACT_ROOT = 'stale-owned'",
      "",
    ].join("\r\n");
    const suffix = [
      "# user comment before the next table  ",
      "[mcp_servers.keep]",
      "command = 'keep'",
      "",
      "# user EOF comment  ",
      "",
    ].join("\r\n");
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, `${prefix}${owned}${suffix}`, "utf8");

    for (let pass = 0; pass < 2; pass += 1) {
      const result = await runInstallerWithClientConfig(fixture);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      const installed = await readFile(codexPath, "utf8");
      assert.equal(installed[0], prefix);
      assert.equal(installed.slice(-suffix.length), suffix);
      assert.equal((installed.match(/^(?:\uFEFF)?\[mcp_servers\.openreaper\]\r?$/gmu) ?? []).length, 1);
      assert.doesNotMatch(installed, /equivalent owned table|stale-owned/u);
    }

    const uninstall = await runUninstallerWithClientConfig(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    assert.equal(await readFile(codexPath, "utf8"), `${prefix}${suffix}`);
  });

  it("preserves comments and whitespace after an owned TOML section at EOF", async () => {
    const fixture = await makeInstallerFixture();
    const codexPath = path.join(fixture.home, ".codex", "config.toml");
    const prefix = [
      "[user]",
      "keep = true",
      "",
    ].join("\n");
    const owned = [
      "[mcp_servers . openreaper]",
      "command = 'stale-owned'",
      "",
    ].join("\n");
    const suffix = "# preserve this EOF comment  \n\n";
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, `${prefix}${owned}${suffix}`, "utf8");

    const install = await runInstallerWithClientConfig(fixture);
    assert.equal(install.code, 0, install.stderr || install.stdout);
    assert.equal((await readFile(codexPath, "utf8")).slice(-suffix.length), suffix);

    const uninstall = await runUninstallerWithClientConfig(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    assert.equal(await readFile(codexPath, "utf8"), `${prefix}${suffix}`);
  });

  it("ignores apparent OpenReaper tables inside TOML multiline strings byte for byte", async () => {
    const fixture = await makeInstallerFixture();
    const codexPath = path.join(fixture.home, ".codex", "config.toml");
    const original = [
      "\uFEFF[user]",
      'basic = """',
      "[mcp_servers.openreaper]",
      'command = "documentation only"',
      '[[mcp_servers."openreaper".examples]]',
      'escaped = \\\"not the end\\\"',
      '"""',
      "literal = '''",
      "[mcp_servers . 'openreaper']",
      "command = 'also documentation only'",
      "'''",
      "",
    ].join("\r\n");
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, original, "utf8");

    for (let pass = 0; pass < 2; pass += 1) {
      const result = await runInstallerWithClientConfig(fixture);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      const installed = await readFile(codexPath, "utf8");
      assert.equal(installed.slice(0, original.length), original);
      assert.match(installed, /documentation only/u);
      assert.equal((installed.match(/^(?:\uFEFF)?\[mcp_servers\.openreaper\]\r?$/gmu) ?? []).length, 2);
    }

    const uninstall = await runUninstallerWithClientConfig(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    assert.equal(await readFile(codexPath, "utf8"), original);
  });

  it("restores a Codex config with no final newline exactly after install update uninstall", async () => {
    const fixture = await makeInstallerFixture();
    const codexPath = path.join(fixture.home, ".codex", "config.toml");
    const vitalEntry = path.join(fixture.packageRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js");
    const original = "\uFEFF[user]\r\nname = '没有尾换行'";
    await mkdir(path.dirname(vitalEntry), { recursive: true });
    await writeFile(vitalEntry, "// fixture only\n", "utf8");
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, original, "utf8");

    for (let pass = 0; pass < 2; pass += 1) {
      const result = await runInstallerWithClientConfig(fixture);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      const installed = await readFile(codexPath, "utf8");
      assert.equal(installed.slice(0, original.length), original);
      assert.match(installed, /\[mcp_servers\.openreaper\] # OpenReaper owns the preceding line ending\r\n/u);
      assert.match(installed, /\[mcp_servers\.vital-agent-mcp\]\r\n/u);
    }

    const uninstall = await runUninstallerWithClientConfig(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    assert.equal(await readFile(codexPath, "utf8"), original);
  });

  it("installs a conditional startup hook, preserves user bytes, and keeps the manual Action fallback", async () => {
    const fixture = await makeInstallerFixture();
    const scriptsRoot = path.join(fixture.home, "Library", "Application Support", "REAPER", "Scripts");
    const hookPath = path.join(scriptsRoot, "__startup.eel");
    const legacyLuaPath = path.join(scriptsRoot, "__startup.lua");
    const eelPrefix = [
      " ",
      "// user startup content",
      "ShowConsoleMsg(\"keep user startup\");",
      "",
    ].join("\n");
    const eelSuffix = "\t// trailing user bytes\n\n";
    const original = `${eelPrefix}${STARTUP_BEGIN}\nmanaged EEL startup;\n${STARTUP_END}\n${eelSuffix}`;
    const expectedEel = `${eelPrefix}${eelSuffix}`;
    const legacyLua = [
      " ",
      "-- user Lua startup content",
      "reaper.ShowConsoleMsg('keep user Lua startup')",
      "",
      LEGACY_LUA_STARTUP_BEGIN,
      "print('legacy openreaper hook')",
      LEGACY_LUA_STARTUP_END,
      "\t-- trailing Lua bytes",
      "",
      "",
    ].join("\n");
    const expectedLua = [
      " ",
      "-- user Lua startup content",
      "reaper.ShowConsoleMsg('keep user Lua startup')",
      "",
      "\t-- trailing Lua bytes",
      "",
      "",
    ].join("\n");
    const kbPath = path.join(fixture.home, "Library", "Application Support", "REAPER", "reaper-kb.ini");
    const originalKb = [
      "",
      'SCR 4 0 RSother "Custom: User Action" "User/action.lua"\r\n',
      'SCR 4 0 RSuserTitle "Custom: OpenReaper: Start MCP bridge" "User/lookalike-title.lua"\n',
      'SCR 4 0 RSuserPath "Custom: User Path Lookalike" "OpenReaper/openreaper-start-mcp-bridge.lua"\r\n',
      "\r\n",
    ].join("");
    await mkdir(scriptsRoot, { recursive: true });
    await writeFile(hookPath, original, "utf8");
    await writeFile(legacyLuaPath, legacyLua, "utf8");
    await writeFile(kbPath, originalKb, "utf8");

    const first = await runInstallerWithStartupHook(fixture);
    assert.equal(first.code, 0, first.stderr || first.stdout);
    const firstReport = parseInstallerReport(first.stdout);
    const installed = await readFile(hookPath, "utf8");
    const conditionalHook = await readFile(legacyLuaPath, "utf8");
    assert.equal(installed, expectedEel);
    assert.equal(firstReport.startup_hook.path, legacyLuaPath);
    assert.equal(firstReport.startup_hook.mode, "conditional_openreaper_environment");
    assert.equal(firstReport.startup_hook.package_local, false);
    assert.equal(firstReport.startup_hook.always_enabled, false);
    assert.equal(firstReport.startup_hook.fallback_path, path.join(fixture.installRoot, "bin", "openreaper-start-mcp-bridge.lua"));
    assert.equal(firstReport.startup_hook.fallback_mode, "trusted_package_manual_action_reascript");
    assert.equal(firstReport.startup_hook.fallback_installed, true);
    assert.equal(firstReport.startup_hook.installed, true);
    assert.deepEqual(firstReport.startup_hook.legacy_cleanup_paths, [hookPath]);
    assert.equal(await readFile(firstReport.startup_hook.legacy_backup_paths[0], "utf8"), original);
    assert.equal(firstReport.startup_hook.migrated_legacy_lua_path, null);
    assert.equal(firstReport.startup_hook.legacy_backup_path, null);
    assert.equal(await readFile(firstReport.startup_hook.backup_path, "utf8"), legacyLua);
    assert.match(conditionalHook, /OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH/);
    assert.match(conditionalHook, /environment_missing/);
    assert.match(conditionalHook, /stage \.\. "\x5c"\}\x5cn"\)/u);
    assert.doesNotMatch(conditionalHook, /stage \.\. "\x5c"\}\n"\)/u);
    assert.match(conditionalHook, /reaper\.ShowConsoleMsg\('keep user Lua startup'\)/);
    const actionScript = await readFile(firstReport.bridge_action.script, "utf8");
    const installedLauncher = await readFile(firstReport.startup_hook.fallback_path, "utf8");
    assert.equal(actionScript, installedLauncher);
    assert.match(actionScript, /pcall\(dofile, bridge\)/);
    assert.match(actionScript, /openreaper-startup-status-v1\.json/);
    assert.match(actionScript, /bridge_dofile_failed/);
    assert.equal((await lstat(firstReport.startup_hook.fallback_path)).mode & 0o777, 0o444);
    assert.equal((await lstat(firstReport.bridge_action.script)).mode & 0o777, 0o444);
    const installedKb = await readFile(kbPath, "utf8");
    assert.equal(installedKb.startsWith(originalKb), true);
    assert.match(installedKb, /Custom: OpenReaper: Start MCP bridge/u);

    const second = await runInstallerWithStartupHook(fixture);
    assert.equal(second.code, 0, second.stderr || second.stdout);
    const secondReport = parseInstallerReport(second.stdout);
    assert.deepEqual(secondReport.startup_hook.legacy_backup_paths, []);
    assert.equal(secondReport.startup_hook.legacy_backup_path, null);
    assert.equal(await readFile(hookPath, "utf8"), installed);
    assert.equal(await readFile(legacyLuaPath, "utf8"), conditionalHook);
    assert.equal(await readFile(kbPath, "utf8"), installedKb);

    const uninstall = await runUninstallerWithStartupHook(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    assert.equal(await pathExists(firstReport.bridge_action.script), false);
    assert.equal(await readFile(kbPath, "utf8"), originalKb);
    assert.equal(await readFile(hookPath, "utf8"), expectedEel);
    assert.equal(await readFile(legacyLuaPath, "utf8"), expectedLua);
  });

  it("preserves a symlinked Bridge Action during uninstall without following its target", async () => {
    const fixture = await makeInstallerFixture();
    const scriptsRoot = path.join(fixture.home, "Library", "Application Support", "REAPER", "Scripts");
    const actionPath = path.join(scriptsRoot, "OpenReaper", "openreaper-start-mcp-bridge.lua");
    const targetPath = path.join(fixture.root, "user-action-target.lua");
    await mkdir(path.dirname(actionPath), { recursive: true });
    await writeFile(targetPath, "-- user-owned target\n", "utf8");
    await symlink(targetPath, actionPath);

    const uninstall = await runUninstallerWithStartupHook(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    assert.equal((await lstat(actionPath)).isSymbolicLink(), true);
    assert.equal(await readFile(targetPath, "utf8"), "-- user-owned target\n");
    assert.match(uninstall.stdout, /not a regular non-symlink file and was preserved/u);
  });

  it("preserves and warns on a symlinked legacy startup hook without following its target", async () => {
    const fixture = await makeInstallerFixture();
    const scriptsRoot = path.join(fixture.home, "Library", "Application Support", "REAPER", "Scripts");
    const hookPath = path.join(scriptsRoot, "__startup.eel");
    const targetPath = path.join(fixture.root, "external-startup.eel");
    await mkdir(scriptsRoot, { recursive: true });
    await writeFile(targetPath, "external startup\n", "utf8");
    await symlink(targetPath, hookPath);

    const result = await runInstallerWithStartupHook(fixture);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const report = parseInstallerReport(result.stdout);
    assert.equal(report.warnings.some((warning) => warning.includes("not a regular file") && warning.includes(hookPath)), true);
    assert.equal(await readFile(targetPath, "utf8"), "external startup\n");
    assert.equal((await lstat(hookPath)).isSymbolicLink(), true);
  });

  it("rejects an executable recipe root symlink before replacing an existing install", async () => {
    const fixture = await makeInstallerFixture();
    await mkdir(fixture.installRoot, { recursive: true });
    const marker = path.join(fixture.installRoot, "marker.txt");
    const target = path.join(fixture.root, "recipe-target");
    const recipeRoot = path.join(fixture.home, ".openreaper", "data", "executable-recipes");
    await writeFile(marker, "still-here\n", "utf8");
    await mkdir(target, { recursive: true });
    await mkdir(path.dirname(recipeRoot), { recursive: true });
    await symlink(target, recipeRoot);

    const result = await runInstaller(fixture);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Executable recipe root must not be a symlink/);
    assert.equal(await readFile(marker, "utf8"), "still-here\n");
  });

  it("preserves existing default-root outputs across upgrade through an atomic backup container", async () => {
    const fixture = await makeInstallerFixture();
    assert.equal((await runInstaller(fixture)).code, 0);
    const outputPath = path.join(fixture.installRoot, "session", "renders", "existing-output.wav");
    await writeFile(outputPath, "existing-output\n", "utf8");

    const upgrade = await runInstaller(fixture);
    assert.equal(upgrade.code, 0, upgrade.stderr || upgrade.stdout);
    const report = parseInstallerReport(upgrade.stdout);
    assert.equal(report.render_root.source, "persisted");
    assert.equal(report.render_root.previous_default_nonempty, true);
    assert.equal(report.render_root.preserved_previous_default_at, null);
    assert.equal(await readFile(outputPath, "utf8"), "existing-output\n");
    assert.match(report.recovery.previous_install_backup, /\.openreaper-install-backup-[^/]+\/previous-install$/);
    assert.equal(await pathExists(path.dirname(report.recovery.previous_install_backup)), false);
  });

  it("hardens package provenance after fresh install and rename-first upgrade", async () => {
    const fixture = await makeInstallerFixture();
    const packagedProvenance = path.join(fixture.packageRoot, PROVENANCE_NAME);
    const installedProvenance = path.join(fixture.installRoot, PROVENANCE_NAME);
    await chmod(packagedProvenance, 0o666);

    const fresh = await runInstaller(fixture);
    assert.equal(fresh.code, 0, fresh.stderr || fresh.stdout);
    assert.equal((await lstat(installedProvenance)).mode & 0o777, 0o444);
    assert.match(parseInstallerReport(fresh.stdout).changed.join("\n"), /secured read-only package provenance/);

    await chmod(installedProvenance, 0o666);
    await chmod(packagedProvenance, 0o666);
    const upgrade = await runInstaller(fixture);
    assert.equal(upgrade.code, 0, upgrade.stderr || upgrade.stdout);
    assert.equal((await lstat(installedProvenance)).mode & 0o777, 0o444);
    assert.match(parseInstallerReport(upgrade.stdout).recovery.previous_install_backup, /\.openreaper-install-backup-/);
  });

  it("reuses a prior custom selection with spaces and quotes and never deletes it", async () => {
    const fixture = await makeInstallerFixture();
    const customRoot = path.join(fixture.root, `external custom 'quoted' renders`);
    const first = await runInstaller(fixture, ["--render-root", customRoot]);
    assert.equal(first.code, 0, first.stderr || first.stdout);
    assert.equal(parseInstallerReport(first.stdout).render_root.source, "explicit");
    await writeFile(path.join(customRoot, "custom-output.wav"), "custom\n", "utf8");

    const reinstall = await runInstaller(fixture);
    assert.equal(reinstall.code, 0, reinstall.stderr || reinstall.stdout);
    const reinstallReport = parseInstallerReport(reinstall.stdout);
    assert.equal(reinstallReport.render_root.source, "persisted");
    assert.equal(reinstallReport.render_root.path, customRoot);
    assert.equal(await readFile(path.join(customRoot, "custom-output.wav"), "utf8"), "custom\n");

    const uninstall = await runUninstaller(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    const uninstallReport = JSON.parse(uninstall.stdout);
    assert.equal(uninstallReport.render_root.record_status, "valid");
    assert.equal(uninstallReport.render_root.external_custom_untouched, customRoot);
    assert.equal(await readFile(path.join(customRoot, "custom-output.wav"), "utf8"), "custom\n");
  });

  it("preserves a non-empty old default before changing selection using an atomic container", async () => {
    const fixture = await makeInstallerFixture();
    assert.equal((await runInstaller(fixture)).code, 0);
    await writeFile(path.join(fixture.installRoot, "session", "renders", "old-default.wav"), "old-default\n", "utf8");
    const customRoot = path.join(fixture.root, "new-external-renders");

    const replacement = await runInstaller(fixture, ["--render-root", customRoot]);
    assert.equal(replacement.code, 0, replacement.stderr || replacement.stdout);
    const report = parseInstallerReport(replacement.stdout);
    assert.match(report.render_root.preserved_previous_default_at, /\.openreaper-render-preservation-[^/]+\/renders$/);
    assert.equal(
      await readFile(path.join(report.render_root.preserved_previous_default_at, "old-default.wav"), "utf8"),
      "old-default\n",
    );
    assert.match(report.changed.join("\n"), /before replacement/);
  });

  it("rejects empty, multiline, oversized, symlink/non-file, invalid-UTF8, and NUL installer records before replacement", async () => {
    for (const kind of ["empty", "multiline", "oversized", "path_too_long", "symlink", "directory", "invalid_utf8", "nul"]) {
      const fixture = await makeInstallerFixture();
      await mkdir(path.join(fixture.installRoot, "session"), { recursive: true });
      const marker = path.join(fixture.installRoot, "marker.txt");
      await writeFile(marker, `${kind}\n`, "utf8");
      await writeInvalidRecord(path.join(fixture.installRoot, "session", RECORD_NAME), kind, fixture.root);

      const result = await runInstaller(fixture);
      assert.notEqual(result.code, 0, `${kind} installer record unexpectedly passed`);
      assert.equal(await readFile(marker, "utf8"), `${kind}\n`);
    }
  });

  it("makes start fail closed on every invalid persisted-record shape before fake launch", async () => {
    for (const kind of ["empty", "multiline", "oversized", "path_too_long", "symlink", "directory", "invalid_utf8", "nul"]) {
      const fixture = await makeStartFixture(`record-${kind}`);
      await writeInvalidRecord(fixture.recordPath, kind, fixture.root);
      const run = await runFakeStartResult({ fixture, label: kind, extraArgs: [] });
      assert.equal(run.result.code, 2, `${kind} start record did not exit 2`);
      assert.match(run.result.stderr, /render-root validation failed/);
      assert.equal(await pathExists(run.capturePath), false);
    }
  });

  it("makes MCP fail closed on every invalid persisted-record shape before server exec", async () => {
    for (const kind of ["empty", "multiline", "oversized", "path_too_long", "symlink", "directory", "invalid_utf8", "nul"]) {
      const fixture = await makeMcpFixture(`record-${kind}`);
      await writeInvalidRecord(fixture.recordPath, kind, fixture.root);
      const run = await runMcpResult({ fixture, label: kind });
      assert.equal(run.result.code, 2, `${kind} MCP record did not exit 2`);
      assert.match(run.result.stderr, /render-root validation failed/);
      assert.equal(await pathExists(run.capturePath), false);
    }
  });

  it("reports invalid uninstall records and conservatively preserves the actual non-empty default", async () => {
    for (const kind of ["empty", "multiline", "oversized", "path_too_long", "symlink", "directory", "invalid_utf8", "nul"]) {
      const fixture = await makeInstallerFixture();
      const defaultRoot = path.join(fixture.installRoot, "session", "renders");
      await mkdir(defaultRoot, { recursive: true });
      await writeFile(path.join(defaultRoot, `${kind}.wav`), `${kind}\n`, "utf8");
      await writeInvalidRecord(path.join(fixture.installRoot, "session", RECORD_NAME), kind, fixture.root);

      const result = await runUninstaller(fixture);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.equal(report.render_root.record_status, "invalid");
      assert.equal(report.render_root.persisted_selection, null);
      assert.equal(report.render_root.external_custom_untouched, null);
      assert.equal(report.render_root.default_root_nonempty, true);
      assert.equal(
        await readFile(path.join(report.render_root.preserved_default_at, `${kind}.wav`), "utf8"),
        `${kind}\n`,
      );
    }
  });

  it("applies start precedence, preserves spaces/quotes, ignores stale env, and derives session renders", async () => {
    const fixture = await makeStartFixture("precedence");
    const persistedRoot = path.join(fixture.root, `persisted 'quoted' renders`);
    await mkdir(persistedRoot, { recursive: true });
    await writeFile(fixture.recordPath, `${persistedRoot}\n`, "utf8");

    const persisted = await runFakeStartResult({ fixture, label: "persisted", extraArgs: [], staleRoot: path.join(fixture.root, "stale") });
    assert.equal(persisted.result.code, 0, persisted.result.stderr || persisted.result.stdout);
    assert.equal(await readFile(persisted.capturePath, "utf8"), `${persistedRoot}\n`);
    assert.ok(Number.isInteger(persisted.fixturePid));
    assert.equal(isProcessAlive(persisted.fixturePid), false);
    assert.deepEqual(renderRootLines(persisted.result.stdout), [`[OpenReaper] render-root=${persistedRoot}`]);

    const explicitRoot = path.join(fixture.root, `explicit "quoted" renders`);
    const explicit = await runFakeStartResult({
      fixture,
      label: "explicit",
      extraArgs: ["--render-root", explicitRoot],
      staleRoot: path.join(fixture.root, "stale-explicit"),
    });
    assert.equal(explicit.result.code, 0, explicit.result.stderr || explicit.result.stdout);
    assert.equal(await readFile(explicit.capturePath, "utf8"), `${explicitRoot}\n`);

    const sessionRoot = path.join(fixture.root, "bounded-session");
    const session = await runFakeStartResult({
      fixture,
      label: "session",
      extraArgs: ["--session-root", sessionRoot],
      staleRoot: path.join(fixture.root, "stale-session"),
    });
    assert.equal(session.result.code, 0, session.result.stderr || session.result.stdout);
    assert.equal(await readFile(session.capturePath, "utf8"), `${path.join(sessionRoot, "renders")}\n`);

    await rm(fixture.recordPath);
    const missing = await runFakeStartResult({ fixture, label: "missing-record-default", extraArgs: [] });
    assert.equal(missing.result.code, 0, missing.result.stderr || missing.result.stdout);
    assert.equal(await readFile(missing.capturePath, "utf8"), `${path.join(await realpath(fixture.installRoot), "session", "renders")}\n`);
  });

  it("prepares a real session-derived Project Index root before launching REAPER and fails closed on invalid roots", async () => {
    const fixture = await makeStartFixture("project-index-state-root");
    const freshSession = path.join(fixture.root, "fresh-existing-session");
    await mkdir(freshSession, { recursive: true });
    const prepared = await runFakeStartResult({
      fixture,
      label: "fresh-session",
      extraArgs: ["--session-root", freshSession],
    });
    assert.equal(prepared.result.code, 0, prepared.result.stderr || prepared.result.stdout);
    const expectedStateRoot = path.join(freshSession, "project-index");
    const preparedStat = await lstat(expectedStateRoot);
    assert.equal(preparedStat.isDirectory(), true);
    assert.equal(preparedStat.isSymbolicLink(), false);
    assert.equal(await readFile(prepared.projectIndexCapturePath, "utf8"), `${await realpath(expectedStateRoot)}\n`);
    assert.deepEqual((await readdir(expectedStateRoot)).filter((name) => name.includes("write-probe")), []);

    for (const kind of ["symlink", "file", "transport-overlap"]) {
      const invalidSession = path.join(fixture.root, `invalid-${kind}-session`);
      const invalidStateRoot = path.join(invalidSession, "project-index");
      await mkdir(invalidSession, { recursive: true });
      const extraArgs = ["--session-root", invalidSession];
      if (kind === "symlink") {
        const target = path.join(fixture.root, "project-index-symlink-target");
        await mkdir(target, { recursive: true });
        await symlink(target, invalidStateRoot);
      } else if (kind === "file") {
        await writeFile(invalidStateRoot, "not a directory\n", "utf8");
      } else {
        extraArgs.push("--transport-dir", invalidStateRoot);
      }

      const rejected = await runFakeStartResult({ fixture, label: `invalid-${kind}`, extraArgs });
      assert.equal(rejected.result.code, 2, `${kind} Project Index root unexpectedly passed`);
      assert.match(rejected.result.stderr, /project-index state-root validation failed/);
      assert.equal(await pathExists(rejected.capturePath), false);
      assert.equal(await pathExists(rejected.projectIndexCapturePath), false);
      assert.equal(rejected.fixturePid, null);
      assert.equal(await pathExists(path.join(invalidSession, "logs")), false);
      assert.equal(await pathExists(path.join(invalidSession, "transport", "requests")), false);
      assert.equal(await pathExists(path.join(invalidSession, "transport", "results")), false);
      assert.equal(await pathExists(path.join(invalidSession, "artifacts")), false);
    }
  });

  it("orders installed-default and external-session exceptions after effective and install overlap checks", async () => {
    const fixture = await makeStartFixture("session-special-case-order");
    const aliasInstallRoot = path.join(fixture.root, "canonical-install-alias");
    await symlink(fixture.installRoot, aliasInstallRoot);
    const forbiddenSessionRoots = [
      ["install-root", fixture.installRoot],
      ["install-child", path.join(fixture.installRoot, "child")],
      ["installed-transport", path.join(fixture.installRoot, "session", "transport")],
      ["installed-artifacts", path.join(fixture.installRoot, "session", "artifacts")],
      ["alias-install-root", aliasInstallRoot],
      ["alias-install-child", path.join(aliasInstallRoot, "child")],
      ["alias-installed-transport", path.join(aliasInstallRoot, "session", "transport")],
      ["alias-installed-artifacts", path.join(aliasInstallRoot, "session", "artifacts")],
    ];

    for (const [label, sessionRoot] of forbiddenSessionRoots) {
      const derivedRenderRoot = path.join(sessionRoot, "renders");
      const run = await runFakeStartResult({
        fixture,
        label,
        extraArgs: ["--session-root", sessionRoot],
      });
      assert.equal(run.result.code, 2, `${label} session root unexpectedly passed`);
      assert.match(run.result.stderr, /path overlaps reserved install root/);
      assert.equal(await pathExists(run.capturePath), false);
      assert.equal(await pathExists(derivedRenderRoot), false, `${label} created its derived render root`);
      assert.equal(await pathExists(path.join(sessionRoot, "logs")), false, `${label} created logs`);
      assert.equal(await pathExists(path.join(sessionRoot, "transport", "requests")), false, `${label} created requests`);
      assert.equal(await pathExists(path.join(sessionRoot, "transport", "results")), false, `${label} created results`);
      assert.equal(await pathExists(path.join(sessionRoot, "artifacts")), false, `${label} created artifacts`);
    }

    const installedSessionRoot = path.join(fixture.installRoot, "session");
    const installedDefault = path.join(installedSessionRoot, "renders");
    const installed = await runFakeStartResult({
      fixture,
      label: "installed-session-default",
      extraArgs: ["--session-root", installedSessionRoot],
    });
    assert.equal(installed.result.code, 0, installed.result.stderr || installed.result.stdout);
    assert.equal(await readFile(installed.capturePath, "utf8"), `${installedDefault}\n`);

    const aliasedInstalledSession = path.join(aliasInstallRoot, "session");
    const aliasedInstalled = await runFakeStartResult({
      fixture,
      label: "aliased-installed-session-default",
      extraArgs: ["--session-root", aliasedInstalledSession],
    });
    assert.equal(aliasedInstalled.result.code, 0, aliasedInstalled.result.stderr || aliasedInstalled.result.stdout);
    assert.equal(
      await readFile(aliasedInstalled.capturePath, "utf8"),
      `${path.join(aliasedInstalledSession, "renders")}\n`,
    );

    const externalSessionRoot = path.join(fixture.root, "external-session");
    const external = await runFakeStartResult({
      fixture,
      label: "external-session",
      extraArgs: ["--session-root", externalSessionRoot],
    });
    assert.equal(external.result.code, 0, external.result.stderr || external.result.stdout);
    assert.equal(await readFile(external.capturePath, "utf8"), `${path.join(externalSessionRoot, "renders")}\n`);
  });

  it("revalidates start roots for all C0/DEL controls, reserved overlap, canonical default alias, and probe cleanup", async () => {
    const fixture = await makeStartFixture("validation");
    const regularFile = path.join(fixture.root, "regular-file");
    const symlinkTarget = path.join(fixture.root, "symlink-target");
    const finalSymlink = path.join(fixture.root, "final-symlink");
    await writeFile(regularFile, "file\n", "utf8");
    await mkdir(symlinkTarget, { recursive: true });
    await symlink(symlinkTarget, finalSymlink);
    for (const [label, candidate] of [
      ["relative", "relative/renders"],
      ["file-uri", "file:///tmp/renders"],
      ["root", "/"],
      ["home", fixture.home],
      ["regular-file", regularFile],
      ["final-symlink", finalSymlink],
    ]) {
      const run = await runFakeStartResult({ fixture, label, extraArgs: ["--render-root", candidate] });
      assert.equal(run.result.code, 2, `${label} start root unexpectedly passed`);
      assert.equal(await pathExists(run.capturePath), false);
    }
    for (const codePoint of [...Array.from({ length: 31 }, (_, index) => index + 1), 127]) {
      const bad = path.join(fixture.root, `bad${String.fromCharCode(codePoint)}root`);
      const run = await runFakeStartResult({ fixture, label: `control-${codePoint}`, extraArgs: ["--render-root", bad] });
      assert.equal(run.result.code, 2, `control ${codePoint} unexpectedly passed`);
      assert.equal(await pathExists(run.capturePath), false);
    }

    const overlap = path.join(fixture.installRoot, "session", "artifacts", "nested-renders");
    const overlapRun = await runFakeStartResult({ fixture, label: "overlap", extraArgs: ["--render-root", overlap] });
    assert.equal(overlapRun.result.code, 2);
    assert.equal(await pathExists(overlap), false);

    const defaultAlias = path.join(await realpath(path.dirname(fixture.installRoot)), path.basename(fixture.installRoot), "session", "renders");
    const aliasRun = await runFakeStartResult({ fixture, label: "alias", extraArgs: ["--render-root", defaultAlias] });
    assert.equal(aliasRun.result.code, 0, aliasRun.result.stderr || aliasRun.result.stdout);

    const source = await readFile(START_SOURCE, "utf8");
    const injected = source.replace("await writeProbe(candidate);", 'throw Object.assign(new Error("write probe failed: EACCES"), { code: "EACCES" });');
    assert.notEqual(injected, source);
    const failing = await makeStartFixture("probe-failure", { source: injected });
    const probeRoot = path.join(failing.root, "new-probe-root");
    const probeRun = await runFakeStartResult({ failing, fixture: failing, label: "probe-failure", extraArgs: ["--render-root", probeRoot] });
    assert.equal(probeRun.result.code, 2);
    assert.equal(await pathExists(probeRoot), false);
    assert.deepEqual((await readdir(failing.root)).filter((name) => name.includes("write-probe")), []);
  });

  it("rejects render overlap with every effective start transport/artifact root before side effects", async () => {
    const fixture = await makeStartFixture("effective-roots");
    const targets = [
      { label: "transport", option: "--transport-dir" },
      { label: "artifact", option: "--artifact-root" },
    ];
    for (const target of targets) {
      for (const relation of ["equal", "render-parent", "render-child", "canonical-alias"]) {
        const caseRoot = path.join(fixture.root, `start-${target.label}-${relation}`);
        let renderRoot;
        let effectiveRoot;
        if (relation === "equal") {
          renderRoot = path.join(caseRoot, "shared");
          effectiveRoot = renderRoot;
        } else if (relation === "render-parent") {
          renderRoot = path.join(caseRoot, "render-parent");
          effectiveRoot = path.join(renderRoot, "effective-child");
        } else if (relation === "render-child") {
          effectiveRoot = path.join(caseRoot, "effective-parent");
          renderRoot = path.join(effectiveRoot, "render-child");
        } else {
          const actualParent = path.join(caseRoot, "actual-parent");
          const aliasParent = path.join(caseRoot, "alias-parent");
          await mkdir(actualParent, { recursive: true });
          await symlink(actualParent, aliasParent);
          renderRoot = path.join(actualParent, "canonical-shared");
          effectiveRoot = path.join(aliasParent, "canonical-shared");
        }
        const run = await runFakeStartResult({
          fixture,
          label: `${target.label}-${relation}`,
          extraArgs: ["--render-root", renderRoot, target.option, effectiveRoot],
        });
        assert.equal(run.result.code, 2, `${target.label} ${relation} unexpectedly passed`);
        assert.match(run.result.stderr, new RegExp(`overlaps effective ${target.label}`));
        assert.equal(await pathExists(run.capturePath), false);
        assert.equal(await pathExists(renderRoot), false, `${target.label} ${relation} created the rejected render root`);
        if (target.label === "transport") {
          assert.equal(await pathExists(path.join(effectiveRoot, "requests")), false);
          assert.equal(await pathExists(path.join(effectiveRoot, "results")), false);
        }
      }
    }

    const installedDefault = path.join(fixture.installRoot, "session", "renders");
    for (const target of targets) {
      const run = await runFakeStartResult({
        fixture,
        label: `default-collision-${target.label}`,
        extraArgs: [target.option, installedDefault],
      });
      assert.equal(run.result.code, 2, `installed default + explicit ${target.label} unexpectedly passed`);
      assert.match(run.result.stderr, new RegExp(`overlaps effective ${target.label}`));
      assert.equal(await pathExists(run.capturePath), false);
      assert.equal(await pathExists(installedDefault), false);
      assert.equal(await pathExists(path.join(installedDefault, "requests")), false);
      assert.equal(await pathExists(path.join(installedDefault, "results")), false);
    }
  });

  it("keeps MCP non-empty process env > persisted > default, treats empty as absent, and rejects invalid explicit roots", async () => {
    const fixture = await makeMcpFixture("precedence");
    const persistedRoot = path.join(fixture.root, `persisted 'quoted'`);
    const explicitRoot = path.join(fixture.root, `explicit "quoted"`);
    const defaultRoot = path.join(fixture.installRoot, "session", "renders");
    await Promise.all([persistedRoot, explicitRoot, defaultRoot].map((directory) => mkdir(directory, { recursive: true })));
    await writeFile(fixture.recordPath, `${persistedRoot}\n`, "utf8");

    assert.equal((await runMcpResult({ fixture, label: "explicit", explicit: explicitRoot })).captured, explicitRoot);
    assert.equal((await runMcpResult({ fixture, label: "persisted" })).captured, persistedRoot);
    await rm(fixture.recordPath);
    const canonicalDefaultRoot = path.join(await realpath(fixture.installRoot), "session", "renders");
    assert.equal((await runMcpResult({ fixture, label: "default" })).captured, canonicalDefaultRoot);
    assert.equal((await runMcpResult({ fixture, label: "empty", explicit: "", explicitPresent: true })).captured, canonicalDefaultRoot);

    const regularFile = path.join(fixture.root, "mcp-regular-file");
    const symlinkTarget = path.join(fixture.root, "mcp-symlink-target");
    const finalSymlink = path.join(fixture.root, "mcp-final-symlink");
    await writeFile(regularFile, "file\n", "utf8");
    await mkdir(symlinkTarget, { recursive: true });
    await symlink(symlinkTarget, finalSymlink);
    const invalid = [
      ["relative", "relative/renders"],
      ["file-uri", "file:///tmp/renders"],
      ["root", "/"],
      ["home", fixture.home],
      ["vertical-tab", path.join(fixture.root, `bad\vroot`)],
      ["overlap", path.join(fixture.installRoot, "session", "artifacts")],
      ["regular-file", regularFile],
      ["final-symlink", finalSymlink],
      ["missing-directory", path.join(fixture.root, "missing-mcp-directory")],
    ];
    for (const [label, value] of invalid) {
      const run = await runMcpResult({ fixture, label: `invalid-${label}`, explicit: value, explicitPresent: true });
      assert.equal(run.result.code, 2, `${label} explicit MCP root unexpectedly passed`);
      assert.equal(await pathExists(run.capturePath), false);
    }
  });

  it("rejects MCP render overlap with every effective transport/artifact path before server exec", async () => {
    const fixture = await makeMcpFixture("effective-roots");
    const targetKeys = [
      { label: "transport", key: "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR" },
      { label: "artifact", key: "OPENREAPER_ARTIFACT_ROOT" },
      { label: "live-smoke-artifact", key: "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT" },
    ];
    const safeEnvFor = (label) => ({
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: path.join(fixture.root, `safe-${label}-transport`),
      OPENREAPER_ARTIFACT_ROOT: path.join(fixture.root, `safe-${label}-artifact`),
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: path.join(fixture.root, `safe-${label}-live-smoke-artifact`),
    });

    for (const target of targetKeys) {
      for (const relation of ["equal", "render-parent", "render-child", "canonical-alias"]) {
        const caseRoot = path.join(fixture.root, `mcp-${target.label}-${relation}`);
        let renderRoot;
        let effectiveRoot;
        if (relation === "equal") {
          renderRoot = path.join(caseRoot, "shared");
          effectiveRoot = renderRoot;
        } else if (relation === "render-parent") {
          renderRoot = path.join(caseRoot, "render-parent");
          effectiveRoot = path.join(renderRoot, "effective-child");
        } else if (relation === "render-child") {
          effectiveRoot = path.join(caseRoot, "effective-parent");
          renderRoot = path.join(effectiveRoot, "render-child");
        } else {
          const actualParent = path.join(caseRoot, "actual-parent");
          const aliasParent = path.join(caseRoot, "alias-parent");
          await mkdir(actualParent, { recursive: true });
          await symlink(actualParent, aliasParent);
          renderRoot = path.join(actualParent, "canonical-shared");
          effectiveRoot = path.join(aliasParent, "canonical-shared");
        }
        await mkdir(renderRoot, { recursive: true });
        const extraEnv = safeEnvFor(`${target.label}-${relation}`);
        extraEnv[target.key] = effectiveRoot;
        const run = await runMcpResult({
          fixture,
          label: `${target.label}-${relation}`,
          explicit: renderRoot,
          extraEnv,
        });
        assert.equal(run.result.code, 2, `${target.label} ${relation} MCP overlap unexpectedly passed`);
        assert.match(run.result.stderr, /overlaps effective/);
        assert.equal(await pathExists(run.capturePath), false);
        assert.deepEqual((await readdir(renderRoot)).filter((name) => name.includes("openreaper-write-probe")), []);
        if (target.label === "transport") {
          assert.equal(await pathExists(path.join(effectiveRoot, "requests")), false);
          assert.equal(await pathExists(path.join(effectiveRoot, "results")), false);
        }
      }
    }

    await rm(fixture.recordPath, { force: true });
    const installedDefault = path.join(fixture.installRoot, "session", "renders");
    await mkdir(installedDefault, { recursive: true });
    for (const target of targetKeys) {
      const extraEnv = safeEnvFor(`default-${target.label}`);
      extraEnv[target.key] = installedDefault;
      const run = await runMcpResult({
        fixture,
        label: `default-collision-${target.label}`,
        explicitPresent: false,
        extraEnv,
      });
      assert.equal(run.result.code, 2, `MCP default + explicit ${target.label} unexpectedly passed`);
      assert.match(run.result.stderr, /overlaps effective/);
      assert.equal(await pathExists(run.capturePath), false);
      assert.equal(await pathExists(path.join(installedDefault, "requests")), false);
      assert.equal(await pathExists(path.join(installedDefault, "results")), false);
    }
  });

  it("rejects unsafe installer roots before replacing an existing install", async () => {
    const fixture = await makeInstallerFixture();
    await mkdir(fixture.installRoot, { recursive: true });
    const marker = path.join(fixture.installRoot, "do-not-replace.txt");
    await writeFile(marker, "still-here\n", "utf8");
    const regularFile = path.join(fixture.root, "regular-file");
    await writeFile(regularFile, "not-a-directory\n", "utf8");
    const symlinkTarget = path.join(fixture.root, "symlink-target");
    const finalSymlink = path.join(fixture.root, "final-symlink");
    await mkdir(symlinkTarget, { recursive: true });
    await symlink(symlinkTarget, finalSymlink);

    const cases = [
      ["relative", "relative/renders"],
      ["file URI", "file:///tmp/renders"],
      ["filesystem root", path.parse(fixture.installRoot).root],
      ["home", fixture.home],
      ["install root", fixture.installRoot],
      ["session root", path.join(fixture.installRoot, "session")],
      ["transport root", path.join(fixture.installRoot, "session", "transport")],
      ["artifact root", path.join(fixture.installRoot, "session", "artifacts")],
      ["contains install root", path.dirname(fixture.installRoot)],
      ["regular file", regularFile],
      ["final symlink", finalSymlink],
      ["vertical tab", path.join(fixture.root, "bad\vroot")],
    ];

    for (const [label, candidate] of cases) {
      const result = await runInstaller(fixture, ["--render-root", candidate]);
      assert.notEqual(result.code, 0, `${label} unexpectedly passed`);
      assert.equal(await readFile(marker, "utf8"), "still-here\n", `${label} replaced the install before validation`);
    }
  });

  it("surfaces injected installer write-probe failure before destructive replacement", async () => {
    const source = await readFile(INSTALLER_SOURCE, "utf8");
    const injected = source.replace(
      "await boundedWriteProbe(absolute);",
      'throw new Error(`Managed render root write probe failed for ${absolute}: EACCES: fixture denied`);',
    );
    const fixture = await makeInstallerFixture({ installerSource: injected });
    await mkdir(fixture.installRoot, { recursive: true });
    const marker = path.join(fixture.installRoot, "marker.txt");
    await writeFile(marker, "unchanged\n", "utf8");

    const result = await runInstaller(fixture, ["--render-root", path.join(fixture.root, "probe-failure-root")]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /write probe failed.*EACCES/i);
    assert.equal(await readFile(marker, "utf8"), "unchanged\n");

    const freshFixture = await makeInstallerFixture({ installerSource: injected });
    const freshResult = await runInstaller(freshFixture);
    assert.notEqual(freshResult.code, 0);
    assert.equal(await pathExists(freshFixture.installRoot), false);
  });

  it("accepts /tmp to /private/tmp canonical aliases", async () => {
    const fixture = await makeInstallerFixture();
    const aliasRoot = path.join("/tmp", `openreaper-b2-alias-${path.basename(fixture.root)}`, "renders");
    FIXTURE_ROOTS.push(path.dirname(aliasRoot));
    const result = await runInstaller(fixture, ["--render-root", aliasRoot]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(parseInstallerReport(result.stdout).render_root.path, aliasRoot);
    if (process.platform === "darwin") assert.match(await realpath(aliasRoot), /^\/private\/tmp\//);
  });

  it("preserves non-empty default output on uninstall and never follows the default symlink", async () => {
    const fixture = await makeInstallerFixture();
    assert.equal((await runInstaller(fixture)).code, 0);
    await writeFile(path.join(fixture.installRoot, "session", "renders", "final.wav"), "final\n", "utf8");

    const uninstall = await runUninstaller(fixture);
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    const report = JSON.parse(uninstall.stdout);
    assert.match(report.render_root.preserved_default_at, /\.openreaper-render-preservation-[^/]+\/renders$/);
    assert.equal(await readFile(path.join(report.render_root.preserved_default_at, "final.wav"), "utf8"), "final\n");
    await assert.rejects(access(fixture.installRoot));

    const symlinkFixture = await makeInstallerFixture();
    await mkdir(path.join(symlinkFixture.installRoot, "session"), { recursive: true });
    const externalTarget = path.join(symlinkFixture.root, "external-target");
    await mkdir(externalTarget, { recursive: true });
    await writeFile(path.join(externalTarget, "keep.wav"), "keep\n", "utf8");
    await symlink(externalTarget, path.join(symlinkFixture.installRoot, "session", "renders"));
    const symlinkUninstall = await runUninstaller(symlinkFixture);
    assert.equal(symlinkUninstall.code, 0, symlinkUninstall.stderr || symlinkUninstall.stdout);
    const symlinkReport = JSON.parse(symlinkUninstall.stdout);
    assert.equal(symlinkReport.render_root.record_status, "missing");
    assert.equal(symlinkReport.render_root.symlink_followed, false);
    assert.match(symlinkReport.warnings.join("\n"), /will not be followed/);
    assert.equal(await readFile(path.join(externalTarget, "keep.wav"), "utf8"), "keep\n");
  });

  it("removes only a fresh partial install tree after deterministic copy failure", async () => {
    const source = await readFile(INSTALLER_SOURCE, "utf8");
    const injected = source.replace(
      "await cp(packageRoot, installRoot, {",
      'throw Object.assign(new Error("fixture copy failure"), { code: "EIO" });\n        await cp(packageRoot, installRoot, {',
    );
    assert.notEqual(injected, source);
    const fixture = await makeInstallerFixture({ installerSource: injected });
    const externalRoot = path.join(fixture.root, "external-user-renders");
    await mkdir(externalRoot, { recursive: true });
    await writeFile(path.join(externalRoot, "keep.wav"), "keep\n", "utf8");

    const result = await runInstaller(fixture, ["--render-root", externalRoot]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /fixture copy failure/);
    assert.equal(await pathExists(fixture.installRoot), false);
    assert.equal(await readFile(path.join(externalRoot, "keep.wav"), "utf8"), "keep\n");

    const postCopyInjected = source.replace(
      "await chmod(mcpCommand, 0o755);",
      'throw Object.assign(new Error("fixture post-copy failure"), { code: "EIO" });',
    );
    const postCopyFixture = await makeInstallerFixture({ installerSource: postCopyInjected });
    const postCopyResult = await runInstaller(postCopyFixture);
    assert.notEqual(postCopyResult.code, 0);
    assert.match(postCopyResult.stderr, /fixture post-copy failure/);
    assert.equal(await pathExists(postCopyFixture.installRoot), false);
  });

  it("uses atomic containers despite lookalike collisions and leaves source untouched on preservation rename failure", async () => {
    const fixture = await makeInstallerFixture();
    assert.equal((await runInstaller(fixture)).code, 0);
    await writeFile(path.join(fixture.installRoot, "session", "renders", "keep.wav"), "keep\n", "utf8");
    const collision = path.join(path.dirname(fixture.installRoot), ".openreaper-render-preservation-collision");
    await mkdir(collision, { recursive: true });
    await writeFile(path.join(collision, "sentinel"), "sentinel\n", "utf8");
    const customRoot = path.join(fixture.root, "custom");
    const success = await runInstaller(fixture, ["--render-root", customRoot]);
    assert.equal(success.code, 0, success.stderr || success.stdout);
    assert.equal(await readFile(path.join(collision, "sentinel"), "utf8"), "sentinel\n");

    const source = await readFile(INSTALLER_SOURCE, "utf8");
    const injected = source.replace(
      "await rename(defaultRenderRoot, preservationRoot);",
      'throw Object.assign(new Error("fixture preservation rename failure"), { code: "EACCES" });',
    );
    const failing = await makeInstallerFixture({ installerSource: injected });
    assert.equal((await runInstaller(failing)).code, 0);
    const sourceOutput = path.join(failing.installRoot, "session", "renders", "source.wav");
    await writeFile(sourceOutput, "source\n", "utf8");
    const result = await runInstaller(failing, ["--render-root", path.join(failing.root, "custom")]);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(sourceOutput, "utf8"), "source\n");
    assert.deepEqual((await readdir(path.dirname(failing.installRoot))).filter((name) => name.startsWith(".openreaper-render-preservation-")), []);
  });

  it("leaves a preexisting install untouched on backup rename failure and rolls it back after copy failure", async () => {
    const renameSource = await readFile(INSTALLER_SOURCE, "utf8");
    const renameInjected = renameSource.replace(
      "await rename(installRoot, backupRoot);",
      'throw Object.assign(new Error("fixture backup rename failure"), { code: "EACCES" });',
    );
    const renameFixture = await makeInstallerFixture({ installerSource: renameInjected });
    await mkdir(path.join(renameFixture.installRoot, "session", "renders"), { recursive: true });
    const renameMarker = path.join(renameFixture.installRoot, "marker.txt");
    await writeFile(renameMarker, "rename-source\n", "utf8");
    const collision = path.join(path.dirname(renameFixture.installRoot), ".openreaper-install-backup-collision");
    await mkdir(collision, { recursive: true });
    await writeFile(path.join(collision, "sentinel"), "sentinel\n", "utf8");
    const renameResult = await runInstaller(renameFixture);
    assert.notEqual(renameResult.code, 0);
    assert.equal(await readFile(renameMarker, "utf8"), "rename-source\n");
    assert.equal(await readFile(path.join(collision, "sentinel"), "utf8"), "sentinel\n");
    assert.deepEqual((await readdir(path.dirname(renameFixture.installRoot))).filter((name) => name.startsWith(".openreaper-install-backup-") && name !== path.basename(collision)), []);

    const rollbackFixture = await makeInstallerFixture();
    assert.equal((await runInstaller(rollbackFixture)).code, 0);
    const rollbackMarker = path.join(rollbackFixture.installRoot, "marker.txt");
    const rollbackOutput = path.join(rollbackFixture.installRoot, "session", "renders", "output.wav");
    await writeFile(rollbackMarker, "rollback-source\n", "utf8");
    await writeFile(rollbackOutput, "output\n", "utf8");
    const copyInjected = renameSource.replace(
      "await cp(packageRoot, installRoot, {",
      'throw Object.assign(new Error("fixture upgrade copy failure"), { code: "EIO" });\n        await cp(packageRoot, installRoot, {',
    );
    await writeFile(rollbackFixture.installerPath, copyInjected, "utf8");
    const rollbackResult = await runInstaller(rollbackFixture);
    assert.notEqual(rollbackResult.code, 0);
    assert.equal(await readFile(rollbackMarker, "utf8"), "rollback-source\n");
    assert.equal(await readFile(rollbackOutput, "utf8"), "output\n");
    assert.deepEqual((await readdir(path.dirname(rollbackFixture.installRoot))).filter((name) => name.startsWith(".openreaper-install-backup-")), []);
  });

  it("leaves uninstall source untouched and cleans the allocated container on rename failure", async () => {
    const source = await readFile(UNINSTALLER_SOURCE, "utf8");
    const injected = source.replace(
      "await rename(defaultRenderRoot, preservationRoot);",
      'throw Object.assign(new Error("fixture uninstall rename failure"), { code: "EACCES" });',
    );
    const fixture = await makeInstallerFixture({ uninstallerSource: injected });
    const defaultRoot = path.join(fixture.installRoot, "session", "renders");
    await mkdir(defaultRoot, { recursive: true });
    await writeFile(path.join(defaultRoot, "keep.wav"), "keep\n", "utf8");

    const result = await runUninstaller(fixture);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(path.join(defaultRoot, "keep.wav"), "utf8"), "keep\n");
    assert.deepEqual((await readdir(path.dirname(fixture.installRoot))).filter((name) => name.startsWith(".openreaper-render-preservation-")), []);
  });

  it("rejects missing or empty values for every start value option and installer/uninstaller roots", async () => {
    const fixture = await makeStartFixture("missing-options");
    for (const option of [
      "--project-path",
      "--reaper-binary",
      "--reaper-app",
      "--session-root",
      "--render-root",
      "--transport-dir",
      "--artifact-root",
      "--bridge-owner",
      "--bridge-generation",
    ]) {
      for (const args of [[option], [option, ""]]) {
        const result = await runCaptured(fixture.startPath, args, { cwd: fixture.root, env: { ...process.env, HOME: fixture.home } });
        assert.equal(result.code, 2, `${option} missing value did not exit 2`);
        assert.match(result.stderr, /requires a non-empty value/);
        assert.doesNotMatch(result.stderr, /shift count/i);
      }
    }

    for (const arg of ["--render-root=", "--session-root="]) {
      const result = await runCaptured(fixture.startPath, [arg], { cwd: fixture.root, env: { ...process.env, HOME: fixture.home } });
      assert.equal(result.code, 2);
      assert.match(result.stderr, /requires a non-empty value/);
    }

    const installerFixture = await makeInstallerFixture();
    const installMissing = await runCaptured(process.execPath, [installerFixture.installerPath, "--render-root", "--skip-client-config"], {
      cwd: installerFixture.root,
      env: { ...process.env, HOME: installerFixture.home },
    });
    assert.equal(installMissing.code, 2);
    const installEmptyEquals = await runCaptured(process.execPath, [installerFixture.installerPath, "--install-root="], {
      cwd: installerFixture.root,
      env: { ...process.env, HOME: installerFixture.home },
    });
    assert.equal(installEmptyEquals.code, 2);
    const uninstallFixture = await makeInstallerFixture();
    const uninstallMissing = await runCaptured(process.execPath, [uninstallFixture.uninstallerPath, "--install-root"], {
      cwd: uninstallFixture.root,
      env: { ...process.env, HOME: uninstallFixture.home },
    });
    assert.equal(uninstallMissing.code, 2);
    const uninstallEmptyEquals = await runCaptured(process.execPath, [uninstallFixture.uninstallerPath, "--install-root="], {
      cwd: uninstallFixture.root,
      env: { ...process.env, HOME: uninstallFixture.home },
    });
    assert.equal(uninstallEmptyEquals.code, 2);
    const packageMissing = await runCaptured(process.execPath, [PACKAGE_BUILDER_SOURCE, "--out-dir"], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    assert.equal(packageMissing.code, 2);
    const packageEmptyEquals = await runCaptured(process.execPath, [PACKAGE_BUILDER_SOURCE, "--out-dir="], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    assert.equal(packageEmptyEquals.code, 2);
  });

  it("passes project and extra arguments before the trusted launcher in a direct binary launch", async () => {
    const fixture = await makeStartFixture("direct-argv-order");
    const projectPath = path.join(fixture.root, "project with spaces.RPP");
    const configPath = path.join(fixture.root, "fixture config.ini");
    await writeFile(projectPath, "<REAPER_PROJECT 0.1\n>\n", "utf8");
    await writeFile(configPath, "fixture=true\n", "utf8");

    const run = await runFakeStartResult({
      fixture,
      label: "direct-argv-order",
      extraArgs: ["--project-path", projectPath, "-cfgfile", configPath],
    });
    assert.equal(run.result.code, 0, run.result.stderr || run.result.stdout);
    assert.deepEqual(JSON.parse(await readFile(run.argvCapturePath, "utf8")), [
      "-newinst",
      "-nosplash",
      projectPath,
      "-cfgfile",
      configPath,
    ]);
  });

  it("uses an explicit contained REAPER resource root without changing the user-default launch", async () => {
    const fixture = await makeStartFixture("contained-reaper-resource-root");
    const resourceRoot = path.join(fixture.root, "contained REAPER config");

    const isolated = await runFakeStartResult({
      fixture,
      label: "contained-reaper-resource-root",
      extraArgs: ["--reaper-resource-root", resourceRoot],
    });
    assert.equal(isolated.result.code, 0, isolated.result.stderr || isolated.result.stdout);
    assert.equal((await lstat(resourceRoot)).isDirectory(), true);
    assert.deepEqual(JSON.parse(await readFile(isolated.argvCapturePath, "utf8")), [
      "-newinst",
      "-nosplash",
      "-cfgfile",
      path.join(resourceRoot, "REAPER.ini"),
    ]);
    assert.match(isolated.result.stdout, /reaper-config-mode=explicit_cfgfile/u);
    assert.match(isolated.result.stdout, /reaper-resource-root=/u);

    const conflict = await runFakeStartResult({
      fixture,
      label: "contained-reaper-resource-root-conflict",
      extraArgs: ["--reaper-resource-root", resourceRoot, "-cfgfile", path.join(fixture.root, "other.ini")],
    });
    assert.equal(conflict.result.code, 2);
    assert.match(conflict.result.stderr, /cannot be combined with a REAPER -cfgfile argument/u);
    assert.equal(conflict.fixturePid, null);
  });

  it("restores LaunchServices values with spaces, empty-but-set presence, and unset presence", async () => {
    const harness = await makeLaunchServicesHarness("presence");
    await harness.setState("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR", true, "previous transport with spaces");
    await harness.setState(RENDER_ENV, true, "");
    await harness.setState("OPENREAPER_LIVE_BRIDGE_OWNER", false, "");
    const selectedRoot = path.join(harness.root, `selected 'quoted' root`);

    const result = await harness.run(["--render-root", selectedRoot]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(harness.capturePath, "utf8"), `${selectedRoot}\n`);
    assert.ok(Number.isInteger(result.fixturePid));
    assert.equal(isProcessAlive(result.fixturePid), false);
    assert.deepEqual(await harness.getState("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"), { present: true, value: "previous transport with spaces" });
    assert.deepEqual(await harness.getState(RENDER_ENV), { present: true, value: "" });
    assert.deepEqual(await harness.getState("OPENREAPER_LIVE_BRIDGE_OWNER"), { present: false, value: "" });
    await harness.assertLockRemoved();
  });

  it("passes project and extra arguments before the trusted launcher through LaunchServices", async () => {
    const harness = await makeLaunchServicesHarness("argv-order");
    const projectPath = path.join(harness.root, "project with spaces.RPP");
    const configPath = path.join(harness.root, "fixture config.ini");
    await writeFile(projectPath, "<REAPER_PROJECT 0.1\n>\n", "utf8");
    await writeFile(configPath, "fixture=true\n", "utf8");

    const result = await harness.run(["--project-path", projectPath, "-cfgfile", configPath]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(await readFile(harness.argvCapturePath, "utf8")), [
      "-newinst",
      "-nosplash",
      projectPath,
      "-cfgfile",
      configPath,
    ]);
    await harness.assertLockRemoved();
  });

  it("waits for delayed LaunchServices heartbeat readiness and drains the active cleanup registry", async () => {
    const harness = await makeLaunchServicesHarness("delayed-pid", { fakePidDelayMs: 2500 });
    const selectedRoot = path.join(harness.root, "delayed-pid-selected");
    const result = await harness.launchForSuiteDrain(["--render-root", selectedRoot], { waitSeconds: 4 });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.cleanupState.pidPresentWhenWrapperSettled, true, "startup returned before the fake heartbeat became ready");
    assert.equal(harness.activeCleanupCount(), 1);
    await drainActiveFixtureCleanups();
    assert.equal(result.cleanupState.launchRequested, true);
    assert.ok(Number.isInteger(result.cleanupState.fixturePid));
    assert.equal(isProcessAlive(result.cleanupState.fixturePid), false);
    assert.equal(await readFile(harness.capturePath, "utf8"), `${selectedRoot}\n`);
    assert.equal(harness.activeCleanupCount(), 0);
  });

  it("keeps LaunchServices values until a delayed startup hook has seen them", async () => {
    const harness = await makeLaunchServicesHarness("startup-hook-race", { startupHookEnvRace: true });
    await harness.seedDistinctStates();
    const selectedRoot = path.join(harness.root, "startup-hook-race-selected");
    const result = await harness.run(["--render-root", selectedRoot], { waitSeconds: 2 });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /reaper-pid=/);
    assert.equal(await readFile(harness.capturePath, "utf8"), `${selectedRoot}\n`);
    assert.match(await readFile(harness.startupStatusPath, "utf8"), /"stage":"bridge_dofile_succeeded"/);
    await harness.assertSeededStatesRestored();
    await harness.assertLockRemoved();
  });

  it("inspects startup dialogs before accepting matching Bridge readiness", async () => {
    const source = await readFile(START_SOURCE, "utf8");
    const functionStart = source.indexOf("wait_for_startup_readiness() {");
    const functionEnd = source.indexOf("\n}\n\ntrap 'launchservices_cleanup_on_exit'", functionStart);
    assert.ok(functionStart >= 0 && functionEnd > functionStart, "startup readiness function must remain inspectable");
    const readinessSource = source.slice(functionStart, functionEnd);
    const dialogCheck = readinessSource.indexOf('dialog_result="$(run_startup_dialog_observer)"');
    const blocker = readinessSource.indexOf('report_startup_user_action_required "${dialog_result}"', dialogCheck);
    const heartbeatCheck = readinessSource.indexOf("if bridge_heartbeat_ready; then", dialogCheck);
    const publicProbe = readinessSource.indexOf("verify_public_bridge_read || return 1", heartbeatCheck);
    assert.ok(dialogCheck >= 0, "readiness must inspect startup dialogs");
    assert.ok(blocker > dialogCheck, "dialog blockers must be reported after inspection");
    assert.ok(heartbeatCheck > dialogCheck, "readiness must accept heartbeat only after dialog inspection");
    assert.ok(publicProbe > heartbeatCheck, "matching Bridge readiness must include a real public read probe");
    assert.match(readinessSource, /if ! startup_dialog_result_is_safe "\$\{dialog_result\}"; then[\s\S]+pending_dialog_blocker/u);
    assert.match(readinessSource, /pending_dialog_blocker[\s\S]+sleep 0\.25[\s\S]+report_startup_user_action_required/u);
    assert.match(source, /startup-dialog-blocker=\$\{dialog_result\}/u);

    const hookStart = source.indexOf("wait_for_startup_hook() {");
    const hookEnd = source.indexOf("\n}\n\nverify_public_bridge_read()", hookStart);
    const hookSource = source.slice(hookStart, hookEnd);
    const hookDialogCheck = hookSource.indexOf('dialog_result="$(run_startup_dialog_observer)"');
    const stageRecheck = hookSource.indexOf("if startup_status_stage_ready; then", hookDialogCheck);
    const hookBlocker = hookSource.indexOf('report_startup_user_action_required "${dialog_result}"', hookDialogCheck);
    assert.ok(hookBlocker > hookDialogCheck, "startup-hook wait must report a stable dialog blocker");
    assert.ok(stageRecheck > hookDialogCheck, "startup-hook wait must recheck the stage after dialog inspection");
    assert.ok(stageRecheck > hookBlocker, "startup-hook wait must accept a stage only after blocker handling");
    assert.match(source, /blocked_unknown_dialog:title=/u);
    assert.match(source, /blocked_user_decision:title=/u);
    const safeStart = source.indexOf("startup_dialog_result_is_safe() {");
    const safeEnd = source.indexOf("\n}\n\nrecord_dialog_result()", safeStart);
    assert.ok(safeStart >= 0 && safeEnd > safeStart, "startup dialog safety classifier must remain inspectable");
    const safeClassifier = source.slice(safeStart, safeEnd);
    assert.match(safeClassifier, /no_safe_dialog\|ignored_reascript_run_status_window\)/u);
    assert.match(safeClassifier, /esac\s+return 1/u, "all other observer results must remain unsafe");
    assert.doesNotMatch(safeClassifier, /click|perform action|dismiss/u);
  });

  it("serializes staggered LaunchServices starts with one stable installed-scope lock", async () => {
    const harness = await makeLaunchServicesHarness("staggered-lock");
    await harness.seedDistinctStates();
    await writeFile(path.join(harness.controlRoot, "hold-set-at"), "3\n", "utf8");
    const selectedRoot = path.join(harness.root, "selected-concurrent");
    const first = await harness.spawn(["--render-root", selectedRoot], { waitSeconds: 1 });
    let setupError = null;
    let logAtHold = "";
    let captureAtHold = false;
    let second = null;
    let logAfterSecond = "";
    try {
      await waitForFile(path.join(harness.controlRoot, "hold-reached"));
      logAtHold = await readFile(harness.logPath, "utf8");
      captureAtHold = await pathExists(harness.capturePath);
      second = await harness.run(["--render-root", selectedRoot]);
      logAfterSecond = await readFile(harness.logPath, "utf8");
    } catch (error) {
      setupError = error;
    } finally {
      await writeFile(path.join(harness.controlRoot, "release-hold"), "1\n", "utf8");
    }
    const firstResult = await first.result;
    if (setupError) throw setupError;

    assert.equal(captureAtHold, false);
    assert.notEqual(second.code, 0);
    assert.match(second.stderr, /environment lock is already held/);
    assert.match(second.stderr, /will not be auto-broken/);
    assert.match(second.stderr, new RegExp(harness.lockPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(logAfterSecond, logAtHold, "second start reached launchctl despite the global lock");
    assert.doesNotMatch(second.stdout, /startup-status=ready/);
    assert.equal(firstResult.code, 0, firstResult.stderr || firstResult.stdout);
    assert.ok(Number.isInteger(firstResult.fixturePid));
    assert.equal(isProcessAlive(firstResult.fixturePid), false);
    await harness.assertSeededStatesRestored();
    await harness.assertLockRemoved();
    assert.equal(await readFile(harness.capturePath, "utf8"), `${selectedRoot}\n`);
  });

  it("does not inspect or mutate LaunchServices when a foreign stable lock already exists", async () => {
    const harness = await makeLaunchServicesHarness("existing-lock");
    await harness.seedDistinctStates();
    await mkdir(harness.lockPath, { recursive: true });
    await writeFile(path.join(harness.lockPath, ".owner-token"), "foreign-token", "utf8");
    await writeFile(path.join(harness.lockPath, "owner.meta"), "pid=99999\nstarted_utc=fixture\ntoken=foreign-token\n", "utf8");
    await writeFile(path.join(harness.lockPath, "foreign-sentinel"), "do-not-remove\n", "utf8");

    const result = await harness.run(["--render-root", path.join(harness.root, "selected")]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /environment lock is already held/);
    assert.match(result.stderr, /will not be auto-broken/);
    assert.match(result.stderr, new RegExp(harness.lockPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(await readTextIfExists(harness.logPath), "");
    assert.equal(await readFile(path.join(harness.lockPath, ".owner-token"), "utf8"), "foreign-token");
    assert.equal(await readFile(path.join(harness.lockPath, "foreign-sentinel"), "utf8"), "do-not-remove\n");
    assert.equal(await pathExists(harness.capturePath), false);
    await harness.assertSeededStatesRestored();
  });

  it("cleans only its own pre-mutation lock when bounded owner metadata setup fails", async () => {
    const source = await readFile(START_SOURCE, "utf8");
    const needle = '  if ! {\n    print -r -- "pid=$$"';
    const injected = source.replace(
      needle,
      '  if ! false; then\n    fail_launchservices_lock_setup "fixture bounded owner metadata failure before environment mutation." || return 1\n    return 1\n  fi\n  if ! {\n    print -r -- "pid=$$"',
    );
    assert.notEqual(injected, source);
    const harness = await makeLaunchServicesHarness("metadata-failure", { source: injected });
    const result = await harness.run(["--render-root", path.join(harness.root, "selected")]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /fixture bounded owner metadata failure/);
    assert.equal(await readTextIfExists(harness.logPath), "");
    await harness.assertLockRemoved();
    assert.equal(await pathExists(harness.capturePath), false);
  });

  it("restores the baseline but retains lock and snapshot when ownership changes before a signal trap releases", async () => {
    const harness = await makeLaunchServicesHarness("foreign-token-trap");
    await harness.seedDistinctStates();
    await writeFile(path.join(harness.controlRoot, "hold-set-at"), "1\n", "utf8");
    const running = await harness.spawn(["--render-root", path.join(harness.root, "selected")], { waitSeconds: 4 });
    let setupError = null;
    try {
      await waitForFile(path.join(harness.controlRoot, "hold-reached"));
      await writeFile(path.join(harness.lockPath, ".owner-token"), "foreign-token", "utf8");
      running.child.kill("SIGTERM");
    } catch (error) {
      setupError = error;
      running.child.kill("SIGTERM");
    } finally {
      await writeFile(path.join(harness.controlRoot, "release-hold"), "1\n", "utf8");
    }
    const result = await running.result;
    if (setupError) throw setupError;

    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /startup-status=ready/);
    assert.match(result.stderr, /refusing to release LaunchServices lock not owned by this process/);
    assert.equal(await pathExists(harness.lockPath), true);
    assert.equal(await pathExists(harness.snapshotPath), true);
    assert.equal(await readFile(path.join(harness.lockPath, ".owner-token"), "utf8"), "foreign-token");
    await harness.assertSeededStatesRestored();
  });

  it("restores only attempted LaunchServices keys after an Nth setenv failure", async () => {
    const harness = await makeLaunchServicesHarness("set-failure");
    await harness.seedDistinctStates();
    await writeFile(path.join(harness.controlRoot, "fail-set-at"), "4\n", "utf8");
    const result = await harness.run(["--render-root", path.join(harness.root, "selected")]);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /startup-status=ready/);
    await harness.assertSeededStatesRestored();
    await harness.assertLockRemoved();
    const log = await readFile(harness.logPath, "utf8");
    const attemptedKeys = ["OPENREAPER_SESSION_ROOT", ...harness.keys.slice(0, 4)];
    for (const key of attemptedKeys) {
      assert.match(log, new RegExp(`restore:(?:set|unset):${key}`));
    }
    for (const key of harness.keys.slice(4)) {
      assert.doesNotMatch(log, new RegExp(`restore:(?:set|unset):${key}`));
    }
  });

  it("bounds a stalled LaunchServices environment command before launching REAPER", async () => {
    const harness = await makeLaunchServicesHarness("bounded-launchctl-stall");
    await harness.seedDistinctStates();
    await writeFile(path.join(harness.controlRoot, "hold-set-at"), "1\n", "utf8");
    const startedAt = Date.now();
    const result = await harness.run(["--render-root", path.join(harness.root, "selected")]);
    assert.notEqual(result.code, 0);
    assert.equal(Date.now() - startedAt < 10_000, true);
    assert.equal(result.launchRequested, false);
    assert.match(result.stderr, /failed to set LaunchServices env/u);
    await harness.assertSeededStatesRestored();
    await harness.assertLockRemoved();
  });

  it("fails before mutation when a LaunchServices getenv snapshot query stalls", async () => {
    const harness = await makeLaunchServicesHarness("bounded-launchctl-getenv-stall");
    await harness.seedDistinctStates();
    await writeFile(path.join(harness.controlRoot, "hold-getenv-at"), "1\n", "utf8");
    const startedAt = Date.now();
    const result = await harness.run(["--render-root", path.join(harness.root, "selected")]);
    assert.notEqual(result.code, 0);
    assert.equal(Date.now() - startedAt < 10_000, true);
    assert.equal(result.launchRequested, false);
    assert.match(result.stderr, /failed to read LaunchServices env/u);
    assert.match(result.stderr, /launchctl status=124/u);
    await harness.assertSeededStatesRestored();
    await harness.assertLockRemoved();
    const stalledPid = Number((await readFile(path.join(harness.controlRoot, "getenv-stall.pid"), "utf8")).trim());
    assert.equal(Number.isSafeInteger(stalledPid), true);
    await waitForDeadProcess(stalledPid, 100, 20);
    const log = await readFile(harness.logPath, "utf8");
    assert.doesNotMatch(log, /(?:set|restore):(set|unset):/u);
  });

  it("restores LaunchServices state after open failure and PID wait failure", async () => {
    for (const mode of ["open", "pid"]) {
      const harness = await makeLaunchServicesHarness(`${mode}-failure`);
      await harness.seedDistinctStates();
      await writeFile(path.join(harness.controlRoot, mode === "open" ? "fail-open" : "skip-pid"), "1\n", "utf8");
      const result = await harness.run(["--render-root", path.join(harness.root, "selected")]);
      assert.notEqual(result.code, 0, `${mode} failure unexpectedly succeeded`);
      assert.doesNotMatch(result.stdout, /startup-status=ready/);
      await harness.assertSeededStatesRestored();
      await harness.assertLockRemoved();
    }
  });

  it("reaps the owned signal process group before rejecting a missing mutation marker", async () => {
    const root = await freshTmp("openreaper-b2-signal-timeout-");
    const childScript = path.join(root, "signal-timeout-child.zsh");
    const grandchildScript = path.join(root, "signal-timeout-grandchild.cjs");
    const childPidPath = path.join(root, "child.pid");
    const childExitedPath = path.join(root, "child.exited");
    const grandchildPidPath = path.join(root, "grandchild.pid");
    const missingMarker = path.join(root, "mutation-never-written");
    await writeFile(grandchildScript, `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`, "utf8");
    await writeFile(childScript, `#!/bin/zsh\ntrap 'print -rn -- exited > ${shellQuote(childExitedPath)}; exit 143' TERM\nprint -rn -- "$$" > ${shellQuote(childPidPath)}\nnohup ${shellQuote(process.execPath)} ${shellQuote(grandchildScript)} >/dev/null 2>&1 &\nwhile true; do :; done\n`, "utf8");
    await chmod(childScript, 0o755);

    let childPid = null;
    let grandchildPid = null;
    let caught = null;
    try {
      try {
        await runCapturedAndSignal(childScript, [], {
          cwd: root,
          env: { ...process.env },
          mutationMarker: missingMarker,
          markerAttempts: 40,
          markerDelayMs: 25,
          cleanupTermAttempts: 12,
          cleanupKillAttempts: 120,
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, "missing mutation marker unexpectedly resolved");
      assert.match(caught.message, /timed out waiting for fixture mutation marker/);
      await waitForFile(childPidPath, { attempts: 1, delayMs: 1 });
      await waitForFile(grandchildPidPath, { attempts: 1, delayMs: 1 });
      childPid = await readFixturePid(childPidPath);
      grandchildPid = await readFixturePid(grandchildPidPath);
      assert.equal(await pathExists(childExitedPath), true, "helper rejected before observing the child TERM trap exit marker");
      assert.equal(isProcessAlive(childPid), false, `immediate child ${childPid} survived helper rejection`);
      assert.equal(isProcessAlive(grandchildPid), false, `nohup grandchild ${grandchildPid} survived helper rejection`);
      assert.equal(isProcessGroupAlive(childPid), false, `owned process group ${childPid} survived helper rejection`);
    } finally {
      if (childPid === null && await pathExists(childPidPath)) childPid = await readFixturePid(childPidPath);
      if (grandchildPid === null && await pathExists(grandchildPidPath)) grandchildPid = await readFixturePid(grandchildPidPath);
      if (childPid !== null && isProcessGroupAlive(childPid)) signalProcessGroup(childPid, "SIGKILL");
      for (const pid of [childPid, grandchildPid]) {
        if (pid !== null && isProcessAlive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch (error) {
            if (error?.code !== "ESRCH") throw error;
          }
          await waitForDeadProcess(pid, 120, 25);
        }
      }
    }
  });

  it("propagates signal-spawn ENOENT without unhandled rejection or registry residue", async () => {
    const root = await freshTmp("openreaper-b2-signal-spawn-enoent-");
    const missingExecutable = path.join(root, "does-not-exist");
    const missingMarker = path.join(root, "mutation-never-written");
    const baselineEntries = new Set(ACTIVE_FIXTURE_CLEANUPS);
    const unhandled = [];
    const onUnhandledRejection = (reason, promise) => {
      unhandled.push({ reason, promise });
    };
    process.on("unhandledRejection", onUnhandledRejection);
    let caught = null;
    try {
      try {
        await runCapturedAndSignal(missingExecutable, [], {
          cwd: root,
          env: { ...process.env },
          mutationMarker: missingMarker,
          markerAttempts: 20,
          markerDelayMs: 10,
          cleanupTermAttempts: 10,
          cleanupKillAttempts: 10,
        });
      } catch (error) {
        caught = error;
      }

      assert.ok(caught, "missing executable unexpectedly resolved");
      assert.equal(caught.code, "ENOENT");
      assert.match(caught.message, /ENOENT|does-not-exist/);
      // Let Node complete both the rejection-check turn and a following timer/check turn before auditing.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 25));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(unhandled.length, 0, `unexpected unhandled rejection(s): ${unhandled.map(({ reason }) => String(reason)).join(" | ")}`);
      assert.equal(ACTIVE_FIXTURE_CLEANUPS.size, baselineEntries.size);
      for (const entry of baselineEntries) assert.equal(ACTIVE_FIXTURE_CLEANUPS.has(entry), true);

      await rm(root, { recursive: true, force: true });
      assert.equal(await pathExists(root), false, "ENOENT fixture root was not safe to remove after registry cleanup");
    } finally {
      // Keep the audit listener installed for one final check turn, then clean only entries created by this test.
      await new Promise((resolve) => setImmediate(resolve));
      process.off("unhandledRejection", onUnhandledRejection);
      for (const entry of [...ACTIVE_FIXTURE_CLEANUPS]) {
        if (!baselineEntries.has(entry)) await runActiveFixtureCleanup(entry);
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores LaunchServices state on SIGTERM after environment mutation", async () => {
    const harness = await makeLaunchServicesHarness("signal-cleanup");
    await harness.seedDistinctStates();
    await writeFile(path.join(harness.controlRoot, "skip-pid"), "1\n", "utf8");
    const result = await harness.runAndSignal(["--render-root", path.join(harness.root, "selected")]);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /startup-status=ready/);
    await harness.assertSeededStatesRestored();
    await harness.assertLockRemoved();
  });

  it("fails startup and retains the stable lock and snapshot when any LaunchServices restore operation fails", async () => {
    const harness = await makeLaunchServicesHarness("restore-failure");
    await harness.seedDistinctStates();
    await writeFile(path.join(harness.controlRoot, "fail-restore-key"), `${RENDER_ENV}\n`, "utf8");
    const result = await harness.run(["--render-root", path.join(harness.root, "selected")]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /environment restoration failed|cleanup failed/i);
    assert.match(result.stderr, /recovery snapshot retained/);
    assert.doesNotMatch(result.stdout, /startup-status=ready/);
    assert.equal(await pathExists(harness.lockPath), true);
    assert.equal(await pathExists(harness.snapshotPath), true);
    assert.ok(Number.isInteger(result.fixturePid));
    assert.equal(isProcessAlive(result.fixturePid), false);
    assert.match(result.stderr, new RegExp(harness.lockPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("reaps package cleanup fakes after an exited-marker timeout before reporting the marker failure", async () => {
    const root = await freshTmp("openreaper-b2-package-reap-timeout-");
    const fakeBinary = path.join(root, "ignore-release-no-exit.cjs");
    const pidPath = path.join(root, "fake.pid");
    const releasePath = path.join(root, "release");
    const exitedPath = path.join(root, "never-written.exited");
    await writeFile(fakeBinary, `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`, "utf8");
    await chmod(fakeBinary, 0o755);
    const running = spawnCaptured(process.execPath, [fakeBinary], { cwd: root, env: { ...process.env }, detached: true });
    const evidence = {};
    let caught = null;
    try {
      await waitForFile(pidPath, { attempts: 100, delayMs: 10 });
      const { reapFixtureProcess } = await import(pathToFileURL(PACKAGE_BUILDER_SOURCE).href);
      try {
        await reapFixtureProcess({
          pidPath,
          releasePath,
          exitedPath,
          expectedStart: true,
          label: "target package marker-timeout fake",
          waitBudget: {
            delayMs: 20,
            pidAttempts: 20,
            markerAttempts: 5,
            graceAttempts: 0,
            termAttempts: 10,
            killAttempts: 100,
          },
          evidence,
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, "package reap helper unexpectedly accepted a missing exited marker");
      assert.match(caught.message, new RegExp(`Timed out waiting for fixture file: ${escapeRegExp(exitedPath)}`));
      const outcome = await waitForCapturedOutcome(running, "target package marker-timeout fake", { attempts: 100, delayMs: 20 });
      assert.equal(outcome.error, undefined);
      assert.equal(isProcessAlive(running.child.pid), false);
      assert.equal(evidence.term_sent, true);
      assert.equal(evidence.kill_sent, true);
      assert.equal(evidence.process_exited, true);
      assert.deepEqual(evidence.marker_cleanup_order, ["exited_marker", "release_marker", "pid_marker"]);
      assert.equal(await pathExists(pidPath), false);
      assert.equal(await pathExists(releasePath), false);
      assert.equal(await pathExists(exitedPath), false);
    } finally {
      if (isProcessGroupAlive(running.child.pid)) signalProcessGroup(running.child.pid, "SIGKILL");
      if (isProcessAlive(running.child.pid)) {
        try {
          process.kill(running.child.pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
      await waitForCapturedOutcome(running, "target package marker-timeout fallback", { attempts: 100, delayMs: 20 });
      assert.equal(isProcessAlive(running.child.pid), false);
    }
  });

  it("wires bounded record validation, transactional LaunchServices, package smoke, and portability guards", async () => {
    const [installer, uninstaller, start, mcp, packageBuilder] = await Promise.all([
      readFile(INSTALLER_SOURCE, "utf8"),
      readFile(UNINSTALLER_SOURCE, "utf8"),
      readFile(START_SOURCE, "utf8"),
      readFile(MCP_SOURCE, "utf8"),
      readFile(PACKAGE_BUILDER_SOURCE, "utf8"),
    ]);

    for (const source of [installer, uninstaller, start, mcp]) {
      assert.match(source, /4096/);
      assert.match(source, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
      assert.match(source, /C0\/DEL|\\u0000-\\u001f/);
    }
    assert.match(installer, /mkdtemp/);
    assert.match(uninstaller, /mkdtemp/);
    assert.match(start, /LAUNCHSERVICES_CLEANUP_REQUIRED/);
    assert.match(start, /\.openreaper-launchservices-env\.lock/);
    assert.match(start, /acquire_launchservices_lock/);
    assert.match(start, /LAUNCHSERVICES_LOCK_OWNED/);
    assert.match(start, /owner\.meta/);
    assert.match(start, /\.owner-token/);
    assert.match(start, /will not be auto-broken/);
    assert.match(start, /LAUNCHSERVICES_RECOVERY_RETAINED/);
    assert.match(start, /canonicalInstalledDefaultRoot/);
    assert.match(start, /canonicalInstallRoot/);
    assert.match(start, /canonicalEffectiveSessionRenderRoot/);
    assert.match(start, /canonicalEffectiveSessionRoot/);
    assert.match(start, /\.presence/);
    assert.match(start, /trap 'launchservices_cleanup_on_exit' EXIT/);
    assert.match(start, /restore_launchservices_env/);
    assert.match(mcp, /selected directory does not exist/);
    assert.match(packageBuilder, /smokePackagedInstallerManagedRenderRoot/);
    assert.match(packageBuilder, /smokeFakeLaunchServicesRenderPropagation/);
    assert.match(packageBuilder, /sessionDerivedOrderingMarkers/);
    assert.match(packageBuilder, /install_scoped_session_roots_rejected_before_launch/);
    assert.match(packageBuilder, /fake_process_reaped/);
    assert.match(packageBuilder, /marker_timeout_cleanup/);
    assert.match(packageBuilder, /ACTIVE_PACKAGE_FIXTURE_PROCESSES/);
    assert.match(packageBuilder, /markers_removed_after_exit/);
    assert.match(packageBuilder, /reapFixtureProcess/);
    assert.doesNotMatch(packageBuilder, /\/Users\/Zhuanz\/Documents\/openreaper/);
  });
});

async function makeInstallerFixture({ installerSource = null, uninstallerSource = null } = {}) {
  const root = await freshTmp("openreaper-b2-installer-");
  const packageRoot = path.join(root, "package", "OpenReaper-alpha");
  const installerPath = path.join(packageRoot, "installer", "install-openreaper.mjs");
  const uninstallerPath = path.join(packageRoot, "installer", "uninstall-openreaper.mjs");
  const home = path.join(root, "home");
  const installRoot = path.join(home, ".openreaper", "current");
  await mkdir(path.dirname(installerPath), { recursive: true });
  await mkdir(path.join(packageRoot, "bin"), { recursive: true });
  await mkdir(path.join(packageRoot, "vendor", "openreaper-kernel", "reaper", "bridge"), { recursive: true });
  if (installerSource === null) await cp(INSTALLER_SOURCE, installerPath);
  else await writeFile(installerPath, installerSource, "utf8");
  if (uninstallerSource === null) await cp(UNINSTALLER_SOURCE, uninstallerPath);
  else await writeFile(uninstallerPath, uninstallerSource, "utf8");
  for (const name of ["openreaper-mcp", "vital-agent-mcp", "openreaper-start", "openreaper-doctor"]) {
    const body = name === "openreaper-mcp" ? "#!/bin/zsh\necho 'stdio server ready' >&2\n" : "#!/bin/zsh\nexit 0\n";
    const filePath = path.join(packageRoot, "bin", name);
    await writeFile(filePath, body, "utf8");
    await chmod(filePath, 0o755);
  }
  await cp(BRIDGE_LAUNCHER_SOURCE, path.join(packageRoot, "bin", "openreaper-start-mcp-bridge.lua"));
  await writeFile(path.join(packageRoot, "install.command"), "#!/bin/zsh\n", "utf8");
  await writeFile(path.join(packageRoot, "uninstall.command"), "#!/bin/zsh\n", "utf8");
  await writeFile(path.join(packageRoot, PROVENANCE_NAME), '{"contract":"openreaper.package.provenance.v1"}\n', "utf8");
  await writeFile(path.join(packageRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua"), "-- fixture only\n", "utf8");
  return { root, packageRoot, installerPath, uninstallerPath, home, installRoot };
}

async function makeStartFixture(label, { source = null } = {}) {
  const root = await freshTmp(`openreaper-b2-start-${label}-`);
  const home = path.join(root, "home");
  const installRoot = path.join(root, "install");
  const startPath = path.join(installRoot, "bin", "openreaper-start");
  const recordPath = path.join(installRoot, "session", RECORD_NAME);
  await mkdir(path.dirname(startPath), { recursive: true });
  await mkdir(path.dirname(recordPath), { recursive: true });
  const startSource = withFixtureCleanDialogInspection(source ?? await readFile(START_SOURCE, "utf8"));
  await writeFile(startPath, startSource, "utf8");
  await cp(BRIDGE_LAUNCHER_SOURCE, path.join(installRoot, "bin", "openreaper-start-mcp-bridge.lua"));
  const doctorPath = path.join(installRoot, "bin", "openreaper-doctor");
  await writeFile(doctorPath, "#!/bin/zsh\nexit 0\n", "utf8");
  await Promise.all([startPath, doctorPath].map((file) => chmod(file, 0o755)));
  return { root, home, installRoot, startPath, recordPath };
}

async function makeMcpFixture(label) {
  const root = await freshTmp(`openreaper-b2-mcp-${label}-`);
  const home = path.join(root, "home");
  const installRoot = path.join(root, "install");
  const wrapper = path.join(installRoot, "bin", "openreaper-mcp");
  const recordPath = path.join(installRoot, "session", RECORD_NAME);
  await mkdir(path.dirname(wrapper), { recursive: true });
  await mkdir(path.dirname(recordPath), { recursive: true });
  await cp(MCP_SOURCE, wrapper);
  await chmod(wrapper, 0o755);
  return { root, home, installRoot, wrapper, recordPath };
}

function runInstaller(fixture, extraArgs = []) {
  return runCaptured(process.execPath, [
    fixture.installerPath,
    "--install-root",
    fixture.installRoot,
    "--skip-client-config",
    "--skip-startup-hook",
    ...extraArgs,
  ], { cwd: fixture.packageRoot, env: { ...process.env, HOME: fixture.home } });
}

function runInstallerWithStartupHook(fixture, extraArgs = []) {
  return runCaptured(process.execPath, [
    fixture.installerPath,
    "--install-root",
    fixture.installRoot,
    "--skip-client-config",
    ...extraArgs,
  ], { cwd: fixture.packageRoot, env: { ...process.env, HOME: fixture.home } });
}

function runInstallerWithClientConfig(fixture, extraArgs = []) {
  return runCaptured(process.execPath, [
    fixture.installerPath,
    "--install-root",
    fixture.installRoot,
    "--skip-startup-hook",
    ...extraArgs,
  ], { cwd: fixture.packageRoot, env: { ...process.env, HOME: fixture.home } });
}

function runUninstaller(fixture) {
  return runCaptured(process.execPath, [
    fixture.uninstallerPath,
    "--install-root",
    fixture.installRoot,
    "--skip-client-config",
    "--skip-startup-hook",
  ], { cwd: fixture.root, env: { ...process.env, HOME: fixture.home } });
}

function runUninstallerWithClientConfig(fixture) {
  return runCaptured(process.execPath, [
    fixture.uninstallerPath,
    "--install-root",
    fixture.installRoot,
    "--skip-startup-hook",
  ], { cwd: fixture.packageRoot, env: { ...process.env, HOME: fixture.home } });
}

function runUninstallerWithStartupHook(fixture) {
  return runCaptured(process.execPath, [
    fixture.uninstallerPath,
    "--install-root",
    fixture.installRoot,
    "--skip-client-config",
  ], { cwd: fixture.root, env: { ...process.env, HOME: fixture.home } });
}

async function runFakeStartResult({ fixture, label, extraArgs, staleRoot = null }) {
  const capturePath = path.join(fixture.root, `${label}.capture`);
  const projectIndexCapturePath = path.join(fixture.root, `${label}.project-index.capture`);
  const argvCapturePath = path.join(fixture.root, `${label}.argv.json`);
  const fakeBinary = path.join(fixture.root, `${label}-fake-reaper`);
  const fakePidPath = path.join(fixture.root, `${label}-fake-reaper.pid`);
  const fakeReleasePath = path.join(fixture.root, `${label}-release-fake-reaper`);
  const fakeExitedPath = path.join(fixture.root, `${label}-fake-reaper.exited`);
  await writeFile(fakeBinary, `#!/bin/zsh
trap 'print -rn -- "terminated" > ${shellQuote(fakeExitedPath)}; exit 143' TERM
print -rn -- "$$" > ${shellQuote(fakePidPath)}
${shellQuote(process.execPath)} -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' ${shellQuote(argvCapturePath)} "$@"
print -r -- "$${RENDER_ENV}" > ${shellQuote(capturePath)}
  print -r -- "$OPENREAPER_PROJECT_INDEX_STATE_ROOT" > ${shellQuote(projectIndexCapturePath)}
  mkdir -p "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"
  printf '{"contract":"openreaper.startup_status.v1","stage":"bridge_dofile_succeeded"}\n' \\
    > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-startup-status-v1.json"
  heartbeat_now="$(date +%s)"
printf '{"contract":"openreaper.bridge_liveness.v1","active_owner":"%s","active_generation":%s,"sequence":1,"refreshed_at_unix_s":%s}\n' \
  "$OPENREAPER_LIVE_BRIDGE_OWNER" "$OPENREAPER_LIVE_BRIDGE_GENERATION" "$heartbeat_now" \
  > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-bridge-liveness-v1.json"
fixture_wait_attempt=0
while [[ ! -f ${shellQuote(fakeReleasePath)} && \${fixture_wait_attempt} -lt 200 ]]; do
  sleep 0.05
  fixture_wait_attempt=$(( fixture_wait_attempt + 1 ))
done
print -rn -- "exited" > ${shellQuote(fakeExitedPath)}
`, "utf8");
  await chmod(fakeBinary, 0o755);
  const env = { ...process.env, HOME: fixture.home, OPENREAPER_START_WAIT_SECONDS: "1" };
  if (staleRoot !== null) env[RENDER_ENV] = staleRoot;
  const result = await runCaptured(fixture.startPath, ["--reaper-binary", fakeBinary, ...extraArgs], {
    cwd: fixture.root,
    env,
  });
  let fixturePid = null;
  if (await pathExists(fakePidPath)) {
    fixturePid = await readFixturePid(fakePidPath);
    await writeFile(fakeReleasePath, "release\n", "utf8");
    await waitForFile(fakeExitedPath);
    await waitForProcessExit(fixturePid, `${label} direct fake REAPER`);
  }
  if (result.code === 0) await waitForFile(capturePath);
  await rm(fakePidPath, { force: true });
  await rm(fakeReleasePath, { force: true });
  await rm(fakeExitedPath, { force: true });
  await rm(path.join(fixture.installRoot, "session", "reaper.pid"), { force: true });
  return { result, capturePath, projectIndexCapturePath, argvCapturePath, fixturePid };
}

async function runMcpResult({
  fixture,
  label,
  explicit = undefined,
  explicitPresent = explicit !== undefined,
  extraEnv = {},
}) {
  const fakeBin = path.join(fixture.root, `fake-bin-${label}`);
  const capturePath = path.join(fixture.root, `${label}-mcp.capture`);
  const fakeNode = path.join(fakeBin, "node");
  await mkdir(fakeBin, { recursive: true });
  await writeFile(fakeNode, `#!/bin/zsh\nif [[ "$1" == "--input-type=module" ]]; then\n  exec ${shellQuote(process.execPath)} "$@"\nfi\nprint -r -- "$${RENDER_ENV}" > ${shellQuote(capturePath)}\n`, "utf8");
  await chmod(fakeNode, 0o755);
  const env = { ...process.env, HOME: fixture.home, PATH: `${fakeBin}:${process.env.PATH ?? ""}` };
  delete env.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR;
  delete env.OPENREAPER_ARTIFACT_ROOT;
  delete env.OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT;
  if (explicitPresent) env[RENDER_ENV] = explicit;
  else delete env[RENDER_ENV];
  Object.assign(env, extraEnv);
  const result = await runCaptured(fixture.wrapper, [], { cwd: fixture.root, env });
  let captured = null;
  if (result.code === 0) {
    await waitForFile(capturePath);
    captured = (await readFile(capturePath, "utf8")).trimEnd();
  }
  return { result, capturePath, captured };
}

async function writeInvalidRecord(recordPath, kind, root) {
  await mkdir(path.dirname(recordPath), { recursive: true });
  await rm(recordPath, { force: true });
  if (kind === "empty") return writeFile(recordPath, Buffer.alloc(0));
  if (kind === "multiline") return writeFile(recordPath, `/tmp/one\n/tmp/two\n`, "utf8");
  if (kind === "oversized") return writeFile(recordPath, Buffer.alloc(RECORD_MAX + 1, 0x61));
  if (kind === "path_too_long") return writeFile(recordPath, `/tmp/${"a".repeat(3072)}\n`, "utf8");
  if (kind === "invalid_utf8") return writeFile(recordPath, Buffer.from([0xff, 0xfe, 0xfd]));
  if (kind === "nul") return writeFile(recordPath, Buffer.from("/tmp/bad\0root\n", "utf8"));
  if (kind === "directory") return mkdir(recordPath);
  if (kind === "symlink") {
    const target = path.join(root, `record-target-${Math.random().toString(16).slice(2)}`);
    await writeFile(target, "/tmp/external\n", "utf8");
    return symlink(target, recordPath);
  }
  throw new Error(`unknown record kind ${kind}`);
}

async function makeLaunchServicesHarness(label, { source = null, fakePidDelayMs = 0, startupHookEnvRace = false } = {}) {
  const root = await freshTmp(`openreaper-b2-launchservices-${label}-`);
  const home = path.join(root, "home");
  const installRoot = path.join(root, "install");
  const binRoot = path.join(root, "fixture-bin");
  const stateRoot = path.join(root, "state");
  const controlRoot = path.join(root, "control");
  const logPath = path.join(root, "launchctl.log");
  const capturePath = path.join(root, "capture");
  const argvCapturePath = path.join(root, "reaper-argv.json");
  const launchctlPath = path.join(binRoot, "launchctl");
  const openPath = path.join(binRoot, "open");
  const unamePath = path.join(binRoot, "uname");
  const startPath = path.join(installRoot, "bin", "openreaper-start");
  const startupStatusPath = path.join(installRoot, "session", "transport", "openreaper-startup-status-v1.json");
  const lockPath = path.join(installRoot, "session", ".openreaper-launchservices-env.lock");
  const fakeApp = path.join(root, "FakeREAPER.app");
  const fakeBinary = path.join(fakeApp, "Contents", "MacOS", "REAPER");
  const keys = [
    "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
    "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
      "OPENREAPER_ARTIFACT_ROOT",
    "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT",
    RENDER_ENV,
    "OPENREAPER_LIVE_BRIDGE_OWNER",
    "OPENREAPER_LIVE_BRIDGE_GENERATION",
    "OPENREAPER_PROJECT_INDEX_STATE_ROOT",
  ];
  await Promise.all([
    mkdir(path.dirname(startPath), { recursive: true }),
    mkdir(path.dirname(fakeBinary), { recursive: true }),
    mkdir(binRoot, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
    mkdir(controlRoot, { recursive: true }),
  ]);
  const startSource = withFixtureCleanDialogInspection(source ?? await readFile(START_SOURCE, "utf8"))
    .replace('LAUNCHCTL_BIN="/bin/launchctl"', `LAUNCHCTL_BIN=${shellQuote(launchctlPath)}`)
    .replace('LAUNCHSERVICES_BIN="/usr/bin/osascript"', `LAUNCHSERVICES_BIN=${shellQuote(openPath)}`);
  await writeFile(startPath, startSource, "utf8");
  await cp(BRIDGE_LAUNCHER_SOURCE, path.join(installRoot, "bin", "openreaper-start-mcp-bridge.lua"));
  const doctorPath = path.join(installRoot, "bin", "openreaper-doctor");
  await writeFile(doctorPath, "#!/bin/zsh\nexit 0\n", "utf8");
  await writeFile(unamePath, "#!/bin/zsh\necho Darwin\n", "utf8");
  await writeFile(fakeBinary, `#!/bin/zsh
  set -u
pid_path="$OPENREAPER_B2_FAKE_PID_PATH"
release_path="$OPENREAPER_B2_FAKE_RELEASE_PATH"
exited_path="$OPENREAPER_B2_FAKE_EXITED_PATH"
trap 'print -rn -- "terminated" > "$exited_path"; exit 143' TERM
if [[ -n "\${OPENREAPER_B2_FAKE_PID_DELAY_SECONDS:-}" ]]; then
  sleep "$OPENREAPER_B2_FAKE_PID_DELAY_SECONDS"
fi
  print -rn -- "$$" > "$pid_path"
${shellQuote(process.execPath)} -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' ${shellQuote(argvCapturePath)} "$@"
  print -r -- "$${RENDER_ENV}" > ${shellQuote(capturePath)}
if [[ "\${OPENREAPER_B2_FAKE_STARTUP_HOOK_ENV_RACE:-false}" == "true" ]]; then
  sleep 0.25
  mkdir -p "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"
  if [[ -f "$OPENREAPER_B2_FAKE_LAUNCHSERVICES_STATE_ROOT/OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR.presence" ]] && \
      [[ "$(cat "$OPENREAPER_B2_FAKE_LAUNCHSERVICES_STATE_ROOT/OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR.presence")" == "set" ]]; then
    printf '{"contract":"openreaper.startup_status.v1","stage":"hook_seen"}\n' > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-startup-status-v1.json"
    printf '{"contract":"openreaper.startup_status.v1","stage":"bridge_dofile_succeeded"}\n' > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-startup-status-v1.json"
    heartbeat_now="$(date +%s)"
    printf '{"contract":"openreaper.bridge_liveness.v1","active_owner":"%s","active_generation":%s,"sequence":1,"refreshed_at_unix_s":%s}\n' \
      "$OPENREAPER_LIVE_BRIDGE_OWNER" "$OPENREAPER_LIVE_BRIDGE_GENERATION" "$heartbeat_now" \
      > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-bridge-liveness-v1.json"
  else
    printf '{"contract":"openreaper.startup_status.v1","stage":"environment_missing"}\n' > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-startup-status-v1.json"
  fi
else
  mkdir -p "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"
  printf '{"contract":"openreaper.startup_status.v1","stage":"bridge_dofile_succeeded"}\n' > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-startup-status-v1.json"
  heartbeat_now="$(date +%s)"
  printf '{"contract":"openreaper.bridge_liveness.v1","active_owner":"%s","active_generation":%s,"sequence":1,"refreshed_at_unix_s":%s}\n' \
    "$OPENREAPER_LIVE_BRIDGE_OWNER" "$OPENREAPER_LIVE_BRIDGE_GENERATION" "$heartbeat_now" \
    > "$OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/openreaper-bridge-liveness-v1.json"
fi
fixture_wait_attempt=0
while [[ ! -f "$release_path" && \${fixture_wait_attempt} -lt 200 ]]; do
  sleep 0.05
  fixture_wait_attempt=$(( fixture_wait_attempt + 1 ))
done
print -rn -- "exited" > "$exited_path"
`, "utf8");
  await writeFile(launchctlPath, launchctlFixtureSource({ stateRoot, controlRoot, logPath }), "utf8");
  await writeFile(openPath, openFixtureSource({ stateRoot, controlRoot, keys }), "utf8");
  await Promise.all([startPath, doctorPath, unamePath, fakeBinary, launchctlPath, openPath].map((file) => chmod(file, 0o755)));

  let fakeRunSequence = 0;
  const commandArgs = (extraArgs) => ["--reaper-app", fakeApp, ...extraArgs];
  const commandEnv = (waitSeconds, state) => ({
    ...process.env,
    HOME: home,
    PATH: `${binRoot}:${process.env.PATH ?? ""}`,
    OPENREAPER_START_WAIT_SECONDS: String(waitSeconds),
    OPENREAPER_B2_FAKE_LAUNCH_REQUEST_PATH: state.launchRequestPath,
    OPENREAPER_B2_FAKE_PID_PATH: state.pidPath,
    OPENREAPER_B2_FAKE_RELEASE_PATH: state.releasePath,
    OPENREAPER_B2_FAKE_EXITED_PATH: state.exitedPath,
    OPENREAPER_B2_FAKE_PID_DELAY_SECONDS: fakePidDelayMs > 0 ? (fakePidDelayMs / 1000).toFixed(3) : "",
    OPENREAPER_B2_FAKE_STARTUP_HOOK_ENV_RACE: startupHookEnvRace ? "true" : "false",
    OPENREAPER_B2_FAKE_LAUNCHSERVICES_STATE_ROOT: stateRoot,
  });

  async function prepareFakeReaperRun() {
    const runRoot = path.join(controlRoot, `fake-run-${++fakeRunSequence}`);
    await mkdir(runRoot, { recursive: true });
    const state = {
      label: `${label} fake run ${fakeRunSequence}`,
      runRoot,
      launchRequestPath: path.join(runRoot, "launch-requested"),
      pidPath: path.join(runRoot, "fake-reaper.pid"),
      releasePath: path.join(runRoot, "release-fake-reaper"),
      exitedPath: path.join(runRoot, "fake-reaper.exited"),
      wrapperChild: null,
      wrapperOutcome: null,
      wrapperSettled: false,
      pidPresentWhenWrapperSettled: null,
      launchRequested: false,
      expectedStart: false,
    };
    state.cleanupEntry = registerActiveFixtureCleanup(state.label, () => cleanupFakeReaperRun(state));
    return state;
  }

  async function cleanupFakeReaperRun(state) {
    if (state.wrapperChild !== null && !state.wrapperSettled && isProcessAlive(state.wrapperChild.pid)) {
      await writeFile(path.join(controlRoot, "release-hold"), "1\n", "utf8");
      await terminateChildProcess(state.wrapperChild, state.wrapperOutcome, `${state.label} start wrapper`);
      state.wrapperSettled = true;
    }

    state.launchRequested = await pathExists(state.launchRequestPath);
    const pidAlreadyPresent = await pathExists(state.pidPath);
    state.expectedStart = state.launchRequested || pidAlreadyPresent;
    if (!state.expectedStart) {
      await rm(state.runRoot, { recursive: true, force: true });
      return null;
    }

    let pid = null;
    let markerError = null;
    let cleanupError = null;
    let processExited = false;
    try {
      await waitForFile(state.pidPath);
      pid = await readFixturePid(state.pidPath);
      await writeFile(state.releasePath, "release\n", "utf8");
      try {
        await waitForFile(state.exitedPath);
      } catch (error) {
        markerError = error;
      }
    } finally {
      if (pid !== null) {
        try {
          await waitForProcessExit(pid, "LaunchServices fake REAPER", {
            graceAttempts: markerError === null ? 200 : 0,
          });
          processExited = true;
        } catch (error) {
          cleanupError = error;
        }
      }
      if (processExited) {
        await rm(state.runRoot, { recursive: true, force: true });
      }
    }
    if (markerError !== null) {
      if (cleanupError !== null) throw new AggregateError([markerError, cleanupError], markerError.message, { cause: markerError });
      throw markerError;
    }
    if (cleanupError !== null) throw cleanupError;
    state.fixturePid = pid;
    return pid;
  }

  async function releaseFakeReaper(state) {
    return runActiveFixtureCleanup(state.cleanupEntry);
  }

  async function startCapturedRun(extraArgs, waitSeconds, state) {
    const running = spawnCaptured(startPath, commandArgs(extraArgs), {
      cwd: root,
      env: commandEnv(waitSeconds, state),
    });
    state.wrapperChild = running.child;
    state.wrapperOutcome = running.outcome;
    return running;
  }

  const api = {
    root,
    home,
    installRoot,
    stateRoot,
    controlRoot,
    logPath,
    capturePath,
    argvCapturePath,
    startupStatusPath,
    lockPath,
    snapshotPath: path.join(lockPath, "snapshot"),
    keys,
    async setState(key, present, value) {
      if (present) {
        await writeFile(path.join(stateRoot, `${key}.presence`), "set", "utf8");
        await writeFile(path.join(stateRoot, `${key}.value`), value, "utf8");
      } else {
        await writeFile(path.join(stateRoot, `${key}.presence`), "unset", "utf8");
        await writeFile(path.join(stateRoot, `${key}.value`), "", "utf8");
      }
    },
    async getState(key) {
      const presence = await readTextIfExists(path.join(stateRoot, `${key}.presence`));
      return presence === "set"
        ? { present: true, value: await readTextIfExists(path.join(stateRoot, `${key}.value`)) }
        : { present: false, value: "" };
    },
    async seedDistinctStates() {
      for (let index = 0; index < keys.length; index += 1) {
        await api.setState(keys[index], index % 3 !== 2, index % 3 === 1 ? "" : `previous ${index} with spaces`);
      }
      await writeFile(path.join(controlRoot, "restore-values.json"), JSON.stringify(Object.fromEntries(
        await Promise.all(keys.map(async (key) => [key, await api.getState(key)])),
      )), "utf8");
    },
    async assertSeededStatesRestored() {
      const expected = JSON.parse(await readFile(path.join(controlRoot, "restore-values.json"), "utf8"));
      for (const key of keys) assert.deepEqual(await api.getState(key), expected[key], key);
    },
    async assertLockRemoved() {
      assert.equal(await pathExists(lockPath), false, `stable LaunchServices lock remained at ${lockPath}`);
      assert.equal(await pathExists(path.join(lockPath, "snapshot")), false);
    },
    activeCleanupCount() {
      return [...ACTIVE_FIXTURE_CLEANUPS].filter((entry) => entry.label.startsWith(`${label} fake run `)).length;
    },
    async launchForSuiteDrain(extraArgs, { waitSeconds = 1 } = {}) {
      const state = await prepareFakeReaperRun();
      const running = await startCapturedRun(extraArgs, waitSeconds, state);
      const result = await running.result;
      state.wrapperSettled = true;
      state.pidPresentWhenWrapperSettled = await pathExists(state.pidPath);
      return { ...result, cleanupState: state };
    },
    async run(extraArgs, { waitSeconds = 1 } = {}) {
      const state = await prepareFakeReaperRun();
      const running = await startCapturedRun(extraArgs, waitSeconds, state);
      let result;
      let fixturePid = null;
      try {
        result = await running.result;
      } finally {
        state.wrapperSettled = true;
        state.pidPresentWhenWrapperSettled = await pathExists(state.pidPath);
        fixturePid = await releaseFakeReaper(state);
      }
      return {
        ...result,
        fixturePid,
        launchRequested: state.launchRequested,
        pidPresentWhenWrapperSettled: state.pidPresentWhenWrapperSettled,
      };
    },
    async spawn(extraArgs, { waitSeconds = 4 } = {}) {
      const state = await prepareFakeReaperRun();
      const running = await startCapturedRun(extraArgs, waitSeconds, state);
      const result = running.result.then(
        async (captured) => {
          state.wrapperSettled = true;
          state.pidPresentWhenWrapperSettled = await pathExists(state.pidPath);
          return {
            ...captured,
            fixturePid: await releaseFakeReaper(state),
            launchRequested: state.launchRequested,
            pidPresentWhenWrapperSettled: state.pidPresentWhenWrapperSettled,
          };
        },
        async (error) => {
          state.wrapperSettled = true;
          state.pidPresentWhenWrapperSettled = await pathExists(state.pidPath);
          await releaseFakeReaper(state);
          throw error;
        },
      );
      void result.catch(() => {});
      return { child: running.child, result };
    },
    async runAndSignal(extraArgs, signalOptions = {}) {
      const state = await prepareFakeReaperRun();
      let result;
      let fixturePid = null;
      try {
        result = await runCapturedAndSignal(startPath, commandArgs(extraArgs), {
          cwd: root,
          env: commandEnv(4, state),
          mutationMarker: path.join(controlRoot, "set-count"),
          ...signalOptions,
        });
      } finally {
        state.wrapperSettled = true;
        state.pidPresentWhenWrapperSettled = await pathExists(state.pidPath);
        fixturePid = await releaseFakeReaper(state);
      }
      return {
        ...result,
        fixturePid,
        launchRequested: state.launchRequested,
        pidPresentWhenWrapperSettled: state.pidPresentWhenWrapperSettled,
      };
    },
  };
  return api;
}

function withFixtureCleanDialogInspection(source) {
  const replacement = `run_startup_dialog_observer() {
  echo "no_safe_dialog"
}

startup_dialog_result_is_safe() {`;
  const patched = source.replace(/run_startup_dialog_observer\(\) \{[\s\S]*?\n\}\n\nstartup_dialog_result_is_safe\(\) \{/u, replacement);
  assert.notEqual(patched, source, "fixture must replace only its copied dialog inspector");
  return patched;
}
function launchctlFixtureSource({ stateRoot, controlRoot, logPath }) {
  return `#!/bin/zsh
set -eu
state=${shellQuote(stateRoot)}
control=${shellQuote(controlRoot)}
log=${shellQuote(logPath)}
cmd="$1"
key="$2"
case "$cmd" in
	getenv)
	  print -r -- "getenv:$key" >> "$log"
	  count=0
	  [[ -f "$control/getenv-count" ]] && count="$(cat "$control/getenv-count")"
	  count=$(( count + 1 ))
	  print -rn -- "$count" > "$control/getenv-count"
	  if [[ -f "$control/hold-getenv-at" && "$count" == "$(cat "$control/hold-getenv-at" | tr -d '\\n')" ]]; then
	    trap '' TERM
	    print -rn -- "$$" > "$control/getenv-stall.pid"
	    while true; do :; done
	  fi
	  if [[ -f "$state/$key.presence" && "$(cat "$state/$key.presence")" == "set" ]]; then
      cat "$state/$key.value"
      exit 0
    fi
    exit 1
    ;;
  setenv)
    count=0
    [[ -f "$control/set-count" ]] && count="$(cat "$control/set-count")"
    count=$(( count + 1 ))
    print -rn -- "$count" > "$control/set-count"
    if [[ -f "$control/fail-set-at" && "$count" == "$(cat "$control/fail-set-at" | tr -d '\\n')" ]]; then
      print -r -- "set-fail:$key" >> "$log"
      exit 1
    fi
    if [[ -f "$control/fail-restore-key" && "$key" == "$(cat "$control/fail-restore-key" | tr -d '\\n')" && -f "$control/restore-values.json" ]]; then
      expected="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const row=j[process.argv[2]]; if(row?.present) process.stdout.write(row.value)' "$control/restore-values.json" "$key")"
      if [[ "$3" == "$expected" ]]; then
        print -r -- "restore-fail:$key" >> "$log"
        exit 1
      fi
    fi
    phase="set"
    [[ -f "$control/restore-values.json" ]] && node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const r=j[process.argv[2]];process.exit(r?.present&&r.value===process.argv[3]?0:1)' "$control/restore-values.json" "$key" "$3" && phase="restore"
    print -r -- "\${phase}:set:\${key}" >> "$log"
    print -rn -- "set" > "$state/$key.presence"
    print -rn -- "$3" > "$state/$key.value"
    if [[ -f "$control/hold-set-at" && "$count" == "$(cat "$control/hold-set-at" | tr -d '\\n')" ]]; then
      print -rn -- "$count" > "$control/hold-reached"
      while [[ ! -f "$control/release-hold" ]]; do
        sleep 0.025
      done
    fi
    ;;
  unsetenv)
    if [[ -f "$control/fail-restore-key" && "$key" == "$(cat "$control/fail-restore-key" | tr -d '\\n')" && -f "$control/restore-values.json" ]]; then
      if node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(j[process.argv[2]]?.present?1:0)' "$control/restore-values.json" "$key"; then
        print -r -- "restore-fail:$key" >> "$log"
        exit 1
      fi
    fi
    phase="set"
    [[ -f "$control/restore-values.json" ]] && node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(j[process.argv[2]]?.present?1:0)' "$control/restore-values.json" "$key" && phase="restore"
    print -r -- "\${phase}:unset:\${key}" >> "$log"
    print -rn -- "unset" > "$state/$key.presence"
    : > "$state/$key.value"
    ;;
esac
`;
}

function openFixtureSource({ stateRoot, controlRoot, keys }) {
  const exports = keys.map((key) => `if [[ -f ${shellQuote(path.join(stateRoot, `${key}.presence`))} && "$(cat ${shellQuote(path.join(stateRoot, `${key}.presence`))})" == "set" ]]; then export ${key}="$(cat ${shellQuote(path.join(stateRoot, `${key}.value`))})"; else unset ${key}; fi`).join("\n");
  return `#!/bin/zsh
set -eu
[[ -f ${shellQuote(path.join(controlRoot, "fail-open"))} ]] && exit 1
app="$4"
pid_handoff="$5"
shift 5
${exports}
[[ -f ${shellQuote(path.join(controlRoot, "skip-pid"))} ]] && exit 0
if [[ -n "\${OPENREAPER_B2_FAKE_LAUNCH_REQUEST_PATH:-}" ]]; then
  print -rn -- "requested" > "$OPENREAPER_B2_FAKE_LAUNCH_REQUEST_PATH"
fi
nohup "$app/Contents/MacOS/REAPER" "$@" >/dev/null 2>&1 &
launched_pid="$!"
print -r -- "$launched_pid" > "$pid_handoff"
print -r -- "$launched_pid"
`;
}

function parseInstallerReport(stdout) {
  const marker = "\n\nOpenReaper alpha ";
  const end = stdout.indexOf(marker);
  assert.notEqual(end, -1, stdout.slice(0, 1000));
  return JSON.parse(stdout.slice(0, end));
}

function renderRootLines(stdout) {
  return stdout.split(/\r?\n/).filter((line) => line.includes("render-root="));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function registerActiveFixtureCleanup(label, cleanup) {
  const entry = { label, cleanup, promise: null };
  ACTIVE_FIXTURE_CLEANUPS.add(entry);
  return entry;
}

async function runActiveFixtureCleanup(entry) {
  if (entry.promise === null) entry.promise = Promise.resolve().then(entry.cleanup);
  try {
    const result = await entry.promise;
    ACTIVE_FIXTURE_CLEANUPS.delete(entry);
    return result;
  } catch (error) {
    entry.promise = null;
    throw error;
  }
}

async function drainActiveFixtureCleanups() {
  const errors = [];
  for (const entry of [...ACTIVE_FIXTURE_CLEANUPS]) {
    try {
      await runActiveFixtureCleanup(entry);
    } catch (error) {
      errors.push(new Error(`${entry.label}: ${error.message}`, { cause: error }));
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "active fixture process cleanup failed");
}

function spawnCaptured(command, args, { cwd, env, detached = false }) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const state = { settled: false, outcome: null };
  const outcome = new Promise((resolve) => {
    const settle = (value) => {
      if (state.settled) return;
      state.settled = true;
      state.outcome = value;
      resolve(value);
    };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => settle({ error, stdout, stderr }));
    child.once("close", (code, signal) => settle({ result: { code, signal, stdout, stderr } }));
  });
  const result = outcome.then((value) => {
    if (value.error) throw value.error;
    return value.result;
  });
  return { child, result, outcome, state };
}

function runCaptured(command, args, { cwd, env }) {
  return spawnCaptured(command, args, { cwd, env }).result;
}

async function runCapturedAndSignal(command, args, {
  cwd,
  env,
  mutationMarker,
  markerAttempts = 400,
  markerDelayMs = 25,
  cleanupTermAttempts = 80,
  cleanupKillAttempts = 80,
}) {
  const running = spawnCaptured(command, args, { cwd, env, detached: true });
  // This helper propagates failures through outcome/state; consume the unused rejecting view immediately.
  void running.result.catch(() => {});
  const label = `owned signal fixture group ${running.child.pid ?? "unspawned"}`;
  const cleanupEvidence = {};
  const cleanupEntry = registerActiveFixtureCleanup(label, () => terminateOwnedProcessGroup(running, label, {
    delayMs: markerDelayMs,
    termAttempts: cleanupTermAttempts,
    killAttempts: cleanupKillAttempts,
    evidence: cleanupEvidence,
  }));

  let markerOutcome;
  try {
    markerOutcome = await waitForMutationMarkerOrChild(mutationMarker, running.state, {
      attempts: markerAttempts,
      delayMs: markerDelayMs,
    });
  } catch (markerError) {
    let cleanupError = null;
    try {
      await runActiveFixtureCleanup(cleanupEntry);
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError !== null) {
      throw new AggregateError([markerError, cleanupError], markerError.message, { cause: markerError });
    }
    throw markerError;
  }

  if (markerOutcome === "child") {
    if (isProcessGroupAlive(running.child.pid)) await runActiveFixtureCleanup(cleanupEntry);
    else ACTIVE_FIXTURE_CLEANUPS.delete(cleanupEntry);
    if (running.state.outcome?.error) throw running.state.outcome.error;
    return running.state.outcome.result;
  }

  if (isProcessAlive(running.child.pid)) running.child.kill("SIGTERM");
  let outcome;
  try {
    outcome = await waitForCapturedOutcome(running, label, { attempts: 400, delayMs: markerDelayMs });
  } catch (error) {
    let cleanupError = null;
    try {
      await runActiveFixtureCleanup(cleanupEntry);
    } catch (caught) {
      cleanupError = caught;
    }
    if (cleanupError !== null) throw new AggregateError([error, cleanupError], error.message, { cause: error });
    throw error;
  }

  if (isProcessGroupAlive(running.child.pid)) {
    await runActiveFixtureCleanup(cleanupEntry);
  } else {
    ACTIVE_FIXTURE_CLEANUPS.delete(cleanupEntry);
  }
  if (outcome.error) throw outcome.error;
  return outcome.result;
}

async function waitForMutationMarkerOrChild(filePath, childState, { attempts, delayMs }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await pathExists(filePath)) return "marker";
    if (childState.settled) return "child";
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (await pathExists(filePath)) return "marker";
  if (childState.settled) return "child";
  throw new Error(`timed out waiting for fixture mutation marker ${filePath}`);
}

async function waitForCapturedOutcome(running, label, { attempts = 100, delayMs = 25 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (running.state.settled) return running.state.outcome;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} child did not emit close/error after bounded cleanup`);
}

async function terminateOwnedProcessGroup(running, label, {
  delayMs = 25,
  termAttempts = 80,
  killAttempts = 80,
  evidence = {},
} = {}) {
  const pgid = running.child.pid;
  if (!Number.isInteger(pgid)) {
    const outcome = await waitForCapturedOutcome(running, label, { attempts: termAttempts, delayMs });
    if (outcome.error) return null;
    return outcome.result;
  }

  if (isProcessGroupAlive(pgid)) {
    signalProcessGroup(pgid, "SIGTERM");
    evidence.termSent = true;
  }
  if (await waitForOwnedProcessGroupExit(running, pgid, termAttempts, delayMs)) return running.state.outcome;
  if (isProcessGroupAlive(pgid)) {
    signalProcessGroup(pgid, "SIGKILL");
    evidence.killSent = true;
  }
  if (await waitForOwnedProcessGroupExit(running, pgid, killAttempts, delayMs)) return running.state.outcome;
  throw new Error(`${label} did not exit after bounded TERM/KILL process-group cleanup`);
}

async function waitForOwnedProcessGroupExit(running, pgid, attempts, delayMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isProcessGroupAlive(pgid) && running.state.settled) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return !isProcessGroupAlive(pgid) && running.state.settled;
}

function isProcessGroupAlive(pgid) {
  if (!Number.isInteger(pgid)) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function terminateChildProcess(child, outcomePromise, label, {
  delayMs = 25,
  termAttempts = 80,
  killAttempts = 80,
} = {}) {
  const running = { child, state: { settled: false, outcome: null } };
  void outcomePromise.then((outcome) => {
    running.state.settled = true;
    running.state.outcome = outcome;
  });
  if (isProcessAlive(child.pid)) child.kill("SIGTERM");
  try {
    return await waitForCapturedOutcome(running, label, { attempts: termAttempts, delayMs });
  } catch {
    if (isProcessAlive(child.pid)) child.kill("SIGKILL");
    return waitForCapturedOutcome(running, label, { attempts: killAttempts, delayMs });
  }
}

async function waitForFile(filePath, { attempts = 400, delayMs = 25 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await pathExists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`timed out waiting for fixture capture ${filePath}`);
}

async function readFixturePid(pidPath) {
  const value = (await readFile(pidPath, "utf8")).trim();
  if (!/^[1-9]\d{0,9}$/.test(value)) throw new Error(`invalid fixture pid in ${pidPath}`);
  return Number(value);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, label, {
  delayMs = 25,
  graceAttempts = 200,
  termAttempts = 80,
  killAttempts = 80,
  evidence = null,
} = {}) {
  if (await waitForDeadProcess(pid, graceAttempts, delayMs)) return;
  try {
    process.kill(pid, "SIGTERM");
    if (evidence !== null) evidence.termSent = true;
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  if (await waitForDeadProcess(pid, termAttempts, delayMs)) return;
  try {
    process.kill(pid, "SIGKILL");
    if (evidence !== null) evidence.killSent = true;
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  if (await waitForDeadProcess(pid, killAttempts, delayMs)) return;
  throw new Error(`${label} fixture process ${pid} did not exit after bounded cleanup`);
}

async function waitForDeadProcess(pid, attempts, delayMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return !isProcessAlive(pid);
}
async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const installer = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/install-openreaper.mjs"),
  "utf8",
);
const installerPs1 = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/install-openreaper.ps1"),
  "utf8",
);
const uninstallerPs1 = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/uninstall-openreaper.ps1"),
  "utf8",
);
const doctor = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/openreaper-doctor.sh"),
  "utf8",
);
const doctorPs1 = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/openreaper-doctor.ps1"),
  "utf8",
);
const mcpPs1 = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/openreaper-mcp.ps1"),
  "utf8",
);
const startPs1 = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/openreaper-start.ps1"),
  "utf8",
);
const startSh = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/openreaper-start.sh"),
  "utf8",
);
const liveBridgeExecutor = await readFile(
  path.resolve(import.meta.dirname, "../../packages/mcp-server/src/live-bridge-executor-v1.mjs"),
  "utf8",
);

test("Windows installer secures the native PowerShell start and Doctor entrypoints", () => {
  assert.match(installer, /resolveWindowsPowerShellCommand\(\)/u);
  assert.match(installer, /System32.*WindowsPowerShell.*v1\.0.*powershell\.exe/u);
  assert.match(installer, /return existsSync\(nativePath\) \? nativePath : "powershell\.exe"/u);
  assert.match(installer, /const startCommand = path\.join\(installedBin, process\.platform === "win32" \? "openreaper-start\.ps1" : "openreaper-start"\);/u);
  assert.match(installer, /const doctorCommand = path\.join\(installedBin, process\.platform === "win32" \? "openreaper-doctor\.ps1" : "openreaper-doctor"\);/u);
  assert.match(doctor, /const startCommand = path\.join\(installRoot, "bin", process\.platform === "win32" \? "openreaper-start\.ps1" : "openreaper-start"\);/u);
  assert.match(doctor, /const doctorCommand = path\.join\(installRoot, "bin", process\.platform === "win32" \? "openreaper-doctor\.ps1" : "openreaper-doctor"\);/u);
  assert.match(doctorPs1, /\$env:OPENREAPER_DOCTOR_INSTALL_ROOT = \$installRoot/u);
  assert.match(doctorPs1, /\$env:OPENREAPER_DOCTOR_SESSION_ROOT = \$sessionRoot/u);
  assert.match(doctorPs1, /\$env:OPENREAPER_DOCTOR_TRANSPORT_DIR = \$transportRoot/u);
  assert.match(doctorPs1, /\$env:OPENREAPER_DOCTOR_ARTIFACT_ROOT = \$artifactRoot/u);
  assert.match(doctorPs1, /\$env:OPENREAPER_DOCTOR_EXECUTABLE_RECIPE_ROOT = \$recipeRoot/u);
});

test("Windows start omits an empty Start-Process argument list", () => {
  assert.doesNotMatch(startPs1, /StartupDialogConsent/u);
  assert.doesNotMatch(startPs1, /IgnoreMissingMedia/u);
  assert.match(startPs1, /\$resourceConfigFile = Join-Path \$ReaperResourceRoot "REAPER\.ini"/u);
  assert.match(startPs1, /Join-Path \$\{env:ProgramFiles\} "REAPER \(x64\)\\reaper\.exe"/u);
  assert.match(startPs1, /Join-Path \$\{env:ProgramFiles\(x86\)\} "REAPER \(x86\)\\reaper\.exe"/u);
  assert.match(startPs1, /\$candidates = @\(\$candidates \| Where-Object/u);
  assert.match(startPs1, /\$launchArgs = @\([\s\S]*"-cfgfile", \(Quote-ProcessArgument \$resourceConfigFile\)[\s\S]*\)/u);
  assert.doesNotMatch(startPs1, /"-resourcepath"/u);
  assert.match(startPs1, /function Quote-ProcessArgument\(\[string\] \$Value\)/u);
  assert.match(startPs1, /if \(\$launchArgs\.Count -gt 0\) \{/u);
  assert.match(startPs1, /Start-Process -FilePath \$binary -ArgumentList \$launchArgs .* -WindowStyle Normal -PassThru/u);
  assert.match(startPs1, /Start-Process -FilePath \$binary -WorkingDirectory \(Split-Path -Parent \$binary\) -WindowStyle Normal -PassThru/u);
  assert.match(startPs1, /\$env:OPENREAPER_SESSION_ROOT = \$SessionRoot/u);
  assert.match(startPs1, /\$doctorArgs = @\("--wait-bridge=5"\)/u);
  assert.doesNotMatch(startPs1, /\$doctorArgs = @\("--wait-bridge=2"\)/u);
  assert.match(startPs1, /\$doctorSmokeTimeoutMs = 22000/u);
  assert.match(startPs1, /\$doctorReadProbeTimeoutMs = 15000/u);
  assert.match(startPs1, /\$env:OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS = \[string\]\$doctorSmokeTimeoutMs/u);
  assert.match(startPs1, /\$env:OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS = \[string\]\$doctorReadProbeTimeoutMs/u);
  assert.match(
    startPs1,
    /Get-Content -LiteralPath \$managedRecord -Raw -Encoding UTF8/u,
    "Windows PowerShell 5.1 must not decode a UTF-8 no-BOM managed render path through the active ANSI code page",
  );
  assert.ok(
    startPs1.indexOf("$env:OPENREAPER_SESSION_ROOT = $SessionRoot")
      < startPs1.indexOf("& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $doctorScript"),
    "Windows start must bind its effective session root before invoking packaged Doctor",
  );
  assert.ok(
    startPs1.indexOf("$env:OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS = [string]$doctorSmokeTimeoutMs")
      < startPs1.indexOf("& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $doctorScript"),
    "Windows start must bind its bounded cold-smoke timeout before invoking packaged Doctor",
  );
  assert.match(startPs1, /function Get-OpenReaperStartupWindowGate/u);
  assert.match(startPs1, /OpenReaperNativeWindowProbe/u);
  assert.ok(
    startPs1.indexOf("$windowGate = Get-OpenReaperStartupWindowGate $process.Id")
      < startPs1.indexOf("if (Test-HeartbeatReady) { break }"),
    "Windows start must inspect visible REAPER windows before accepting heartbeat readiness",
  );
  assert.match(startPs1, /\$unexpected = @\(\$windows \| Where-Object \{ \$_\.class_name -ne "REAPERwnd" \}\)/u);
  assert.match(startPs1, /\$stockSplash = @\(\$windows \| Where-Object \{ \$_\.class_name -ceq "REAPERsplash" -and \$_\.title -ceq "REAPER" \}\)/u);
  assert.match(startPs1, /if \(\$windows\.Count -eq 1 -and \$stockSplash\.Count -eq 1\)/u);
  assert.match(startPs1, /state = "pending"; detail = "stock_reaper_splash"/u);
  assert.ok(
    startPs1.indexOf('detail = "stock_reaper_splash"')
      < startPs1.indexOf('$mainWindows = @($windows | Where-Object { $_.class_name -eq "REAPERwnd" })'),
    "Windows start may wait through only the exact stock splash before enforcing the normal-main-window gate",
  );
  assert.match(startPs1, /preserve the dialog and ask the user to resolve it/u);
  assert.match(startPs1, /rerun openreaper-start\.ps1 -RecoverExisting/u);
  assert.match(startPs1, /current REAPER PID and Bridge generation were preserved/u);
  assert.match(startPs1, /function Require-UserAction\(\[string\] \$Message\) \{\s+Write-Error "\[OpenReaper\] \$Message" -ErrorAction Continue\s+exit 75\s+\}/u);
  assert.match(startPs1, /if \(\$windowGate\.state -eq "blocked"\) \{\s+Require-UserAction /u);
  assert.doesNotMatch(startPs1, /if \(\$windowGate\.state -eq "blocked"\) \{\s+Fail /u);
  assert.doesNotMatch(startPs1, /SendMessage|PostMessage|CloseMainWindow|Kill\(/u);
});

test("Windows MCP wrapper binds the shared Recipe store and session roots", () => {
  assert.match(mcpPs1, /OPENREAPER_EXECUTABLE_RECIPE_ROOT/u);
  assert.match(mcpPs1, /OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT/u);
  assert.match(mcpPs1, /DefaultPath \(Join-Path \(Split-Path -Parent \$installRoot\)/u);
  assert.match(mcpPs1, /data\\executable-recipes/u);
  assert.match(mcpPs1, /Join-Path \$sessionRoot "executable-recipes\.official"/u);
  assert.match(mcpPs1, /\$env:OPENREAPER_EXECUTABLE_RECIPE_ROOT = \$recipeRoot/u);
  assert.match(mcpPs1, /\$env:OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT = \$officialRecipeRoot/u);
  assert.match(mcpPs1, /\$env:OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR = \$transportRoot/u);
  assert.match(mcpPs1, /Resolve-OpenReaperDirectory/u);
  assert.match(mcpPs1, /ReparsePoint/u);
});

test("Windows live bridge default script path converts file URLs natively", () => {
  assert.match(liveBridgeExecutor, /fileURLToPath\(new URL\("\.\.\/\.\.\/\.\.\/reaper\/bridge\/openreaper-live-bridge\.lua", import\.meta\.url\)\)/u);
  assert.doesNotMatch(liveBridgeExecutor, /new URL\("\.\.\/\.\.\/\.\.\/reaper\/bridge\/openreaper-live-bridge\.lua", import\.meta\.url\)\.pathname/u);
});

test("Windows start refuses an unmanaged REAPER process before launching", () => {
  assert.match(startPs1, /function Get-RunningReaperProcesses/u);
  assert.match(startPs1, /\$runningReaperProcesses = @\(Get-RunningReaperProcesses\)/u);
  assert.match(startPs1, /An unmanaged REAPER process is already running/u);
  assert.match(startPs1, /Refusing duplicate startup to protect REAPER configuration and Bridge identity/u);
  assert.match(startPs1, /New-Item -ItemType Directory -Force -Path \$ReaperResourceRoot/u);
});

test("macOS start keeps user configuration as the default and isolates only explicit release roots", () => {
  assert.match(startSh, /REAPER_RESOURCE_ROOT_EXPLICIT=false/u);
  assert.match(startSh, /--reaper-resource-root/u);
  assert.match(startSh, /reaper_args=\("-newinst" "-nosplash"\)/u);
  assert.match(startSh, /if \[\[ "\$\{REAPER_RESOURCE_ROOT_EXPLICIT\}" == "true" \]\]; then\s+reaper_args\+=\("-cfgfile" "\$\{REAPER_RESOURCE_ROOT\}\/REAPER\.ini"\)/u);
  assert.match(startSh, /echo "\[OpenReaper\] reaper-config-mode=user_default"/u);
  assert.match(startSh, /does not select or write a theme/u);
  assert.match(startSh, /cannot be combined with a REAPER -cfgfile argument/u);
  assert.ok(
    startSh.indexOf('dialog_result="$(run_startup_dialog_observer)"')
      < startSh.indexOf("if bridge_heartbeat_ready; then"),
    "macOS start must inspect startup dialogs before accepting heartbeat readiness",
  );
});

test("Windows Doctor matches escaped package paths in TOML and JSON configs", () => {
  const functionSource = doctor.match(
    /function pathAliases\(filePath\) \{[\s\S]*?return \[\.\.\.aliases\];\n\}/u,
  )?.[0];
  assert.ok(functionSource, "pathAliases implementation should remain discoverable for this focused contract test");
  const pathAliases = Function(`return (${functionSource})`)();
  const windowsPath = "C:\\Users\\何星宇\\AppData\\Local\\OpenReaper\\current\\bin\\openreaper-mcp.ps1";
  assert.ok(pathAliases(windowsPath).includes(windowsPath.replaceAll("\\", "\\\\")));
  assert.deepEqual(pathAliases("/Users/test/.openreaper/current/bin/openreaper-mcp"), [
    "/Users/test/.openreaper/current/bin/openreaper-mcp",
  ]);
});

test("Windows installer preserves after-manifest evidence when Node writes stderr", () => {
  assert.match(installerPs1, /\$installLog = Join-Path \$EvidenceRoot "install\.log"/u);
  assert.match(installerPs1, /\$ErrorActionPreference = "Continue"/u);
  assert.match(installerPs1, /\$PSNativeCommandUseErrorActionPreference = \$false/u);
  assert.match(installerPs1, /finally \{[\s\S]*\$ErrorActionPreference = \$previousErrorActionPreference/u);
  assert.match(installerPs1, /Get-ExternalManifest \$after/u);
});

test("Windows installer can upgrade its own read-only S3 Action files", () => {
  assert.match(installer, /if \(existingStatus\) await chmod\(action\.targetPath, 0o644\);/u);
  assert.match(installer, /await copyFile\(action\.sourcePath, action\.targetPath\);/u);
  assert.match(installer, /if \(existingStatus\) await chmod\(action\.targetPath, 0o444\)\.catch\(\(\) => \{\}\);/u);
});

test("Windows uninstaller fails closed before mutation while its installed MCP state is active", () => {
  assert.match(uninstallerPs1, /function Assert-OpenReaperUninstallReady/u);
  assert.match(uninstallerPs1, /\[System\.IO\.Path\]::GetFullPath\(\$InstallRoot\)/u);
  assert.match(uninstallerPs1, /Join-Path \$resolvedInstallRoot "bin\\openreaper-mcp-bootstrap\.mjs"/u);
  assert.match(uninstallerPs1, /Join-Path \$resolvedInstallRoot "vendor\\openreaper-kernel\\packages\\mcp-server\\src\\openreaper-mcp-stdio\.mjs"/u);
  assert.match(uninstallerPs1, /Get-CimInstance Win32_Process -Filter "Name = 'node\.exe'"/u);
  assert.match(uninstallerPs1, /IndexOf\(\$_, \[System\.StringComparison\]::OrdinalIgnoreCase\)/u);
  assert.match(uninstallerPs1, /\[System\.IO\.FileShare\]::None/u);
  assert.match(uninstallerPs1, /Close or restart the MCP client, then rerun uninstall/u);
  assert.doesNotMatch(uninstallerPs1, /Stop-Process|CloseMainWindow|\.Kill\(|taskkill/u);

  const checks = [...uninstallerPs1.matchAll(/^Assert-OpenReaperUninstallReady$/gmu)].map(({ index }) => index);
  assert.equal(checks.length, 2, "the wrapper must preflight before evidence and again immediately before Node mutation");
  assert.ok(checks[0] < uninstallerPs1.indexOf("New-Item -ItemType Directory -Force -Path $EvidenceRoot"));
  assert.ok(checks[0] < uninstallerPs1.indexOf("Get-PathManifest $before"));
  assert.ok(checks[1] > uninstallerPs1.indexOf("Get-PathManifest $before"));
  assert.ok(checks[1] < uninstallerPs1.indexOf("& $nodePath @arguments"));
});

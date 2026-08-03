import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const installer = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/install-openreaper.mjs"),
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
const startPs1 = await readFile(
  path.resolve(import.meta.dirname, "../../scripts/openreaper-alpha-package/openreaper-start.ps1"),
  "utf8",
);

test("Windows installer secures the native PowerShell start and Doctor entrypoints", () => {
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
  assert.match(startPs1, /\$resourceConfigFile = Join-Path \$ReaperResourceRoot "REAPER\.ini"/u);
  assert.match(startPs1, /\$launchArgs = @\([\s\S]*"-resourcepath", \(Quote-ProcessArgument \$ReaperResourceRoot\),[\s\S]*"-cfgfile", \(Quote-ProcessArgument \$resourceConfigFile\)[\s\S]*\)/u);
  assert.match(startPs1, /function Quote-ProcessArgument\(\[string\] \$Value\)/u);
  assert.match(startPs1, /if \(\$launchArgs\.Count -gt 0\) \{/u);
  assert.match(startPs1, /Start-Process -FilePath \$binary -ArgumentList \$launchArgs/u);
  assert.match(startPs1, /Start-Process -FilePath \$binary -WorkingDirectory \(Split-Path -Parent \$binary\) -PassThru/u);
});

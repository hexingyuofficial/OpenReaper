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

test("Windows installer secures the native PowerShell start and Doctor entrypoints", () => {
  assert.match(installer, /const startCommand = path\.join\(installedBin, process\.platform === "win32" \? "openreaper-start\.ps1" : "openreaper-start"\);/u);
  assert.match(installer, /const doctorCommand = path\.join\(installedBin, process\.platform === "win32" \? "openreaper-doctor\.ps1" : "openreaper-doctor"\);/u);
  assert.match(doctor, /const startCommand = path\.join\(installRoot, "bin", process\.platform === "win32" \? "openreaper-start\.ps1" : "openreaper-start"\);/u);
  assert.match(doctor, /const doctorCommand = path\.join\(installRoot, "bin", process\.platform === "win32" \? "openreaper-doctor\.ps1" : "openreaper-doctor"\);/u);
});

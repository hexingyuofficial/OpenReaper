import { execFileSync } from "node:child_process";

const root = process.cwd();

execFileSync(process.execPath, ["--test", "tests/layer4d/call-template-runtime.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Template Runtime Binding / Live Smoke Gate 4D checks ok.");

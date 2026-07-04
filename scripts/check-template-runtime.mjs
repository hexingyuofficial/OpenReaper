import { execFileSync } from "node:child_process";

const root = process.cwd();

execFileSync(process.execPath, ["scripts/build-live-bridge.mjs", "--check"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4d/call-template-runtime.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4d1/live-bridge-executor.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4d2/openreaper-live-bridge.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4dx/read-handler-expansion.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4dx/read-b-handler-expansion.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4dx/first-real-a1-handler-expansion.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["--test", "tests/layer4dx/first-real-a2-render-route.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
  cwd: root,
  stdio: "inherit",
});

console.log("Template Runtime Binding / Live Smoke Gate 4D checks ok.");

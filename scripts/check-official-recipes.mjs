import { execFileSync } from "node:child_process";

execFileSync(process.execPath, [
  "--test",
  "tests/layer7/official-draft-recipes.test.mjs",
  "tests/layer7/official-recipe-fake-smoke.test.mjs",
  "tests/layer7/layer7-r1-recipe-transcript-driver.test.mjs",
  "tests/alpha3/alpha3-45-official-executable-recipes.test.mjs",
  "tests/alpha3/alpha3-45-official-live-harness.test.mjs",
], {
  cwd: process.cwd(),
  stdio: "inherit",
});

console.log("Official recipe draft, fake-smoke, R1 transcript, Alpha3.45 executable, and live-harness checks ok.");

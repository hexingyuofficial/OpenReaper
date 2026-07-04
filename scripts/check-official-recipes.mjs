import { execFileSync } from "node:child_process";

execFileSync(process.execPath, [
  "--test",
  "tests/layer7/official-draft-recipes.test.mjs",
  "tests/layer7/official-recipe-fake-smoke.test.mjs",
  "tests/layer7/layer7-r1-recipe-transcript-driver.test.mjs",
], {
  cwd: process.cwd(),
  stdio: "inherit",
});

console.log("Official recipe draft, fake-smoke, and R1 transcript driver checks ok.");

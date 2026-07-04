import { execFileSync } from "node:child_process";

execFileSync(process.execPath, [
  "--test",
  "tests/layer7/official-draft-recipes.test.mjs",
  "tests/layer7/official-recipe-fake-smoke.test.mjs",
], {
  cwd: process.cwd(),
  stdio: "inherit",
});

console.log("Official recipe draft and fake-smoke checks ok.");

import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["--test", "tests/layer7/official-draft-recipes.test.mjs"], {
  cwd: process.cwd(),
  stdio: "inherit",
});

console.log("Official recipe draft checks ok.");

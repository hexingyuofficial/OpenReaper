import { spawn } from "node:child_process";

/**
 * Map a child_process exit (code, signal) to a numeric code.
 * Unknown completions are non-zero so Studio Start cannot mask a helper crash
 * as success (Zhuanz1: openreaper-start 124 / STARTUP_BUDGET_EXHAUSTED).
 */
export function exitCodeFromChild(code, signal) {
  if (typeof code === "number") {
    return code;
  }
  if (signal) {
    return 1;
  }
  return 1;
}

export function runProcess(command, args, { cwd, env, inherit = true } = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    if (!inherit) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
        process.stdout.write(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
        process.stderr.write(chunk);
      });
    }
    const finish = (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        code: exitCodeFromChild(code, signal),
        signal,
        stdout,
        stderr,
        pid: child.pid,
      });
    };
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
    child.on("close", finish);
  });
}

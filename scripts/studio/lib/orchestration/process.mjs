import { spawn } from "node:child_process";

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
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({
        code: code ?? (signal ? 1 : 0),
        signal,
        stdout,
        stderr,
        pid: child.pid,
      });
    });
  });
}

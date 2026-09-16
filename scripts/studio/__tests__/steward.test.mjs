import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  parsePidFileText,
  processIsAlive,
  readPidFile,
  reaperPidFilePath,
  stopStudioSteward,
  watchReaperPeer,
} from "../lib/orchestration/steward.mjs";
import { loadStopContext, STOP_STEPS } from "../lib/orchestration/stop-steps.mjs";
import { startPiRpcHost } from "../lib/agent-seam/pi-rpc-host.mjs";
import { studioPiRpcEndpointPath } from "../lib/orchestration/pi-rpc-lifecycle.mjs";

describe("steward pid helpers", () => {
  it("parses helper reaper.pid text", () => {
    expect(parsePidFileText("4321\n")).toBe(4321);
    expect(parsePidFileText("  99  extra")).toBe(99);
    expect(parsePidFileText("")).toBeNull();
    expect(parsePidFileText("nope")).toBeNull();
  });

  it("resolves the packaged helper pid file under session/", () => {
    expect(reaperPidFilePath("/opt/openreaper/current")).toBe(
      path.join("/opt/openreaper/current", "session", "reaper.pid"),
    );
  });

  it("reads a pid file from disk", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-pid-"));
    const file = path.join(tmp, "reaper.pid");
    await writeFile(file, "12345\n", "utf8");
    try {
      expect(await readPidFile(file)).toBe(12345);
      expect(await readPidFile(path.join(tmp, "missing"))).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("processIsAlive is true for this process", () => {
    expect(processIsAlive(process.pid)).toBe(true);
    expect(processIsAlive(0)).toBe(false);
  });
});

describe("watchReaperPeer", () => {
  it("does not fire onGone when pid and pid file are missing", async () => {
    const gone = [];
    let t = 0;
    const watch = watchReaperPeer({
      pid: null,
      pidFile: null,
      intervalMs: 60_000,
      graceMs: 20,
      now: () => t,
      isAlive: () => false,
      readPid: async () => null,
      onGone: (info) => gone.push(info),
    });
    t = 50;
    await watch.tick();
    await watch.tick();
    watch.stop();
    expect(gone).toEqual([]);
  });

  it("adopts a successor pid from the helper pid file", async () => {
    const gone = [];
    let t = 0;
    let filePid = 100;
    const alive = new Set([100, 200]);
    const watch = watchReaperPeer({
      pid: 100,
      pidFile: "/tmp/reaper.pid",
      intervalMs: 60_000,
      graceMs: 30,
      now: () => t,
      isAlive: (pid) => alive.has(pid),
      readPid: async () => filePid,
      onGone: (info) => gone.push(info),
    });
    await watch.tick();
    alive.delete(100);
    filePid = 200;
    t = 100;
    await watch.tick();
    expect(watch.getPid()).toBe(200);
    await watch.tick();
    expect(gone).toEqual([]);
    watch.stop();
  });

  it("fires onGone after grace when REAPER pid dies with no successor", async () => {
    const gone = [];
    let t = 0;
    const watch = watchReaperPeer({
      pid: 42,
      pidFile: null,
      intervalMs: 60_000,
      graceMs: 25,
      now: () => t,
      isAlive: () => false,
      readPid: async () => null,
      onGone: (info) => gone.push(info),
    });
    await watch.tick();
    t = 40;
    await watch.tick();
    watch.stop();
    expect(gone).toEqual([{ pid: 42, pidFile: null, reason: "reaper_exited" }]);
  });
});

describe("stopStudioSteward", () => {
  it("SIGTERMs a child host, waits, and unlinks the endpoint file", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-stop-steward-"));
    const endpointFile = path.join(tmp, "pi-rpc-endpoint-v1.json");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    await writeFile(endpointFile, JSON.stringify({ hostPid: child.pid }), "utf8");
    try {
      const result = await stopStudioSteward({
        hostPid: child.pid,
        endpointFile,
        timeoutMs: 2000,
      });
      expect(result.host.killed || result.host.alreadyDead).toBe(true);
      expect(processIsAlive(child.pid)).toBe(false);
      expect(result.endpointRemoved).toBe(true);
    } finally {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("Stop pipeline steward teardown", () => {
  it("STOP_STEPS agent.pi_rpc calls stopStudioSteward", async () => {
    const calls = [];
    const step = STOP_STEPS.find((item) => item.id === "agent.pi_rpc");
    await step.run({
      homeDir: "/tmp/studio-home",
      state: {
        pi: {
          mode: "started",
          hostPid: 111,
          pid: 222,
          endpointFile: "/tmp/endpoint.json",
        },
      },
      log() {},
      stopStudioSteward: async (args) => {
        calls.push(args);
        return { host: { alreadyDead: true, killed: false }, pi: null, endpointRemoved: true };
      },
    });
    expect(calls).toEqual([
      { hostPid: 111, piPid: 222, endpointFile: "/tmp/endpoint.json" },
    ]);
  });

  it("loadStopContext falls back to the endpoint file when session is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-stop-orphan-"));
    const homeDir = path.join(tmp, "home");
    const endpointFile = studioPiRpcEndpointPath(homeDir);
    await mkdir(path.dirname(endpointFile), { recursive: true });
    await writeFile(
      endpointFile,
      JSON.stringify({ hostPid: 777, piPid: 778, healthUrl: "http://127.0.0.1:9/health" }),
      "utf8",
    );
    try {
      expect(await loadStopContext(homeDir)).toMatchObject({
        homeDir,
        orphanEndpoint: true,
        state: { pi: { mode: "started", hostPid: 777, pid: 778, endpointFile } },
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("startPiRpcHost steward spawn", () => {
  function fakePiChild() {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    return child;
  }

  it("spawns Pi with workspace cwd and starts a REAPER peer watch", async () => {
    const captured = [];
    const watches = [];
    const child = fakePiChild();
    const host = await startPiRpcHost({
      piExecutable: "/usr/local/bin/pi",
      piArgs: ["--mode", "rpc", "--no-builtin-tools"],
      piEnv: { OPENREAPER_STUDIO: "1" },
      piCwd: "/tmp/studio-workspace",
      reaperPid: 88,
      reaperPidFile: "/tmp/reaper.pid",
      bindSignals: false,
      spawnFn: (command, args, opts) => {
        captured.push({ command, args, opts });
        return child;
      },
      watchPeer: (opts) => {
        watches.push(opts);
        return { stop() {}, getPid: () => opts.pid };
      },
      exitProcess() {},
      log() {},
    });
    try {
      expect(captured[0].opts.cwd).toBe("/tmp/studio-workspace");
      expect(captured[0].args).toContain("--no-builtin-tools");
      expect(watches[0].pid).toBe(88);
      expect(watches[0].pidFile).toBe("/tmp/reaper.pid");
      expect(host.promptUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/prompt$/);
    } finally {
      host.shutdown("test");
    }
  });
});

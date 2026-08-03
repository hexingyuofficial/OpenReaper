import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  WINDOWS_SAFE_FILE_CONTRACT,
  inspectWindowsSafeDirectory,
  readWindowsSafeFile,
} from "../../packages/mcp-server/src/windows-safe-file-v1.mjs";

const scriptPath = path.resolve(
  import.meta.dirname,
  "../../packages/mcp-server/src/windows-safe-file-read.ps1",
);

test("Windows safe file helper uses the packaged native PowerShell contract", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /CreateFile/u);
  assert.match(source, /FileFlagOpenReparsePoint/u);
  assert.match(source, /FileFlagBackupSemantics/u);
  assert.match(source, /GetFileInformationByHandle/u);
  assert.match(source, /ReadFile/u);
  assert.match(source, /\[DateTime\]::new\(1970, 1, 1, 0, 0, 0, \[DateTimeKind\]::Utc\)/u);
  assert.match(source, /FromFileTimeUtc/u);
  assert.doesNotMatch(source, /DateTime::Parse\(/u);
});

test("Windows safe file reader validates bounded native output", async () => {
  const calls = [];
  const result = await readWindowsSafeFile("C:\\OpenReaperLab\\何星宇\\heartbeat.json", {
    platform: "win32",
    maxBytes: 2_048,
    commandRunner: async ({ command, args }) => {
      calls.push({ command, args });
      return {
        stdout: JSON.stringify({
          contract: WINDOWS_SAFE_FILE_CONTRACT,
          status: "valid",
          kind: "file",
          size: 2,
          bytes: 2,
          base64: Buffer.from("{}", "utf8").toString("base64"),
          mtime_ms: 1_700_000_000_000,
          ctime_ms: 1_700_000_000_000,
          nlink: 1,
          read_only: true,
        }),
      };
    },
  });
  assert.equal(result.status, "valid");
  assert.equal(result.value, "{}");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.endsWith("powershell.exe"), true);
  assert.deepEqual(calls[0].args.slice(-6), [
    "-Mode",
    "ReadFile",
    "-LiteralPath",
    "C:\\OpenReaperLab\\何星宇\\heartbeat.json",
    "-MaxBytes",
    "2048",
  ]);
  assert.equal(calls[0].args.includes("-File"), true);
  assert.equal(calls[0].args.includes("-MaxBytes"), true);
});

test("Windows safe directory reader maps native fail-closed states", async () => {
  const result = await inspectWindowsSafeDirectory("C:\\OpenReaperLab\\render", {
    platform: "win32",
    commandRunner: async () => ({
      stdout: JSON.stringify({
        contract: WINDOWS_SAFE_FILE_CONTRACT,
        status: "symlink",
      }),
    }),
  });
  assert.deepEqual(result, { status: "symlink" });
});

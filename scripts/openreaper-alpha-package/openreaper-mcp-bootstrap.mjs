import path from "node:path";
import { pathToFileURL } from "node:url";

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isSafeInteger(nodeMajor) || nodeMajor < 20) {
  process.stderr.write(`OpenReaper requires Node.js 20 or newer. Found ${process.version}.\n`);
  process.exit(1);
}

const serverScript = process.argv[2];
if (typeof serverScript !== "string" || !path.isAbsolute(serverScript)) {
  process.stderr.write("OpenReaper MCP bootstrap requires an absolute server path.\n");
  process.exit(1);
}

process.argv.splice(1, 1);
await import(pathToFileURL(serverScript).href);

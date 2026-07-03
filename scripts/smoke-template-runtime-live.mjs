import {
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  createCallTemplateRuntime,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";

const OPT_IN_ENV = "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE";
const OPT_IN_FLAG = "--live";

const optedIn = process.env[OPT_IN_ENV] === "1" || process.argv.includes(OPT_IN_FLAG);
const runtime = createCallTemplateRuntime();
const baseReport = {
  gate: "template-runtime-live",
  contract: CALL_TEMPLATE_RUNTIME_CONTRACT,
  accepted_catalog: runtime.accepted_catalog,
  opt_in_env: OPT_IN_ENV,
  opt_in_flag: OPT_IN_FLAG,
  opted_in: optedIn,
  spawned_reaper: false,
};

if (!optedIn) {
  console.log(JSON.stringify({
    ...baseReport,
    ok: true,
    skipped: true,
    reason: "explicit_opt_in_required",
  }));
  process.exit(0);
}

console.log(JSON.stringify({
  ...baseReport,
  ok: false,
  skipped: false,
  reason: "live_bridge_executor_not_configured",
  message: "Layer 4D provides the opt-in live gate but refuses to start a DAW process; a live bridge executor must be attached explicitly.",
}));
process.exit(2);

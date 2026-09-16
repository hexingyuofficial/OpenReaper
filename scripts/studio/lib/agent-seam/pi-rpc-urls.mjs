export function commandsUrlFromRpcBase(baseUrl) {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  if (trimmed.endsWith("/prompt")) {
    return `${trimmed.slice(0, -"/prompt".length)}/commands`;
  }
  return `${trimmed}/commands`;
}

export function resolveStudioPiCommandsUrl({ env = process.env, faceConfig, studioState } = {}) {
  const explicit =
    env.OPENREAPER_STUDIO_PI_COMMANDS_URL?.trim() ||
    faceConfig?.piCommandsUrl?.trim() ||
    studioState?.pi?.rpcCommandsUrl?.trim() ||
    "";
  if (explicit) {
    return explicit;
  }
  const promptUrl =
    env.OPENREAPER_STUDIO_PI_RPC_URL?.trim() ||
    faceConfig?.piRpcUrl?.trim() ||
    studioState?.pi?.rpcPromptUrl?.trim() ||
    "";
  return commandsUrlFromRpcBase(promptUrl);
}

export const NATIVE_PATH_INPUT_CONTRACT = "openreaper.native_path_input.v1";

export function classifyNativePathTransport(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const first = value[0];
  if ((first === "\"" || first === "'") && value.at(-1) === first) return "shell_quoted";
  if (/^file:\/\//iu.test(value)) return "file_uri";
  if (/^~(?:[\\/]|$)/u.test(value)) return "tilde_abbreviation";
  if (/%[0-9a-f]{2}/iu.test(value)) return "percent_encoded";
  if (value.startsWith("/") && /\\ /u.test(value)) return "posix_shell_escaped_space";
  return null;
}

export function nativePathTransportRecovery({ field, form }) {
  return {
    contract: NATIVE_PATH_INPUT_CONTRACT,
    zero_write: true,
    reason: `path_transport_${form}`,
    fields: [field],
    recovery: "Use one native absolute path JSON string; keep Unicode/spaces literal.",
    request_patch: {
      input: {
        note: `Replace ${field} with the native absolute path value; omit shell quotes, shell escaping, file://, percent encoding, and ~.`,
      },
    },
  };
}

export function nativePathTransportMessage(field, form) {
  return `${field} uses ${form}; pass one native absolute path directly as a JSON string with Unicode and spaces unchanged.`;
}

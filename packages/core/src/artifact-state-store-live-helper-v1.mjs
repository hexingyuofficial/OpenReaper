import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ARTIFACT_STATE_STORE_CONTRACT,
  artifactPathFromRef,
  normalizeArtifactEnvelope,
  parseArtifactRef,
} from "./artifact-state-store-v1.mjs";

export function createArtifactStateStoreEnvelope({
  ref,
  schema,
  producer,
  created_at = new Date().toISOString(),
  summary = {},
  payload = {},
} = {}) {
  const parts = parseArtifactRef(ref);
  return normalizeArtifactEnvelope({
    contract: ARTIFACT_STATE_STORE_CONTRACT,
    ref,
    id: parts.id,
    owner_pack: parts.owner_pack,
    scope: parts.scope,
    schema,
    producer,
    created_at,
    summary,
    payload,
  });
}

export async function writeArtifactStateStoreEnvelope({
  artifactRoot,
  envelope,
  overwrite = false,
} = {}) {
  const normalized = normalizeArtifactEnvelope(envelope);
  const artifactPath = artifactPathFromRef(artifactRoot, normalized.ref);
  const body = `${JSON.stringify(normalized)}\n`;
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, body, { flag: overwrite ? "w" : "wx" });
  return Object.freeze({
    ref: normalized.ref,
    path: artifactPath,
    bytes: Buffer.byteLength(body, "utf8"),
    envelope: normalized,
  });
}

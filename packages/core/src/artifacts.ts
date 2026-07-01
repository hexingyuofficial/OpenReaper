import path from "node:path";
import { isValidPackId } from "./packs.js";

export const ARTIFACT_CONTRACT_VERSION = "openreaper.artifact.v1";
export const ARTIFACT_REF_PREFIX = "artifact";
export const ARTIFACT_SCOPE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ARTIFACT_ID_PATTERN = /^art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$/;
export const ARTIFACT_REF_PATTERN =
  /^artifact:([a-z][a-z0-9_]*):([a-z][a-z0-9_]*):(art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6})$/;

export interface ArtifactRefParts {
  owner_pack: string;
  scope: string;
  id: string;
}

export function isValidArtifactScope(value: string): boolean {
  return ARTIFACT_SCOPE_PATTERN.test(value);
}

export function isValidArtifactId(value: string): boolean {
  return ARTIFACT_ID_PATTERN.test(value);
}

export function formatArtifactRef(parts: ArtifactRefParts): string {
  validateArtifactRefParts(parts);
  return `${ARTIFACT_REF_PREFIX}:${parts.owner_pack}:${parts.scope}:${parts.id}`;
}

export function parseArtifactRef(ref: string): ArtifactRefParts | null {
  const match = ARTIFACT_REF_PATTERN.exec(ref);
  if (!match) return null;
  return {
    owner_pack: match[1]!,
    scope: match[2]!,
    id: match[3]!,
  };
}

export function validateArtifactRefParts(parts: ArtifactRefParts): void {
  if (!isValidPackId(parts.owner_pack)) {
    throw new Error(`Invalid artifact owner_pack: ${parts.owner_pack}`);
  }
  if (!isValidArtifactScope(parts.scope)) {
    throw new Error(`Invalid artifact scope: ${parts.scope}`);
  }
  if (!isValidArtifactId(parts.id)) {
    throw new Error(`Invalid artifact id: ${parts.id}`);
  }
}

export function artifactPathFromRef(
  artifactRoot: string,
  ref: string,
): string {
  const parsed = parseArtifactRef(ref);
  if (!parsed) {
    throw new Error(`Invalid artifact ref: ${ref}`);
  }
  return artifactPathFromParts(artifactRoot, parsed);
}

export function artifactPathFromParts(
  artifactRoot: string,
  parts: ArtifactRefParts,
): string {
  validateArtifactRefParts(parts);
  const resolvedRoot = path.resolve(artifactRoot);
  const full = path.join(
    resolvedRoot,
    parts.owner_pack,
    parts.scope,
    `${parts.id}.json`,
  );
  const relative = path.relative(resolvedRoot, full);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).length !== 3
  ) {
    throw new Error("Artifact path escaped artifact root");
  }
  return full;
}

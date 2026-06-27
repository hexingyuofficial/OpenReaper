/**
 * Logical reference parser. The bridge resolves these to actual REAPER
 * handles at execution time. See docs/ARCHITECTURE.md "Item References" for
 * the lifecycle contract.
 */

export type ItemRef =
  | { kind: "selected"; index: number }
  | { kind: "guid"; guid: string }
  | { kind: "last_result"; entity: "item" | "region" | "track"; index: number }
  | { kind: "track_item"; track_name: string; index: number };

export type RegionRef =
  | { kind: "region_name"; name: string }
  | { kind: "guid"; guid: string }
  | { kind: "last_result"; entity: "region"; index: number };

export class RefParseError extends Error {
  public readonly input: string;

  constructor(input: string, message: string) {
    super(message);
    this.name = "RefParseError";
    this.input = input;
  }
}

const SELECTED_RE = /^selected:(\d+)$/;
const GUID_RE = /^guid:\{[0-9A-Fa-f-]+\}$/;
const LAST_RESULT_RE = /^last_result:(item|region|track):(\d+)$/;
const TRACK_ITEM_RE = /^track:(.+)\/item:(\d+)$/;
const REGION_NAME_RE = /^region:(.+)$/;

function parseInt10(s: string): number {
  return Number.parseInt(s, 10);
}

export function parseItemRef(input: string): ItemRef {
  if (typeof input !== "string" || input.length === 0) {
    throw new RefParseError(String(input), "Empty or non-string reference");
  }

  const selected = SELECTED_RE.exec(input);
  if (selected) {
    return { kind: "selected", index: parseInt10(selected[1]!) };
  }

  if (GUID_RE.test(input)) {
    return { kind: "guid", guid: input.slice("guid:".length) };
  }

  const lr = LAST_RESULT_RE.exec(input);
  if (lr) {
    const entity = lr[1]! as "item" | "region" | "track";
    return { kind: "last_result", entity, index: parseInt10(lr[2]!) };
  }

  const ti = TRACK_ITEM_RE.exec(input);
  if (ti) {
    return {
      kind: "track_item",
      track_name: ti[1]!,
      index: parseInt10(ti[2]!),
    };
  }

  throw new RefParseError(input, `Unrecognized item reference: ${input}`);
}

export function parseRegionRef(input: string): RegionRef {
  if (typeof input !== "string" || input.length === 0) {
    throw new RefParseError(String(input), "Empty or non-string reference");
  }

  if (GUID_RE.test(input)) {
    return { kind: "guid", guid: input.slice("guid:".length) };
  }

  const lr = LAST_RESULT_RE.exec(input);
  if (lr) {
    if (lr[1] !== "region") {
      throw new RefParseError(
        input,
        `Region reference cannot use last_result entity "${lr[1]!}"`,
      );
    }
    return { kind: "last_result", entity: "region", index: parseInt10(lr[2]!) };
  }

  const rn = REGION_NAME_RE.exec(input);
  if (rn) {
    return { kind: "region_name", name: rn[1]! };
  }

  throw new RefParseError(input, `Unrecognized region reference: ${input}`);
}

export function formatItemRef(ref: ItemRef): string {
  switch (ref.kind) {
    case "selected":
      return `selected:${ref.index}`;
    case "guid":
      return `guid:${ref.guid}`;
    case "last_result":
      return `last_result:${ref.entity}:${ref.index}`;
    case "track_item":
      return `track:${ref.track_name}/item:${ref.index}`;
  }
}

export function formatRegionRef(ref: RegionRef): string {
  switch (ref.kind) {
    case "region_name":
      return `region:${ref.name}`;
    case "guid":
      return `guid:${ref.guid}`;
    case "last_result":
      return `last_result:${ref.entity}:${ref.index}`;
  }
}

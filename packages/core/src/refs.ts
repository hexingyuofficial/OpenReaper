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

export type TrackRef =
  | { kind: "track_name"; name: string }
  | { kind: "guid"; guid: string }
  | { kind: "last_result"; entity: "track"; index: number };

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
const TRACK_NAME_RE = /^track:(.+)$/;
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

/**
 * Parse a track-shaped reference (`track:Name`, `guid:{...}`, or
 * `last_result:track:N`).
 *
 * The TRACK_ITEM check fires first so `track:Foo/item:0` does NOT parse
 * as a track ref with name "Foo/item:0" — the more-specific item shape
 * wins. Bare `track:Foo/anything` without `/item:N` is treated as a
 * (likely-bogus) name and falls through to a name match; the bridge will
 * return TRACK_NOT_FOUND if no such track exists.
 */
export function parseTrackRef(input: string): TrackRef {
  if (typeof input !== "string" || input.length === 0) {
    throw new RefParseError(String(input), "Empty or non-string reference");
  }

  if (GUID_RE.test(input)) {
    return { kind: "guid", guid: input.slice("guid:".length) };
  }

  const lr = LAST_RESULT_RE.exec(input);
  if (lr) {
    if (lr[1] !== "track") {
      throw new RefParseError(
        input,
        `Track reference cannot use last_result entity "${lr[1]!}"`,
      );
    }
    return { kind: "last_result", entity: "track", index: parseInt10(lr[2]!) };
  }

  // Reject item-shaped track:Name/item:N before the broader TRACK_NAME match.
  if (TRACK_ITEM_RE.test(input)) {
    throw new RefParseError(
      input,
      `'${input}' is an item reference; expected a track reference`,
    );
  }

  const tn = TRACK_NAME_RE.exec(input);
  if (tn) {
    return { kind: "track_name", name: tn[1]! };
  }

  throw new RefParseError(input, `Unrecognized track reference: ${input}`);
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

export function formatTrackRef(ref: TrackRef): string {
  switch (ref.kind) {
    case "track_name":
      return `track:${ref.name}`;
    case "guid":
      return `guid:${ref.guid}`;
    case "last_result":
      return `last_result:${ref.entity}:${ref.index}`;
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

import { describe, it, expect } from "vitest";
import {
  parseItemRef,
  parseTrackRef,
  parseRegionRef,
  formatItemRef,
  formatTrackRef,
  formatRegionRef,
  RefParseError,
} from "../refs.js";

describe("parseItemRef", () => {
  it("parses selected:N", () => {
    expect(parseItemRef("selected:0")).toEqual({ kind: "selected", index: 0 });
    expect(parseItemRef("selected:7")).toEqual({ kind: "selected", index: 7 });
  });

  it("parses guid:{...}", () => {
    expect(
      parseItemRef("guid:{12345678-ABCD-1234-5678-ABCDEF012345}"),
    ).toEqual({
      kind: "guid",
      guid: "{12345678-ABCD-1234-5678-ABCDEF012345}",
    });
  });

  it("parses last_result:item:N", () => {
    expect(parseItemRef("last_result:item:3")).toEqual({
      kind: "last_result",
      entity: "item",
      index: 3,
    });
  });

  it("parses last_result:track:0", () => {
    expect(parseItemRef("last_result:track:0")).toEqual({
      kind: "last_result",
      entity: "track",
      index: 0,
    });
  });

  it("parses track:Name/item:N including spaces in track name", () => {
    expect(parseItemRef("track:Impact Variations/item:2")).toEqual({
      kind: "track_item",
      track_name: "Impact Variations",
      index: 2,
    });
  });

  it("rejects empty input", () => {
    expect(() => parseItemRef("")).toThrow(RefParseError);
  });

  it("rejects garbage", () => {
    expect(() => parseItemRef("garbage")).toThrow(RefParseError);
    expect(() => parseItemRef("selected:abc")).toThrow(RefParseError);
    expect(() => parseItemRef("guid:notvalid")).toThrow(RefParseError);
  });

  it("rejects negative selection indices via the grammar", () => {
    expect(() => parseItemRef("selected:-1")).toThrow(RefParseError);
  });
});

describe("parseTrackRef", () => {
  it("parses track:Name", () => {
    expect(parseTrackRef("track:Drums")).toEqual({
      kind: "track_name",
      name: "Drums",
    });
  });

  it("parses track:Name with spaces", () => {
    expect(parseTrackRef("track:Impact Variations")).toEqual({
      kind: "track_name",
      name: "Impact Variations",
    });
  });

  it("parses guid:{...} as a track guid ref", () => {
    expect(parseTrackRef("guid:{ABCDEF01-2345-6789-ABCD-EF0123456789}")).toEqual({
      kind: "guid",
      guid: "{ABCDEF01-2345-6789-ABCD-EF0123456789}",
    });
  });

  it("parses last_result:track:N", () => {
    expect(parseTrackRef("last_result:track:0")).toEqual({
      kind: "last_result",
      entity: "track",
      index: 0,
    });
  });

  it("rejects last_result:item and last_result:region for track refs", () => {
    expect(() => parseTrackRef("last_result:item:0")).toThrow(RefParseError);
    expect(() => parseTrackRef("last_result:region:0")).toThrow(RefParseError);
  });

  it("rejects item-shaped track:Name/item:N", () => {
    // This is an item ref. If a user pastes it into a track_id field by
    // mistake, fail loudly instead of silently looking up a track named
    // "Foo/item:0".
    expect(() => parseTrackRef("track:Foo/item:0")).toThrow(RefParseError);
  });

  it("rejects empty input", () => {
    expect(() => parseTrackRef("")).toThrow(RefParseError);
  });

  it("rejects garbage that isn't track-shaped", () => {
    expect(() => parseTrackRef("garbage")).toThrow(RefParseError);
    expect(() => parseTrackRef("selected:0")).toThrow(RefParseError);
  });
});

describe("parseRegionRef", () => {
  it("parses region:Name", () => {
    expect(parseRegionRef("region:var_01")).toEqual({
      kind: "region_name",
      name: "var_01",
    });
  });

  it("parses guid:{...} for regions", () => {
    expect(parseRegionRef("guid:{ABC-123}")).toEqual({
      kind: "guid",
      guid: "{ABC-123}",
    });
  });

  it("parses last_result:region:N", () => {
    expect(parseRegionRef("last_result:region:2")).toEqual({
      kind: "last_result",
      entity: "region",
      index: 2,
    });
  });

  it("rejects last_result:item for region refs", () => {
    expect(() => parseRegionRef("last_result:item:0")).toThrow(RefParseError);
  });
});

describe("format round trip", () => {
  it("formats selected", () => {
    const ref = parseItemRef("selected:3");
    expect(formatItemRef(ref)).toBe("selected:3");
  });

  it("formats guid", () => {
    const ref = parseItemRef("guid:{ABC-123}");
    expect(formatItemRef(ref)).toBe("guid:{ABC-123}");
  });

  it("formats last_result item", () => {
    const ref = parseItemRef("last_result:item:5");
    expect(formatItemRef(ref)).toBe("last_result:item:5");
  });

  it("formats track_item", () => {
    const ref = parseItemRef("track:Impact Variations/item:2");
    expect(formatItemRef(ref)).toBe("track:Impact Variations/item:2");
  });

  it("formats track name", () => {
    const ref = parseTrackRef("track:Drums");
    expect(formatTrackRef(ref)).toBe("track:Drums");
  });

  it("formats track guid", () => {
    const ref = parseTrackRef("guid:{ABCDEF01-0000-0000-0000-000000000001}");
    expect(formatTrackRef(ref)).toBe("guid:{ABCDEF01-0000-0000-0000-000000000001}");
  });

  it("formats last_result track", () => {
    const ref = parseTrackRef("last_result:track:0");
    expect(formatTrackRef(ref)).toBe("last_result:track:0");
  });

  it("formats region name", () => {
    const ref = parseRegionRef("region:var_01");
    expect(formatRegionRef(ref)).toBe("region:var_01");
  });
});

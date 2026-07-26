import { describe, expect, it } from "vitest";

import {
  backdropCacheDescriptor,
  characterCacheDescriptor,
  keyframeCacheDescriptor,
} from "./build-cache.js";

describe("image-model cache keying", () => {
  const base = {
    beatId: "hook",
    cue: "a barista at dawn",
    provider: "gemini",
    quality: "hd" as const,
    size: "1536x1024",
  };

  it("keeps existing keys stable when no model is set (undefined is dropped from the hash)", () => {
    expect(backdropCacheDescriptor(base).key).toBe(
      backdropCacheDescriptor({ ...base, model: undefined }).key
    );
    expect(keyframeCacheDescriptor(base).key).toBe(
      keyframeCacheDescriptor({ ...base, model: undefined }).key
    );
  });

  it("re-keys backdrops, keyframes, and character sheets on a model switch", () => {
    expect(backdropCacheDescriptor({ ...base, model: "pro" }).key).not.toBe(
      backdropCacheDescriptor(base).key
    );
    expect(keyframeCacheDescriptor({ ...base, model: "pro" }).key).not.toBe(
      keyframeCacheDescriptor({ ...base, model: "flash" }).key
    );
    const charBase = { name: "yuna", cue: "sheet", provider: "gemini", quality: "hd" as const, size: "1536x1024" };
    expect(characterCacheDescriptor({ ...charBase, model: "pro" }).key).not.toBe(
      characterCacheDescriptor(charBase).key
    );
  });
});

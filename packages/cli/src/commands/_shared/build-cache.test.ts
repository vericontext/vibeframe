import { describe, expect, it } from "vitest";

import {
  characterCacheDescriptor,
  keyframeCacheDescriptor,
  videoCacheDescriptor,
} from "./build-cache.js";

describe("characterCacheDescriptor", () => {
  const base = {
    name: "nova",
    cue: "teal jacket engineer",
    provider: "openai",
    quality: "hd" as const,
    size: "1536x1024",
  };

  it("produces a deterministic, character-scoped cache path", () => {
    const a = characterCacheDescriptor(base);
    const b = characterCacheDescriptor(base);
    expect(a.key).toBe(b.key);
    expect(a.path).toBe(`.vibeframe/cache/assets/character-${a.key}.png`);
  });

  it("changes the key when the prompt or name changes", () => {
    const a = characterCacheDescriptor(base);
    expect(characterCacheDescriptor({ ...base, cue: "red jacket" }).key).not.toBe(a.key);
    expect(characterCacheDescriptor({ ...base, name: "rival" }).key).not.toBe(a.key);
  });
});

describe("videoCacheDescriptor character invalidation", () => {
  const base = { beatId: "hook", cue: "walk the pit lane", provider: "seedance", duration: 5 };

  it("keeps the legacy key when no characters are supplied", () => {
    const withoutField = videoCacheDescriptor(base);
    const withEmpty = videoCacheDescriptor({ ...base, characters: [] });
    expect(withEmpty.key).toBe(withoutField.key);
  });

  it("changes the key when character references change", () => {
    const none = videoCacheDescriptor(base);
    const nova = videoCacheDescriptor({ ...base, characters: ["assets/character-nova.png"] });
    const pair = videoCacheDescriptor({
      ...base,
      characters: ["assets/character-nova.png", "assets/character-rival.png"],
    });
    expect(nova.key).not.toBe(none.key);
    expect(pair.key).not.toBe(nova.key);
  });
});

describe("videoCacheDescriptor keyframe invalidation", () => {
  const base = { beatId: "hook", cue: "walk the pit lane", provider: "seedance", duration: 5 };

  it("keeps the legacy key when no keyframe is supplied", () => {
    expect(videoCacheDescriptor({ ...base, keyframe: undefined }).key).toBe(
      videoCacheDescriptor(base).key
    );
  });

  it("changes the key when the keyframe prompt changes", () => {
    const a = videoCacheDescriptor({ ...base, keyframe: "nova at the pit wall" });
    const b = videoCacheDescriptor({ ...base, keyframe: "nova on the grid" });
    expect(a.key).not.toBe(videoCacheDescriptor(base).key);
    expect(b.key).not.toBe(a.key);
  });
});

describe("keyframeCacheDescriptor", () => {
  const base = {
    beatId: "hook",
    cue: "nova walking down the pit lane, cinematic",
    provider: "openai",
    quality: "hd" as const,
    size: "1536x1024",
    ratio: "3:2",
  };

  it("produces a deterministic, keyframe-scoped cache path", () => {
    const a = keyframeCacheDescriptor(base);
    expect(keyframeCacheDescriptor(base).key).toBe(a.key);
    expect(a.path).toBe(`.vibeframe/cache/assets/keyframe-${a.key}.png`);
  });

  it("changes the key when the prompt or character sheets change", () => {
    const a = keyframeCacheDescriptor(base);
    expect(keyframeCacheDescriptor({ ...base, cue: "nova on the grid" }).key).not.toBe(a.key);
    expect(
      keyframeCacheDescriptor({ ...base, characters: ["assets/character-nova.png"] }).key
    ).not.toBe(a.key);
  });
});

import { describe, expect, it } from "vitest";

import { formatBytes, localMinute } from "./take.js";

describe("take list times", () => {
  it("shows a stored UTC time in the reader's time zone", () => {
    expect(localMinute("2026-11-15T16:45:12.000Z", "Asia/Seoul")).toBe("2026-11-16 01:45");
    expect(localMinute("2026-11-15T16:45:12.000Z", "America/Los_Angeles")).toBe("2026-11-15 08:45");
    expect(localMinute("2026-11-15T00:05:00.000Z", "UTC")).toBe("2026-11-15 00:05");
  });

  it("leaves an unparseable time as it is", () => {
    expect(localMinute("not a time")).toBe("not a time");
  });
});

describe("take prune sizes", () => {
  it("reads in B, KB, or MB", () => {
    expect(formatBytes(100)).toBe("100 B");
    expect(formatBytes(2_500)).toBe("2.5 KB");
    expect(formatBytes(16_000_000)).toBe("16.0 MB");
  });
});

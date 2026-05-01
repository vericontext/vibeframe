import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUploadHost } from "./upload-host.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("resolveUploadHost", () => {
  it("requires S3 credentials and bucket when VIBE_UPLOAD_PROVIDER=s3", async () => {
    process.env.VIBE_UPLOAD_PROVIDER = "s3";
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
    delete process.env.VIBE_UPLOAD_S3_BUCKET;

    await expect(resolveUploadHost()).rejects.toThrow(
      /AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and VIBE_UPLOAD_S3_BUCKET/
    );
  });

  it("uploads to S3 with a presigned PUT URL and returns a temporary HTTPS URL", async () => {
    process.env.VIBE_UPLOAD_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    process.env.AWS_REGION = "us-east-1";
    process.env.VIBE_UPLOAD_S3_BUCKET = "vibeframe-test";
    process.env.VIBE_UPLOAD_S3_PREFIX = "tmp/uploads";
    process.env.VIBE_UPLOAD_TTL_SECONDS = "900";

    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const host = await resolveUploadHost();
    const result = await host.uploadImage(Buffer.from("image"), {
      filename: "frame.png",
      mimeType: "image/png",
    });

    expect(host.provider).toBe("s3");
    expect(result.provider).toBe("s3");
    expect(result.url).toMatch(
      /^https:\/\/vibeframe-test\.s3\.us-east-1\.amazonaws\.com\/tmp\/uploads\/.+\.png$/
    );
    expect(result.expiresAt).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(String(url)).toContain("X-Amz-Expires=900");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ "content-type": "image/png" });
  });
});

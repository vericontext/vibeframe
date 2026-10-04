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

  it("uploads to S3 with a presigned PUT and returns a presigned GET that expires", async () => {
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
      /^https:\/\/vibeframe-test\.s3\.us-east-1\.amazonaws\.com\/tmp\/uploads\/.+\.png\?/
    );
    // A signed GET works on private buckets and stops working after the TTL.
    expect(result.url).toContain("X-Amz-Signature=");
    expect(result.url).toContain("X-Amz-Expires=900");
    expect(result.expiresAt).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(String(url)).toContain("X-Amz-Expires=900");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ "content-type": "image/png" });
  });

  it("returns the plain object URL when a public base URL is configured", async () => {
    process.env.VIBE_UPLOAD_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    process.env.AWS_REGION = "us-east-1";
    process.env.VIBE_UPLOAD_S3_BUCKET = "vibeframe-test";
    process.env.VIBE_UPLOAD_PUBLIC_BASE_URL = "https://cdn.example.com/";
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as typeof fetch;

    const result = await (await resolveUploadHost()).uploadImage(Buffer.from("image"));
    expect(result.url).toMatch(/^https:\/\/cdn\.example\.com\/vibeframe\/tmp\/.+\.png$/);
  });

  it("caps S3 presign lifetimes at the 7-day SigV4 limit", async () => {
    process.env.VIBE_UPLOAD_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    process.env.AWS_REGION = "us-east-1";
    process.env.VIBE_UPLOAD_S3_BUCKET = "vibeframe-test";
    process.env.VIBE_UPLOAD_TTL_SECONDS = String(30 * 24 * 3600);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as typeof fetch;

    const result = await (await resolveUploadHost()).uploadImage(Buffer.from("image"));
    expect(result.url).toContain("X-Amz-Expires=604800");
  });

  it("sends an ImgBB expiration so uploads are not permanent", async () => {
    process.env.VIBE_UPLOAD_PROVIDER = "imgbb";
    process.env.IMGBB_API_KEY = "imgbb-key";
    process.env.VIBE_UPLOAD_TTL_SECONDS = "600";
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, data: { url: "https://i.ibb.co/x.png" } }))
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await (await resolveUploadHost()).uploadImage(Buffer.from("image"));
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("expiration")).toBe("600");
    expect(result.expiresAt).toBeDefined();
  });
});

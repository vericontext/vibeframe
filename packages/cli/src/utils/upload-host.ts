import { createHash, createHmac, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { loadConfig, getApiKeyFromConfig } from "../config/index.js";

export type UploadHostProvider = "imgbb" | "s3";

export interface UploadImageOptions {
  filename?: string;
  mimeType?: string;
}

export interface UploadImageResult {
  url: string;
  provider: UploadHostProvider;
  expiresAt?: string;
}

export interface UploadHost {
  provider: UploadHostProvider;
  uploadImage(imageBuffer: Buffer, opts?: UploadImageOptions): Promise<UploadImageResult>;
}

function envNumber(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function safePrefix(prefix: string | undefined): string {
  return (prefix ?? "vibeframe/tmp").replace(/^\/+|\/+$/g, "");
}

function extensionFor(opts: UploadImageOptions | undefined): string {
  const fromName = opts?.filename ? extname(opts.filename).replace(/^\./, "") : "";
  if (fromName) return fromName.toLowerCase();
  const mime = opts?.mimeType ?? "image/png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** SigV4 presigned URLs are valid for at most 7 days. */
const S3_MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

/** ImgBB accepts `expiration` between 60 seconds and 180 days. */
const IMGBB_MIN_EXPIRATION_SECONDS = 60;
const IMGBB_MAX_EXPIRATION_SECONDS = 15_552_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function presignS3Url(params: {
  method: "PUT" | "GET";
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  bucket: string;
  key: string;
  ttlSeconds: number;
}): string {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = `${params.bucket}.s3.${params.region}.amazonaws.com`;
  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const canonicalUri = `/${params.key.split("/").map(awsEncode).join("/")}`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${params.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(clamp(params.ttlSeconds, 1, S3_MAX_PRESIGN_SECONDS)),
    "X-Amz-SignedHeaders": "host",
  };
  if (params.sessionToken) {
    query["X-Amz-Security-Token"] = params.sessionToken;
  }

  const canonicalQuery = Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const dateKey = hmac(`AWS4${params.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, params.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function publicS3Url(params: {
  region: string;
  bucket: string;
  key: string;
  publicBaseUrl?: string;
}): string {
  if (params.publicBaseUrl) {
    return `${params.publicBaseUrl.replace(/\/+$/g, "")}/${params.key
      .split("/")
      .map(awsEncode)
      .join("/")}`;
  }
  return `https://${params.bucket}.s3.${params.region}.amazonaws.com/${params.key
    .split("/")
    .map(awsEncode)
    .join("/")}`;
}

async function resolveUploadSettings(): Promise<{
  provider: UploadHostProvider;
  ttlSeconds: number;
  s3: {
    bucket?: string;
    region?: string;
    prefix?: string;
    publicBaseUrl?: string;
  };
}> {
  const config = await loadConfig();
  const provider = (process.env.VIBE_UPLOAD_PROVIDER ??
    config?.upload.provider ??
    "imgbb") as UploadHostProvider;
  return {
    provider,
    ttlSeconds: envNumber("VIBE_UPLOAD_TTL_SECONDS") ?? config?.upload.ttlSeconds ?? 3600,
    s3: {
      bucket: process.env.VIBE_UPLOAD_S3_BUCKET ?? config?.upload.s3?.bucket,
      region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? config?.upload.s3?.region,
      prefix: process.env.VIBE_UPLOAD_S3_PREFIX ?? config?.upload.s3?.prefix,
      publicBaseUrl: process.env.VIBE_UPLOAD_PUBLIC_BASE_URL ?? config?.upload.s3?.publicBaseUrl,
    },
  };
}

export async function resolveUploadHost(): Promise<UploadHost> {
  const settings = await resolveUploadSettings();

  if (settings.provider === "s3") {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;
    const { bucket, region } = settings.s3;
    if (!accessKeyId || !secretAccessKey || !bucket || !region) {
      throw new Error(
        "S3 upload host requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and VIBE_UPLOAD_S3_BUCKET."
      );
    }

    return {
      provider: "s3",
      async uploadImage(imageBuffer, opts) {
        const ext = extensionFor(opts);
        const prefix = safePrefix(settings.s3.prefix);
        const key = `${prefix}/${Date.now()}-${randomUUID()}.${ext}`;
        const presignedUrl = presignS3Url({
          method: "PUT",
          accessKeyId,
          secretAccessKey,
          sessionToken,
          region,
          bucket,
          key,
          ttlSeconds: settings.ttlSeconds,
        });
        const response = await fetch(presignedUrl, {
          method: "PUT",
          headers: {
            "content-type": opts?.mimeType ?? "application/octet-stream",
          },
          body: new Uint8Array(imageBuffer),
        });
        if (!response.ok) {
          throw new Error(`S3 upload failed (${response.status}): ${response.statusText}`);
        }
        // With a public base URL (CDN or public bucket policy) hand out the
        // plain object URL. Otherwise return a presigned GET so private
        // buckets work and the link stops working after the TTL; the object
        // itself stays until a bucket lifecycle rule removes it.
        if (settings.s3.publicBaseUrl) {
          return {
            provider: "s3",
            url: publicS3Url({ region, bucket, key, publicBaseUrl: settings.s3.publicBaseUrl }),
          };
        }
        const ttlSeconds = clamp(settings.ttlSeconds, 1, S3_MAX_PRESIGN_SECONDS);
        return {
          provider: "s3",
          url: presignS3Url({
            method: "GET",
            accessKeyId,
            secretAccessKey,
            sessionToken,
            region,
            bucket,
            key,
            ttlSeconds,
          }),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        };
      },
    };
  }

  return {
    provider: "imgbb",
    async uploadImage(imageBuffer) {
      const imgbbKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
      if (!imgbbKey) {
        throw new Error("IMGBB_API_KEY required for image-to-video uploads.");
      }
      // ImgBB keeps uploads forever unless told otherwise; expire them with
      // the configured TTL.
      const expiration = clamp(settings.ttlSeconds, IMGBB_MIN_EXPIRATION_SECONDS, IMGBB_MAX_EXPIRATION_SECONDS);
      const result = await uploadToImgbb(imageBuffer, imgbbKey, expiration);
      if (!result.success || !result.url) {
        throw new Error(`ImgBB upload failed: ${result.error ?? "unknown error"}`);
      }
      return {
        provider: "imgbb",
        url: result.url,
        expiresAt: new Date(Date.now() + expiration * 1000).toISOString(),
      };
    },
  };
}

/**
 * Upload an image to ImgBB and return its URL (for providers that only take
 * image URLs, such as Kling).
 */
export async function uploadToImgbb(
  imageBuffer: Buffer,
  apiKey: string,
  /** Seconds until ImgBB deletes the image (60 to 15,552,000). Omit for a permanent upload. */
  expirationSeconds?: number,
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const base64Image = imageBuffer.toString("base64");

    const formData = new URLSearchParams();
    formData.append("key", apiKey);
    formData.append("image", base64Image);
    if (expirationSeconds !== undefined) {
      formData.append("expiration", String(expirationSeconds));
    }

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `ImgBB API error (${response.status}): ${response.statusText}`,
      };
    }

    const data = (await response.json()) as {
      success?: boolean;
      data?: { url?: string };
      error?: { message?: string };
    };

    if (data.success && data.data?.url) {
      return { success: true, url: data.data.url };
    } else {
      return { success: false, error: data.error?.message || "Upload failed" };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

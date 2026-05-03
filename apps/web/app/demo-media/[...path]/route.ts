import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const DEMO_ROOT = path.resolve(process.cwd(), "../../assets/demos");

function resolveDemoAsset(parts: string[]) {
  const relativePath = path.normalize(parts.join("/"));
  const assetPath = path.resolve(DEMO_ROOT, relativePath);

  if (assetPath !== DEMO_ROOT && !assetPath.startsWith(`${DEMO_ROOT}${path.sep}`)) {
    throw new Error("Invalid demo asset path");
  }

  return assetPath;
}

function contentTypeFor(assetPath: string) {
  if (assetPath.endsWith(".mp4")) return "video/mp4";
  if (assetPath.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

async function handleDemoAsset(request: NextRequest, parts: string[], includeBody: boolean) {
  let assetPath: string;

  try {
    assetPath = resolveDemoAsset(parts);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const assetStat = await stat(assetPath).catch(() => null);
  if (!assetStat?.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const size = assetStat.size;
  const type = contentTypeFor(assetPath);
  const range = request.headers.get("range");

  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      return new Response("Invalid range", { status: 416 });
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response("Invalid range", {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
        },
      });
    }

    const contentLength = end - start + 1;
    return new Response(
      includeBody
        ? (Readable.toWeb(createReadStream(assetPath, { start, end })) as ReadableStream)
        : null,
      {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Type": type,
        },
      }
    );
  }

  return new Response(
    includeBody ? (Readable.toWeb(createReadStream(assetPath)) as ReadableStream) : null,
    {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
        "Content-Type": type,
      },
    }
  );
}

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handleDemoAsset(request, params.path, true);
}

export async function HEAD(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handleDemoAsset(request, params.path, false);
}

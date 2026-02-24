/**
 * Remotion rendering and compositing utilities.
 *
 * Uses `npx remotion` on-demand — Remotion is NOT a package dependency.
 * Scaffolds a temporary project, renders H264 MP4, and muxes audio separately.
 *
 * Strategy:
 * - Images/Videos are embedded NATIVELY inside the Remotion component using
 *   <Img> / <Video> from Remotion (copied to public/).
 * - No transparent WebM rendering. No FFmpeg overlay compositing.
 * - Final output is always a standard H264 MP4.
 */

import { writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSafe } from "./exec-safe.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RenderMotionOptions {
  /** Generated TSX component code */
  componentCode: string;
  /** Export name of the component */
  componentName: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Output path for rendered video (.webm or .mp4) */
  outputPath: string;
  /** Render with transparent background (default: true) */
  transparent?: boolean;
}

export interface CompositeOptions {
  /** Base video to overlay on */
  baseVideo: string;
  /** Rendered overlay (transparent WebM) */
  overlayPath: string;
  /** Final composited output */
  outputPath: string;
}

export interface RenderResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check that `npx remotion` is available. Returns an error message if not.
 */
export async function ensureRemotionInstalled(): Promise<string | null> {
  try {
    await execSafe("npx", ["remotion", "--help"], { timeout: 30_000 });
    return null;
  } catch {
    return [
      "Remotion CLI not found. Install it with:",
      "  npm install -g @remotion/cli",
      "Or ensure npx is available and can download @remotion/cli on demand.",
    ].join("\n");
  }
}

/**
 * Create a minimal Remotion project in a temp directory.
 * Returns the directory path.
 *
 * @param useMediaPackage - Include @remotion/media for <Video> support (default: false)
 */
export async function scaffoldRemotionProject(
  componentCode: string,
  componentName: string,
  opts: {
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
    useMediaPackage?: boolean;
  },
): Promise<string> {
  const dir = join(tmpdir(), `vibe_motion_${Date.now()}`);
  await mkdir(dir, { recursive: true });

  // package.json — remotion + react deps
  const deps: Record<string, string> = {
    remotion: "^4.0.0",
    "@remotion/cli": "^4.0.0",
    react: "^18.0.0",
    "react-dom": "^18.0.0",
    "@types/react": "^18.0.0",
  };

  // @remotion/media is needed for the <Video> component (per Remotion docs)
  if (opts.useMediaPackage) {
    deps["@remotion/media"] = "^4.0.0";
  }

  const packageJson = {
    name: "vibe-motion-render",
    version: "1.0.0",
    private: true,
    dependencies: deps,
  };
  await writeFile(join(dir, "package.json"), JSON.stringify(packageJson, null, 2));

  // tsconfig.json — minimal config for TSX
  const tsconfig = {
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: false,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  };
  await writeFile(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

  // Component.tsx — the AI-generated (and optionally wrapped) component
  await writeFile(join(dir, "Component.tsx"), componentCode);

  // Root.tsx — Remotion entry point
  const rootCode = `import { registerRoot, Composition } from "remotion";
import { ${componentName} } from "./Component";

const Root = () => {
  return (
    <Composition
      id="${componentName}"
      component={${componentName}}
      durationInFrames={${opts.durationInFrames}}
      fps={${opts.fps}}
      width={${opts.width}}
      height={${opts.height}}
    />
  );
};

registerRoot(Root);
`;
  await writeFile(join(dir, "Root.tsx"), rootCode);

  // Install deps
  if (!existsSync(join(dir, "node_modules"))) {
    // npm install needs to run in the scaffolded directory
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], {
      cwd: dir,
      timeout: 180_000,
    });
  }

  return dir;
}

// ── Standalone Motion Render ───────────────────────────────────────────────

/**
 * Render a standalone Remotion composition to video (no base media).
 * When transparent: tries VP8 then VP9.
 * When opaque: renders H264 MP4.
 */
export async function renderMotion(options: RenderMotionOptions): Promise<RenderResult> {
  const transparent = options.transparent !== false;

  const dir = await scaffoldRemotionProject(
    options.componentCode,
    options.componentName,
    {
      width: options.width,
      height: options.height,
      fps: options.fps,
      durationInFrames: options.durationInFrames,
    },
  );

  try {
    const entryPoint = join(dir, "Root.tsx");

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    if (transparent) {
      const webmOut = options.outputPath.replace(/\.\w+$/, ".webm");

      try {
        await execFileAsync("npx", [
          "remotion", "render", entryPoint, options.componentName, webmOut,
          "--codec", "vp8", "--image-format", "png", "--pixel-format", "yuva420p",
        ], { cwd: dir, timeout: 300_000 });
        return { success: true, outputPath: webmOut };
      } catch {
        // VP8 failed, try VP9
      }

      try {
        await execFileAsync("npx", [
          "remotion", "render", entryPoint, options.componentName, webmOut,
          "--codec", "vp9", "--image-format", "png", "--pixel-format", "yuva420p",
        ], { cwd: dir, timeout: 300_000 });
        return { success: true, outputPath: webmOut };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Transparent render failed (VP8 & VP9): ${msg}` };
      }
    }

    // Non-transparent: H264 MP4
    const mp4Out = options.outputPath.replace(/\.\w+$/, ".mp4");
    await execFileAsync("npx", [
      "remotion", "render", entryPoint, options.componentName, mp4Out,
      "--codec", "h264", "--crf", "18",
    ], { cwd: dir, timeout: 300_000 });
    return { success: true, outputPath: mp4Out };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Remotion render failed: ${msg}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Pre-render code validator & auto-fixer ────────────────────────────────

/**
 * Validates and auto-fixes common LLM-generated Remotion code bugs before
 * attempting to render. Returns fixed code and a list of applied fixes.
 *
 * Known patterns fixed:
 *  1. interpolate(x, [a,b], scalar, num) → interpolate(x, [a,b], [scalar, num])
 *     Cause: outputRange must be an array, not a bare scalar.
 *  2. interpolate(x, [a,b], scalar) where scalar is a variable name
 *     Cause: same — LLM passes a single number variable instead of [from, to].
 */
export function validateAndFixMotionCode(code: string): { code: string; fixes: string[] } {
  const fixes: string[] = [];
  let fixed = code;

  // Pattern 1: interpolate(expr, [a, b], varName, numericLiteral)
  // where varName is a JS identifier and numericLiteral is a number
  // This is the exact bug seen in practice: interpolate(exitEase, [0, 1], barH, 0)
  const pattern1 = /interpolate\(([^,]+),\s*(\[[^\]]+\]),\s*([a-zA-Z_$][a-zA-Z0-9_$.]*),\s*(-?[\d.]+)\s*\)/g;
  fixed = fixed.replace(pattern1, (_match, val, inputRange, outVar, outNum) => {
    const fix = `interpolate(${val}, ${inputRange}, [${outVar}, ${outNum}])`;
    fixes.push(`Fixed scalar outputRange: interpolate(..., ${outVar}, ${outNum}) → [..., [${outVar}, ${outNum}]]`);
    return fix;
  });

  // Pattern 2: interpolate(expr, [a, b], singleIdentifier) — no options arg
  // e.g. interpolate(frame, [0, 30], progress) where progress is not an array
  // Heuristic: if the third arg is a plain identifier (not starting with [) and
  // there's no fourth arg, we can't safely auto-fix without knowing the intent,
  // so just log a warning in the fixes list for visibility.
  const pattern2 = /interpolate\(([^,]+),\s*(\[[^\]]+\]),\s*([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*\)/g;
  let p2match;
  while ((p2match = pattern2.exec(fixed)) !== null) {
    // Only warn if the identifier doesn't look like an array variable name
    const varName = p2match[3];
    if (!varName.includes("[")) {
      fixes.push(`Warning: interpolate third arg "${varName}" may not be an array — verify outputRange is [from, to]`);
    }
  }

  return { code: fixed, fixes };
}

// ── Import injection helper ────────────────────────────────────────────────

/**
 * Inject additional named imports into the existing `from 'remotion'`
 * import statement in the component code.
 * Avoids duplicate identifier errors when the component already imports
 * some of the same names (e.g. AbsoluteFill).
 */
function injectRemotionImports(code: string, additions: string[]): string {
  return code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]remotion['"]/,
    (match, imports) => {
      const existing = imports
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const toAdd = additions.filter((a) => !existing.includes(a));
      if (toAdd.length === 0) return match;
      return `import { ${[...existing, ...toAdd].join(", ")} } from "remotion"`;
    },
  );
}

// ── Native Image Embed ─────────────────────────────────────────────────────

/**
 * Wrap an overlay component to embed a static image as background.
 * Uses Remotion's <Img> component (required per Remotion docs — ensures
 * image is fully loaded before each frame renders).
 *
 * Injects Img and staticFile into the component's existing remotion import
 * to avoid duplicate identifier errors.
 */
export function wrapComponentWithImage(
  componentCode: string,
  componentName: string,
  imageFileName: string,
): { code: string; name: string } {
  const wrappedName = "ImageComposite";

  // Inject Img and staticFile into the existing remotion import
  const modifiedCode = injectRemotionImports(componentCode, ["Img", "staticFile"]);

  const code = `${modifiedCode}

export const ${wrappedName}: React.FC = () => {
  return (
    <AbsoluteFill>
      <Img
        src={staticFile("${imageFileName}")}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <AbsoluteFill>
        <${componentName} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
`;

  return { code, name: wrappedName };
}

/**
 * Render a Remotion component that embeds a static image as background.
 * Copies image to public/, renders H264 MP4 directly — no transparency needed.
 */
export async function renderWithEmbeddedImage(options: {
  componentCode: string;
  componentName: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  imagePath: string;
  imageFileName: string;
  outputPath: string;
}): Promise<RenderResult> {
  const dir = await scaffoldRemotionProject(
    options.componentCode,
    options.componentName,
    {
      width: options.width,
      height: options.height,
      fps: options.fps,
      durationInFrames: options.durationInFrames,
      useMediaPackage: false,
    },
  );

  try {
    // Copy image to public/ so staticFile() can access it
    const publicDir = join(dir, "public");
    await mkdir(publicDir, { recursive: true });
    await copyFile(options.imagePath, join(publicDir, options.imageFileName));

    const entryPoint = join(dir, "Root.tsx");
    const mp4Out = options.outputPath.replace(/\.\w+$/, ".mp4");

    const { execFile: execFileImg } = await import("node:child_process");
    const { promisify: promisifyImg } = await import("node:util");
    const execFileAsyncImg = promisifyImg(execFileImg);
    await execFileAsyncImg("npx", [
      "remotion", "render", entryPoint, options.componentName, mp4Out,
      "--codec", "h264", "--crf", "18",
    ], { cwd: dir, timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });

    return { success: true, outputPath: mp4Out };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Remotion image embed render failed: ${msg}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Native Video Embed ─────────────────────────────────────────────────────

/**
 * Wrap an overlay component to embed a video as background.
 * Uses <Video> from @remotion/media (required per Remotion docs).
 * Video is muted — audio is muxed back via FFmpeg after rendering.
 *
 * Injects staticFile into the component's existing remotion import to avoid
 * duplicate identifier errors. Video is imported from @remotion/media
 * (different module — no conflict).
 */
export function wrapComponentWithVideo(
  componentCode: string,
  componentName: string,
  videoFileName: string,
): { code: string; name: string } {
  const wrappedName = "VideoComposite";

  // Inject staticFile into the existing remotion import
  const modifiedCode = injectRemotionImports(componentCode, ["staticFile"]);

  // Prepend @remotion/media import (different module, no conflict)
  const code = `import { Video } from "@remotion/media";
${modifiedCode}

export const ${wrappedName}: React.FC = () => {
  return (
    <AbsoluteFill>
      <Video
        src={staticFile("${videoFileName}")}
        style={{ width: "100%", height: "100%" }}
        muted
      />
      <AbsoluteFill>
        <${componentName} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
`;

  return { code, name: wrappedName };
}

/**
 * Render a Remotion component that embeds the video directly.
 * Uses @remotion/media's <Video> component (official Remotion approach).
 * After rendering, muxes audio from the original video back into the output.
 */
export async function renderWithEmbeddedVideo(options: {
  componentCode: string;
  componentName: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  videoPath: string;
  videoFileName: string;
  outputPath: string;
}): Promise<RenderResult> {
  const dir = await scaffoldRemotionProject(
    options.componentCode,
    options.componentName,
    {
      width: options.width,
      height: options.height,
      fps: options.fps,
      durationInFrames: options.durationInFrames,
      useMediaPackage: true,
    },
  );

  try {
    // Copy video to public/ so staticFile() can access it
    const publicDir = join(dir, "public");
    await mkdir(publicDir, { recursive: true });
    await copyFile(options.videoPath, join(publicDir, options.videoFileName));

    const entryPoint = join(dir, "Root.tsx");
    const mp4VideoOnly = options.outputPath.replace(/\.\w+$/, "_video_only.mp4");

    // Render H264 (video-only, audio muted inside component)
    const { execFile: execFileVid } = await import("node:child_process");
    const { promisify: promisifyVid } = await import("node:util");
    const execFileAsyncVid = promisifyVid(execFileVid);
    await execFileAsyncVid("npx", [
      "remotion", "render", entryPoint, options.componentName, mp4VideoOnly,
      "--codec", "h264", "--crf", "18",
    ], { cwd: dir, timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });

    // Mux: rendered video + original audio
    const mp4Out = options.outputPath.replace(/\.\w+$/, ".mp4");
    await execSafe("ffmpeg", [
      "-y", "-i", mp4VideoOnly, "-i", options.videoPath,
      "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy", "-c:a", "copy", "-shortest", mp4Out,
    ], { timeout: 120_000 });
    await rm(mp4VideoOnly, { force: true }).catch(() => {});

    return { success: true, outputPath: mp4Out };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Remotion video embed render failed: ${msg}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Caption Component Generator ───────────────────────────────────────────

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

export type CaptionStylePreset = "bold" | "minimal" | "outline" | "karaoke";

export interface GenerateCaptionComponentOptions {
  segments: CaptionSegment[];
  style: CaptionStylePreset;
  fontSize: number;
  fontColor: string;
  position: "top" | "center" | "bottom";
  width: number;
  height: number;
  /** When set, embed the video inside the component (no transparency needed) */
  videoFileName?: string;
}

/**
 * Generate a Remotion TSX component that renders styled captions.
 * No LLM call — purely programmatic from SRT segments + style config.
 */
export function generateCaptionComponent(options: GenerateCaptionComponentOptions): {
  code: string;
  name: string;
} {
  const { segments, style, fontSize, fontColor, position, width, height, videoFileName } = options;
  const name = videoFileName ? "VideoCaptioned" : "CaptionOverlay";

  const segmentsJSON = JSON.stringify(
    segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
  );

  const styleMap: Record<CaptionStylePreset, string> = {
    bold: `
      fontWeight: "bold" as const,
      color: "${fontColor === "yellow" ? "#FFFF00" : "#FFFFFF"}",
      textShadow: "3px 3px 6px rgba(0,0,0,0.9), -1px -1px 3px rgba(0,0,0,0.7)",
      WebkitTextStroke: "1px rgba(0,0,0,0.5)",
    `,
    minimal: `
      fontWeight: "normal" as const,
      color: "#FFFFFF",
      textShadow: "1px 1px 3px rgba(0,0,0,0.5)",
    `,
    outline: `
      fontWeight: "bold" as const,
      color: "#FFFFFF",
      WebkitTextStroke: "2px #FF0000",
      textShadow: "none",
    `,
    karaoke: `
      fontWeight: "bold" as const,
      color: "#00FFFF",
      textShadow: "2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.6)",
    `,
  };

  const justifyContent =
    position === "top" ? "flex-start" : position === "center" ? "center" : "flex-end";
  const paddingDir = position === "top" ? "paddingTop" : position === "bottom" ? "paddingBottom" : "";
  const paddingVal = position === "center" ? "" : `${paddingDir}: 40,`;

  const videoImport = videoFileName ? `, staticFile` : "";
  const videoElement = videoFileName
    ? `<Video src={staticFile("${videoFileName}")} style={{ width: "100%", height: "100%" }} muted />`
    : "";
  const videoMediaImport = videoFileName
    ? `import { Video } from "@remotion/media";\n`
    : "";

  const code = `import { AbsoluteFill, useCurrentFrame, useVideoConfig${videoImport} } from "remotion";
${videoMediaImport}
interface Segment {
  start: number;
  end: number;
  text: string;
}

const segments: Segment[] = ${segmentsJSON};

export const ${name} = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const activeSegment = segments.find(
    (s) => currentTime >= s.start && currentTime < s.end
  );

  return (
    <AbsoluteFill>
      ${videoElement}
      {activeSegment && (
        <AbsoluteFill
          style={{
            display: "flex",
            justifyContent: "${justifyContent}",
            alignItems: "center",
            ${paddingVal}
          }}
        >
          <div
            style={{
              fontSize: ${fontSize},
              fontFamily: "Arial, Helvetica, sans-serif",
              textAlign: "center" as const,
              maxWidth: "${Math.round(width * 0.9)}px",
              lineHeight: 1.3,
              padding: "8px 16px",
              ${styleMap[style]}
            }}
          >
            {activeSegment.text}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
`;

  return { code, name };
}

// ── Legacy composite helpers (kept for backward compat) ───────────────────

/**
 * Composite a transparent overlay on top of a base video using FFmpeg.
 * @deprecated Use renderWithEmbeddedVideo() for new code.
 */
export async function compositeOverlay(options: CompositeOptions): Promise<RenderResult> {
  try {
    await execSafe("ffmpeg", [
      "-y", "-i", options.baseVideo, "-i", options.overlayPath,
      "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=1[out]",
      "-map", "[out]", "-map", "0:a?", "-c:a", "copy",
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
      options.outputPath,
    ], { timeout: 300_000 });
    return { success: true, outputPath: options.outputPath };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `FFmpeg composite failed: ${msg}` };
  }
}

/**
 * Composite a transparent overlay on top of a static image using FFmpeg.
 * @deprecated Use renderWithEmbeddedImage() for new code.
 */
export async function compositeWithImage(options: {
  baseImage: string;
  overlayPath: string;
  outputPath: string;
  durationSeconds: number;
  fps?: number;
}): Promise<RenderResult> {
  try {
    const fps = options.fps || 30;
    await execSafe("ffmpeg", [
      "-y", "-loop", "1", "-framerate", String(fps), "-i", options.baseImage,
      "-i", options.overlayPath,
      "-filter_complex", "[0:v]scale=iw:ih[base];[base][1:v]overlay=0:0:shortest=1[out]",
      "-map", "[out]",
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
      "-t", String(options.durationSeconds),
      options.outputPath,
    ], { timeout: 300_000 });
    return { success: true, outputPath: options.outputPath };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `FFmpeg image composite failed: ${msg}` };
  }
}

/**
 * Full pipeline: render motion graphic → composite onto base video.
 * @deprecated Use renderWithEmbeddedVideo() for new code.
 */
export async function renderAndComposite(
  motionOpts: RenderMotionOptions,
  baseVideo?: string,
  finalOutput?: string,
): Promise<RenderResult> {
  const renderOpts = {
    ...motionOpts,
    transparent: !!baseVideo,
    outputPath: baseVideo
      ? motionOpts.outputPath.replace(/\.\w+$/, "_overlay.webm")
      : motionOpts.outputPath,
  };

  const renderResult = await renderMotion(renderOpts);
  if (!renderResult.success || !renderResult.outputPath) {
    return renderResult;
  }

  if (!baseVideo) {
    return renderResult;
  }

  const output = finalOutput || motionOpts.outputPath;
  const compositeResult = await compositeOverlay({
    baseVideo,
    overlayPath: renderResult.outputPath,
    outputPath: output,
  });

  await rm(renderResult.outputPath, { force: true }).catch(() => {});
  return compositeResult;
}

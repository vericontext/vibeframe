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
import { createHash } from "node:crypto";
import { execSafe } from "./exec-safe.js";

/** Pinned Remotion version for reproducible renders */
const REMOTION_VERSION = "4.0.447";

/** Cached node_modules directory to avoid repeated npm install */
const REMOTION_CACHE_DIR = join(tmpdir(), "vibe_remotion_cache");

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
    await execSafe("npx", ["--yes", "remotion", "--help"], { timeout: 60_000 });
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[Remotion] ensureRemotionInstalled failed: ${detail.slice(0, 300)}`);
    return [
      "Remotion CLI not found or failed to initialize.",
      `  Debug: ${detail.slice(0, 200)}`,
      "  Fix: npm install -g @remotion/cli",
      "  Or ensure npx is available and can download @remotion/cli on demand.",
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

  // package.json — remotion + react deps (pinned versions)
  const deps: Record<string, string> = {
    remotion: REMOTION_VERSION,
    "@remotion/cli": REMOTION_VERSION,
    react: "^18.0.0",
    "react-dom": "^18.0.0",
    "@types/react": "^18.0.0",
  };

  // @remotion/media is needed for the <Video> component (per Remotion docs)
  if (opts.useMediaPackage) {
    deps["@remotion/media"] = REMOTION_VERSION;
  }

  const packageJson = {
    name: "vibe-motion-render",
    version: "1.0.0",
    private: true,
    dependencies: deps,
  };
  const packageJsonStr = JSON.stringify(packageJson, null, 2);
  await writeFile(join(dir, "package.json"), packageJsonStr);

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

  // Install deps — use cached node_modules if deps match
  const depsHash = createHash("md5").update(packageJsonStr).digest("hex").slice(0, 12);
  const cacheMarker = join(REMOTION_CACHE_DIR, `.deps-${depsHash}`);
  const cachedModules = join(REMOTION_CACHE_DIR, "node_modules");

  if (existsSync(cacheMarker) && existsSync(cachedModules)) {
    // Symlink cached node_modules to avoid re-install
    const { symlink } = await import("node:fs/promises");
    try {
      await symlink(cachedModules, join(dir, "node_modules"), "dir");
    } catch {
      // Symlink failed (e.g., cross-device), fall back to npm install
      await this_npmInstall(dir);
    }
  } else {
    // Install fresh and cache
    await this_npmInstall(dir);
    // Cache the node_modules for future renders
    try {
      await mkdir(REMOTION_CACHE_DIR, { recursive: true });
      // Copy package.json to cache for reference, then move node_modules
      await writeFile(join(REMOTION_CACHE_DIR, "package.json"), packageJsonStr);
      if (existsSync(join(dir, "node_modules"))) {
        // Move node_modules to cache, then symlink back
        const { rename, symlink } = await import("node:fs/promises");
        await rename(join(dir, "node_modules"), cachedModules).catch(() => {});
        await symlink(cachedModules, join(dir, "node_modules"), "dir").catch(() => {});
        await writeFile(cacheMarker, depsHash);
      }
    } catch {
      // Caching is best-effort, don't fail the render
    }
  }

  return dir;
}

async function this_npmInstall(dir: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], {
      cwd: dir,
      timeout: 180_000,
    });
  } catch (error) {
    const msg = error instanceof Error ? (error as NodeJS.ErrnoException & { stderr?: string }).stderr || error.message : String(error);
    console.error(`[Remotion] npm install failed: ${msg.slice(0, 300)}`);
    throw error;
  }
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
    const errObj = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    const stderr = errObj.stderr?.slice(0, 500) || "";
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Remotion] Render failed:\n  ${msg.slice(0, 300)}${stderr ? `\n  stderr: ${stderr}` : ""}`);
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

// ── Text Overlay Component Generator ────────────────────────────────────

export type TextOverlayStyle = "lower-third" | "center-bold" | "subtitle" | "minimal";

export interface GenerateTextOverlayComponentOptions {
  texts: string[];
  style: TextOverlayStyle;
  fontSize: number;
  fontColor: string;
  startTime: number;
  endTime: number;
  fadeDuration: number;
  width: number;
  height: number;
  videoFileName: string;
}

/**
 * Generate a Remotion TSX component for text overlays.
 * Fallback for when FFmpeg drawtext filter (libfreetype) is unavailable.
 */
export function generateTextOverlayComponent(options: GenerateTextOverlayComponentOptions): {
  code: string;
  name: string;
} {
  const { texts, style, fontSize, fontColor, startTime, endTime, fadeDuration, width, height, videoFileName } = options;
  const name = "TextOverlay";
  const textsJSON = JSON.stringify(texts);

  const styleMap: Record<TextOverlayStyle, { justify: string; align: string; padding: string; extraCss: string }> = {
    "lower-third": {
      justify: "flex-end",
      align: "flex-start",
      padding: `paddingBottom: ${Math.round(height * 0.12)}, paddingLeft: ${Math.round(width * 0.05)},`,
      extraCss: `backgroundColor: "rgba(0,0,0,0.5)", padding: "8px 20px", borderRadius: 4,`,
    },
    "center-bold": {
      justify: "center",
      align: "center",
      padding: "",
      extraCss: `fontWeight: "bold" as const, textShadow: "3px 3px 6px rgba(0,0,0,0.9)",`,
    },
    "subtitle": {
      justify: "flex-end",
      align: "center",
      padding: `paddingBottom: ${Math.round(height * 0.08)},`,
      extraCss: `backgroundColor: "rgba(0,0,0,0.6)", padding: "6px 16px", borderRadius: 4,`,
    },
    "minimal": {
      justify: "flex-start",
      align: "flex-start",
      padding: `paddingTop: ${Math.round(height * 0.05)}, paddingLeft: ${Math.round(width * 0.05)},`,
      extraCss: `opacity: 0.85,`,
    },
  };

  const s = styleMap[style];
  const scaledFontSize = style === "center-bold" ? Math.round(fontSize * 1.5) : fontSize;

  const code = `import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, staticFile } from "remotion";
import { Video } from "@remotion/media";

const texts: string[] = ${textsJSON};
const START_TIME = ${startTime};
const END_TIME = ${endTime};
const FADE_DURATION = ${fadeDuration};

export const ${name} = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const visible = currentTime >= START_TIME && currentTime <= END_TIME;

  const opacity = visible
    ? interpolate(
        currentTime,
        [START_TIME, START_TIME + FADE_DURATION, END_TIME - FADE_DURATION, END_TIME],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : 0;

  return (
    <AbsoluteFill>
      <Video src={staticFile("${videoFileName}")} style={{ width: "100%", height: "100%" }} muted />
      {visible && (
        <AbsoluteFill
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "${s.justify}",
            alignItems: "${s.align}",
            ${s.padding}
            opacity,
          }}
        >
          <div
            style={{
              fontSize: ${scaledFontSize},
              fontFamily: "Arial, Helvetica, sans-serif",
              color: "${fontColor}",
              lineHeight: 1.4,
              maxWidth: "${Math.round(width * 0.9)}px",
              ${s.extraCss}
            }}
          >
            {texts.map((text, i) => (
              <div key={i}>{text}</div>
            ))}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
`;

  return { code, name };
}

/**
 * Generate a Remotion TSX component that renders styled captions.
 * No LLM call — purely programmatic from SRT segments + style config.
 */
export function generateCaptionComponent(options: GenerateCaptionComponentOptions): {
  code: string;
  name: string;
} {
  const { segments, style, fontSize, fontColor, position, width, videoFileName } = options;
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

// ── Animated Caption Component Generator ──────────────────────────────────

export interface AnimatedCaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface AnimatedCaptionGroup {
  words: AnimatedCaptionWord[];
  startTime: number;
  endTime: number;
  text: string;
}

export type AnimatedCaptionStylePreset = "highlight" | "bounce" | "pop-in" | "neon";

export interface GenerateAnimatedCaptionComponentOptions {
  groups: AnimatedCaptionGroup[];
  style: AnimatedCaptionStylePreset;
  highlightColor: string;
  fontSize: number;
  position: "top" | "center" | "bottom";
  width: number;
  height: number;
  fps: number;
  videoFileName?: string;
}

/**
 * Generate a Remotion TSX component for word-level animated captions.
 * Each style creates different visual effects per word.
 */
export function generateAnimatedCaptionComponent(options: GenerateAnimatedCaptionComponentOptions): {
  code: string;
  name: string;
} {
  const { groups, style, highlightColor, fontSize, position, width, fps, videoFileName } = options;
  const name = videoFileName ? "VideoAnimatedCaption" : "AnimatedCaptionOverlay";

  const groupsJSON = JSON.stringify(
    groups.map((g) => ({
      words: g.words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
      startTime: g.startTime,
      endTime: g.endTime,
      text: g.text,
    })),
  );

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

  // Style-specific word rendering
  let wordRenderer: string;

  switch (style) {
    case "highlight":
      wordRenderer = `
    const isActive = currentTime >= w.start && currentTime < w.end;
    const bgOpacity = isActive ? 1 : 0;
    return (
      <span
        key={wi}
        style={{
          display: "inline-block",
          padding: "2px 6px",
          margin: "0 2px",
          borderRadius: 4,
          backgroundColor: isActive ? "${highlightColor}" : "transparent",
          color: isActive ? "#000000" : "#FFFFFF",
          transition: "background-color 0.1s",
          fontWeight: "bold",
          textShadow: isActive ? "none" : "2px 2px 4px rgba(0,0,0,0.8)",
        }}
      >
        {w.word}
      </span>
    );`;
      break;

    case "bounce":
      wordRenderer = `
    const isActive = currentTime >= w.start && currentTime < w.end;
    const entryFrame = w.start * ${fps};
    const progress = Math.min(1, Math.max(0, (frame - entryFrame) / 5));
    const springVal = isActive
      ? 1 + Math.sin(progress * Math.PI) * 0.15
      : 1;
    const translateY = isActive
      ? -Math.sin(progress * Math.PI) * 8
      : 0;
    return (
      <span
        key={wi}
        style={{
          display: "inline-block",
          margin: "0 3px",
          transform: \`scale(\${springVal}) translateY(\${translateY}px)\`,
          color: isActive ? "${highlightColor}" : "#FFFFFF",
          fontWeight: "bold",
          textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
        }}
      >
        {w.word}
      </span>
    );`;
      break;

    case "pop-in":
      wordRenderer = `
    const entryFrame = w.start * ${fps};
    const scale = frame >= entryFrame
      ? Math.min(1, (frame - entryFrame) / 5)
      : 0;
    const isActive = currentTime >= w.start && currentTime < w.end;
    return (
      <span
        key={wi}
        style={{
          display: "inline-block",
          margin: "0 3px",
          transform: \`scale(\${scale})\`,
          opacity: scale,
          color: isActive ? "${highlightColor}" : "#FFFFFF",
          fontWeight: "bold",
          textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
        }}
      >
        {w.word}
      </span>
    );`;
      break;

    case "neon":
      wordRenderer = `
    const isActive = currentTime >= w.start && currentTime < w.end;
    const pulse = isActive ? 0.8 + Math.sin(frame * 0.3) * 0.2 : 0.5;
    const glowSize = isActive ? 15 : 0;
    return (
      <span
        key={wi}
        style={{
          display: "inline-block",
          margin: "0 3px",
          color: isActive ? "${highlightColor}" : "#FFFFFF",
          fontWeight: "bold",
          opacity: isActive ? 1 : pulse,
          textShadow: isActive
            ? \`0 0 \${glowSize}px ${highlightColor}, 0 0 \${glowSize * 2}px ${highlightColor}, 0 0 \${glowSize * 3}px ${highlightColor}\`
            : "2px 2px 4px rgba(0,0,0,0.8)",
        }}
      >
        {w.word}
      </span>
    );`;
      break;
  }

  const code = `import { AbsoluteFill, useCurrentFrame, useVideoConfig${videoImport} } from "remotion";
${videoMediaImport}
interface Word {
  word: string;
  start: number;
  end: number;
}

interface WordGroup {
  words: Word[];
  startTime: number;
  endTime: number;
  text: string;
}

const groups: WordGroup[] = ${groupsJSON};

export const ${name} = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const activeGroup = groups.find(
    (g) => currentTime >= g.startTime && currentTime < g.endTime
  );

  const renderWord = (w: Word, wi: number) => {
    ${wordRenderer}
  };

  return (
    <AbsoluteFill>
      ${videoElement}
      {activeGroup && (
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
              lineHeight: 1.5,
              padding: "8px 16px",
              display: "flex",
              flexWrap: "wrap" as const,
              justifyContent: "center",
              gap: "0px",
            }}
          >
            {activeGroup.words.map((w, wi) => renderWord(w, wi))}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
`;

  return { code, name };
}


/**
 * Remotion rendering and compositing utilities.
 *
 * Uses `npx remotion` on-demand — Remotion is NOT a package dependency.
 * Scaffolds a temporary project, renders transparent WebM, and composites with FFmpeg.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execAsync = promisify(exec);

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
    await execAsync("npx remotion --version", { timeout: 30_000 });
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
 */
export async function scaffoldRemotionProject(
  componentCode: string,
  componentName: string,
  opts: { width: number; height: number; fps: number; durationInFrames: number },
): Promise<string> {
  const dir = join(tmpdir(), `vibe_motion_${Date.now()}`);
  await mkdir(dir, { recursive: true });

  // package.json — remotion + react deps
  const packageJson = {
    name: "vibe-motion-render",
    version: "1.0.0",
    private: true,
    dependencies: {
      remotion: "^4.0.0",
      "@remotion/cli": "^4.0.0",
      react: "^18.0.0",
      "react-dom": "^18.0.0",
      "@types/react": "^18.0.0",
    },
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

  // Component.tsx — the AI-generated component
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

  // Install deps (first render will be slow, subsequent cached)
  if (!existsSync(join(dir, "node_modules"))) {
    await execAsync("npm install --prefer-offline --no-audit --no-fund", {
      cwd: dir,
      timeout: 120_000,
    });
  }

  return dir;
}

/**
 * Render a Remotion composition to video.
 * Tries transparent VP9 WebM first; falls back to H264 MP4.
 */
export async function renderMotion(options: RenderMotionOptions): Promise<RenderResult> {
  const transparent = options.transparent !== false;

  // 1. Scaffold project
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

    if (transparent) {
      // Try transparent WebM (VP8 with alpha — best Remotion support)
      try {
        const webmOut = options.outputPath.replace(/\.\w+$/, ".webm");
        const cmd = [
          "npx remotion render",
          `"${entryPoint}"`,
          options.componentName,
          `"${webmOut}"`,
          "--codec vp8",
          "--image-format png",
        ].join(" ");

        await execAsync(cmd, { cwd: dir, timeout: 300_000 });
        return { success: true, outputPath: webmOut };
      } catch {
        // Fall through to non-transparent render
      }
    }

    // Non-transparent or fallback: H264 MP4
    const mp4Out = options.outputPath.replace(/\.\w+$/, ".mp4");
    const cmd = [
      "npx remotion render",
      `"${entryPoint}"`,
      options.componentName,
      `"${mp4Out}"`,
      "--codec h264",
      "--crf 18",
    ].join(" ");

    await execAsync(cmd, { cwd: dir, timeout: 300_000 });
    return { success: true, outputPath: mp4Out };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Remotion render failed: ${msg}` };
  } finally {
    // Cleanup temp project
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Composite a transparent overlay on top of a base video using FFmpeg.
 */
export async function compositeOverlay(options: CompositeOptions): Promise<RenderResult> {
  try {
    const cmd = [
      "ffmpeg -y",
      `-i "${options.baseVideo}"`,
      `-i "${options.overlayPath}"`,
      '-filter_complex "[0:v][1:v]overlay=0:0:shortest=1[out]"',
      '-map "[out]"',
      "-map 0:a?",
      "-c:a copy",
      "-c:v libx264 -crf 18",
      `"${options.outputPath}"`,
    ].join(" ");

    await execAsync(cmd, { timeout: 300_000 });
    return { success: true, outputPath: options.outputPath };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `FFmpeg composite failed: ${msg}` };
  }
}

/**
 * Full pipeline: render motion graphic → composite onto base video.
 * If no base video, just renders the motion graphic.
 */
export async function renderAndComposite(
  motionOpts: RenderMotionOptions,
  baseVideo?: string,
  finalOutput?: string,
): Promise<RenderResult> {
  // Step 1: Render motion graphic (transparent if compositing)
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

  // Step 2: If no base video, we're done
  if (!baseVideo) {
    return renderResult;
  }

  // Step 3: Composite overlay onto base video
  const output = finalOutput || motionOpts.outputPath;
  const compositeResult = await compositeOverlay({
    baseVideo,
    overlayPath: renderResult.outputPath,
    outputPath: output,
  });

  // Cleanup overlay file
  await rm(renderResult.outputPath, { force: true }).catch(() => {});

  return compositeResult;
}

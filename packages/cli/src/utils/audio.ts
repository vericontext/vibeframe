import { execSafe, ffprobeDuration } from "./exec-safe.js";

/**
 * Get the duration of an audio file using ffprobe
 * @param filePath - Path to the audio file
 * @returns Duration in seconds
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    return await ffprobeDuration(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get audio duration: ${message}`);
  }
}

/**
 * Get the duration of a video file using ffprobe
 * @param filePath - Path to the video file
 * @returns Duration in seconds
 */
export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    return await ffprobeDuration(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get video duration: ${message}`);
  }
}

/**
 * Extend a video naturally to match target duration using progressive techniques.
 * Uses slowdown, frame interpolation, and freeze frames based on extension ratio.
 *
 * @param videoPath - Path to the source video
 * @param targetDuration - Target duration in seconds
 * @param outputPath - Path for the extended video output
 * @returns Promise that resolves when extension is complete
 */
export async function extendVideoNaturally(
  videoPath: string,
  targetDuration: number,
  outputPath: string
): Promise<void> {
  const videoDuration = await getVideoDuration(videoPath);
  const ratio = targetDuration / videoDuration;

  if (ratio <= 1.0) {
    // No extension needed, just copy
    const { copyFile } = await import("node:fs/promises");
    await copyFile(videoPath, outputPath);
    return;
  }

  if (ratio <= 1.15) {
    // 0-15% extension: Simple slowdown using setpts
    // setpts factor = 1/ratio to slow down the video
    const slowFactor = (1 / ratio).toFixed(4);
    await execSafe("ffmpeg", ["-y", "-i", videoPath, "-filter:v", `setpts=${slowFactor}*PTS`, "-an", outputPath]);
  } else if (ratio <= 1.4) {
    // 15-40% extension: Frame interpolation + slowdown
    // minterpolate creates smooth slow-motion effect
    const slowFactor = (1 / ratio).toFixed(4);
    await execSafe("ffmpeg", ["-y", "-i", videoPath, "-filter:v", `minterpolate=fps=60:mi_mode=mci,setpts=${slowFactor}*PTS`, "-an", outputPath]);
  } else {
    // 40%+ extension: Slowdown to 0.7x speed + freeze last frame for remainder
    // First, slow down to get ~43% extension
    const slowRatio = 0.7;
    const slowedDuration = videoDuration / slowRatio;
    const freezeDuration = targetDuration - slowedDuration;

    if (freezeDuration <= 0) {
      // Can achieve target with slowdown alone
      const slowFactor = (1 / ratio).toFixed(4);
      await execSafe("ffmpeg", ["-y", "-i", videoPath, "-filter:v", `minterpolate=fps=60:mi_mode=mci,setpts=${slowFactor}*PTS`, "-an", outputPath]);
    } else {
      // Need slowdown + freeze frame
      // Use tpad to extend the last frame
      const slowFactor = (1 / slowRatio).toFixed(4); // ~1.43 for 0.7x speed
      await execSafe("ffmpeg", ["-y", "-i", videoPath, "-filter:v", `setpts=${slowFactor}*PTS,tpad=stop_mode=clone:stop_duration=${freezeDuration.toFixed(2)}`, "-an", outputPath]);
    }
  }
}

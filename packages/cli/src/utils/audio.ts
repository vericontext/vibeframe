import { ffprobeDuration } from "./exec-safe.js";

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

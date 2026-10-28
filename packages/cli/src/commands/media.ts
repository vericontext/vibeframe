import { Command } from "commander";
import { stat } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import chalk from "chalk";
import * as musicMetadata from "music-metadata";
import { spinner as createSpinner, exitWithError, generalError, isJsonMode, isQuietMode, outputSuccess } from "./output.js";
import { applyTiers } from "./_shared/cost-tier.js";
import { writeStdout } from "../utils/stdout-guard.js";

export const mediaCommand = new Command("media")
  .description("Media file utilities");

/** What `vibe media info` reports; the JSON envelope's `data` (minus `warnings`). */
interface MediaInfo {
  file: string;
  path: string;
  sizeBytes: number;
  type: "video" | "audio" | "image" | "unknown";
  format?: {
    container?: string;
    codec?: string;
    duration?: number;
    bitrate?: number;
    sampleRate?: number;
    channels?: number;
  };
  video?: { width?: number; height?: number; frameRate?: number };
  tags?: { title?: string; artist?: string; album?: string; year?: number; genre?: string[] };
  warnings: string[];
}

async function readMediaInfo(filePath: string): Promise<MediaInfo> {
  const fileStat = await stat(filePath);
  const info: MediaInfo = {
    file: basename(filePath),
    path: filePath,
    sizeBytes: fileStat.size,
    type: detectMediaType(extname(filePath).toLowerCase()),
    warnings: [],
  };
  if (info.type === "image") info.warnings.push("Image metadata parsing not yet supported");
  if (info.type !== "audio" && info.type !== "video") return info;

  try {
    const metadata = await musicMetadata.parseFile(filePath);
    const { format } = metadata;
    info.format = {
      container: format.container,
      codec: format.codec,
      duration: format.duration,
      bitrate: format.bitrate,
      sampleRate: format.sampleRate,
      channels: format.numberOfChannels,
    };
    const videoTrack = format.trackInfo?.find(
      (t) => (t as Record<string, unknown>).type === "video"
    ) as Record<string, unknown> | undefined;
    if (videoTrack) {
      info.video = {
        width: videoTrack.width as number | undefined,
        height: videoTrack.height as number | undefined,
        frameRate: videoTrack.frameRate as number | undefined,
      };
    }
    const { title, artist, album, year, genre } = metadata.common ?? {};
    if (title || artist || album) {
      info.tags = { title, artist, album, year, genre };
    }
  } catch {
    info.warnings.push("Could not parse detailed metadata");
  }
  return info;
}

function printMediaInfo(info: MediaInfo): void {
  const section = (title: string) => {
    console.log();
    console.log(chalk.bold.cyan(title));
    console.log(chalk.dim("─".repeat(50)));
  };
  const row = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") console.log(chalk.dim(`  ${label}:`), value);
  };

  section("Media Info");
  row("File", info.file);
  row("Path", info.path);
  row("Size", formatFileSize(info.sizeBytes));
  row("Type", info.type);

  if (info.format) {
    const { format } = info;
    section("Format");
    row("Container", format.container);
    row("Codec", format.codec);
    if (format.duration) row("Duration", formatDuration(format.duration));
    if (format.bitrate) row("Bitrate", formatBitrate(format.bitrate));
    if (format.sampleRate) row("Sample Rate", `${format.sampleRate} Hz`);
    row("Channels", format.channels);
  }

  if (info.video && ((info.video.width && info.video.height) || info.video.frameRate)) {
    section("Video");
    if (info.video.width && info.video.height) row("Resolution", `${info.video.width}x${info.video.height}`);
    if (info.video.frameRate) row("Frame Rate", `${info.video.frameRate} fps`);
  }

  if (info.tags) {
    section("Tags");
    row("Title", info.tags.title);
    row("Artist", info.tags.artist);
    row("Album", info.tags.album);
    row("Year", info.tags.year);
    if (info.tags.genre && info.tags.genre.length > 0) row("Genre", info.tags.genre.join(", "));
  }

  for (const warning of info.warnings) {
    console.log();
    console.log(chalk.yellow(`  ${warning}`));
  }
  console.log();
}

mediaCommand
  .command("info")
  .description("Get media file information")
  .argument("<file>", "Media file path")
  .action(async (file: string) => {
    const startedAt = Date.now();
    const spinner = createSpinner("Analyzing media...").start();

    try {
      const { warnings, ...data } = await readMediaInfo(resolve(process.cwd(), file));
      spinner.stop();

      if (isJsonMode() || isQuietMode()) {
        outputSuccess({ command: "media info", startedAt, warnings, data });
        return;
      }
      printMediaInfo({ ...data, warnings });
    } catch (error) {
      spinner.fail("Failed to analyze media");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to analyze media: ${msg}`));
    }
  });

mediaCommand
  .command("duration")
  .description("Get media duration in seconds (for scripting)")
  .argument("<file>", "Media file path")
  .action(async (file: string) => {
    try {
      const filePath = resolve(process.cwd(), file);
      const metadata = await musicMetadata.parseFile(filePath);

      if (metadata.format.duration) {
        // The bare number is the product in every mode, and is itself valid JSON.
        writeStdout(metadata.format.duration.toFixed(3));
      } else {
        exitWithError(generalError("Could not determine duration"));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to get duration: ${msg}`));
    }
  });

function detectMediaType(ext: string): "video" | "audio" | "image" | "unknown" {
  const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".flv", ".wmv"];
  const audioExts = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".wma", ".aiff"];
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".tiff"];

  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  if (imageExts.includes(ext)) return "image";
  return "unknown";
}

function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(2);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.padStart(5, "0")}`;
  }
  return `${mins}:${secs.padStart(5, "0")}`;
}

function formatBitrate(bps: number): string {
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(2)} Mbps`;
  }
  return `${(bps / 1000).toFixed(0)} kbps`;
}

// Media subcommands are ffprobe-only file inspection — no API calls.
applyTiers(mediaCommand, {
  "info": "free",
  "duration": "free",
});

import { Command } from "commander";
import { stat } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import chalk from "chalk";
import ora from "ora";
import * as musicMetadata from "music-metadata";
import { exitWithError, generalError } from "./output.js";
import { applyTiers } from "./_shared/cost-tier.js";

export const mediaCommand = new Command("media")
  .description("Media file utilities");

mediaCommand
  .command("info")
  .description("Get media file information")
  .argument("<file>", "Media file path")
  .action(async (file: string) => {
    const spinner = ora("Analyzing media...").start();

    try {
      const filePath = resolve(process.cwd(), file);
      const ext = extname(filePath).toLowerCase();
      const fileName = basename(filePath);
      const fileStat = await stat(filePath);

      const mediaType = detectMediaType(ext);

      spinner.stop();

      console.log();
      console.log(chalk.bold.cyan("Media Info"));
      console.log(chalk.dim("─".repeat(50)));
      console.log(chalk.dim("  File:"), fileName);
      console.log(chalk.dim("  Path:"), filePath);
      console.log(chalk.dim("  Size:"), formatFileSize(fileStat.size));
      console.log(chalk.dim("  Type:"), mediaType);

      if (mediaType === "audio" || mediaType === "video") {
        try {
          const metadata = await musicMetadata.parseFile(filePath);

          console.log();
          console.log(chalk.bold.cyan("Format"));
          console.log(chalk.dim("─".repeat(50)));

          if (metadata.format.container) {
            console.log(chalk.dim("  Container:"), metadata.format.container);
          }
          if (metadata.format.codec) {
            console.log(chalk.dim("  Codec:"), metadata.format.codec);
          }
          if (metadata.format.duration) {
            console.log(chalk.dim("  Duration:"), formatDuration(metadata.format.duration));
          }
          if (metadata.format.bitrate) {
            console.log(chalk.dim("  Bitrate:"), formatBitrate(metadata.format.bitrate));
          }
          if (metadata.format.sampleRate) {
            console.log(chalk.dim("  Sample Rate:"), `${metadata.format.sampleRate} Hz`);
          }
          if (metadata.format.numberOfChannels) {
            console.log(chalk.dim("  Channels:"), metadata.format.numberOfChannels);
          }

          // Video-specific info (if available)
          if (metadata.format.trackInfo && metadata.format.trackInfo.length > 0) {
            const videoTrack = metadata.format.trackInfo.find(
              (t) => (t as Record<string, unknown>).type === "video"
            ) as Record<string, unknown> | undefined;
            if (videoTrack) {
              console.log();
              console.log(chalk.bold.cyan("Video"));
              console.log(chalk.dim("─".repeat(50)));
              if (videoTrack.width && videoTrack.height) {
                console.log(chalk.dim("  Resolution:"), `${videoTrack.width}x${videoTrack.height}`);
              }
              if (videoTrack.frameRate) {
                console.log(chalk.dim("  Frame Rate:"), `${videoTrack.frameRate} fps`);
              }
            }
          }

          // Audio tags
          if (metadata.common && Object.keys(metadata.common).length > 0) {
            const { title, artist, album, year, genre } = metadata.common;
            if (title || artist || album) {
              console.log();
              console.log(chalk.bold.cyan("Tags"));
              console.log(chalk.dim("─".repeat(50)));
              if (title) console.log(chalk.dim("  Title:"), title);
              if (artist) console.log(chalk.dim("  Artist:"), artist);
              if (album) console.log(chalk.dim("  Album:"), album);
              if (year) console.log(chalk.dim("  Year:"), year);
              if (genre && genre.length > 0) console.log(chalk.dim("  Genre:"), genre.join(", "));
            }
          }
        } catch (metadataError) {
          console.log();
          console.log(chalk.yellow("  Could not parse detailed metadata"));
        }
      }

      if (mediaType === "image") {
        console.log();
        console.log(chalk.dim("  (Image metadata parsing not yet supported)"));
      }

      console.log();
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
        console.log(metadata.format.duration.toFixed(3));
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

import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";
import type { MediaType } from "@vibeframe/core/timeline";
import { validateResourceId } from "./validate.js";
import { exitWithError, generalError, notFoundError, outputResult, usageError } from "./output.js";

export const timelineCommand = new Command("timeline")
  .description("Timeline editing commands")
  .addHelpText("after", `
Examples:
  $ vibe timeline add-source project.vibe.json video.mp4         # Returns source ID
  $ vibe timeline add-clip project.vibe.json <source-id>         # Add clip from source
  $ vibe timeline trim project.vibe.json <clip-id> --start 5 --end 30
  $ vibe timeline split project.vibe.json <clip-id> --time 10
  $ vibe timeline list project.vibe.json --json
  $ vibe timeline delete project.vibe.json <clip-id>

Typical workflow: create project → add-source → add-clip → trim/split → export
Cost: Free (no API keys needed).
Run 'vibe schema timeline.<command>' for structured parameter info.`);

timelineCommand
  .command("add-source")
  .description("Add a media source to the project")
  .argument("<project>", "Project file path")
  .argument("<media>", "Media file path")
  .option("-n, --name <name>", "Source name (defaults to filename)")
  .option("-t, --type <type>", "Media type (video, audio, image, lottie)")
  .option("-d, --duration <seconds>", "Duration in seconds (required for images)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, mediaPath: string, options) => {
    const spinner = ora("Adding source...").start();

    try {
      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline add-source",
          params: {
            project: projectPath,
            media: mediaPath,
            name: options.name || null,
            type: options.type || null,
            duration: options.duration || null,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const absMediaPath = resolve(process.cwd(), mediaPath);
      const mediaName = options.name || basename(mediaPath);
      const mediaType = options.type || detectMediaType(mediaPath);
      const duration = parseFloat(options.duration) || 5; // Default 5s for images

      const source = project.addSource({
        name: mediaName,
        type: mediaType,
        url: absMediaPath,
        duration,
      });

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Source added: ${source.id}`));
      console.log();
      console.log(chalk.dim("  Name:"), mediaName);
      console.log(chalk.dim("  Type:"), mediaType);
      console.log(chalk.dim("  Path:"), absMediaPath);
      console.log(chalk.dim("  Duration:"), duration, "s");
    } catch (error) {
      spinner.fail("Failed to add source");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to add source: ${msg}`));
    }
  });

timelineCommand
  .command("add-clip")
  .description("Add a clip to the timeline")
  .argument("<project>", "Project file path")
  .argument("<source-id>", "Source ID to use")
  .option("-t, --track <id>", "Track ID (defaults to first matching track)")
  .option("-s, --start <seconds>", "Start time in timeline", "0")
  .option("-d, --duration <seconds>", "Clip duration (defaults to source duration)")
  .option("--offset <seconds>", "Source start offset", "0")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, sourceId: string, options) => {
    const spinner = ora("Adding clip...").start();

    try {
      validateResourceId(sourceId);
      if (options.track) validateResourceId(options.track);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline add-clip",
          params: {
            project: projectPath,
            sourceId,
            track: options.track || null,
            start: options.start,
            duration: options.duration || null,
            offset: options.offset,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const source = project.getSource(sourceId);
      if (!source) {
        spinner.fail(`Source not found: ${sourceId}`);
        exitWithError(notFoundError(sourceId));
      }

      // Find track (images use video track, like REPL does)
      let trackId = options.track;
      if (!trackId) {
        const trackType = source.type === "audio" ? "audio" : "video";
        const tracks = project.getTracksByType(trackType);
        if (tracks.length === 0) {
          spinner.fail(`No ${trackType} track found`);
          exitWithError(usageError(`No ${trackType} track found. Create one first.`));
        }
        trackId = tracks[0].id;
      }

      const startTime = parseFloat(options.start);
      const sourceOffset = parseFloat(options.offset);
      const duration = options.duration ? parseFloat(options.duration) : source.duration;

      const clip = project.addClip({
        sourceId,
        trackId,
        startTime,
        duration,
        sourceStartOffset: sourceOffset,
        sourceEndOffset: sourceOffset + duration,
      });

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Clip added: ${clip.id}`));
      console.log();
      console.log(chalk.dim("  Source:"), source.name);
      console.log(chalk.dim("  Track:"), trackId);
      console.log(chalk.dim("  Start:"), startTime, "s");
      console.log(chalk.dim("  Duration:"), duration, "s");
    } catch (error) {
      spinner.fail("Failed to add clip");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to add clip: ${msg}`));
    }
  });

timelineCommand
  .command("add-track")
  .description("Add a new track")
  .argument("<project>", "Project file path")
  .argument("<type>", "Track type (video, audio)")
  .option("-n, --name <name>", "Track name")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, type: string, options) => {
    const spinner = ora("Adding track...").start();

    try {
      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline add-track",
          params: {
            project: projectPath,
            type,
            name: options.name || null,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const existingTracks = project.getTracksByType(type as MediaType);
      const trackName = options.name || `${type.charAt(0).toUpperCase() + type.slice(1)} ${existingTracks.length + 1}`;
      const order = project.getTracks().length;

      const track = project.addTrack({
        name: trackName,
        type: type as MediaType,
        order,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Track added: ${track.id}`));
      console.log();
      console.log(chalk.dim("  Name:"), track.name);
      console.log(chalk.dim("  Type:"), track.type);
    } catch (error) {
      spinner.fail("Failed to add track");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to add track: ${msg}`));
    }
  });

timelineCommand
  .command("add-effect")
  .description("Add an effect to a clip")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID")
  .argument("<effect-type>", "Effect type (fadeIn, fadeOut, blur, brightness, contrast, saturation, speed, volume)")
  .option("-s, --start <seconds>", "Effect start time (relative to clip)", "0")
  .option("-d, --duration <seconds>", "Effect duration (defaults to clip duration)")
  .option("-p, --params <json>", "Effect parameters as JSON", "{}")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, clipId: string, effectType: string, options) => {
    const spinner = ora("Adding effect...").start();

    try {
      validateResourceId(clipId);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline add-effect",
          params: {
            project: projectPath,
            clipId,
            effectType,
            start: options.start,
            duration: options.duration || null,
            params: options.params,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(`Clip not found: ${clipId}`);
        exitWithError(notFoundError(clipId));
      }

      const startTime = parseFloat(options.start);
      const duration = options.duration ? parseFloat(options.duration) : clip.duration;
      const params = JSON.parse(options.params);

      const effect = project.addEffect(clipId, {
        type: effectType as any,
        startTime,
        duration,
        params,
      });

      if (!effect) {
        spinner.fail("Failed to add effect");
        exitWithError(generalError("Failed to add effect"));
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Effect added: ${effect.id}`));
      console.log();
      console.log(chalk.dim("  Type:"), effectType);
      console.log(chalk.dim("  Start:"), startTime, "s");
      console.log(chalk.dim("  Duration:"), duration, "s");
    } catch (error) {
      spinner.fail("Failed to add effect");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to add effect: ${msg}`));
    }
  });

timelineCommand
  .command("trim")
  .description("Trim a clip")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID")
  .option("--start <seconds>", "New start time")
  .option("--duration <seconds>", "New duration")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Trimming clip...").start();

    try {
      validateResourceId(clipId);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline trim",
          params: {
            project: projectPath,
            clipId,
            start: options.start || null,
            duration: options.duration || null,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(`Clip not found: ${clipId}`);
        exitWithError(notFoundError(clipId));
      }

      if (options.start !== undefined) {
        project.trimClipStart(clipId, parseFloat(options.start));
      }
      if (options.duration !== undefined) {
        project.trimClipEnd(clipId, parseFloat(options.duration));
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      const updatedClip = project.getClip(clipId)!;
      spinner.succeed(chalk.green("Clip trimmed"));
      console.log();
      console.log(chalk.dim("  Start:"), updatedClip.startTime, "s");
      console.log(chalk.dim("  Duration:"), updatedClip.duration, "s");
    } catch (error) {
      spinner.fail("Failed to trim clip");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to trim clip: ${msg}`));
    }
  });

timelineCommand
  .command("list")
  .description("List timeline contents")
  .argument("<project>", "Project file path")
  .option("--sources", "List sources only")
  .option("--tracks", "List tracks only")
  .option("--clips", "List clips only")
  .action(async (projectPath: string, options) => {
    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const showAll = !options.sources && !options.tracks && !options.clips;

      if (showAll || options.sources) {
        console.log();
        console.log(chalk.bold.cyan("Sources"));
        console.log(chalk.dim("─".repeat(60)));
        const sources = project.getSources();
        if (sources.length === 0) {
          console.log(chalk.dim("  (none)"));
        } else {
          for (const source of sources) {
            console.log(`  ${chalk.yellow(source.id)}`);
            console.log(`    ${source.name} (${source.type}, ${source.duration}s)`);
          }
        }
      }

      if (showAll || options.tracks) {
        console.log();
        console.log(chalk.bold.cyan("Tracks"));
        console.log(chalk.dim("─".repeat(60)));
        const tracks = project.getTracks();
        for (const track of tracks) {
          const status = [
            track.isMuted ? "muted" : null,
            track.isLocked ? "locked" : null,
            !track.isVisible ? "hidden" : null,
          ].filter(Boolean).join(", ");
          console.log(`  ${chalk.yellow(track.id)}`);
          console.log(`    ${track.name} (${track.type})${status ? ` [${status}]` : ""}`);
        }
      }

      if (showAll || options.clips) {
        console.log();
        console.log(chalk.bold.cyan("Clips"));
        console.log(chalk.dim("─".repeat(60)));
        const clips = project.getClips();
        if (clips.length === 0) {
          console.log(chalk.dim("  (none)"));
        } else {
          for (const clip of clips) {
            const source = project.getSource(clip.sourceId);
            console.log(`  ${chalk.yellow(clip.id)}`);
            console.log(`    ${source?.name || "unknown"} @ ${clip.startTime}s (${clip.duration}s)`);
            if (clip.effects.length > 0) {
              console.log(`    Effects: ${clip.effects.map((e) => e.type).join(", ")}`);
            }
          }
        }
      }

      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to list timeline: ${msg}`));
    }
  });

timelineCommand
  .command("split")
  .description("Split a clip at a specific time")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to split")
  .option("-t, --time <seconds>", "Split time relative to clip start", "0")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Splitting clip...").start();

    try {
      validateResourceId(clipId);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline split",
          params: {
            project: projectPath,
            clipId,
            time: options.time,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(`Clip not found: ${clipId}`);
        exitWithError(notFoundError(clipId));
      }

      const splitTime = parseFloat(options.time);
      if (splitTime <= 0 || splitTime >= clip.duration) {
        spinner.fail("Invalid split time");
        exitWithError(usageError(`Invalid split time. Must be between 0 and ${clip.duration}s`));
      }

      const result = project.splitClip(clipId, splitTime);
      if (!result) {
        spinner.fail("Failed to split clip");
        exitWithError(generalError("Failed to split clip"));
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      const [first, second] = result;
      spinner.succeed(chalk.green("Clip split successfully"));
      console.log();
      console.log(chalk.dim("  First clip:"), first.id, `(${first.duration.toFixed(2)}s)`);
      console.log(chalk.dim("  Second clip:"), second.id, `(${second.duration.toFixed(2)}s)`);
    } catch (error) {
      spinner.fail("Failed to split clip");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to split clip: ${msg}`));
    }
  });

timelineCommand
  .command("duplicate")
  .description("Duplicate a clip")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to duplicate")
  .option("-t, --time <seconds>", "Start time for duplicate (default: after original)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Duplicating clip...").start();

    try {
      validateResourceId(clipId);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline duplicate",
          params: {
            project: projectPath,
            clipId,
            time: options.time || null,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(`Clip not found: ${clipId}`);
        exitWithError(notFoundError(clipId));
      }

      const offsetTime = options.time ? parseFloat(options.time) : undefined;
      const duplicated = project.duplicateClip(clipId, offsetTime);

      if (!duplicated) {
        spinner.fail("Failed to duplicate clip");
        exitWithError(generalError("Failed to duplicate clip"));
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Clip duplicated: ${duplicated.id}`));
      console.log();
      console.log(chalk.dim("  Start:"), duplicated.startTime, "s");
      console.log(chalk.dim("  Duration:"), duplicated.duration, "s");
    } catch (error) {
      spinner.fail("Failed to duplicate clip");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to duplicate clip: ${msg}`));
    }
  });

timelineCommand
  .command("delete")
  .description("Delete a clip from the timeline")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to delete")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, clipId: string, options: { dryRun?: boolean }) => {
    const spinner = ora("Deleting clip...").start();

    try {
      validateResourceId(clipId);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline delete",
          params: {
            project: projectPath,
            clipId,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(`Clip not found: ${clipId}`);
        exitWithError(notFoundError(clipId));
      }

      const removed = project.removeClip(clipId);
      if (!removed) {
        spinner.fail("Failed to delete clip");
        exitWithError(generalError("Failed to delete clip"));
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green("Clip deleted"));
    } catch (error) {
      spinner.fail("Failed to delete clip");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to delete clip: ${msg}`));
    }
  });

timelineCommand
  .command("move")
  .description("Move a clip to a new position")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to move")
  .option("-t, --time <seconds>", "New start time")
  .option("--track <track-id>", "Move to different track")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Moving clip...").start();

    try {
      validateResourceId(clipId);
      if (options.track) validateResourceId(options.track);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "timeline move",
          params: {
            project: projectPath,
            clipId,
            time: options.time || null,
            track: options.track || null,
          },
        });
        return;
      }

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(`Clip not found: ${clipId}`);
        exitWithError(notFoundError(clipId));
      }

      const newTime = options.time !== undefined ? parseFloat(options.time) : clip.startTime;
      const newTrack = options.track || clip.trackId;

      const moved = project.moveClip(clipId, newTrack, newTime);
      if (!moved) {
        spinner.fail("Failed to move clip");
        exitWithError(generalError("Failed to move clip"));
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      const updated = project.getClip(clipId)!;
      spinner.succeed(chalk.green("Clip moved"));
      console.log();
      console.log(chalk.dim("  Track:"), updated.trackId);
      console.log(chalk.dim("  Start:"), updated.startTime, "s");
    } catch (error) {
      spinner.fail("Failed to move clip");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to move clip: ${msg}`));
    }
  });

function detectMediaType(path: string): MediaType {
  const ext = extname(path).toLowerCase();
  const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
  const audioExts = [".mp3", ".wav", ".ogg", ".m4a", ".aac"];
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  if (imageExts.includes(ext)) return "image";
  if (ext === ".lottie") return "lottie";
  return "video"; // Default
}

import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";
import type { MediaType } from "@vibeframe/core/timeline";

export const timelineCommand = new Command("timeline")
  .description("Timeline editing commands");

timelineCommand
  .command("add-source")
  .description("Add a media source to the project")
  .argument("<project>", "Project file path")
  .argument("<media>", "Media file path")
  .option("-n, --name <name>", "Source name (defaults to filename)")
  .option("-t, --type <type>", "Media type (video, audio, image)")
  .option("-d, --duration <seconds>", "Duration in seconds (required for images)")
  .action(async (projectPath: string, mediaPath: string, options) => {
    const spinner = ora("Adding source...").start();

    try {
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
      spinner.fail(chalk.red("Failed to add source"));
      console.error(error);
      process.exit(1);
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
  .action(async (projectPath: string, sourceId: string, options) => {
    const spinner = ora("Adding clip...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const source = project.getSource(sourceId);
      if (!source) {
        spinner.fail(chalk.red(`Source not found: ${sourceId}`));
        process.exit(1);
      }

      // Find track
      let trackId = options.track;
      if (!trackId) {
        const tracks = project.getTracksByType(source.type);
        if (tracks.length === 0) {
          spinner.fail(chalk.red(`No ${source.type} track found. Create one first.`));
          process.exit(1);
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
      spinner.fail(chalk.red("Failed to add clip"));
      console.error(error);
      process.exit(1);
    }
  });

timelineCommand
  .command("add-track")
  .description("Add a new track")
  .argument("<project>", "Project file path")
  .argument("<type>", "Track type (video, audio)")
  .option("-n, --name <name>", "Track name")
  .action(async (projectPath: string, type: string, options) => {
    const spinner = ora("Adding track...").start();

    try {
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
      spinner.fail(chalk.red("Failed to add track"));
      console.error(error);
      process.exit(1);
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
  .action(async (projectPath: string, clipId: string, effectType: string, options) => {
    const spinner = ora("Adding effect...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(chalk.red(`Clip not found: ${clipId}`));
        process.exit(1);
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
        spinner.fail(chalk.red("Failed to add effect"));
        process.exit(1);
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Effect added: ${effect.id}`));
      console.log();
      console.log(chalk.dim("  Type:"), effectType);
      console.log(chalk.dim("  Start:"), startTime, "s");
      console.log(chalk.dim("  Duration:"), duration, "s");
    } catch (error) {
      spinner.fail(chalk.red("Failed to add effect"));
      console.error(error);
      process.exit(1);
    }
  });

timelineCommand
  .command("trim")
  .description("Trim a clip")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID")
  .option("--start <seconds>", "New start time")
  .option("--duration <seconds>", "New duration")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Trimming clip...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(chalk.red(`Clip not found: ${clipId}`));
        process.exit(1);
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
      spinner.fail(chalk.red("Failed to trim clip"));
      console.error(error);
      process.exit(1);
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
      console.error(chalk.red("Failed to list timeline"));
      console.error(error);
      process.exit(1);
    }
  });

timelineCommand
  .command("split")
  .description("Split a clip at a specific time")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to split")
  .option("-t, --time <seconds>", "Split time relative to clip start", "0")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Splitting clip...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(chalk.red(`Clip not found: ${clipId}`));
        process.exit(1);
      }

      const splitTime = parseFloat(options.time);
      if (splitTime <= 0 || splitTime >= clip.duration) {
        spinner.fail(chalk.red(`Invalid split time. Must be between 0 and ${clip.duration}s`));
        process.exit(1);
      }

      const result = project.splitClip(clipId, splitTime);
      if (!result) {
        spinner.fail(chalk.red("Failed to split clip"));
        process.exit(1);
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      const [first, second] = result;
      spinner.succeed(chalk.green("Clip split successfully"));
      console.log();
      console.log(chalk.dim("  First clip:"), first.id, `(${first.duration.toFixed(2)}s)`);
      console.log(chalk.dim("  Second clip:"), second.id, `(${second.duration.toFixed(2)}s)`);
    } catch (error) {
      spinner.fail(chalk.red("Failed to split clip"));
      console.error(error);
      process.exit(1);
    }
  });

timelineCommand
  .command("duplicate")
  .description("Duplicate a clip")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to duplicate")
  .option("-t, --time <seconds>", "Start time for duplicate (default: after original)")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Duplicating clip...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(chalk.red(`Clip not found: ${clipId}`));
        process.exit(1);
      }

      const offsetTime = options.time ? parseFloat(options.time) : undefined;
      const duplicated = project.duplicateClip(clipId, offsetTime);

      if (!duplicated) {
        spinner.fail(chalk.red("Failed to duplicate clip"));
        process.exit(1);
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Clip duplicated: ${duplicated.id}`));
      console.log();
      console.log(chalk.dim("  Start:"), duplicated.startTime, "s");
      console.log(chalk.dim("  Duration:"), duplicated.duration, "s");
    } catch (error) {
      spinner.fail(chalk.red("Failed to duplicate clip"));
      console.error(error);
      process.exit(1);
    }
  });

timelineCommand
  .command("delete")
  .description("Delete a clip from the timeline")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to delete")
  .action(async (projectPath: string, clipId: string) => {
    const spinner = ora("Deleting clip...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(chalk.red(`Clip not found: ${clipId}`));
        process.exit(1);
      }

      const removed = project.removeClip(clipId);
      if (!removed) {
        spinner.fail(chalk.red("Failed to delete clip"));
        process.exit(1);
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green("Clip deleted"));
    } catch (error) {
      spinner.fail(chalk.red("Failed to delete clip"));
      console.error(error);
      process.exit(1);
    }
  });

timelineCommand
  .command("move")
  .description("Move a clip to a new position")
  .argument("<project>", "Project file path")
  .argument("<clip-id>", "Clip ID to move")
  .option("-t, --time <seconds>", "New start time")
  .option("--track <track-id>", "Move to different track")
  .action(async (projectPath: string, clipId: string, options) => {
    const spinner = ora("Moving clip...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clip = project.getClip(clipId);
      if (!clip) {
        spinner.fail(chalk.red(`Clip not found: ${clipId}`));
        process.exit(1);
      }

      const newTime = options.time !== undefined ? parseFloat(options.time) : clip.startTime;
      const newTrack = options.track || clip.trackId;

      const moved = project.moveClip(clipId, newTrack, newTime);
      if (!moved) {
        spinner.fail(chalk.red("Failed to move clip"));
        process.exit(1);
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      const updated = project.getClip(clipId)!;
      spinner.succeed(chalk.green("Clip moved"));
      console.log();
      console.log(chalk.dim("  Track:"), updated.trackId);
      console.log(chalk.dim("  Start:"), updated.startTime, "s");
    } catch (error) {
      spinner.fail(chalk.red("Failed to move clip"));
      console.error(error);
      process.exit(1);
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
  return "video"; // Default
}

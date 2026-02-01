import { Command } from "commander";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, basename, extname, join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";
import type { MediaType, EffectType } from "@vibe-edit/core/timeline";

export const batchCommand = new Command("batch")
  .description("Batch operations for processing multiple items");

/**
 * Detect media type from file extension
 */
function detectMediaType(filePath: string): MediaType {
  const ext = extname(filePath).toLowerCase();
  const videoExts = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
  const audioExts = [".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a"];
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  if (imageExts.includes(ext)) return "image";
  return "video"; // Default to video
}

/**
 * Check if file is a media file
 */
function isMediaFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const mediaExts = [
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
    ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ];
  return mediaExts.includes(ext);
}

// ============ batch import ============

batchCommand
  .command("import")
  .description("Import multiple media files from a directory")
  .argument("<project>", "Project file path")
  .argument("<directory>", "Directory containing media files")
  .option("-r, --recursive", "Search subdirectories", false)
  .option("-d, --duration <seconds>", "Default duration for images", "5")
  .option("--filter <pattern>", "Filter files by extension (e.g., '.mp4,.mov')")
  .action(async (projectPath: string, directory: string, options) => {
    const spinner = ora("Scanning directory...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const dirPath = resolve(process.cwd(), directory);
      const filterExts = options.filter
        ? options.filter.split(",").map((e: string) => e.trim().toLowerCase())
        : null;

      // Collect media files
      const mediaFiles: string[] = [];

      async function scanDir(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = join(dir, entry.name);

          if (entry.isDirectory() && options.recursive) {
            await scanDir(entryPath);
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            const matchesFilter = !filterExts || filterExts.includes(ext);

            if (matchesFilter && isMediaFile(entryPath)) {
              mediaFiles.push(entryPath);
            }
          }
        }
      }

      await scanDir(dirPath);

      if (mediaFiles.length === 0) {
        spinner.fail(chalk.red("No media files found in directory"));
        process.exit(1);
      }

      // Sort files alphabetically
      mediaFiles.sort();

      spinner.text = `Importing ${mediaFiles.length} files...`;

      const addedSources: string[] = [];
      const defaultDuration = parseFloat(options.duration);

      for (const mediaFile of mediaFiles) {
        const mediaName = basename(mediaFile);
        const mediaType = detectMediaType(mediaFile);
        const duration = mediaType === "image" ? defaultDuration : 0;

        const source = project.addSource({
          name: mediaName,
          type: mediaType,
          url: mediaFile,
          duration,
        });

        addedSources.push(source.id);
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Imported ${addedSources.length} media files`));
      console.log();

      for (const file of mediaFiles) {
        console.log(chalk.dim("  +"), basename(file));
      }

      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Import failed"));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  });

// ============ batch concat ============

batchCommand
  .command("concat")
  .description("Concatenate multiple sources into sequential clips")
  .argument("<project>", "Project file path")
  .argument("[source-ids...]", "Source IDs to concatenate (or --all)")
  .option("--all", "Concatenate all sources in order", false)
  .option("--track <track-id>", "Track to place clips on")
  .option("--start <seconds>", "Starting time", "0")
  .option("--gap <seconds>", "Gap between clips", "0")
  .action(async (projectPath: string, sourceIds: string[], options) => {
    const spinner = ora("Creating clips...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const sources = project.getSources();

      if (sources.length === 0) {
        spinner.fail(chalk.red("No sources in project"));
        process.exit(1);
      }

      // Get sources to concatenate
      let selectedSources = sources;
      if (!options.all && sourceIds.length > 0) {
        selectedSources = sourceIds
          .map((id) => sources.find((s) => s.id === id))
          .filter((s): s is NonNullable<typeof s> => s !== undefined);

        if (selectedSources.length === 0) {
          spinner.fail(chalk.red("No matching sources found"));
          process.exit(1);
        }
      }

      // Determine track
      const tracks = project.getTracks();
      let trackId = options.track;

      if (!trackId) {
        // Use first video track for video, first audio track for audio
        const firstSource = selectedSources[0];
        const matchingTrack = tracks.find((t) => t.type === firstSource.type);
        trackId = matchingTrack?.id || tracks[0].id;
      }

      const startTime = parseFloat(options.start);
      const gap = parseFloat(options.gap);
      let currentTime = startTime;
      const addedClips: string[] = [];

      for (const source of selectedSources) {
        const clip = project.addClip({
          sourceId: source.id,
          trackId,
          startTime: currentTime,
          duration: source.duration,
          sourceStartOffset: 0,
          sourceEndOffset: source.duration,
        });

        addedClips.push(clip.id);
        currentTime += source.duration + gap;
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Created ${addedClips.length} clips`));
      console.log();
      console.log(chalk.dim("  Total duration:"), `${currentTime - gap}s`);
      console.log(chalk.dim("  Track:"), trackId);

      for (let i = 0; i < selectedSources.length; i++) {
        console.log(chalk.dim(`  ${i + 1}.`), selectedSources[i].name);
      }

      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Concat failed"));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  });

// ============ batch apply-effect ============

batchCommand
  .command("apply-effect")
  .description("Apply an effect to multiple clips")
  .argument("<project>", "Project file path")
  .argument("<effect-type>", "Effect type (fadeIn, fadeOut, blur, etc.)")
  .argument("[clip-ids...]", "Clip IDs to apply effect to (or --all)")
  .option("--all", "Apply to all clips", false)
  .option("-d, --duration <seconds>", "Effect duration", "1")
  .option("-s, --start <seconds>", "Effect start time (relative to clip)", "0")
  .option("--intensity <value>", "Effect intensity (0-1)", "1")
  .action(
    async (
      projectPath: string,
      effectType: string,
      clipIds: string[],
      options
    ) => {
      const spinner = ora("Applying effects...").start();

      try {
        const filePath = resolve(process.cwd(), projectPath);
        const content = await readFile(filePath, "utf-8");
        const data: ProjectFile = JSON.parse(content);
        const project = Project.fromJSON(data);

        const clips = project.getClips();

        if (clips.length === 0) {
          spinner.fail(chalk.red("No clips in project"));
          process.exit(1);
        }

        // Get clips to apply effect to
        let selectedClips = clips;
        if (!options.all && clipIds.length > 0) {
          selectedClips = clipIds
            .map((id) => clips.find((c) => c.id === id))
            .filter((c): c is NonNullable<typeof c> => c !== undefined);

          if (selectedClips.length === 0) {
            spinner.fail(chalk.red("No matching clips found"));
            process.exit(1);
          }
        }

        const duration = parseFloat(options.duration);
        const startTime = parseFloat(options.start);
        const intensity = parseFloat(options.intensity);
        let appliedCount = 0;

        for (const clip of selectedClips) {
          const effect = project.addEffect(clip.id, {
            type: effectType as EffectType,
            startTime,
            duration,
            params: { intensity },
          });

          if (effect) {
            appliedCount++;
          }
        }

        await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

        spinner.succeed(
          chalk.green(`Applied ${effectType} to ${appliedCount} clips`)
        );
        console.log();
        console.log(chalk.dim("  Effect:"), effectType);
        console.log(chalk.dim("  Duration:"), `${duration}s`);
        console.log(chalk.dim("  Intensity:"), intensity);
        console.log();
      } catch (error) {
        spinner.fail(chalk.red("Apply effect failed"));
        if (error instanceof Error) {
          console.error(chalk.red(error.message));
        }
        process.exit(1);
      }
    }
  );

// ============ batch remove-clips ============

batchCommand
  .command("remove-clips")
  .description("Remove multiple clips from the timeline")
  .argument("<project>", "Project file path")
  .argument("[clip-ids...]", "Clip IDs to remove")
  .option("--all", "Remove all clips", false)
  .option("--track <track-id>", "Remove clips from specific track only")
  .action(async (projectPath: string, clipIds: string[], options) => {
    const spinner = ora("Removing clips...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clips = project.getClips();

      if (clips.length === 0) {
        spinner.fail(chalk.red("No clips in project"));
        process.exit(1);
      }

      // Get clips to remove
      let clipsToRemove = clips;

      if (options.track) {
        clipsToRemove = clips.filter((c) => c.trackId === options.track);
      }

      if (!options.all && clipIds.length > 0) {
        clipsToRemove = clipIds
          .map((id) => clips.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
      }

      if (clipsToRemove.length === 0) {
        spinner.fail(chalk.red("No matching clips found"));
        process.exit(1);
      }

      let removedCount = 0;
      for (const clip of clipsToRemove) {
        if (project.removeClip(clip.id)) {
          removedCount++;
        }
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Removed ${removedCount} clips`));
      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Remove clips failed"));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  });

// ============ batch info ============

batchCommand
  .command("info")
  .description("Show batch processing statistics")
  .argument("<project>", "Project file path")
  .action(async (projectPath: string) => {
    const spinner = ora("Loading project...").start();

    try {
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const sources = project.getSources();
      const clips = project.getClips();
      const tracks = project.getTracks();
      const summary = project.getSummary();

      spinner.stop();

      console.log(chalk.bold("\nProject Statistics\n"));

      // Sources breakdown
      const videoSources = sources.filter((s) => s.type === "video").length;
      const audioSources = sources.filter((s) => s.type === "audio").length;
      const imageSources = sources.filter((s) => s.type === "image").length;

      console.log(chalk.cyan("Sources:"), sources.length);
      if (videoSources > 0) console.log(chalk.dim("  Video:"), videoSources);
      if (audioSources > 0) console.log(chalk.dim("  Audio:"), audioSources);
      if (imageSources > 0) console.log(chalk.dim("  Image:"), imageSources);

      // Clips breakdown
      const clipsPerTrack = tracks.map((t) => ({
        track: t.name,
        count: clips.filter((c) => c.trackId === t.id).length,
      }));

      console.log(chalk.cyan("\nClips:"), clips.length);
      for (const { track, count } of clipsPerTrack) {
        if (count > 0) console.log(chalk.dim(`  ${track}:`), count);
      }

      // Effects count
      const totalEffects = clips.reduce((sum, c) => sum + c.effects.length, 0);
      if (totalEffects > 0) {
        console.log(chalk.cyan("\nEffects:"), totalEffects);
      }

      // Timeline info
      console.log(chalk.cyan("\nTimeline:"));
      console.log(chalk.dim("  Duration:"), `${summary.duration.toFixed(1)}s`);
      console.log(chalk.dim("  Tracks:"), tracks.length);
      console.log(chalk.dim("  Frame rate:"), `${summary.frameRate} fps`);
      console.log(chalk.dim("  Aspect ratio:"), summary.aspectRatio);

      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Failed to load project"));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  });

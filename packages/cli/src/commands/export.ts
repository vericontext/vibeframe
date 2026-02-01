import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { Project, type ProjectFile } from "../engine/index.js";

export const exportCommand = new Command("export")
  .description("Export project to video file")
  .argument("<project>", "Project file path")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --format <format>", "Output format (mp4, webm, mov)", "mp4")
  .option(
    "-p, --preset <preset>",
    "Quality preset (draft, standard, high, ultra)",
    "standard"
  )
  .option("-y, --overwrite", "Overwrite output file if exists", false)
  .action(async (projectPath: string, options) => {
    const spinner = ora("Initializing FFmpeg...").start();

    try {
      // Load project
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const summary = project.getSummary();

      if (summary.clipCount === 0) {
        spinner.fail(chalk.red("Project has no clips to export"));
        process.exit(1);
      }

      // Determine output path
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : resolve(
            process.cwd(),
            `${basename(projectPath, ".vibe.json")}.${options.format}`
          );

      // Get preset settings
      const presetSettings = getPresetSettings(options.preset, summary.aspectRatio);

      spinner.text = "Loading FFmpeg...";

      // Initialize FFmpeg
      const ffmpeg = new FFmpeg();

      ffmpeg.on("progress", ({ progress }) => {
        const percent = Math.round(progress * 100);
        spinner.text = `Encoding... ${percent}%`;
      });

      // Load FFmpeg core
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });

      spinner.text = "Processing clips...";

      // Get clips sorted by start time
      const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
      const sources = project.getSources();

      // Load source files into FFmpeg
      const loadedSources = new Set<string>();
      for (const clip of clips) {
        const source = sources.find((s) => s.id === clip.sourceId);
        if (source && !loadedSources.has(source.id)) {
          try {
            spinner.text = `Loading ${source.name}...`;
            const sourceData = await fetchFile(source.url);
            await ffmpeg.writeFile(source.id + extname(source.url), sourceData);
            loadedSources.add(source.id);
          } catch (error) {
            spinner.warn(chalk.yellow(`Could not load source: ${source.name}`));
          }
        }
      }

      if (loadedSources.size === 0) {
        spinner.fail(chalk.red("No source files could be loaded"));
        process.exit(1);
      }

      // Build filter complex for combining clips
      spinner.text = "Building timeline...";

      const filterParts: string[] = [];
      const inputParts: string[] = [];
      let inputIndex = 0;

      for (const clip of clips) {
        const source = sources.find((s) => s.id === clip.sourceId);
        if (!source || !loadedSources.has(source.id)) continue;

        const inputFile = source.id + extname(source.url);
        inputParts.push("-i", inputFile);

        // Trim filter
        const trimStart = clip.sourceStartOffset;
        const trimEnd = clip.sourceStartOffset + clip.duration;

        filterParts.push(
          `[${inputIndex}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[v${inputIndex}]`
        );

        if (source.type === "video") {
          filterParts.push(
            `[${inputIndex}:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[a${inputIndex}]`
          );
        }

        inputIndex++;
      }

      // Concatenate all clips
      const videoConcat = clips
        .map((_, i) => `[v${i}]`)
        .join("");
      const audioConcat = clips
        .filter((c) => {
          const source = sources.find((s) => s.id === c.sourceId);
          return source?.type === "video";
        })
        .map((_, i) => `[a${i}]`)
        .join("");

      if (inputIndex > 1) {
        filterParts.push(
          `${videoConcat}concat=n=${inputIndex}:v=1:a=0[outv]`
        );
        if (audioConcat) {
          filterParts.push(
            `${audioConcat}concat=n=${inputIndex}:v=0:a=1[outa]`
          );
        }
      } else {
        filterParts.push(`[v0]copy[outv]`);
        if (audioConcat) {
          filterParts.push(`[a0]acopy[outa]`);
        }
      }

      spinner.text = "Encoding...";

      // Build FFmpeg command
      const ffmpegArgs: string[] = [];

      // Add inputs
      for (let i = 0; i < inputParts.length; i += 2) {
        ffmpegArgs.push(inputParts[i], inputParts[i + 1]);
      }

      // Add filter complex
      ffmpegArgs.push("-filter_complex", filterParts.join(";"));

      // Map outputs
      ffmpegArgs.push("-map", "[outv]");
      if (audioConcat) {
        ffmpegArgs.push("-map", "[outa]");
      }

      // Add encoding settings based on preset
      ffmpegArgs.push(...presetSettings.ffmpegArgs);

      // Output file
      const outputFileName = `output.${options.format}`;
      if (options.overwrite) {
        ffmpegArgs.push("-y");
      }
      ffmpegArgs.push(outputFileName);

      // Run FFmpeg
      await ffmpeg.exec(ffmpegArgs);

      // Read output and save
      spinner.text = "Saving output...";
      const outputData = await ffmpeg.readFile(outputFileName);
      await writeFile(outputPath, outputData);

      spinner.succeed(chalk.green(`Exported: ${outputPath}`));

      console.log();
      console.log(chalk.dim("  Duration:"), `${summary.duration.toFixed(1)}s`);
      console.log(chalk.dim("  Clips:"), summary.clipCount);
      console.log(chalk.dim("  Format:"), options.format);
      console.log(chalk.dim("  Preset:"), options.preset);
      console.log(chalk.dim("  Resolution:"), presetSettings.resolution);
      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Export failed"));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
      }
      process.exit(1);
    }
  });

interface PresetSettings {
  resolution: string;
  videoBitrate: string;
  audioBitrate: string;
  ffmpegArgs: string[];
}

function getPresetSettings(
  preset: string,
  aspectRatio: string
): PresetSettings {
  const presets: Record<string, PresetSettings> = {
    draft: {
      resolution: "640x360",
      videoBitrate: "1M",
      audioBitrate: "128k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "128k",
      ],
    },
    standard: {
      resolution: "1280x720",
      videoBitrate: "4M",
      audioBitrate: "192k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
      ],
    },
    high: {
      resolution: "1920x1080",
      videoBitrate: "8M",
      audioBitrate: "256k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "256k",
      ],
    },
    ultra: {
      resolution: "3840x2160",
      videoBitrate: "20M",
      audioBitrate: "320k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "15",
        "-c:a", "aac",
        "-b:a", "320k",
      ],
    },
  };

  // Adjust resolution for aspect ratio
  const settings = presets[preset] || presets.standard;

  if (aspectRatio === "9:16") {
    // Vertical video
    const [w, h] = settings.resolution.split("x");
    settings.resolution = `${h}x${w}`;
  } else if (aspectRatio === "1:1") {
    // Square video
    const h = settings.resolution.split("x")[1];
    settings.resolution = `${h}x${h}`;
  }

  return settings;
}

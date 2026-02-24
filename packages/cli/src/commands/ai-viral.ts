/**
 * AI Viral Optimizer Command
 *
 * Optimizes video for viral potential across platforms (YouTube, TikTok, Instagram, Twitter).
 * Analyzes content with Whisper + Claude, generates platform-specific cuts and captions.
 */

import { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename, relative } from "node:path";
import { existsSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import {
  WhisperProvider,
  ClaudeProvider,
  type PlatformSpec,
  type ViralOptimizationResult,
} from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../engine/index.js";
import { getApiKey } from "../utils/api-key.js";
import { formatTime } from "./ai-helpers.js";
import { autoNarrate } from "./ai-narrate.js";

const execAsync = promisify(exec);

// Platform specifications for viral optimization
export const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  youtube: {
    id: "youtube",
    name: "YouTube",
    aspectRatio: "16:9",
    maxDuration: 600,
    idealDuration: { min: 60, max: 480 },
    features: { captions: true, hook: true },
  },
  "youtube-shorts": {
    id: "youtube-shorts",
    name: "YouTube Shorts",
    aspectRatio: "9:16",
    maxDuration: 60,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    aspectRatio: "9:16",
    maxDuration: 180,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
  "instagram-reels": {
    id: "instagram-reels",
    name: "Instagram Reels",
    aspectRatio: "9:16",
    maxDuration: 90,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
  "instagram-feed": {
    id: "instagram-feed",
    name: "Instagram Feed",
    aspectRatio: "1:1",
    maxDuration: 60,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: false },
  },
  twitter: {
    id: "twitter",
    name: "Twitter",
    aspectRatio: "16:9",
    maxDuration: 140,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
};

export function registerViralCommand(ai: Command): void {
  // Viral Optimizer command
  ai
    .command("viral")
    .description("Optimize video for viral potential across platforms")
    .argument("<project>", "Source project file")
    .option("-p, --platforms <list>", "Target platforms (comma-separated): youtube, youtube-shorts, tiktok, instagram-reels, instagram-feed, twitter", "all")
    .option("-o, --output-dir <dir>", "Output directory for platform variants", "viral-output")
    .option("--analyze-only", "Only analyze, don't generate variants")
    .option("--skip-captions", "Skip caption generation")
    .option("--caption-style <style>", "Caption style: minimal, bold, animated", "bold")
    .option("--hook-duration <sec>", "Hook duration in seconds", "3")
    .option("-l, --language <lang>", "Language code for transcription")
    .option("--auto-narrate", "Auto-generate narration if no audio source found")
    .option("--narrate-voice <voice>", "Voice for auto-narration (default: rachel)", "rachel")
    .option("--narrate-style <style>", "Style for auto-narration: informative, energetic, calm, dramatic", "informative")
    .action(async (projectPath: string, options) => {
      try {
        // Validate API keys
        const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
        if (!openaiApiKey) {
          console.error(chalk.red("OpenAI API key required for Whisper transcription."));
          console.error(chalk.dim("Set OPENAI_API_KEY environment variable"));
          process.exit(1);
        }

        const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
        if (!claudeApiKey) {
          console.error(chalk.red("Anthropic API key required for viral analysis."));
          console.error(chalk.dim("Set ANTHROPIC_API_KEY environment variable"));
          process.exit(1);
        }

        // Load project
        let filePath = resolve(process.cwd(), projectPath);
        // If directory, look for project.vibe.json inside
        const { statSync } = await import("node:fs");
        try {
          if (statSync(filePath).isDirectory()) {
            const candidates = ["project.vibe.json", ".vibe.json"];
            let found = false;
            for (const candidate of candidates) {
              const candidatePath = resolve(filePath, candidate);
              if (existsSync(candidatePath)) {
                filePath = candidatePath;
                found = true;
                break;
              }
            }
            if (!found) {
              // Try any .vibe.json file in the directory
              const { readdirSync } = await import("node:fs");
              const files = readdirSync(filePath).filter((f: string) => f.endsWith(".vibe.json"));
              if (files.length > 0) {
                filePath = resolve(filePath, files[0]);
              } else {
                console.error(chalk.red(`No .vibe.json project file found in: ${filePath}`));
                process.exit(1);
              }
            }
          }
        } catch { /* not a directory, treat as file */ }

        if (!existsSync(filePath)) {
          console.error(chalk.red(`Project file not found: ${filePath}`));
          process.exit(1);
        }

        const content = await readFile(filePath, "utf-8");
        const data: ProjectFile = JSON.parse(content);
        const project = Project.fromJSON(data);

        // Parse target platforms
        let targetPlatforms: string[];
        if (options.platforms === "all") {
          targetPlatforms = Object.keys(PLATFORM_SPECS);
        } else {
          targetPlatforms = options.platforms.split(",").map((p: string) => p.trim().toLowerCase());
          // Validate platforms
          for (const platform of targetPlatforms) {
            if (!PLATFORM_SPECS[platform]) {
              console.error(chalk.red(`Unknown platform: ${platform}`));
              console.error(chalk.dim(`Available: ${Object.keys(PLATFORM_SPECS).join(", ")}`));
              process.exit(1);
            }
          }
        }

        console.log();
        console.log(chalk.bold.cyan("🚀 Viral Optimizer Pipeline"));
        console.log(chalk.dim("─".repeat(60)));
        console.log();

        // Get project info
        const clips = project.getClips();
        const sources = project.getSources();

        // Calculate total duration from clips
        let totalDuration = 0;
        for (const clip of clips) {
          const endTime = clip.startTime + clip.duration;
          if (endTime > totalDuration) {
            totalDuration = endTime;
          }
        }

        const projectInfo = `${project.getMeta().name} (${formatTime(totalDuration)}, ${clips.length} clips)`;
        console.log(`✔ Loaded project: ${chalk.bold(projectInfo)}`);

        // Step 1: Extract audio and transcribe
        // Find audio source first (narration), fall back to video
        let audioSource = sources.find((s) => s.type === "audio");
        const videoSource = sources.find((s) => s.type === "video");

        // Check if auto-narrate is needed
        if (!audioSource && videoSource && options.autoNarrate) {
          console.log();
          console.log(chalk.yellow("📝 No narration found, generating with AI..."));

          const outputDir = resolve(process.cwd(), options.outputDir);
          const videoPath = resolve(dirname(filePath), videoSource.url);

          const narrateResult = await autoNarrate({
            videoPath,
            duration: totalDuration,
            outputDir,
            voice: options.narrateVoice,
            style: options.narrateStyle as "informative" | "energetic" | "calm" | "dramatic",
            language: options.language || "en",
          });

          if (!narrateResult.success) {
            console.error(chalk.red(`Auto-narrate failed: ${narrateResult.error}`));
            process.exit(1);
          }

          console.log(chalk.green(`✔ Generated narration: ${narrateResult.audioPath}`));

          // Add the generated narration as a source
          // Use relative path from project directory to audio file
          const projectDir = dirname(filePath);
          const relativeAudioPath = relative(projectDir, narrateResult.audioPath!);
          const newAudioSource = project.addSource({
            name: "Auto-generated narration",
            url: relativeAudioPath,
            type: "audio",
            duration: totalDuration,
          });

          // Add audio clip to timeline
          const audioTrack = project.getTracks().find((t) => t.type === "audio");
          if (audioTrack) {
            project.addClip({
              sourceId: newAudioSource.id,
              trackId: audioTrack.id,
              startTime: 0,
              duration: totalDuration,
              sourceStartOffset: 0,
              sourceEndOffset: totalDuration,
            });
          }

          // Save updated project
          await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

          // Use the generated segments as transcript
          if (narrateResult.segments && narrateResult.segments.length > 0) {
            // Continue with viral analysis using auto-narrate segments
            audioSource = newAudioSource;
          }
        }

        const mediaSource = audioSource || videoSource;
        if (!mediaSource) {
          console.error(chalk.red("No video or audio source found in project"));
          process.exit(1);
        }

        // Check FFmpeg availability
        try {
          execSync("ffmpeg -version", { stdio: "ignore" });
        } catch {
          console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
          process.exit(1);
        }

        const transcribeSpinner = ora("📝 Transcribing content with Whisper...").start();

        let audioPath = resolve(dirname(filePath), mediaSource.url);
        let tempAudioPath: string | null = null;

        // Extract audio if video
        if (mediaSource.type === "video") {
          transcribeSpinner.text = "🎵 Extracting audio from video...";
          tempAudioPath = `/tmp/vibe_viral_audio_${Date.now()}.wav`;
          await execAsync(
            `ffmpeg -i "${audioPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
            { maxBuffer: 50 * 1024 * 1024 }
          );
          audioPath = tempAudioPath;
        }

        // Transcribe with Whisper
        const whisper = new WhisperProvider();
        await whisper.initialize({ apiKey: openaiApiKey });

        const audioBuffer = await readFile(audioPath);
        const audioBlob = new Blob([audioBuffer]);

        transcribeSpinner.text = "📝 Transcribing with Whisper...";
        const transcriptResult = await whisper.transcribe(audioBlob, options.language);

        // Cleanup temp file
        if (tempAudioPath && existsSync(tempAudioPath)) {
          await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
        }

        if (transcriptResult.status === "failed" || !transcriptResult.segments) {
          transcribeSpinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
          process.exit(1);
        }

        transcribeSpinner.succeed(chalk.green(`Transcribed ${transcriptResult.segments.length} segments`));

        // Step 2: Analyze viral potential with Claude
        const analyzeSpinner = ora("📊 Analyzing viral potential...").start();

        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: claudeApiKey });

        const viralAnalysis = await claude.analyzeViralPotential(
          transcriptResult.segments,
          { duration: totalDuration, clipCount: clips.length },
          targetPlatforms
        );

        analyzeSpinner.succeed(chalk.green("Analysis complete"));

        // Display analysis summary
        console.log();
        console.log(chalk.bold.cyan("Viral Potential Summary"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`  Overall Score: ${chalk.bold(viralAnalysis.overallScore + "%")}`);
        console.log(`  Hook Strength: ${chalk.bold(viralAnalysis.hookStrength + "%")}`);
        console.log(`  Pacing: ${chalk.bold(viralAnalysis.pacing)}`);
        console.log();

        // Platform suitability bars
        console.log("  Platform Suitability:");
        for (const platform of targetPlatforms) {
          const platformData = viralAnalysis.platforms[platform];
          if (platformData) {
            const score = Math.round(platformData.suitability * 100);
            const filledBars = Math.round(score / 10);
            const emptyBars = 10 - filledBars;
            const bar = "█".repeat(filledBars) + "░".repeat(emptyBars);
            const platformName = PLATFORM_SPECS[platform].name.padEnd(16);
            console.log(`    ${platformName} ${bar} ${score}%`);
          }
        }
        console.log();

        // Emotional peaks
        if (viralAnalysis.emotionalPeaks.length > 0) {
          console.log("  Emotional Peaks:");
          for (const peak of viralAnalysis.emotionalPeaks.slice(0, 5)) {
            console.log(`    ${formatTime(peak.time)} - ${peak.emotion} (${(peak.intensity * 100).toFixed(0)}%)`);
          }
          console.log();
        }

        // Hook recommendation
        if (viralAnalysis.hookRecommendation.suggestedStartTime > 0) {
          console.log(`  ${chalk.yellow("💡 Hook Tip:")} Consider starting at ${formatTime(viralAnalysis.hookRecommendation.suggestedStartTime)}`);
          console.log(`     ${chalk.dim(viralAnalysis.hookRecommendation.reason)}`);
          console.log();
        }

        // If analyze-only, stop here
        if (options.analyzeOnly) {
          // Save analysis JSON
          const outputDir = resolve(process.cwd(), options.outputDir);
          if (!existsSync(outputDir)) {
            await mkdir(outputDir, { recursive: true });
          }
          const analysisPath = resolve(outputDir, "analysis.json");
          await writeFile(analysisPath, JSON.stringify(viralAnalysis, null, 2), "utf-8");

          console.log(chalk.green(`💾 Analysis saved to: ${analysisPath}`));
          console.log();
          console.log(chalk.bold.green("✅ Analysis complete!"));
          console.log();
          return;
        }

        // Step 3: Generate platform variants
        console.log(chalk.bold.cyan("🎬 Generating platform variants..."));

        const outputDir = resolve(process.cwd(), options.outputDir);
        if (!existsSync(outputDir)) {
          await mkdir(outputDir, { recursive: true });
        }

        const generatedProjects: Array<{ platform: string; path: string; duration: number; aspectRatio: string }> = [];

        for (const platformId of targetPlatforms) {
          const platform = PLATFORM_SPECS[platformId];
          const variantSpinner = ora(`  Generating ${platform.name}...`).start();

          try {
            // Get platform-specific cuts from Claude
            const clipsInfo = clips.map((c) => ({
              id: c.id,
              startTime: c.startTime,
              duration: c.duration,
            }));

            const platformCut = await claude.suggestPlatformCuts(
              transcriptResult.segments,
              viralAnalysis,
              platform,
              clipsInfo
            );

            // Create platform-specific project
            const platformProject = new Project(`${project.getMeta().name} - ${platform.name}`);
            platformProject.setAspectRatio(platform.aspectRatio as "16:9" | "9:16" | "1:1");

            // Copy sources
            const sourceMap = new Map<string, string>();
            for (const source of sources) {
              const newSource = platformProject.addSource({
                name: source.name,
                url: source.url,
                type: source.type,
                duration: source.duration,
              });
              sourceMap.set(source.id, newSource.id);
            }

            // Get video track
            const videoTrack = platformProject.getTracks().find((t) => t.type === "video");
            if (!videoTrack) {
              variantSpinner.fail(chalk.red(`Failed to create ${platform.name} variant`));
              continue;
            }

            // Add clips based on platform cuts
            let currentTime = 0;
            let platformDuration = 0;
            let audioStartOffset = 0; // Track where in original timeline the cut starts

            if (platformCut.segments.length > 0) {
              // Use AI-suggested segments
              // Determine audio start offset from first segment's original timeline position
              const firstSegment = platformCut.segments[0];
              const firstOriginalClip = clips.find((c) => c.id === firstSegment.sourceClipId);
              if (firstOriginalClip) {
                // Calculate timeline position: clip start + offset within source
                audioStartOffset = firstOriginalClip.startTime + (firstSegment.startTime - firstOriginalClip.sourceStartOffset);
              }

              for (const segment of platformCut.segments) {
                // Find the original clip
                const originalClip = clips.find((c) => c.id === segment.sourceClipId);
                if (!originalClip) continue;

                const sourceId = sourceMap.get(originalClip.sourceId);
                if (!sourceId) continue;

                const segmentDuration = segment.endTime - segment.startTime;
                platformProject.addClip({
                  sourceId,
                  trackId: videoTrack.id,
                  startTime: currentTime,
                  duration: segmentDuration,
                  sourceStartOffset: segment.startTime,
                  sourceEndOffset: segment.endTime,
                });
                currentTime += segmentDuration;
                platformDuration += segmentDuration;
              }
            } else {
              // Fallback: use original clips, trimmed to fit duration
              // Audio starts from first clip's timeline position
              if (clips.length > 0) {
                audioStartOffset = clips[0].startTime;
              }

              for (const clip of clips) {
                const sourceId = sourceMap.get(clip.sourceId);
                if (!sourceId) continue;

                if (currentTime + clip.duration <= platform.maxDuration) {
                  platformProject.addClip({
                    sourceId,
                    trackId: videoTrack.id,
                    startTime: currentTime,
                    duration: clip.duration,
                    sourceStartOffset: clip.sourceStartOffset,
                    sourceEndOffset: clip.sourceEndOffset,
                  });
                  currentTime += clip.duration;
                  platformDuration += clip.duration;
                } else {
                  // Trim the last clip to fit
                  const remainingDuration = platform.maxDuration - currentTime;
                  if (remainingDuration > 0) {
                    platformProject.addClip({
                      sourceId,
                      trackId: videoTrack.id,
                      startTime: currentTime,
                      duration: remainingDuration,
                      sourceStartOffset: clip.sourceStartOffset,
                      sourceEndOffset: clip.sourceStartOffset + remainingDuration,
                    });
                    platformDuration += remainingDuration;
                  }
                  break;
                }
              }
            }

            // Add audio clip if original project has audio
            const originalAudioSource = sources.find((s) => s.type === "audio");
            const audioTrack = platformProject.getTracks().find((t) => t.type === "audio");
            if (originalAudioSource && audioTrack && platformDuration > 0) {
              const audioSourceId = sourceMap.get(originalAudioSource.id);
              if (audioSourceId) {
                // Add audio clip synced with the video cut
                platformProject.addClip({
                  sourceId: audioSourceId,
                  trackId: audioTrack.id,
                  startTime: 0,
                  duration: platformDuration,
                  sourceStartOffset: audioStartOffset,
                  sourceEndOffset: audioStartOffset + platformDuration,
                });
              }
            }

            // Generate captions if not skipped
            if (!options.skipCaptions) {
              const captionStyle = options.captionStyle as "minimal" | "bold" | "animated";
              const captions = await claude.generateViralCaptions(
                transcriptResult.segments.filter(
                  (s) => s.endTime <= platformDuration
                ),
                captionStyle
              );

              // Store captions as project metadata (for future caption track support)
              // For now, save as separate file
              if (captions.length > 0) {
                const captionsPath = resolve(outputDir, `${platformId}-captions.json`);
                await writeFile(captionsPath, JSON.stringify(captions, null, 2), "utf-8");
              }
            }

            // Save platform project
            const projectPath = resolve(outputDir, `${platformId}.vibe.json`);
            await writeFile(projectPath, JSON.stringify(platformProject.toJSON(), null, 2), "utf-8");

            generatedProjects.push({
              platform: platform.name,
              path: projectPath,
              duration: platformDuration,
              aspectRatio: platform.aspectRatio,
            });

            variantSpinner.succeed(chalk.green(`  ✔ ${platformId}.vibe.json (${formatTime(platformDuration)}, ${platform.aspectRatio})`));
          } catch (error) {
            variantSpinner.fail(chalk.red(`  ✘ Failed to generate ${platform.name}: ${error}`));
          }
        }

        // Save analysis JSON
        const analysisPath = resolve(outputDir, "analysis.json");
        const result: ViralOptimizationResult = {
          sourceProject: filePath,
          analysis: viralAnalysis,
          platformCuts: [],
          platformProjects: generatedProjects.map((p) => ({
            platform: p.platform,
            projectPath: p.path,
            duration: p.duration,
            aspectRatio: p.aspectRatio,
          })),
        };
        await writeFile(analysisPath, JSON.stringify(result, null, 2), "utf-8");

        // Final summary
        console.log();
        console.log(chalk.dim("─".repeat(60)));
        console.log(chalk.bold.green(`✅ Viral optimization complete!`));
        console.log(`   ${chalk.bold(generatedProjects.length)} platform variants generated`);
        console.log();
        console.log(`💾 Saved to: ${chalk.cyan(outputDir)}/`);
        console.log();
        console.log(chalk.dim("Next steps:"));
        for (const proj of generatedProjects.slice(0, 3)) {
          const filename = basename(proj.path);
          console.log(chalk.dim(`  vibe export ${options.outputDir}/${filename} -o ${proj.platform.toLowerCase().replace(/\s+/g, "-")}.mp4`));
        }
        if (generatedProjects.length > 3) {
          console.log(chalk.dim(`  ... and ${generatedProjects.length - 3} more`));
        }
        console.log();
      } catch (error) {
        console.error(chalk.red("Viral optimization failed"));
        console.error(error);
        process.exit(1);
      }
    });
}

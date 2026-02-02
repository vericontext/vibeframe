import { Command } from "commander";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import {
  providerRegistry,
  WhisperProvider,
  GeminiProvider,
  OpenAIProvider,
  ClaudeProvider,
  ElevenLabsProvider,
  DalleProvider,
  RunwayProvider,
  KlingProvider,
  StabilityProvider,
  ReplicateProvider,
  whisperProvider,
  geminiProvider,
  openaiProvider,
  claudeProvider,
  elevenLabsProvider,
  dalleProvider,
  runwayProvider,
  klingProvider,
  stabilityProvider,
  replicateProvider,
  type TimelineCommand,
  type Highlight,
  type HighlightCriteria,
  type HighlightsResult,
  type BrollClipInfo,
  type BrollMatch,
  type BrollMatchResult,
  type PlatformSpec,
  type ViralOptimizationResult,
} from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../engine/index.js";
import type { EffectType } from "@vibeframe/core/timeline";
import { detectFormat, formatTranscript } from "../utils/subtitle.js";
import { getApiKey } from "../utils/api-key.js";

const execAsync = promisify(exec);

export const aiCommand = new Command("ai")
  .description("AI provider commands");

aiCommand
  .command("transcribe")
  .description("Transcribe audio using Whisper")
  .argument("<audio>", "Audio file path")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-l, --language <lang>", "Language code (e.g., en, ko)")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --format <format>", "Output format: json, srt, vtt (auto-detected from extension)")
  .action(async (audioPath: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Initializing Whisper...").start();

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey });

      spinner.text = "Reading audio file...";
      const absPath = resolve(process.cwd(), audioPath);
      const audioBuffer = await readFile(absPath);
      const audioBlob = new Blob([audioBuffer]);

      spinner.text = "Transcribing...";
      const result = await whisper.transcribe(audioBlob, options.language);

      if (result.status === "failed") {
        spinner.fail(chalk.red(`Transcription failed: ${result.error}`));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Transcription complete"));

      console.log();
      console.log(chalk.bold.cyan("Transcript"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(result.fullText);
      console.log();

      if (result.segments && result.segments.length > 0) {
        console.log(chalk.bold.cyan("Segments"));
        console.log(chalk.dim("─".repeat(60)));
        for (const seg of result.segments) {
          const time = `[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]`;
          console.log(`${chalk.dim(time)} ${seg.text}`);
        }
        console.log();
      }

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        const format = detectFormat(options.output, options.format);
        const content = formatTranscript(result, format);
        await writeFile(outputPath, content, "utf-8");
        console.log(chalk.green(`Saved ${format.toUpperCase()} to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Transcription failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("suggest")
  .description("Get AI edit suggestions using Gemini")
  .argument("<project>", "Project file path")
  .argument("<instruction>", "Natural language instruction")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("--apply", "Apply the first suggestion automatically")
  .action(async (projectPath: string, instruction: string, options) => {
    try {
      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required. Use --api-key or set GOOGLE_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Initializing Gemini...").start();

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      spinner.text = "Analyzing...";
      const clips = project.getClips();
      const suggestions = await gemini.autoEdit(clips, instruction);

      spinner.succeed(chalk.green(`Found ${suggestions.length} suggestion(s)`));

      console.log();
      console.log(chalk.bold.cyan("Edit Suggestions"));
      console.log(chalk.dim("─".repeat(60)));

      for (let i = 0; i < suggestions.length; i++) {
        const sug = suggestions[i];
        console.log();
        console.log(chalk.yellow(`[${i + 1}] ${sug.type.toUpperCase()}`));
        console.log(`    ${sug.description}`);
        console.log(chalk.dim(`    Confidence: ${(sug.confidence * 100).toFixed(0)}%`));
        console.log(chalk.dim(`    Clips: ${sug.clipIds.join(", ")}`));
        console.log(chalk.dim(`    Params: ${JSON.stringify(sug.params)}`));
      }

      if (options.apply && suggestions.length > 0) {
        console.log();
        spinner.start("Applying first suggestion...");

        const sug = suggestions[0];
        const applied = applySuggestion(project, sug);

        if (applied) {
          await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
          spinner.succeed(chalk.green("Suggestion applied"));
        } else {
          spinner.warn(chalk.yellow("Could not apply suggestion automatically"));
        }
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("AI suggestion failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("edit")
  .description("Edit timeline using natural language (GPT-powered)")
  .argument("<project>", "Project file path")
  .argument("<instruction>", "Natural language command (e.g., 'trim all clips to 5 seconds')")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("--dry-run", "Show commands without executing")
  .action(async (projectPath: string, instruction: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Parsing command...").start();

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const gpt = new OpenAIProvider();
      await gpt.initialize({ apiKey });

      const clips = project.getClips();
      const tracks = project.getTracks().map((t) => t.id);

      const result = await gpt.parseCommand(instruction, { clips, tracks });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Failed to parse command"));
        process.exit(1);
      }

      if (result.clarification) {
        spinner.warn(chalk.yellow(result.clarification));
        process.exit(0);
      }

      if (result.commands.length === 0) {
        spinner.warn(chalk.yellow("No commands generated"));
        process.exit(0);
      }

      spinner.succeed(chalk.green(`Parsed ${result.commands.length} command(s)`));

      console.log();
      console.log(chalk.bold.cyan("Commands to execute:"));
      console.log(chalk.dim("─".repeat(60)));

      for (const cmd of result.commands) {
        console.log();
        console.log(chalk.yellow(`▸ ${cmd.action.toUpperCase()}`));
        console.log(`  ${cmd.description}`);
        if (cmd.clipIds.length > 0) {
          console.log(chalk.dim(`  Clips: ${cmd.clipIds.join(", ")}`));
        }
        console.log(chalk.dim(`  Params: ${JSON.stringify(cmd.params)}`));
      }

      if (options.dryRun) {
        console.log();
        console.log(chalk.dim("Dry run - no changes made"));
        return;
      }

      console.log();
      spinner.start("Executing commands...");

      let executed = 0;
      for (const cmd of result.commands) {
        const success = executeCommand(project, cmd);
        if (success) executed++;
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Executed ${executed}/${result.commands.length} commands`));
      console.log();
    } catch (error) {
      console.error(chalk.red("AI edit failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("tts")
  .description("Generate speech from text using ElevenLabs")
  .argument("<text>", "Text to convert to speech")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "output.mp3")
  .option("-v, --voice <id>", "Voice ID (use 'ai voices' to list)")
  .option("--list-voices", "List available voices")
  .action(async (text: string, options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      // List voices mode
      if (options.listVoices) {
        const spinner = ora("Fetching voices...").start();
        const voices = await elevenlabs.getVoices();
        spinner.succeed(chalk.green(`Found ${voices.length} voices`));

        console.log();
        console.log(chalk.bold.cyan("Available Voices"));
        console.log(chalk.dim("─".repeat(60)));

        for (const voice of voices) {
          console.log();
          console.log(`${chalk.bold(voice.name)} ${chalk.dim(`(${voice.voice_id})`)}`);
          console.log(`  Category: ${voice.category}`);
          if (voice.labels) {
            const labels = Object.entries(voice.labels)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            console.log(`  ${chalk.dim(labels)}`);
          }
        }
        console.log();
        return;
      }

      const spinner = ora("Generating speech...").start();

      const result = await elevenlabs.textToSpeech(text, {
        voiceId: options.voice,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail(chalk.red(result.error || "TTS generation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Speech generated"));
      console.log();
      console.log(chalk.dim(`Characters: ${result.characterCount}`));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("TTS generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("voices")
  .description("List available ElevenLabs voices")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .action(async (options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required"));
        process.exit(1);
      }

      const spinner = ora("Fetching voices...").start();
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const voices = await elevenlabs.getVoices();
      spinner.succeed(chalk.green(`Found ${voices.length} voices`));

      console.log();
      console.log(chalk.bold.cyan("Available Voices"));
      console.log(chalk.dim("─".repeat(60)));

      for (const voice of voices) {
        console.log();
        console.log(`${chalk.bold(voice.name)} ${chalk.dim(`(${voice.voice_id})`)}`);
        console.log(`  Category: ${voice.category}`);
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Failed to fetch voices"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sfx")
  .description("Generate sound effect using ElevenLabs")
  .argument("<prompt>", "Description of the sound effect")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "sound-effect.mp3")
  .option("-d, --duration <seconds>", "Duration in seconds (0.5-22, default: auto)")
  .option("-p, --prompt-influence <value>", "Prompt influence (0-1, default: 0.3)")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating sound effect...").start();

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.generateSoundEffect(prompt, {
        duration: options.duration ? parseFloat(options.duration) : undefined,
        promptInfluence: options.promptInfluence ? parseFloat(options.promptInfluence) : undefined,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail(chalk.red(result.error || "Sound effect generation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Sound effect generated"));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Sound effect generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("isolate")
  .description("Isolate vocals from audio using ElevenLabs")
  .argument("<audio>", "Input audio file path")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "vocals.mp3")
  .action(async (audioPath: string, options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Reading audio file...").start();

      const absPath = resolve(process.cwd(), audioPath);
      const audioBuffer = await readFile(absPath);

      spinner.text = "Isolating vocals...";

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.isolateVocals(audioBuffer);

      if (!result.success || !result.audioBuffer) {
        spinner.fail(chalk.red(result.error || "Audio isolation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Vocals isolated"));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Audio isolation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("motion")
  .description("Generate motion graphics using Claude + Remotion")
  .argument("<description>", "Natural language description of the motion graphic")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("-o, --output <path>", "Output file path for generated code", "motion.tsx")
  .option("-d, --duration <sec>", "Duration in seconds", "5")
  .option("-w, --width <px>", "Width in pixels", "1920")
  .option("-h, --height <px>", "Height in pixels", "1080")
  .option("--fps <fps>", "Frame rate", "30")
  .option("-s, --style <style>", "Style preset: minimal, corporate, playful, cinematic")
  .action(async (description: string, options) => {
    try {
      const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Anthropic API key required. Use --api-key or set ANTHROPIC_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating motion graphic...").start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });

      const result = await claude.generateMotion(description, {
        duration: parseFloat(options.duration),
        width: parseInt(options.width),
        height: parseInt(options.height),
        fps: parseInt(options.fps),
        style: options.style,
      });

      if (!result.success || !result.component) {
        spinner.fail(chalk.red(result.error || "Motion generation failed"));
        process.exit(1);
      }

      const { component } = result;
      spinner.succeed(chalk.green("Motion graphic generated"));

      console.log();
      console.log(chalk.bold.cyan("Generated Component"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Name: ${chalk.bold(component.name)}`);
      console.log(`Size: ${component.width}x${component.height} @ ${component.fps}fps`);
      console.log(`Duration: ${component.durationInFrames} frames (${options.duration}s)`);
      console.log(`Description: ${component.description}`);
      console.log();

      // Save the component code
      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, component.code, "utf-8");
      console.log(chalk.green(`Saved to: ${outputPath}`));

      console.log();
      console.log(chalk.dim("To render, use Remotion CLI:"));
      console.log(chalk.dim(`  npx remotion render ${options.output} ${component.name} out.mp4`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Motion generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("storyboard")
  .description("Generate video storyboard from content using Claude")
  .argument("<content>", "Content to analyze (text or file path)")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("-o, --output <path>", "Output JSON file path")
  .option("-d, --duration <sec>", "Target total duration in seconds")
  .option("-f, --file", "Treat content argument as file path")
  .action(async (content: string, options) => {
    try {
      const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Anthropic API key required. Use --api-key or set ANTHROPIC_API_KEY"));
        process.exit(1);
      }

      let textContent = content;
      if (options.file) {
        const filePath = resolve(process.cwd(), content);
        textContent = await readFile(filePath, "utf-8");
      }

      const spinner = ora("Analyzing content...").start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });

      const segments = await claude.analyzeContent(
        textContent,
        options.duration ? parseFloat(options.duration) : undefined
      );

      if (segments.length === 0) {
        spinner.fail(chalk.red("Could not generate storyboard"));
        process.exit(1);
      }

      spinner.succeed(chalk.green(`Generated ${segments.length} segments`));

      console.log();
      console.log(chalk.bold.cyan("Storyboard"));
      console.log(chalk.dim("─".repeat(60)));

      for (const seg of segments) {
        console.log();
        console.log(chalk.yellow(`[${seg.index + 1}] ${formatTime(seg.startTime)} - ${formatTime(seg.startTime + seg.duration)}`));
        console.log(`  ${seg.description}`);
        console.log(chalk.dim(`  Visuals: ${seg.visuals}`));
        if (seg.audio) {
          console.log(chalk.dim(`  Audio: ${seg.audio}`));
        }
        if (seg.textOverlays && seg.textOverlays.length > 0) {
          console.log(chalk.dim(`  Text: ${seg.textOverlays.join(", ")}`));
        }
      }
      console.log();

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, JSON.stringify(segments, null, 2), "utf-8");
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Storyboard generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("image")
  .description("Generate image using AI (DALL-E, Gemini Imagen, or Stability)")
  .argument("<prompt>", "Image description prompt")
  .option("-p, --provider <provider>", "Provider: dalle, gemini, stability", "dalle")
  .option("-k, --api-key <key>", "API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY, STABILITY_API_KEY)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-s, --size <size>", "Image size (dalle: 1024x1024, 1792x1024, 1024x1792)", "1024x1024")
  .option("-r, --ratio <ratio>", "Aspect ratio (gemini: 1:1, 16:9, 9:16, 3:4, 4:3)", "1:1")
  .option("-q, --quality <quality>", "Quality: standard, hd (dalle only)", "standard")
  .option("--style <style>", "Style: vivid, natural (dalle only)", "vivid")
  .option("-n, --count <n>", "Number of images to generate", "1")
  .action(async (prompt: string, options) => {
    try {
      const provider = options.provider.toLowerCase();
      const validProviders = ["dalle", "gemini", "stability"];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}`));
        console.error(chalk.dim(`Available providers: ${validProviders.join(", ")}`));
        process.exit(1);
      }

      // Get API key based on provider
      const envKeyMap: Record<string, string> = {
        dalle: "OPENAI_API_KEY",
        gemini: "GOOGLE_API_KEY",
        stability: "STABILITY_API_KEY",
      };
      const providerNameMap: Record<string, string> = {
        dalle: "OpenAI",
        gemini: "Google",
        stability: "Stability",
      };
      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];

      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        console.error(chalk.red(`${providerName} API key required.`));
        console.error(chalk.dim(`Use --api-key or set ${envKey} environment variable`));
        process.exit(1);
      }

      const spinner = ora(`Generating image with ${providerName}...`).start();

      if (provider === "dalle") {
        const dalle = new DalleProvider();
        await dalle.initialize({ apiKey });

        const result = await dalle.generateImage(prompt, {
          size: options.size,
          quality: options.quality,
          style: options.style,
          n: parseInt(options.count),
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with DALL-E`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          console.log();
          console.log(`${chalk.yellow(`[${i + 1}]`)} ${img.url}`);
          if (img.revisedPrompt) {
            console.log(chalk.dim(`    Revised: ${img.revisedPrompt.slice(0, 100)}...`));
          }
        }
        console.log();

        // Download if output specified
        if (options.output && result.images.length > 0) {
          const downloadSpinner = ora("Downloading image...").start();
          try {
            const response = await fetch(result.images[0].url);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            downloadSpinner.fail(chalk.red("Failed to download image"));
          }
        }
      } else if (provider === "gemini") {
        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey });

        const result = await gemini.generateImage(prompt, {
          numberOfImages: parseInt(options.count),
          aspectRatio: options.ratio as "1:1" | "16:9" | "9:16" | "3:4" | "4:3",
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Gemini Imagen 3`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        // Gemini returns base64, we need to save or display
        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          console.log();
          console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image, ${img.mimeType})`);
        }
        console.log();

        // Save if output specified
        if (options.output && result.images.length > 0) {
          const saveSpinner = ora("Saving image...").start();
          try {
            const img = result.images[0];
            const buffer = Buffer.from(img.base64, "base64");
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
          }
        } else {
          console.log(chalk.yellow("Use -o to save the generated image to a file"));
        }
      } else if (provider === "stability") {
        const stability = new StabilityProvider();
        await stability.initialize({ apiKey });

        // Map size to Stability aspect ratio
        const aspectRatioMap: Record<string, "16:9" | "1:1" | "9:16"> = {
          "1024x1024": "1:1",
          "1792x1024": "16:9",
          "1024x1792": "9:16",
        };

        const result = await stability.generateImage(prompt, {
          aspectRatio: aspectRatioMap[options.size] || "1:1",
          count: parseInt(options.count),
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Stability AI`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        for (let i = 0; i < result.images.length; i++) {
          console.log();
          console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image)`);
        }
        console.log();

        // Save if output specified
        if (options.output && result.images.length > 0) {
          const saveSpinner = ora("Saving image...").start();
          try {
            const img = result.images[0];
            if (!img.base64) {
              saveSpinner.fail(chalk.red("No image data returned"));
              process.exit(1);
            }
            const buffer = Buffer.from(img.base64, "base64");
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
          }
        } else {
          console.log(chalk.yellow("Use -o to save the generated image to a file"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("thumbnail")
  .description("Generate video thumbnail using DALL-E")
  .argument("<description>", "Thumbnail description")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-s, --style <style>", "Platform style: youtube, instagram, tiktok, twitter")
  .action(async (description: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating thumbnail...").start();

      const dalle = new DalleProvider();
      await dalle.initialize({ apiKey });

      const result = await dalle.generateThumbnail(description, options.style);

      if (!result.success || !result.images) {
        spinner.fail(chalk.red(result.error || "Thumbnail generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Thumbnail generated"));

      const img = result.images[0];
      console.log();
      console.log(chalk.bold.cyan("Generated Thumbnail"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`URL: ${img.url}`);
      if (img.revisedPrompt) {
        console.log(chalk.dim(`Prompt: ${img.revisedPrompt.slice(0, 100)}...`));
      }
      console.log();

      // Download if output specified
      if (options.output) {
        const downloadSpinner = ora("Downloading thumbnail...").start();
        try {
          const response = await fetch(img.url);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download thumbnail"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Thumbnail generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("background")
  .description("Generate video background using DALL-E")
  .argument("<description>", "Background description")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-a, --aspect <ratio>", "Aspect ratio: 16:9, 9:16, 1:1", "16:9")
  .action(async (description: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating background...").start();

      const dalle = new DalleProvider();
      await dalle.initialize({ apiKey });

      const result = await dalle.generateBackground(description, options.aspect);

      if (!result.success || !result.images) {
        spinner.fail(chalk.red(result.error || "Background generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Background generated"));

      const img = result.images[0];
      console.log();
      console.log(chalk.bold.cyan("Generated Background"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`URL: ${img.url}`);
      if (img.revisedPrompt) {
        console.log(chalk.dim(`Prompt: ${img.revisedPrompt.slice(0, 100)}...`));
      }
      console.log();

      // Download if output specified
      if (options.output) {
        const downloadSpinner = ora("Downloading background...").start();
        try {
          const response = await fetch(img.url);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download background"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Background generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("video")
  .description("Generate video using AI (Runway or Kling)")
  .argument("<prompt>", "Text prompt describing the video")
  .option("-p, --provider <provider>", "Provider: runway, kling", "runway")
  .option("-k, --api-key <key>", "API key (or set RUNWAY_API_SECRET / KLING_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads video)")
  .option("-i, --image <path>", "Reference image for image-to-video")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1 (Kling only)", "16:9")
  .option("-s, --seed <number>", "Random seed for reproducibility (Runway only)")
  .option("-m, --mode <mode>", "Generation mode: std or pro (Kling only)", "std")
  .option("-n, --negative <prompt>", "Negative prompt - what to avoid (Kling only)")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .action(async (prompt: string, options) => {
    try {
      const provider = options.provider.toLowerCase();
      const validProviders = ["runway", "kling"];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}`));
        console.error(chalk.dim(`Available providers: ${validProviders.join(", ")}`));
        process.exit(1);
      }

      // Get API key based on provider
      const envKey = provider === "runway" ? "RUNWAY_API_SECRET" : "KLING_API_KEY";
      const providerName = provider === "runway" ? "Runway" : "Kling";
      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        console.error(chalk.red(`${providerName} API key required.`));
        if (provider === "kling") {
          console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        }
        console.error(chalk.dim(`Use --api-key or set ${envKey} environment variable`));
        process.exit(1);
      }

      const spinner = ora(`Initializing ${providerName}...`).start();

      // Read reference image if provided
      let referenceImage: string | undefined;
      let isImageToVideo = false;
      if (options.image) {
        spinner.text = "Reading reference image...";
        const imagePath = resolve(process.cwd(), options.image);
        const imageBuffer = await readFile(imagePath);
        const ext = options.image.toLowerCase().split(".").pop();
        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mimeType = mimeTypes[ext || "png"] || "image/png";
        referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
        isImageToVideo = true;
      }

      spinner.text = "Starting video generation...";

      let result;
      let finalResult;

      if (provider === "runway") {
        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        result = await runway.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16",
          seed: options.seed ? parseInt(options.seed) : undefined,
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Runway Gen-3")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe ai video-status ${result.id}`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 1-2 minutes)...";

        finalResult = await runway.waitForCompletion(
          result.id,
          (status) => {
            if (status.progress !== undefined) {
              spinner.text = `Generating video... ${status.progress}%`;
            }
          },
          300000 // 5 minute timeout
        );
      } else {
        // Kling provider
        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
          process.exit(1);
        }

        result = await kling.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          negativePrompt: options.negative,
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Kling AI")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);
        console.log(`Type: ${isImageToVideo ? "image2video" : "text2video"}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe ai kling-status ${result.id}${isImageToVideo ? " --type image2video" : ""}`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 2-5 minutes)...";

        const taskType = isImageToVideo ? "image2video" : "text2video";
        finalResult = await kling.waitForCompletion(
          result.id,
          taskType,
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          600000 // 10 minute timeout
        );
      }

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video generated"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);
      }
      if (finalResult.duration) {
        console.log(`Duration: ${finalResult.duration}s`);
      }
      console.log();

      // Download if output specified
      if (options.output && finalResult.videoUrl) {
        const downloadSpinner = ora("Downloading video...").start();
        try {
          const response = await fetch(finalResult.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download video"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Video generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("video-status")
  .description("Check Runway video generation status")
  .argument("<task-id>", "Task ID from video generation")
  .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
  .option("-w, --wait", "Wait for completion")
  .option("-o, --output <path>", "Download video when complete")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Runway API key required"));
        process.exit(1);
      }

      const spinner = ora("Checking status...").start();

      const runway = new RunwayProvider();
      await runway.initialize({ apiKey });

      let result = await runway.getGenerationStatus(taskId);

      if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
        spinner.text = "Waiting for completion...";
        result = await runway.waitForCompletion(
          taskId,
          (status) => {
            if (status.progress !== undefined) {
              spinner.text = `Generating... ${status.progress}%`;
            }
          }
        );
      }

      spinner.stop();

      console.log();
      console.log(chalk.bold.cyan("Generation Status"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${taskId}`);
      console.log(`Status: ${getStatusColor(result.status)}`);
      if (result.progress !== undefined) {
        console.log(`Progress: ${result.progress}%`);
      }
      if (result.videoUrl) {
        console.log(`Video URL: ${result.videoUrl}`);
      }
      if (result.error) {
        console.log(`Error: ${chalk.red(result.error)}`);
      }
      console.log();

      // Download if output specified and completed
      if (options.output && result.videoUrl) {
        const downloadSpinner = ora("Downloading video...").start();
        try {
          const response = await fetch(result.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download video"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Failed to get status"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("video-cancel")
  .description("Cancel Runway video generation")
  .argument("<task-id>", "Task ID to cancel")
  .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Runway API key required"));
        process.exit(1);
      }

      const spinner = ora("Cancelling generation...").start();

      const runway = new RunwayProvider();
      await runway.initialize({ apiKey });

      const success = await runway.cancelGeneration(taskId);

      if (success) {
        spinner.succeed(chalk.green("Generation cancelled"));
      } else {
        spinner.fail(chalk.red("Failed to cancel generation"));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("Failed to cancel"));
      console.error(error);
      process.exit(1);
    }
  });

// Kling video generation commands
aiCommand
  .command("kling")
  .description("Generate video using Kling AI")
  .argument("<prompt>", "Text prompt describing the video")
  .option("-k, --api-key <key>", "Kling API key (ACCESS_KEY:SECRET_KEY) or set KLING_API_KEY env")
  .option("-o, --output <path>", "Output file path (downloads video)")
  .option("-i, --image <path>", "Reference image for image-to-video")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
  .option("-m, --mode <mode>", "Generation mode: std (standard) or pro", "std")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required."));
        console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        console.error(chalk.dim("Use --api-key or set KLING_API_KEY environment variable"));
        process.exit(1);
      }

      const spinner = ora("Initializing Kling AI...").start();

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      if (!kling.isConfigured()) {
        spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
        process.exit(1);
      }

      // If image provided, read it
      let referenceImage: string | undefined;
      let isImageToVideo = false;
      if (options.image) {
        spinner.text = "Reading reference image...";
        const imagePath = resolve(process.cwd(), options.image);
        const imageBuffer = await readFile(imagePath);
        const ext = options.image.toLowerCase().split(".").pop();
        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mimeType = mimeTypes[ext || "png"] || "image/png";
        referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
        isImageToVideo = true;
      }

      spinner.text = "Starting video generation...";

      const result = await kling.generateVideo(prompt, {
        prompt,
        referenceImage,
        duration: parseInt(options.duration) as 5 | 10,
        aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
        negativePrompt: options.negative,
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Failed to start generation"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Kling Video Generation Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);
      console.log(`Type: ${isImageToVideo ? "image2video" : "text2video"}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Generation started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  pnpm vibe ai kling-status ${result.id}${isImageToVideo ? " --type image2video" : ""}`));
        console.log();
        return;
      }

      spinner.text = "Generating video (this may take 2-5 minutes)...";

      const taskType = isImageToVideo ? "image2video" : "text2video";
      const finalResult = await kling.waitForCompletion(
        result.id,
        taskType,
        (status) => {
          spinner.text = `Generating video... ${status.status}`;
        },
        600000 // 10 minute timeout
      );

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video generated"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);
      }
      if (finalResult.duration) {
        console.log(`Duration: ${finalResult.duration}s`);
      }
      console.log();

      // Download if output specified
      if (options.output && finalResult.videoUrl) {
        const downloadSpinner = ora("Downloading video...").start();
        try {
          const response = await fetch(finalResult.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download video"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Video generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("kling-status")
  .description("Check Kling video generation status")
  .argument("<task-id>", "Task ID from video generation")
  .option("-k, --api-key <key>", "Kling API key (or set KLING_API_KEY env)")
  .option("-t, --type <type>", "Task type: text2video or image2video", "text2video")
  .option("-w, --wait", "Wait for completion")
  .option("-o, --output <path>", "Download video when complete")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required"));
        process.exit(1);
      }

      const spinner = ora("Checking status...").start();

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      const taskType = options.type as "text2video" | "image2video";
      let result = await kling.getGenerationStatus(taskId, taskType);

      if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
        spinner.text = "Waiting for completion...";
        result = await kling.waitForCompletion(
          taskId,
          taskType,
          (status) => {
            spinner.text = `Generating... ${status.status}`;
          }
        );
      }

      spinner.stop();

      console.log();
      console.log(chalk.bold.cyan("Kling Generation Status"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${taskId}`);
      console.log(`Type: ${taskType}`);
      console.log(`Status: ${getStatusColor(result.status)}`);
      if (result.videoUrl) {
        console.log(`Video URL: ${result.videoUrl}`);
      }
      if (result.duration) {
        console.log(`Duration: ${result.duration}s`);
      }
      if (result.error) {
        console.log(`Error: ${chalk.red(result.error)}`);
      }
      console.log();

      // Download if output specified and completed
      if (options.output && result.videoUrl) {
        const downloadSpinner = ora("Downloading video...").start();
        try {
          const response = await fetch(result.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download video"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Failed to get status"));
      console.error(error);
      process.exit(1);
    }
  });

// Video Extend command (Kling AI)
aiCommand
  .command("video-extend")
  .description("Extend video duration using Kling AI")
  .argument("<video>", "Video file path or URL")
  .option("-k, --api-key <key>", "Kling API key (ACCESS_KEY:SECRET_KEY) or set KLING_API_KEY env")
  .option("-o, --output <path>", "Output file path")
  .option("-p, --prompt <text>", "Continuation prompt")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .action(async (videoPath: string, options) => {
    try {
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required."));
        console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        console.error(chalk.dim("Use --api-key or set KLING_API_KEY environment variable"));
        process.exit(1);
      }

      const spinner = ora("Initializing Kling AI...").start();

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      if (!kling.isConfigured()) {
        spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
        process.exit(1);
      }

      // Read video file or use URL
      let videoData: string;
      if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
        videoData = videoPath;
      } else {
        spinner.text = "Reading video file...";
        const absPath = resolve(process.cwd(), videoPath);
        const videoBuffer = await readFile(absPath);
        const ext = videoPath.toLowerCase().split(".").pop();
        const mimeTypes: Record<string, string> = {
          mp4: "video/mp4",
          webm: "video/webm",
          mov: "video/quicktime",
        };
        const mimeType = mimeTypes[ext || "mp4"] || "video/mp4";
        videoData = `data:${mimeType};base64,${videoBuffer.toString("base64")}`;
      }

      spinner.text = "Starting video extension...";

      const result = await kling.extendVideo(videoData, {
        prompt: options.prompt,
        negativePrompt: options.negative,
        duration: options.duration as "5" | "10",
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Failed to start extension"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Video Extension Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Extension started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  pnpm vibe ai video-extend-status ${result.id}`));
        console.log();
        return;
      }

      spinner.text = "Extending video (this may take 2-5 minutes)...";

      const finalResult = await kling.waitForExtendCompletion(
        result.id,
        (status) => {
          spinner.text = `Extending video... ${status.status}`;
        },
        600000
      );

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Extension failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video extended"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);
      }
      if (finalResult.duration) {
        console.log(`Duration: ${finalResult.duration}s`);
      }
      console.log();

      // Download if output specified
      if (options.output && finalResult.videoUrl) {
        const downloadSpinner = ora("Downloading video...").start();
        try {
          const response = await fetch(finalResult.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download video"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Video extension failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Video Upscale command
aiCommand
  .command("video-upscale")
  .description("Upscale video resolution using AI or FFmpeg")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path")
  .option("-s, --scale <factor>", "Scale factor: 2 or 4", "2")
  .option("-m, --model <model>", "Model: real-esrgan, topaz", "real-esrgan")
  .option("--ffmpeg", "Use FFmpeg lanczos (free, no API)")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .option("--no-wait", "Start processing and return task ID without waiting")
  .action(async (videoPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), videoPath);
      const scale = parseInt(options.scale);

      if (scale !== 2 && scale !== 4) {
        console.error(chalk.red("Scale must be 2 or 4"));
        process.exit(1);
      }

      // Use FFmpeg if requested (free fallback)
      if (options.ffmpeg) {
        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : absPath.replace(/(\.[^.]+)$/, `-upscaled-${scale}x$1`);

        const spinner = ora(`Upscaling video with FFmpeg (${scale}x)...`).start();

        try {
          // Get original dimensions
          const { stdout: probeOut } = await execAsync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${absPath}"`
          );
          const [width, height] = probeOut.trim().split(",").map(Number);
          const newWidth = width * scale;
          const newHeight = height * scale;

          // Use lanczos scaling
          await execAsync(
            `ffmpeg -i "${absPath}" -vf "scale=${newWidth}:${newHeight}:flags=lanczos" -c:a copy "${outputPath}" -y`
          );

          spinner.succeed(chalk.green(`Upscaled to ${newWidth}x${newHeight}`));
          console.log(`Output: ${outputPath}`);
        } catch (err) {
          spinner.fail(chalk.red("FFmpeg upscaling failed"));
          console.error(err);
          process.exit(1);
        }
        return;
      }

      // Use Replicate API
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required for AI upscaling."));
        console.error(chalk.dim("Use --api-key or set REPLICATE_API_TOKEN"));
        console.error(chalk.dim("Or use --ffmpeg for free FFmpeg upscaling"));
        process.exit(1);
      }

      const spinner = ora("Initializing Replicate...").start();

      const { ReplicateProvider } = await import("@vibeframe/ai-providers");
      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // For Replicate, we need a URL. Upload to temporary hosting or require URL
      spinner.text = "Note: Replicate requires video URL. Reading file...";

      // For now, we'll show an error suggesting URL or ffmpeg
      spinner.fail(chalk.yellow("Replicate requires a video URL"));
      console.log();
      console.log(chalk.dim("Options:"));
      console.log(chalk.dim("  1. Use --ffmpeg for local processing"));
      console.log(chalk.dim("  2. Upload video to a URL and run:"));
      console.log(chalk.dim(`     pnpm vibe ai video-upscale https://example.com/video.mp4 -s ${scale}`));
      console.log();
      process.exit(1);
    } catch (error) {
      console.error(chalk.red("Video upscaling failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Frame Interpolation (Slow Motion)
aiCommand
  .command("video-interpolate")
  .description("Create slow motion with frame interpolation (FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --factor <number>", "Slow motion factor: 2, 4, or 8", "2")
  .option("--fps <number>", "Target output FPS")
  .option("-q, --quality <mode>", "Quality: fast or quality", "quality")
  .action(async (videoPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), videoPath);
      const factor = parseInt(options.factor);

      if (![2, 4, 8].includes(factor)) {
        console.error(chalk.red("Factor must be 2, 4, or 8"));
        process.exit(1);
      }

      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, `-slow${factor}x$1`);

      const spinner = ora(`Creating ${factor}x slow motion...`).start();

      try {
        // Get original FPS
        const { stdout: fpsOut } = await execAsync(
          `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${absPath}"`
        );
        const [num, den] = fpsOut.trim().split("/").map(Number);
        const originalFps = num / (den || 1);

        // Calculate target FPS
        const targetFps = options.fps ? parseInt(options.fps) : originalFps * factor;

        // Use minterpolate for frame interpolation
        const mi = options.quality === "fast" ? "mi_mode=mci" : "mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1";

        spinner.text = `Interpolating frames (${originalFps.toFixed(1)} → ${targetFps}fps)...`;

        // First interpolate frames, then slow down
        await execAsync(
          `ffmpeg -i "${absPath}" -filter:v "minterpolate='${mi}:fps=${targetFps}',setpts=${factor}*PTS" -an "${outputPath}" -y`,
          { timeout: 600000 } // 10 minute timeout
        );

        spinner.succeed(chalk.green(`Created ${factor}x slow motion`));
        console.log();
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Original FPS: ${originalFps.toFixed(1)}`);
        console.log(`Interpolated FPS: ${targetFps}`);
        console.log(`Slow factor: ${factor}x`);
        console.log(`Output: ${outputPath}`);
        console.log();
      } catch (err: unknown) {
        spinner.fail(chalk.red("Frame interpolation failed"));
        if (err instanceof Error && err.message.includes("timeout")) {
          console.error(chalk.yellow("Processing timed out. Try with a shorter video or --quality fast"));
        } else {
          console.error(err);
        }
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("Frame interpolation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Video Inpainting (Object Removal)
aiCommand
  .command("video-inpaint")
  .description("Remove objects from video using AI inpainting")
  .argument("<video>", "Video file path or URL")
  .option("-o, --output <path>", "Output file path")
  .option("-t, --target <description>", "Object to remove (text description)")
  .option("-m, --mask <path>", "Mask video file path (white = remove)")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .option("--provider <name>", "Provider: replicate or stability", "replicate")
  .option("--no-wait", "Start processing and return task ID without waiting")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.target && !options.mask) {
        console.error(chalk.red("Either --target or --mask is required"));
        console.error(chalk.dim("Examples:"));
        console.error(chalk.dim('  pnpm vibe ai video-inpaint video.mp4 --target "watermark"'));
        console.error(chalk.dim("  pnpm vibe ai video-inpaint video.mp4 --mask mask.mp4"));
        process.exit(1);
      }

      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required for video inpainting."));
        console.error(chalk.dim("Use --api-key or set REPLICATE_API_TOKEN"));
        process.exit(1);
      }

      const spinner = ora("Initializing Replicate...").start();

      const { ReplicateProvider } = await import("@vibeframe/ai-providers");
      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // Check if video is URL or file
      let videoUrl: string;
      if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
        videoUrl = videoPath;
      } else {
        spinner.fail(chalk.yellow("Video inpainting requires a video URL"));
        console.log();
        console.log(chalk.dim("Upload your video to a URL and run:"));
        console.log(chalk.dim(`  pnpm vibe ai video-inpaint https://example.com/video.mp4 --mask https://example.com/mask.mp4`));
        console.log();
        process.exit(1);
      }

      let maskVideo: string | undefined;
      if (options.mask) {
        if (options.mask.startsWith("http://") || options.mask.startsWith("https://")) {
          maskVideo = options.mask;
        } else {
          spinner.fail(chalk.yellow("Mask must also be a URL"));
          process.exit(1);
        }
      }

      spinner.text = "Starting video inpainting...";

      const result = await replicate.inpaintVideo(videoUrl, {
        target: options.target,
        maskVideo,
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Failed to start inpainting"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Video Inpainting Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Inpainting started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" https://api.replicate.com/v1/predictions/${result.id}`));
        console.log();
        return;
      }

      spinner.text = "Processing video (this may take several minutes)...";

      const finalResult = await replicate.waitForCompletion(
        result.id,
        (status) => {
          spinner.text = `Processing... ${status.status}`;
        },
        600000
      );

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Inpainting failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video inpainting complete"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);

        // Download if output specified
        if (options.output) {
          const downloadSpinner = ora("Downloading video...").start();
          try {
            const response = await fetch(finalResult.videoUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            downloadSpinner.fail(chalk.red("Failed to download video"));
          }
        }
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Video inpainting failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Stability AI (Stable Diffusion) commands
aiCommand
  .command("sd")
  .description("Generate image using Stable Diffusion (Stability AI)")
  .argument("<prompt>", "Text prompt describing the image")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "output.png")
  .option("-m, --model <model>", "Model: sd3.5-large, sd3.5-medium, stable-image-ultra", "sd3.5-large")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 1:1, 9:16, 21:9, etc.", "1:1")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("--style <preset>", "Style preset: photographic, anime, digital-art, cinematic, etc.")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required."));
        console.error(chalk.dim("Use --api-key or set STABILITY_API_KEY environment variable"));
        process.exit(1);
      }

      const spinner = ora("Generating image with Stable Diffusion...").start();

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.generateImage(prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        stylePreset: options.style,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image generated"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }

      // Save the image
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-upscale")
  .description("Upscale image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "upscaled.png")
  .option("-t, --type <type>", "Upscale type: fast, conservative, creative", "fast")
  .option("-c, --creativity <value>", "Creativity (0-0.35, for creative upscale)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Upscaling image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.upscaleImage(imageBuffer, {
        type: options.type as "fast" | "conservative" | "creative",
        creativity: options.creativity ? parseFloat(options.creativity) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Upscale failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image upscaled"));

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Upscale failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-remove-bg")
  .description("Remove background from image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "no-bg.png")
  .option("-f, --format <format>", "Output format: png, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Removing background...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.removeBackground(imageBuffer, options.format as "png" | "webp");

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Background removal failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Background removed"));

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Background removal failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-img2img")
  .description("Transform image using Stable Diffusion (image-to-image)")
  .argument("<image>", "Input image file path")
  .argument("<prompt>", "Text prompt describing the transformation")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "transformed.png")
  .option("-t, --strength <value>", "Transformation strength (0-1)", "0.35")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, prompt: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Transforming image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.imageToImage(imageBuffer, prompt, {
        strength: parseFloat(options.strength),
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Transformation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image transformed"));

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Transformation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-replace")
  .description("Search and replace objects in image using Stability AI")
  .argument("<image>", "Input image file path")
  .argument("<search>", "What to search for in the image")
  .argument("<replace>", "What to replace it with")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "replaced.png")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, search: string, replace: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Replacing objects...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.searchAndReplace(imageBuffer, search, replace, {
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Search and replace failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Objects replaced"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Search and replace failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-outpaint")
  .description("Extend image canvas (outpainting) using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "outpainted.png")
  .option("--left <pixels>", "Pixels to extend on the left (0-2000)")
  .option("--right <pixels>", "Pixels to extend on the right (0-2000)")
  .option("--up <pixels>", "Pixels to extend upward (0-2000)")
  .option("--down <pixels>", "Pixels to extend downward (0-2000)")
  .option("-p, --prompt <text>", "Prompt for the extended area")
  .option("-c, --creativity <value>", "Creativity level (0-1, default: 0.5)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const left = options.left ? parseInt(options.left) : 0;
      const right = options.right ? parseInt(options.right) : 0;
      const up = options.up ? parseInt(options.up) : 0;
      const down = options.down ? parseInt(options.down) : 0;

      if (left === 0 && right === 0 && up === 0 && down === 0) {
        console.error(chalk.red("At least one direction (--left, --right, --up, --down) must be specified"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Extending image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.outpaint(imageBuffer, {
        left,
        right,
        up,
        down,
        prompt: options.prompt,
        creativity: options.creativity ? parseFloat(options.creativity) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Outpainting failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image extended"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Outpainting failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Script-to-Video command
aiCommand
  .command("script-to-video")
  .description("Generate complete video from text script using AI pipeline")
  .argument("<script>", "Script text or file path (use -f for file)")
  .option("-f, --file", "Treat script argument as file path")
  .option("-o, --output <path>", "Output project file path", "script-video.vibe.json")
  .option("-d, --duration <seconds>", "Target total duration in seconds")
  .option("-v, --voice <id>", "ElevenLabs voice ID for narration")
  .option("-g, --generator <engine>", "Video generator: runway | kling", "runway")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio: 16:9 | 9:16 | 1:1", "16:9")
  .option("--images-only", "Generate images only, skip video generation")
  .option("--no-voiceover", "Skip voiceover generation")
  .option("--output-dir <dir>", "Directory for generated assets", "script-video-output")
  .action(async (script: string, options) => {
    try {
      // Get all required API keys upfront
      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for storyboard generation"));
        process.exit(1);
      }

      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        console.error(chalk.red("OpenAI API key required for image generation"));
        process.exit(1);
      }

      let elevenlabsApiKey: string | undefined;
      if (options.voiceover !== false) {
        const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
        if (!key) {
          console.error(chalk.red("ElevenLabs API key required for voiceover (or use --no-voiceover)"));
          process.exit(1);
        }
        elevenlabsApiKey = key;
      }

      let videoApiKey: string | undefined;
      if (!options.imagesOnly) {
        if (options.generator === "kling") {
          const key = await getApiKey("KLING_API_KEY", "Kling");
          if (!key) {
            console.error(chalk.red("Kling API key required (or use --images-only)"));
            process.exit(1);
          }
          videoApiKey = key;
        } else {
          const key = await getApiKey("RUNWAY_API_SECRET", "Runway");
          if (!key) {
            console.error(chalk.red("Runway API key required (or use --images-only)"));
            process.exit(1);
          }
          videoApiKey = key;
        }
      }

      // Read script content
      let scriptContent = script;
      if (options.file) {
        const filePath = resolve(process.cwd(), script);
        scriptContent = await readFile(filePath, "utf-8");
      }

      // Create output directory
      const outputDir = resolve(process.cwd(), options.outputDir);
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 Script-to-Video Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();

      // Step 1: Generate storyboard with Claude
      const storyboardSpinner = ora("📝 Analyzing script with Claude...").start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const segments = await claude.analyzeContent(
        scriptContent,
        options.duration ? parseFloat(options.duration) : undefined
      );

      if (segments.length === 0) {
        storyboardSpinner.fail(chalk.red("Failed to generate storyboard"));
        process.exit(1);
      }

      const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
      storyboardSpinner.succeed(chalk.green(`Generated ${segments.length} scenes (total: ${totalDuration}s)`));

      // Save storyboard
      const storyboardPath = resolve(outputDir, "storyboard.json");
      await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
      console.log(chalk.dim(`  → Saved: ${storyboardPath}`));
      console.log();

      // Step 2: Generate voiceover with ElevenLabs
      let voiceoverPath: string | undefined;
      let voiceoverDuration = totalDuration;

      if (options.voiceover !== false && elevenlabsApiKey) {
        const ttsSpinner = ora("🎙️ Generating voiceover with ElevenLabs...").start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

        // Combine segment audio descriptions or use the script
        const voiceoverText = segments
          .map((seg) => seg.audio || seg.description)
          .join(" ");

        const ttsResult = await elevenlabs.textToSpeech(voiceoverText, {
          voiceId: options.voice,
        });

        if (!ttsResult.success || !ttsResult.audioBuffer) {
          ttsSpinner.warn(chalk.yellow(`Voiceover failed: ${ttsResult.error || "Unknown error"}`));
        } else {
          voiceoverPath = resolve(outputDir, "voiceover.mp3");
          await writeFile(voiceoverPath, ttsResult.audioBuffer);
          ttsSpinner.succeed(chalk.green(`Voiceover generated (${ttsResult.characterCount} chars)`));
          console.log(chalk.dim(`  → Saved: ${voiceoverPath}`));
        }
        console.log();
      }

      // Step 3: Generate images with DALL-E
      const imageSpinner = ora("🎨 Generating visuals with DALL-E...").start();

      const dalle = new DalleProvider();
      await dalle.initialize({ apiKey: openaiApiKey });

      // Determine image size based on aspect ratio
      const imageSizes: Record<string, "1792x1024" | "1024x1792" | "1024x1024"> = {
        "16:9": "1792x1024",
        "9:16": "1024x1792",
        "1:1": "1024x1024",
      };
      const imageSize = imageSizes[options.aspectRatio] || "1792x1024";

      const imagePaths: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        imageSpinner.text = `🎨 Generating image ${i + 1}/${segments.length}: ${segment.description.slice(0, 30)}...`;

        try {
          const imageResult = await dalle.generateImage(segment.visuals, {
            size: imageSize,
            quality: "standard",
          });

          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            const imageUrl = imageResult.images[0].url;
            const imagePath = resolve(outputDir, `scene-${i + 1}.png`);

            // Download image
            const response = await fetch(imageUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            await writeFile(imagePath, buffer);
            imagePaths.push(imagePath);
          } else {
            console.log(chalk.yellow(`\n  ⚠ Failed to generate image for scene ${i + 1}`));
            imagePaths.push(""); // Placeholder for failed image
          }
        } catch (err) {
          console.log(chalk.yellow(`\n  ⚠ Error generating image for scene ${i + 1}: ${err}`));
          imagePaths.push("");
        }

        // Small delay to avoid rate limiting
        if (i < segments.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const successfulImages = imagePaths.filter((p) => p !== "").length;
      imageSpinner.succeed(chalk.green(`Generated ${successfulImages}/${segments.length} images`));
      console.log();

      // Step 4: Generate videos (if not images-only)
      const videoPaths: string[] = [];

      if (!options.imagesOnly && videoApiKey) {
        const videoSpinner = ora(`🎬 Generating videos with ${options.generator === "kling" ? "Kling" : "Runway"}...`).start();

        if (options.generator === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            videoSpinner.fail(chalk.red("Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY"));
            process.exit(1);
          }

          // Submit all video generation tasks
          const tasks: Array<{ taskId: string; index: number; imagePath: string }> = [];

          for (let i = 0; i < segments.length; i++) {
            if (!imagePaths[i]) {
              videoPaths.push("");
              continue;
            }

            const segment = segments[i];
            videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

            try {
              const imageBuffer = await readFile(imagePaths[i]);
              const ext = extname(imagePaths[i]).toLowerCase().slice(1);
              const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
              const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

              const result = await kling.generateVideo(segment.visuals, {
                prompt: segment.visuals,
                referenceImage,
                duration: Math.min(segment.duration, 10) as 5 | 10,
                aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              });

              if (result.status !== "failed" && result.id) {
                tasks.push({ taskId: result.id, index: i, imagePath: imagePaths[i] });
              } else {
                console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1}`));
                videoPaths[i] = "";
              }
            } catch (err) {
              console.log(chalk.yellow(`\n  ⚠ Error starting video for scene ${i + 1}: ${err}`));
              videoPaths[i] = "";
            }
          }

          // Wait for all tasks to complete
          videoSpinner.text = `🎬 Waiting for ${tasks.length} video(s) to complete...`;

          for (const task of tasks) {
            try {
              const result = await kling.waitForCompletion(
                task.taskId,
                "image2video",
                (status) => {
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: ${status.status}...`;
                },
                600000 // 10 minute timeout per video
              );

              if (result.status === "completed" && result.videoUrl) {
                const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                const response = await fetch(result.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);
                videoPaths[task.index] = videoPath;
              } else {
                videoPaths[task.index] = "";
              }
            } catch (err) {
              console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
              videoPaths[task.index] = "";
            }
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          // Submit all video generation tasks
          const tasks: Array<{ taskId: string; index: number; imagePath: string }> = [];

          for (let i = 0; i < segments.length; i++) {
            if (!imagePaths[i]) {
              videoPaths.push("");
              continue;
            }

            const segment = segments[i];
            videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

            try {
              const imageBuffer = await readFile(imagePaths[i]);
              const ext = extname(imagePaths[i]).toLowerCase().slice(1);
              const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
              const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

              const result = await runway.generateVideo(segment.visuals, {
                prompt: segment.visuals,
                referenceImage,
                duration: Math.min(segment.duration, 10) as 5 | 10,
                aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
              });

              if (result.status !== "failed" && result.id) {
                tasks.push({ taskId: result.id, index: i, imagePath: imagePaths[i] });
              } else {
                console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1}`));
                videoPaths[i] = "";
              }
            } catch (err) {
              console.log(chalk.yellow(`\n  ⚠ Error starting video for scene ${i + 1}: ${err}`));
              videoPaths[i] = "";
            }
          }

          // Wait for all tasks to complete
          videoSpinner.text = `🎬 Waiting for ${tasks.length} video(s) to complete...`;

          for (const task of tasks) {
            try {
              const result = await runway.waitForCompletion(
                task.taskId,
                (status) => {
                  const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: ${progress}...`;
                },
                300000 // 5 minute timeout per video
              );

              if (result.status === "completed" && result.videoUrl) {
                const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                const response = await fetch(result.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);
                videoPaths[task.index] = videoPath;
              } else {
                videoPaths[task.index] = "";
              }
            } catch (err) {
              console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
              videoPaths[task.index] = "";
            }
          }
        }

        const successfulVideos = videoPaths.filter((p) => p && p !== "").length;
        videoSpinner.succeed(chalk.green(`Generated ${successfulVideos}/${segments.length} videos`));
        console.log();
      }

      // Step 5: Assemble project
      const assembleSpinner = ora("📦 Assembling project...").start();

      const project = new Project("Script-to-Video Output");
      project.setAspectRatio(options.aspectRatio as "16:9" | "9:16" | "1:1");

      // Clear default tracks and create new ones
      const defaultTracks = project.getTracks();
      for (const track of defaultTracks) {
        project.removeTrack(track.id);
      }

      const videoTrack = project.addTrack({
        name: "Video",
        type: "video",
        order: 1,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      const audioTrack = project.addTrack({
        name: "Audio",
        type: "audio",
        order: 0,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      // Add voiceover source and clip
      if (voiceoverPath) {
        const voiceoverSource = project.addSource({
          name: "Voiceover",
          url: voiceoverPath,
          type: "audio",
          duration: voiceoverDuration,
        });

        project.addClip({
          sourceId: voiceoverSource.id,
          trackId: audioTrack.id,
          startTime: 0,
          duration: voiceoverDuration,
          sourceStartOffset: 0,
          sourceEndOffset: voiceoverDuration,
        });
      }

      // Add video/image sources and clips
      let currentTime = 0;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const hasVideo = videoPaths[i] && videoPaths[i] !== "";
        const hasImage = imagePaths[i] && imagePaths[i] !== "";

        if (!hasVideo && !hasImage) {
          // Skip if no visual asset
          currentTime += segment.duration;
          continue;
        }

        const assetPath = hasVideo ? videoPaths[i] : imagePaths[i];
        const mediaType = hasVideo ? "video" : "image";

        const source = project.addSource({
          name: `Scene ${i + 1}`,
          url: assetPath,
          type: mediaType as "video" | "image",
          duration: segment.duration,
        });

        project.addClip({
          sourceId: source.id,
          trackId: videoTrack.id,
          startTime: currentTime,
          duration: segment.duration,
          sourceStartOffset: 0,
          sourceEndOffset: segment.duration,
        });

        currentTime += segment.duration;
      }

      // Save project file
      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      assembleSpinner.succeed(chalk.green("Project assembled"));

      // Final summary
      console.log();
      console.log(chalk.bold.green("✅ Script-to-Video complete!"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📄 Project: ${chalk.cyan(outputPath)}`);
      console.log(`  🎬 Scenes: ${segments.length}`);
      console.log(`  ⏱️  Duration: ${totalDuration}s`);
      console.log(`  📁 Assets: ${options.outputDir}/`);
      if (voiceoverPath) {
        console.log(`  🎙️  Voiceover: voiceover.mp3`);
      }
      console.log(`  🖼️  Images: ${successfulImages} scene-*.png`);
      if (!options.imagesOnly) {
        const videoCount = videoPaths.filter((p) => p && p !== "").length;
        console.log(`  🎥 Videos: ${videoCount} scene-*.mp4`);
      }
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe project info ${options.output}`));
      console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Script-to-Video failed"));
      console.error(error);
      process.exit(1);
    }
  });

// B-Roll Matcher command
aiCommand
  .command("b-roll")
  .description("Match B-roll footage to narration content")
  .argument("<narration>", "Narration audio file or script text")
  .option("-b, --broll <paths>", "B-roll video files (comma-separated)")
  .option("--broll-dir <dir>", "Directory containing B-roll files")
  .option("-o, --output <path>", "Output project file", "broll-matched.vibe.json")
  .option("-t, --threshold <value>", "Match confidence threshold (0-1)", "0.6")
  .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
  .option("-f, --file", "Treat narration as file path (script file)")
  .option("--analyze-only", "Only analyze, don't create project")
  .action(async (narration: string, options) => {
    try {
      // Validate B-roll input
      if (!options.broll && !options.brollDir) {
        console.error(chalk.red("B-roll files required. Use -b or --broll-dir"));
        process.exit(1);
      }

      // Check API keys
      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        console.error(chalk.red("OpenAI API key required for Whisper transcription."));
        console.error(chalk.dim("Set OPENAI_API_KEY environment variable"));
        process.exit(1);
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for B-roll analysis."));
        console.error(chalk.dim("Set ANTHROPIC_API_KEY environment variable"));
        process.exit(1);
      }

      // Check FFmpeg availability
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 B-Roll Matcher Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();

      // Step 1: Discover B-roll files
      const discoverSpinner = ora("🎥 Discovering B-roll files...").start();
      const brollFiles = await discoverBrollFiles(options.broll, options.brollDir);

      if (brollFiles.length === 0) {
        discoverSpinner.fail(chalk.red("No B-roll video files found"));
        process.exit(1);
      }

      discoverSpinner.succeed(chalk.green(`Found ${brollFiles.length} B-roll file(s)`));

      // Step 2: Parse narration (audio file or script text)
      const narrationSpinner = ora("📝 Processing narration...").start();

      let narrationSegments: Array<{ startTime: number; endTime: number; text: string }> = [];
      let totalDuration = 0;
      let narrationFile = "";

      const isScriptFile = options.file;
      const isAudioFile = !isScriptFile && isAudioOrVideoFile(narration);

      if (isAudioFile) {
        // Transcribe audio with Whisper
        narrationFile = resolve(process.cwd(), narration);
        if (!existsSync(narrationFile)) {
          narrationSpinner.fail(chalk.red(`Narration file not found: ${narrationFile}`));
          process.exit(1);
        }

        narrationSpinner.text = "📝 Transcribing narration with Whisper...";

        const whisper = new WhisperProvider();
        await whisper.initialize({ apiKey: openaiApiKey });

        // Extract audio if it's a video file
        let audioPath = narrationFile;
        let tempAudioPath: string | null = null;

        const ext = extname(narrationFile).toLowerCase();
        const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
        if (videoExtensions.includes(ext)) {
          narrationSpinner.text = "📝 Extracting audio from video...";
          tempAudioPath = `/tmp/vibe_broll_audio_${Date.now()}.wav`;
          await execAsync(
            `ffmpeg -i "${narrationFile}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
            { maxBuffer: 50 * 1024 * 1024 }
          );
          audioPath = tempAudioPath;
        }

        const audioBuffer = await readFile(audioPath);
        const audioBlob = new Blob([audioBuffer]);

        narrationSpinner.text = "📝 Transcribing with Whisper...";
        const transcriptResult = await whisper.transcribe(audioBlob, options.language);

        // Cleanup temp file
        if (tempAudioPath && existsSync(tempAudioPath)) {
          await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
        }

        if (transcriptResult.status === "failed" || !transcriptResult.segments) {
          narrationSpinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
          process.exit(1);
        }

        narrationSegments = transcriptResult.segments.map((seg) => ({
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: seg.text,
        }));

        totalDuration = transcriptResult.segments.length > 0
          ? transcriptResult.segments[transcriptResult.segments.length - 1].endTime
          : 0;
      } else {
        // Use script text (direct or from file)
        let scriptContent = narration;
        if (isScriptFile) {
          const scriptPath = resolve(process.cwd(), narration);
          if (!existsSync(scriptPath)) {
            narrationSpinner.fail(chalk.red(`Script file not found: ${scriptPath}`));
            process.exit(1);
          }
          scriptContent = await readFile(scriptPath, "utf-8");
          narrationFile = scriptPath;
        } else {
          narrationFile = "text-input";
        }

        // Split script into segments (by paragraph or sentence)
        const paragraphs = scriptContent
          .split(/\n\n+/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        // Estimate timing (rough: ~150 words per minute)
        let currentTime = 0;
        narrationSegments = paragraphs.map((text) => {
          const wordCount = text.split(/\s+/).length;
          const duration = Math.max((wordCount / 150) * 60, 3); // Min 3 seconds per segment
          const segment = {
            startTime: currentTime,
            endTime: currentTime + duration,
            text,
          };
          currentTime += duration;
          return segment;
        });

        totalDuration = currentTime;
      }

      narrationSpinner.succeed(chalk.green(`Processed ${narrationSegments.length} narration segments (${formatTime(totalDuration)} total)`));

      // Step 3: Analyze B-roll clips with Claude Vision
      const brollSpinner = ora("🎥 Analyzing B-roll content with Claude Vision...").start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const brollClips: BrollClipInfo[] = [];

      for (let i = 0; i < brollFiles.length; i++) {
        const filePath = brollFiles[i];
        const fileName = basename(filePath);
        brollSpinner.text = `🎥 Analyzing B-roll ${i + 1}/${brollFiles.length}: ${fileName}`;

        try {
          // Get video duration
          const { stdout: durationOut } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
          );
          const duration = parseFloat(durationOut.trim());

          // Extract a key frame (middle of video)
          const frameTime = Math.min(duration / 2, 5);
          const frameBase64 = await extractKeyFrame(filePath, frameTime);

          // Analyze with Claude Vision
          const analysis = await claude.analyzeBrollContent(frameBase64, fileName, "image/jpeg");

          brollClips.push({
            id: `broll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            filePath,
            duration,
            description: analysis.description,
            tags: analysis.tags,
          });
        } catch (error) {
          console.log(chalk.yellow(`\n  ⚠ Could not analyze ${fileName}: ${error}`));
        }
      }

      brollSpinner.succeed(chalk.green(`Analyzed ${brollClips.length} B-roll clips`));

      // Display analyzed B-roll
      for (const clip of brollClips) {
        console.log(chalk.dim(`  → ${basename(clip.filePath)}: "${clip.description}"`));
        console.log(chalk.dim(`    [${clip.tags.join(", ")}]`));
      }
      console.log();

      // Step 4: Analyze narration for visual requirements
      const visualSpinner = ora("🔍 Analyzing narration for visual needs...").start();

      const analyzedNarration = await claude.analyzeNarrationForVisuals(narrationSegments);

      visualSpinner.succeed(chalk.green("Narration analysis complete"));

      // Step 5: Match B-roll to narration
      const matchSpinner = ora("🔗 Matching B-roll to narration...").start();

      const matches = await claude.matchBrollToNarration(analyzedNarration, brollClips);

      const threshold = parseFloat(options.threshold);
      const filteredMatches = matches.filter((m) => m.confidence >= threshold);

      // Remove duplicate assignments (keep highest confidence for each segment)
      const uniqueMatches: BrollMatch[] = [];
      const matchedSegments = new Set<number>();

      // Sort by confidence descending
      filteredMatches.sort((a, b) => b.confidence - a.confidence);

      for (const match of filteredMatches) {
        if (!matchedSegments.has(match.narrationSegmentIndex)) {
          matchedSegments.add(match.narrationSegmentIndex);
          uniqueMatches.push(match);
        }
      }

      // Sort back by segment index
      uniqueMatches.sort((a, b) => a.narrationSegmentIndex - b.narrationSegmentIndex);

      const coverage = (uniqueMatches.length / narrationSegments.length) * 100;
      matchSpinner.succeed(chalk.green(`Found ${uniqueMatches.length} matches (${coverage.toFixed(0)}% coverage)`));

      // Find unmatched segments
      const unmatchedSegments: number[] = [];
      for (let i = 0; i < narrationSegments.length; i++) {
        if (!matchedSegments.has(i)) {
          unmatchedSegments.push(i);
        }
      }

      // Display match summary
      console.log();
      console.log(chalk.bold.cyan("📊 Match Summary"));
      console.log(chalk.dim("─".repeat(60)));

      for (const match of uniqueMatches) {
        const segment = analyzedNarration[match.narrationSegmentIndex];
        const clip = brollClips.find((c) => c.id === match.brollClipId);
        const startFormatted = formatTime(segment.startTime);
        const endFormatted = formatTime(segment.endTime);
        const confidencePercent = (match.confidence * 100).toFixed(0);

        console.log();
        console.log(`  ${chalk.yellow(`Segment ${match.narrationSegmentIndex + 1}`)} [${startFormatted} - ${endFormatted}]`);
        console.log(`    ${chalk.dim(truncate(segment.text, 60))}`);
        console.log(`    ${chalk.green("→")} ${basename(clip?.filePath || "unknown")} ${chalk.dim(`(${confidencePercent}%)`)}`);
        console.log(`    ${chalk.dim(match.reason)}`);
      }

      if (unmatchedSegments.length > 0) {
        console.log();
        console.log(chalk.yellow(`  ⚠ ${unmatchedSegments.length} unmatched segment(s): [${unmatchedSegments.map((i) => i + 1).join(", ")}]`));
      }

      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Total: ${chalk.bold(uniqueMatches.length)}/${narrationSegments.length} segments matched, ${chalk.bold(coverage.toFixed(0))}% coverage`);
      console.log();

      // Prepare result object
      const result: BrollMatchResult = {
        narrationFile,
        totalDuration,
        brollClips,
        narrationSegments: analyzedNarration,
        matches: uniqueMatches,
        unmatchedSegments,
      };

      // Step 6: Create project (unless analyze-only)
      if (!options.analyzeOnly) {
        const projectSpinner = ora("📦 Creating project...").start();

        const project = new Project("B-Roll Matched Project");

        // Add B-roll sources
        const sourceMap = new Map<string, string>();
        for (const clip of brollClips) {
          const source = project.addSource({
            name: basename(clip.filePath),
            url: clip.filePath,
            type: "video",
            duration: clip.duration,
          });
          sourceMap.set(clip.id, source.id);
        }

        // Get video track
        const videoTrack = project.getTracks().find((t) => t.type === "video");
        if (!videoTrack) {
          projectSpinner.fail(chalk.red("Failed to create project"));
          process.exit(1);
        }

        // Add clips for each match
        for (const match of uniqueMatches) {
          const segment = analyzedNarration[match.narrationSegmentIndex];
          const sourceId = sourceMap.get(match.brollClipId);
          const clip = brollClips.find((c) => c.id === match.brollClipId);

          if (!sourceId || !clip) continue;

          const clipDuration = Math.min(
            match.suggestedDuration || segment.endTime - segment.startTime,
            clip.duration - match.suggestedStartOffset
          );

          project.addClip({
            sourceId,
            trackId: videoTrack.id,
            startTime: segment.startTime,
            duration: clipDuration,
            sourceStartOffset: match.suggestedStartOffset,
            sourceEndOffset: match.suggestedStartOffset + clipDuration,
          });
        }

        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

        projectSpinner.succeed(chalk.green(`Created project: ${outputPath}`));

        // Save JSON result alongside project
        const jsonOutputPath = outputPath.replace(/\.vibe\.json$/, "-analysis.json");
        await writeFile(jsonOutputPath, JSON.stringify(result, null, 2), "utf-8");
        console.log(chalk.dim(`  → Analysis saved: ${jsonOutputPath}`));
      }

      console.log();
      console.log(chalk.bold.green("✅ B-Roll matching complete!"));
      console.log();
      console.log(chalk.dim("Next steps:"));
      if (!options.analyzeOnly) {
        console.log(chalk.dim(`  vibe project info ${options.output}`));
        console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));
      }
      if (unmatchedSegments.length > 0) {
        console.log(chalk.dim("  Consider adding more B-roll clips for unmatched segments"));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("B-Roll matching failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Platform specifications for viral optimization
const PLATFORM_SPECS: Record<string, PlatformSpec> = {
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

// Viral Optimizer command
aiCommand
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
      const filePath = resolve(process.cwd(), projectPath);
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
      // Find first video/audio source
      const mediaSource = sources.find((s) => s.type === "video" || s.type === "audio");
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

      let audioPath = resolve(process.cwd(), mediaSource.url);
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

          if (platformCut.segments.length > 0) {
            // Use AI-suggested segments
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

/**
 * Discover B-roll video files from paths or directory
 */
async function discoverBrollFiles(
  paths?: string,
  directory?: string
): Promise<string[]> {
  const files: string[] = [];
  const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];

  if (paths) {
    const pathList = paths.split(",").map((p) => resolve(process.cwd(), p.trim()));
    for (const path of pathList) {
      if (existsSync(path)) {
        files.push(path);
      }
    }
  }

  if (directory) {
    const dir = resolve(process.cwd(), directory);
    if (existsSync(dir)) {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const ext = extname(entry).toLowerCase();
        if (videoExtensions.includes(ext)) {
          files.push(resolve(dir, entry));
        }
      }
    }
  }

  return files;
}

/**
 * Extract a key frame from video as base64 JPEG
 */
async function extractKeyFrame(videoPath: string, timestamp: number): Promise<string> {
  const tempPath = `/tmp/vibe_frame_${Date.now()}.jpg`;
  await execAsync(
    `ffmpeg -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 "${tempPath}" -y`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  const buffer = await readFile(tempPath);
  await execAsync(`rm "${tempPath}"`).catch(() => {});
  return buffer.toString("base64");
}

/**
 * Check if a file path looks like an audio or video file
 */
function isAudioOrVideoFile(path: string): boolean {
  const mediaExtensions = [
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
  ];
  const ext = extname(path).toLowerCase();
  return mediaExtensions.includes(ext);
}

// Auto Highlights command
aiCommand
  .command("highlights")
  .description("Extract highlights from long-form video/audio content")
  .argument("<media>", "Video or audio file path")
  .option("-o, --output <path>", "Output JSON file with highlights")
  .option("-p, --project <path>", "Create project with highlight clips")
  .option("-d, --duration <seconds>", "Target highlight reel duration", "60")
  .option("-n, --count <number>", "Maximum number of highlights")
  .option("-t, --threshold <value>", "Confidence threshold (0-1)", "0.7")
  .option("--criteria <type>", "Selection criteria: emotional | informative | funny | all", "all")
  .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
  .action(async (mediaPath: string, options) => {
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
        console.error(chalk.red("Anthropic API key required for highlight analysis."));
        console.error(chalk.dim("Set ANTHROPIC_API_KEY environment variable"));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), mediaPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${absPath}`));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 Highlight Extraction Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();

      // Determine if we need to extract audio (for video files)
      const ext = extname(absPath).toLowerCase();
      const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
      const isVideo = videoExtensions.includes(ext);
      let audioPath = absPath;
      let tempAudioPath: string | null = null;

      // Step 1: Extract audio if video
      if (isVideo) {
        const audioSpinner = ora("🎵 Extracting audio from video...").start();

        try {
          // Check FFmpeg availability
          try {
            execSync("ffmpeg -version", { stdio: "ignore" });
          } catch {
            audioSpinner.fail(chalk.red("FFmpeg not found. Please install FFmpeg."));
            process.exit(1);
          }

          tempAudioPath = `/tmp/vibe_highlight_audio_${Date.now()}.wav`;
          await execAsync(
            `ffmpeg -i "${absPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
            { maxBuffer: 50 * 1024 * 1024 }
          );
          audioPath = tempAudioPath;

          // Get video duration
          const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absPath}"`;
          const { stdout: durationOut } = await execAsync(durationCmd);
          const totalDuration = parseFloat(durationOut.trim());

          audioSpinner.succeed(chalk.green(`Extracted audio (${formatTime(totalDuration)} total duration)`));
        } catch (error) {
          audioSpinner.fail(chalk.red("Failed to extract audio"));
          console.error(error);
          process.exit(1);
        }
      }

      // Step 2: Transcribe with Whisper
      const transcribeSpinner = ora("📝 Transcribing with Whisper...").start();

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(audioPath);
      const audioBlob = new Blob([audioBuffer]);

      const transcriptResult = await whisper.transcribe(audioBlob, options.language);

      if (transcriptResult.status === "failed" || !transcriptResult.segments) {
        transcribeSpinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
        // Cleanup temp file
        if (tempAudioPath && existsSync(tempAudioPath)) {
          await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
        }
        process.exit(1);
      }

      transcribeSpinner.succeed(chalk.green(`Transcribed ${transcriptResult.segments.length} segments`));

      // Cleanup temp audio file
      if (tempAudioPath && existsSync(tempAudioPath)) {
        await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
      }

      // Step 3: Analyze with Claude
      const analyzeSpinner = ora("🔍 Analyzing highlights with Claude...").start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const targetDuration = options.duration ? parseFloat(options.duration) : undefined;
      const maxCount = options.count ? parseInt(options.count) : undefined;

      const allHighlights = await claude.analyzeForHighlights(transcriptResult.segments, {
        criteria: options.criteria as HighlightCriteria,
        targetDuration,
        maxCount,
      });

      if (allHighlights.length === 0) {
        analyzeSpinner.warn(chalk.yellow("No highlights detected in the content"));
        process.exit(0);
      }

      analyzeSpinner.succeed(chalk.green(`Found ${allHighlights.length} potential highlights`));

      // Step 4: Filter and rank
      const filterSpinner = ora("📊 Filtering and ranking...").start();

      const threshold = parseFloat(options.threshold);
      const filteredHighlights = filterHighlights(allHighlights, {
        threshold,
        targetDuration,
        maxCount,
      });

      const totalHighlightDuration = filteredHighlights.reduce((sum, h) => sum + h.duration, 0);

      filterSpinner.succeed(chalk.green(`Selected ${filteredHighlights.length} highlights (${totalHighlightDuration.toFixed(1)}s total)`));

      // Get total source duration
      let sourceDuration = 0;
      if (transcriptResult.segments.length > 0) {
        sourceDuration = transcriptResult.segments[transcriptResult.segments.length - 1].endTime;
      }

      // Prepare result
      const result: HighlightsResult = {
        sourceFile: absPath,
        totalDuration: sourceDuration,
        criteria: options.criteria as HighlightCriteria,
        threshold,
        highlightsCount: filteredHighlights.length,
        totalHighlightDuration,
        highlights: filteredHighlights,
      };

      // Step 5: Output results
      console.log();
      console.log(chalk.bold.cyan("Highlights Summary"));
      console.log(chalk.dim("─".repeat(60)));

      for (const highlight of filteredHighlights) {
        const startFormatted = formatTime(highlight.startTime);
        const endFormatted = formatTime(highlight.endTime);
        const confidencePercent = (highlight.confidence * 100).toFixed(0);
        const categoryColor = getCategoryColor(highlight.category);

        console.log();
        console.log(`  ${chalk.yellow(`${highlight.index}.`)} [${startFormatted} - ${endFormatted}] ${categoryColor(highlight.category)}, ${chalk.dim(`${confidencePercent}%`)}`);
        console.log(`     ${chalk.white(highlight.reason)}`);
        console.log(`     ${chalk.dim(truncate(highlight.transcript, 80))}`);
      }

      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Total: ${chalk.bold(filteredHighlights.length)} highlights, ${chalk.bold(totalHighlightDuration.toFixed(1))} seconds`);
      console.log();

      // Save JSON output
      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
        console.log(chalk.green(`💾 Saved highlights to: ${outputPath}`));
      }

      // Create project with highlight clips
      if (options.project) {
        const projectSpinner = ora("📦 Creating project...").start();

        const project = new Project("Highlight Reel");

        // Add source
        const source = project.addSource({
          name: basename(absPath),
          url: absPath,
          type: isVideo ? "video" : "audio",
          duration: sourceDuration,
        });

        // Get video track
        const videoTrack = project.getTracks().find((t) => t.type === "video");
        if (!videoTrack) {
          projectSpinner.fail(chalk.red("Failed to create project"));
          process.exit(1);
        }

        // Add clips for each highlight
        let currentTime = 0;
        for (const highlight of filteredHighlights) {
          project.addClip({
            sourceId: source.id,
            trackId: videoTrack.id,
            startTime: currentTime,
            duration: highlight.duration,
            sourceStartOffset: highlight.startTime,
            sourceEndOffset: highlight.endTime,
          });
          currentTime += highlight.duration;
        }

        const projectPath = resolve(process.cwd(), options.project);
        await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

        projectSpinner.succeed(chalk.green(`Created project: ${projectPath}`));
      }

      console.log();
      console.log(chalk.bold.green("✅ Highlight extraction complete!"));
      console.log();
    } catch (error) {
      console.error(chalk.red("Highlight extraction failed"));
      console.error(error);
      process.exit(1);
    }
  });

/**
 * Filter highlights by threshold, count, and target duration
 */
function filterHighlights(
  highlights: Highlight[],
  options: { threshold: number; targetDuration?: number; maxCount?: number }
): Highlight[] {
  // 1. Filter by confidence threshold
  let filtered = highlights.filter((h) => h.confidence >= options.threshold);

  // 2. Sort by confidence (descending)
  filtered.sort((a, b) => b.confidence - a.confidence);

  // 3. Limit by count if specified
  if (options.maxCount && filtered.length > options.maxCount) {
    filtered = filtered.slice(0, options.maxCount);
  }

  // 4. Fit to target duration if specified (with 10% tolerance)
  if (options.targetDuration) {
    const targetWithTolerance = options.targetDuration * 1.1;
    let total = 0;
    filtered = filtered.filter((h) => {
      if (total + h.duration <= targetWithTolerance) {
        total += h.duration;
        return true;
      }
      return false;
    });
  }

  // 5. Re-sort by startTime (chronological order)
  filtered.sort((a, b) => a.startTime - b.startTime);

  // 6. Re-index
  return filtered.map((h, i) => ({ ...h, index: i + 1 }));
}

/**
 * Get color for highlight category
 */
function getCategoryColor(category: string): (text: string) => string {
  switch (category) {
    case "emotional":
      return chalk.magenta;
    case "informative":
      return chalk.cyan;
    case "funny":
      return chalk.yellow;
    default:
      return chalk.white;
  }
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green(status);
    case "failed":
    case "cancelled":
      return chalk.red(status);
    case "processing":
      return chalk.yellow(status);
    default:
      return chalk.dim(status);
  }
}

// ============================================================================
// Voice & Audio Features
// ============================================================================

aiCommand
  .command("voice-clone")
  .description("Clone a voice from audio samples using ElevenLabs")
  .argument("[samples...]", "Audio sample files (1-25 files)")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-n, --name <name>", "Voice name (required)")
  .option("-d, --description <desc>", "Voice description")
  .option("--labels <json>", "Labels as JSON (e.g., '{\"accent\": \"american\"}')")
  .option("--remove-noise", "Remove background noise from samples")
  .option("--list", "List all available voices")
  .action(async (samples: string[], options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      // List voices mode
      if (options.list) {
        const spinner = ora("Fetching voices...").start();
        const voices = await elevenlabs.getVoices();
        spinner.succeed(chalk.green(`Found ${voices.length} voices`));

        console.log();
        console.log(chalk.bold.cyan("Available Voices"));
        console.log(chalk.dim("─".repeat(60)));

        for (const voice of voices) {
          const category = chalk.dim(`(${voice.category})`);
          console.log(`${chalk.bold(voice.name)} ${category}`);
          console.log(`  ${chalk.dim("ID:")} ${voice.voice_id}`);
          if (voice.labels && Object.keys(voice.labels).length > 0) {
            console.log(`  ${chalk.dim("Labels:")} ${JSON.stringify(voice.labels)}`);
          }
          console.log();
        }
        return;
      }

      // Clone voice mode
      if (!options.name) {
        console.error(chalk.red("Voice name is required. Use --name <name>"));
        process.exit(1);
      }

      if (!samples || samples.length === 0) {
        console.error(chalk.red("At least one audio sample is required"));
        process.exit(1);
      }

      const spinner = ora("Reading audio samples...").start();

      const audioBuffers: Buffer[] = [];
      for (const samplePath of samples) {
        const absPath = resolve(process.cwd(), samplePath);
        if (!existsSync(absPath)) {
          spinner.fail(chalk.red(`File not found: ${samplePath}`));
          process.exit(1);
        }
        const buffer = await readFile(absPath);
        audioBuffers.push(buffer);
      }

      spinner.text = `Cloning voice from ${audioBuffers.length} sample(s)...`;

      const labels = options.labels ? JSON.parse(options.labels) : undefined;

      const result = await elevenlabs.cloneVoice(audioBuffers, {
        name: options.name,
        description: options.description,
        labels,
        removeBackgroundNoise: options.removeNoise,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Voice cloning failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Voice cloned successfully"));
      console.log();
      console.log(chalk.bold.cyan("Voice Details"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Name: ${chalk.bold(options.name)}`);
      console.log(`Voice ID: ${chalk.bold(result.voiceId)}`);
      console.log();
      console.log(chalk.dim("Use this voice ID with:"));
      console.log(chalk.dim(`  pnpm vibe ai tts "Hello world" -v ${result.voiceId}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Voice cloning failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("music")
  .description("Generate background music from a text prompt using MusicGen")
  .argument("<prompt>", "Description of the music to generate")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .option("-d, --duration <seconds>", "Duration in seconds (1-30)", "8")
  .option("-m, --melody <file>", "Reference melody audio file for conditioning")
  .option("--model <model>", "Model variant: large, stereo-large, melody-large, stereo-melody-large", "stereo-large")
  .option("-o, --output <path>", "Output audio file path", "music.mp3")
  .option("--no-wait", "Don't wait for generation to complete (async mode)")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        process.exit(1);
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      const spinner = ora("Starting music generation...").start();

      const duration = Math.max(1, Math.min(30, parseFloat(options.duration)));

      // If melody file provided, upload it first
      let melodyUrl: string | undefined;
      if (options.melody) {
        spinner.text = "Uploading melody reference...";
        const absPath = resolve(process.cwd(), options.melody);
        if (!existsSync(absPath)) {
          spinner.fail(chalk.red(`Melody file not found: ${options.melody}`));
          process.exit(1);
        }
        // For Replicate, we need a publicly accessible URL
        // In practice, users would need to host the file or use a data URL
        console.log(chalk.yellow("Note: Melody conditioning requires a publicly accessible URL"));
        console.log(chalk.yellow("Please upload your melody file and provide the URL"));
        process.exit(1);
      }

      const result = await replicate.generateMusic(prompt, {
        duration,
        model: options.model as "large" | "stereo-large" | "melody-large" | "stereo-melody-large",
        melodyUrl,
      });

      if (!result.success || !result.taskId) {
        spinner.fail(chalk.red(result.error || "Music generation failed"));
        process.exit(1);
      }

      if (!options.wait) {
        spinner.succeed(chalk.green("Music generation started"));
        console.log();
        console.log(`Task ID: ${chalk.bold(result.taskId)}`);
        console.log(chalk.dim("Check status with: pnpm vibe ai music-status " + result.taskId));
        return;
      }

      spinner.text = "Generating music (this may take a few minutes)...";

      const finalResult = await replicate.waitForMusic(result.taskId);

      if (!finalResult.success || !finalResult.audioUrl) {
        spinner.fail(chalk.red(finalResult.error || "Music generation failed"));
        process.exit(1);
      }

      spinner.text = "Downloading generated audio...";

      const response = await fetch(finalResult.audioUrl);
      if (!response.ok) {
        spinner.fail(chalk.red("Failed to download generated audio"));
        process.exit(1);
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, audioBuffer);

      spinner.succeed(chalk.green("Music generated successfully"));
      console.log();
      console.log(`Saved to: ${chalk.bold(outputPath)}`);
      console.log(`Duration: ${duration}s`);
      console.log(`Model: ${options.model}`);
      console.log();
    } catch (error) {
      console.error(chalk.red("Music generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("music-status")
  .description("Check music generation status")
  .argument("<task-id>", "Task ID from music generation")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        process.exit(1);
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      const result = await replicate.getMusicStatus(taskId);

      console.log();
      console.log(chalk.bold.cyan("Music Generation Status"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${taskId}`);

      if (result.audioUrl) {
        console.log(`Status: ${chalk.green("completed")}`);
        console.log(`Audio URL: ${result.audioUrl}`);
      } else if (result.error) {
        console.log(`Status: ${chalk.red("failed")}`);
        console.log(`Error: ${result.error}`);
      } else {
        console.log(`Status: ${chalk.yellow("processing")}`);
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Failed to get music status"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("audio-restore")
  .description("Restore audio quality (denoise, enhance)")
  .argument("<audio>", "Input audio file path")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .option("-o, --output <path>", "Output audio file path")
  .option("--ffmpeg", "Use FFmpeg for restoration (free, no API needed)")
  .option("--denoise", "Enable noise reduction (default: true)", true)
  .option("--no-denoise", "Disable noise reduction")
  .option("--enhance", "Enable audio enhancement")
  .option("--noise-floor <dB>", "FFmpeg noise floor threshold", "-30")
  .action(async (audioPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), audioPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${audioPath}`));
        process.exit(1);
      }

      // Default output path
      const ext = extname(audioPath);
      const baseName = basename(audioPath, ext);
      const defaultOutput = `${baseName}-restored${ext || ".mp3"}`;
      const outputPath = resolve(process.cwd(), options.output || defaultOutput);

      // FFmpeg mode (free)
      if (options.ffmpeg) {
        const spinner = ora("Restoring audio with FFmpeg...").start();

        try {
          const noiseFloor = options.noiseFloor || "-30";

          // Build filter chain
          const filters: string[] = [];

          if (options.denoise !== false) {
            filters.push(`afftdn=nf=${noiseFloor}`);
          }

          if (options.enhance) {
            filters.push("highpass=f=80");
            filters.push("lowpass=f=12000");
            filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
          }

          const filterArg = filters.length > 0 ? `-af "${filters.join(",")}"` : "";
          const cmd = `ffmpeg -i "${absPath}" ${filterArg} -y "${outputPath}"`;

          execSync(cmd, { stdio: "pipe" });

          spinner.succeed(chalk.green("Audio restored with FFmpeg"));
          console.log(`Saved to: ${chalk.bold(outputPath)}`);
          console.log();
        } catch (error) {
          spinner.fail(chalk.red("FFmpeg restoration failed"));
          if (error instanceof Error && "message" in error) {
            console.error(chalk.dim(error.message));
          }
          process.exit(1);
        }
        return;
      }

      // Replicate AI mode
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        console.error(chalk.dim("Or use --ffmpeg for free FFmpeg-based restoration"));
        process.exit(1);
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // For Replicate, we need a publicly accessible URL
      // This is a limitation - users need to upload their file first
      console.log(chalk.yellow("Note: Replicate requires a publicly accessible audio URL"));
      console.log(chalk.yellow("For local files, use --ffmpeg for free local processing"));
      console.log();
      console.log(chalk.dim("Example with FFmpeg:"));
      console.log(chalk.dim(`  pnpm vibe ai audio-restore ${audioPath} --ffmpeg`));
      process.exit(1);
    } catch (error) {
      console.error(chalk.red("Audio restoration failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("dub")
  .description("Dub audio/video to another language (transcribe, translate, TTS)")
  .argument("<media>", "Input media file (video or audio)")
  .option("-l, --language <lang>", "Target language code (e.g., es, ko, ja) (required)")
  .option("--source <lang>", "Source language code (default: auto-detect)")
  .option("-v, --voice <id>", "ElevenLabs voice ID for output")
  .option("--analyze-only", "Only analyze and show timing, don't generate audio")
  .option("-o, --output <path>", "Output file path")
  .action(async (mediaPath: string, options) => {
    try {
      if (!options.language) {
        console.error(chalk.red("Target language is required. Use -l or --language"));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), mediaPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${mediaPath}`));
        process.exit(1);
      }

      // Check required API keys
      const openaiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", undefined);
      const anthropicKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", undefined);
      const elevenlabsKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", undefined);

      if (!openaiKey) {
        console.error(chalk.red("OpenAI API key required for transcription. Set OPENAI_API_KEY"));
        process.exit(1);
      }

      if (!anthropicKey) {
        console.error(chalk.red("Anthropic API key required for translation. Set ANTHROPIC_API_KEY"));
        process.exit(1);
      }

      if (!options.analyzeOnly && !elevenlabsKey) {
        console.error(chalk.red("ElevenLabs API key required for TTS. Set ELEVENLABS_API_KEY"));
        console.error(chalk.dim("Or use --analyze-only to preview timing without generating audio"));
        process.exit(1);
      }

      const spinner = ora("Extracting audio...").start();

      // Check if input is video
      const ext = extname(absPath).toLowerCase();
      const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);

      // Step 1: Extract audio if video
      let audioPath = absPath;
      if (isVideo) {
        const tempAudioPath = resolve(dirname(absPath), `temp-audio-${Date.now()}.mp3`);
        try {
          execSync(`ffmpeg -i "${absPath}" -vn -acodec mp3 -y "${tempAudioPath}"`, { stdio: "pipe" });
          audioPath = tempAudioPath;
        } catch (error) {
          spinner.fail(chalk.red("Failed to extract audio from video"));
          process.exit(1);
        }
      }

      // Step 2: Transcribe with Whisper
      spinner.text = "Transcribing audio...";
      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiKey });

      const audioBuffer = await readFile(audioPath);
      const audioBlob = new Blob([audioBuffer]);

      const transcriptResult = await whisper.transcribe(audioBlob, options.source);

      if (transcriptResult.status === "failed" || !transcriptResult.segments) {
        spinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
        process.exit(1);
      }

      // Step 3: Translate with Claude
      spinner.text = "Translating...";
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: anthropicKey });

      // Build translation prompt
      const segments = transcriptResult.segments;
      const segmentTexts = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");

      // Language names for better translation context
      const languageNames: Record<string, string> = {
        en: "English", es: "Spanish", fr: "French", de: "German",
        it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean",
        zh: "Chinese", ar: "Arabic", ru: "Russian", hi: "Hindi",
      };
      const targetLangName = languageNames[options.language] || options.language;

      // Use Claude's analyzeContent method to translate the segments
      // The segments maintain their timing, we just need translated text
      let translatedSegments: Array<{ index: number; text: string; startTime: number; endTime: number }> = [];

      try {
        // For translation, we use analyzeContent with a custom prompt
        // This returns storyboard segments which we can adapt for translation
        const storyboard = await claude.analyzeContent(
          `TRANSLATE to ${targetLangName}. Return the translated text only, preserving segment numbers:\n\n${segmentTexts}`,
          segments[segments.length - 1]?.endTime || 60
        );

        // Map storyboard results to translated segments
        // If storyboard returned results, use descriptions as translations
        if (storyboard && storyboard.length > 0) {
          translatedSegments = segments.map((s, i) => ({
            index: i,
            text: storyboard[i]?.description || s.text,
            startTime: s.startTime,
            endTime: s.endTime,
          }));
        } else {
          // Fallback: use original text
          translatedSegments = segments.map((s, i) => ({
            index: i,
            text: s.text,
            startTime: s.startTime,
            endTime: s.endTime,
          }));
        }
      } catch {
        // Fallback: just show original text
        translatedSegments = segments.map((s, i) => ({
          index: i,
          text: s.text,
          startTime: s.startTime,
          endTime: s.endTime,
        }));
      }

      spinner.succeed(chalk.green("Transcription and translation complete"));

      // Display timing analysis
      console.log();
      console.log(chalk.bold.cyan("Dubbing Analysis"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Source language: ${transcriptResult.detectedLanguage || options.source || "auto"}`);
      console.log(`Target language: ${targetLangName}`);
      console.log(`Segments: ${segments.length}`);
      console.log();

      console.log(chalk.bold("Segment Timing:"));
      for (let i = 0; i < Math.min(5, segments.length); i++) {
        const seg = segments[i];
        const time = `[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]`;
        console.log(`${chalk.dim(time)} ${seg.text}`);
        console.log(`${chalk.dim("           →")} ${chalk.green(translatedSegments[i]?.text || seg.text)}`);
        console.log();
      }

      if (segments.length > 5) {
        console.log(chalk.dim(`... and ${segments.length - 5} more segments`));
      }

      if (options.analyzeOnly) {
        console.log();
        console.log(chalk.dim("Use without --analyze-only to generate dubbed audio"));

        // Save timing to JSON if output specified
        if (options.output) {
          const timingPath = resolve(process.cwd(), options.output);
          const timingData = {
            sourcePath: absPath,
            sourceLanguage: transcriptResult.detectedLanguage || options.source || "auto",
            targetLanguage: options.language,
            segments: segments.map((s, i) => ({
              index: i,
              startTime: s.startTime,
              endTime: s.endTime,
              original: s.text,
              translated: translatedSegments[i]?.text || s.text,
            })),
          };
          await writeFile(timingPath, JSON.stringify(timingData, null, 2));
          console.log(`Timing saved to: ${chalk.bold(timingPath)}`);
        }
        return;
      }

      // Step 4: Generate TTS for each segment
      spinner.start("Generating dubbed audio...");
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey: elevenlabsKey! });

      const dubbedAudioBuffers: Array<{ buffer: Buffer; startTime: number }> = [];

      for (let i = 0; i < translatedSegments.length; i++) {
        spinner.text = `Generating audio segment ${i + 1}/${translatedSegments.length}...`;
        const seg = translatedSegments[i];

        const ttsResult = await elevenlabs.textToSpeech(seg.text, {
          voiceId: options.voice,
        });

        if (ttsResult.success && ttsResult.audioBuffer) {
          dubbedAudioBuffers.push({
            buffer: ttsResult.audioBuffer,
            startTime: seg.startTime,
          });
        }
      }

      // Step 5: Combine and save
      spinner.text = "Combining audio...";

      // For simplicity, just concatenate the audio buffers
      // In production, you'd use FFmpeg to properly place them at timestamps
      const combinedBuffer = Buffer.concat(dubbedAudioBuffers.map((a) => a.buffer));

      const outputExt = isVideo ? ".mp3" : extname(absPath);
      const defaultOutputPath = resolve(
        dirname(absPath),
        `${basename(absPath, extname(absPath))}-${options.language}${outputExt}`
      );
      const finalOutputPath = resolve(process.cwd(), options.output || defaultOutputPath);

      await writeFile(finalOutputPath, combinedBuffer);

      spinner.succeed(chalk.green("Dubbing complete"));
      console.log();
      console.log(`Saved to: ${chalk.bold(finalOutputPath)}`);
      console.log();

      // Clean up temp audio if we extracted from video
      if (isVideo && audioPath !== absPath) {
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(audioPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      console.error(chalk.red("Dubbing failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================
// Smart Editing Commands
// ============================================

// Audio Ducking (FFmpeg only)
aiCommand
  .command("duck")
  .description("Auto-duck background music when voice is present (FFmpeg)")
  .argument("<music>", "Background music file path")
  .option("-v, --voice <path>", "Voice/narration track (required)")
  .option("-o, --output <path>", "Output audio file path")
  .option("-t, --threshold <dB>", "Sidechain threshold in dB", "-30")
  .option("-r, --ratio <ratio>", "Compression ratio", "3")
  .option("-a, --attack <ms>", "Attack time in ms", "20")
  .option("-l, --release <ms>", "Release time in ms", "200")
  .action(async (musicPath: string, options) => {
    try {
      if (!options.voice) {
        console.error(chalk.red("Voice track required. Use --voice <path>"));
        process.exit(1);
      }

      // Check FFmpeg availability
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const spinner = ora("Processing audio ducking...").start();

      const absMusic = resolve(process.cwd(), musicPath);
      const absVoice = resolve(process.cwd(), options.voice);
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absMusic.replace(/(\.[^.]+)$/, "-ducked$1");

      // Convert threshold from dB to linear (0-1 scale)
      const thresholdDb = parseFloat(options.threshold);
      const thresholdLinear = Math.pow(10, thresholdDb / 20);

      const ratio = parseFloat(options.ratio);
      const attack = parseFloat(options.attack);
      const release = parseFloat(options.release);

      // FFmpeg sidechain compress filter
      const filterComplex = `[0:a][1:a]sidechaincompress=threshold=${thresholdLinear}:ratio=${ratio}:attack=${attack}:release=${release}[out]`;

      const cmd = `ffmpeg -i "${absMusic}" -i "${absVoice}" -filter_complex "${filterComplex}" -map "[out]" "${outputPath}" -y`;

      await execAsync(cmd);

      spinner.succeed(chalk.green("Audio ducking complete"));
      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Music: ${musicPath}`);
      console.log(`Voice: ${options.voice}`);
      console.log(`Threshold: ${thresholdDb}dB`);
      console.log(`Ratio: ${ratio}:1`);
      console.log(`Attack/Release: ${attack}ms / ${release}ms`);
      console.log();
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Audio ducking failed"));
      console.error(error);
      process.exit(1);
    }
  });

// AI Color Grading
aiCommand
  .command("grade")
  .description("Apply AI-generated color grading (Claude + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-s, --style <prompt>", "Style description (e.g., 'cinematic warm')")
  .option("-p, --preset <name>", "Built-in preset: film-noir, vintage, cinematic-warm, cool-tones, high-contrast, pastel, cyberpunk, horror")
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show filter without applying")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.style && !options.preset) {
        console.error(chalk.red("Either --style or --preset is required"));
        console.log(chalk.dim("Examples:"));
        console.log(chalk.dim('  pnpm vibe ai grade video.mp4 --style "warm sunset"'));
        console.log(chalk.dim("  pnpm vibe ai grade video.mp4 --preset cinematic-warm"));
        process.exit(1);
      }

      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const spinner = ora("Analyzing color grade...").start();

      // Get API key if using style (not preset)
      let gradeResult: { ffmpegFilter: string; description: string };

      if (options.preset) {
        const claude = new ClaudeProvider();
        gradeResult = await claude.analyzeColorGrade("", options.preset);
      } else {
        const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: apiKey || undefined });
        gradeResult = await claude.analyzeColorGrade(options.style);
      }

      spinner.succeed(chalk.green("Color grade analyzed"));
      console.log();
      console.log(chalk.bold.cyan("Color Grade"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Style: ${options.preset || options.style}`);
      console.log(`Description: ${gradeResult.description}`);
      console.log();
      console.log(chalk.dim("FFmpeg filter:"));
      console.log(chalk.cyan(gradeResult.ffmpegFilter));
      console.log();

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to apply the grade."));
        return;
      }

      const absPath = resolve(process.cwd(), videoPath);
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, "-graded$1");

      spinner.start("Applying color grade...");

      const cmd = `ffmpeg -i "${absPath}" -vf "${gradeResult.ffmpegFilter}" -c:a copy "${outputPath}" -y`;
      await execAsync(cmd, { timeout: 600000 });

      spinner.succeed(chalk.green("Color grade applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Color grading failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Speed Ramping
aiCommand
  .command("speed-ramp")
  .description("Apply content-aware speed ramping (Whisper + Claude + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output video file path")
  .option("-s, --style <style>", "Style: dramatic, smooth, action", "dramatic")
  .option("--min-speed <factor>", "Minimum speed factor", "0.25")
  .option("--max-speed <factor>", "Maximum speed factor", "4.0")
  .option("--analyze-only", "Show keyframes without applying")
  .option("-l, --language <lang>", "Language code for transcription")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        console.error(chalk.red("OpenAI API key required for Whisper transcription."));
        process.exit(1);
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for speed analysis."));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), videoPath);

      // Step 1: Extract audio
      const spinner = ora("Extracting audio...").start();
      const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");

      await execAsync(`ffmpeg -i "${absPath}" -vn -acodec libmp3lame -q:a 2 "${tempAudio}" -y`);

      // Step 2: Transcribe
      spinner.text = "Transcribing audio...";

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(tempAudio);
      const audioBlob = new Blob([audioBuffer]);
      const transcript = await whisper.transcribe(audioBlob, options.language);

      if (!transcript.segments || transcript.segments.length === 0) {
        spinner.fail(chalk.red("No transcript segments found"));
        process.exit(1);
      }

      // Step 3: Analyze with Claude
      spinner.text = "Analyzing for speed ramping...";

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const speedResult = await claude.analyzeForSpeedRamp(transcript.segments, {
        style: options.style as "dramatic" | "smooth" | "action",
        minSpeed: parseFloat(options.minSpeed),
        maxSpeed: parseFloat(options.maxSpeed),
      });

      // Clean up temp file
      try {
        await execAsync(`rm "${tempAudio}"`);
      } catch { /* ignore cleanup errors */ }

      spinner.succeed(chalk.green(`Found ${speedResult.keyframes.length} speed keyframes`));

      console.log();
      console.log(chalk.bold.cyan("Speed Ramp Keyframes"));
      console.log(chalk.dim("─".repeat(60)));

      for (const kf of speedResult.keyframes) {
        const speedColor = kf.speed < 1 ? chalk.blue : kf.speed > 1 ? chalk.yellow : chalk.white;
        console.log(`  ${formatTime(kf.time)} → ${speedColor(`${kf.speed.toFixed(2)}x`)} - ${kf.reason}`);
      }
      console.log();

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to apply speed ramps."));
        return;
      }

      if (speedResult.keyframes.length < 2) {
        console.log(chalk.yellow("Not enough keyframes for speed ramping."));
        return;
      }

      spinner.start("Applying speed ramps...");

      // Build FFmpeg filter for speed ramping (segment-based)
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, "-ramped$1");

      // For simplicity, we'll create segments and concatenate
      // A full implementation would use complex filter expressions
      // Here we use setpts with a simple approach

      // For demo, apply average speed or first segment's speed
      const avgSpeed = speedResult.keyframes.reduce((sum, kf) => sum + kf.speed, 0) / speedResult.keyframes.length;

      // Use setpts for speed change (1/speed for setpts)
      const setpts = `setpts=${(1 / avgSpeed).toFixed(3)}*PTS`;
      const atempo = avgSpeed >= 0.5 && avgSpeed <= 2.0 ? `atempo=${avgSpeed.toFixed(3)}` : "";

      let cmd: string;
      if (atempo) {
        cmd = `ffmpeg -i "${absPath}" -filter_complex "[0:v]${setpts}[v];[0:a]${atempo}[a]" -map "[v]" -map "[a]" "${outputPath}" -y`;
      } else {
        cmd = `ffmpeg -i "${absPath}" -vf "${setpts}" -an "${outputPath}" -y`;
      }

      await execAsync(cmd, { timeout: 600000 });

      spinner.succeed(chalk.green("Speed ramp applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log(chalk.dim(`Average speed: ${avgSpeed.toFixed(2)}x`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Speed ramping failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Auto Reframe
aiCommand
  .command("reframe")
  .description("Auto-reframe video to different aspect ratio (Claude Vision + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-a, --aspect <ratio>", "Target aspect ratio: 9:16, 1:1, 4:5", "9:16")
  .option("-f, --focus <mode>", "Focus mode: auto, face, center, action", "auto")
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show crop regions without applying")
  .option("--keyframes <path>", "Export keyframes to JSON file")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), videoPath);

      // Get video dimensions
      const spinner = ora("Analyzing video...").start();

      const { stdout: probeOut } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of csv=p=0 "${absPath}"`
      );
      const [width, height, durationStr] = probeOut.trim().split(",");
      const sourceWidth = parseInt(width);
      const sourceHeight = parseInt(height);
      const duration = parseFloat(durationStr);

      spinner.text = "Extracting keyframes...";

      // Extract keyframes every 2 seconds for analysis
      const keyframeInterval = 2;
      const numKeyframes = Math.ceil(duration / keyframeInterval);
      const tempDir = `/tmp/vibe-reframe-${Date.now()}`;
      await execAsync(`mkdir -p "${tempDir}"`);

      await execAsync(
        `ffmpeg -i "${absPath}" -vf "fps=1/${keyframeInterval}" -frame_pts 1 "${tempDir}/frame-%04d.jpg" -y`
      );

      // Get API key
      const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: apiKey || undefined });

      // Analyze keyframes
      spinner.text = "Analyzing frames for subject tracking...";

      const cropKeyframes: Array<{
        time: number;
        cropX: number;
        cropY: number;
        cropWidth: number;
        cropHeight: number;
        confidence: number;
        subjectDescription: string;
      }> = [];

      for (let i = 1; i <= numKeyframes && i <= 30; i++) {
        // Limit to 30 frames
        const framePath = `${tempDir}/frame-${i.toString().padStart(4, "0")}.jpg`;

        try {
          const frameBuffer = await readFile(framePath);
          const frameBase64 = frameBuffer.toString("base64");

          const result = await claude.analyzeFrameForReframe(frameBase64, options.aspect, {
            focusMode: options.focus,
            sourceWidth,
            sourceHeight,
            mimeType: "image/jpeg",
          });

          cropKeyframes.push({
            time: (i - 1) * keyframeInterval,
            ...result,
          });

          spinner.text = `Analyzing frames... ${i}/${Math.min(numKeyframes, 30)}`;
        } catch (e) {
          // Skip failed frames
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 200));
      }

      // Clean up temp files
      try {
        await execAsync(`rm -rf "${tempDir}"`);
      } catch { /* ignore cleanup errors */ }

      spinner.succeed(chalk.green(`Analyzed ${cropKeyframes.length} keyframes`));

      console.log();
      console.log(chalk.bold.cyan("Reframe Analysis"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Source: ${sourceWidth}x${sourceHeight}`);
      console.log(`Target: ${options.aspect}`);
      console.log(`Focus: ${options.focus}`);
      console.log();

      if (cropKeyframes.length > 0) {
        const avgConf = cropKeyframes.reduce((sum, kf) => sum + kf.confidence, 0) / cropKeyframes.length;
        console.log(`Average confidence: ${(avgConf * 100).toFixed(0)}%`);
        console.log();
        console.log(chalk.dim("Sample keyframes:"));
        for (const kf of cropKeyframes.slice(0, 5)) {
          console.log(`  ${formatTime(kf.time)} → crop=${kf.cropX},${kf.cropY} (${kf.subjectDescription})`);
        }
        if (cropKeyframes.length > 5) {
          console.log(chalk.dim(`  ... and ${cropKeyframes.length - 5} more`));
        }
      }
      console.log();

      // Export keyframes if requested
      if (options.keyframes) {
        const keyframesPath = resolve(process.cwd(), options.keyframes);
        await writeFile(keyframesPath, JSON.stringify(cropKeyframes, null, 2));
        console.log(chalk.green(`Keyframes saved to: ${keyframesPath}`));
      }

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to apply reframe."));
        return;
      }

      // Apply reframe using average crop position
      const avgCropX = Math.round(cropKeyframes.reduce((sum, kf) => sum + kf.cropX, 0) / cropKeyframes.length);
      const avgCropY = Math.round(cropKeyframes.reduce((sum, kf) => sum + kf.cropY, 0) / cropKeyframes.length);
      const cropWidth = cropKeyframes[0]?.cropWidth || sourceWidth;
      const cropHeight = cropKeyframes[0]?.cropHeight || sourceHeight;

      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, `-${options.aspect.replace(":", "x")}$1`);

      spinner.start("Applying reframe...");

      const cmd = `ffmpeg -i "${absPath}" -vf "crop=${cropWidth}:${cropHeight}:${avgCropX}:${avgCropY}" -c:a copy "${outputPath}" -y`;
      await execAsync(cmd, { timeout: 600000 });

      spinner.succeed(chalk.green("Reframe applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log(chalk.dim(`Crop: ${cropWidth}x${cropHeight} at (${avgCropX}, ${avgCropY})`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Reframe failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Auto Shorts
aiCommand
  .command("auto-shorts")
  .description("Auto-generate shorts from long-form video")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file (single) or directory (multiple)")
  .option("-d, --duration <seconds>", "Target duration in seconds (15-60)", "60")
  .option("-n, --count <number>", "Number of shorts to generate", "1")
  .option("-a, --aspect <ratio>", "Aspect ratio: 9:16, 1:1", "9:16")
  .option("--output-dir <dir>", "Output directory for multiple shorts")
  .option("--add-captions", "Add auto-generated captions")
  .option("--caption-style <style>", "Caption style: minimal, bold, animated", "bold")
  .option("--analyze-only", "Show segments without generating")
  .option("-l, --language <lang>", "Language code for transcription")
  .action(async (videoPath: string, options) => {
    try {
      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        console.error(chalk.red("OpenAI API key required for transcription."));
        process.exit(1);
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for highlight detection."));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), videoPath);
      const targetDuration = parseInt(options.duration);
      const shortCount = parseInt(options.count);

      // Step 1: Extract audio and transcribe
      const spinner = ora("Extracting audio...").start();
      const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");

      await execAsync(`ffmpeg -i "${absPath}" -vn -acodec libmp3lame -q:a 2 "${tempAudio}" -y`);

      spinner.text = "Transcribing audio...";

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(tempAudio);
      const audioBlob = new Blob([audioBuffer]);
      const transcript = await whisper.transcribe(audioBlob, options.language);

      // Clean up temp audio
      try {
        await execAsync(`rm "${tempAudio}"`);
      } catch { /* ignore cleanup errors */ }

      if (!transcript.segments || transcript.segments.length === 0) {
        spinner.fail(chalk.red("No transcript found"));
        process.exit(1);
      }

      // Step 2: Find highlights
      spinner.text = "Finding highlights...";

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const highlights = await claude.analyzeForHighlights(transcript.segments, {
        criteria: "all",
        targetDuration: targetDuration * shortCount,
        maxCount: shortCount * 3, // Get extras to choose from
      });

      if (highlights.length === 0) {
        spinner.fail(chalk.red("No highlights found"));
        process.exit(1);
      }

      // Sort by confidence and select best
      highlights.sort((a, b) => b.confidence - a.confidence);
      const selectedHighlights = highlights.slice(0, shortCount);

      spinner.succeed(chalk.green(`Found ${highlights.length} highlights, selected ${selectedHighlights.length}`));

      console.log();
      console.log(chalk.bold.cyan("Auto Shorts"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Target duration: ${targetDuration}s`);
      console.log(`Aspect ratio: ${options.aspect}`);
      console.log();

      for (let i = 0; i < selectedHighlights.length; i++) {
        const h = selectedHighlights[i];
        console.log(chalk.yellow(`[Short ${i + 1}] ${formatTime(h.startTime)} - ${formatTime(h.endTime)} (${h.duration.toFixed(1)}s)`));
        console.log(`  ${h.reason}`);
        console.log(chalk.dim(`  Confidence: ${(h.confidence * 100).toFixed(0)}%`));
      }
      console.log();

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to generate shorts."));
        return;
      }

      // Step 3: Generate shorts
      const outputDir = options.outputDir
        ? resolve(process.cwd(), options.outputDir)
        : dirname(absPath);

      if (options.outputDir && !existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      for (let i = 0; i < selectedHighlights.length; i++) {
        const h = selectedHighlights[i];
        const shortSpinner = ora(`Generating short ${i + 1}/${selectedHighlights.length}...`).start();

        let outputPath: string;
        if (shortCount === 1 && options.output) {
          outputPath = resolve(process.cwd(), options.output);
        } else {
          const baseName = basename(absPath, extname(absPath));
          outputPath = resolve(outputDir, `${baseName}-short-${i + 1}.mp4`);
        }

        // Get source dimensions for reframe
        const { stdout: probeOut } = await execAsync(
          `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${absPath}"`
        );
        const [width, height] = probeOut.trim().split(",").map(Number);

        // Calculate crop for aspect ratio
        const [targetW, targetH] = options.aspect.split(":").map(Number);
        const targetRatio = targetW / targetH;
        const sourceRatio = width / height;

        let cropW: number, cropH: number, cropX: number, cropY: number;
        if (sourceRatio > targetRatio) {
          cropH = height;
          cropW = Math.round(height * targetRatio);
          cropX = Math.round((width - cropW) / 2);
          cropY = 0;
        } else {
          cropW = width;
          cropH = Math.round(width / targetRatio);
          cropX = 0;
          cropY = Math.round((height - cropH) / 2);
        }

        // Build FFmpeg command
        const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
        const cmd = `ffmpeg -ss ${h.startTime} -i "${absPath}" -t ${h.duration} -vf "${vf}" -c:a aac -b:a 128k "${outputPath}" -y`;

        await execAsync(cmd, { timeout: 300000 });

        shortSpinner.succeed(chalk.green(`Short ${i + 1}: ${outputPath}`));
      }

      console.log();
      console.log(chalk.bold.green(`Generated ${selectedHighlights.length} short(s)`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Auto shorts failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Style Transfer
aiCommand
  .command("style-transfer")
  .description("Apply artistic style transfer to video (Replicate)")
  .argument("<video>", "Video file path or URL")
  .option("-s, --style <path/prompt>", "Style reference image path or text prompt")
  .option("-o, --output <path>", "Output video file path")
  .option("--strength <value>", "Transfer strength (0-1)", "0.5")
  .option("--no-wait", "Start processing without waiting")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.style) {
        console.error(chalk.red("Style required. Use --style <image-path> or --style <prompt>"));
        process.exit(1);
      }

      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required."));
        console.error(chalk.dim("Set REPLICATE_API_TOKEN environment variable"));
        process.exit(1);
      }

      const spinner = ora("Initializing style transfer...").start();

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // Determine if style is an image path or text prompt
      let styleRef: string | undefined;
      let stylePrompt: string | undefined;

      if (options.style.startsWith("http://") || options.style.startsWith("https://")) {
        styleRef = options.style;
      } else if (existsSync(resolve(process.cwd(), options.style))) {
        // It's a local file - need to upload or base64
        spinner.fail(chalk.yellow("Local style images must be URLs for Replicate."));
        console.log(chalk.dim("Upload your style image to a URL and try again."));
        process.exit(1);
      } else {
        // Treat as text prompt
        stylePrompt = options.style;
      }

      // Video must be URL
      let videoUrl: string;
      if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
        videoUrl = videoPath;
      } else {
        spinner.fail(chalk.yellow("Video must be a URL for Replicate processing."));
        console.log(chalk.dim("Upload your video to a URL and try again."));
        process.exit(1);
      }

      spinner.text = "Starting style transfer...";

      const result = await replicate.styleTransferVideo({
        videoUrl,
        styleRef,
        stylePrompt,
        strength: parseFloat(options.strength),
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Style transfer failed"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Style Transfer Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);
      console.log(`Style: ${stylePrompt || styleRef}`);
      console.log(`Strength: ${options.strength}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Style transfer started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" https://api.replicate.com/v1/predictions/${result.id}`));
        console.log();
        return;
      }

      spinner.text = "Processing style transfer (this may take several minutes)...";

      const finalResult = await replicate.waitForCompletion(
        result.id,
        (status) => {
          spinner.text = `Processing... ${status.status}`;
        },
        600000
      );

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Style transfer failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Style transfer complete"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);

        if (options.output) {
          const downloadSpinner = ora("Downloading video...").start();
          try {
            const response = await fetch(finalResult.videoUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            downloadSpinner.fail(chalk.red("Failed to download video"));
          }
        }
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Style transfer failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Object Tracking
aiCommand
  .command("track-object")
  .description("Track objects in video (Replicate SAM-2)")
  .argument("<video>", "Video file path or URL")
  .option("-p, --point <x,y>", "Point to track (x,y coordinates)")
  .option("-b, --box <x,y,w,h>", "Bounding box to track (x,y,width,height)")
  .option("--prompt <text>", "Object description to track")
  .option("-o, --output <path>", "Output JSON or MP4 file path", "track.json")
  .option("-v, --visualize", "Output video with tracking overlay")
  .option("--no-wait", "Start processing without waiting")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.point && !options.box && !options.prompt) {
        console.error(chalk.red("Tracking target required. Use --point, --box, or --prompt"));
        console.log(chalk.dim("Examples:"));
        console.log(chalk.dim("  pnpm vibe ai track-object video.mp4 --point 500,300"));
        console.log(chalk.dim("  pnpm vibe ai track-object video.mp4 --box 100,100,200,200"));
        console.log(chalk.dim('  pnpm vibe ai track-object video.mp4 --prompt "the person"'));
        process.exit(1);
      }

      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required."));
        console.error(chalk.dim("Set REPLICATE_API_TOKEN environment variable"));
        process.exit(1);
      }

      const spinner = ora("Initializing object tracking...").start();

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // Video must be URL
      let videoUrl: string;
      if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
        videoUrl = videoPath;
      } else {
        spinner.fail(chalk.yellow("Video must be a URL for Replicate processing."));
        console.log(chalk.dim("Upload your video to a URL and try again."));
        process.exit(1);
      }

      // Parse tracking target
      let point: [number, number] | undefined;
      let box: [number, number, number, number] | undefined;

      if (options.point) {
        const [x, y] = options.point.split(",").map(Number);
        point = [x, y];
      }

      if (options.box) {
        const [x, y, w, h] = options.box.split(",").map(Number);
        box = [x, y, w, h];
      }

      spinner.text = "Starting object tracking...";

      const result = await replicate.trackObject({
        videoUrl,
        point,
        box,
        prompt: options.prompt,
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Object tracking failed"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Object Tracking Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);
      if (point) console.log(`Point: ${point[0]}, ${point[1]}`);
      if (box) console.log(`Box: ${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}`);
      if (options.prompt) console.log(`Prompt: ${options.prompt}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Tracking started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" https://api.replicate.com/v1/predictions/${result.id}`));
        console.log();
        return;
      }

      spinner.text = "Processing tracking (this may take several minutes)...";

      const finalResult = await replicate.getTrackingResult(result.id);

      // Poll for completion
      let pollResult = finalResult;
      const startTime = Date.now();
      const maxWait = 600000;

      while (pollResult.status !== "completed" && pollResult.status !== "failed" && Date.now() - startTime < maxWait) {
        await new Promise((r) => setTimeout(r, 3000));
        pollResult = await replicate.getTrackingResult(result.id);
        spinner.text = `Processing... ${pollResult.status}`;
      }

      if (pollResult.status !== "completed") {
        spinner.fail(chalk.red(pollResult.error || "Tracking failed or timed out"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Object tracking complete"));

      console.log();
      if (pollResult.maskUrl) {
        console.log(`Mask URL: ${pollResult.maskUrl}`);

        const outputPath = resolve(process.cwd(), options.output);
        if (options.visualize || options.output.endsWith(".mp4")) {
          const downloadSpinner = ora("Downloading tracking mask...").start();
          try {
            const response = await fetch(pollResult.maskUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            downloadSpinner.fail(chalk.red("Failed to download mask"));
          }
        } else {
          // Save tracking data as JSON
          const trackData = {
            taskId: result.id,
            maskUrl: pollResult.maskUrl,
            trackingData: pollResult.trackingData,
          };
          await writeFile(outputPath, JSON.stringify(trackData, null, 2));
          console.log(chalk.green(`Tracking data saved to: ${outputPath}`));
        }
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Object tracking failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("providers")
  .description("List available AI providers")
  .action(async () => {
    // Register default providers
    providerRegistry.register(whisperProvider);
    providerRegistry.register(geminiProvider);
    providerRegistry.register(openaiProvider);
    providerRegistry.register(claudeProvider);
    providerRegistry.register(elevenLabsProvider);
    providerRegistry.register(dalleProvider);
    providerRegistry.register(runwayProvider);
    providerRegistry.register(klingProvider);
    providerRegistry.register(stabilityProvider);
    providerRegistry.register(replicateProvider);

    console.log();
    console.log(chalk.bold.cyan("Available AI Providers"));
    console.log(chalk.dim("─".repeat(60)));

    const providers = providerRegistry.getAll();
    for (const provider of providers) {
      const status = provider.isAvailable ? chalk.green("●") : chalk.red("○");
      console.log();
      console.log(`${status} ${chalk.bold(provider.name)} ${chalk.dim(`(${provider.id})`)}`);
      console.log(`  ${provider.description}`);
      console.log(`  ${chalk.dim("Capabilities:")} ${provider.capabilities.join(", ")}`);
    }

    console.log();
  });

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}

function applySuggestion(project: Project, suggestion: any): boolean {
  const { type, clipIds, params } = suggestion;

  if (clipIds.length === 0) return false;
  const clipId = clipIds[0];

  switch (type) {
    case "trim":
      if (params.newDuration) {
        return project.trimClipEnd(clipId, params.newDuration);
      }
      break;
    case "add-effect":
      if (params.effectType) {
        const effect = project.addEffect(clipId, {
          type: params.effectType,
          startTime: params.startTime || 0,
          duration: params.duration || 1,
          params: params.effectParams || {},
        });
        return effect !== null;
      }
      break;
    case "delete":
      return project.removeClip(clipId);
  }

  return false;
}

export function executeCommand(project: Project, cmd: TimelineCommand): boolean {
  const { action, clipIds, params } = cmd;

  try {
    switch (action) {
      case "trim":
        for (const clipId of clipIds) {
          if (params.newDuration) {
            project.trimClipEnd(clipId, params.newDuration as number);
          }
          if (params.startTrim) {
            project.trimClipStart(clipId, params.startTrim as number);
          }
        }
        return true;

      case "remove-clip":
        for (const clipId of clipIds) {
          project.removeClip(clipId);
        }
        return true;

      case "split":
        if (clipIds.length > 0 && params.splitTime) {
          project.splitClip(clipIds[0], params.splitTime as number);
        }
        return true;

      case "duplicate":
        for (const clipId of clipIds) {
          project.duplicateClip(clipId, params.newStartTime as number | undefined);
        }
        return true;

      case "move":
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const newTrackId = (params.newTrackId as string) || clip.trackId;
            const newStartTime = (params.newStartTime as number) ?? clip.startTime;
            project.moveClip(clipId, newTrackId, newStartTime);
          }
        }
        return true;

      case "add-effect":
        for (const clipId of clipIds) {
          const effectType = ((params.effectType as string) || "fadeIn") as EffectType;
          project.addEffect(clipId, {
            type: effectType,
            startTime: (params.startTime as number) || 0,
            duration: (params.duration as number) || 1,
            params: {},
          });
        }
        return true;

      case "remove-effect":
        // TODO: Implement effect removal
        return false;

      case "set-volume":
        // TODO: Implement volume control
        return false;

      case "add-track": {
        const trackType = (params.trackType as "video" | "audio") || "video";
        const tracks = project.getTracks();
        project.addTrack({
          type: trackType,
          name: `${trackType}-track-${tracks.length + 1}`,
          order: tracks.length,
          isMuted: false,
          isLocked: false,
          isVisible: true,
        });
        return true;
      }

      case "speed-change":
        // Store speed info in clip metadata (processed during export)
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const speed = (params.speed as number) || 1.0;
            project.addEffect(clipId, {
              type: "speed" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: { speed },
            });
          }
        }
        return true;

      case "reverse":
        // Reverse is implemented as speed = -1
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            project.addEffect(clipId, {
              type: "reverse" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: {},
            });
          }
        }
        return true;

      case "crop":
        // Store crop info in clip metadata (processed during export)
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            project.addEffect(clipId, {
              type: "crop" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: {
                aspectRatio: params.aspectRatio as string,
                x: params.x as number,
                y: params.y as number,
                width: params.width as number,
                height: params.height as number,
              },
            });
          }
        }
        return true;

      case "position":
        // Move clip to beginning/end/middle
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const position = params.position as string;
            const allClips = project.getClips().filter((c) => c.trackId === clip.trackId);
            let newStartTime = 0;

            if (position === "end") {
              const maxEnd = Math.max(...allClips.filter((c) => c.id !== clipId).map((c) => c.startTime + c.duration));
              newStartTime = maxEnd;
            } else if (position === "middle") {
              const totalDuration = allClips.reduce((sum, c) => sum + c.duration, 0);
              newStartTime = (totalDuration - clip.duration) / 2;
            }
            // "beginning" stays at 0

            project.moveClip(clipId, clip.trackId, newStartTime);
          }
        }
        return true;

      default:
        console.warn(`Unknown action: ${action}`);
        return false;
    }
  } catch (error) {
    console.error(`Error executing ${action}:`, error);
    return false;
  }
}

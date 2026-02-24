/**
 * ai-suggest-edit.ts — Suggest, edit, and storyboard commands for the VibeFrame CLI.
 *
 * Commands: suggest, edit, storyboard
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerSuggestEditCommands(aiCommand).
 */

import { type Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  GeminiProvider,
  OpenAIProvider,
  ClaudeProvider,
} from '@vibeframe/ai-providers';
import { Project, type ProjectFile } from '../engine/index.js';
import { getApiKey } from '../utils/api-key.js';
import { formatTime, applySuggestion } from './ai-helpers.js';
import { executeCommand } from './ai.js';

export function registerSuggestEditCommands(ai: Command): void {
  ai
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

  ai
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

  ai
    .command("storyboard")
    .description("Generate video storyboard from content using Claude")
    .argument("<content>", "Content to analyze (text or file path)")
    .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
    .option("-o, --output <path>", "Output JSON file path")
    .option("-d, --duration <sec>", "Target total duration in seconds")
    .option("-f, --file", "Treat content argument as file path")
    .option("-c, --creativity <level>", "Creativity level: low (default, consistent) or high (varied, unexpected)", "low")
    .action(async (content: string, options) => {
      try {
        const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Anthropic API key required. Use --api-key or set ANTHROPIC_API_KEY"));
          process.exit(1);
        }

        // Validate creativity level
        const creativity = options.creativity?.toLowerCase();
        if (creativity && creativity !== "low" && creativity !== "high") {
          console.error(chalk.red("Invalid creativity level. Use 'low' or 'high'."));
          process.exit(1);
        }

        let textContent = content;
        if (options.file) {
          const filePath = resolve(process.cwd(), content);
          textContent = await readFile(filePath, "utf-8");
        }

        const spinnerText = creativity === "high"
          ? "Analyzing content with high creativity..."
          : "Analyzing content...";
        const spinner = ora(spinnerText).start();

        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey });

        const segments = await claude.analyzeContent(
          textContent,
          options.duration ? parseFloat(options.duration) : undefined,
          { creativity: creativity as "low" | "high" | undefined }
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
}

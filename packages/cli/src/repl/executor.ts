/**
 * REPL Command Executor
 * Handles both built-in commands and natural language AI commands
 * Uses LLM to understand all natural language and route to appropriate handlers
 */

import { extname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { Session } from "./session.js";
import { success, error, warn, info, getHelpText, formatProjectInfo } from "./prompts.js";
import { getApiKeyFromConfig, loadConfig, type LLMProvider } from "../config/index.js";
import { executeCommand } from "../commands/ai.js";
import { Project } from "../engine/index.js";
import {
  OpenAIProvider,
  ClaudeProvider,
  OllamaProvider,
  GeminiProvider,
  ElevenLabsProvider,
} from "@vibeframe/ai-providers";

/** Built-in command result */
export interface CommandResult {
  success: boolean;
  message: string;
  shouldExit?: boolean;
  showHelp?: boolean;
  showSetup?: boolean;
}

/** Unified command intent from LLM */
interface CommandIntent {
  type: "image" | "tts" | "sfx" | "video" | "timeline" | "project" | "add-media" | "unknown";
  params: {
    prompt?: string;
    text?: string;
    outputFile?: string;
    projectName?: string;
    filename?: string;
    [key: string]: unknown;
  };
  clarification?: string;
}

/**
 * Use LLM to classify and parse natural language command
 */
async function classifyCommand(
  input: string,
  apiKey: string,
  providerType: LLMProvider
): Promise<CommandIntent> {
  const systemPrompt = `You are a command classifier for a video editing CLI called VibeFrame.
Analyze the user's natural language input and classify it into one of these types:

1. "image" - Generate an image (e.g., "create an image of sunset", "make a picture of a cat", "generate a welcome banner")
2. "tts" - Text-to-speech / audio generation (e.g., "create audio saying hello", "generate a welcome message", "make voiceover for intro")
3. "sfx" - Sound effects (e.g., "create explosion sound", "generate rain sound effect")
4. "video" - Video generation (e.g., "generate a video of ocean waves")
5. "timeline" - Timeline editing commands:
   - Adding effects: "add fade-in effect", "add blur to clip", "apply transition"
   - Trimming: "trim to 5 seconds", "cut the first 10s", "shorten clip"
   - Transitions: "add crossfade between clips", "add dissolve"
   - Modifications: "speed up by 2x", "reverse the clip", "change opacity"
   - Splitting: "split at 3s", "cut at this point"
6. "project" - Project management (e.g., "create new project called X", "start a project named Y")
7. "add-media" - Add existing media file to project (e.g., "add sunset.png to the project", "add video.mp4 to timeline", "include intro.mp3")
8. "unknown" - Cannot understand the command

IMPORTANT: If the input mentions "effect", "fade", "transition", "trim", "cut", "split", "speed", "reverse", "blur", or similar editing terms, classify as "timeline".

Extract relevant parameters:
- For image: prompt (the image description), outputFile (optional)
- For tts: text (what to say), outputFile (optional)
- For sfx: prompt (sound description), outputFile (optional)
- For video: prompt (video description), outputFile (optional)
- For project: projectName
- For add-media: filename (the file to add, e.g., "sunset.png", "video.mp4")
- For timeline: leave params empty (will be parsed separately)

If the command is ambiguous, set clarification to ask for more details.

Respond with JSON only:
{
  "type": "image|tts|sfx|video|timeline|project|add-media|unknown",
  "params": {
    "prompt": "extracted prompt if applicable",
    "text": "text to speak if tts",
    "outputFile": "output.png or output.mp3 if specified",
    "projectName": "project name if project command",
    "filename": "file to add if add-media"
  },
  "clarification": "question to ask if ambiguous (optional)"
}

Examples:
- "create a welcome audio message" → {"type": "tts", "params": {"text": "welcome"}}
- "generate an image of a sunset" → {"type": "image", "params": {"prompt": "a sunset"}}
- "make a project called demo" → {"type": "project", "params": {"projectName": "demo"}}
- "trim to 5 seconds" → {"type": "timeline", "params": {}}
- "create a welcome banner image" → {"type": "image", "params": {"prompt": "a welcome banner"}}
- "add sunset.png to the project" → {"type": "add-media", "params": {"filename": "sunset.png"}}
- "include intro.mp4 in timeline" → {"type": "add-media", "params": {"filename": "intro.mp4"}}`;

  try {
    let endpoint: string;
    let headers: Record<string, string>;
    let body: Record<string, unknown>;

    if (providerType === "claude") {
      endpoint = "https://api.anthropic.com/v1/messages";
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      body = {
        model: "claude-3-5-haiku-latest",
        max_tokens: 256,
        messages: [{ role: "user", content: `${systemPrompt}\n\nUser input: "${input}"` }],
      };
    } else if (providerType === "gemini") {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      headers = { "Content-Type": "application/json" };
      body = {
        contents: [{ parts: [{ text: `${systemPrompt}\n\nUser input: "${input}"` }] }],
        generationConfig: { temperature: 0.1 },
      };
    } else {
      // OpenAI or Ollama
      endpoint = providerType === "ollama"
        ? "http://localhost:11434/api/chat"
        : "https://api.openai.com/v1/chat/completions";
      headers = {
        "Content-Type": "application/json",
        ...(providerType !== "ollama" && { Authorization: `Bearer ${apiKey}` }),
      };
      body = {
        model: providerType === "ollama" ? "llama3.2" : "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input },
        ],
        temperature: 0.1,
        ...(providerType !== "ollama" && { response_format: { type: "json_object" } }),
      };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error("LLM API error:", await response.text());
      return fallbackClassify(input);
    }

    const data = await response.json() as Record<string, unknown>;
    let content: string;

    if (providerType === "claude") {
      const claudeData = data as { content?: Array<{ text?: string }> };
      content = claudeData.content?.[0]?.text || "";
    } else if (providerType === "gemini") {
      const geminiData = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (providerType === "ollama") {
      const ollamaData = data as { message?: { content?: string } };
      content = ollamaData.message?.content || "";
    } else {
      const openaiData = data as { choices?: Array<{ message?: { content?: string } }> };
      content = openaiData.choices?.[0]?.message?.content || "";
    }

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackClassify(input);
    }

    const result = JSON.parse(jsonMatch[0]) as CommandIntent;
    return {
      type: result.type || "unknown",
      params: result.params || {},
      clarification: result.clarification,
    };
  } catch (e) {
    console.error("classifyCommand error:", e);
    return fallbackClassify(input);
  }
}

/**
 * Fallback classification using simple pattern matching
 */
function fallbackClassify(input: string): CommandIntent {
  const lower = input.toLowerCase();

  // Timeline patterns (check FIRST - catch-all for editing operations)
  // This must come before other patterns to properly route "add fade-in effect" etc.
  if (lower.match(/(?:add|apply|put|set)\s+(?:a\s+)?(?:fade|effect|transition|blur|filter|opacity)/)) {
    return { type: "timeline", params: {} };
  }
  if (lower.match(/(?:fade|effect|transition|blur|filter|opacity|brightness|contrast|saturation)\s+(?:to|on|for)\s+(?:the\s+)?(?:clip|track|video|audio)/)) {
    return { type: "timeline", params: {} };
  }
  if (lower.match(/(?:trim|split|cut|crop|move|duplicate|reverse|speed|delete|remove)\s+(?:the\s+)?(?:clip|track|video|audio)?/)) {
    return { type: "timeline", params: {} };
  }

  // Image patterns
  if (lower.match(/(?:image|picture|photo|illustration|banner|thumbnail)/)) {
    const prompt = input.replace(/(?:generate|create|make|draw)\s+(?:an?\s+)?/i, "")
      .replace(/(?:image|picture|photo|illustration)\s+(?:of\s+)?/i, "")
      .trim();
    return { type: "image", params: { prompt: prompt || input } };
  }

  // TTS patterns
  if (lower.match(/(?:audio|voice|speech|tts|narration|voiceover|message|say)/)) {
    const text = input.replace(/(?:generate|create|make)\s+(?:an?\s+)?/i, "")
      .replace(/(?:audio|voice|speech|tts|narration|voiceover)\s*(?:message\s+)?(?:saying\s+|of\s+|for\s+)?/i, "")
      .replace(/["']/g, "")
      .trim();
    return { type: "tts", params: { text: text || "Hello" } };
  }

  // SFX patterns
  if (lower.match(/(?:sound\s*effect|sfx|sound\s+of)/)) {
    const prompt = input.replace(/(?:generate|create|make)\s+(?:an?\s+)?/i, "")
      .replace(/(?:sound\s*effect|sfx|sound)\s+(?:of\s+)?/i, "")
      .trim();
    return { type: "sfx", params: { prompt: prompt || input } };
  }

  // Project patterns
  if (lower.match(/(?:new|create|start|make)\s+(?:a\s+)?(?:new\s+)?project/)) {
    const nameMatch = input.match(/(?:called|named)\s+["']?([^"']+)["']?/i);
    return { type: "project", params: { projectName: nameMatch?.[1]?.trim() || "Untitled" } };
  }

  // Add media patterns (add X to project/timeline)
  if (lower.match(/(?:add|include|import)\s+.+\s+(?:to|into)\s+(?:the\s+)?(?:project|timeline)/)) {
    const filenameMatch = input.match(/(?:add|include|import)\s+["']?([^\s"']+\.[a-z0-9]+)["']?/i);
    if (filenameMatch) {
      return { type: "add-media", params: { filename: filenameMatch[1] } };
    }
  }

  // Generic timeline patterns (broader catch)
  if (lower.match(/(?:fade|effect|transition|blur|filter|trim|split|cut|crop|move|duplicate|reverse|speed|opacity|volume|brightness|contrast|saturation)/)) {
    return { type: "timeline", params: {} };
  }

  return { type: "unknown", params: {}, clarification: "I couldn't understand that command. Try: 'generate an image of...', 'create audio saying...', or 'add file.mp4 to project'" };
}

/**
 * Generate image using Gemini
 */
async function generateImage(prompt: string, outputFile: string): Promise<CommandResult> {
  const spinner = ora({ text: `Generating image: "${prompt}"...`, spinner: "dots", discardStdin: false }).start();

  try {
    const apiKey = await getApiKeyFromConfig("google");
    if (!apiKey) {
      spinner.fail();
      return {
        success: false,
        message: error("Google API key not configured. Run 'vibe setup --full' or set GOOGLE_API_KEY."),
      };
    }

    const provider = new GeminiProvider();
    await provider.initialize({ apiKey });

    const result = await provider.generateImage(prompt, { aspectRatio: "1:1" });

    if (!result.images || result.images.length === 0) {
      spinner.fail();
      return { success: false, message: error("No image generated") };
    }

    // Save the image
    const outputPath = resolve(process.cwd(), outputFile);
    const imageData = result.images[0].base64;
    await writeFile(outputPath, Buffer.from(imageData, "base64"));

    spinner.succeed();
    return {
      success: true,
      message: success(`Image saved: ${outputFile}`),
    };
  } catch (e: unknown) {
    spinner.fail();
    const errorMessage = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: error(`Image generation failed: ${errorMessage}`),
    };
  }
}

/**
 * Generate TTS using ElevenLabs
 */
async function generateTTS(text: string, outputFile: string): Promise<CommandResult> {
  const spinner = ora({ text: `Generating audio: "${text.slice(0, 30)}..."`, spinner: "dots", discardStdin: false }).start();

  try {
    const apiKey = await getApiKeyFromConfig("elevenlabs");
    if (!apiKey) {
      spinner.fail();
      return {
        success: false,
        message: error("ElevenLabs API key not configured. Run 'vibe setup --full' or set ELEVENLABS_API_KEY."),
      };
    }

    const provider = new ElevenLabsProvider();
    await provider.initialize({ apiKey });

    const result = await provider.textToSpeech(text, {
      voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel (default)
    });

    if (!result.success || !result.audioBuffer) {
      spinner.fail();
      return { success: false, message: error(result.error || "TTS generation failed") };
    }

    // Save the audio
    const outputPath = resolve(process.cwd(), outputFile);
    await writeFile(outputPath, result.audioBuffer);

    spinner.succeed();
    return {
      success: true,
      message: success(`Audio saved: ${outputFile}`),
    };
  } catch (e: unknown) {
    spinner.fail();
    const errorMessage = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: error(`TTS generation failed: ${errorMessage}`),
    };
  }
}

/**
 * Generate sound effect using ElevenLabs
 */
async function generateSFX(prompt: string, outputFile: string): Promise<CommandResult> {
  const spinner = ora({ text: `Generating sound effect: "${prompt}"...`, spinner: "dots", discardStdin: false }).start();

  try {
    const apiKey = await getApiKeyFromConfig("elevenlabs");
    if (!apiKey) {
      spinner.fail();
      return {
        success: false,
        message: error("ElevenLabs API key not configured. Run 'vibe setup --full' or set ELEVENLABS_API_KEY."),
      };
    }

    const provider = new ElevenLabsProvider();
    await provider.initialize({ apiKey });

    const result = await provider.generateSoundEffect(prompt, {});

    if (!result.success || !result.audioBuffer) {
      spinner.fail();
      return { success: false, message: error(result.error || "SFX generation failed") };
    }

    // Save the audio
    const outputPath = resolve(process.cwd(), outputFile);
    await writeFile(outputPath, result.audioBuffer);

    spinner.succeed();
    return {
      success: true,
      message: success(`Sound effect saved: ${outputFile}`),
    };
  } catch (e: unknown) {
    spinner.fail();
    const errorMessage = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: error(`SFX generation failed: ${errorMessage}`),
    };
  }
}

/** Parse a built-in command into parts */
function parseBuiltinCommand(input: string): { cmd: string; args: string[] } {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  return { cmd, args };
}

/** Check if input looks like a simple built-in command (not natural language) */
function isBuiltinCommand(input: string): boolean {
  const { cmd } = parseBuiltinCommand(input);
  const lower = input.toLowerCase();

  // Natural language hints - if ANY match, route to LLM
  const naturalLanguageKeywords = [
    // Timeline operation keywords
    /\b(?:fade|effect|transition|trim|split|cut|crop|move|duplicate|reverse|speed|blur|filter|opacity|volume|brightness|contrast|saturation)\b/,
    // Phrases indicating NL
    /\bto (?:the )?(?:clip|track|timeline|project|video|audio)\b/,
    /\b(?:please|can you|could you|want to|would like|i need|make it|change the)\b/,
    // Creative commands
    /\b(?:generate|create|make|draw)\s+(?:an?\s+)?(?:image|picture|audio|video|sound|animation)\b/,
    // Descriptive phrases
    /\b(?:saying|named|called|about|featuring|showing|depicting)\b/,
    // Action words that suggest NL
    /\b(?:intro|outro|animation|banner|thumbnail|welcome|goodbye)\b/,
  ];

  for (const pattern of naturalLanguageKeywords) {
    if (pattern.test(lower)) {
      return false; // Natural language → LLM handles it
    }
  }

  // Simple builtin patterns - only these exact forms are treated as builtins
  const simpleBuiltins: Record<string, RegExp> = {
    exit: /^(?:exit|quit|q)$/i,
    quit: /^(?:exit|quit|q)$/i,
    q: /^(?:exit|quit|q)$/i,
    help: /^help$/i,
    setup: /^setup(?:\s+--full)?$/i,
    clear: /^clear$/i,
    new: /^new(?:\s+[\w-]+)?$/i, // "new" alone or "new my-project" (simple name only, no spaces)
    open: /^open\s+.+\.(?:vibe\.)?json$/i, // "open file.vibe.json"
    save: /^save(?:\s+.+\.(?:vibe\.)?json)?$/i,
    info: /^info$/i,
    list: /^list$/i,
    add: /^add(?:\s+[\w./-]+\.\w+)?$/i, // "add" alone or "add file.mp4" (filename only)
    export: /^export(?:\s+[\w./-]+)?$/i,
    undo: /^undo$/i,
  };

  const pattern = simpleBuiltins[cmd];
  return pattern ? pattern.test(input.trim()) : false;
}

/**
 * Execute a command in the REPL
 */
export async function executeReplCommand(
  input: string,
  session: Session
): Promise<CommandResult> {
  const trimmed = input.trim();

  if (!trimmed) {
    return { success: true, message: "" };
  }

  // Handle built-in commands
  if (isBuiltinCommand(trimmed)) {
    return executeBuiltinCommand(trimmed, session);
  }

  // Handle natural language commands
  return executeNaturalLanguageCommand(trimmed, session);
}

/**
 * Execute a built-in command
 */
async function executeBuiltinCommand(
  input: string,
  session: Session
): Promise<CommandResult> {
  const { cmd, args } = parseBuiltinCommand(input);

  switch (cmd) {
    case "exit":
    case "quit":
    case "q":
      return { success: true, message: "Goodbye!", shouldExit: true };

    case "help":
      return { success: true, message: getHelpText() };

    case "setup":
      return { success: true, message: "", showSetup: true };

    case "clear":
      console.clear();
      return { success: true, message: "" };

    case "new": {
      const name = args.join(" ") || "Untitled Project";
      session.createProject(name);
      return { success: true, message: success(`Created project: ${name}`) };
    }

    case "open": {
      if (args.length === 0) {
        return { success: false, message: error("Usage: open <project-file>") };
      }
      const filePath = args.join(" ");
      try {
        await session.loadProject(filePath);
        const summary = session.getProjectSummary();
        return {
          success: true,
          message: success(`Opened: ${summary?.name || filePath}`),
        };
      } catch (e) {
        return { success: false, message: error(`Failed to open: ${e}`) };
      }
    }

    case "save": {
      if (!session.hasProject()) {
        return { success: false, message: error("No project to save. Use 'new' first.") };
      }
      try {
        const filePath = args.length > 0 ? args.join(" ") : undefined;
        const savedPath = await session.saveProject(filePath);
        return { success: true, message: success(`Saved to: ${savedPath}`) };
      } catch (e) {
        return { success: false, message: error(`Failed to save: ${e}`) };
      }
    }

    case "info": {
      const summary = session.getProjectSummary();
      if (!summary) {
        return { success: false, message: error("No project loaded. Use 'new' or 'open' first.") };
      }
      return { success: true, message: formatProjectInfo(summary) };
    }

    case "list": {
      if (!session.hasProject()) {
        return { success: false, message: error("No project loaded. Use 'new' or 'open' first.") };
      }
      const project = session.getProject();
      return { success: true, message: formatTimeline(project) };
    }

    case "add": {
      if (args.length === 0) {
        return { success: false, message: error("Usage: add <media-file>") };
      }
      if (!session.hasProject()) {
        return { success: false, message: error("No project loaded. Use 'new' first.") };
      }

      const mediaPath = args.join(" ");
      const { exists, absPath } = session.checkMediaExists(mediaPath);

      if (!exists) {
        return { success: false, message: error(`File not found: ${mediaPath}`) };
      }

      session.pushHistory("add source");
      const project = session.getProject();

      // Determine media type from extension
      const ext = extname(absPath).toLowerCase();
      const audioExts = [".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac"];
      const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

      let mediaType: "video" | "audio" | "image" = "video";
      if (audioExts.includes(ext)) mediaType = "audio";
      else if (imageExts.includes(ext)) mediaType = "image";

      // Add source
      const source = project.addSource({
        name: absPath.split("/").pop() || "media",
        type: mediaType,
        url: absPath,
        duration: 10, // Placeholder - would need ffprobe for actual duration
        width: 1920,
        height: 1080,
      });

      // Also add a clip to the timeline
      const tracks = project.getTracksByType(mediaType === "audio" ? "audio" : "video");
      const trackId = tracks.length > 0 ? tracks[0].id : project.getTracks()[0]?.id;

      if (trackId) {
        const existingClips = project.getClipsByTrack(trackId);
        const startTime = existingClips.reduce(
          (max, c) => Math.max(max, c.startTime + c.duration),
          0
        );

        project.addClip({
          sourceId: source.id,
          trackId,
          startTime,
          duration: source.duration,
          sourceStartOffset: 0,
          sourceEndOffset: source.duration,
        });
      }

      return { success: true, message: success(`Added: ${source.name}`) };
    }

    case "export": {
      if (!session.hasProject()) {
        return { success: false, message: error("No project loaded.") };
      }

      // Get output path
      const outputPath = args.length > 0
        ? args.join(" ")
        : `${session.getProjectName()?.replace(/\s+/g, "-").toLowerCase() || "output"}.mp4`;

      return {
        success: true,
        message: info(`Export command: vibe export ${session.getProjectPath() || "<project>"} -o ${outputPath}`),
      };
    }

    case "undo": {
      const undone = session.undo();
      if (undone) {
        return { success: true, message: success(`Undone: ${undone}`) };
      }
      return { success: false, message: warn("Nothing to undo") };
    }

    default:
      return { success: false, message: error(`Unknown command: ${cmd}`) };
  }
}

/**
 * Execute a natural language command using AI
 * Uses LLM to classify intent and route to appropriate handler
 */
async function executeNaturalLanguageCommand(
  input: string,
  session: Session
): Promise<CommandResult> {
  // Get configured LLM provider
  const config = await loadConfig();
  const llmProviderType: LLMProvider = config?.llm?.provider || "openai";

  // Map provider type to API key name
  const providerKeyMap: Record<LLMProvider, string> = {
    claude: "anthropic",
    openai: "openai",
    gemini: "google",
    ollama: "ollama",
  };

  const apiKeyName = providerKeyMap[llmProviderType];
  const apiKey = await getApiKeyFromConfig(apiKeyName);

  if (!apiKey && llmProviderType !== "ollama") {
    return {
      success: false,
      message: error(
        `${llmProviderType.charAt(0).toUpperCase() + llmProviderType.slice(1)} API key not configured.\n` +
        "   Run 'vibe setup' to configure your API key."
      ),
    };
  }

  const spinner = ora({ text: "Understanding command...", spinner: "dots", discardStdin: false }).start();

  try {
    // Use LLM to classify the command
    const intent = await classifyCommand(input, apiKey || "", llmProviderType);

    // Handle clarification
    if (intent.clarification && intent.type === "unknown") {
      spinner.warn();
      return { success: false, message: warn(intent.clarification) };
    }

    // Route based on intent type
    switch (intent.type) {
      case "image": {
        spinner.text = `Generating image: "${intent.params.prompt}"...`;
        const prompt = String(intent.params.prompt || input);
        const outputFile = String(intent.params.outputFile || `${prompt.split(/\s+/).slice(0, 3).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "")}.png`);
        spinner.stop();
        return await generateImage(prompt, outputFile);
      }

      case "tts": {
        const text = String(intent.params.text || intent.params.prompt || "Hello");
        spinner.text = `Generating audio: "${text.slice(0, 30)}..."`;
        const outputFile = String(intent.params.outputFile || "output.mp3");
        spinner.stop();
        return await generateTTS(text, outputFile);
      }

      case "sfx": {
        const prompt = String(intent.params.prompt || input);
        spinner.text = `Generating sound effect: "${prompt}"...`;
        const outputFile = String(intent.params.outputFile || "sound-effect.mp3");
        spinner.stop();
        return await generateSFX(prompt, outputFile);
      }

      case "video": {
        spinner.fail();
        return {
          success: false,
          message: info("Video generation is available via CLI:\n  vibe ai video \"" + (intent.params.prompt || "your prompt") + "\" -o output.mp4"),
        };
      }

      case "project": {
        spinner.stop();
        const name = String(intent.params.projectName || "Untitled Project");
        session.createProject(name);
        return { success: true, message: success(`Created project: ${name}`) };
      }

      case "add-media": {
        spinner.stop();

        if (!session.hasProject()) {
          return {
            success: false,
            message: error("No project loaded. Use 'new <name>' to create one first."),
          };
        }

        const filename = String(intent.params.filename || "");
        if (!filename) {
          return {
            success: false,
            message: error("No filename specified. Try: 'add sunset.png to project'"),
          };
        }

        const { exists, absPath } = session.checkMediaExists(filename);
        if (!exists) {
          return { success: false, message: error(`File not found: ${filename}`) };
        }

        session.pushHistory("add source");
        const project = session.getProject();

        // Determine media type from extension
        const ext = extname(absPath).toLowerCase();
        const audioExts = [".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac"];
        const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

        let mediaType: "video" | "audio" | "image" = "video";
        if (audioExts.includes(ext)) mediaType = "audio";
        else if (imageExts.includes(ext)) mediaType = "image";

        // Add source
        const source = project.addSource({
          name: absPath.split("/").pop() || "media",
          type: mediaType,
          url: absPath,
          duration: 10,
          width: 1920,
          height: 1080,
        });

        // Also add a clip to the timeline
        const tracks = project.getTracksByType(mediaType === "audio" ? "audio" : "video");
        const trackId = tracks.length > 0 ? tracks[0].id : project.getTracks()[0]?.id;

        if (trackId) {
          const existingClips = project.getClipsByTrack(trackId);
          const startTime = existingClips.reduce(
            (max, c) => Math.max(max, c.startTime + c.duration),
            0
          );

          project.addClip({
            sourceId: source.id,
            trackId,
            startTime,
            duration: source.duration,
            sourceStartOffset: 0,
            sourceEndOffset: source.duration,
          });
        }

        return { success: true, message: success(`Added: ${source.name}`) };
      }

      case "timeline": {
        // Check if project exists for timeline commands
        if (!session.hasProject()) {
          spinner.fail();
          return {
            success: false,
            message: error("No project loaded. Use 'new <name>' to create one first."),
          };
        }

        spinner.text = "Processing timeline command...";

        // Create the appropriate LLM provider for timeline parsing
        let llmProvider: OpenAIProvider | ClaudeProvider | OllamaProvider;

        if (llmProviderType === "claude") {
          llmProvider = new ClaudeProvider();
        } else if (llmProviderType === "ollama") {
          llmProvider = new OllamaProvider();
        } else {
          llmProvider = new OpenAIProvider();
        }

        await llmProvider.initialize({ apiKey: apiKey || "" });

        const project = session.getProject();
        const clips = project.getClips();
        const tracks = project.getTracks().map((t) => t.id);

        // Parse timeline command using LLM
        const result = await llmProvider.parseCommand(input, { clips, tracks });

        if (!result.success) {
          spinner.fail();
          return { success: false, message: error(result.error || "Failed to parse command") };
        }

        if (result.clarification) {
          spinner.warn();
          return { success: false, message: warn(result.clarification) };
        }

        if (result.commands.length === 0) {
          spinner.warn();
          return { success: false, message: warn("No commands generated") };
        }

        // Save state for undo
        session.pushHistory(input);

        // Execute commands
        let executed = 0;
        for (const cmd of result.commands) {
          const ok = executeCommand(project, cmd);
          if (ok) executed++;
        }

        // Auto-save if enabled
        const sessionConfig = session.getConfig();
        if (sessionConfig?.repl.autoSave && session.getProjectPath()) {
          await session.saveProject();
        }

        spinner.succeed();

        // Build result message
        const cmdDescriptions = result.commands
          .map((c) => `  ${chalk.dim("-")} ${c.description}`)
          .join("\n");

        return {
          success: true,
          message: success(`Executed ${executed}/${result.commands.length} command(s)\n${cmdDescriptions}`),
        };
      }

      default: {
        spinner.warn();
        return {
          success: false,
          message: warn(intent.clarification || "I couldn't understand that command. Try:\n  • generate an image of...\n  • create audio saying...\n  • trim clip to 5 seconds"),
        };
      }
    }
  } catch (e) {
    spinner.fail();
    return { success: false, message: error(`Command failed: ${e}`) };
  }
}

/**
 * Format timeline for display
 */
function formatTimeline(project: Project): string {
  const tracks = project.getTracks();
  const clips = project.getClips();
  const sources = project.getSources();

  const lines = [
    "",
    chalk.bold.cyan("Timeline"),
    chalk.dim("─".repeat(40)),
    "",
  ];

  // Sources
  lines.push(chalk.bold("Sources:"));
  if (sources.length === 0) {
    lines.push(chalk.dim("  (none)"));
  } else {
    for (const src of sources) {
      lines.push(`  ${chalk.yellow(src.id.slice(0, 8))} ${src.name} ${chalk.dim(`[${src.type}]`)}`);
    }
  }
  lines.push("");

  // Tracks with clips
  lines.push(chalk.bold("Tracks:"));
  for (const track of tracks) {
    const trackClips = clips.filter((c) => c.trackId === track.id);
    lines.push(`  ${chalk.cyan(track.name)} ${chalk.dim(`(${track.type})`)}`);

    if (trackClips.length === 0) {
      lines.push(chalk.dim("    (empty)"));
    } else {
      for (const clip of trackClips.sort((a, b) => a.startTime - b.startTime)) {
        const src = sources.find((s) => s.id === clip.sourceId);
        const srcName = src?.name || "unknown";
        lines.push(
          `    ${chalk.yellow(clip.id.slice(0, 8))} ` +
          `${chalk.dim("@")}${clip.startTime.toFixed(1)}s ` +
          `${chalk.dim("dur:")}${clip.duration.toFixed(1)}s ` +
          `${chalk.dim("src:")}${srcName}`
        );
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

import { projectTools, handleProjectToolCall } from "./project.js";
import { timelineTools, handleTimelineToolCall } from "./timeline.js";
import { exportTools, handleExportToolCall } from "./export.js";
import { aiEditingTools, handleAiEditingToolCall } from "./ai-editing.js";
import { aiAnalysisTools, handleAiAnalysisToolCall } from "./ai-analysis.js";
import { aiPipelineTools, handleAiPipelineToolCall } from "./ai-pipelines.js";
import { aiGenerationTools, handleAiGenerationToolCall } from "./ai-generation.js";
import { detectionTools, handleDetectionToolCall } from "./detection.js";
import { aiVideoTools, handleAiVideoToolCall } from "./ai-video.js";
import { aiAudioTools, handleAiAudioToolCall } from "./ai-audio.js";
import { aiEditAdvancedTools, handleAiEditAdvancedToolCall } from "./ai-edit-advanced.js";
import { sceneTools, handleSceneToolCall } from "./scene.js";

export const tools = [
  ...projectTools,
  ...timelineTools,
  ...exportTools,
  ...aiEditingTools,
  ...aiAnalysisTools,
  ...aiPipelineTools,
  ...aiGenerationTools,
  ...detectionTools,
  ...aiVideoTools,
  ...aiAudioTools,
  ...aiEditAdvancedTools,
  ...sceneTools,
];

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<string>;

const handlers: Record<string, ToolHandler> = {};
for (const t of projectTools) handlers[t.name] = handleProjectToolCall;
for (const t of timelineTools) handlers[t.name] = handleTimelineToolCall;
for (const t of exportTools) handlers[t.name] = handleExportToolCall;
for (const t of aiEditingTools) handlers[t.name] = handleAiEditingToolCall;
for (const t of aiAnalysisTools) handlers[t.name] = handleAiAnalysisToolCall;
for (const t of aiPipelineTools) handlers[t.name] = handleAiPipelineToolCall;
for (const t of aiGenerationTools) handlers[t.name] = handleAiGenerationToolCall;
for (const t of detectionTools) handlers[t.name] = handleDetectionToolCall;
for (const t of aiVideoTools) handlers[t.name] = handleAiVideoToolCall;
for (const t of aiAudioTools) handlers[t.name] = handleAiAudioToolCall;
for (const t of aiEditAdvancedTools) handlers[t.name] = handleAiEditAdvancedToolCall;
for (const t of sceneTools) handlers[t.name] = handleSceneToolCall;

// Pre-compute required args per tool from each inputSchema for O(1) dispatch-time validation.
// Fixes the class of bugs where handlers stringify `undefined` into filenames / URLs / prompts
// when a required arg is missing — neither MCP SDK nor our dispatcher was enforcing `required`.
const requiredByTool: Record<string, string[]> = {};
for (const t of tools) {
  const req = (t.inputSchema as { required?: string[] }).required;
  if (req && req.length > 0) requiredByTool[t.name] = req;
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);

    const required = requiredByTool[name];
    if (required) {
      const missing = required.filter((k) => args[k] === undefined || args[k] === null);
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `${name} failed: missing required argument${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
            },
          ],
        };
      }
    }

    const result = await handler(name, args);
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}

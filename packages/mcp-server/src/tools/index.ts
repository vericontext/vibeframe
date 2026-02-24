import { projectTools, handleProjectToolCall } from "./project.js";
import { timelineTools, handleTimelineToolCall } from "./timeline.js";
import { exportTools, handleExportToolCall } from "./export.js";
import { aiEditingTools, handleAiEditingToolCall } from "./ai-editing.js";
import { aiAnalysisTools, handleAiAnalysisToolCall } from "./ai-analysis.js";
import { aiPipelineTools, handleAiPipelineToolCall } from "./ai-pipelines.js";

export const tools = [
  ...projectTools,
  ...timelineTools,
  ...exportTools,
  ...aiEditingTools,
  ...aiAnalysisTools,
  ...aiPipelineTools,
];

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<string>;

const handlers: Record<string, ToolHandler> = {};
for (const t of projectTools) handlers[t.name] = handleProjectToolCall;
for (const t of timelineTools) handlers[t.name] = handleTimelineToolCall;
for (const t of exportTools) handlers[t.name] = handleExportToolCall;
for (const t of aiEditingTools) handlers[t.name] = handleAiEditingToolCall;
for (const t of aiAnalysisTools) handlers[t.name] = handleAiAnalysisToolCall;
for (const t of aiPipelineTools) handlers[t.name] = handleAiPipelineToolCall;

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
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

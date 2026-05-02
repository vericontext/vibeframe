/**
 * @module ai-suggest-edit
 * @description Library function for AI suggest. Powers `analyze suggest` via the
 * manifest tool `analyze_suggest_edit`. The legacy `vibe ai suggest/edit/storyboard`
 * Commander registrations were removed alongside the dead `commands/ai.ts`
 * orchestrator (the `vibe ai *` namespace was never `addCommand`'d to `program`).
 *
 * @see MODELS.md for AI model configuration
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GeminiProvider, type EditSuggestion } from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../engine/index.js";
import { applySuggestion } from "./ai-helpers.js";

export interface ExecuteSuggestEditOptions {
  projectPath: string;
  instruction: string;
  apply?: boolean;
  apiKey?: string;
}

export interface SuggestEditEntry {
  type: EditSuggestion["type"];
  description: string;
  confidence: number;
  clipIds: string[];
  params: Record<string, unknown>;
}
export interface ExecuteSuggestEditResult {
  success: boolean;
  suggestions?: SuggestEditEntry[];
  applied?: boolean;
  appliedSuggestion?: SuggestEditEntry;
  outputPath?: string;
  error?: string;
}

export async function executeSuggestEdit(
  options: ExecuteSuggestEditOptions
): Promise<ExecuteSuggestEditResult> {
  try {
    const apiKey = options.apiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) return { success: false, error: "GOOGLE_API_KEY required for suggest" };

    const filePath = resolve(process.cwd(), options.projectPath);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey });

    const clips = project.getClips();
    const suggestions = (await gemini.autoEdit(clips, options.instruction)) as SuggestEditEntry[];

    if (options.apply && suggestions.length > 0) {
      const first = suggestions[0];
      const applied = applySuggestion(project, first);
      if (applied) {
        await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
        return {
          success: true,
          suggestions,
          applied: true,
          appliedSuggestion: first,
          outputPath: filePath,
        };
      }
      return { success: true, suggestions, applied: false };
    }

    return { success: true, suggestions };
  } catch (error) {
    return {
      success: false,
      error: `Suggest failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

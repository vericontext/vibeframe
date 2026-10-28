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
import { requireConfiguredApiKey } from "../utils/api-key.js";
import { executorFailure, failureFromError, type StructuredError } from "./output.js";

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
  /** The structured error on failure; see {@link ExecutorFailure}. */
  failure?: StructuredError;
}

export async function executeSuggestEdit(
  options: ExecuteSuggestEditOptions
): Promise<ExecuteSuggestEditResult> {
  // A missing key throws ApiKeyError (API_KEY_MISSING), outside the catch below.
  const apiKey = await requireConfiguredApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
  try {

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
    return executorFailure(failureFromError(error, "Suggest failed"));
  }
}

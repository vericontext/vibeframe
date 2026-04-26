/**
 * Video as Code — Pipeline type definitions
 *
 * A pipeline is a declarative YAML file that defines a sequence of steps.
 * Each step maps to an existing execute function in the CLI.
 */

/** Supported pipeline actions (maps to execute functions) */
export type PipelineAction =
  // Generate
  | "generate-image"
  | "generate-video"
  | "generate-tts"
  | "generate-sfx"
  | "generate-music"
  | "generate-storyboard"
  | "generate-motion"
  // Edit
  | "edit-silence-cut"
  | "edit-jump-cut"
  | "edit-caption"
  | "edit-noise-reduce"
  | "edit-fade"
  | "edit-translate-srt"
  | "edit-text-overlay"
  | "edit-grade"
  | "edit-speed-ramp"
  | "edit-reframe"
  | "edit-interpolate"
  | "edit-upscale"
  | "edit-image"
  // Audio
  | "audio-transcribe"
  | "audio-isolate"
  | "audio-dub"
  | "audio-duck"
  // Detect
  | "detect-scenes"
  | "detect-silence"
  | "detect-beats"
  // Analyze
  | "analyze-video"
  | "analyze-media"
  // Review
  | "review-video"
  // Scene composition (v0.59+)
  | "compose-scenes-with-skills"
  // Meta
  | "export";

/** A single step in the pipeline */
export interface PipelineStep {
  /** Unique step identifier (used for variable references) */
  id: string;
  /** Action to execute */
  action: PipelineAction;
  /** Step parameters (action-specific, may contain $refs) */
  [key: string]: unknown;
}

/** Effort level passed to LLM providers (maps to Anthropic Opus 4.7 effort) */
export type EffortLevel = "low" | "medium" | "high" | "xhigh";

/** Pipeline budget — aborts execution when any ceiling is hit */
export interface PipelineBudget {
  /** Max estimated USD (uses COST_ESTIMATES.max per action) */
  costUsd?: number;
  /** Max total token budget (tracked when provider returns usage) */
  tokens?: number;
  /** Max number of failed steps before aborting */
  maxToolErrors?: number;
}

/** Pipeline manifest (parsed from YAML) */
export interface PipelineManifest {
  /** Pipeline name */
  name: string;
  /** Optional description */
  description?: string;
  /** Pipeline version */
  version?: number;
  /** Steps to execute */
  steps: PipelineStep[];
  /** Cost / error ceilings enforced by the executor */
  budget?: PipelineBudget;
  /** Default effort level for LLM-backed steps (Opus 4.7 Task Budgets) */
  effort?: EffortLevel;
}

/** Result of a single step execution */
export interface StepResult {
  id: string;
  action: PipelineAction;
  success: boolean;
  /** Primary output path */
  output?: string;
  /** All result data (action-specific) */
  data?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Execution time in ms */
  duration?: number;
}

/** Running budget usage after execution */
export interface BudgetUsage {
  /** Upper-bound estimated USD used (sum of max cost per completed step) */
  estimatedCostUsd: number;
  /** Total tokens consumed (when providers report usage) */
  tokensUsed: number;
  /** Failed steps count */
  toolErrors: number;
  /** Set if execution aborted due to a budget ceiling */
  abortedBy?: "costUsd" | "tokens" | "maxToolErrors";
}

/** Result of full pipeline execution */
export interface PipelineResult {
  success: boolean;
  name: string;
  steps: StepResult[];
  completedSteps: number;
  totalSteps: number;
  totalDuration?: number;
  outputDir?: string;
  error?: string;
  /** Budget usage when a budget was configured */
  budget?: BudgetUsage;
}

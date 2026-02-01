import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  VideoResult,
} from "../interface/types";

/**
 * Video upscale options
 */
export interface ReplicateUpscaleOptions {
  /** Scale factor: 2 or 4 */
  scale?: 2 | 4;
  /** Model to use */
  model?: "real-esrgan" | "topaz";
}

/**
 * Video upscale result
 */
export interface ReplicateUpscaleResult {
  success: boolean;
  /** Output video URL */
  videoUrl?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Video inpainting options
 */
export interface ReplicateInpaintOptions {
  /** Object to remove (text description) */
  target?: string;
  /** Mask video file path or URL */
  maskVideo?: string;
}

/**
 * Music generation options
 */
export interface MusicGenerationOptions {
  /** Duration in seconds (1-30) */
  duration?: number;
  /** Reference melody audio URL for melody conditioning */
  melodyUrl?: string;
  /** Model variant: large, stereo-large, melody-large, stereo-melody-large */
  model?: "large" | "stereo-large" | "melody-large" | "stereo-melody-large";
  /** Classifier free guidance (higher = more prompt adherence) */
  cfgCoef?: number;
  /** Top-k sampling */
  topK?: number;
  /** Temperature for sampling */
  temperature?: number;
}

/**
 * Music generation result
 */
export interface MusicGenerationResult {
  success: boolean;
  /** Audio URL from Replicate */
  audioUrl?: string;
  /** Task ID for async polling */
  taskId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Audio restoration options
 */
export interface AudioRestorationOptions {
  /** Enable noise reduction */
  denoise?: boolean;
  /** Enable audio enhancement */
  enhance?: boolean;
  /** Denoising level (0-1, higher = more aggressive) */
  denoiseLevel?: number;
}

/**
 * Audio restoration result
 */
export interface AudioRestorationResult {
  success: boolean;
  /** Audio URL from Replicate */
  audioUrl?: string;
  /** Task ID for async polling */
  taskId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Replicate prediction response
 */
interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[];
  error?: string;
  urls?: {
    get: string;
    cancel: string;
  };
}

/**
 * Replicate provider for video processing tasks
 * Uses Replicate's API to run various AI models
 */
export class ReplicateProvider implements AIProvider {
  id = "replicate";
  name = "Replicate";
  description = "AI video processing, music generation, and audio restoration";
  capabilities: AICapability[] = ["video-upscale", "video-inpaint", "music-generation", "audio-restoration"];
  iconUrl = "/icons/replicate.svg";
  isAvailable = true;

  private apiToken?: string;
  private baseUrl = "https://api.replicate.com/v1";
  private pollingInterval = 3000;

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiToken = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiToken;
  }

  /**
   * Upscale video using Real-ESRGAN
   */
  async upscaleVideo(
    videoUrl: string,
    options: ReplicateUpscaleOptions = {}
  ): Promise<VideoResult> {
    if (!this.isConfigured()) {
      return {
        id: "",
        status: "failed",
        error: "Replicate API token not configured. Set REPLICATE_API_TOKEN",
      };
    }

    try {
      const scale = options.scale || 2;
      const model = options.model || "real-esrgan";

      // Model versions (these are well-known stable versions)
      const modelVersions: Record<string, string> = {
        "real-esrgan": "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
        "topaz": "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa", // fallback to real-esrgan
      };

      const version = modelVersions[model] || modelVersions["real-esrgan"];

      const response = await fetch(`${this.baseUrl}/predictions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          version: version.split(":")[1],
          input: {
            video: videoUrl,
            scale,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.error || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          id: "",
          status: "failed",
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const prediction = (await response.json()) as ReplicatePrediction;

      return {
        id: prediction.id,
        status: "pending",
        progress: 0,
      };
    } catch (error) {
      return {
        id: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Inpaint video (remove objects)
   */
  async inpaintVideo(
    videoUrl: string,
    options: ReplicateInpaintOptions = {}
  ): Promise<VideoResult> {
    if (!this.isConfigured()) {
      return {
        id: "",
        status: "failed",
        error: "Replicate API token not configured. Set REPLICATE_API_TOKEN",
      };
    }

    if (!options.target && !options.maskVideo) {
      return {
        id: "",
        status: "failed",
        error: "Either target description or mask video is required",
      };
    }

    try {
      // Using ProPainter model for video inpainting
      const version = "sczhou/propainter:1d0b4c1d7296db4db6bf92dd43d2d38cf2e855a5e5e04e0c7f4e83f5ce59f6e9";

      const input: Record<string, unknown> = {
        video: videoUrl,
      };

      if (options.maskVideo) {
        input.mask = options.maskVideo;
      }

      // If target is specified without mask, we need to use a segmentation model first
      // For now, require mask for video inpainting
      if (options.target && !options.maskVideo) {
        return {
          id: "",
          status: "failed",
          error: "Text-based target removal requires a mask video. Please provide --mask option.",
        };
      }

      const response = await fetch(`${this.baseUrl}/predictions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          version: version.split(":")[1],
          input,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.error || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          id: "",
          status: "failed",
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const prediction = (await response.json()) as ReplicatePrediction;

      return {
        id: prediction.id,
        status: "pending",
        progress: 0,
      };
    } catch (error) {
      return {
        id: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get prediction status
   */
  async getPredictionStatus(id: string): Promise<VideoResult> {
    if (!this.isConfigured()) {
      return {
        id,
        status: "failed",
        error: "Replicate API token not configured",
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/predictions/${id}`, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          id,
          status: "failed",
          error: `Failed to get status: ${errorText}`,
        };
      }

      const prediction = (await response.json()) as ReplicatePrediction;

      const statusMap: Record<string, VideoResult["status"]> = {
        starting: "pending",
        processing: "processing",
        succeeded: "completed",
        failed: "failed",
        canceled: "cancelled",
      };

      const result: VideoResult = {
        id: prediction.id,
        status: statusMap[prediction.status] || "pending",
      };

      if (prediction.status === "succeeded" && prediction.output) {
        // Output can be string or array
        const outputUrl = Array.isArray(prediction.output)
          ? prediction.output[0]
          : prediction.output;
        result.videoUrl = outputUrl;
      }

      if (prediction.status === "failed") {
        result.error = prediction.error || "Processing failed";
      }

      return result;
    } catch (error) {
      return {
        id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Wait for prediction to complete
   */
  async waitForCompletion(
    id: string,
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 600000
  ): Promise<VideoResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getPredictionStatus(id);

      if (onProgress) {
        onProgress(result);
      }

      if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
        return result;
      }

      await this.sleep(this.pollingInterval);
    }

    return {
      id,
      status: "failed",
      error: "Processing timed out",
    };
  }

  /**
   * Cancel a prediction
   */
  async cancelPrediction(id: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/predictions/${id}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate music from text prompt using MusicGen
   */
  async generateMusic(
    prompt: string,
    options: MusicGenerationOptions = {}
  ): Promise<MusicGenerationResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "Replicate API token not configured. Set REPLICATE_API_TOKEN",
      };
    }

    try {
      const duration = Math.max(1, Math.min(30, options.duration || 8));
      const model = options.model || "stereo-large";

      // MusicGen model on Replicate
      const modelVersions: Record<string, string> = {
        "large": "meta/musicgen:7be0f12c54a8d033a0fbd14418c9af98962da9a86f5ff7811f9b3423a1f0b7d7",
        "stereo-large": "meta/musicgen:stereo-large",
        "melody-large": "meta/musicgen:melody-large",
        "stereo-melody-large": "meta/musicgen:stereo-melody-large",
      };

      const version = modelVersions[model] || modelVersions["stereo-large"];
      const isOfficialModel = version.startsWith("meta/musicgen:");

      const input: Record<string, unknown> = {
        prompt,
        duration,
        output_format: "mp3",
      };

      if (options.melodyUrl) {
        input.input_audio = options.melodyUrl;
      }

      if (options.cfgCoef !== undefined) {
        input.classifier_free_guidance = options.cfgCoef;
      }

      if (options.topK !== undefined) {
        input.top_k = options.topK;
      }

      if (options.temperature !== undefined) {
        input.temperature = options.temperature;
      }

      // Use official model endpoint for meta models
      const endpoint = isOfficialModel
        ? `${this.baseUrl}/models/${version.replace(":", "/versions/")}/predictions`
        : `${this.baseUrl}/predictions`;

      const body = isOfficialModel
        ? { input }
        : { version: version.split(":")[1], input };

      const response = await fetch(`${this.baseUrl}/predictions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          version: "7be0f12c54a8d033a0fbd14418c9af98962da9a86f5ff7811f9b3423a1f0b7d7",
          input,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.error || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const prediction = (await response.json()) as ReplicatePrediction;

      return {
        success: true,
        taskId: prediction.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get music generation status
   */
  async getMusicStatus(taskId: string): Promise<MusicGenerationResult> {
    const result = await this.getPredictionStatus(taskId);

    if (result.status === "failed") {
      return {
        success: false,
        error: result.error || "Music generation failed",
        taskId,
      };
    }

    if (result.status === "completed" && result.videoUrl) {
      return {
        success: true,
        audioUrl: result.videoUrl, // Replicate uses videoUrl for all outputs
        taskId,
      };
    }

    return {
      success: true,
      taskId,
    };
  }

  /**
   * Wait for music generation to complete
   */
  async waitForMusic(
    taskId: string,
    maxWaitMs: number = 300000
  ): Promise<MusicGenerationResult> {
    const result = await this.waitForCompletion(taskId, undefined, maxWaitMs);

    if (result.status === "completed" && result.videoUrl) {
      return {
        success: true,
        audioUrl: result.videoUrl,
        taskId,
      };
    }

    return {
      success: false,
      error: result.error || "Music generation failed or timed out",
      taskId,
    };
  }

  /**
   * Restore audio quality using AI (denoise, enhance)
   */
  async restoreAudio(
    audioUrl: string,
    options: AudioRestorationOptions = {}
  ): Promise<AudioRestorationResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "Replicate API token not configured. Set REPLICATE_API_TOKEN",
      };
    }

    try {
      // Using Audio-Super-Resolution for enhancement
      // and denoising model for noise reduction
      const input: Record<string, unknown> = {
        audio: audioUrl,
      };

      if (options.denoise !== false) {
        input.denoise = true;
      }

      if (options.enhance) {
        input.enhance = true;
      }

      if (options.denoiseLevel !== undefined) {
        input.denoise_level = options.denoiseLevel;
      }

      // Using resemble-enhance model for audio restoration
      const response = await fetch(`${this.baseUrl}/predictions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          version: "aa9adce25e29d8a8a6c6cddbd25627d7e11b9c1a4e3f8f7f7b7f5e88d5b8f4c1", // resemble-enhance
          input,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.error || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const prediction = (await response.json()) as ReplicatePrediction;

      return {
        success: true,
        taskId: prediction.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get audio restoration status
   */
  async getAudioRestorationStatus(taskId: string): Promise<AudioRestorationResult> {
    const result = await this.getPredictionStatus(taskId);

    if (result.status === "failed") {
      return {
        success: false,
        error: result.error || "Audio restoration failed",
        taskId,
      };
    }

    if (result.status === "completed" && result.videoUrl) {
      return {
        success: true,
        audioUrl: result.videoUrl,
        taskId,
      };
    }

    return {
      success: true,
      taskId,
    };
  }

  /**
   * Wait for audio restoration to complete
   */
  async waitForAudioRestoration(
    taskId: string,
    maxWaitMs: number = 300000
  ): Promise<AudioRestorationResult> {
    const result = await this.waitForCompletion(taskId, undefined, maxWaitMs);

    if (result.status === "completed" && result.videoUrl) {
      return {
        success: true,
        audioUrl: result.videoUrl,
        taskId,
      };
    }

    return {
      success: false,
      error: result.error || "Audio restoration failed or timed out",
      taskId,
    };
  }
}

export const replicateProvider = new ReplicateProvider();

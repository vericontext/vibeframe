import type { Effect, EffectType, TimeSeconds } from "../timeline/types.js";

/** Effect definition for the registry */
export interface EffectDefinition {
  type: EffectType;
  name: string;
  description: string;
  /** Default parameters for this effect */
  defaultParams: Record<string, number | string | boolean>;
  /** Parameter constraints */
  paramConfig: Record<string, ParamConfig>;
  /** Whether this effect can be animated with keyframes */
  animatable: boolean;
  /** Applicable media types */
  applicableTo: ("video" | "audio" | "image")[];
}

/** Configuration for an effect parameter */
export interface ParamConfig {
  type: "number" | "string" | "boolean" | "select";
  label: string;
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
}

/** Built-in effect definitions */
export const EFFECT_DEFINITIONS: Record<EffectType, EffectDefinition> = {
  fadeIn: {
    type: "fadeIn",
    name: "Fade In",
    description: "Gradually appear from transparent",
    defaultParams: { intensity: 1 },
    paramConfig: {
      intensity: { type: "number", label: "Intensity", defaultValue: 1, min: 0, max: 1, step: 0.1 },
    },
    animatable: false,
    applicableTo: ["video", "image"],
  },
  fadeOut: {
    type: "fadeOut",
    name: "Fade Out",
    description: "Gradually fade to transparent",
    defaultParams: { intensity: 1 },
    paramConfig: {
      intensity: { type: "number", label: "Intensity", defaultValue: 1, min: 0, max: 1, step: 0.1 },
    },
    animatable: false,
    applicableTo: ["video", "image"],
  },
  blur: {
    type: "blur",
    name: "Blur",
    description: "Apply gaussian blur",
    defaultParams: { radius: 5 },
    paramConfig: {
      radius: { type: "number", label: "Radius", defaultValue: 5, min: 0, max: 50, step: 1 },
    },
    animatable: true,
    applicableTo: ["video", "image"],
  },
  brightness: {
    type: "brightness",
    name: "Brightness",
    description: "Adjust brightness level",
    defaultParams: { level: 1 },
    paramConfig: {
      level: { type: "number", label: "Level", defaultValue: 1, min: 0, max: 2, step: 0.1 },
    },
    animatable: true,
    applicableTo: ["video", "image"],
  },
  contrast: {
    type: "contrast",
    name: "Contrast",
    description: "Adjust contrast level",
    defaultParams: { level: 1 },
    paramConfig: {
      level: { type: "number", label: "Level", defaultValue: 1, min: 0, max: 2, step: 0.1 },
    },
    animatable: true,
    applicableTo: ["video", "image"],
  },
  saturation: {
    type: "saturation",
    name: "Saturation",
    description: "Adjust color saturation",
    defaultParams: { level: 1 },
    paramConfig: {
      level: { type: "number", label: "Level", defaultValue: 1, min: 0, max: 2, step: 0.1 },
    },
    animatable: true,
    applicableTo: ["video", "image"],
  },
  speed: {
    type: "speed",
    name: "Speed",
    description: "Change playback speed",
    defaultParams: { rate: 1 },
    paramConfig: {
      rate: { type: "number", label: "Rate", defaultValue: 1, min: 0.1, max: 4, step: 0.1 },
    },
    animatable: false,
    applicableTo: ["video", "audio"],
  },
  volume: {
    type: "volume",
    name: "Volume",
    description: "Adjust audio volume",
    defaultParams: { level: 1 },
    paramConfig: {
      level: { type: "number", label: "Level", defaultValue: 1, min: 0, max: 2, step: 0.1 },
    },
    animatable: true,
    applicableTo: ["video", "audio"],
  },
  custom: {
    type: "custom",
    name: "Custom",
    description: "Custom shader effect",
    defaultParams: {},
    paramConfig: {},
    animatable: true,
    applicableTo: ["video", "image"],
  },
};

/** Create a new effect with default parameters */
export function createEffect(
  type: EffectType,
  startTime: TimeSeconds = 0,
  duration: TimeSeconds = 1
): Omit<Effect, "id"> {
  const definition = EFFECT_DEFINITIONS[type];
  return {
    type,
    startTime,
    duration,
    params: { ...definition.defaultParams },
    keyframes: [],
  };
}

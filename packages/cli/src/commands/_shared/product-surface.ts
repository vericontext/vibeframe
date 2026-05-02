export const PRODUCT_SURFACES = ["public", "agent", "advanced", "legacy", "internal"] as const;

export type ProductSurface = (typeof PRODUCT_SURFACES)[number];

export interface ProductSurfaceMetadata {
  surface: ProductSurface;
  replacement?: string;
  note?: string;
}

const EXPLICIT_COMMAND_METADATA: Record<string, ProductSurfaceMetadata> = {
  setup: { surface: "public", note: "Initial configuration helper." },
  init: { surface: "public", note: "Storyboard-to-video cold-start entrypoint." },
  plan: { surface: "public", note: "Storyboard-to-video planning contract." },
  build: { surface: "public", note: "Primary storyboard-to-video build engine." },
  render: { surface: "public", note: "Project render entrypoint." },
  doctor: { surface: "public", note: "System and provider health check." },
  guide: { surface: "public", note: "Workflow chooser and first-run guidance." },
  demo: { surface: "advanced", note: "Smoke-test/demo helper, not a core workflow." },
  run: { surface: "agent", note: "Automation surface for YAML pipelines." },
  context: { surface: "agent", note: "Host-agent integration contract." },
  schema: { surface: "agent", note: "Machine-readable command discovery." },
  completion: { surface: "advanced", note: "Shell ergonomics helper." },
  agent: {
    surface: "advanced",
    note: "Optional fallback REPL; external coding agents are the primary workflow.",
  },

  "generate.image": { surface: "public" },
  "generate.video": { surface: "public" },
  "generate.narration": { surface: "public", note: "Product-facing TTS command." },
  "generate.speech": {
    surface: "legacy",
    replacement: "vibe generate narration",
    note: "Compatibility alias for product-facing narration generation.",
  },
  "generate.sound-effect": { surface: "public" },
  "generate.music": { surface: "public" },
  "generate.thumbnail": { surface: "public" },
  "generate.music-status": {
    surface: "legacy",
    replacement: "vibe status job <job-id> --json",
    note: "Provider-task polling primitive retained for compatibility.",
  },
  "generate.video-status": {
    surface: "legacy",
    replacement: "vibe status job <job-id> --json",
    note: "Provider-task polling primitive retained for compatibility.",
  },
  "generate.storyboard": {
    surface: "legacy",
    replacement: "vibe init --from <brief> or vibe storyboard revise",
    note: "Project-ready storyboard drafting belongs in init/revise.",
  },
  "generate.background": {
    surface: "legacy",
    replacement: "vibe generate image or vibe build --stage assets",
    note: "Backdrops are generated through image generation or the project build.",
  },
  "generate.motion": {
    surface: "advanced",
    replacement: "vibe edit motion-overlay or vibe build --stage compose",
    note: "Standalone motion generation is a power primitive.",
  },
  "generate.video-cancel": { surface: "advanced", note: "Provider lifecycle control." },
  "generate.video-extend": { surface: "advanced", note: "Provider lifecycle control." },

  "edit.caption": { surface: "public" },
  "edit.silence-cut": { surface: "public" },
  "edit.jump-cut": { surface: "public" },
  "edit.reframe": { surface: "public" },
  "edit.upscale": { surface: "public" },
  "edit.noise-reduce": { surface: "public" },
  "edit.fade": { surface: "advanced" },
  "edit.translate-srt": { surface: "advanced" },
  "edit.fill-gaps": { surface: "advanced" },
  "edit.motion-overlay": { surface: "advanced" },
  "edit.grade": { surface: "advanced" },
  "edit.text-overlay": { surface: "advanced" },
  "edit.speed-ramp": { surface: "advanced" },
  "edit.image": { surface: "advanced" },
  "edit.interpolate": { surface: "advanced" },
  "edit.animated-caption": {
    surface: "legacy",
    replacement: "vibe remix animated-caption",
    note: "Use the remix command for animated caption workflows.",
  },

  "inspect.project": { surface: "public" },
  "inspect.render": { surface: "public" },
  "inspect.media": { surface: "public" },
  "inspect.video": {
    surface: "legacy",
    replacement: "vibe inspect media",
    note: "Compatibility alias for media understanding.",
  },
  "inspect.review": {
    surface: "legacy",
    replacement: "vibe inspect render --ai",
    note: "Project render review now lives under inspect render.",
  },
  "inspect.suggest": {
    surface: "advanced",
    note: "Suggestion primitive; reports should drive host-agent edits.",
  },

  "audio.transcribe": { surface: "public" },
  "audio.dub": { surface: "public" },
  "audio.duck": { surface: "public" },
  "audio.isolate": { surface: "advanced" },
  "audio.clone-voice": {
    surface: "advanced",
    note: "Requires explicit user consent for voice cloning.",
  },
  "audio.list-voices": { surface: "advanced", note: "Provider discovery helper." },

  "remix.highlights": { surface: "public" },
  "remix.auto-shorts": { surface: "public" },
  "remix.animated-caption": { surface: "public" },
  "remix.regenerate-scene": {
    surface: "legacy",
    replacement: "vibe build <project> --beat <id> --force --json",
    note: "Scene regeneration belongs in the project build flow.",
  },

  "storyboard.validate": { surface: "public" },
  "storyboard.revise": { surface: "public" },
  "storyboard.list": { surface: "agent" },
  "storyboard.get": { surface: "agent" },
  "storyboard.set": { surface: "agent" },
  "storyboard.move": { surface: "agent" },

  "status.job": { surface: "public" },
  "status.project": { surface: "public" },

  "scene.list-styles": { surface: "public" },
  "scene.lint": { surface: "agent" },
  "scene.repair": { surface: "agent" },
  "scene.add": { surface: "advanced" },
  "scene.install-skill": {
    surface: "internal",
    note: "Build/init installs the host-agent composition skill when needed.",
  },
  "scene.compose-prompts": {
    surface: "internal",
    note: "Agent-mode build primitive; prefer vibe build --mode agent.",
  },

  "project.create": {
    surface: "legacy",
    replacement: "vibe timeline create",
    note: "Legacy timeline project alias.",
  },
  "project.info": {
    surface: "legacy",
    replacement: "vibe timeline info",
    note: "Legacy timeline project alias.",
  },
};

export function isProductSurface(value: string | undefined): value is ProductSurface {
  return PRODUCT_SURFACES.includes(value as ProductSurface);
}

export function productSurfaceForCommandPath(path: string): ProductSurfaceMetadata {
  const explicit = EXPLICIT_COMMAND_METADATA[path];
  if (explicit) return explicit;
  if (path.startsWith("timeline.")) {
    return { surface: "advanced", note: "Power tool for low-level timeline JSON edits." };
  }
  if (path.startsWith("batch.")) {
    return { surface: "advanced", note: "Power tool for bulk timeline/media operations." };
  }
  if (path.startsWith("media.")) {
    return { surface: "advanced", note: "Script utility for media metadata." };
  }
  if (path.startsWith("detect.")) return { surface: "public" };
  if (path.startsWith("export.")) {
    return { surface: "advanced", note: "Lower-level export helper." };
  }
  if (path.startsWith("fs.")) {
    return { surface: "internal", note: "In-process agent filesystem helper." };
  }
  return { surface: "advanced" };
}

export function commandPathFromToolName(name: string): string {
  if (["init", "plan", "build", "render", "guide"].includes(name)) return name;
  if (name.startsWith("fs_")) return name.replace("_", ".");
  const firstUnderscore = name.indexOf("_");
  if (firstUnderscore === -1) return name;
  const group = name.slice(0, firstUnderscore);
  const leaf = name.slice(firstUnderscore + 1).replace(/_/g, "-");
  return `${group}.${leaf}`;
}

export function productSurfaceForToolName(name: string): ProductSurfaceMetadata {
  return productSurfaceForCommandPath(commandPathFromToolName(name));
}

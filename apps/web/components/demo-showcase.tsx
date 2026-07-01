import type { ReactNode } from "react";
import { Film, PlayCircle, Terminal } from "lucide-react";

const RAW_ASSET_BASE = "https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos";
const LOCAL_ASSET_BASE = "/demo-media";
const DEMO_ASSET_BASE = process.env.NODE_ENV === "development" ? LOCAL_ASSET_BASE : RAW_ASSET_BASE;

export const FLAGSHIP_VIDEO =
  "https://github.com/vericontext/vibeframe/releases/download/v0.113.11/vibeframe-showcase.mp4";
export const PROCESS_HIGHLIGHT_VIDEO = `${DEMO_ASSET_BASE}/process-highlights/demo-process-highlight-bgm.mp4`;
export const RESULT_VIDEO = `${DEMO_ASSET_BASE}/demo-result.mp4`;

export function DemoShowcase() {
  return (
    <div className="space-y-5">
      <FlagshipCard />
      <div className="grid lg:grid-cols-2 gap-5">
        <DemoVideoCard
          eyebrow="Process highlight"
          title="Agent loop in under a minute"
          description="From rough brief and optional media inputs through setup, research, storyboard/design updates, image cues, build, render, and review."
          src={PROCESS_HIGHLIGHT_VIDEO}
          icon={<Terminal className="w-4 h-4" />}
        />
        <DemoVideoCard
          eyebrow="Final result"
          title="The rendered MP4"
          description="The shareable MP4 from the storyboard-driven build path, without exposing the whole process."
          src={RESULT_VIDEO}
          icon={<Film className="w-4 h-4" />}
        />
      </div>
    </div>
  );
}

function FlagshipCard() {
  return (
    <article className="overflow-hidden rounded-xl border border-border/60 bg-secondary/35 shadow-xl">
      <div className="relative bg-black">
        <video
          src={FLAGSHIP_VIDEO}
          controls
          muted
          loop
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black object-contain"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur">
          <Film className="w-3.5 h-3.5" />
          Directed AI video
        </div>
      </div>
      <div className="p-5">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <PlayCircle className="w-4 h-4" />
          Flagship render — one character, many scenes
        </div>
        <h3 className="text-xl font-semibold text-foreground">
          Chasing Light — one photographer across a single arctic night
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Trek, first aurora, the whole sky, dawn — the same character throughout. Character sheet →
          image storyboard → image-to-video → composed render, generated end-to-end by{" "}
          <code>vibe build</code>.
        </p>
      </div>
    </article>
  );
}

function DemoVideoCard({
  eyebrow,
  title,
  description,
  src,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  src: string;
  icon: ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border/60 bg-secondary/35 shadow-xl">
      <div className="relative bg-black">
        <video
          src={src}
          controls
          muted
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black object-contain"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur">
          <PlayCircle className="w-3.5 h-3.5" />
          Demo
        </div>
      </div>
      <div className="p-5">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {icon}
          {eyebrow}
        </div>
        <h3 className="text-xl font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </article>
  );
}

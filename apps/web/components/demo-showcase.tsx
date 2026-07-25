import { Film, PlayCircle } from "lucide-react";

export const FLAGSHIP_VIDEO =
  "https://github.com/vericontext/vibeframe/releases/download/v0.113.11/vibeframe-showcase.mp4";

/**
 * The flagship render is the only demo artifact on the site. Two companion
 * videos were retired: a screen recording whose project pane showed files the
 * scaffold no longer creates, and a benchmark slideshow that demonstrated the
 * composition layer we delegate to Hyperframes rather than the generation
 * layer this site is about. Both were recorded 2026-05-03.
 */
export function DemoShowcase() {
  return <FlagshipCard />;
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
          Flagship render - one character, many scenes
        </div>
        <h3 className="text-xl font-semibold text-foreground">
          Chasing Light - one photographer across a single arctic night
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Trek, first aurora, the whole sky, dawn - the same character throughout. Character sheet →
          image storyboard → image-to-video → composed render, generated end-to-end by{" "}
          <code>vibe build</code>.
        </p>
      </div>
    </article>
  );
}

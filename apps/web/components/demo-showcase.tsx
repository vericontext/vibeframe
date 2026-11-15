import { Film, GitBranch, PlayCircle } from "lucide-react";

export const FLAGSHIP_VIDEO =
  "https://github.com/vericontext/vibeframe/releases/download/v0.116.4/vibeframe-showcase-v2.mp4";

/**
 * Frame grabbed at t=11.5s, in the aurora scene. The cut opens on a fade from
 * black, so without a poster the card is a black rectangle until the visitor
 * presses play. Regenerate with:
 *   ffmpeg -ss 11.5 -i vibeframe-showcase-v2.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 3 \
 *     apps/web/public/showcase-poster.jpg
 */
const FLAGSHIP_POSTER = "/showcase-poster.jpg";

export const TAKE_GRAPH_VIDEO =
  "https://github.com/vericontext/vibeframe/releases/download/v0.116.4/vibeframe-take-graph.mp4";
/** Frame grabbed at t=12.5s, in the edited take. */
const TAKE_GRAPH_POSTER = "/take-graph-poster.jpg";

/** The finished film, and one clip's take history: what was made and what each step billed. */
export function DemoShowcase() {
  return (
    <div className="grid gap-6">
      <FlagshipCard />
      <TakeGraphCard />
    </div>
  );
}

function FlagshipCard() {
  return (
    <article className="overflow-hidden rounded-xl border border-border/60 bg-secondary/35 shadow-xl">
      <div className="relative bg-black">
        <video
          src={FLAGSHIP_VIDEO}
          poster={FLAGSHIP_POSTER}
          controls
          muted
          loop
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black object-contain"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur">
          <Film className="w-3.5 h-3.5" />
          Generated film
        </div>
      </div>
      <div className="p-5">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <PlayCircle className="w-4 h-4" />
          One character in every scene
        </div>
        <h3 className="text-xl font-semibold text-foreground">
          Chasing Light: one photographer across a single arctic night
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          A trek, the first aurora, the whole sky lit up, and dawn, with the same photographer in
          each shot. <code>vibe build</code> made a character sheet, a still for each scene, and a
          Grok image-to-video clip from each still; <code>vibe assemble</code> cut them over a
          generated score. It cost about $4.50: $2.84 billed by xAI for the clips, an estimated
          $1.59 for the stills, and $0.05 for the score.
        </p>
      </div>
    </article>
  );
}

function TakeGraphCard() {
  return (
    <article className="overflow-hidden rounded-xl border border-border/60 bg-secondary/35 shadow-xl md:grid md:grid-cols-[1.4fr_1fr]">
      <div className="relative bg-black">
        <video
          src={TAKE_GRAPH_VIDEO}
          poster={TAKE_GRAPH_POSTER}
          controls
          muted
          loop
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black object-contain"
        />
      </div>
      <div className="p-5">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <GitBranch className="w-4 h-4" />
          One clip, three takes
        </div>
        <h3 className="text-xl font-semibold text-foreground">Extend and edit instead of starting over</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          A 3-second Grok clip, extended by 2 seconds and then edited into a snowy night through the
          same provider session. Each step is a take with its parent and the charge xAI reported:
          $0.09, $0.17, and $0.40.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-border/50 bg-background/60 p-3 text-xs text-muted-foreground">
          <code>
            {"vibe take extend <take> --duration 2\n"}
            {'vibe take edit <take> --prompt "a snowy winter night"\n'}
            {"vibe take log   # $0.66 over 3 takes, all billed"}
          </code>
        </pre>
      </div>
    </article>
  );
}

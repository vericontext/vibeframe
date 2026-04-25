"use client";

import Link from "next/link";
import {
  Terminal,
  Sparkles,
  Github,
  ArrowRight,
  Film,
  Wand2,
  Image,
  Music,
  Video,
} from "lucide-react";
import { ThemeToggle } from "../../components/theme-toggle";
import { HeroVideo } from "../../components/demo/HeroVideo";
import { SceneCard } from "../../components/demo/SceneCard";
import { StepTimeline } from "../../components/demo/StepTimeline";

const scenes = [
  {
    title: "Scene 1: Terminal in Space",
    description: "A floating holographic terminal displaying 'vibe generate video' — the CLI as a gateway to creation.",
    imageSrc: "/demo/scene1-terminal.png",
    videoSrc: "/demo/scene1.mp4",
    command: 'vibe gen vid "terminal slowly rotates, text pulses with energy" -i scene1.png -o scene1.mp4',
  },
  {
    title: "Scene 2: AI Workspace",
    description: "Futuristic control room with holographic screens — representing the multi-provider AI pipeline.",
    imageSrc: "/demo/scene2-workspace.png",
    videoSrc: "/demo/scene2.mp4",
    command: 'vibe gen vid "camera flies through workspace, screens flicker" -i scene2.png -o scene2.mp4',
  },
  {
    title: "Scene 3: Ready to Play",
    description: "A glowing play button with particle effects — the finished video, ready to ship.",
    imageSrc: "/demo/scene3-output.png",
    videoSrc: "/demo/scene3.mp4",
    command: 'vibe gen vid "play button glows, particles converge, burst of light" -i scene3.png -o scene3.mp4',
  },
];

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2">
              <img src="/logo.svg" alt="VibeFrame" className="w-8 h-8" />
              <span className="text-xl font-bold">VibeFrame</span>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors hidden sm:inline">
              Home
            </Link>
            <Link href="/demo" className="text-foreground font-medium">
              Demo
            </Link>
            <ThemeToggle />
            <Link
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/5 px-4 py-1.5 text-sm text-green-400 mb-8 animate-fade-in">
            <Film className="w-4 h-4" />
            <span>Dogfooding · v0.55</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 animate-fade-in-up">
            Built with VibeFrame,<br />
            <span className="bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">for VibeFrame.</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-fade-in-up delay-100">
            24-second promo · 5 scenes · free local Kokoro narration · word-level captions · ambient soundtrack mixed in.
            Five <code className="font-mono text-sm">vibe scene add</code> calls, one <code className="font-mono text-sm">vibe gen music</code>, one <code className="font-mono text-sm">vibe scene render</code>.
          </p>

          <div className="animate-fade-in-up delay-200">
            <HeroVideo src="/demo/v0.55-self-promo.mp4" poster="/demo/v0.55-self-promo-thumb.png" />
          </div>
        </div>
      </section>

      {/* Three surfaces (asciinema) */}
      <section id="surfaces" className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-4 py-1.5 text-sm text-cyan-400 mb-4">
              <Terminal className="w-4 h-4" />
              <span>Three surfaces · same 62 tools</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Use VibeFrame how you already work
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Plain CLI, stand-alone agent REPL, or natural language inside Claude Code — same tools, three entry points.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <SurfaceCard
              badge="1 · CLI"
              title="vibe (terminal)"
              note="Pure commands · no LLM in the loop · ≈90 s"
              svgSrc="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/vibeframe-quickstart.svg"
              alt="VibeFrame CLI quickstart asciinema"
            />
            <SurfaceCard
              badge="2 · Agent"
              title="vibe agent"
              note="BYOK REPL · Claude / OpenAI / Gemini / Grok / OpenRouter / Ollama · ≈40 s"
              svgSrc="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/vibeframe-agent.svg"
              alt="VibeFrame agent mode asciinema (xAI Grok)"
            />
            <SurfaceCard
              badge="3 · Claude Code"
              title="natural language"
              note="No MCP setup · Claude discovers vibe via --help · ≈90 s"
              svgSrc="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/vibeframe-claude-code.svg"
              alt="VibeFrame inside Claude Code asciinema"
            />
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            For tighter Claude-Code-to-vibe loops via MCP, see the{" "}
            <Link
              href="https://github.com/vericontext/vibeframe/blob/main/assets/demos/claude-code-walkthrough.md"
              target="_blank"
              className="underline hover:text-foreground"
            >
              MCP route walkthrough
            </Link>{" "}
            (typed tool calls, structured cost surfaces).
          </p>
        </div>
      </section>

      {/* CLI Workflow */}
      <section id="cli-workflow" className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-4 py-1.5 text-sm text-blue-400 mb-4">
              <Terminal className="w-4 h-4" />
              <span>CLI Workflow</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Text to video in your terminal
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              The full pipeline — generate, animate, narrate, compose — all from CLI commands.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <CommandCard
              icon={<Image className="w-5 h-5" />}
              title="Generate Image"
              command='vibe gen img "sunset over mountains" -o scene.png'
              color="from-blue-500 to-cyan-500"
            />
            <CommandCard
              icon={<Video className="w-5 h-5" />}
              title="Image to Video"
              command='vibe gen vid "camera zooms in" -i scene.png -o scene.mp4'
              color="from-purple-500 to-pink-500"
            />
            <CommandCard
              icon={<Wand2 className="w-5 h-5" />}
              title="Generate Narration"
              command='vibe gen tts "Welcome to VibeFrame" -o narration.mp3'
              color="from-orange-500 to-yellow-500"
            />
            <CommandCard
              icon={<Music className="w-5 h-5" />}
              title="Generate Music"
              command='vibe gen music "cinematic ambient" -o bgm.mp3 -d 20'
              color="from-green-500 to-emerald-500"
            />
          </div>
        </div>
      </section>

      {/* Output Gallery */}
      <section id="gallery" className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-4 py-1.5 text-sm text-purple-400 mb-4">
              <Sparkles className="w-4 h-4" />
              <span>Earlier showcase · v0.5x image-to-video</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Image to video, scene by scene
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              The pre-scene-authoring path: generate an image with one command, then animate it with another.
              Still works in v0.55 — kept here as the building blocks underneath the new scene workflow.
            </p>
          </div>

          <div className="space-y-16">
            {scenes.map((scene, i) => (
              <SceneCard key={i} {...scene} />
            ))}
          </div>
        </div>
      </section>

      {/* How It Was Made */}
      <section id="how-it-was-made" className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/5 px-4 py-1.5 text-sm text-orange-400 mb-4">
              <Terminal className="w-4 h-4" />
              <span>Behind the Scenes</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              How it was made
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Step-by-step: the exact CLI commands used to produce this demo video.
            </p>
          </div>

          <StepTimeline />
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Create your own
          </h2>
          <p className="text-muted-foreground text-lg mb-8">
            Open source. MIT licensed. One install command.
          </p>

          <div className="bg-gradient-to-r from-secondary to-secondary/50 rounded-xl p-1 max-w-xl mx-auto mb-8 shadow-xl">
            <div className="flex items-center gap-2 px-4 py-3 bg-background rounded-lg font-mono text-xs sm:text-sm">
              <span className="text-primary">$</span>
              <span className="text-foreground whitespace-nowrap">curl -fsSL https://vibeframe.ai/install.sh | bash</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="group flex items-center gap-2 rounded-lg bg-foreground text-background px-6 py-3 font-medium hover:bg-foreground/90 transition-all shadow-lg"
            >
              <Github className="w-5 h-5" />
              Star on GitHub
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-4">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <img src="/logo.svg" alt="VibeFrame" className="w-6 h-6" />
            <span>VibeFrame</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="https://github.com/vericontext/vibeframe" target="_blank" className="hover:text-foreground transition-colors">
              GitHub
            </Link>
            <Link href="https://github.com/vericontext/vibeframe/blob/main/ROADMAP.md" target="_blank" className="hover:text-foreground transition-colors">
              Roadmap
            </Link>
            <Link href="https://github.com/vericontext/vibeframe/blob/main/LICENSE" target="_blank" className="hover:text-foreground transition-colors">
              MIT License
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CommandCard({ icon, title, command, color }: { icon: React.ReactNode; title: string; command: string; color: string }) {
  return (
    <div className="group bg-secondary/30 border border-border/50 rounded-xl p-5 hover:border-primary/30 transition-all">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        <span className="font-semibold">{title}</span>
      </div>
      <div className="bg-background/50 rounded-lg px-3 py-2 font-mono text-xs overflow-x-auto">
        <span className="text-green-400">$ </span>
        <span className="text-foreground">{command}</span>
      </div>
    </div>
  );
}

function SurfaceCard({
  badge,
  title,
  note,
  svgSrc,
  alt,
}: {
  badge: string;
  title: string;
  note: string;
  svgSrc: string;
  alt: string;
}) {
  return (
    <div className="bg-secondary/30 border border-border/50 rounded-xl overflow-hidden hover:border-primary/30 transition-all">
      <div className="px-5 pt-5">
        <div className="text-xs font-mono text-cyan-400 mb-1">{badge}</div>
        <div className="text-base font-semibold mb-1">{title}</div>
        <div className="text-xs text-muted-foreground mb-4">{note}</div>
      </div>
      <a
        href={svgSrc}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-background/50 border-t border-border/50"
      >
        {/* Plain <img> on purpose — these are external SVG raw URLs from the
            github mirror, so next/image's optimizer would just round-trip
            them. Lazy-loaded to keep the page light on first paint. */}
        <img src={svgSrc} alt={alt} className="w-full" loading="lazy" />
      </a>
    </div>
  );
}

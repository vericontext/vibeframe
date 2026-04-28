"use client";

import Link from "next/link";
import {
  Terminal,
  Github,
  ArrowRight,
  Wand2,
  Image,
  Music,
  Video,
} from "lucide-react";
import { ThemeToggle } from "../../components/theme-toggle";

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

      {/* Cinematic hero — v0.60 promo MP4 rendered end-to-end via the
          v0.59 compose-scenes-with-skills pipeline. Restores an MP4 hero
          (the v0.57 5-scene one was demoted during the architectural
          pivot; this is the post-pivot replacement). */}
      <section className="pt-32 pb-12 px-4">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-4 py-1.5 text-sm text-blue-400 mb-6 animate-fade-in">
              <Video className="w-4 h-4" />
              <span>Built with <code className="font-mono text-xs">compose-scenes-with-skills</code></span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 animate-fade-in-up">
              What you<br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent">can build.</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 animate-fade-in-up delay-100">
              A 1920×1080 cinematic promo, end-to-end from a STORYBOARD.md +
              DESIGN.md. GPT Image 2 backdrops, ElevenLabs narration + cinematic
              BGM, deterministically rendered by Hyperframes' producer.
            </p>
          </div>
          <div className="rounded-xl overflow-hidden border border-border/50 shadow-2xl bg-black animate-fade-in-up delay-200">
            <video
              src="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/cinematic-v060.mp4"
              controls
              muted
              autoPlay
              loop
              playsInline
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* Four reproducible surfaces — VHS tape recipes, run locally with
          `vhs assets/demos/<name>.tape`. The actual rendered demo MP4s
          aren't committed; the tapes are the source of truth. */}
      <section className="pt-32 pb-20 px-4">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-4 py-1.5 text-sm text-cyan-400 mb-8 animate-fade-in">
              <Terminal className="w-4 h-4" />
              <span>Four surfaces · run any tape locally</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 animate-fade-in-up">
              Use VibeFrame how<br />
              <span className="bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">you already work.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-fade-in-up delay-100">
              Plain CLI, stand-alone agent, or Claude Code — same tools, four
              entry points. Each surface below ships a VHS tape; install{" "}
              <a
                href="https://github.com/charmbracelet/vhs"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                vhs
              </a>{" "}
              and run it to see the recording.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 animate-fade-in-up delay-200">
            <TapeCard
              badge="1 · CLI"
              title="vibe (terminal)"
              note="Hand-authored STORYBOARD → vibe scene build → MP4"
              command="vhs assets/demos/cli.tape"
            />
            <TapeCard
              badge="2 · Agent"
              title="vibe agent"
              note="BYOK · natural language → vibe scene build"
              command="vhs assets/demos/agent.tape"
            />
            <TapeCard
              badge="3 · Host agent"
              title="scene build"
              note="Host agent drives storyboard → multi-beat MP4 (recorded with Claude Code)"
              command="vhs assets/demos/host-agent.tape"
            />
            <TapeCard
              badge="4 · Host agent"
              title="primitive chain"
              note="t2i (gpt-image-2) → i2v (Seedance 2.0) → narration → mux (recorded with Claude Code)"
              command="vhs assets/demos/host-agent-i2v.tape"
            />
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            For the typed MCP route, see the{" "}
            <Link
              href="https://github.com/vericontext/vibeframe/blob/main/packages/mcp-server/README.md"
              target="_blank"
              className="underline hover:text-foreground"
            >
              @vibeframe/mcp-server README
            </Link>
            .
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

function TapeCard({
  badge,
  title,
  note,
  command,
}: {
  badge: string;
  title: string;
  note: string;
  command: string;
}) {
  return (
    <div className="bg-secondary/30 border border-border/50 rounded-xl p-5 hover:border-primary/30 transition-all">
      <div className="text-xs font-mono text-cyan-400 mb-1">{badge}</div>
      <div className="text-base font-semibold mb-1">{title}</div>
      <div className="text-xs text-muted-foreground mb-4">{note}</div>
      <div className="bg-background/50 rounded-lg px-3 py-2 font-mono text-xs overflow-x-auto border border-border/30">
        <span className="text-green-400">$ </span>
        <span className="text-foreground">{command}</span>
      </div>
    </div>
  );
}

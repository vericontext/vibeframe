"use client";

import Link from "next/link";
import {
  Terminal,
  Github,
  ArrowRight,
  Video,
  FileText,
  ClipboardList,
  Hammer,
} from "lucide-react";
import { ThemeToggle } from "../../components/theme-toggle";

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 -z-10 bg-background">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.05]" />
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

      {/* Storyboard project loop. */}
      <section className="pt-32 pb-12 px-4">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-4 py-1.5 text-sm text-blue-400 mb-6 animate-fade-in">
              <Video className="w-4 h-4" />
              <span>North-star workflow</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 animate-fade-in-up">
              The storyboard<br />
              <span className="text-primary">project loop.</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 animate-fade-in-up delay-100">
              A host agent drafts <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-sm">STORYBOARD.md</code> and <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-sm">DESIGN.md</code>,
              dry-runs the build, generates assets, inspects reports, repairs
              deterministic issues, and renders the final MP4.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 animate-fade-in-up delay-200">
            <CommandCard
              icon={<FileText className="w-5 h-5" />}
              title="Draft Project"
              command='vibe init launch --from brief.md --json'
              color="from-blue-500 to-cyan-500"
            />
            <CommandCard
              icon={<ClipboardList className="w-5 h-5" />}
              title="Validate and Plan"
              command="vibe storyboard validate launch --json && vibe plan launch --json"
              color="from-cyan-500 to-emerald-500"
            />
            <CommandCard
              icon={<Hammer className="w-5 h-5" />}
              title="Build with Cost Gate"
              command="vibe build launch --dry-run --max-cost 5 --json && vibe build launch --max-cost 5 --json"
              color="from-orange-500 to-yellow-500"
            />
            <CommandCard
              icon={<Video className="w-5 h-5" />}
              title="Inspect, Repair, Render"
              command="vibe inspect project launch --json && vibe scene repair --project launch --json && vibe render launch --json"
              color="from-purple-500 to-pink-500"
            />
          </div>
        </div>
      </section>

      {/* Current media primitive recording. */}
      <section className="py-16 px-4 border-t border-border/50">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-4 py-1.5 text-sm text-cyan-400 mb-6 animate-fade-in">
              <Video className="w-4 h-4" />
              <span>Media primitive demo · recorded from <code className="font-mono text-xs">DEMO-quickstart.md</code></span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Lower-level tools still work directly.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              This existing recording shows Claude Code using image generation,
              image-to-video, inspection, and motion-overlay editing outside
              the full storyboard project loop.
            </p>
          </div>
          <div className="rounded-xl overflow-hidden border border-border/50 shadow-2xl bg-black">
            <video
              src="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/quickstart-claude-code.mp4"
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

      {/* Reproducible surfaces — VHS tape recipes, run locally with
          `vhs assets/demos/<name>.tape`. */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-4 py-1.5 text-sm text-cyan-400 mb-8 animate-fade-in">
              <Terminal className="w-4 h-4" />
              <span>Reproducible surfaces · run any tape locally</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 animate-fade-in-up">
              Reproduce the flows<br />
              <span className="text-primary">from your terminal.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-fade-in-up delay-100">
              Plain CLI, optional built-in agent, or a host agent — same
              project files and command contracts. Each surface below ships a
              VHS tape; install{" "}
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
              badge="1 · Media primitives"
              title="DEMO-quickstart"
              note="Host agent drives image generation, video generation, inspection, and overlay editing"
              command="vhs assets/demos/quickstart-claude-code.tape"
            />
            <TapeCard
              badge="2 · Storyboard dogfood"
              title="DEMO-dogfood"
              note="Host agent runs the fuller storyboard build, report, render, and YAML workflow"
              command="vhs assets/demos/dogfood-claude-code.tape"
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
              The sequence agents repeat
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              The full project pipeline is a set of shell commands with JSON
              output, reports, and deterministic repair paths.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <CommandCard
              icon={<FileText className="w-5 h-5" />}
              title="Init from Brief"
              command='vibe init my-video --from "45-second launch video" --json'
              color="from-blue-500 to-cyan-500"
            />
            <CommandCard
              icon={<ClipboardList className="w-5 h-5" />}
              title="Validate and Plan"
              command="vibe storyboard validate my-video --json && vibe plan my-video --json"
              color="from-purple-500 to-pink-500"
            />
            <CommandCard
              icon={<Hammer className="w-5 h-5" />}
              title="Build and Poll"
              command="vibe build my-video --max-cost 5 --json && vibe status project my-video --refresh --json"
              color="from-orange-500 to-yellow-500"
            />
            <CommandCard
              icon={<Video className="w-5 h-5" />}
              title="Inspect and Render"
              command="vibe inspect project my-video --json && vibe render my-video --json"
              color="from-green-500 to-emerald-500"
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Create from a storyboard
          </h2>
          <p className="text-muted-foreground text-lg mb-8">
            Open source. MIT licensed. One install command.
          </p>

          <div className="bg-secondary rounded-xl p-1 max-w-xl mx-auto mb-8 shadow-xl border border-border/50">
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

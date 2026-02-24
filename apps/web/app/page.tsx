"use client";

import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Terminal,
  Sparkles,
  Zap,
  Layers,
  Github,
  ArrowRight,
  MessageSquare,
  Wand2,
  Film,
  Image,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="VibeFrame" className="w-8 h-8" />
            <span className="text-xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">VibeFrame</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github className="w-5 h-5" />
              <span className="hidden sm:inline">GitHub</span>
            </Link>
            <Link
              href="https://github.com/vericontext/vibeframe#cli-commands"
              target="_blank"
              className="rounded-lg bg-gradient-to-r from-primary to-purple-600 px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/25"
            >
              Docs
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 relative">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm text-primary mb-8 animate-fade-in">
            <Sparkles className="w-4 h-4" />
            <span>AI-native video editing</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-xs font-medium">v0.19.3</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-fade-in-up">
            Ship videos,<br />
            <span className="bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">not clicks.</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-fade-in-up delay-100">
            CLI-first video editing for AI agents.
            Use directly, via MCP in Claude Desktop & Cursor,
            or through Claude Code — no GUI required.
          </p>

          {/* Install Command */}
          <div className="bg-gradient-to-r from-secondary to-secondary/50 rounded-xl p-1 max-w-xl mx-auto mb-8 animate-fade-in-up delay-200 shadow-xl">
            <div className="flex items-center gap-2 px-4 py-3 bg-background rounded-lg font-mono text-sm">
              <span className="text-primary">$</span>
              <span className="text-foreground">curl -fsSL https://vibeframe.ai/install.sh | bash</span>
              <CopyButton text="curl -fsSL https://vibeframe.ai/install.sh | bash" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up delay-300">
            <Link
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="group flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary to-purple-600 px-6 py-3 font-medium text-primary-foreground hover:opacity-90 transition-all shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30"
            >
              <Github className="w-5 h-5" />
              View on GitHub
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="#interactive"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary hover:border-primary/30 transition-all"
            >
              <Terminal className="w-5 h-5" />
              See it in action
            </Link>
          </div>
        </div>
      </section>

      {/* Agent Mode Section */}
      <section id="interactive" className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-4 py-1.5 text-sm text-purple-400 mb-4">
              <Terminal className="w-4 h-4" />
              <span>Interactive CLI</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Natural Language CLI
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Type <code className="text-primary bg-primary/10 px-2 py-0.5 rounded">vibe</code> for an interactive session,
              or run any command directly. 58 tools across project, timeline, AI generation, and export.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8 items-start">
            {/* Terminal Demo */}
            <div className="bg-gradient-to-br from-secondary to-secondary/50 rounded-2xl overflow-hidden shadow-2xl border border-border/50">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/50">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="ml-2 text-sm text-muted-foreground font-mono">vibe</span>
              </div>
              <TerminalAnimation />
            </div>

            {/* Feature List */}
            <div className="space-y-6">
              <FeatureItem
                icon={<Wand2 className="w-5 h-5" />}
                title="Natural Language"
                description="'Trim the clip to 5 seconds and add a fade' — no flags needed"
                gradient="from-blue-500 to-cyan-500"
              />
              <FeatureItem
                icon={<Zap className="w-5 h-5" />}
                title="5 LLM Providers"
                description="OpenAI, Claude, Gemini, xAI Grok, Ollama — swap with -p flag"
                gradient="from-yellow-500 to-orange-500"
              />
              <FeatureItem
                icon={<Sparkles className="w-5 h-5" />}
                title="58 Tools"
                description="Project, timeline, AI generation, media, export, batch, filesystem"
                gradient="from-purple-500 to-pink-500"
              />
              <FeatureItem
                icon={<Terminal className="w-5 h-5" />}
                title="MCP + Claude Code"
                description="Use via MCP in Claude Desktop & Cursor, or let Claude Code run CLI commands directly"
                gradient="from-green-500 to-emerald-500"
              />
            </div>
          </div>
        </div>
      </section>

      {/* AI Pipelines */}
      <section className="py-20 px-4 relative">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              AI Pipelines
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              End-to-end automation. One command does it all.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <PipelineCard
              icon={<Film className="w-6 h-6" />}
              title="Script to Video"
              command="vibe ai script-to-video"
              description="Text → Storyboard → TTS → Images → Video"
              gradient="from-blue-500 to-purple-500"
            />
            <PipelineCard
              icon={<Sparkles className="w-6 h-6" />}
              title="Auto Highlights"
              command="vibe ai highlights"
              description="Long video → AI analysis → Best moments"
              gradient="from-purple-500 to-pink-500"
            />
            <PipelineCard
              icon={<Image className="w-6 h-6" />}
              title="B-Roll Matcher"
              command="vibe ai b-roll"
              description="Narration → Vision analysis → Auto-cut"
              gradient="from-pink-500 to-red-500"
            />
            <PipelineCard
              icon={<Zap className="w-6 h-6" />}
              title="Viral Optimizer"
              command="vibe ai viral"
              description="One video → TikTok, Shorts, Reels"
              gradient="from-orange-500 to-yellow-500"
            />
            <PipelineCard
              icon={<MessageSquare className="w-6 h-6" />}
              title="Auto Narrate"
              command="vibe ai narrate"
              description="Video → Claude Vision → ElevenLabs TTS"
              gradient="from-cyan-500 to-blue-500"
            />
            <PipelineCard
              icon={<Wand2 className="w-6 h-6" />}
              title="Auto Dub"
              command="vibe ai dub"
              description="Transcribe → Translate → TTS in any language"
              gradient="from-green-500 to-emerald-500"
            />
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <div className="bg-gradient-to-br from-secondary via-secondary to-secondary/50 rounded-2xl overflow-hidden shadow-2xl border border-border/50">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/30">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-sm text-muted-foreground">terminal</span>
            </div>
            <pre className="p-6 text-sm overflow-x-auto">
              <code className="text-muted-foreground"># Create a video from a script{"\n"}</code>
              <code className="text-foreground">vibe ai script-to-video "A day in the life of a developer..." \{"\n"}</code>
              <code className="text-foreground">  -a 9:16 -o project.vibe.json{"\n\n"}</code>

              <code className="text-muted-foreground"># Auto-narrate and dub to Korean{"\n"}</code>
              <code className="text-foreground">vibe ai narrate video.mp4 -o narrated/{"\n"}</code>
              <code className="text-foreground">vibe ai dub narrated/auto-narration.mp3 --language ko{"\n\n"}</code>

              <code className="text-muted-foreground"># Reframe 16:9 → 9:16 and optimize for TikTok{"\n"}</code>
              <code className="text-foreground">vibe ai reframe video.mp4 --aspect 9:16{"\n"}</code>
              <code className="text-foreground">vibe ai viral project.vibe.json -p tiktok,youtube-shorts{"\n\n"}</code>

              <code className="text-green-400">✓ Generated: tiktok (0:45, 9:16){"\n"}</code>
              <code className="text-green-400">✓ Generated: youtube-shorts (0:58, 9:16)</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Built for AI agents
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Not another Premiere clone. VibeFrame is designed from the ground up
              for automation and AI-powered workflows.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              icon={<Terminal className="w-6 h-6" />}
              title="CLI-First"
              description="Full video editing from the command line. 283 tests. Zero GUI required."
              gradient="from-blue-500 to-cyan-500"
            />
            <FeatureCard
              icon={<MessageSquare className="w-6 h-6" />}
              title="MCP Native"
              description="Works with Claude Desktop and Cursor. Let AI control your edits."
              gradient="from-purple-500 to-pink-500"
            />
            <FeatureCard
              icon={<Zap className="w-6 h-6" />}
              title="AI Pipelines"
              description="Script-to-Video, Highlights, B-Roll, Viral, Narrate, Dub, Reframe."
              gradient="from-orange-500 to-red-500"
            />
            <FeatureCard
              icon={<Layers className="w-6 h-6" />}
              title="11 AI Providers"
              description="OpenAI, Claude, Gemini, ElevenLabs, Runway, Kling, Veo, Stability, Replicate, xAI Grok, Ollama."
              gradient="from-green-500 to-emerald-500"
            />
          </div>
        </div>
      </section>

      {/* MCP Section */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <div className="bg-gradient-to-br from-primary/20 via-purple-500/10 to-pink-500/5 border border-primary/20 rounded-2xl p-8 sm:p-12 relative overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />

            <div className="relative">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary/25">
                  <MessageSquare className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold mb-2">MCP Ready</h2>
                  <p className="text-muted-foreground">
                    Control VibeFrame from Claude Desktop or Cursor
                  </p>
                </div>
              </div>

              <div className="bg-background/50 backdrop-blur-sm rounded-xl p-4 mb-6 border border-border/50">
                <p className="text-sm text-muted-foreground mb-2">In Claude Desktop:</p>
                <p className="text-foreground italic">
                  "Create a new video project called 'Demo', add the intro.mp4 file,
                  trim it to 10 seconds, and add a fade out effect"
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {["project_create", "timeline_add_source", "timeline_trim_clip", "timeline_add_effect"].map((tool) => (
                  <span key={tool} className="text-xs bg-background/50 backdrop-blur-sm border border-border/50 px-3 py-1.5 rounded-full font-mono">
                    {tool}
                  </span>
                ))}
                <span className="text-xs bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full text-primary">
                  +8 more tools
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Ready to ship?
          </h2>
          <p className="text-muted-foreground text-lg mb-8">
            Open source. MIT licensed. Built for builders.
          </p>

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
            <Link
              href="https://www.npmjs.com/package/@vibeframe/mcp-server"
              target="_blank"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary hover:border-primary/30 transition-all"
            >
              MCP Setup Guide
              <ArrowRight className="w-4 h-4" />
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

// Copy Button Component
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2"/>
        </svg>
      )}
    </button>
  );
}

// Terminal Animation Component
function TerminalAnimation() {
  const [step, setStep] = useState(0);

  const lines = [
    { type: "logo", content: "" },
    { type: "prompt", content: "create a new project and add intro.mp4" },
    { type: "agent", content: "I'll create a project and add the media file." },
    { type: "tool", content: "(uses: project_create, timeline_add_source)" },
    { type: "success", content: "Project created, intro.mp4 added" },
    { type: "prompt", content: "trim it to 5 seconds and add fade effects" },
    { type: "agent", content: "I'll trim the clip and add fade in/out effects." },
    { type: "tool", content: "(uses: timeline_trim, timeline_add_effect x2)" },
    { type: "success", content: "Done: trimmed to 5s, fadeIn + fadeOut applied" },
    { type: "prompt", content: "export to mp4" },
    { type: "tool", content: "(uses: export_video)" },
    { type: "success", content: "Exported: my-project.mp4 (5s, 1080p)" },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % (lines.length + 3));
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 font-mono text-sm min-h-[320px]">
      {/* ASCII Logo */}
      <div className="text-purple-400 text-[10px] leading-tight mb-4 whitespace-pre">
{`██╗   ██╗██╗██████╗ ███████╗  ███████╗██████╗  █████╗ ███╗   ███╗███████╗
██║   ██║██║██╔══██╗██╔════╝  ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝
██║   ██║██║██████╔╝█████╗    █████╗  ██████╔╝███████║██╔████╔██║█████╗
╚██╗ ██╔╝██║██╔══██╗██╔══╝    ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝
 ╚████╔╝ ██║██████╔╝███████╗  ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗
  ╚═══╝  ╚═╝╚═════╝ ╚══════╝  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝`}
      </div>
      <div className="text-muted-foreground text-xs mb-4">
        58 tools · openai<br/>
        Commands: exit · reset · tools · context
      </div>

      {lines.slice(1, Math.min(step + 1, lines.length)).map((line, i) => (
        <div key={i} className="flex items-start gap-2 mb-1">
          {line.type === "prompt" && (
            <>
              <span className="text-blue-400">you&gt;</span>
              <span className="text-foreground">{line.content}</span>
              {i === Math.min(step, lines.length - 1) - 1 && (
                <span className="animate-pulse">▊</span>
              )}
            </>
          )}
          {line.type === "agent" && (
            <span className="text-purple-400">vibe&gt; {line.content}</span>
          )}
          {line.type === "tool" && (
            <span className="text-muted-foreground text-xs">{line.content}</span>
          )}
          {line.type === "success" && (
            <span className="text-green-400">✓ {line.content}</span>
          )}
          {line.type === "loading" && (
            <span className="text-yellow-400 animate-pulse">◌ {line.content}</span>
          )}
          {line.type === "detail" && (
            <span className="text-muted-foreground">{line.content}</span>
          )}
        </div>
      ))}

      {step >= lines.length && (
        <div className="flex items-start gap-2">
          <span className="text-blue-400">you&gt;</span>
          <span className="animate-pulse">▊</span>
        </div>
      )}
    </div>
  );
}

// Feature Card Component
function FeatureCard({
  icon,
  title,
  description,
  gradient
}: {
  icon: ReactNode;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="group bg-secondary/50 border border-border/50 rounded-xl p-6 hover:border-primary/30 hover:bg-secondary/80 transition-all duration-300">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

// Feature Item Component (for Agent section)
function FeatureItem({
  icon,
  title,
  description,
  gradient
}: {
  icon: ReactNode;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="flex items-start gap-4 group">
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white flex-shrink-0 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
        {icon}
      </div>
      <div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}

// Pipeline Card Component
function PipelineCard({
  icon,
  title,
  command,
  description,
  gradient,
}: {
  icon: ReactNode;
  title: string;
  command: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="group relative bg-secondary/30 border border-border/50 rounded-xl p-6 hover:border-primary/30 transition-all duration-300 overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
      <div className="relative">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
          {icon}
        </div>
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        <code className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">{command}</code>
        <p className="text-muted-foreground text-sm mt-3">{description}</p>
      </div>
    </div>
  );
}

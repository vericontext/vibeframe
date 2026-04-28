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
  Code2,
  Video,
} from "lucide-react";
import { ThemeToggle } from "../components/theme-toggle";

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
              href="/demo"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Demo
            </Link>
            <Link
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github className="w-5 h-5" />
              <span className="hidden sm:inline">GitHub</span>
            </Link>
            <ThemeToggle />
            <Link
              href="https://github.com/vericontext/vibeframe#cli-reference"
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
            <Terminal className="w-4 h-4" />
            <span>The video CLI for AI agents</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-xs font-medium">v{process.env.NEXT_PUBLIC_VERSION}</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-fade-in-up">
            Ship videos,<br />
            <span className="bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">not clicks.</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-fade-in-up delay-100">
            A CLI agents can compose, pipe, and script.
            YAML pipelines, {process.env.NEXT_PUBLIC_AI_PROVIDERS} AI providers, {process.env.NEXT_PUBLIC_MCP_TOOLS} MCP tools bundled.
            Works with Claude Code, OpenAI Codex, Cursor, Aider, Gemini CLI, OpenCode — any bash-capable AI coding agent. No GUI required.
          </p>

          {/* Install Command */}
          <div className="bg-gradient-to-r from-secondary to-secondary/50 rounded-xl p-1 max-w-xl mx-auto mb-8 animate-fade-in-up delay-200 shadow-xl">
            <div className="flex items-center gap-2 px-4 py-3 bg-background rounded-lg font-mono text-xs sm:text-sm overflow-x-auto">
              <span className="text-primary flex-shrink-0">$</span>
              <span className="text-foreground whitespace-nowrap">curl -fsSL https://vibeframe.ai/install.sh | bash</span>
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
              href="#cli-first"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary hover:border-primary/30 transition-all"
            >
              <Terminal className="w-5 h-5" />
              See it in action
            </Link>
          </div>
        </div>
      </section>

      {/* ⓪ What you can build — v0.62 cinematic demo MP4 anchored above the
          three-surface walkthroughs. Shows OUTPUT first, then surfaces.
          Replaces the section the v0.58 pivot left blank. */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-4 py-1.5 text-sm text-blue-400 mb-4">
              <Video className="w-4 h-4" />
              <span>What you can build · v0.60 demo</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              STORYBOARD.md → MP4, in one command
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {`Author cues in YAML, run \`vibe scene build\`. The pipeline dispatches `}
              narration TTS, GPT Image 2 backdrops, composes scene HTML via the
              Hyperframes skill bundle, and renders deterministically.
            </p>
          </div>
          <div className="rounded-xl overflow-hidden border border-border/50 shadow-2xl bg-black mx-auto max-w-4xl">
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
          <p className="text-center text-sm text-muted-foreground mt-6">
            Source:{" "}
            <Link
              href="https://github.com/vericontext/vibeframe/tree/main/examples/vibeframe-promo"
              target="_blank"
              className="underline hover:text-foreground"
            >
              examples/vibeframe-promo/
            </Link>
            {" — STORYBOARD.md + DESIGN.md, ~$0.18 fresh / $0 cached."}
          </p>
        </div>
      </section>

      {/* ⓪.5 — From install to MP4: the v0.61 4-step on-ramp */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-4 py-1.5 text-sm text-purple-400 mb-4">
              <Wand2 className="w-4 h-4" />
              <span>From install to MP4 · v0.61 wizard</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Four steps. Same flow on every agent host.
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Once <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">vibe init</code> scaffolds
              {" "}<code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">AGENTS.md</code> + {" "}
              <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">CLAUDE.md</code>, Claude Code,
              Codex, and Cursor all see the same project guidance.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">1. Install · global</div>
              <code className="font-mono text-xs text-foreground block break-all">curl -fsSL vibeframe.ai/install.sh | bash</code>
              <p className="text-xs text-muted-foreground mt-3">Adds the <code className="text-primary">vibe</code> CLI.</p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">2. Setup · user scope</div>
              <code className="font-mono text-xs text-foreground">vibe setup</code>
              <p className="text-xs text-muted-foreground mt-3">API keys + LLM provider, once per machine. Detects your agent host.</p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">3. Init · project scope</div>
              <code className="font-mono text-xs text-foreground">vibe init my-promo</code>
              <p className="text-xs text-muted-foreground mt-3">
                Scaffolds <code className="text-primary">AGENTS.md</code> (cross-tool) + <code className="text-primary">CLAUDE.md</code> + <code className="text-primary">.env.example</code>.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">4. Build · STORYBOARD → MP4</div>
              <code className="font-mono text-xs text-foreground">vibe scene build my-promo</code>
              <p className="text-xs text-muted-foreground mt-3">Dispatches narration + backdrops, composes scenes via skills, renders.</p>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Two flows depending on intent —{" "}
            <span className="text-foreground font-medium">BUILD</span> from text via{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">vibe scene build</code>,{" "}
            <span className="text-foreground font-medium">PROCESS</span> existing media via{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">vibe pipeline</code> /{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">edit</code> /{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">audio</code>.
          </p>
        </div>
      </section>

      {/* ① CLI First Section */}
      <section id="cli-first" className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-4 py-1.5 text-sm text-blue-400 mb-4">
              <Terminal className="w-4 h-4" />
              <span>CLI-First</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Every edit is a command
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {process.env.NEXT_PUBLIC_CLI_COMMANDS}+ commands for video editing, generation, and post-production.
              No GUI required — just your terminal.
            </p>
          </div>

          <div className="bg-gradient-to-br from-secondary via-secondary to-secondary/50 rounded-2xl overflow-hidden shadow-2xl border border-border/50 max-w-3xl mx-auto">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/30">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-sm text-muted-foreground">terminal</span>
            </div>
            <pre className="p-4 sm:p-6 text-xs sm:text-sm overflow-x-auto">
              <code className="text-muted-foreground"># Generate an image, then animate it{"\n"}</code>
              <code className="text-foreground">vibe gen img "sunset over mountains" -o sunset.png{"\n"}</code>
              <code className="text-green-400">{"✓ Generated with OpenAI gpt-image-2 (default since v0.56)\n\n"}</code>

              <code className="text-muted-foreground"># Image-to-video (recommended workflow){"\n"}</code>
              <code className="text-foreground">vibe gen vid "camera zooms in slowly" -i sunset.png -o scene.mp4{"\n"}</code>
              <code className="text-green-400">{"✓ Generated 5s video with fal.ai Seedance 2.0 (default since v0.57)\n\n"}</code>

              <code className="text-muted-foreground"># Add captions and remove silence{"\n"}</code>
              <code className="text-foreground">vibe ed cap video.mp4 -o captioned.mp4{"\n"}</code>
              <code className="text-green-400">{"✓ Transcribed 3:24, burned 156 caption segments\n\n"}</code>

              <code className="text-muted-foreground"># Export final video{"\n"}</code>
              <code className="text-foreground">vibe export project.vibe.json -o final.mp4{"\n"}</code>
              <code className="text-green-400">{"✓ Exported: final.mp4 (3:24, 1080p)"}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* ② Use with your AI agent — host-agnostic showcase + Tier 2 callout */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-4 py-1.5 text-sm text-cyan-400 mb-4">
              <Code2 className="w-4 h-4" />
              <span>Use with your AI agent</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Natural language, real commands
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Describe what you want — your AI coding agent runs the right <code className="text-primary bg-primary/10 px-2 py-0.5 rounded">vibe</code> command. The CLI surface is identical across every host that can shell out to bash.
            </p>
          </div>

          <div className="space-y-4 max-w-3xl mx-auto mb-12">
            <ClaudeCodeExample
              input="Remove silence from interview.mp4"
              command="vibe edit silence-cut interview.mp4 -o clean.mp4"
            />
            <ClaudeCodeExample
              input="Add Korean subtitles to video.mp4"
              command="vibe edit caption video.mp4 -o captioned.mp4 && vibe edit translate-srt captions.srt -t ko"
            />
            <ClaudeCodeExample
              input="Build a 9:16 promo from STORYBOARD.md"
              command={`vibe scene build my-promo --image-size 1024x1536`}
            />
          </div>

          {/* Six-host grid — equal cards, same example, different scaffold target */}
          <div className="text-center mb-6">
            <p className="text-sm text-muted-foreground">
              <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">vibe doctor</code> auto-detects six host families today and <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">vibe init</code> scaffolds the right project file for each.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {[
              { name: "Claude Code", scaffold: "CLAUDE.md + AGENTS.md", note: "+ /vibe-* slash commands" },
              { name: "OpenAI Codex", scaffold: "AGENTS.md", note: "agents.md spec" },
              { name: "Cursor", scaffold: "AGENTS.md + .cursor/rules", note: "MCP-ready" },
              { name: "Aider", scaffold: "AGENTS.md", note: "binary-detected" },
              { name: "Gemini CLI", scaffold: "AGENTS.md", note: "GEMINI.md on roadmap" },
              { name: "OpenCode", scaffold: "AGENTS.md", note: "MCP-ready" },
            ].map((host) => (
              <div key={host.name} className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3">
                <div className="font-mono text-sm font-semibold text-foreground">{host.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{host.scaffold}</div>
                <div className="text-xs text-muted-foreground/70 mt-0.5">{host.note}</div>
              </div>
            ))}
          </div>

          <p className="text-center text-muted-foreground text-sm mt-8">
            Anyone running another bash-capable agent (Continue, Sourcegraph Cody, your own loop) gets the universal <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">AGENTS.md</code> fallback. Open a PR to <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">agent-host-detect.ts</code> if your host wants first-class detection.
          </p>
        </div>
      </section>

      {/* ②.5 — Claude Code deeper integration (Tier 2) */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/5 px-4 py-1.5 text-sm text-orange-400 mb-4">
              <Sparkles className="w-4 h-4" />
              <span>Claude Code deeper integration</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Slash commands, beyond the CLI
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Claude Code is the only host today with a slash-command pack on top of the universal CLI. Every other agent host gets the same <code className="text-primary bg-primary/10 px-2 py-0.5 rounded">vibe</code> commands; Claude Code adds two guided flows.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto mb-8">
            <div className="bg-secondary/40 border border-border/50 rounded-xl p-5">
              <div className="font-mono text-sm font-semibold text-orange-400 mb-2">/vibe-pipeline</div>
              <p className="text-sm text-muted-foreground">YAML pipeline authoring helper — Video as Code with cost estimates and step references.</p>
            </div>
            <div className="bg-secondary/40 border border-border/50 rounded-xl p-5">
              <div className="font-mono text-sm font-semibold text-orange-400 mb-2">/vibe-scene</div>
              <p className="text-sm text-muted-foreground">Per-scene HTML authoring + <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">vibe scene build</code> driver (Hyperframes-backed).</p>
            </div>
          </div>

          <div className="bg-background/50 border border-border/50 rounded-xl p-4 max-w-3xl mx-auto">
            <div className="text-xs text-muted-foreground mb-2">Install (one-shot):</div>
            <code className="font-mono text-xs text-foreground block break-all">
              curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install-skills.sh | bash
            </code>
          </div>

          <p className="text-center text-muted-foreground text-sm mt-6 max-w-3xl mx-auto">
            Plan H also auto-installs the Hyperframes skill bundle into <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">.claude/skills/hyperframes/</code> when you run <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">vibe scene init</code> — Claude Code reads it as system context for cinematic scene authoring. Other host families get the same content as a universal <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">SKILL.md</code> at the project root.
          </p>
        </div>
      </section>

      {/* ③ MCP Section */}
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
                    {process.env.NEXT_PUBLIC_MCP_TOOLS} tools for Claude Desktop, Cursor, OpenCode, or Claude Code — add one JSON config and go
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
                {["project_create", "timeline_add_source", "export_video", "edit_silence_cut", "ai_analyze", "ai_script_to_video"].map((tool) => (
                  <span key={tool} className="text-xs bg-background/50 backdrop-blur-sm border border-border/50 px-3 py-1.5 rounded-full font-mono">
                    {tool}
                  </span>
                ))}
                <span className="text-xs bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full text-primary">
                  +{Number(process.env.NEXT_PUBLIC_MCP_TOOLS) - 6} more tools
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ④ Agent Mode Section */}
      <section id="agent-mode" className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-4 py-1.5 text-sm text-purple-400 mb-4">
              <Wand2 className="w-4 h-4" />
              <span>Agent Mode</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Built-in AI Agent
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              No AI coding agent set up? Run <code className="text-primary bg-primary/10 px-2 py-0.5 rounded">vibe agent</code> for a standalone natural-language session.
              Great for quick onboarding and environments without an installed agent host.
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
                title={`${process.env.NEXT_PUBLIC_LLM_PROVIDERS} LLM Providers`}
                description="OpenAI, Claude, Gemini, xAI Grok, OpenRouter, Ollama — swap with -p flag"
                gradient="from-yellow-500 to-orange-500"
              />
              <FeatureItem
                icon={<Sparkles className="w-5 h-5" />}
                title={`${process.env.NEXT_PUBLIC_AGENT_TOOLS} Tools`}
                description="Project, timeline, AI generation, media, export, batch, filesystem"
                gradient="from-purple-500 to-pink-500"
              />
              <FeatureItem
                icon={<Terminal className="w-5 h-5" />}
                title="Standalone"
                description="No agent host needed — built-in fallback for any environment"
                gradient="from-green-500 to-emerald-500"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Video as Code */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/5 px-4 py-1.5 text-sm text-green-400 mb-4">
              <Layers className="w-4 h-4" />
              <span>Video as Code</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Declarative YAML pipelines
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Define reproducible video workflows. Version control your production.
              Resume from failures. Share pipeline templates.
            </p>
          </div>

          <div className="bg-gradient-to-br from-secondary via-secondary to-secondary/50 rounded-2xl overflow-hidden shadow-2xl border border-border/50 max-w-3xl mx-auto">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/30">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-sm text-muted-foreground">promo.yaml</span>
            </div>
            <pre className="p-4 sm:p-6 text-xs sm:text-sm overflow-x-auto">
              <code className="text-purple-400">{"name: "}</code><code className="text-foreground">{"promo-video\n"}</code>
              <code className="text-purple-400">{"steps:\n"}</code>
              <code className="text-purple-400">{"  - id: "}</code><code className="text-foreground">{"backdrop\n"}</code>
              <code className="text-purple-400">{"    action: "}</code><code className="text-blue-400">{"generate-image\n"}</code>
              <code className="text-purple-400">{"    prompt: "}</code><code className="text-green-400">{"\"modern tech studio\"\n"}</code>
              <code className="text-purple-400">{"  - id: "}</code><code className="text-foreground">{"video\n"}</code>
              <code className="text-purple-400">{"    action: "}</code><code className="text-blue-400">{"generate-video\n"}</code>
              <code className="text-purple-400">{"    image: "}</code><code className="text-yellow-400">{"$backdrop.output"}</code><code className="text-muted-foreground">{"  # reference\n"}</code>
              <code className="text-purple-400">{"  - id: "}</code><code className="text-foreground">{"final\n"}</code>
              <code className="text-purple-400">{"    action: "}</code><code className="text-blue-400">{"edit-grade\n"}</code>
              <code className="text-purple-400">{"    input: "}</code><code className="text-yellow-400">{"$video.output\n"}</code>
              <code className="text-purple-400">{"    preset: "}</code><code className="text-green-400">{"cinematic-warm"}</code>
            </pre>
          </div>

          <div className="flex justify-center gap-4 mt-8">
            <code className="text-xs bg-secondary border border-border/50 px-4 py-2 rounded-lg font-mono">
              vibe run promo.yaml --dry-run
            </code>
            <code className="text-xs bg-secondary border border-border/50 px-4 py-2 rounded-lg font-mono">
              vibe run promo.yaml --resume
            </code>
          </div>
        </div>
      </section>

      {/* AI Pipelines */}
      <section className="py-20 px-4 border-t border-border/50 relative">
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
              title="Scene Build"
              command="vibe scene build my-promo"
              description="STORYBOARD.md + DESIGN.md → narrated, captioned MP4"
              gradient="from-blue-500 to-purple-500"
            />
            <PipelineCard
              icon={<Layers className="w-6 h-6" />}
              title="Video as Code"
              command="vibe run pipeline.yaml"
              description="Declarative YAML pipelines, --resume + budget guards"
              gradient="from-green-500 to-teal-500"
            />
            <PipelineCard
              icon={<Sparkles className="w-6 h-6" />}
              title="Auto Highlights"
              command="vibe pipeline highlights"
              description="Long video → AI analysis → best moments"
              gradient="from-purple-500 to-pink-500"
            />
            <PipelineCard
              icon={<MessageSquare className="w-6 h-6" />}
              title="Animated Captions"
              command="vibe pipeline animated-caption"
              description="Word-by-word TikTok/Reels-style captions"
              gradient="from-pink-500 to-red-500"
            />
            <PipelineCard
              icon={<Zap className="w-6 h-6" />}
              title="Auto Shorts"
              command="vibe pipeline auto-shorts"
              description="Long video → vertical shorts with captions"
              gradient="from-orange-500 to-yellow-500"
            />
            <PipelineCard
              icon={<Wand2 className="w-6 h-6" />}
              title="Auto Dub"
              command="vibe audio dub"
              description="Transcribe → translate → TTS in any language"
              gradient="from-green-500 to-emerald-500"
            />
          </div>
        </div>
      </section>

      {/* v0.62: removed the "Built for AI agents" Features Grid — every
          point it made (CLI-First, Claude Code, MCP, AI Providers) was
          already covered by its own dedicated section above, so the
          4-card grid was pure restatement. The cinematic demo at the
          top + the four detailed surface sections cover the same ground
          with less repetition. */}

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

// Claude Code Example Component
function ClaudeCodeExample({ input, command }: { input: string; command: string }) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3">
        <MessageSquare className="w-4 h-4 text-orange-400 flex-shrink-0" />
        <span className="text-xs sm:text-sm text-foreground">&ldquo;{input}&rdquo;</span>
      </div>
      <div className="bg-secondary/50 border border-border/50 rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-start gap-3 overflow-hidden">
        <Terminal className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
        <code className="text-xs sm:text-sm text-foreground font-mono break-words min-w-0">{command}</code>
      </div>
    </div>
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
    <div className="p-4 font-mono text-xs sm:text-sm min-h-[280px] sm:min-h-[320px]">
      {/* ASCII Logo - hidden on mobile */}
      <div className="hidden sm:block text-purple-400 text-[10px] leading-tight mb-4 whitespace-pre">
{`██╗   ██╗██╗██████╗ ███████╗  ███████╗██████╗  █████╗ ███╗   ███╗███████╗
██║   ██║██║██╔══██╗██╔════╝  ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝
██║   ██║██║██████╔╝█████╗    █████╗  ██████╔╝███████║██╔████╔██║█████╗
╚██╗ ██╔╝██║██╔══██╗██╔══╝    ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝
 ╚████╔╝ ██║██████╔╝███████╗  ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗
  ╚═══╝  ╚═╝╚═════╝ ╚══════╝  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝`}
      </div>
      {/* Compact logo for mobile */}
      <div className="sm:hidden text-purple-400 font-bold text-lg mb-2">
        VibeFrame
      </div>
      <div className="text-muted-foreground text-xs mb-4">
        {process.env.NEXT_PUBLIC_AGENT_TOOLS} tools · openai · aliases: gen, ed, az, au, pipe<br/>
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

// FeatureCard removed in v0.62 along with the redundant "Built for AI agents"
// section. Reintroduce here if a future grid needs it.

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

"use client";

import type { ReactNode } from "react";
import { useState } from "react";
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
  Download,
} from "lucide-react";
import { ThemeToggle } from "../components/theme-toggle";
import { DemoShowcase } from "../components/demo-showcase";

/**
 * Project-files reference. The hero's four artifact cards deep-link into its
 * headings, so an anchor change here has to be matched in docs/projects.md.
 */
const DOCS_PROJECTS_URL =
  "https://github.com/vericontext/vibeframe/blob/main/docs/projects.md";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Structured product backdrop */}
      <div className="fixed inset-0 -z-10 bg-background">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.05]" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="VibeFrame" className="w-8 h-8" />
            <span className="text-xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
              VibeFrame
            </span>
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
            <ThemeToggle />
            <Link
              href="https://github.com/vericontext/vibeframe/blob/main/docs/README.md"
              target="_blank"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25"
            >
              Docs
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 relative">
        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm text-primary mb-8 animate-fade-in">
            <Terminal className="w-4 h-4" />
            <span>Frontier video generation for coding agents</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-xs font-medium">
              v{process.env.NEXT_PUBLIC_VERSION}
            </span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-fade-in-up">
            Let your agent generate video
            <br />
            <span className="text-primary">under a ceiling it cannot cross.</span>
          </h1>

          <p className="text-2xl sm:text-3xl font-semibold text-foreground/90 mb-6 animate-fade-in-up delay-75">
            Your keys. Your bill. Your limit.
          </p>

          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10 animate-fade-in-up delay-100">
            VibeFrame gives Claude Code, Codex, or Cursor the commands to plan a video, generate the
            assets from{" "}
            <span className="text-foreground font-medium">Seedance, Runway, Veo, and Kling</span> on
            your own provider keys, and render a finished MP4. Every paid step sits behind a dry run
            and a hard{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-sm">
              --max-cost
            </code>{" "}
            ceiling, and every failure comes back as machine-readable recovery actions instead of a
            stack trace.
          </p>

          <div className="grid lg:grid-cols-[1.35fr_0.65fr] gap-4 max-w-5xl mx-auto mb-10 text-left animate-fade-in-up delay-150">
            <div className="rounded-xl border border-border/60 bg-secondary/45 overflow-hidden shadow-xl">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/45">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="ml-2 text-xs text-muted-foreground font-mono">
                  the spend gate
                </span>
              </div>
              <pre className="p-4 sm:p-5 text-xs sm:text-sm overflow-x-auto">
                <code className="text-muted-foreground">
                  # price the whole build first - no provider call, no key needed{"\n"}
                </code>
                <code className="text-foreground">
                  vibe build film --dry-run --max-cost 3 --json{"\n"}
                </code>
                <code className="text-muted-foreground">{"{\n"}</code>
                <code className="text-muted-foreground">{'  "success": false,\n'}</code>
                <code className="text-red-400">
                  {'  "error": "Estimated cost $10.93 exceeds --max-cost $3.00.",\n'}
                </code>
                <code className="text-red-400">{'  "code": "COST_CAP_EXCEEDED",\n'}</code>
                <code className="text-muted-foreground">{'  "exitCode": 1,\n'}</code>
                <code className="text-muted-foreground">{'  "retryWith": [\n'}</code>
                <code className="text-muted-foreground">
                  {'    "vibe build . --stage all --skip-backdrop --json",\n'}
                </code>
                <code className="text-muted-foreground">
                  {'    "vibe build . --stage all --max-cost 10.93 --json"\n'}
                </code>
                <code className="text-muted-foreground">{"  ],\n"}</code>
                <code className="text-muted-foreground">{'  "recoverable": true,\n'}</code>
                <code className="text-muted-foreground">
                  {'  "data": { "plan": { "estimatedCostUsd": 10.93 } }\n'}
                </code>
                <code className="text-muted-foreground">{"}\n"}</code>
                <code className="text-green-400">
                  {"# stderr, exit 1 - the agent stops instead of guessing"}
                </code>
              </pre>
            </div>
            <div className="grid gap-3">
              {[
                ["Intent", "STORYBOARD.md", "Beats, narration, cues", "#project-file-roles"],
                ["Design", "DESIGN.md", "Palette, type, motion", "#project-file-roles"],
                [
                  "Build",
                  "build-report.json",
                  "What it cost, where it stopped",
                  "#build-and-review-reports",
                ],
                [
                  "Review",
                  "review-report.json",
                  "What is wrong, who fixes it",
                  "#build-and-review-reports",
                ],
              ].map(([label, file, blurb, anchor]) => (
                <a
                  key={file}
                  href={`${DOCS_PROJECTS_URL}${anchor}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/60 bg-secondary/35 px-4 py-3 transition-colors hover:border-primary/60 hover:bg-secondary/60"
                >
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <div className="font-mono text-sm text-foreground mt-1">{file}</div>
                  <div className="text-xs text-muted-foreground mt-1">{blurb}</div>
                </a>
              ))}
            </div>
          </div>

          {/* Install Command */}
          <div className="bg-secondary rounded-xl p-1 max-w-xl mx-auto mb-8 animate-fade-in-up delay-200 shadow-xl border border-border/50">
            <div className="flex items-center gap-2 px-4 py-3 bg-background rounded-lg font-mono text-xs sm:text-sm overflow-x-auto">
              <span className="text-primary flex-shrink-0">$</span>
              <span className="text-foreground whitespace-nowrap">
                curl -fsSL https://vibeframe.ai/install.sh | bash
              </span>
              <CopyButton text="curl -fsSL https://vibeframe.ai/install.sh | bash" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground -mt-4 mb-8 animate-fade-in-up delay-200">
            Want to look before you spend? The whole pipeline also runs locally for $0 with no keys
            at all - local TTS, HTML scenes, Chrome + FFmpeg.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up delay-300">
            <Link
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="group flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
            >
              <Github className="w-5 h-5" />
              View on GitHub
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="#install-to-mp4"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary hover:border-primary/30 transition-all"
            >
              <Terminal className="w-5 h-5" />
              See it in action
            </Link>
            <Link
              href="https://github.com/vericontext/vibeframe/releases/latest/download/vibeframe.mcpb"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary hover:border-primary/30 transition-all"
            >
              <Download className="w-5 h-5" />
              Claude Desktop extension
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground animate-fade-in-up delay-300">
            Desktop extension: open the downloaded .mcpb, pick a workspace folder, done - no
            terminal needed.
          </p>
        </div>
      </section>

      {/* Demo pair */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-4 py-1.5 text-sm text-blue-400 mb-4">
              <Film className="w-4 h-4" />
              <span>Process and result</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              The first-run agent loop, end to end.
            </h2>
            <p className="text-muted-foreground text-lg max-w-3xl mx-auto">
              <code>brief.md</code> can be rough notes, pasted research, links, or a one-line idea.
              Optional photos, logos, screenshots, clips, or voice files can live in{" "}
              <code>media/</code>. A coding agent then edits <code>STORYBOARD.md</code> and{" "}
              <code>DESIGN.md</code>, runs the build, reviews the reports, and renders the MP4.
            </p>
          </div>

          <DemoShowcase />

          <div className="mt-8 grid md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-4">
              <div className="font-mono font-semibold text-foreground">BUILD</div>
              <p className="mt-2 text-muted-foreground">
                Primary path: rough brief, optional media, dry-run price, generated assets on your
                keys, Hyperframes composition, render.
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-4">
              <div className="font-mono font-semibold text-foreground">GENERATE</div>
              <p className="mt-2 text-muted-foreground">
                Escape hatch: ask for one standalone image, video, narration, music, or motion
                asset.
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-4">
              <div className="font-mono font-semibold text-foreground">EDIT / REMIX</div>
              <p className="mt-2 text-muted-foreground">
                Escape hatch: change existing media with captions, reframe, highlights, overlays,
                BGM, cleanup.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* From install to MP4 */}
      <section id="install-to-mp4" className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-4 py-1.5 text-sm text-purple-400 mb-4">
              <Wand2 className="w-4 h-4" />
              <span>From install to MP4</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Project files, reports, final render.
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Use a rough brief and optional <code>media/</code> inputs first. Scene composition
              runs on{" "}
              <a
                href="https://github.com/heygen-com/hyperframes"
                className="text-primary hover:underline"
              >
                Hyperframes
              </a>
              ; lower-level media, scene, timeline, and YAML commands stay available when an agent
              needs to debug a specific stage.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">1. Install · global</div>
              <code className="font-mono text-xs text-foreground block break-all">
                curl -fsSL https://vibeframe.ai/install.sh | bash
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Adds the <code className="text-primary">vibe</code> CLI. No API keys needed yet.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">2. Draft · project files</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe init launch --from brief.md --json
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Reads rough <code className="text-primary">brief.md</code>. Optional source files
                live in <code className="text-primary">launch/media/</code>.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">3. Price · before any spend</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe build launch --dry-run --max-cost 12 --json
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Costs nothing and needs no key. Prints the estimate and names the keys each stage
                would need.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">4. Generate · under the cap</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe setup --scope project && vibe build launch --max-cost 12 --json
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                BYO-key generation on Seedance, Runway, Veo, or Kling. Over the ceiling it refuses
                and hands back recovery actions.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">5. Render · review</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe render launch --json && vibe inspect render launch --cheap --json
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Chrome + FFmpeg render, free. Writes reports agents can inspect, repair, and
                re-render.
              </p>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Evaluating first?{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
              vibe build launch --tts kokoro --skip-backdrop --json
            </code>{" "}
            runs steps 3 and 4 entirely locally for $0 - local Kokoro narration and agent-authored
            HTML scenes, no provider account needed.
          </p>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Primary path: <span className="text-foreground font-medium">price, then generate</span>{" "}
            via{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
              vibe build
            </code>
            . Existing-media workflows still use{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
              vibe remix
            </code>
            , <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">edit</code>
            , and{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">audio</code>.
          </p>
        </div>
      </section>

      {/* Host setup - which scaffold each agent host gets */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-4 py-1.5 text-sm text-cyan-400 mb-4">
              <Code2 className="w-4 h-4" />
              <span>Use with your AI agent</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Works with the agent you have</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Describe the video in Codex, Claude, Cursor, or a terminal. Your host agent edits
              project files, calls
              <code className="text-primary bg-primary/10 px-2 py-0.5 rounded mx-1">vibe</code>
              with JSON output, then uses reports for the next pass.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            <div className="bg-secondary/40 border border-border/50 rounded-xl p-5">
              <div className="font-mono text-sm font-semibold text-foreground mb-2">
                vibe init
              </div>
              <p className="text-sm text-muted-foreground">
                Writes one <code className="text-primary">AGENTS.md</code> (plus{" "}
                <code className="text-primary">CLAUDE.md</code>, which just imports it). That is the
                whole contract - Codex, Cursor, Aider, Gemini CLI, OpenCode and any other
                bash-capable agent read the same file.
              </p>
            </div>
            <div className="bg-secondary/40 border border-border/50 rounded-xl p-5">
              <div className="font-mono text-sm font-semibold text-foreground mb-2">
                vibe host setup --write
              </div>
              <p className="text-sm text-muted-foreground">
                Adds typed MCP tools for the three hosts that support them:{" "}
                <code className="text-primary">.mcp.json</code>,{" "}
                <code className="text-primary">.codex/config.toml</code>,{" "}
                <code className="text-primary">.cursor/mcp.json</code>. Optional - the CLI works
                without it.
              </p>
            </div>
          </div>

          <p className="text-center text-muted-foreground text-sm mt-8">
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
              vibe doctor
            </code>{" "}
            reports which hosts it detects, and{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
              vibe host doctor all --json
            </code>{" "}
            verifies what landed.
          </p>
        </div>
      </section>

      {/* ③ MCP Section */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <div className="bg-secondary/45 border border-border/60 rounded-2xl p-8 sm:p-12">
            <div>
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary/25">
                  <MessageSquare className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold mb-2">MCP Ready</h2>
                  <p className="text-muted-foreground">
                    {process.env.NEXT_PUBLIC_MCP_TOOLS} tools for Claude Desktop, Cursor, Claude
                    Code, and Codex project configs. MCP is optional; use it when your host prefers
                    typed JSON-RPC tool calls over shell commands.
                  </p>
                </div>
              </div>

              <div className="bg-background/50 backdrop-blur-sm rounded-xl p-4 mb-6 border border-border/50">
                <p className="text-sm text-muted-foreground mb-2">In Claude Desktop:</p>
                <p className="text-foreground italic">
                  "Dry-run the build in demo-video, then generate under a $10 cap and render the
                  final MP4"
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  "init",
                  "storyboard_validate",
                  "plan",
                  "build",
                  "inspect_project",
                  "scene_repair",
                ].map((tool) => (
                  <span
                    key={tool}
                    className="text-xs bg-background/50 backdrop-blur-sm border border-border/50 px-3 py-1.5 rounded-full font-mono"
                  >
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

      {/* AI Pipelines */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Primary path and escape hatches</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Start with the priced build: dry-run first, generate under the cap. Drop into
              primitives only when an agent needs one asset, one edit, or one reproducible
              pipeline.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <PipelineCard
              icon={<Film className="w-6 h-6" />}
              title="Build Under a Cap"
              command="vibe build my-video --max-cost 12 --json"
              description="STORYBOARD.md + DESIGN.md to generated assets, scenes, reports - refuses over the ceiling"
              gradient="from-blue-500 to-purple-500"
            />
            <PipelineCard
              icon={<Sparkles className="w-6 h-6" />}
              title="Frontier Generation"
              command="vibe generate video"
              description="One clip on Seedance, Runway, Veo, or Kling - your keys, dry-run priced"
              gradient="from-purple-500 to-pink-500"
            />
            <PipelineCard
              icon={<Zap className="w-6 h-6" />}
              title="Auto Highlights + Shorts"
              command="vibe remix highlights"
              description="Long video → best moments, or vertical shorts with captions"
              gradient="from-orange-500 to-yellow-500"
            />
            <PipelineCard
              icon={<MessageSquare className="w-6 h-6" />}
              title="Captions + Dub"
              command="vibe remix animated-caption"
              description="Word-by-word captions, or transcribe → translate → TTS with vibe audio dub"
              gradient="from-pink-500 to-red-500"
            />
            <PipelineCard
              icon={<Layers className="w-6 h-6" />}
              title="Video as Code"
              command="vibe run promo.yaml --dry-run"
              description="Declarative YAML pipelines with budget guards, checkpoints, and --resume"
              gradient="from-green-500 to-emerald-500"
            />
            <PipelineCard
              icon={<Wand2 className="w-6 h-6" />}
              title="Review + Repair"
              command="vibe inspect render --cheap"
              description="Machine-readable review with nextActions and deterministic repair"
              gradient="from-green-500 to-teal-500"
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Open source frontier video generation for coding agents.
          </h2>
          <p className="text-muted-foreground text-lg mb-8">
            MIT licensed · v{process.env.NEXT_PUBLIC_VERSION} · your keys, your bill, your ceiling
            - CLI, MCP tools, JSON reports, and recovery contracts.
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
              href="https://github.com/vericontext/vibeframe/blob/main/docs/README.md"
              target="_blank"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary hover:border-primary/30 transition-all"
            >
              Read the docs
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
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </Link>
            <Link
              href="https://github.com/vericontext/vibeframe/blob/main/CHANGELOG.md"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
              Changelog
            </Link>
            <Link
              href="https://github.com/vericontext/vibeframe/blob/main/ROADMAP.md"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
              Roadmap
            </Link>
            <Link
              href="https://www.npmjs.com/package/@vibeframe/mcp-server"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
              MCP server (npm)
            </Link>
            <Link
              href="https://github.com/vericontext/vibeframe/blob/main/LICENSE"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
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
        <svg
          className="w-4 h-4 text-green-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2" />
        </svg>
      )}
    </button>
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
      <div
        className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}
      />
      <div className="relative">
        <div
          className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}
        >
          {icon}
        </div>
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        <code className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">{command}</code>
        <p className="text-muted-foreground text-sm mt-3">{description}</p>
      </div>
    </div>
  );
}

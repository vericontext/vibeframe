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
} from "lucide-react";
import { ThemeToggle } from "../components/theme-toggle";
import { DemoShowcase } from "../components/demo-showcase";

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
              href="https://github.com/vericontext/vibeframe#quick-start"
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
            <span>Storyboard-first video CLI for coding agents</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-xs font-medium">
              v{process.env.NEXT_PUBLIC_VERSION}
            </span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-fade-in-up">
            Storyboard to video
            <br />
            <span className="text-primary">with your coding agent.</span>
          </h1>

          <p className="text-2xl sm:text-3xl font-semibold text-foreground/90 mb-6 animate-fade-in-up delay-75">
            The CLI is the agent interface.
          </p>

          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10 animate-fade-in-up delay-100">
            VibeFrame turns{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-sm">
              STORYBOARD.md
            </code>{" "}
            and{" "}
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-sm">
              DESIGN.md
            </code>{" "}
            into generated assets, timed scene compositions, review reports, and final MP4 renders.{" "}
            {process.env.NEXT_PUBLIC_CLI_COMMANDS}+ commands, {process.env.NEXT_PUBLIC_AI_PROVIDERS}{" "}
            AI providers, {process.env.NEXT_PUBLIC_MCP_TOOLS} MCP tools. Works from your terminal,
            Claude Code, OpenAI Codex, Cursor, Aider, Gemini CLI, OpenCode, or any bash-capable AI
            agent.
          </p>

          <div className="grid lg:grid-cols-[1.35fr_0.65fr] gap-4 max-w-5xl mx-auto mb-10 text-left animate-fade-in-up delay-150">
            <div className="rounded-xl border border-border/60 bg-secondary/45 overflow-hidden shadow-xl">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-background/45">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="ml-2 text-xs text-muted-foreground font-mono">agent loop</span>
              </div>
              <pre className="p-4 sm:p-5 text-xs sm:text-sm overflow-x-auto">
                <code className="text-muted-foreground">
                  # Draft, validate, cost, build, inspect, render{"\n"}
                </code>
                <code className="text-foreground">vibe setup --scope project{"\n"}</code>
                <code className="text-foreground">
                  vibe init launch --from brief.md --json{"\n"}
                </code>
                <code className="text-muted-foreground">
                  # Agent researches the topic, then edits STORYBOARD.md + DESIGN.md{"\n"}
                </code>
                <code className="text-foreground">
                  vibe storyboard validate launch --json{"\n"}
                </code>
                <code className="text-foreground">vibe plan launch --json{"\n"}</code>
                <code className="text-foreground">
                  vibe build launch --dry-run --max-cost 5 --json{"\n"}
                </code>
                <code className="text-foreground">vibe build launch --max-cost 5 --json{"\n"}</code>
                <code className="text-foreground">
                  vibe status project launch --refresh --json{"\n"}
                </code>
                <code className="text-foreground">vibe inspect project launch --json{"\n"}</code>
                <code className="text-foreground">
                  vibe render launch -o renders/final.mp4 --json{"\n"}
                </code>
                <code className="text-foreground">
                  vibe inspect render launch --cheap --json{"\n"}
                </code>
                <code className="text-green-400">
                  {"✓ review-report.json ready for the next agent pass"}
                </code>
              </pre>
            </div>
            <div className="grid gap-3">
              {[
                ["Intent", "STORYBOARD.md"],
                ["Design", "DESIGN.md"],
                ["Build", "build-report.json"],
                ["Review", "review-report.json"],
              ].map(([label, file]) => (
                <div
                  key={file}
                  className="rounded-xl border border-border/60 bg-secondary/35 px-4 py-3"
                >
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <div className="font-mono text-sm text-foreground mt-1">{file}</div>
                </div>
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
              href="#cli-first"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary hover:border-primary/30 transition-all"
            >
              <Terminal className="w-5 h-5" />
              See it in action
            </Link>
          </div>
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
              From project setup to shareable video.
            </h2>
            <p className="text-muted-foreground text-lg max-w-3xl mx-auto">
              A coding agent researches the topic, edits <code>STORYBOARD.md</code> and{" "}
              <code>DESIGN.md</code>, tightens image-generation cues, runs the build, then reviews
              the final MP4. The same CLI also exposes direct image/video generation and edit/remix
              tools when you only need one asset or one media edit.
            </p>
          </div>

          <DemoShowcase />

          <div className="mt-8 grid md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-4">
              <div className="font-mono font-semibold text-foreground">BUILD</div>
              <p className="mt-2 text-muted-foreground">
                Start from intent: setup, init, storyboard/design, generated assets, composition,
                render.
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-4">
              <div className="font-mono font-semibold text-foreground">GENERATE</div>
              <p className="mt-2 text-muted-foreground">
                Ask for one standalone image, video, narration, music, or motion asset.
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-4">
              <div className="font-mono font-semibold text-foreground">EDIT / REMIX</div>
              <p className="mt-2 text-muted-foreground">
                Change an existing video: captions, reframe, highlights, overlays, BGM, cleanup.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* From install to MP4 */}
      <section className="py-20 px-4 border-t border-border/50 relative">
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
              Use the project-level commands first. Lower-level media, scene, timeline, and YAML
              commands stay available when an agent needs to debug a specific stage.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">1. Install · global</div>
              <code className="font-mono text-xs text-foreground block break-all">
                curl -fsSL https://vibeframe.ai/install.sh | bash
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Adds the <code className="text-primary">vibe</code> CLI.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">2. Configure · project keys</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe setup --scope project
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Writes <code className="text-primary">./.vibeframe/config.yaml</code> for this
                workspace.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">3. Draft · project files</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe init launch --from brief.md --json
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Creates <code className="text-primary">STORYBOARD.md</code>,{" "}
                <code className="text-primary">DESIGN.md</code>, and agent guidance.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">4. Plan · cost gate</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe build launch --dry-run --max-cost 5 --json
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Shows missing cues, provider needs, estimated cost, and planned assets.
              </p>
            </div>
            <div className="bg-secondary/50 border border-border/50 rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-2">5. Build · review · render</div>
              <code className="font-mono text-xs text-foreground block break-all">
                vibe build launch --json && vibe render launch --json && vibe inspect render launch
                --cheap --json
              </code>
              <p className="text-xs text-muted-foreground mt-3">
                Writes reports agents can inspect, repair, and re-render.
              </p>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Primary path: <span className="text-foreground font-medium">BUILD</span> from storyboard
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

      {/* ① CLI First Section */}
      <section id="cli-first" className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-4 py-1.5 text-sm text-blue-400 mb-4">
              <Terminal className="w-4 h-4" />
              <span>CLI-First</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              The project loop is a command sequence
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Agents can reason from structured files and JSON reports instead of guessing which UI
              state changed.
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
              <code className="text-muted-foreground"># Create a project from intent{"\n"}</code>
              <code className="text-foreground">
                vibe init my-video --from "45-second launch video" --json{"\n"}
              </code>
              <code className="text-green-400">{"✓ STORYBOARD.md + DESIGN.md created\n\n"}</code>

              <code className="text-muted-foreground">
                # Validate, plan, and dry-run before spending{"\n"}
              </code>
              <code className="text-foreground">
                vibe storyboard validate my-video --json{"\n"}
              </code>
              <code className="text-foreground">vibe plan my-video --json{"\n"}</code>
              <code className="text-foreground">
                vibe build my-video --dry-run --max-cost 5 --json{"\n"}
              </code>
              <code className="text-green-400">
                {"✓ build-report.json includes cost and missing cues\n\n"}
              </code>

              <code className="text-muted-foreground"># Build, review, repair, render{"\n"}</code>
              <code className="text-foreground">vibe build my-video --max-cost 5 --json{"\n"}</code>
              <code className="text-foreground">
                vibe status project my-video --refresh --json{"\n"}
              </code>
              <code className="text-foreground">vibe inspect project my-video --json{"\n"}</code>
              <code className="text-foreground">vibe scene repair my-video --json{"\n"}</code>
              <code className="text-foreground">
                vibe render my-video -o renders/final.mp4 --json{"\n"}
              </code>
              <code className="text-foreground">
                vibe inspect render my-video --cheap --json{"\n"}
              </code>
              <code className="text-green-400">{"✓ final.mp4 + review-report.json"}</code>
            </pre>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto mt-8">
            {[
              ["Storyboard", "list, get, set, move, validate, revise"],
              ["Plan", "costs, missing cues, provider needs"],
              ["Build", "assets, scene composition, timing sync"],
              ["Review", "inspect project, inspect render, reports"],
              ["Repair", "deterministic scene fixes after review"],
              ["Primitives", "generate, edit, remix, audio, YAML"],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-lg border border-border/50 bg-secondary/30 px-4 py-3"
              >
                <div className="font-mono text-sm font-semibold text-foreground">{title}</div>
                <div className="text-xs text-muted-foreground mt-1">{body}</div>
              </div>
            ))}
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
              Natural language, report-driven commands
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Describe the video. Your coding agent edits project files, calls
              <code className="text-primary bg-primary/10 px-2 py-0.5 rounded mx-1">vibe</code>
              with JSON output, then uses reports for the next pass.
            </p>
          </div>

          <div className="space-y-4 max-w-3xl mx-auto mb-12">
            <AgentCommandExample
              input="Build a 45-second launch video from brief.md"
              command="vibe init launch --from brief.md --json && vibe build launch --dry-run --json"
            />
            <AgentCommandExample
              input="Revise the hook and keep the same visual system"
              command={'vibe storyboard revise launch --from "stronger hook" --dry-run --json'}
            />
            <AgentCommandExample
              input="Fix issues from the latest render review"
              command="vibe scene repair launch --json && vibe render launch --json && vibe inspect render launch --cheap --json"
            />
          </div>

          {/* Six-host grid — equal cards, same example, different scaffold target */}
          <div className="text-center mb-6">
            <p className="text-sm text-muted-foreground">
              <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
                vibe doctor
              </code>{" "}
              auto-detects six host families today and{" "}
              <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
                vibe init
              </code>{" "}
              scaffolds the right project file for each.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {[
              { name: "Claude Code", scaffold: "CLAUDE.md + AGENTS.md", note: "project guidance" },
              { name: "OpenAI Codex", scaffold: "AGENTS.md", note: "agents.md spec" },
              { name: "Cursor", scaffold: "AGENTS.md + .cursor/rules", note: "MCP-ready" },
              { name: "Aider", scaffold: "AGENTS.md", note: "binary-detected" },
              { name: "Gemini CLI", scaffold: "AGENTS.md", note: "universal fallback" },
              { name: "OpenCode", scaffold: "AGENTS.md", note: "MCP-ready" },
            ].map((host) => (
              <div
                key={host.name}
                className="bg-secondary/40 border border-border/50 rounded-xl px-4 py-3"
              >
                <div className="font-mono text-sm font-semibold text-foreground">{host.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{host.scaffold}</div>
                <div className="text-xs text-muted-foreground/70 mt-0.5">{host.note}</div>
              </div>
            ))}
          </div>

          <p className="text-center text-muted-foreground text-sm mt-8">
            Anyone running another bash-capable agent gets the universal
            <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs mx-1">
              AGENTS.md
            </code>
            fallback.
          </p>
        </div>
      </section>

      {/* ②.5 — Step-by-step workflow guides */}
      <section className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-4 py-1.5 text-sm text-cyan-400 mb-4">
              <Sparkles className="w-4 h-4" />
              <span>Workflow guides</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              <code className="text-primary bg-primary/10 px-3 py-1 rounded">vibe context</code> and
              guides
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Agents can load the project rules, JSON envelope shape, public command surface, and
              step-by-step guides directly from the CLI.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto mb-8">
            <div className="bg-secondary/40 border border-border/50 rounded-xl p-5">
              <div className="font-mono text-sm font-semibold text-cyan-400 mb-2">vibe context</div>
              <p className="text-sm text-muted-foreground">
                Load agent rules, JSON envelope conventions, project files, and report locations.
              </p>
            </div>
            <div className="bg-secondary/40 border border-border/50 rounded-xl p-5">
              <div className="font-mono text-sm font-semibold text-cyan-400 mb-2">
                vibe guide scene
              </div>
              <p className="text-sm text-muted-foreground">
                Scene authoring — STORYBOARD.md → composed video via{" "}
                <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
                  vibe build
                </code>{" "}
                and{" "}
                <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">
                  vibe render
                </code>
                .
              </p>
            </div>
            <div className="bg-secondary/40 border border-border/50 rounded-xl p-5">
              <div className="font-mono text-sm font-semibold text-cyan-400 mb-2">
                vibe schema --list --surface public
              </div>
              <p className="text-sm text-muted-foreground">
                Expose the small first-run command set before an agent searches the full catalog.
              </p>
            </div>
          </div>

          <div className="bg-background/50 border border-border/50 rounded-xl p-4 max-w-3xl mx-auto">
            <div className="text-xs text-muted-foreground mb-2">List + load:</div>
            <code className="font-mono text-xs text-foreground block">
              vibe guide <span className="text-muted-foreground"># list available topics</span>
            </code>
            <code className="font-mono text-xs text-foreground block mt-1">
              vibe schema --list --surface public --json
              <span className="text-muted-foreground"> # compact command catalog</span>
            </code>
            <code className="font-mono text-xs text-foreground block mt-1">
              vibe guide scene --json{" "}
              <span className="text-muted-foreground"># structured workflow for an agent host</span>
            </code>
          </div>

          <p className="text-center text-muted-foreground text-sm mt-6 max-w-3xl mx-auto">
            Guides are plain CLI commands, so they work the same from a terminal, Codex, Claude
            Code, Cursor, Aider, Gemini CLI, OpenCode, or any other host that can run shell
            commands.
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
                    {process.env.NEXT_PUBLIC_MCP_TOOLS} tools for Claude Desktop, Cursor, OpenCode,
                    or Claude Code. MCP is optional; use it when your host prefers typed JSON-RPC
                    tool calls over shell commands.
                  </p>
                </div>
              </div>

              <div className="bg-background/50 backdrop-blur-sm rounded-xl p-4 mb-6 border border-border/50">
                <p className="text-sm text-muted-foreground mb-2">In Claude Desktop:</p>
                <p className="text-foreground italic">
                  "Load the scene guide, build the storyboard project in demo-video, then render the
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

      {/* ④ Agent Mode Section */}
      <section id="agent-mode" className="py-20 px-4 border-t border-border/50 relative">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-4 py-1.5 text-sm text-purple-400 mb-4">
              <Wand2 className="w-4 h-4" />
              <span>Optional agent mode</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Built-in AI agent, when you need one
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Claude Code, Codex, Cursor, and other coding agents can drive{" "}
              <code className="text-primary bg-primary/10 px-2 py-0.5 rounded">vibe</code> directly
              through shell commands and project guidance files. Run{" "}
              <code className="text-primary bg-primary/10 px-2 py-0.5 rounded">vibe agent</code>{" "}
              only when you want a standalone natural-language session inside the CLI.
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
                description="'Build this storyboard into a launch video' — when no host agent is available"
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
                description="Project files, build reports, generation, media, export, filesystem"
                gradient="from-purple-500 to-pink-500"
              />
              <FeatureItem
                icon={<Terminal className="w-5 h-5" />}
                title="Fallback"
                description="Useful when no external coding agent or MCP host is available"
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
              Declarative YAML pipelines when you need them
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              The storyboard project loop is the default. Use YAML when you need a reproducible
              multi-step workflow with budget guards, checkpoints, and step references.
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
              <code className="text-purple-400">{"name: "}</code>
              <code className="text-foreground">{"asset-pipeline\n"}</code>
              <code className="text-purple-400">{"steps:\n"}</code>
              <code className="text-purple-400">{"  - id: "}</code>
              <code className="text-foreground">{"backdrop\n"}</code>
              <code className="text-purple-400">{"    action: "}</code>
              <code className="text-blue-400">{"generate-image\n"}</code>
              <code className="text-purple-400">{"    prompt: "}</code>
              <code className="text-green-400">{'"modern tech studio"\n'}</code>
              <code className="text-purple-400">{"  - id: "}</code>
              <code className="text-foreground">{"video\n"}</code>
              <code className="text-purple-400">{"    action: "}</code>
              <code className="text-blue-400">{"generate-video\n"}</code>
              <code className="text-purple-400">{"    image: "}</code>
              <code className="text-yellow-400">{"$backdrop.output"}</code>
              <code className="text-muted-foreground">{"  # reference\n"}</code>
              <code className="text-purple-400">{"  - id: "}</code>
              <code className="text-foreground">{"narration\n"}</code>
              <code className="text-purple-400">{"    action: "}</code>
              <code className="text-blue-400">{"generate-tts\n"}</code>
              <code className="text-purple-400">{"    text: "}</code>
              <code className="text-green-400">{'"Start with a storyboard."\n'}</code>
              <code className="text-purple-400">{"    output: "}</code>
              <code className="text-yellow-400">{"assets/narration.mp3"}</code>
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
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Project and primitive workflows</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Start with the storyboard path. Drop into primitives when an agent needs one asset,
              one edit, or one reproducible pipeline.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <PipelineCard
              icon={<Film className="w-6 h-6" />}
              title="Storyboard Build"
              command="vibe build my-video --json"
              description="STORYBOARD.md + DESIGN.md to assets, scenes, reports"
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
              command="vibe remix highlights"
              description="Long video → AI analysis → best moments"
              gradient="from-purple-500 to-pink-500"
            />
            <PipelineCard
              icon={<MessageSquare className="w-6 h-6" />}
              title="Animated Captions"
              command="vibe remix animated-caption"
              description="Word-by-word TikTok/Reels-style captions"
              gradient="from-pink-500 to-red-500"
            />
            <PipelineCard
              icon={<Zap className="w-6 h-6" />}
              title="Auto Shorts"
              command="vibe remix auto-shorts"
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

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Open source storyboard workflows for agents.
          </h2>
          <p className="text-muted-foreground text-lg mb-8">
            MIT licensed · v{process.env.NEXT_PUBLIC_VERSION} · project files, JSON reports,
            terminal commands, YAML, and MCP workflows.
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
              href="https://github.com/vericontext/vibeframe#quick-start"
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

// Agent command example component
function AgentCommandExample({ input, command }: { input: string; command: string }) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3">
        <MessageSquare className="w-4 h-4 text-orange-400 flex-shrink-0" />
        <span className="text-xs sm:text-sm text-foreground">&ldquo;{input}&rdquo;</span>
      </div>
      <div className="bg-secondary/50 border border-border/50 rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-start gap-3 overflow-hidden">
        <Terminal className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
        <code className="text-xs sm:text-sm text-foreground font-mono break-words min-w-0">
          {command}
        </code>
      </div>
    </div>
  );
}

// Terminal Animation Component
function TerminalAnimation() {
  const [step, setStep] = useState(0);

  const lines = [
    { type: "logo", content: "" },
    { type: "prompt", content: "build a 30-second launch video from this brief" },
    { type: "agent", content: "I'll draft STORYBOARD.md and DESIGN.md, then dry-run the build." },
    { type: "tool", content: "(runs: vibe init launch --from brief.md --json)" },
    { type: "success", content: "Project created with storyboard, design, and agent guidance" },
    { type: "prompt", content: "keep cost under five dollars and review before final render" },
    {
      type: "agent",
      content: "I'll validate, plan, build with the cost gate, then refresh and inspect reports.",
    },
    { type: "tool", content: "(runs: vibe build launch --dry-run --max-cost 5 --json)" },
    { type: "success", content: "build-report.json ready; estimated cost within budget" },
    { type: "prompt", content: "repair anything deterministic and render" },
    {
      type: "tool",
      content:
        "(runs: vibe status project launch --refresh --json && vibe scene repair launch --json && vibe render launch --json && vibe inspect render launch --cheap --json)",
    },
    { type: "success", content: "Rendered: renders/final.mp4; review-report.json updated" },
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
      <div className="hidden sm:block text-cyan-400 text-[10px] leading-tight mb-4 whitespace-pre">
        {`██╗   ██╗██╗██████╗ ███████╗  ███████╗██████╗  █████╗ ███╗   ███╗███████╗
██║   ██║██║██╔══██╗██╔════╝  ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝
██║   ██║██║██████╔╝█████╗    █████╗  ██████╔╝███████║██╔████╔██║█████╗
╚██╗ ██╔╝██║██╔══██╗██╔══╝    ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝
 ╚████╔╝ ██║██████╔╝███████╗  ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗
  ╚═══╝  ╚═╝╚═════╝ ╚══════╝  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝`}
      </div>
      {/* Compact logo for mobile */}
      <div className="sm:hidden text-cyan-400 font-bold text-lg mb-2">VibeFrame</div>
      <div className="text-muted-foreground text-xs mb-4 space-y-1">
        <div>v{process.env.NEXT_PUBLIC_VERSION} · openai · ~/demo-video</div>
        <div>{process.env.NEXT_PUBLIC_AGENT_TOOLS} tools · cost gate (high/very-high)</div>
        <div>Commands: exit · reset · tools · context</div>
      </div>

      {lines.slice(1, Math.min(step + 1, lines.length)).map((line, i) => (
        <div key={i} className="flex items-start gap-2 mb-1">
          {line.type === "prompt" && (
            <>
              <span className="text-green-500">you&gt;</span>
              <span className="text-foreground">{line.content}</span>
              {i === Math.min(step, lines.length - 1) - 1 && (
                <span className="animate-pulse">▊</span>
              )}
            </>
          )}
          {line.type === "agent" && <span className="text-cyan-400">vibe&gt; {line.content}</span>}
          {line.type === "tool" && (
            <span className="text-muted-foreground text-xs">{line.content}</span>
          )}
          {line.type === "success" && <span className="text-green-400">✓ {line.content}</span>}
          {line.type === "loading" && (
            <span className="text-yellow-400 animate-pulse">◌ {line.content}</span>
          )}
          {line.type === "detail" && <span className="text-muted-foreground">{line.content}</span>}
        </div>
      ))}

      {step >= lines.length && (
        <div className="flex items-start gap-2">
          <span className="text-green-500">you&gt;</span>
          <span className="animate-pulse">▊</span>
        </div>
      )}
    </div>
  );
}

// Feature Item Component (for Agent section)
function FeatureItem({
  icon,
  title,
  description,
  gradient,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="flex items-start gap-4 group">
      <div
        className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white flex-shrink-0 shadow-lg group-hover:scale-110 transition-transform duration-300`}
      >
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

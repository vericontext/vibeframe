import type { ReactNode } from "react";
import Link from "next/link";
import {
  Terminal,
  Sparkles,
  Zap,
  Layers,
  Github,
  ArrowRight,
  Play,
  MessageSquare
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Play className="w-4 h-4 text-primary-foreground fill-current" />
            </div>
            <span className="text-xl font-bold">VibeFrame</span>
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
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              CLI Docs
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground mb-8">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>AI-native video editing</span>
          </div>
          
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
            Ship videos,<br />
            <span className="text-primary">not clicks.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            CLI-first video editor built for AI agents. 
            Edit with natural language. Automate with MCP. 
            No timeline dragging required.
          </p>

          {/* Install Command */}
          <div className="bg-secondary rounded-xl p-1 max-w-xl mx-auto mb-8">
            <div className="flex items-center gap-2 px-4 py-3 bg-background rounded-lg font-mono text-sm">
              <span className="text-muted-foreground">$</span>
              <span className="text-foreground">npm install -g @vibeframe/cli</span>
              <button 
                className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                title="Copy to clipboard"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="https://github.com/vericontext/vibeframe"
              target="_blank"
              className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Github className="w-5 h-5" />
              View on GitHub
            </Link>
            <Link 
              href="#features"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary transition-colors"
            >
              Learn more
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <div className="bg-secondary rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-sm text-muted-foreground">terminal</span>
            </div>
            <pre className="p-6 text-sm overflow-x-auto">
              <code className="text-muted-foreground"># Create a TikTok video from a script{"\n"}</code>
              <code className="text-foreground">vibe ai script-to-video "A day in the life of a developer..." \{"\n"}</code>
              <code className="text-foreground">  -a 9:16 -o project.vibe.json{"\n\n"}</code>
              
              <code className="text-muted-foreground"># Extract highlights from a podcast{"\n"}</code>
              <code className="text-foreground">vibe ai highlights podcast.mp4 -d 60 -p highlights.vibe.json{"\n\n"}</code>
              
              <code className="text-muted-foreground"># Optimize for multiple platforms{"\n"}</code>
              <code className="text-foreground">vibe ai viral project.vibe.json -p tiktok,youtube-shorts{"\n\n"}</code>
              
              <code className="text-primary">✓ Generated: tiktok.vibe.json (0:45, 9:16){"\n"}</code>
              <code className="text-primary">✓ Generated: youtube-shorts.vibe.json (0:58, 9:16)</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Features */}
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
              description="Full video editing from the command line. 157 tests. Zero GUI required."
            />
            <FeatureCard 
              icon={<MessageSquare className="w-6 h-6" />}
              title="MCP Native"
              description="Works with Claude Desktop and Cursor. Let AI control your edits."
            />
            <FeatureCard 
              icon={<Zap className="w-6 h-6" />}
              title="AI Pipelines"
              description="Script-to-Video, Auto Highlights, B-Roll Matching, Viral Optimizer."
            />
            <FeatureCard 
              icon={<Layers className="w-6 h-6" />}
              title="9 AI Providers"
              description="OpenAI, Claude, Gemini, ElevenLabs, Runway, Kling, Stability AI."
            />
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-12">
            Traditional vs VibeFrame
          </h2>
          
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="bg-secondary/50 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4 text-muted-foreground">Traditional Editor</h3>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-red-400">✗</span>
                  Import → Drag → Trim → Export
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400">✗</span>
                  Manual scene detection
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400">✗</span>
                  Export for each platform
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400">✗</span>
                  Click through menus
                </li>
              </ul>
            </div>
            
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4 text-primary">VibeFrame</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-2">
                  <span className="text-primary">✓</span>
                  <code className="text-sm bg-secondary px-2 py-0.5 rounded">vibe ai edit "trim intro to 3s"</code>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">✓</span>
                  <code className="text-sm bg-secondary px-2 py-0.5 rounded">vibe detect scenes video.mp4</code>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">✓</span>
                  <code className="text-sm bg-secondary px-2 py-0.5 rounded">vibe ai viral project.vibe.json</code>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">✓</span>
                  MCP → Claude does it for you
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* MCP Section */}
      <section className="py-20 px-4">
        <div className="mx-auto max-w-4xl">
          <div className="bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 rounded-2xl p-8 sm:p-12">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold mb-2">MCP Ready</h2>
                <p className="text-muted-foreground">
                  Control VibeFrame from Claude Desktop or Cursor
                </p>
              </div>
            </div>
            
            <div className="bg-background/50 rounded-xl p-4 mb-6">
              <p className="text-sm text-muted-foreground mb-2">In Claude Desktop:</p>
              <p className="text-foreground italic">
                "Create a new video project called 'Demo', add the intro.mp4 file, 
                trim it to 10 seconds, and add a fade out effect"
              </p>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <span className="text-xs bg-secondary px-3 py-1.5 rounded-full">project_create</span>
              <span className="text-xs bg-secondary px-3 py-1.5 rounded-full">timeline_add_source</span>
              <span className="text-xs bg-secondary px-3 py-1.5 rounded-full">timeline_trim_clip</span>
              <span className="text-xs bg-secondary px-3 py-1.5 rounded-full">timeline_add_effect</span>
              <span className="text-xs bg-secondary px-3 py-1.5 rounded-full text-muted-foreground">+8 more tools</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 border-t border-border/50">
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
              className="flex items-center gap-2 rounded-lg bg-foreground text-background px-6 py-3 font-medium hover:bg-foreground/90 transition-colors"
            >
              <Github className="w-5 h-5" />
              Star on GitHub
            </Link>
            <Link
              href="https://github.com/vericontext/vibeframe/blob/main/docs/mcp.md"
              target="_blank"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-medium hover:bg-secondary transition-colors"
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
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <Play className="w-3 h-3 text-primary-foreground fill-current" />
            </div>
            <span>VibeFrame</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="https://github.com/vericontext/vibeframe" target="_blank" className="hover:text-foreground transition-colors">
              GitHub
            </Link>
            <Link href="https://github.com/vericontext/vibeframe/blob/main/docs/roadmap.md" target="_blank" className="hover:text-foreground transition-colors">
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

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="bg-secondary/50 border border-border/50 rounded-xl p-6 hover:border-primary/30 transition-colors">
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

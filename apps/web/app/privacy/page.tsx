import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — VibeFrame",
  description:
    "VibeFrame is local-first: no telemetry, no VibeFrame servers in the data path. Content goes only to the AI providers you configure.",
};

const PROVIDER_POLICIES: Array<{ name: string; url: string }> = [
  { name: "Anthropic", url: "https://www.anthropic.com/legal/privacy" },
  { name: "OpenAI", url: "https://openai.com/policies/privacy-policy" },
  { name: "Google", url: "https://policies.google.com/privacy" },
  { name: "ElevenLabs", url: "https://elevenlabs.io/privacy" },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← vibeframe.ai
        </Link>
        <h1 className="mt-6 text-3xl font-bold">VibeFrame Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: June 11, 2026</p>

        <div className="mt-8 space-y-8 text-sm leading-6">
          <section>
            <p>
              This policy covers the VibeFrame CLI (<code>@vibeframe/cli</code>), the VibeFrame
              MCP server (<code>@vibeframe/mcp-server</code>), and the VibeFrame Claude Desktop
              extension. The canonical source lives in the repository as{" "}
              <a
                className="underline"
                href="https://github.com/vericontext/vibeframe/blob/main/PRIVACY.md"
              >
                PRIVACY.md
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Summary</h2>
            <p className="mt-2">
              VibeFrame is a local-first tool. It collects no telemetry, runs on your machine,
              and only sends data to AI providers <strong>you</strong> configure and invoke.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Data we collect</h2>
            <p className="mt-2">
              <strong>None.</strong> VibeFrame has no analytics, crash reporting, or usage
              tracking. No data is sent to VibeFrame&apos;s maintainers or any
              VibeFrame-operated server.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Where your content lives</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Projects, storyboards, generated audio/images/video, and render outputs are
                written only to the workspace folder you choose on your own machine.
              </li>
              <li>
                Job records, caches, and configuration live inside that workspace (or standard
                local cache directories, e.g. the Hugging Face cache for the optional local
                Kokoro TTS model).
              </li>
              <li>Retention is under your control: deleting the workspace deletes the data.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Third-party AI providers</h2>
            <p className="mt-2">
              When you explicitly run a generation or AI-assisted operation, the relevant
              content (narration text, image prompts, media to transcribe or review) is sent to
              the provider you configured for that operation — depending on the keys you
              supply: Anthropic, OpenAI, Google (Gemini), ElevenLabs, Replicate, fal, Runway,
              Kling, or xAI. Each provider processes that data under its own privacy policy:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {PROVIDER_POLICIES.map((p) => (
                <li key={p.name}>
                  <a className="underline" href={p.url}>
                    {p.name}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Operations that do not name a provider (timeline editing, ffmpeg-based edits,
              scene linting, rendering, local Kokoro TTS) run fully locally and send nothing
              anywhere. Tool annotations in the MCP manifest mark which tools reach external
              services (<code>openWorldHint</code>).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">API keys</h2>
            <p className="mt-2">
              API keys are supplied by you — via the Desktop extension&apos;s settings, a local{" "}
              <code>.env</code> file in your workspace, or environment variables. They are
              stored only on your machine, sent only to the corresponding provider to
              authenticate your own requests, and never transmitted to VibeFrame&apos;s
              maintainers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Data sharing and selling</h2>
            <p className="mt-2">
              VibeFrame does not share, sell, or transfer your data to anyone. There are no
              VibeFrame servers in the data path.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">About the vibeframe.ai website</h2>
            <p className="mt-2">
              This marketing website (not the CLI, MCP server, or extension) uses Google
              Analytics for aggregate page-view statistics, subject to{" "}
              <a className="underline" href="https://policies.google.com/privacy">
                Google&apos;s privacy policy
              </a>
              . The tools themselves contain no analytics.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Children&apos;s privacy</h2>
            <p className="mt-2">
              VibeFrame is a developer tool and is not directed at children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Contact</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Issues and questions:{" "}
                <a className="underline" href="https://github.com/vericontext/vibeframe/issues">
                  github.com/vericontext/vibeframe/issues
                </a>
              </li>
              <li>
                Security reports: <code>security@vibeframe.dev</code>
              </li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}

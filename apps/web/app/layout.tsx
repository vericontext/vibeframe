import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Counts come from next.config.js (auto-derived from packages/ai-providers
// directory listing + MCP tool name regex), so they stay in sync with the
// source. Falls back to conservative static numbers if env var lookup fails.
const AI_PROVIDERS = process.env.NEXT_PUBLIC_AI_PROVIDERS ?? "13";
const MCP_TOOLS = process.env.NEXT_PUBLIC_MCP_TOOLS ?? "82";
const SHARE_DESCRIPTION = `Turn STORYBOARD.md and DESIGN.md into generated assets, review reports, and rendered video from the terminal with ${AI_PROVIDERS} AI providers and ${MCP_TOOLS} MCP tools.`;

export const metadata: Metadata = {
  title: "VibeFrame — Storyboard-first video CLI for AI agents",
  description: SHARE_DESCRIPTION,
  keywords: ["video CLI", "storyboard to video", "STORYBOARD.md", "DESIGN.md", "AI agent", "agentic CLI", "build-report.json", "review-report.json", "MCP", "YAML pipelines", "Claude Code", "OpenAI Codex", "Cursor", "Aider", "Gemini CLI", "OpenCode", "agents.md", "open source"],
  metadataBase: new URL("https://vibeframe.ai"),
  openGraph: {
    title: "VibeFrame — Storyboard-first video CLI for AI agents",
    description: SHARE_DESCRIPTION,
    type: "website",
    url: "https://vibeframe.ai",
    siteName: "VibeFrame",
  },
  twitter: {
    card: "summary_large_image",
    title: "VibeFrame — Storyboard-first video CLI for AI agents",
    description: SHARE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-FMDTLFTKXM" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-FMDTLFTKXM');`}
        </Script>
      </head>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

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
const AI_PROVIDERS = process.env.NEXT_PUBLIC_AI_PROVIDERS ?? "15";
const MCP_TOOLS = process.env.NEXT_PUBLIC_MCP_TOOLS ?? "77";
const SHARE_TITLE = "VibeFrame - frontier video generation for coding agents";
const SHARE_DESCRIPTION = `Let your coding agent generate video on Seedance, Runway, Veo, or Kling with your own keys, behind a dry run and a hard --max-cost ceiling. ${AI_PROVIDERS} AI providers, ${MCP_TOOLS} MCP tools, MIT.`;

export const metadata: Metadata = {
  title: SHARE_TITLE,
  description: SHARE_DESCRIPTION,
  keywords: ["AI video generation", "Seedance", "Runway", "Veo", "Kling", "BYO key", "cost cap", "video CLI", "storyboard to video", "STORYBOARD.md", "DESIGN.md", "AI agent", "agentic CLI", "build-report.json", "review-report.json", "MCP", "YAML pipelines", "Claude Code", "OpenAI Codex", "Cursor", "Aider", "Gemini CLI", "OpenCode", "agents.md", "open source"],
  metadataBase: new URL("https://vibeframe.ai"),
  openGraph: {
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    type: "website",
    url: "https://vibeframe.ai",
    siteName: "VibeFrame",
  },
  twitter: {
    card: "summary_large_image",
    title: SHARE_TITLE,
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

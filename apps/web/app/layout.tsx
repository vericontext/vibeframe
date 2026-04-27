import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Counts come from next.config.js (auto-derived from packages/ai-providers
// directory listing + MCP tool name regex), so they stay in sync with the
// source. Falls back to the post-v0.57 numbers if env var lookup fails.
const AI_PROVIDERS = process.env.NEXT_PUBLIC_AI_PROVIDERS ?? "13";
const MCP_TOOLS = process.env.NEXT_PUBLIC_MCP_TOOLS ?? "63";
const SHARE_DESCRIPTION = `YAML pipelines, ${AI_PROVIDERS} AI providers, ${MCP_TOOLS} MCP tools bundled. Ship videos, not clicks.`;

export const metadata: Metadata = {
  title: "VibeFrame — The video CLI for AI agents",
  description: `A CLI agents can compose, pipe, and script. ${SHARE_DESCRIPTION}`,
  keywords: ["video CLI", "AI agent", "agentic CLI", "YAML pipelines", "MCP", "video editor", "Claude Code", "open source"],
  metadataBase: new URL("https://vibeframe.ai"),
  openGraph: {
    title: "VibeFrame — The video CLI for AI agents",
    description: SHARE_DESCRIPTION,
    type: "website",
    url: "https://vibeframe.ai",
    siteName: "VibeFrame",
  },
  twitter: {
    card: "summary_large_image",
    title: "VibeFrame — The video CLI for AI agents",
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

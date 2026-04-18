import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VibeFrame — The video CLI for AI agents",
  description: "A CLI agents can compose, pipe, and script. YAML pipelines, 5 AI providers, 53 MCP tools bundled. Ship videos, not clicks.",
  keywords: ["video CLI", "AI agent", "agentic CLI", "YAML pipelines", "MCP", "video editor", "Claude Code", "open source"],
  metadataBase: new URL("https://vibeframe.ai"),
  openGraph: {
    title: "VibeFrame — The video CLI for AI agents",
    description: "YAML pipelines, 5 AI providers, 53 MCP tools bundled. Ship videos, not clicks.",
    type: "website",
    url: "https://vibeframe.ai",
    siteName: "VibeFrame",
  },
  twitter: {
    card: "summary_large_image",
    title: "VibeFrame — The video CLI for AI agents",
    description: "YAML pipelines, 5 AI providers, 53 MCP tools bundled. Ship videos, not clicks.",
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

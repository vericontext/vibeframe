import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VibeEdit - AI-Native Video Editing",
  description: "CLI-first video editor built for AI agents. Edit with natural language. Automate with MCP. Ship videos, not clicks.",
  keywords: ["video editor", "AI", "CLI", "MCP", "automation", "open source"],
  openGraph: {
    title: "VibeEdit - AI-Native Video Editing",
    description: "CLI-first video editor built for AI agents. Ship videos, not clicks.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VibeEdit - AI-Native Video Editing",
    description: "CLI-first video editor built for AI agents. Ship videos, not clicks.",
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

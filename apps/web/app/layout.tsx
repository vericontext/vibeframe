import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VibeFrame - AI-Native Video Editing",
  description: "CLI-first video editor built for AI agents. Edit with natural language. Automate with MCP. Ship videos, not clicks.",
  keywords: ["video editor", "AI", "CLI", "MCP", "automation", "open source"],
  openGraph: {
    title: "VibeFrame - AI-Native Video Editing",
    description: "CLI-first video editor built for AI agents. Ship videos, not clicks.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VibeFrame - AI-Native Video Editing",
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
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-FMDTLFTKXM" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-FMDTLFTKXM');`}
        </Script>
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}

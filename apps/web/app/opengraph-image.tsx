import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "VibeFrame - AI-Native Video Editing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const version = process.env.NEXT_PUBLIC_VERSION || "0.27.0";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #121212 0%, #1a1a2e 40%, #16213e 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background glow effects */}
        <div
          style={{
            position: "absolute",
            top: "-100px",
            left: "200px",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-50px",
            right: "200px",
            width: "300px",
            height: "300px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)",
          }}
        />

        {/* Logo + Title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "16px",
              background: "linear-gradient(135deg, #8b5cf6, #a855f7, #d946ef)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 40px rgba(139,92,246,0.3)",
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19h8" />
              <path d="m4 17 6-6-6-6" />
            </svg>
          </div>
          <span
            style={{
              fontSize: "56px",
              fontWeight: 700,
              color: "#f5f5f5",
              letterSpacing: "-1px",
            }}
          >
            VibeFrame
          </span>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 500,
              color: "#a855f7",
              background: "rgba(168,85,247,0.15)",
              padding: "6px 14px",
              borderRadius: "20px",
              border: "1px solid rgba(168,85,247,0.3)",
            }}
          >
            v{version}
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "28px",
            fontWeight: 400,
            color: "#a1a1aa",
            marginBottom: "40px",
            textAlign: "center",
          }}
        >
          AI-native video editing. CLI-first. MCP-ready.
        </div>

        {/* Terminal preview */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "rgba(30,30,40,0.8)",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.1)",
            padding: "0",
            width: "700px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          {/* Terminal header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ef4444" }} />
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#eab308" }} />
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#22c55e" }} />
            <span style={{ marginLeft: "8px", color: "#71717a", fontSize: "13px" }}>terminal</span>
          </div>
          {/* Terminal content */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "16px 20px",
              gap: "6px",
              fontFamily: "monospace",
              fontSize: "15px",
            }}
          >
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ color: "#a855f7" }}>$</span>
              <span style={{ color: "#f5f5f5" }}>vibe gen img &quot;sunset over mountains&quot;</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ color: "#22c55e" }}>✓</span>
              <span style={{ color: "#22c55e" }}>Generated with Gemini</span>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
              <span style={{ color: "#a855f7" }}>$</span>
              <span style={{ color: "#f5f5f5" }}>vibe gen vid -i sunset.png -o scene.mp4</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ color: "#22c55e" }}>✓</span>
              <span style={{ color: "#22c55e" }}>Generated 5s video with Grok</span>
            </div>
          </div>
        </div>

        {/* Bottom tagline */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            marginTop: "36px",
            fontSize: "16px",
            color: "#71717a",
          }}
        >
          <span>Ship videos, not clicks.</span>
          <span>•</span>
          <span>Open Source</span>
          <span>•</span>
          <span>vibeframe.ai</span>
        </div>
      </div>
    ),
    { ...size }
  );
}

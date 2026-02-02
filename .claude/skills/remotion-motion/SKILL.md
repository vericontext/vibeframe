---
name: remotion-motion
description: Generate and render motion graphics using Remotion. Use for creating animated intros, titles, lower thirds, transitions, and React-based video components.
allowed-tools: Bash(npx *), Bash(pnpm *), Bash(npm *), Read, Write
---

# Remotion Motion Graphics

Create programmatic motion graphics using Remotion - React for videos.

## Overview

Remotion allows you to create videos using React components with frame-by-frame control.

## Setup

```bash
# Create new Remotion project
npx create-video@latest my-video

# Or add to existing project
pnpm add remotion @remotion/cli @remotion/bundler
```

## Core Concepts

### Composition
A video is defined as a `<Composition>`:

```tsx
import { Composition } from "remotion";
import { MyVideo } from "./MyVideo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyVideo"
      component={MyVideo}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
```

### Using Frame & Time
```tsx
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

export const MyAnimation = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, 30],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <div style={{ opacity }}>
      Hello World
    </div>
  );
};
```

## Animation Utilities

### interpolate()
```tsx
import { interpolate, Easing } from "remotion";

// Linear interpolation
const value = interpolate(frame, [0, 100], [0, 1]);

// With easing
const easedValue = interpolate(
  frame,
  [0, 30],
  [0, 100],
  {
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }
);
```

### spring()
```tsx
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

const MySpring = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: {
      damping: 10,
      stiffness: 100,
      mass: 1,
    },
  });

  return (
    <div style={{ transform: `scale(${scale})` }}>
      Bouncy!
    </div>
  );
};
```

## Common Components

### Sequence (Timing)
```tsx
import { Sequence } from "remotion";

export const Timeline = () => {
  return (
    <>
      <Sequence from={0} durationInFrames={30}>
        <Intro />
      </Sequence>
      <Sequence from={30} durationInFrames={60}>
        <MainContent />
      </Sequence>
      <Sequence from={90}>
        <Outro />
      </Sequence>
    </>
  );
};
```

### AbsoluteFill
```tsx
import { AbsoluteFill } from "remotion";

export const Overlay = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <h1>Centered Text</h1>
    </AbsoluteFill>
  );
};
```

### Video & Audio
```tsx
import { Video, Audio, staticFile } from "remotion";

export const MediaExample = () => {
  return (
    <>
      <Video src={staticFile("background.mp4")} />
      <Audio src={staticFile("music.mp3")} volume={0.5} />
    </>
  );
};
```

### Img
```tsx
import { Img, staticFile } from "remotion";

export const ImageExample = () => {
  return <Img src={staticFile("logo.png")} />;
};
```

## Component Templates

### Lower Third
```tsx
import { interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";

interface LowerThirdProps {
  name: string;
  title: string;
}

export const LowerThird: React.FC<LowerThirdProps> = ({ name, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({ frame, fps, config: { damping: 12 } });
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div style={{
      position: "absolute",
      bottom: 100,
      left: 80,
      transform: `translateX(${interpolate(slideIn, [0, 1], [-100, 0])}px)`,
      opacity,
    }}>
      <div style={{
        backgroundColor: "#1a1a2e",
        padding: "20px 40px",
        borderLeft: "4px solid #e94560",
      }}>
        <h2 style={{ color: "white", margin: 0, fontSize: 36 }}>{name}</h2>
        <p style={{ color: "#aaa", margin: "5px 0 0", fontSize: 24 }}>{title}</p>
      </div>
    </div>
  );
};
```

### Animated Title
```tsx
import { interpolate, useCurrentFrame, Easing } from "remotion";

export const AnimatedTitle: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      {text.split("").map((char, i) => {
        const delay = i * 3;
        const y = interpolate(
          frame,
          [delay, delay + 20],
          [50, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) }
        );
        const opacity = interpolate(frame, [delay, delay + 10], [0, 1], { extrapolateRight: "clamp" });

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${y}px)`,
              opacity,
              fontSize: 72,
              fontWeight: "bold",
              color: "white",
            }}
          >
            {char === " " ? "\u00A0" : char}
          </span>
        );
      })}
    </div>
  );
};
```

### Subscribe Button
```tsx
import { spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

export const SubscribeButton = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 8, stiffness: 200 } });
  const bellRotation = interpolate(
    frame,
    [30, 35, 40, 45, 50],
    [0, -15, 15, -10, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 20,
      transform: `scale(${scale})`,
    }}>
      <button style={{
        backgroundColor: "#ff0000",
        color: "white",
        border: "none",
        padding: "15px 30px",
        borderRadius: 4,
        fontSize: 24,
        fontWeight: "bold",
        cursor: "pointer",
      }}>
        SUBSCRIBE
      </button>
      <span style={{
        fontSize: 40,
        transform: `rotate(${bellRotation}deg)`,
        display: "inline-block",
      }}>
        🔔
      </span>
    </div>
  );
};
```

## Rendering

### Preview
```bash
npx remotion studio
```

### Render Video
```bash
# MP4
npx remotion render src/index.ts MyVideo out/video.mp4

# With options
npx remotion render src/index.ts MyVideo out/video.mp4 \
  --codec h264 \
  --crf 18 \
  --fps 60
```

### Render Still
```bash
npx remotion still src/index.ts MyVideo out/frame.png --frame 100
```

### Render GIF
```bash
npx remotion render src/index.ts MyVideo out/video.gif --codec gif
```

## Programmatic Rendering

```typescript
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

async function render() {
  const bundled = await bundle({
    entryPoint: "./src/index.ts",
  });

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "MyVideo",
  });

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: "out/video.mp4",
  });
}
```

## Integration with VibeFrame

```bash
# Generate motion component with AI
vibe ai motion "animated subscribe button" -o src/components/Subscribe.tsx

# Render Remotion composition
vibe render remotion MyVideo -o output.mp4

# Preview
vibe preview remotion
```

## Usage with Helper Scripts

```bash
# Generate component
python .claude/skills/remotion-motion/scripts/generate.py "lower third" -o LowerThird.tsx

# Render
npx remotion render src/index.ts CompositionId out/video.mp4
```

## References

- [Remotion Documentation](https://www.remotion.dev/docs)
- [Animation Guide](https://www.remotion.dev/docs/animating-properties)
- [Render Guide](https://www.remotion.dev/docs/render)
- [Component Library](https://www.remotion.dev/docs/resources)

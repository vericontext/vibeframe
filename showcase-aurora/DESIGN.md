---
name: Chasing Light
colors:
  primary: "#F4F1EA"
  ground: "#0B1622"
  accent: "#D8452E"
---

# Chasing Light — Design

Visual identity for **Chasing Light**: a cinematic, music-driven aurora short.
The generated video is the hero of every scene — full-bleed, no busy overlays.
Type is minimal and reverent: it names the piece, then gets out of the way.

## Style

**Mood:** quiet awe. Vast, cold, and beautiful — a single warm figure under an
enormous living sky. The viewer should feel the hush before the aurora breaks.

## Palette

- `#F4F1EA` — primary (warm off-white, for the sparse type)
- `#0B1622` — ground (deep arctic night behind letterboxing)
- `#D8452E` — accent (Mira's crimson parka; the one warm note, used sparingly)

The scene palette itself travels: starlit blue → aurora teal-green → violet →
dawn amber. Type never competes with it.

## Typography

One family, two weights. **Headline:** a light, wide serif or elegant sans in
thin weight for the title ("Chasing Light") — cinematic, restrained. **Label:**
the same family, small caps, letter-spaced, for a single end line. No body copy.

## Composition

Full-bleed video with a thin cinematic letterbox. Type lives in the lower third
or dead-center on the title card only, with generous negative space. One text
element on screen at a time. Never cover Mira or the aurora.

## Motion

Fluid and slow — everything drifts. Type fades in over ~1s and holds still; no
kinetic bouncing. Let the video's own camera move be the motion; overlays are
calm.

**GSAP signature:** `sine.inOut` (gentle ease), long durations.

## Transition

Slow cinematic cross-dissolve between scenes (a soft fade through near-black),
matching the contemplative pace. No glitch, no hard wipes.

## What NOT to do

- No kinetic/bouncy typography, no fast cuts, no gimmicky effects.
- No plastic 3D-render look, no uncanny faces, no sci-fi elements (no glowing eyes).
- No busy overlays, dashboards, or readable UI over the footage.

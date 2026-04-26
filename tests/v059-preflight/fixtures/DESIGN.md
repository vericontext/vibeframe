# VibeFrame — Design

> **Hard-gate.** This file defines the visual identity of every scene.

Visual identity for **VibeFrame**, scaffolded from the **Swiss Pulse** style (after Josef Müller-Brockmann). The brand voice: clinical, precise, developer-first. Every composition speaks to engineers reading terminals, not designers admiring keynotes.

## Style

**Mood:** Clinical, precise · **Best for:** Developer tools, dev infra, CLI products

## Palette

- `#0A0A0F` — deep ink, page background
- `#F5F5F7` — high-purity white, primary text
- `#0066FF` — electric blue, single accent (use SPARINGLY — never two accents in one frame)

Black canvas, white type, one electric-blue accent. No gradients on dark backgrounds (causes H.264 banding); use radial glows or solid fills only.

## Typography

Inter, two weights:
- **Bold (700/800)** — headlines 96–120px, tabular-nums on numbers
- **Regular (400)** — body labels 24–32px, all-caps for kickers with `letter-spacing: 0.15em`

## Composition

Grid-locked. Every element snaps to an invisible 12-column grid. Generous negative space — never fill more than 50% of the frame. Hard cuts only — no decorative transitions.

## Motion

Animated counters count up from 0. Entries are fast (0.4–0.6s) and snap into place — nothing floats. Numbers slam in at `expo.out`; type fades up at `power3.out`.

**GSAP signature:** `expo.out`, `power4.out` for slams; `power3.out` for type entries; offset 0.15–0.3s between staggered elements.

## Transition

Hard cut between scenes. No crossfades. No fades-to-black between beats.

## What NOT to do

- Decorative transitions (fades, dissolves) — use hard cuts only
- Two accent colours competing in one frame — pick blue OR amber, never both
- Off-grid placement — every element snaps to the 12-column grid
- Floating motion (`sine.inOut`, `back.out` overshoots) — entries must snap
- Linear gradients on the dark canvas — use radial or solid + localised glow
